/**
 * FSM Conversation Orchestrator
 * =============================
 * Finite State Machine para orquestrar estados da conversa
 * 
 * Estados:
 * - GREETING: Primeiro contato, saudação
 * - QUALIFYING: Coletando informações do interesse
 * - BROWSING: Mostrando veículos
 * - COMPARING: Comparando opções
 * - NEGOTIATING: Negociação/objeções
 * - SCHEDULING: Agendando visita/test-drive
 * - HANDOFF: Transferindo para vendedor
 * - IDLE: Conversa inativa
 * 
 * Transições são baseadas em:
 * - Ação do router
 * - Slots preenchidos
 * - Tempo desde última mensagem
 * - Intenção detectada
 */

import type { Env } from '../types';
import { getFromKV, setInKV } from './cache.service';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type ConversationStage = 
  | 'GREETING'
  | 'QUALIFYING' 
  | 'BROWSING'
  | 'COMPARING'
  | 'NEGOTIATING'
  | 'SCHEDULING'
  | 'HANDOFF'
  | 'IDLE';

export interface FSMState {
  stage: ConversationStage;
  previousStage: ConversationStage | null;
  enteredAt: string;
  turnCount: number;
  stageHistory: Array<{ stage: ConversationStage; at: string }>;
}

export interface TransitionContext {
  action: string;
  slotsFilled: string[];
  slotsTotal: number;
  hasCarShown: boolean;
  hasHandoff: boolean;
  minutesSinceLastMessage: number;
  userIntent: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const FSM_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Prompts específicos por estágio para guiar o LLM
 */
export const STAGE_PROMPTS: Record<ConversationStage, string> = {
  GREETING: `
ESTÁGIO: BOAS-VINDAS
- Seja caloroso e acolhedor
- Pergunte como pode ajudar
- Não seja invasivo ainda
- Uma pergunta por vez
`,
  QUALIFYING: `
ESTÁGIO: QUALIFICAÇÃO
- Descubra o que o cliente procura
- Pergunte sobre: categoria, orçamento, preferências
- Máximo 2 perguntas de qualificação
- Se já tem informações suficientes, mostre opções
`,
  BROWSING: `
ESTÁGIO: NAVEGAÇÃO
- Mostre veículos relevantes
- Destaque características principais
- Ofereça comparações se houver dúvida
- Pergunte se quer ver mais opções ou detalhes
`,
  COMPARING: `
ESTÁGIO: COMPARAÇÃO
- Compare modelos lado a lado
- Destaque prós e contras de cada
- Ajude na decisão sem pressionar
- Sugira test-drive se apropriado
`,
  NEGOTIATING: `
ESTÁGIO: NEGOCIAÇÃO
- Trate objeções com empatia
- Ofereça alternativas (financiamento, outro modelo)
- Não seja defensivo sobre preços
- Busque entender a real objeção
`,
  SCHEDULING: `
ESTÁGIO: AGENDAMENTO
- Facilite o agendamento de visita
- Ofereça opções de horário
- Confirme dados de contato
- Prepare para handoff
`,
  HANDOFF: `
ESTÁGIO: HANDOFF
- Transição suave para vendedor humano
- Passe contexto relevante
- Celebre a decisão do cliente
- Despedida calorosa
`,
  IDLE: `
ESTÁGIO: INATIVO
- Cliente não está engajado
- Aguarde nova mensagem
- Seja breve nas respostas
- Ofereça ajuda sem pressionar
`
};

/**
 * Regras de bloqueio por estágio (Limitador de Ação)
 * Define o que NÃO pode ser feito em cada estágio
 */
export const STAGE_RULES: Record<ConversationStage, {
  mustNot: string[];
  must: string[];
  maxResponseLength: number;
}> = {
  GREETING: {
    mustNot: [
      'Não ofereça carros específicos ainda',
      'Não pergunte orçamento diretamente',
      'Não mencione preços',
      'Não faça mais de 1 pergunta',
    ],
    must: [
      'Seja caloroso e acolhedor',
      'Pergunte como pode ajudar',
    ],
    maxResponseLength: 200,
  },
  QUALIFYING: {
    mustNot: [
      'Não liste mais de 3 carros',
      'Não pressione para fechar venda',
      'Não pergunte mais de 2 vezes a mesma coisa',
    ],
    must: [
      'Descubra o interesse do cliente',
      'Pergunte sobre preferências',
    ],
    maxResponseLength: 300,
  },
  BROWSING: {
    mustNot: [
      'Não liste mais de 6 carros de uma vez',
      'Não pressione para fechar',
    ],
    must: [
      'Mostre opções relevantes',
      'Destaque características principais',
    ],
    maxResponseLength: 400,
  },
  COMPARING: {
    mustNot: [
      'Não force uma decisão',
      'Não descarte opções sem motivo',
    ],
    must: [
      'Compare lado a lado',
      'Destaque prós e contras',
    ],
    maxResponseLength: 400,
  },
  NEGOTIATING: {
    mustNot: [
      'Não encerre a conversa',
      'Não ignore objeções',
      'Não invente descontos ou valores FIPE',
    ],
    must: [
      'Trate objeções com empatia',
      'Encaminhe para consultor se necessário',
    ],
    maxResponseLength: 350,
  },
  SCHEDULING: {
    mustNot: [
      'Não volte a mostrar carros',
      'Não faça mais perguntas de qualificação',
    ],
    must: [
      'Facilite o agendamento',
      'Confirme dados de contato',
    ],
    maxResponseLength: 250,
  },
  HANDOFF: {
    mustNot: [
      'Não faça perguntas de qualificação',
      'Não mostre novos carros',
      'Não tente vender mais',
    ],
    must: [
      'Confirme que consultor foi acionado',
      'Despedida calorosa',
    ],
    maxResponseLength: 200,
  },
  IDLE: {
    mustNot: [
      'Não envie mensagens longas',
      'Não pressione',
    ],
    must: [
      'Seja breve',
      'Ofereça ajuda sem insistir',
    ],
    maxResponseLength: 150,
  },
};

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Cria estado FSM inicial
 */
export function createInitialFSMState(): FSMState {
  return {
    stage: 'GREETING',
    previousStage: null,
    enteredAt: new Date().toISOString(),
    turnCount: 0,
    stageHistory: [{ stage: 'GREETING', at: new Date().toISOString() }]
  };
}

/**
 * Obtém estado FSM do KV
 */
export async function getFSMState(phone: string, env: Env): Promise<FSMState | null> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  const key = `fsm:${phoneClean}`;
  return getFromKV<FSMState>(env, key);
}

