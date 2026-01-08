/**
 * Router Service - Deterministic Policy Engine v2
 * 
 * Executes BEFORE the LLM to decide the action.
 * The LLM cannot override this decision.
 * 
 * Based on full_bot_prompt_v4.md Section 2
 * 
 * PATCH v2 (30/12/2024):
 * - Priority 0: SILENT when handoff.mode === 'HUMAN'
 * - EXIT_KEYWORDS with do_not_contact
 * - Separated INFO_KEYWORDS vs NEGOTIATION_KEYWORDS
 * - FOLLOWUP priority above STOCK
 * - state_update returned for low_signal_count
 * 
 * REFACTOR (04/01/2026):
 * - Keywords moved to config/router-keywords.ts
 * - Car models moved to config/car-models.ts
 */

import type { Env } from '@types';

// Import centralized configurations
// CONFIG RESTORED INLINE (Migration Fix)
import { MODEL_TO_BRAND, CAR_BRANDS, COLOR_MAP } from '../../bot/core/intent-config';
// FIX #9: Import detectModel corrigida de bot/core (agora exportada)
import { detectModel } from '../../bot/core/intent-detection';

const MODEL_TO_MAKE = MODEL_TO_BRAND;
const CAR_MAKES = Object.keys(CAR_BRANDS).map(k => k.toLowerCase());
const CAR_COLORS = COLOR_MAP;
const CAR_MODELS_KNOWN = Object.keys(MODEL_TO_BRAND);
const BRAZILIAN_CITIES = ['porto alegre', 'canoas', 'gravataí', 'cachoeirinha', 'esteio', 'sapucaia', 'são leopoldo', 'novo hamburgo', 'viamao', 'alvorada'];
const BRAZILIAN_STATES = ['rs', 'sc', 'pr', 'sp', 'rj', 'mg'];

// Keywords
const SAFETY_KEYWORDS = ['suicidio', 'morte', 'matar', 'crime', 'policia', 'droga', 'processo', 'justiça', 'advogado', 'golpe', 'fraude', 'denunciar'];
const FRUSTRATION_KEYWORDS = ['burro', 'idiota', 'atendimento lixo', 'falar com humano', 'atendente', 'gerente', 'não entende', 'merda', 'bosta'];
const EXIT_KEYWORDS = ['tchau', 'sair', 'parar', 'cancelar', 'pare', 'não quero mais', 'nao quero mais', 'encerrar', 'desisto', 'não quero', 'sem interesse', 'pare de mandar', 'não tenho interesse', 'nao tenho interesse'];
const GREETING_KEYWORDS = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'epa', 'opa'];
const CONFIRMATION_KEYWORDS = ['sim', 'quero', 'isso', 'pode ser', 'ok', 'claro', 'perfeito', 'exato', 'com certeza'];
const NEGOTIATION_KEYWORDS = ['financiamento', 'financiar', 'entrada', 'parcela', 'troca', 'negociar', 'pagamento', 'juros', 'condicoes', 'condições', 'fechar', 'comprar', 'vendedor', 'visita'];
const INFO_KEYWORDS = ['detalhes', 'informações', 'ficha', 'km', 'ano', 'motor', 'opcionais', 'fotos', 'mais', 'preço', 'valor', 'custa', 'quanto'];
const STOCK_REQUEST_KEYWORDS = ['tem', 'estoque', 'busco', 'procuro', 'queria', 'gostaria', 'quero ver', 'disponivel'];
const SHOW_OPTIONS_PATTERNS = [/ver opções/i, /mostrar/i, /tem algum/i, /quais tem/i];
const LOW_SIGNAL_RESPONSES = ['ok', 'ta', 'tá', 'hum', 'entendi', 'legal', 'joia', 'beleza', 'pode ser', 'sei lá', 'sei la', 'não sei', 'nao sei'];
const INFO_STORE_KEYWORDS = ['onde fica', 'endereço', 'endereco', 'telefone', 'whatsapp', 'localização', 'localizacao', 'horário', 'horario', 'aberto', 'fechado'];
const OUT_OF_SCOPE_KEYWORDS = ['pizza', 'lanche', 'jogo', 'futebol', 'namoro', 'sexo'];

// =============================================================================
// TYPES
// =============================================================================

export type RouterAction = 
  | 'SILENT'           // NEW: Bot não responde (handoff.mode=HUMAN)
  | 'SAFE_REFUSAL'
  | 'EXIT'             // NEW: Lead não quer mais
  | 'INFO_STORE'       // CLI AUDIT FIX: Store info request (telefone, endereco, horario)
  | 'OUT_OF_SCOPE'     // CLI AUDIT FIX: Message not related to cars
  | 'CONFIRM_CONTEXT'  // CONTEXT-FIX: Confirmation - maintain previous context
  | 'HANDOFF_SELLER'
  | 'FOLLOWUP'
  | 'CALL_STOCK_API'
  | 'ASK_ONE_QUESTION'
  | 'SMALLTALK';

