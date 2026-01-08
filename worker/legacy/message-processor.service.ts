/**
 * Message Processor Service
 * =========================
 * Processa mensagens recebidas via WhatsApp usando IA.
 * Extraído do index.ts para melhor organização e testabilidade.
 *
 * Este serviço é responsável por:
 * - Validar e filtrar mensagens (blocklist, usage guard)
 * - Detectar intenções do usuário (car search, handoff, FAQ)
 * - Rotear para a ação apropriada (busca de carros, resposta IA, handoff)
 * - Gerenciar contexto de conversa
 */

import type { Env, CarData } from '@types';
import type { ConversationContext } from './context.service';
import type { ConversationState, RouterResult } from './router.service';

// Logger
import { createLogger } from './logger.service';

// Usage Guard
import { checkRequestAllowed } from './usage-guard.service';

// Blocklist
import { isBlocklisted } from './blocklist.service';

// Followup
import { cancelFollowup, scheduleFollowup } from './followup.service';

// Context
import {
  getContext,
  updateContext,
  getPendingImageCars,
  getPendingActions,
  consumePendingActions,
} from './context.service';

// Session
import {
  isAskingForMore,
  hasMoreCars,
  getRemainingCount,
  getNextCarBatch,
} from './session.service';

// Evolution API
import {
  sendMessage,
  sendCarCard,
  sendButtons,
} from './evolution.service';

// Hardcoded Rules
import { checkHardcodedRules } from './hardcoded-rules.service';

// Router
import { routeMessage, createInitialState, updateStateFromContext } from './router.service';

// =============================================================================
// DEPENDENCY INTERFACE
// =============================================================================

/**
 * Dependências injetadas do index.ts para evitar dependências circulares.
 * Permite testar o processador isoladamente com mocks.
 */
export interface MessageProcessorDependencies {
  /** Verifica se saudação nativa foi enviada recentemente */
  wasNativeGreetingSentRecently: (sender: string, env: Env) => Promise<boolean>;

  /** Executa busca de carros */
  executeCarSearch: (
    carIntent: {
      modelo?: string;
      marca?: string;
      precoMin?: number;
      precoMax?: number;
      categoria?: string;
      cor?: string;
      transmissao?: string;
      motor?: string;
      opcional?: string;
    },
    sender: string,
    env: Env
  ) => Promise<void>;

  /** Faz handoff para vendedor humano */
  handleSellerHandover: (sender: string, env: Env) => Promise<void>;

  /** Gera resposta IA para conversa geral */
  generateAIResponse: (
    message: string,
    sender: string,
    senderName: string,
    env: Env,
    imageUrl?: string
  ) => Promise<void>;

  /** Detecta intenção de compra de carro */
  detectCarIntent: (
    message: string,
    env: Env
  ) => { marca?: string; modelo?: string; precoMin?: number; precoMax?: number; categoria?: string } | null;

  /** Salva mensagem do bot no histórico */
  saveBotMessage: (sender: string, message: string, env: Env) => Promise<void>;

  /** Cache de busca de carros */
  carSearchCache: Map<string, { data: CarData[]; timestamp: number }>;

  /** Contador de spam (Map global) */
  spamAttemptCount: Map<string, { count: number; lastReset: number }>;

  /** Janela de reset de spam em ms */
  spamResetWindow: number;
}

// =============================================================================
// HELPER: isGibberish
// =============================================================================

/**
 * Detecta mensagens ininteligíveis (gibberish)
 * Usado para limitar tentativas de responder a spam/ruído
 */
