/**
 * Guards - Validações Iniciais do Fluxo de Mensagens
 * ====================================================
 * Extração das validações do processMessage do index.ts.
 * Cada guard retorna { continue: boolean, response?: string }
 */

import type { Env, ConversationContext } from '../types';

// =============================================================================
// TIPOS
// =============================================================================

export interface GuardResult {
  /** Se true, continua o fluxo. Se false, para aqui */
  continue: boolean;
  /** Resposta a enviar (se continue = false) */
  response?: string;
  /** Se deve atualizar algo no contexto */
  contextUpdate?: Partial<ConversationContext>;
}

export interface GuardContext {
  sender: string;
  message: string;
  lowerMsg: string;
  cleanMessage: string;
  isGroup: boolean;
  imageUrl?: string;
  /** Contexto existente da conversa */
  conversationContext?: ConversationContext;
}

// =============================================================================
// GUARD: BLOCKLIST
// =============================================================================

export function checkBlocklist(isBlocked: boolean): GuardResult {
  if (isBlocked) {
    return { continue: false }; // Silently drop
  }
  return { continue: true };
}

// =============================================================================
// GUARD: PASSIVE MODE (após handoff)
// =============================================================================

export function checkPassiveMode(
  ctx: GuardContext,
  passiveModeUntil?: string | null
): GuardResult {
  if (!passiveModeUntil) {
    return { continue: true };
  }
  
  const isInPassiveMode = new Date(passiveModeUntil) > new Date();
  if (!isInPassiveMode) {
    return { continue: true };
  }
  
  const lowerMsg = ctx.lowerMsg;
  
  // Acknowledgments: resposta mínima
  const isAcknowledgment = /^(ok|obrigado|valeu|beleza|certo|ta|tá|sim|legal|blz)$/i.test(lowerMsg.trim());
  if (isAcknowledgment) {
    return {
      continue: false,
      response: "Fico à disposição! Nosso consultor entrará em contato em breve. 🤝"
    };
  }
  
  // Novo interesse em carro: sair do passive mode
  const isNewCarInterest = /^(tem|quero|busco|procuro|quer|voces tem|vocês tem)\s+\w+/i.test(lowerMsg) ||
                           /\?(to|tô|estou)\s+(procurando|buscando|querendo)/i.test(lowerMsg) ||
                           (/\?$/i.test(lowerMsg) && lowerMsg.length < 30);
  
  if (isNewCarInterest) {
    return {
      continue: true,
      contextUpdate: { passiveModeUntil: undefined }
    };
  }
  
  // Perguntas sobre o mesmo carro/vendedor
  const askingAboutSameCar = /pre[çc]o|disponivel|disponível|quando|ainda|vendedor|consultor/i.test(lowerMsg);
  if (askingAboutSameCar) {
    return {
      continue: false,
      response: "Nosso consultor já está ciente do seu interesse e entrará em contato. Qualquer dúvida, é só chamar por aqui! 😊"
    };
  }
  
  // Tópico desconhecido: continuar normalmente
  return { continue: true };
}

// =============================================================================
// GUARD: COMANDO /AJUDA
// =============================================================================

const HELP_COMMANDS = ['/ajuda', '/menu', '/help', 'ajuda', 'menu', 'opcoes', 'opções'];

export function checkHelpCommand(cleanMessage: string): GuardResult {
  const isHelp = HELP_COMMANDS.some(cmd => 
    cleanMessage === cmd || cleanMessage.startsWith(cmd + ' ')
  );
  
  if (!isHelp) {
    return { continue: true };
  }
  
  const helpMessage = `🚗 *Olá! Sou a iAN, assistente virtual da NetCar.*

Posso te ajudar com:

📋 *Buscar carros* — Me diz qual modelo procura (ex: "Quero um Corolla")
💰 *Faixa de preço* — "Carros até 80 mil"
🔄 *Troca/Trade-in* — Me conta sobre seu carro atual
📞 *Falar com vendedor* — "Quero falar com alguém"
📸 *Enviar foto* — Manda a foto de um carro que te interessa

📌 *Exemplos de perguntas:*
• "Tem HRV disponível?"
• "Quero um SUV até 100 mil"
• "Vocês aceitam troca?"

_Digite sua dúvida ou o que procura!_ 🚀`;

  return {
    continue: false,
    response: helpMessage
  };
}