export interface ConversationState {
  lead_id?: string;
  phone: string;
  stage: 'curioso' | 'comparando' | 'objecao' | 'pronto';
  intent: 'browse' | 'compare' | 'negotiate' | 'visit' | 'idle' | 'followup_response';
  handoff: {
    mode: 'BOT' | 'HUMAN';
    seller_id?: string;
    at?: string;
    reason?: string;
  };
  slots: {
    city_or_region?: string;
    category?: 'SUV' | 'sedan' | 'hatch' | 'pickup';
    make?: string;
    model?: string;
    motor?: string; cor?: string;  // NEW: Engine spec (1.0, 1.3, 2.0 turbo, etc.)
    year_min?: number;
    year_max?: number;
    budget_max?: number;
    payment_method?: 'avista' | 'financiamento' | 'consorcio' | 'indefinido';
    has_trade_in?: boolean;
    trade_in_model?: string;
    down_payment?: number;
    urgency?: 'hoje' | 'semana' | 'mes' | 'sem_pressa' | 'indefinido';
    transmissao?: 'manual' | 'automatico';
  };
  cars_shown: Array<{ car_id: string; shown_at: string; summary: string }>;
  pending_actions: Array<{
    type: 'SEND_OPTIONS' | 'SEND_SIMULATION' | 'SCHEDULE_VISIT' | 'HANDOFF' | 'FOLLOWUP';
    status: 'OPEN' | 'DONE' | 'CANCELLED';
    due_at?: string;
    meta?: Record<string, any>;
  }>;
  low_signal_count: number;
  has_pending_followup?: boolean;
  do_not_contact?: boolean;  // NEW: Lead optou por sair
}

export interface RouterResult {
  action: RouterAction;
  reason: string;
  tool_to_call?: 'chamaApiCarros' | 'encaminhaVendedores' | 'scheduleFollowUp';
  missing_slot?: string;
  state_update?: Partial<ConversationState>;  // NEW: Updates to persist
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================


// CLI AUDIT FIX: Clean extracted text by stopping at connectives
function cleanExtractedSlot(text: string): string {
  // STOP WORDS UPDATED: Connectives and punctuation
  const stopWords = [' e ', ' que ', ' com ', ' para ', ' pra ', ' ate ', ' até ', ' de ', ' em ', ',', '.', '!', '?'];
  let cleaned = text.toLowerCase().trim();
  
  for (const stopWord of stopWords) {
    const idx = cleaned.indexOf(stopWord);
    if (idx > 0) {
      cleaned = cleaned.substring(0, idx).trim();
    }
  }
  
  // Remove trailing punctuation and extra spaces
  cleaned = cleaned.replace(/[.,!?;:]+$/, '').trim();
  
  return cleaned;
}

// Extract city from user message
export function extractCityFromMessage(message: string): string | null {
  const normalized = normalizeText(message);
  
  // Pattern: "sou de X", "moro em X", "estou em X", "fico em X"
  const locationPatterns = [
    /sou de ([a-z\s]+)/,
    /moro em ([a-z\s]+)/,
    /estou em ([a-z\s]+)/,
    /fico em ([a-z\s]+)/,
    /aqui em ([a-z\s]+)/,
    /aqui de ([a-z\s]+)/,
    /regiao de ([a-z\s]+)/,
    /cidade de ([a-z\s]+)/,
  ];
  
  for (const pattern of locationPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      // CLI AUDIT FIX: Clean the extracted text
      const cleaned = cleanExtractedSlot(match[1]);
      
      // Check if it's a known city
      for (const city of BRAZILIAN_CITIES) {
        if (cleaned.includes(city) || city.includes(cleaned)) {
          return cleaned;
        }
      }
      // Return cleaned version if pattern matched
      return cleaned;
    }
  }
  
  // Direct city mention (longer names first to avoid partial matches)
  const sortedCities = [...BRAZILIAN_CITIES].sort((a, b) => b.length - a.length);
  for (const city of sortedCities) {
    if (normalized.includes(city)) {
      return city;
    }
  }
  
  // State abbreviations - must be exact word match (word boundary)
  for (const state of BRAZILIAN_STATES) {
    const wordBoundaryPattern = new RegExp(`\\b${state}\\b`);
    if (wordBoundaryPattern.test(normalized)) {
      return state;
    }
  }
  
  return null;
}

// BUG-001 FIX: Extract car model from user message
export function extractCarModel(message: string): string | null {
  const normalized = normalizeText(message);
  
  // Sort by length descending to match longer names first (e.g., "corolla cross" before "corolla")
  const sortedModels = [...CAR_MODELS_KNOWN].sort((a, b) => b.length - a.length);
  
  for (const model of sortedModels) {
    // Word boundary match to avoid false positives
    const modelNormalized = normalizeText(model);
    const wordBoundaryPattern = new RegExp(`\\b${modelNormalized}\\b`);
    if (wordBoundaryPattern.test(normalized)) {
      return model;
    }
  }
  
  return null;
}

// NER FIX: Extract car make (brand) from message
// 1. Direct extraction: "Ford Ka" -> ford
// 2. Inference from model: if model=ka, make=ford (via MODEL_TO_MAKE)
export function extractCarMake(message: string, extractedModel?: string | null): string | null {
  const normalized = normalizeText(message);
  
  // First try direct extraction
  for (const make of CAR_MAKES) {
    const makeNormalized = normalizeText(make);
    const wordBoundaryPattern = new RegExp(`\\b${makeNormalized}\\b`);
    if (wordBoundaryPattern.test(normalized)) {
      // Normalize VW -> volkswagen, GM -> chevrolet
      if (make === 'vw') return 'volkswagen';
      if (make === 'gm') return 'chevrolet';
      return make;
    }
  }
  
  // If no direct match, try to infer from model
  if (extractedModel) {
    const modelNormalized = normalizeText(extractedModel);
    if (MODEL_TO_MAKE[modelNormalized]) {
      return MODEL_TO_MAKE[modelNormalized];
    }
  }
  
  return null;
}