function isGibberish(msg: string): boolean {
  const clean = msg.replace(/[^\w\s]/g, '').trim();
  // Too short or only special chars
  if (clean.length < 2) return true;
  // Random keyboard mashing (consonants only, no vowels)
  if (clean.length > 3 && !/[aeiouáéíóúãõâêô]/i.test(clean)) return true;
  // Repeated single char
  if (/^(.)\1{3,}$/.test(clean)) return true;
  return false;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Processa mensagem recebida via WhatsApp.
 *
 * Este é o ponto de entrada principal para processamento de mensagens.
 * Orquestra todo o fluxo desde validação até resposta.
 *
 * @param message - Texto da mensagem recebida
 * @param sender - JID do remetente (telefone@s.whatsapp.net)
 * @param senderName - Nome do remetente (pushName)
 * @param env - Variáveis de ambiente Cloudflare
 * @param deps - Dependências injetadas
 * @param imageUrl - URL de imagem se mensagem contiver imagem
 * @param isGroup - Se a mensagem é de grupo (atualmente ignorada)
 */
export async function processMessage(
  message: string,
  sender: string,
  senderName: string,
  env: Env,
  deps: MessageProcessorDependencies,
  imageUrl?: string,
  isGroup: boolean = false
): Promise<void> {
  const log = createLogger('worker', env);
  const requestStartTime = Date.now();

  // 0. USAGE GUARD CHECK (Cost Protection)
  const usageCheck = await checkRequestAllowed(env);
  if (!usageCheck.allowed) {
    console.log(`[USAGE_GUARD] Request blocked: ${usageCheck.reason}`);
    return;
  }

  // 0.1. BLOCKLIST CHECK
  const isBlocked = await isBlocklisted(sender, env);
  if (isBlocked) {
    log.info(`[BLOCKLIST] Blocking message from ${sender}`);
    return;
  }

  // 0.5. NATIVE GREETING DETECTION
  const nativeGreetingDetected = await deps.wasNativeGreetingSentRecently(sender, env);

  // 1. Cancel any pending follow-up
  await cancelFollowup(sender, env);

  // Prepare normalized message
  const lowerMsg = message.toLowerCase();
  const cleanMessage = lowerMsg
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // ============================================================
  // MEMORY LANE: Check for pending image cars
  // ============================================================
  const pendingImageCars = await getPendingImageCars(sender, env);
  if (pendingImageCars.length > 0) {
    log.info(
      `[CONTEXT] Found ${pendingImageCars.length} pending image cars: ${pendingImageCars.map((c) => c.modelo).join(', ')}`
    );

    // Check if user is asking about the image car
    const confirmPatterns = [
      'tem esse',
      'tem desse',
      'tem igual',
      'tem parecido',
      'tem similar',
      'quero esse',
      'esse mesmo',
      'gostei desse',
      'interesse',
      'sim',
      'isso',
      'esse',
    ];

    const isConfirmingImageCar = confirmPatterns.some((p) => lowerMsg.includes(p)) && lowerMsg.length < 50;

    if (isConfirmingImageCar) {
      const firstCar = pendingImageCars[0];
      log.info(`[CONTEXT] User confirmed image car - searching for ${firstCar.modelo}`);

      const searchIntent = {
        modelo: firstCar.modelo,
        marca: firstCar.marca,
      };

      try {
        await deps.executeCarSearch(searchIntent, sender, env);
        return;
      } catch (e) {
        log.error('[CONTEXT] Image car search failed:', { error: e });
      }
    }
  }

  // ============================================================
  // PENDING ACTIONS: Check if user confirms pending searches
  // ============================================================
  const pendingSearches = await getPendingActions(sender, 'search', env);
  if (pendingSearches.length > 0) {
    const confirmPatterns = [
      'sim',
      'pode',
      'busca',
      'quero',
      'mostra',
      'ok',
      'beleza',
      'blz',
      'isso',
      'esse',
    ];

    const isConfirming = confirmPatterns.some((p) => lowerMsg.includes(p)) && lowerMsg.length < 50;

    if (isConfirming) {
      log.info(`[CONTEXT] User confirmed pending search - executing ${pendingSearches.length} searches`);

      for (const action of pendingSearches) {
        const searchFilters = action.params.filters || {
          modelo: action.params.modelo,
          marca: action.params.marca,
        };
        log.info(`[CONTEXT] Auto-executing pending search: ${JSON.stringify(searchFilters)}`);

        try {
          await deps.executeCarSearch(searchFilters, sender, env);
        } catch (e) {
          log.error('[CONTEXT] Pending search failed:', { error: e });
        }
      }

      await consumePendingActions(sender, 'search', env);
      return;
    }
  }

  // ============================================================
  // PAGINATION: "Show more" handling
  // ============================================================
  if (isAskingForMore(message)) {
    if (await hasMoreCars(sender, env)) {
      const batch = await getNextCarBatch(sender, 6, env);

      if (batch && batch.length > 0) {
        await sendMessage(sender, `Aqui vão mais ${batch.length} opções:`, env);

        for (const car of batch) {
          await sendCarCard(sender, car, env);
        }

        const stillRemaining = await getRemainingCount(sender, env);
        if (stillRemaining > 0) {
          await sendMessage(sender, `Tenho mais ${stillRemaining} opções. Quer ver mais?`, env);
        } else {
          await sendButtons(sender, 'Essas foram todas as opções que encontrei!', [
            { id: 'falar_vendedor', label: 'Falar com Vendedor' },
            { id: 'nova_busca', label: 'Nova Busca' },
          ], env);
          await sendMessage(sender, 'Alguma delas te interessou?', env);
        }
        await scheduleFollowup(sender, env, 15, 'handoff_15m');
        return;
      }
    } else {
      log.info('[PROCESS] User asked for more, but session empty/finished. Letting AI respond.');
    }
  }

  // ============================================================
  // NUMERIC MENU: Handle "1" and "2" responses
  // ============================================================
  if (cleanMessage === '1') {
    log.info('[PROCESS] User responded with "1" - assuming "Falar com Vendedor"');
    await deps.handleSellerHandover(sender, env);
    return;
  }

  if (cleanMessage === '2') {
    log.info('[PROCESS] User responded with "2" - assuming "Nova Busca"');
    await sendMessage(
      sender,
      'Claro! O que você está procurando? Me conta o modelo, marca ou faixa de preço.',
      env
    );
    await deps.saveBotMessage(sender, 'Claro! O que você está procurando? Me conta o modelo, marca ou faixa de preço.', env);
    return;
  }

  // ============================================================
  // GIBBERISH DETECTION: Limit attempts for unintelligible messages
  // ============================================================
  if (isGibberish(message) && message.length < 50) {
    const now = Date.now();
    let spamData = deps.spamAttemptCount.get(sender) || {
      count: 0,
      lastReset: now,
    };

    // Reset if window expired
    if (now - spamData.lastReset > deps.spamResetWindow) {
      spamData = { count: 0, lastReset: now };
    }

    spamData.count++;
    deps.spamAttemptCount.set(sender, spamData);

    if (spamData.count === 1) {
      await sendMessage(
        sender,
        'Não entendi muito bem. Você está buscando algum carro específico ou quer ver opções por faixa de preço?',
        env
      );
      return;
    } else if (spamData.count === 2) {
      await sendMessage(
        sender,
        'Acho que estamos com algum problema na comunicação. Se precisar de algo, é só me chamar. Continuo por aqui. Qual carro você procura?',
        env
      );
      return;
    } else {
      // Silent drop after 2 attempts
      log.info(`[SPAM] Max gibberish attempts reached for ${sender} - silencing`);
      return;
    }
  }

  // Reset spam counter on valid message
  if (deps.spamAttemptCount.has(sender)) {
    deps.spamAttemptCount.delete(sender);
  }

  // ============================================================
  // HARDCODED RULES: Bypass LLM for obvious cases
  // ============================================================
  const ctx = await getContext(sender, env);
  const hardcodedResult = checkHardcodedRules(message, ctx, env);
  if (hardcodedResult && hardcodedResult.skipLLM) {
    log.info(`[HARDCODED] Action: ${hardcodedResult.action} - Skipping LLM`);
    await sendMessage(sender, hardcodedResult.response, env);
    await deps.saveBotMessage(sender, hardcodedResult.response, env);
    return;
  }

  // ============================================================
  // ROUTER: Intent Detection + Slot Extraction
  // ============================================================
  // Build state from context
  const state: ConversationState = updateStateFromContext(
    createInitialState(sender),
    ctx as unknown as Record<string, unknown>
  );

  const routerResult = routeMessage(message, state, env);
  log.info(`[ROUTER] Result: ${JSON.stringify(routerResult)}`);

  // Handle based on router action
  switch (routerResult.action) {
    case 'HANDOFF_SELLER':
      log.info('[ROUTER] Handoff requested');
      await deps.handleSellerHandover(sender, env);
      return;

    case 'CALL_STOCK_API': {
      // Extract car intent from slots
      const carIntent = deps.detectCarIntent(message, env) || {};
      
      // Merge with router-extracted slots if available
      if (routerResult.state_update?.slots) {
        if (routerResult.state_update.slots.make) carIntent.marca = routerResult.state_update.slots.make;
        if (routerResult.state_update.slots.model) carIntent.modelo = routerResult.state_update.slots.model;
        if (routerResult.state_update.slots.category) carIntent.categoria = routerResult.state_update.slots.category;
      }

      // Check if we have enough info for search
      const hasSearchCriteria = carIntent.marca || carIntent.modelo || carIntent.categoria || 
        carIntent.precoMin || carIntent.precoMax;

      if (!hasSearchCriteria) {
        log.info('[ROUTER] STOCK action but no criteria - asking for budget');
        await sendMessage(
          sender,
          'Legal! Pra te ajudar melhor, qual faixa de preço você tá pensando? 💰',
          env
        );
        await deps.saveBotMessage(sender, 'Legal! Pra te ajudar melhor, qual faixa de preço você tá pensando? 💰', env);
        return;
      }

      // Execute search
      try {
        await deps.executeCarSearch(carIntent, sender, env);
      } catch (e) {
        log.error('[ROUTER] Car search failed:', { error: e });
        await deps.generateAIResponse(message, sender, senderName, env, imageUrl);
      }
      return;
    }

    case 'SMALLTALK':
    case 'ASK_ONE_QUESTION':
    case 'CONFIRM_CONTEXT':
    case 'INFO_STORE':
    case 'OUT_OF_SCOPE':
    default:
      // Let AI handle the response
      await deps.generateAIResponse(message, sender, senderName, env, imageUrl);
      return;
  }
}