/**
 * Salva estado FSM no KV
 */
export async function setFSMState(phone: string, state: FSMState, env: Env): Promise<void> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  const key = `fsm:${phoneClean}`;
  await setInKV(env, key, state, FSM_TTL_SECONDS);
  console.log(`[FSM] State saved: ${state.stage} for ${phoneClean}`);
}

/**
 * Determina próximo estágio baseado no contexto
 * FIX #5: Valida qualificação mínima antes de permitir HANDOFF
 */
export function determineNextStage(
  currentStage: ConversationStage,
  context: TransitionContext
): ConversationStage {
  const { action, slotsFilled, hasCarShown, hasHandoff, minutesSinceLastMessage, userIntent } = context;

  // Inatividade longa → IDLE
  if (minutesSinceLastMessage > 60) {
    return 'IDLE';
  }

  // FIX #5: Validate minimum qualification before allowing HANDOFF
  // Requires: 2+ slots filled OR at least one car was shown
  const isMinimallyQualified = slotsFilled.length >= 2 || hasCarShown;
  
  // Handoff detectado → validar antes de transicionar
  if (action === 'HANDOFF_SELLER' || hasHandoff) {
    // FIX #5: Block premature handoff if lead is not qualified
    if (!isMinimallyQualified) {
      console.log(`[FSM] FIX #5: Blocking premature HANDOFF - only ${slotsFilled.length} slots filled, hasCarShown=${hasCarShown}`);
      // Stay in QUALIFYING to gather more info first
      if (currentStage === 'GREETING') {
        return 'QUALIFYING';
      }
      // Otherwise stay in current stage
      return currentStage;
    }
    
    // Lead is qualified - allow handoff
    console.log(`[FSM] Allowing HANDOFF - ${slotsFilled.length} slots filled, hasCarShown=${hasCarShown}`);
    return 'HANDOFF';
  }

  // Baseado na ação do router
  switch (action) {
    case 'SMALLTALK':
      if (currentStage === 'GREETING') return 'GREETING';
      return currentStage; // Mantém estágio atual
      
    case 'ASK_ONE_QUESTION':
      return 'QUALIFYING';
      
    case 'CALL_STOCK_API':
      return hasCarShown ? 'COMPARING' : 'BROWSING';
      
    case 'INFO_STORE':
      return currentStage; // Mantém estágio atual
      
    case 'EXIT':
      return 'IDLE';
      
    case 'SAFE_REFUSAL':
    case 'OUT_OF_SCOPE':
      return currentStage; // Mantém estágio atual
  }

  // Transições por intenção
  if (userIntent === 'negotiate' || userIntent === 'objecao') {
    return 'NEGOTIATING';
  }
  if (userIntent === 'visit' || userIntent === 'testdrive') {
    return 'SCHEDULING';
  }
  if (userIntent === 'compare') {
    return 'COMPARING';
  }

  // Transições por slots preenchidos
  if (slotsFilled.length >= 2 && !hasCarShown) {
    return 'BROWSING'; // Tem info suficiente para mostrar carros
  }
  if (slotsFilled.length < 2 && currentStage === 'GREETING') {
    return 'QUALIFYING'; // Precisa qualificar
  }

  return currentStage; // Default: mantém estágio
}