// NER FIX: Extract year from message
// Patterns: "2020", "20/21", "2020/2021", "modelo 2020"
export function extractYear(message: string): number | null {
  const normalized = normalizeText(message);
  
  // Pattern 1: Full year (2010-2030)
  const yearMatch = normalized.match(/\b(20[1-3][0-9])\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }
  
  // Pattern 2: Short year (20, 21, 22, 23, 24, 25)
  const shortYearMatch = normalized.match(/\b(2[0-5])\b/);
  if (shortYearMatch) {
    return 2000 + parseInt(shortYearMatch[1], 10);
  }
  
  return null;
}

// Extract budget from user message
export function extractBudgetFromMessage(message: string): number | null {
  const normalized = normalizeText(message);
  
  // Pattern: "ate X mil", "X mil", "X reais", "R$ X"
  const budgetPatterns = [
    /ate\s*(\d+)\s*mil/,
    /(\d+)\s*mil/,
    /(\d+)\s*reais/,
    /r\$\s*(\d+)/,
    /(\d{2,3})\.?(\d{3})/,  // 150.000 or 150000
  ];
  
  for (const pattern of budgetPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      if (match[2]) {
        // Full number like 150000
        return parseInt(match[1] + match[2], 10);
      }
      const value = parseInt(match[1], 10);
      if (value < 1000) {
        return value * 1000; // "150 mil" -> 150000
      }
      return value;
    }
  }
  
  return null;
}

// Extract category from user message
export function extractCategoryFromMessage(message: string): string | null {
  const normalized = normalizeText(message);
  
  if (normalized.includes('suv')) return 'SUV';
  if (normalized.includes('sedan') || normalized.includes('sendan') || normalized.includes('semdan')) return 'sedan';
  if (normalized.includes('hatch')) return 'hatch';
  if (normalized.includes('picape') || normalized.includes('pickup')) return 'pickup';
  
  return null;
}

// COLOR FIX: Extract car color from message
// Returns API format (uppercase) for direct use in query params
// FIX #15: Now context-aware - ignores colors in casual/narrative context
export function extractColorFromMessage(message: string): string | null {
  const normalized = normalizeText(message);
  const lowerMsg = message.toLowerCase();
  
  // FIX #15: Check if this is a generic query with casual context
  // Same logic as detectModel - if colors appear only in narrative context, ignore them
  const genericQueryPatterns = [
    /quais?\s+carros?\s+(?:voce|vc|tu)\s+tem/i,
    /(?:qual|quais|que)\s+(?:opcao|opcoes|carro|carros)/i,
    /tem\s+(?:carro|opcao|algum)/i,
    /entre\s+\d+\s*(?:mil|k|m)?\s*e\s*\d+/i,
    /ate\s+\d+\s*(?:mil|k|m)?/i,
    /quer\s+saber\s+quais/i
  ];
  
  const casualContextPatterns = [
    /(?:meu\s+)?(?:avo|tio|tia|prima?o?|vizinho|amigo|colega|pai|mae|irmao?|irma|avô|vovô|vovó)\s+(?:tem|tinha|anda|andava|possui|tem\s+um|tem\s+uma)/i,
    /(?:achou|encontrou|ganhou|herdou)\s+(?:um|uma|o|a)\s+/i,
    /(?:na\s+garagem|do\s+(?:meu\s+)?(?:falecido|finado))/i,
    /(?:ela|ele)\s+(?:tem|tinha|possui|anda)/i
  ];
  
  const isGenericQuery = genericQueryPatterns.some(p => p.test(lowerMsg));
  const hasCasualContext = casualContextPatterns.some(p => p.test(lowerMsg));
  
  if (isGenericQuery && hasCasualContext) {
    // Find colors and check if they appear AFTER the main query intent
    // e.g., "quais carros voce tem entre 30 e 40 mil?" - colors before this are casual
    const queryMatch = lowerMsg.match(/(?:quais?\s+carros|que\s+carros|tem\s+carro|entre\s+\d+.*\d+|ate\s+\d+)/i);
    if (queryMatch && queryMatch.index !== undefined) {
      const queryIdx = queryMatch.index;
      
      // Check each color - only extract if it appears AFTER the query intent
      for (const [keyword, apiColor] of Object.entries(CAR_COLORS)) {
        const colorMatch = normalized.match(new RegExp(`\\b${keyword}\\b`));
        if (colorMatch && colorMatch.index !== undefined) {
          const colorInNormalized = colorMatch.index;
          // Map normalized index to original message (approximate)
          const normalizedUpToColor = normalized.substring(0, colorInNormalized);
          const colorIdxInLower = lowerMsg.indexOf(keyword);
          
          // If color appears BEFORE the query intent, it's casual context - skip it
          if (colorIdxInLower < queryIdx) {
            console.log(`[INTENT] Skipping color ${apiColor}: appears before query intent (casual context)`);
            continue;
          }
          return apiColor;
        }
      }
      console.log(`[INTENT] Skipping color extraction: generic query with casual context`);
      return null;
    }
  }
  
  // Standard extraction for non-casual contexts
  for (const [keyword, apiColor] of Object.entries(CAR_COLORS)) {
    const wordBoundaryPattern = new RegExp(`\\b${keyword}\\b`);
    if (wordBoundaryPattern.test(normalized)) {
      return apiColor;
    }
  }
  
  return null;
}