// =============================================================================
// GUARD: COMANDO DE RESET (debug)
// =============================================================================

const SECRET_RESET_COMMANDS = ['ian reiniciar', 'ian reset', 'ian reiniciar imediato', '/ian-reset'];

export function checkResetCommand(cleanMessage: string): GuardResult {
  // Normalize: remove acentos, lowercase, trim
  const normalized = cleanMessage
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  
  const isReset = SECRET_RESET_COMMANDS.some(cmd => 
    normalized === cmd || normalized.includes(cmd)
  );
  
  if (!isReset) {
    return { continue: true };
  }
  
  console.log(`[RESET] Command matched: "${cleanMessage}" -> "${normalized}"`);
  
  // Sinaliza que eh um reset - o handler vai executar a logica
  return {
    continue: false,
    response: '__RESET_CONTEXT__' // Flag especial
  };
}

// =============================================================================
// GUARD: SPAM / MENSAGEM SEM CONTEÚDO
// =============================================================================

export function checkSpam(message: string): GuardResult {
  // Mensagem vazia
  if (!message || message.trim().length === 0) {
    return { continue: false };
  }
  
  // Verificar se é apenas emojis ou pontuação
  const onlyEmojisOrPunctuation = /^[\s\p{Emoji}\p{P}]+$/u.test(message);
  if (onlyEmojisOrPunctuation && message.length < 10) {
    return { continue: false }; // Silently drop
  }
  
  return { continue: true };
}

// =============================================================================
// GUARD: GIBBERISH (texto sem sentido)
// =============================================================================

export function checkGibberish(message: string): GuardResult {
  // Padrões de gibberish
  const patterns = [
    /^[aeiou]{5,}$/i,           // vogais repetidas: aaaaa
    /^[bcdfghjklmnpqrstvwxyz]{5,}$/i, // consoantes repetidas
    /(.)\1{4,}/i,               // mesmo char 5+ vezes: aaaaa
    /^[0-9\s]+$/,               // só números
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(message.trim())) {
      return { continue: false };
    }
  }
  
  return { continue: true };
}

// =============================================================================
// GUARD: REAÇÃO POSITIVA (ok, blz, 👍)
// =============================================================================

const POSITIVE_REACTIONS = [
  'ok', 'beleza', 'blz', 'certo', 'legal', 'show', 
  'perfeito', 'boa', 'top', 'massa', 'dahora', 'dale',
  '👍', '✅', '👌'
];

export function checkPositiveReaction(message: string): { isPositive: boolean } {
  const clean = message.toLowerCase().trim();
  const isPositive = POSITIVE_REACTIONS.some(r => 
    clean === r || clean.startsWith(r + ' ')
  );
  return { isPositive };
}

// =============================================================================
// RUN ALL GUARDS
// =============================================================================

export interface AllGuardsParams {
  message: string;
  lowerMsg: string;
  cleanMessage: string;
  isBlocked: boolean;
  passiveModeUntil?: string | null;
}

/**
 * Executa todos os guards em sequência
 * Retorna o primeiro que bloqueia ou { continue: true }
 */
export function runAllGuards(params: AllGuardsParams): GuardResult {
  // 1. Blocklist
  const blocklistResult = checkBlocklist(params.isBlocked);
  if (!blocklistResult.continue) return blocklistResult;
  
  // 2. Spam
  const spamResult = checkSpam(params.message);
  if (!spamResult.continue) return spamResult;
  
  // 3. Gibberish
  const gibberishResult = checkGibberish(params.message);
  if (!gibberishResult.continue) return gibberishResult;
  
  // 4. Help command
  const helpResult = checkHelpCommand(params.cleanMessage);
  if (!helpResult.continue) return helpResult;
  
  // 5. Reset command
  const resetResult = checkResetCommand(params.cleanMessage);
  if (!resetResult.continue) return resetResult;
  
  // 6. Passive mode (verifica por último pois pode ter exceções)
  const passiveResult = checkPassiveMode(
    { 
      sender: '', 
      message: params.message, 
      lowerMsg: params.lowerMsg, 
      cleanMessage: params.cleanMessage,
      isGroup: false 
    },
    params.passiveModeUntil
  );
  if (!passiveResult.continue) return passiveResult;
  
  return { continue: true };
}