/**
 * Executa transição de estágio
 */
export async function transitionStage(
  phone: string,
  context: TransitionContext,
  env: Env
): Promise<{ currentStage: ConversationStage; transitioned: boolean; prompt: string }> {
  // Obtém estado atual ou cria novo
  let state = await getFSMState(phone, env);
  if (!state) {
    state = createInitialFSMState();
  }

  // Determina próximo estágio
  const nextStage = determineNextStage(state.stage, context);
  const transitioned = nextStage !== state.stage;

  if (transitioned) {
    console.log(`[FSM] Transition: ${state.stage} → ${nextStage}`);
    
    // Atualiza estado
    state = {
      stage: nextStage,
      previousStage: state.stage,
      enteredAt: new Date().toISOString(),
      turnCount: state.turnCount + 1,
      stageHistory: [
        ...state.stageHistory.slice(-9), // Mantém últimos 10
        { stage: nextStage, at: new Date().toISOString() }
      ]
    };
  } else {
    // Incrementa turno sem mudar estágio
    state.turnCount++;
  }

  // Salva estado
  await setFSMState(phone, state, env);

  return {
    currentStage: state.stage,
    transitioned,
    prompt: STAGE_PROMPTS[state.stage]
  };
}

/**
 * Obtém prompt para o estágio atual
 */
export async function getStagePrompt(phone: string, env: Env): Promise<string> {
  const state = await getFSMState(phone, env);
  if (!state) {
    return STAGE_PROMPTS.GREETING;
  }
  return STAGE_PROMPTS[state.stage];
}

/**
 * Reseta FSM para GREETING
 */
export async function resetFSM(phone: string, env: Env): Promise<void> {
  const state = createInitialFSMState();
  await setFSMState(phone, state, env);
  console.log(`[FSM] Reset to GREETING for ${phone}`);
}

/**
 * Obtém resumo do FSM para debug
 */
export async function getFSMSummary(phone: string, env: Env): Promise<string> {
  const state = await getFSMState(phone, env);
  if (!state) {
    return 'FSM: Nova conversa (GREETING)';
  }
  
  return `FSM: ${state.stage} | Turno: ${state.turnCount} | Anterior: ${state.previousStage || 'N/A'}`;
}

/**
 * Obtém regras do estágio atual (Limitador de Ação)
 */
export async function getStageRules(phone: string, env: Env): Promise<{
  mustNot: string[];
  must: string[];
  maxResponseLength: number;
  stage: ConversationStage;
}> {
  const state = await getFSMState(phone, env);
  const stage = state?.stage || 'GREETING';
  const rules = STAGE_RULES[stage];
  
  return {
    ...rules,
    stage,
  };
}

/**
 * Constrói prompt com restrições do estágio (para injetar no system prompt)
 */
export function buildStageConstraints(stage: ConversationStage): string {
  const rules = STAGE_RULES[stage];
  const prompt = STAGE_PROMPTS[stage];
  
  let constraints = `\n${prompt}\n`;
  constraints += `\n⛔ PROIBIDO neste estágio:\n`;
  rules.mustNot.forEach(rule => {
    constraints += `- ${rule}\n`;
  });
  constraints += `\n✅ OBRIGATÓRIO neste estágio:\n`;
  rules.must.forEach(rule => {
    constraints += `- ${rule}\n`;
  });
  constraints += `\n📏 Limite de resposta: ${rules.maxResponseLength} caracteres\n`;
  
  return constraints;
}