// PHASE 2: Extract payment method from message
export function extractPaymentMethod(message: string): 'avista' | 'financiamento' | 'consorcio' | null {
  const normalized = normalizeText(message);
  
  // À vista patterns
  const avistaPatterns = [
    'a vista', 'avista', 'à vista',
    'pix', 'dinheiro', 'transferencia', 'ted', 'doc',
    'pagar tudo', 'valor total', 'sem parcelar'
  ];
  for (const pattern of avistaPatterns) {
    if (normalized.includes(pattern)) return 'avista';
  }
  
  // Financiamento patterns
  const financiamentoPatterns = [
    'financ', 'parcelar', 'parcela', 'prestacao', 'prestação',
    'banco', 'entrada', 'dar entrada', 'financiar'
  ];
  for (const pattern of financiamentoPatterns) {
    if (normalized.includes(pattern)) return 'financiamento';
  }
  
  // Consórcio patterns
  const consorcioPatterns = ['consorcio', 'consórcio', 'carta de credito', 'carta contemplada'];
  for (const pattern of consorcioPatterns) {
    if (normalized.includes(pattern)) return 'consorcio';
  }
  
  return null;
}

// PHASE 2: Extract trade-in intent from message
export function extractTradeIn(message: string): { hasTradeIn: boolean; model?: string } | null {
  const normalized = normalizeText(message);
  
  const tradeInPatterns = [
    'tenho um', 'tenho uma', 'meu carro', 'minha carro',
    'na troca', 'trocar', 'dar na troca', 'aceita troca',
    'tenho pra trocar', 'carro pra troca', 'usado na troca',
    'carro usado', 'vender o meu', 'retomar',
    // Third party / detailed possession
    'esposa tem', 'marido tem', 'ela tem', 'ele tem',
    'mae tem', 'pai tem', 'filho tem', 'filha tem',
    'gente tem', 'nos temos', 'nós temos',
    'dar de entrada', 'como entrada', 'entrada'
  ];
  
  for (const pattern of tradeInPatterns) {
    const patternIdx = normalized.indexOf(pattern);
    if (patternIdx !== -1) {
      // FIX #13: Look for model specifically AFTER the trade-in pattern first
      // This handles "wife has a renegade" vs "wants a tiggo"
      const afterPattern = message.substring(patternIdx + pattern.length);
      const contextualModel = extractCarModel(afterPattern);
      
      if (contextualModel) {
        return {
          hasTradeIn: true,
          model: contextualModel
        };
      }

      // Fallback: extract from full message if not found after pattern
      const modelMatch = extractCarModel(message);
      return { 
        hasTradeIn: true, 
        model: modelMatch || undefined 
      };
    }
  }
  
  return null;
}

// PHASE 2: Extract urgency from message
export function extractUrgency(message: string): 'hoje' | 'semana' | 'mes' | 'sem_pressa' | null {
  const normalized = normalizeText(message);
  
  // Hoje patterns
  const hojePatterns = [
    'hoje', 'agora', 'urgente', 'urgencia', 'ja', 'já',
    'o mais rapido', 'preciso logo', 'pra ontem'
  ];
  for (const pattern of hojePatterns) {
    if (normalized.includes(pattern)) return 'hoje';
  }
  
  // Semana patterns
  const semanaPatterns = [
    'semana', 'essa semana', 'esta semana', 'nos proximos dias',
    'poucos dias', 'em breve', 'logo'
  ];
  for (const pattern of semanaPatterns) {
    if (normalized.includes(pattern)) return 'semana';
  }
  
  // Mês patterns
  const mesPatterns = [
    'mes', 'mês', 'esse mes', 'proximo mes',
    'algumas semanas', 'um tempo'
  ];
  for (const pattern of mesPatterns) {
    if (normalized.includes(pattern)) return 'mes';
  }
  
  // Sem pressa patterns
  const semPressaPatterns = [
    'sem pressa', 'pesquisando', 'so olhando', 'só olhando',
    'nao tenho pressa', 'calma', 'ainda pensando', 'so curiosidade'
  ];
  for (const pattern of semPressaPatterns) {
    if (normalized.includes(pattern)) return 'sem_pressa';
  }
  
  return null;
}

// PHASE 3: Extract transmission from message
export function extractTransmission(message: string): 'manual' | 'automatico' | null {
  const normalized = normalizeText(message);
  
  if (normalized.includes('automatic') || normalized.includes('automátic')) return 'automatico';
  if (normalized.includes('manual') || normalized.includes('mecanic') || normalized.includes('mecânic')) return 'manual';
  
  return null;
}

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')  // Collapse spaces
    .trim();
}

