/**
 * Hardcoded Rules Service
 * =======================
 * Regras que NÃO passam pela LLM - economia de custo e latência.
 * 
 * Casos óbvios são tratados por código:
 * - Modo passivo após handoff
 * - Despedida quando cliente quer encerrar
 * - Exit quando cliente não quer mais mensagens
 * - Saudações simples
 */

import type { ConversationContext } from './context.service';
import type { Env } from '@types';
import { createLogger } from './logger.service';

// =============================================================================
// TYPES
// =============================================================================

export type HardcodedAction = 
  | 'PASSIVE'           // Após handoff, só confirma
  | 'GOODBYE'           // Cliente quer encerrar
  | 'EXIT'              // Cliente não quer mais mensagens
  | 'GREETING'          // Saudação simples
  | 'TRADE_CONFIRMED'   // Cliente confirmou usar valor como base
  | null;               // Continua para Planner

export interface HardcodedResult {
  action: HardcodedAction;
  response: string;
  skipLLM: boolean;
}

// =============================================================================
// PATTERNS
// =============================================================================

/** Padrões de encerramento temporário (volta amanhã) */
const POSTPONE_PATTERNS = [
  /amanh[ãa]\s*(a gente|falamos|conversamos|continua)/i,
  /vou\s*dormir/i,
  /depois\s*(falamos|conversamos|a gente)/i,
  /agora\s*n[ãa]o\s*(posso|d[áa]|consigo)/i,
  /t[áa]\s*na\s*hora\s*de\s*(eu\s*)?(dormir|descansar)/i,
  /boa\s*noite.*descans/i,
  /j[áa]\s*vou\s*(indo|nessa)/i,
  /depois\s*te\s*(chamo|falo)/i,
];

/** Padrões de saída definitiva */
const EXIT_PATTERNS = [
  /n[ãa]o\s*quero\s*mais/i,
  /para\s*de\s*mandar/i,
  /sai\s*da\s*minha/i,
  /me\s*bloqueia/i,
  /n[ãa]o\s*me\s*mande\s*mais/i,
  /desist[io]/i,
  /n[ãa]o\s*tenho\s*(mais\s*)?interesse/i,
];

/** Padrões de saudação simples (sem contexto) */
const GREETING_PATTERNS = [
  /^(oi|ol[áa]|opa|e\s*a[íi]|eai|hey|hi)\s*[!?.]?$/i,
  /^bom\s*dia\s*[!?.]?$/i,
  /^boa\s*(tarde|noite)\s*[!?.]?$/i,
  /^tudo\s*(bem|bom|certo)\s*[!?.]?$/i,
];

/** Padrões de confirmação simples após handoff */
const ACKNOWLEDGMENT_PATTERNS = [
  /^(ok|beleza|blz|vlw|valeu|obrigad[oa]|show|massa|top)\s*[!?.]?$/i,
  /^(sim|s|ss|isso|exato|certeza)\s*[!?.]?$/i,
  /^(t[áa]\s*bom|tudo\s*certo|perfeito)\s*[!?.]?$/i,
];

/** Padrões de confirmação de TROCA (após pergunta de valor) */
const TRADE_CONFIRM_PATTERNS = [
  /^(sim|s|ss|isso|exato|quero|bora|pode|ok|beleza)\s*[!?.,]?$/i,
  /^(é\s*o\s*meu|é\s*meu|meu\s*mesmo)\s*[!?.,]?$/i,
  /(pra\s*)?troca/i,
  /usa(r)?\s*(como|esse)\s*base/i,
  /mostra(r)?\s*(as\s*)?opç[õo]es/i,
  /quero\s*ver/i,
];

// =============================================================================
// RESPONSES
// =============================================================================

const RESPONSES = {
  PASSIVE: [
    // Respostas proativas que engajam o cliente - NUNCA "qualquer coisa, tô por aqui"
    'Entendi! Me conta mais: tá procurando algo mais espaçoso ou compacto? Tem preferência de marca? 🚗',
    'Certo! E você já tem uma faixa de preço em mente? Assim posso buscar as melhores opções pra você!',
    'Beleza! Você tem algum carro pra dar na troca? Isso pode ajudar bastante no seu novo! 🔄',
  ],
  GOODBYE: [
    'Tranquilo! Descansa bem, amanhã a gente continua. 🌙',
    'Beleza! Boa noite, depois a gente se fala! 😊',
    'Combinado! Fica tranquilo, amanhã continuamos. Até mais!',
  ],
  EXIT: [
    'Entendi. Se mudar de ideia, é só chamar! Abraço! 👋',
    'Tudo bem! Qualquer coisa no futuro, tô por aqui. Abraço!',
  ],
  GREETING: [
    'Oi! 😊 Bora encontrar o carro ideal pra você! Tá buscando algo específico ou quer que eu mostre nossas novidades?',
    'Olá! Tudo bem? 🚗 Me conta: qual tipo de carro você tá procurando? SUV, hatch, sedan...?',
    'E aí! 👋 Posso te ajudar a encontrar o carro perfeito! Você já tem algum modelo em mente ou quer explorar opções?',
  ],
};


// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Verifica se a mensagem pode ser tratada por regra hardcoded.
 * Se retornar resultado, NÃO chamar LLM.
 */
export function checkHardcodedRules(
  message: string,
  ctx: ConversationContext,
  env: Env
): HardcodedResult | null {
  const normalized = message.trim();
  const log = createLogger('worker', env);
  
  // 1. MODO PASSIVO: Após handoff, só confirma e fica à disposição
  if (ctx.sellerHandoff?.done) {
    const handoffTime = new Date(ctx.sellerHandoff.at || 0).getTime();
    const timeSinceHandoff = Date.now() - handoffTime;
    const PASSIVE_WINDOW = 30 * 60 * 1000; // 30 minutos
    
    if (timeSinceHandoff < PASSIVE_WINDOW) {
      // Se é uma confirmação simples, responde e fica passivo
      if (ACKNOWLEDGMENT_PATTERNS.some(p => p.test(normalized))) {
        log.info('[HARDCODED] Passive mode - acknowledgment after handoff');
        return {
          action: 'PASSIVE',
          response: randomChoice(RESPONSES.PASSIVE),
          skipLLM: true,
        };
      }
      
      // Se menciona o mesmo assunto do handoff, reforça que consultor já foi acionado
      // (Isso será detectado mas não bloqueia totalmente - permite nova pergunta)
    }
  }
  
  // 2. POSTPONE: Cliente quer encerrar temporariamente
  if (POSTPONE_PATTERNS.some(p => p.test(normalized))) {
    log.info('[HARDCODED] Postpone detected');
    return {
      action: 'GOODBYE',
      response: randomChoice(RESPONSES.GOODBYE),
      skipLLM: true,
    };
  }
  
  // 3. EXIT: Cliente não quer mais mensagens
  if (EXIT_PATTERNS.some(p => p.test(normalized))) {
    log.info('[HARDCODED] Exit detected');
    return {
      action: 'EXIT',
      response: randomChoice(RESPONSES.EXIT),
      skipLLM: true,
    };
  }
  
  // 3.5. TRADE_CONFIRMED: Cliente confirmou usar valor como base para troca
  // Detecta se há estimativa de valor salva no contexto E cliente confirmou
  const userCarEstimate = (ctx as any).userCarEstimate;
  if (userCarEstimate && TRADE_CONFIRM_PATTERNS.some(p => p.test(normalized))) {
    log.info(`[HARDCODED] Trade confirmed! Using estimate R$ ${userCarEstimate.valorMax} as base`);
    return {
      action: 'TRADE_CONFIRMED',
      response: `Perfeito! Vou buscar opções que fazem sentido pra troca. Um instante... 🔍`,
      skipLLM: false, // Não pula LLM - precisa buscar carros
      tradeValue: userCarEstimate.valorMax,
    } as HardcodedResult & { tradeValue: number };
  }
  
  // 4. GREETING: Saudação simples sem contexto
  // Só ativa se não há histórico significativo
  if (!ctx.lastBotMessage && GREETING_PATTERNS.some(p => p.test(normalized))) {
    log.info('[HARDCODED] Simple greeting detected');
    return {
      action: 'GREETING',
      response: randomChoice(RESPONSES.GREETING),
      skipLLM: true,
    };
  }
  
  // Nenhuma regra aplicável - continua para Planner/LLM
  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Verifica se está em modo passivo (após handoff recente)
 */
export function isInPassiveMode(ctx: ConversationContext): boolean {
  if (!ctx.sellerHandoff?.done) return false;
  
  const handoffTime = new Date(ctx.sellerHandoff.at || 0).getTime();
  const timeSince = Date.now() - handoffTime;
  const PASSIVE_WINDOW = 30 * 60 * 1000;
  
  return timeSince < PASSIVE_WINDOW;
}