export function isSafetyViolation(message: string): boolean {
  const normalized = normalizeText(message);
  return SAFETY_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

// NEW: Exit intent detection
export function isExitIntent(message: string): boolean {
  const normalized = normalizeText(message);
  return EXIT_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

// NEW: Negotiation intent (high intent = handoff)
export function isNegotiationIntent(message: string): boolean {
  // SYSTEM-GUARD: Ignorar mensagens de sistema (ex: "[ANÁLISE DE VEÍCULO...]")
  // Se for mensagem interna do sistema, não deve disparar handoff por keywords
  if (message.trim().startsWith('[') && message.includes(']')) {
    return false;
  }
  
  const normalized = normalizeText(message);
  return NEGOTIATION_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

// M2 FIX: Frustration detection - escalate frustrated users
export function isFrustrationIntent(message: string): boolean {
  const normalized = normalizeText(message);
  
  // Check frustration keywords
  const hasFrustrationKeyword = FRUSTRATION_KEYWORDS.some(keyword => 
    normalized.includes(normalizeText(keyword))
  );
  
  // Check CAPS ratio (more than 60% caps and at least 10 chars = frustrated)
  const capsCount = (message.match(/[A-Z]/g) || []).length;
  const letterCount = (message.match(/[a-zA-Z]/g) || []).length;
  const capsRatio = letterCount > 10 ? capsCount / letterCount : 0;
  const isCapsHeavy = capsRatio > 0.6;
  
  // Check excessive exclamation marks (3+)
  const exclamationCount = (message.match(/!/g) || []).length;
  const hasExcessiveExclamations = exclamationCount >= 3;
  
  return hasFrustrationKeyword || isCapsHeavy || hasExcessiveExclamations;
}

// NEW: Price/info inquiry (low intent = show stock)
export function isPriceInquiry(message: string): boolean {
  const normalized = normalizeText(message);
  return INFO_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

// CLI AUDIT FIX: Store info request (telefone, endereco, horario)
export function isInfoStoreRequest(message: string): boolean {
  const normalized = normalizeText(message);
  return INFO_STORE_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

// CLI AUDIT FIX: Out of scope (not related to cars)
export function isOutOfScope(message: string): boolean {
  const normalized = normalizeText(message);
  // Only trigger if out of scope keyword is present AND no car-related keywords
  const hasOutOfScope = OUT_OF_SCOPE_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
  const hasCarKeyword = CAR_MODELS_KNOWN.some(model => normalized.includes(normalizeText(model))) ||
    normalized.includes('carro') || normalized.includes('veiculo') || normalized.includes('automovel');
  return hasOutOfScope && !hasCarKeyword;
}

// GREETING FIX: Detect simple greetings for proper welcome
export function isGreeting(message: string): boolean {
  const normalized = normalizeText(message);
  // Must be a SHORT message (greeting only) - not "oi, quero um suv"
  if (normalized.length > 30) return false;
  return GREETING_KEYWORDS.some(keyword => normalized === keyword || normalized.startsWith(keyword + ' ') || normalized.endsWith(' ' + keyword));
}

// CONTEXT-FIX: Detect confirmations that should MAINTAIN context
// "Sim", "Quero", "Isso" after bot asks something = confirmation, NOT new conversation
export function isConfirmation(message: string): boolean {
  const normalized = normalizeText(message);
  // Must be SHORT (< 25 chars) to be a confirmation
  if (normalized.length > 25) return false;
  // Check if it matches any confirmation keyword
  return CONFIRMATION_KEYWORDS.some(keyword => 
    normalized === keyword || 
    normalized.startsWith(keyword + ' ') || 
    normalized.endsWith(' ' + keyword)
  );
}

export function isHandoffIntent(message: string, state: ConversationState): boolean {
  // Already in handoff mode - don't re-handoff
  if (state.handoff.mode === 'HUMAN') {
    return false;
  }
  
  return isNegotiationIntent(message);
}

export function isStockRequest(message: string): boolean {
  const normalized = normalizeText(message);
  
  // Check regex patterns first (more specific)
  if (SHOW_OPTIONS_PATTERNS.some(pattern => pattern.test(message))) {
    console.log('[ROUTER] SHOW_OPTIONS pattern matched');
    return true;
  }

  // FORCE-SEARCH: Se a mensagem contiver um budget, trate como intenção de busca
  // Ex: "Até 100 mil" -> isStockRequest = true
  // Isso resolve casos onde o bot reconhece o slot mas acha que é só conversa
  if (extractBudgetFromMessage(message)) {
    console.log('[ROUTER] Budget detected implies STOCK_REQUEST');
    return true;
  }
  
  return STOCK_REQUEST_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
}

export function isLowSignalResponse(message: string): boolean {
  const normalized = normalizeText(message);
  
  // Category responses are NOT low-signal
  if (['suv', 'sedan', 'hatch', 'pickup', 'picape'].includes(normalized)) {
    return false;
  }
  
  // City/state abbreviations are NOT low-signal
  if (['sp', 'rj', 'mg', 'rs', 'pr', 'sc', 'ba', 'pe', 'ce', 'df', 'go', 'pa', 'am', 'ma'].includes(normalized)) {
    return false;
  }
  
  // Very short responses (1-3 chars) are low signal
  if (normalized.length <= 3) return true;
  
  return LOW_SIGNAL_RESPONSES.some(keyword => 
    normalized === normalizeText(keyword) || normalized.startsWith(normalizeText(keyword))
  );
}

export function hasMinimumSlotsForStock(state: ConversationState): boolean {
  const { slots } = state;
  
  const hasBudget = !!slots.budget_max;
  const hasMakeModel = !!(slots.make || slots.model);
  const hasCategory = !!slots.category;
  const hasMotor = !!slots.motor;
  const hasYear = !!slots.year_min || !!slots.year_max;
  const hasColor = !!slots.cor;
  const hasPayment = !!slots.payment_method;
  const hasTradeIn = !!slots.has_trade_in;
  
  // QUALIFICATION-FIRST (Helena Flow):
  // 1. Modelo específico = pode buscar direto ("Quero um Corolla")
  // 2. Consultas genéricas = exigir 2+ slots antes de buscar
  
  if (hasMakeModel) {
    // Modelo específico: pode buscar diretamente
    return true;
  }
  
  // Consultas genéricas (budget, category, etc): exigir pelo menos 2 slots
  // Isso força o bot a perguntar antes de mostrar carros
  const genericSlots = [hasBudget, hasCategory, hasMotor, hasYear, hasColor, hasPayment, hasTradeIn];
  const filledSlots = genericSlots.filter(Boolean).length;
  
  // Precisa de 2+ slots genéricos para buscar
  return filledSlots >= 2;
}

export function getMissingSlot(state: ConversationState, askedSlots: string[] = []): string | null {
  const { slots } = state;
  
  // ANTI-REPETITION: Skip slots that were already asked
  const shouldAsk = (slotName: string): boolean => {
    return !askedSlots.includes(slotName);
  };
  
  // QUALIFICATION-FIRST: Perguntas essenciais antes de buscar estoque
  // Ordem de prioridade: categoria → budget → pagamento → transmissão
  
  // 1. Categoria (SUV, sedã, hatch, pickup) - pergunta fundamental
  if (!slots.category && !slots.make && !slots.model) {
    if (shouldAsk('category')) return 'category';
  }
  
  // 2. Budget - faixa de valor
  if (!slots.budget_max && !slots.model) {
    if (shouldAsk('budget_max')) return 'budget_max';
  }
  
  // 3. Forma de pagamento (à vista, financiamento, troca)
  if (!slots.payment_method) {
    if (shouldAsk('payment_method')) return 'payment_method';
  }
  
  // 4. Se tem troca, perguntar qual carro
  if (slots.payment_method === 'financiamento' || slots.has_trade_in) {
    if (!slots.trade_in_model && slots.has_trade_in) {
      if (shouldAsk('trade_in_model')) return 'trade_in_model';
    }
  }
  
  // 5. Motor/transmissão (opcional, só se não tiver outros)
  if (!slots.motor && !slots.category && !slots.model) {
    if (shouldAsk('motor')) return 'motor';
  }

  // 6. Transmissão (se não especificou)
  if (!slots.transmissao && !slots.model) {
    if (shouldAsk('transmissao')) return 'transmissao';
  }
  
  return null;
}

// =============================================================================
// MAIN ROUTER - v2 with correct priority order
// =============================================================================

/**
 * Route the message to the appropriate action
 * This executes BEFORE the LLM and the decision is final
 * 
 * Priority order (v2):
 * 0. SILENT (handoff.mode=HUMAN)
 * 1. Safety
 * 2. Exit intent
 * 3. Handoff (negotiation intent)
 * 4. Low signal (2+)
 * 5. Followup pending  <- MOVED UP
 * 6. Price inquiry (info, not negotiation)
 * 7. Stock API
 * 8. Slot collection
 * 9. Smalltalk
 */
export function routeMessage(
  userMessage: string,
  state: ConversationState,
  env?: Env
): RouterResult {
  
  // FIRST: Extract slots from user message and update state
  // REMOVED: extractedCity - API does not support city filter (single store in Esteio/RS)
  const extractedBudget = extractBudgetFromMessage(userMessage);
  const extractedCategory = extractCategoryFromMessage(userMessage);
  
  // FIX #9: Usar detectModel corrigida (prioriza carro de INTERESSE em cenários de troca)
  const intentResult = detectModel(userMessage.toLowerCase());
  const extractedModel = intentResult.modelo || null;
  
  const extractedMake = extractCarMake(userMessage, extractedModel);  // NER FIX

  const extractedYear = extractYear(userMessage);
  const extractedColor = extractColorFromMessage(userMessage);  // NER FIX
  // PHASE 2: New extractors
  const extractedPayment = extractPaymentMethod(userMessage);
  const extractedTradeIn = extractTradeIn(userMessage);
  const extractedUrgency = extractUrgency(userMessage);
  const extractedTransmission = extractTransmission(userMessage);
  
  // Build slot updates if any were extracted
  const extractedSlots: Partial<ConversationState['slots']> = {};
  // REMOVED: city_or_region extraction - not supported by API
  if (extractedBudget && !state.slots.budget_max) {
    extractedSlots.budget_max = extractedBudget;
  }
  if (extractedCategory && !state.slots.category) {
    extractedSlots.category = extractedCategory as 'SUV' | 'sedan' | 'hatch' | 'pickup';
  }
  // BUG-001 FIX: Extract and persist car model
  if (extractedModel && !state.slots.model) {
    extractedSlots.model = extractedModel;
  }
  // NER FIX: Extract and persist car make (inferred or direct)
  if (extractedMake && !state.slots.make) {
    extractedSlots.make = extractedMake;
    console.log(`[ROUTER] Extracted car make: ${extractedMake}`);
  }
  // NER FIX: Extract year (stored as string for now, can add to slots interface later)
  if (extractedYear) {
    console.log(`[ROUTER] Extracted year: ${extractedYear}`);
    // AUDIT FIX: Persist year to slots
    extractedSlots.year_min = extractedYear;
    extractedSlots.year_max = extractedYear;
    // Note: year slot may need to be added to ConversationState.slots interface
  }
  // COLOR FIX: Extract and persist car color
  if (extractedColor && !state.slots.cor) {
    extractedSlots.cor = extractedColor;
    console.log(`[ROUTER] Extracted car color: ${extractedColor}`);
  }
  // PHASE 2: Payment method extraction
  if (extractedPayment && !state.slots.payment_method) {
    extractedSlots.payment_method = extractedPayment;
    console.log(`[ROUTER] Extracted payment method: ${extractedPayment}`);
  }
  // PHASE 2: Trade-in extraction
  if (extractedTradeIn && !state.slots.has_trade_in) {
    extractedSlots.has_trade_in = extractedTradeIn.hasTradeIn;
    if (extractedTradeIn.model) {
      extractedSlots.trade_in_model = extractedTradeIn.model;
    }
    console.log(`[ROUTER] Extracted trade-in: ${extractedTradeIn.hasTradeIn}`);
  }
  // PHASE 2: Urgency extraction
  if (extractedUrgency && !state.slots.urgency) {
    extractedSlots.urgency = extractedUrgency;
    console.log(`[ROUTER] Extracted urgency: ${extractedUrgency}`);
  }
  // PHASE 3: Transmission extraction
  if (extractedTransmission && !state.slots.transmissao) {
    extractedSlots.transmissao = extractedTransmission;
    console.log(`[ROUTER] Extracted transmission: ${extractedTransmission}`);
  }
  
  // Apply extracted slots to state for routing decisions
  const updatedState: ConversationState = Object.keys(extractedSlots).length > 0
    ? { ...state, slots: { ...state.slots, ...extractedSlots } }
    : state;
  
  // Build base state_update to include in all results
  const hasSlotUpdates = Object.keys(extractedSlots).length > 0;
  const isLowSignal = isLowSignalResponse(userMessage);
  
  const baseStateUpdate: Partial<ConversationState> | undefined = 
    hasSlotUpdates || isLowSignal
      ? {
          ...(hasSlotUpdates ? { slots: { ...state.slots, ...extractedSlots } } : {}),
          ...(isLowSignal ? { low_signal_count: state.low_signal_count + 1 } : {})
        }
      : undefined;
  
  // Priority 0: HUMAN MODE - Bot silences
  if (state.handoff.mode === 'HUMAN') {
    return {
      action: 'SILENT',
      reason: 'Handoff active - bot does not respond'
    };
  }
  
  // Priority 1: Safety
  if (isSafetyViolation(userMessage)) {
    return {
      action: 'SAFE_REFUSAL',
      reason: 'Safety violation detected'
    };
  }
  
  // Priority 2: Exit intent
  if (isExitIntent(userMessage)) {
    return {
      action: 'EXIT',
      reason: 'User expressed exit intent',
      state_update: {
        do_not_contact: true,
        pending_actions: state.pending_actions.map(a => ({
          ...a,
          status: a.status === 'OPEN' ? 'CANCELLED' as const : a.status
        }))
      }
    };
  }
  

  
  // CLI AUDIT FIX - Priority 2.7: Out of scope (not related to cars)
  if (isOutOfScope(userMessage)) {
    return {
      action: 'OUT_OF_SCOPE',
      reason: 'Message not related to vehicles - politely redirect',
      state_update: baseStateUpdate
    };
  }
  
  // GREETING FIX - Priority 2.8: Simple greetings get proper welcome (not qualification)
  if (isGreeting(userMessage)) {
    return {
      action: 'SMALLTALK',
      reason: 'Simple greeting - respond with welcome message',
      state_update: baseStateUpdate
    };
  }
  
  // CONTEXT-FIX - Priority 2.9: Confirmations maintain context (don't reset to "Como posso ajudar?")
  // Only triggers if: 1) message is confirmation, 2) has previous context (cars shown or slots)
  if (isConfirmation(userMessage)) {
    const hasContext = state.cars_shown.length > 0 || Object.keys(state.slots).length > 0;
    if (hasContext) {
      return {
        action: 'CONFIRM_CONTEXT',
        reason: 'User confirmed - continue with previous context',
        state_update: baseStateUpdate
      };
    }
    // If no context and confirmation, treat as low-signal to ask clarification
  }
  
  // Priority 3A: Frustration detection (M2 FIX) - escalate frustrated users
  if (isFrustrationIntent(userMessage)) {
    return {
      action: 'HANDOFF_SELLER',
      reason: 'User frustrated - escalating to human',
      tool_to_call: 'encaminhaVendedores',
      // M1 FIX: Include extracted slots in handoff
      state_update: baseStateUpdate
    };
  }
  
  // Priority 3B: Handoff (NEGOTIATION HAS PRIORITY - even if price is mentioned)
  // "qual o preço e as parcelas?" → HANDOFF (porque tem "parcelas")
  if (isNegotiationIntent(userMessage)) {
    return {
      action: 'HANDOFF_SELLER',
      reason: 'User expressed negotiation intent',
      tool_to_call: 'encaminhaVendedores',
      // M1 FIX: Include extracted slots in handoff
      state_update: baseStateUpdate
    };
  }
  
  // CLI AUDIT FIX - Priority 3.5: Store info request (moved after Handoff)
  if (isInfoStoreRequest(userMessage)) {
    return {
      action: 'INFO_STORE',
      reason: 'User asking for store information (phone, address, hours)',
      state_update: baseStateUpdate
    };
  }

  // Priority 4: Low signal after direct question (2+ times)
  if (isLowSignalResponse(userMessage)) {
    const newCount = state.low_signal_count + 1;
    if (newCount >= 2) {
      return {
        action: 'HANDOFF_SELLER',
        reason: '2+ low-signal responses - escalating to human',
        tool_to_call: 'encaminhaVendedores',
        state_update: { low_signal_count: newCount }
      };
    }
    // Return with state update even if not handoff yet
    // This will be applied by caller
  }
  
  // Priority 5: Follow-up pending (MOVED UP from Priority 4)
  if (state.has_pending_followup) {
    return {
      action: 'FOLLOWUP',
      reason: 'Pending follow-up for this lead',
      tool_to_call: 'scheduleFollowUp'
    };
  }
  
  // Priority 6: Price inquiry (info intent, not negotiation)
  if (isPriceInquiry(userMessage)) {
    if (hasMinimumSlotsForStock(updatedState)) {
      return {
        action: 'CALL_STOCK_API',
        reason: 'Price inquiry with minimum slots - showing options',
        tool_to_call: 'chamaApiCarros',
        state_update: baseStateUpdate
      };
    } else {
      const missingSlot = getMissingSlot(updatedState);
      return {
        action: 'ASK_ONE_QUESTION',
        reason: `Price inquiry but missing slot: ${missingSlot}`,
        missing_slot: missingSlot || undefined,
        state_update: baseStateUpdate
      };
    }
  }
  
  // Priority 7: Stock API (explicit request)
  if (isStockRequest(userMessage) || hasMinimumSlotsForStock(updatedState)) {
    if (hasMinimumSlotsForStock(updatedState)) {
      return {
        action: 'CALL_STOCK_API',
        reason: 'Stock request with minimum slots fulfilled',
        tool_to_call: 'chamaApiCarros',
        state_update: baseStateUpdate
      };
    } else {
      const missingSlot = getMissingSlot(updatedState);
      return {
        action: 'ASK_ONE_QUESTION',
        reason: `Stock request but missing slot: ${missingSlot}`,
        missing_slot: missingSlot || undefined,
        state_update: baseStateUpdate
      };
    }
  }
  
  // Priority 8: Slot collection needed
  const missingSlot = getMissingSlot(updatedState);
  if (missingSlot) {
    return {
      action: 'ASK_ONE_QUESTION',
      reason: `Need to collect slot: ${missingSlot}`,
      missing_slot: missingSlot,
      state_update: baseStateUpdate
    };
  }
  
  // Priority 9: Default - smalltalk/engagement
  return {
    action: 'SMALLTALK',
    reason: 'No specific intent detected, engaging in conversation',
    state_update: baseStateUpdate
  };
}

// =============================================================================
// STATE HELPERS
// =============================================================================

export function createInitialState(phone: string, leadId?: string): ConversationState {
  return {
    lead_id: leadId,
    phone,
    stage: 'curioso',
    intent: 'idle',
    handoff: { mode: 'BOT' },
    slots: {},
    cars_shown: [],
    pending_actions: [],
    low_signal_count: 0,
    do_not_contact: false
  };
}

export function updateStateFromContext(
  state: ConversationState, 
  context: Record<string, any>
): ConversationState {
  return {
    ...state,
    slots: {
      ...state.slots,
      city_or_region: context.city || context.location || state.slots.city_or_region,
      budget_max: context.budget || context.price || state.slots.budget_max,
      category: context.category || state.slots.category,
      make: context.make || context.marca || state.slots.make,
      model: context.model || context.modelo || state.slots.model,
      payment_method: context.paymentMethod || state.slots.payment_method,
      has_trade_in: context.hasTradeIn || state.slots.has_trade_in,
      urgency: context.urgency || state.slots.urgency,
      transmissao: context.transmission || context.transmissao || state.slots.transmissao,
    },
    handoff: context.handoff || state.handoff,
    cars_shown: context.carsShown || state.cars_shown,
  };
}

/**
 * Apply state updates from router result
 */
export function applyStateUpdate(
  state: ConversationState,
  update: Partial<ConversationState> | undefined
): ConversationState {
  if (!update) return state;
  return { ...state, ...update };
}

// =============================================================================
// LOGGING
// =============================================================================

export function logRouterDecision(result: RouterResult, message: string): void {
  console.log(`[ROUTER] Action: ${result.action}`);
  console.log(`[ROUTER] Reason: ${result.reason}`);
  if (result.tool_to_call) {
    console.log(`[ROUTER] Tool: ${result.tool_to_call}`);
  }
  if (result.missing_slot) {
    console.log(`[ROUTER] Missing slot: ${result.missing_slot}`);
  }
  if (result.state_update) {
    console.log(`[ROUTER] State update:`, result.state_update);
  }
}
