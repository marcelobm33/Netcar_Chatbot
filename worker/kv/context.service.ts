/**
 * Context Service - Professional Memory Lane System
 * 
 * 3-Tier Memory Architecture:
 * 🔴 Working Memory (KV - 10min TTL): Current turn state, pending actions
 * 🟡 Short-Term Memory (KV - 24h TTL): Session context, cars shown, qualification
 * 🟢 Long-Term Memory (D1 - Permanent): LLM summaries, lead profile
 */

import type { Env, CarData } from '../types';
import { getFromKV, setInKV, deleteFromKV } from './cache.service';

// ==================== INTERFACES ====================

/**
 * Car identified from image via Vision API
 */
interface IdentifiedCar {
  modelo: string;
  marca?: string;
  timestamp: string;
}

/**
 * Car that was shown to user
 */
interface ShownCar {
  id: string;
  modelo: string;
  marca: string;
  preco?: string;
  timestamp: string;
}

/**
 * Pending action (bot promised something but hasn't done it yet)
 */
interface PendingAction {
  type: 'search' | 'handoff' | 'compare';
  params: {
    modelo?: string;
    marca?: string;
    filters?: Record<string, any>;
  };
  createdAt: string;
  consumed: boolean;
}

/**
 * User qualification data (Pre-Handoff Enrichment)
 * Aligned with Prompt V4 Spec Section 3.2
 */
interface Qualification {
  // Trade-in
  hasTradeIn?: boolean;
  tradeInModel?: string;
  
  // Payment
  paymentMethod?: 'avista' | 'financiamento' | 'consorcio' | 'indefinido';
  downPayment?: number;
  
  // Vehicle preferences
  cityOrRegion?: string;
  category?: 'SUV' | 'sedan' | 'hatch' | 'pickup';
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  budgetMax?: number;
  
  // Lead tracking
  urgency?: 'hoje' | 'semana' | 'mes' | 'sem_pressa' | 'indefinido';
  stage?: 'curioso' | 'comparando' | 'objecao' | 'pronto';
  lowSignalCount?: number;
  
  // Timestamps
  askedAt?: {
    tradeIn?: string;
    payment?: string;
    urgency?: string;
    budget?: string;
    city?: string;
  };
}

/**
 * Full Conversation Context
 * Combines Working Memory + Short-Term Memory
 */
export interface ConversationContext {
  // === Working Memory (10min TTL) ===
  currentIntent: 'browse' | 'compare' | 'negotiate' | 'visit' | 'idle' | 'followup_response';
  pendingActions: PendingAction[];
  lastMessageAt: string;
  
  // === Short-Term Memory (24h TTL) ===
  carsShown: ShownCar[];
  carsFromImages: IdentifiedCar[];
  lastSearch: {
    filters: Record<string, any>;
    resultCount: number;
    timestamp: string;
  } | null;
  sellerHandoff: {
    done: boolean;
    at?: string;
    vendedorId?: number;
  };
  qualification: Qualification;
  
  // === ANTI-REPETITION (FIX for robotic responses) ===
  lastBotMessage?: {
    text: string;
    sentAt: string;
  };
  lastBotQuestion?: {
    text: string;
    askedAt: string;
    wasAnswered: boolean;
  };
  /** Últimas respostas do bot para anti-repetição */
  lastBotResponses?: Array<{
    text: string;
    hash: string;
    at: string;
  }>;
  
  // === PASSIVE MODE (Post-Handover) ===
  /** Data/hora até quando o bot deve ficar em modo passivo após handover */
  passiveModeUntil?: string | null;
  
  // === ENTITIES (Planner extracted) ===
  entities?: {
    /** Carro do cliente para troca */
    user_car?: {
      marca?: string;
      modelo?: string;
      ano?: number;
      km?: number;      // Quilometragem do carro do cliente
      cor?: string;     // Cor do carro do cliente
    };
    /** Carro de interesse */
    interest_car?: {
      categoria?: string;
      marca?: string;
      modelo?: string;
      preco_max?: number;
    };
  };
  
  // === Long-Term Reference (from D1) ===
  leadSummary?: string;
  leadId?: string;
  userName?: string;
  
  // === Metadata ===
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ==================== CONSTANTS ====================

const KV_PREFIX_CONTEXT = 'ctx:';
const TTL_WORKING_MEMORY = 600;      // 10 minutes
const TTL_SHORT_TERM = 5184000;      // 60 days (was 24 hours)
const MAX_CARS_SHOWN = 20;           // FIFO limit
const MAX_CARS_FROM_IMAGES = 10;     // FIFO limit
const MAX_PENDING_ACTIONS = 5;       // FIFO limit

// ==================== FIX #3: IN-MEMORY CACHE ====================
// Prevents multiple KV MISS and race condition when creating context
// Cache TTL: 60 seconds (short enough to not cause stale data issues)

const CONTEXT_CACHE = new Map<string, { ctx: ConversationContext; cachedAt: number }>();
const CONTEXT_CREATION_LOCK = new Map<string, Promise<ConversationContext>>();
const CACHE_TTL_MS = 60000; // 60 seconds

/**
 * Get context from in-memory cache (avoids multiple KV calls)
 */
function getCachedContext(telefone: string): ConversationContext | null {
  const cached = CONTEXT_CACHE.get(telefone);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.ctx;
  }
  // Expired or not found
  if (cached) {
    CONTEXT_CACHE.delete(telefone);
  }
  return null;
}

/**
 * Set context in in-memory cache
 */
function setCachedContext(telefone: string, ctx: ConversationContext): void {
  CONTEXT_CACHE.set(telefone, { ctx, cachedAt: Date.now() });
  
  // Prevent memory leak: limit cache size to 100 entries
  if (CONTEXT_CACHE.size > 100) {
    const oldest = CONTEXT_CACHE.keys().next().value;
    if (oldest) CONTEXT_CACHE.delete(oldest);
  }
}

/**
 * Invalidate context cache (call after updateContext)
 */
function invalidateCachedContext(telefone: string): void {
  CONTEXT_CACHE.delete(telefone);
}

// ==================== CORE FUNCTIONS ====================

/**
 * Get conversation context for a user
 * FIX #3: Uses in-memory cache to prevent multiple KV MISS and race conditions
 * Loads from KV (short-term) and optionally enriches with D1 summary (long-term)
 */
export async function getContext(
  telefone: string,
  env: Env,
  includeLongTerm: boolean = true
): Promise<ConversationContext> {
  const telefoneClean = cleanPhone(telefone);
  const key = `${KV_PREFIX_CONTEXT}${telefoneClean}`;
  
  // FIX #3: Check in-memory cache first (avoids multiple KV calls)
  const cached = getCachedContext(telefoneClean);
  if (cached) {
    console.log(`[CONTEXT] Cache HIT for ${telefoneClean} (v${cached.version})`);
    return cached;
  }
  
  // FIX #3: Check if another parallel call is already creating context
  // This prevents race condition where multiple MISS create multiple contexts
  const pendingCreation = CONTEXT_CREATION_LOCK.get(telefoneClean);
  if (pendingCreation) {
    console.log(`[CONTEXT] Waiting for pending context creation for ${telefoneClean}`);
    return pendingCreation;
  }
  
  // FIX #3: Create a lock to prevent parallel context creation
  const creationPromise = (async () => {
    try {
      // Try to load existing context from KV
      const existing = await getFromKV<ConversationContext>(env, key);
      
      if (existing) {
        console.log(`[CONTEXT] Loaded context for ${telefoneClean} (v${existing.version})`);
        
        // Optionally load long-term summary from D1
        if (includeLongTerm && !existing.leadSummary) {
          const summary = await getLeadSummaryFromD1(telefoneClean, env);
          if (summary) {
            existing.leadSummary = summary;
          }
        }
        
        // FIX #3: Save to cache for future calls
        setCachedContext(telefoneClean, existing);
        return existing;
      }
      
      // Create fresh context
      console.log(`[CONTEXT] Creating new context for ${telefoneClean}`);
      const fresh = createFreshContext();
      setCachedContext(telefoneClean, fresh);
      return fresh;
    } finally {
      // FIX #3: Release lock after creation
      CONTEXT_CREATION_LOCK.delete(telefoneClean);
    }
  })();
  
  // FIX #3: Store the promise so parallel calls can wait
  CONTEXT_CREATION_LOCK.set(telefoneClean, creationPromise);
  
  return creationPromise;
}

/**
 * Update conversation context (partial update, merges with existing)
 * FIX #3: Updates in-memory cache after saving to KV
 */
export async function updateContext(
  telefone: string,
  updates: Partial<ConversationContext>,
  env: Env
): Promise<ConversationContext> {
  const telefoneClean = cleanPhone(telefone);
  const key = `${KV_PREFIX_CONTEXT}${telefoneClean}`;
  
  // Get existing or create fresh
  const existing = await getContext(telefone, env, false);
  
  // Merge updates
  const updated: ConversationContext = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    version: existing.version + 1,
  };
  
  // Apply FIFO limits
  if (updated.carsShown.length > MAX_CARS_SHOWN) {
    updated.carsShown = updated.carsShown.slice(-MAX_CARS_SHOWN);
  }
  if (updated.carsFromImages.length > MAX_CARS_FROM_IMAGES) {
    updated.carsFromImages = updated.carsFromImages.slice(-MAX_CARS_FROM_IMAGES);
  }
  if (updated.pendingActions.length > MAX_PENDING_ACTIONS) {
    updated.pendingActions = updated.pendingActions.slice(-MAX_PENDING_ACTIONS);
  }
  
  // Save to KV with 24h TTL
  await setInKV(env, key, updated, TTL_SHORT_TERM);
  
  // FIX #3: Update in-memory cache to keep it in sync
  setCachedContext(telefoneClean, updated);
  
  console.log(`[CONTEXT] Updated context for ${telefoneClean} (v${updated.version})`);
  
  return updated;
}

/**
 * Clear context for a user (useful for testing or "new conversation")
 */
export async function clearContext(telefone: string, env: Env): Promise<void> {
  const telefoneClean = cleanPhone(telefone);
  const key = `${KV_PREFIX_CONTEXT}${telefoneClean}`;
  await deleteFromKV(env, key);
  console.log(`[CONTEXT] Cleared context for ${telefoneClean}`);
}

// ==================== CAR TRACKING ====================

/**
 * Add a car identified from an image (Vision API)
 * These are cars the user sent photos of and wants to see in stock
 */
export async function addCarFromImage(
  telefone: string,
  car: { modelo: string; marca?: string },
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  
  // Avoid duplicates (same model within last 5 minutes)
  const recentCutoff = Date.now() - 5 * 60 * 1000;
  const isDuplicate = ctx.carsFromImages.some(c => 
    c.modelo.toLowerCase() === car.modelo.toLowerCase() &&
    new Date(c.timestamp).getTime() > recentCutoff
  );
  
  if (isDuplicate) {
    console.log(`[CONTEXT] Skipping duplicate image car: ${car.modelo}`);
    return;
  }
  
  ctx.carsFromImages.push({
    modelo: car.modelo,
    marca: car.marca,
    timestamp: new Date().toISOString(),
  });
  
  console.log(`[CONTEXT] Added car from image: ${car.marca || ''} ${car.modelo}`);
  await updateContext(telefone, { carsFromImages: ctx.carsFromImages }, env);
}

/**
 * Add cars that were shown to the user
 */
export async function addCarsShown(
  telefone: string,
  cars: CarData[],
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  
  const newShown: ShownCar[] = cars.map(car => ({
    id: car.id,
    modelo: car.modelo,
    marca: car.marca,
    preco: car.preco,
    timestamp: new Date().toISOString(),
  }));
  
  ctx.carsShown = [...ctx.carsShown, ...newShown];
  
  console.log(`[CONTEXT] Added ${cars.length} cars shown to ${cleanPhone(telefone)}`);
  await updateContext(telefone, { carsShown: ctx.carsShown }, env);
}

/**
 * Get cars from images that haven't been searched yet
 */
export async function getPendingImageCars(
  telefone: string,
  env: Env
): Promise<IdentifiedCar[]> {
  const ctx = await getContext(telefone, env, false);
  
  // FIX: Validate arrays exist before calling .map() to prevent TypeError
  const carsShown = ctx.carsShown || [];
  const carsFromImages = ctx.carsFromImages || [];
  
  // Filter out cars that were already shown (by model name match)
  const shownModels = new Set(carsShown.map(c => c.modelo.toLowerCase()));
  
  return carsFromImages.filter(c => 
    !shownModels.has(c.modelo.toLowerCase())
  );
}

// ==================== PENDING ACTIONS ====================

/**
 * Add a pending action (bot promised to do something)
 * E.g., "Vou buscar esse modelo pra ti" → pendingAction: {type: 'search', params: {modelo}}
 */
export async function addPendingAction(
  telefone: string,
  action: Omit<PendingAction, 'createdAt' | 'consumed'>,
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  
  ctx.pendingActions.push({
    ...action,
    createdAt: new Date().toISOString(),
    consumed: false,
  });
  
  console.log(`[CONTEXT] Added pending action: ${action.type} for ${cleanPhone(telefone)}`);
  await updateContext(telefone, { pendingActions: ctx.pendingActions }, env);
}

/**
 * Get unconsumed pending actions of a specific type
 */
export async function getPendingActions(
  telefone: string,
  type: PendingAction['type'],
  env: Env
): Promise<PendingAction[]> {
  const ctx = await getContext(telefone, env, false);
  return ctx.pendingActions.filter(a => a.type === type && !a.consumed);
}

/**
 * Consume (mark as done) pending actions of a type
 */
export async function consumePendingActions(
  telefone: string,
  type: PendingAction['type'],
  env: Env
): Promise<number> {
  const ctx = await getContext(telefone, env, false);
  
  let consumed = 0;
  ctx.pendingActions = ctx.pendingActions.map(a => {
    if (a.type === type && !a.consumed) {
      consumed++;
      return { ...a, consumed: true };
    }
    return a;
  });
  
  if (consumed > 0) {
    console.log(`[CONTEXT] Consumed ${consumed} pending ${type} actions`);
    await updateContext(telefone, { pendingActions: ctx.pendingActions }, env);
  }
  
  return consumed;
}

// ==================== QUALIFICATION ====================

/**
 * Update qualification data (Pre-Handoff Enrichment)
 */
export async function updateQualification(
  telefone: string,
  qual: Partial<Qualification>,
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  
  ctx.qualification = {
    ...ctx.qualification,
    ...qual,
    askedAt: {
      ...ctx.qualification.askedAt,
      ...(qual.hasTradeIn !== undefined ? { tradeIn: new Date().toISOString() } : {}),
      ...(qual.paymentMethod !== undefined ? { payment: new Date().toISOString() } : {}),
      ...(qual.urgency !== undefined ? { urgency: new Date().toISOString() } : {}),
    },
  };
  
  console.log(`[CONTEXT] Updated qualification for ${cleanPhone(telefone)}`);
  await updateContext(telefone, { qualification: ctx.qualification }, env);
}

// ==================== SEARCH TRACKING ====================

/**
 * Record a search that was performed
 */
export async function recordSearch(
  telefone: string,
  filters: Record<string, any>,
  resultCount: number,
  env: Env
): Promise<void> {
  await updateContext(telefone, {
    lastSearch: {
      filters,
      resultCount,
      timestamp: new Date().toISOString(),
    },
  }, env);
  console.log(`[CONTEXT] Recorded search: ${JSON.stringify(filters)} → ${resultCount} results`);
}

// ==================== SELLER HANDOFF ====================

/**
 * Record seller handoff
 */
export async function recordHandoff(
  telefone: string,
  vendedorId?: number,
  env?: Env
): Promise<void> {
  if (!env) return;
  
  await updateContext(telefone, {
    sellerHandoff: {
      done: true,
      at: new Date().toISOString(),
      vendedorId,
    },
  }, env);
  console.log(`[CONTEXT] Recorded handoff for ${cleanPhone(telefone)}`);
}

/**
 * Check if handoff was already done
 */
export async function wasHandoffDone(telefone: string, env: Env): Promise<boolean> {
  const ctx = await getContext(telefone, env, false);
  return ctx.sellerHandoff?.done ?? false;
}

// ==================== ANTI-REPETITION FUNCTIONS ====================

/**
 * Save the last bot message (for anti-repetition)
 */
export async function saveBotMessage(
  telefone: string,
  message: string,
  env: Env
): Promise<void> {
  await updateContext(telefone, {
    lastBotMessage: {
      text: message,
      sentAt: new Date().toISOString(),
    },
  }, env);
  console.log(`[ANTI-REP] Saved last bot message for ${cleanPhone(telefone)}`);
}

/**
 * Save the last bot question (for context tracking)
 */
export async function saveBotQuestion(
  telefone: string,
  question: string,
  env: Env
): Promise<void> {
  await updateContext(telefone, {
    lastBotQuestion: {
      text: question,
      askedAt: new Date().toISOString(),
      wasAnswered: false,
    },
  }, env);
  console.log(`[ANTI-REP] Saved last bot question for ${cleanPhone(telefone)}`);
}

/**
 * Mark the last question as answered
 */
export async function markQuestionAnswered(
  telefone: string,
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  if (ctx.lastBotQuestion && !ctx.lastBotQuestion.wasAnswered) {
    await updateContext(telefone, {
      lastBotQuestion: {
        ...ctx.lastBotQuestion,
        wasAnswered: true,
      },
    }, env);
    console.log(`[ANTI-REP] Marked question as answered for ${cleanPhone(telefone)}`);
  }
}

/**
 * Check if a response is too similar to the last bot message
 * Uses simple word overlap (Jaccard similarity)
 */
export function isSimilarToLastResponse(
  newResponse: string,
  lastMessage: string | undefined,
  threshold: number = 0.7
): boolean {
  if (!lastMessage) return false;
  
  // Normalize and tokenize
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[!?.,;:()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  const newWords = new Set(normalize(newResponse));
  const lastWords = new Set(normalize(lastMessage));
  
  if (newWords.size === 0 || lastWords.size === 0) return false;
  
  // Calculate Jaccard similarity
  const intersection = [...newWords].filter(w => lastWords.has(w)).length;
  const union = new Set([...newWords, ...lastWords]).size;
  const similarity = intersection / union;
  
  console.log(`[ANTI-REP] Similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${threshold * 100}%)`);
  
  return similarity >= threshold;
}

// ==================== LONG-TERM MEMORY (D1) ====================

/**
 * Get lead summary from D1 (Long-Term Memory)
 */
async function getLeadSummaryFromD1(telefone: string, env: Env): Promise<string | null> {
  try {
    const result = await env.DB.prepare(`
      SELECT summary FROM conversation_summaries 
      WHERE lead_id = (SELECT id FROM leads WHERE telefone = ?)
      ORDER BY created_at DESC 
      LIMIT 1
    `).bind(telefone).first<{ summary: string }>();
    
    return result?.summary || null;
  } catch (e) {
    // Table might not exist yet
    console.log(`[CONTEXT] No summary table or no summary for ${telefone}`);
    return null;
  }
}

/**
 * Save summary to D1 (called by cron job after LLM summarization)
 */
export async function saveSummaryToD1(
  leadId: string,
  summary: string,
  carsDiscussed: string[],
  qualification: Qualification,
  messageRange: string,
  env: Env
): Promise<void> {
  try {
    // FIX: Sanitize ALL parameters - D1 doesn't support undefined values in bindings
    const safeLeadId = leadId ?? '';
    const safeSummary = summary ?? '';
    const safeCarsDiscussed = carsDiscussed ?? [];
    const safeMessageRange = messageRange ?? '';
    
    // Remove undefined values from qualification object
    const sanitizedQualification = qualification 
      ? Object.fromEntries(Object.entries(qualification).filter(([_, v]) => v !== undefined))
      : {};
    
    // Skip if leadId is empty (invalid state)
    if (!safeLeadId) {
      console.warn(`[CONTEXT] Skipping save summary: empty leadId`);
      return;
    }
    
    await env.DB.prepare(`
      INSERT INTO conversation_summaries (lead_id, summary, cars_discussed, qualification, message_range)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      safeLeadId,
      safeSummary,
      JSON.stringify(safeCarsDiscussed),
      JSON.stringify(sanitizedQualification),
      safeMessageRange
    ).run();
    
    console.log(`[CONTEXT] Saved summary to D1 for lead ${leadId}`);
  } catch (e) {
    console.error(`[CONTEXT] Failed to save summary:`, e);
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Clean phone number (remove WhatsApp suffixes)
 */
function cleanPhone(telefone: string): string {
  return telefone
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace(/\D/g, '');
}

/**
 * Create fresh context object
 */
function createFreshContext(): ConversationContext {
  const now = new Date().toISOString();
  return {
    currentIntent: 'idle',
    pendingActions: [],
    lastMessageAt: now,
    carsShown: [],
    carsFromImages: [],
    lastSearch: null,
    sellerHandoff: { done: false },
    qualification: {},
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

// ==================== CONTEXT INJECTION FOR AI ====================

/**
 * Generate context summary for AI prompt injection
 * This is the key function that tells the AI what it knows about the user
 */
export function generateContextSummary(ctx: ConversationContext): string {
  const lines: string[] = [];
  
  // Defensive: ensure arrays and objects exist
  const carsShown = ctx.carsShown || [];
  const carsFromImages = ctx.carsFromImages || [];
  const pendingActions = ctx.pendingActions || [];
  const qualification = ctx.qualification || {};
  
  // Cars shown in this session - with LAST car highlighted
  if (carsShown.length > 0) {
    const recentCars = carsShown.slice(-5);
    const lastCar = recentCars[recentCars.length - 1];
    
    // Highlight the LAST car shown (user might refer to "esse", "este aqui")
    lines.push(`[ÚLTIMO CARRO MOSTRADO] ${lastCar.marca} ${lastCar.modelo}${lastCar.preco ? ` - ${lastCar.preco}` : ''} (ID: ${lastCar.id})`);
    
    // List all recent cars
    if (recentCars.length > 1) {
      const otherCars = recentCars.slice(0, -1);
      lines.push(`[OUTROS CARROS RECENTES] ${otherCars.map(c => `${c.marca} ${c.modelo}${c.preco ? ` (${c.preco})` : ''}`).join(', ')}`);
    }
  }
  
  // Cars from images (pending search)
  const pendingImageCars = carsFromImages.filter(c => 
    !carsShown.some(s => s.modelo.toLowerCase() === c.modelo.toLowerCase())
  );
  if (pendingImageCars.length > 0) {
    lines.push(`[CARROS IDENTIFICADOS POR IMAGEM, AGUARDANDO BUSCA] ${pendingImageCars.map(c => `${c.marca || ''} ${c.modelo}`).join(', ')}`);
  }
  
  // Pending actions
  const pendingSearches = pendingActions.filter(a => a.type === 'search' && !a.consumed);
  if (pendingSearches.length > 0) {
    lines.push(`[AÇÃO PENDENTE] Você prometeu buscar: ${pendingSearches.map(a => a.params.modelo || a.params.marca).join(', ')}`);
  }
  
  // Qualification data (using safe reference)
  if (qualification.hasTradeIn !== undefined) {
    lines.push(`[TROCA] ${qualification.hasTradeIn ? `Tem carro para troca${qualification.tradeInModel ? `: ${qualification.tradeInModel}` : ''}` : 'Não tem troca'}`);
  }
  if (qualification.paymentMethod) {
    const methods: Record<string, string> = {
      cash: 'À vista',
      financing: 'Financiamento',
      trade: 'Troca',
      unknown: 'Não definido',
    };
    lines.push(`[PAGAMENTO] ${methods[qualification.paymentMethod || 'unknown']}`);
  }
  if (ctx.qualification && ctx.qualification.urgency) {
    const urgencies: Record<string, string> = {
      high: 'Alta (quer comprar agora)',
      medium: 'Média (próximas semanas)',
      low: 'Baixa (apenas pesquisando)',
    };
    lines.push(`[URGÊNCIA] ${urgencies[ctx.qualification.urgency]}`);
  }
  
  // Seller handoff
  if (ctx.sellerHandoff?.done) {
    lines.push(`[VENDEDOR] Já foi encaminhado em ${ctx.sellerHandoff.at}`);
  }
  
  // Long-term summary
  if (ctx.leadSummary) {
    lines.push(`[RESUMO DO CLIENTE] ${ctx.leadSummary}`);
  }
  
  if (lines.length === 0) {
    return '';
  }
  
  return `\n\n📌 CONTEXTO DA CONVERSA (Memória):\n${lines.join('\n')}`;
}

// ==================== LLM SUMMARIZATION (CRON JOB) ====================

const SUMMARIZATION_PROMPT = `Você é um assistente especializado em resumir conversas de vendas de carros.

Analise a conversa abaixo e crie um RESUMO CONCISO do perfil do cliente, incluindo:
- Preferências de veículos (modelos, marcas, faixa de preço)
- Situação financeira (tem troca? entrada? financiamento?)
- Nível de interesse/urgência
- Pontos importantes para o próximo atendimento

REGRAS:
- Máximo 3 frases
- Foco em informações ACIONÁVEIS para o vendedor
- Ignore saudações e mensagens genéricas
- Use linguagem profissional e objetiva

CONVERSA:
`;

/**
 * Summarize conversation using LLM
 */
export async function summarizeConversation(
  messages: Array<{ role: string; content: string }>,
  env: Env
): Promise<string> {
  const conversationText = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CLIENTE' : 'BOT'}: ${m.content}`)
    .join('\n');
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cost-effective for summarization
        messages: [
          { role: 'system', content: SUMMARIZATION_PROMPT },
          { role: 'user', content: conversationText }
        ],
        max_tokens: 200,
        temperature: 0.3, // More deterministic for summaries
      }),
    });
    
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[SUMMARIZE] Error calling OpenAI:', e);
    return '';
  }
}

/**
 * Run summarization cron job
 * Called by cron: Summarizes conversations for leads with >10 messages who haven't been summarized in 24h
 */
export async function runSummarizationCron(env: Env): Promise<{ summarized: number; errors: number }> {
  console.log('[SUMMARIZE] Starting summarization cron...');
  
  let summarized = 0;
  let errors = 0;
  
  try {
    // Find leads that need summarization:
    // - Have at least 10 messages
    // - Haven't been summarized in the last 24 hours (or never)
    const leadsToSummarize = await env.DB.prepare(`
      SELECT l.id, l.telefone, l.nome
      FROM leads l
      WHERE (
        SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id
      ) >= 10
      AND (
        -- Check if NO summary exists, or the MOST RECENT summary is older than 24h
        NOT EXISTS (
          SELECT 1 FROM conversation_summaries cs 
          WHERE cs.lead_id = l.id 
          AND cs.created_at >= datetime('now', '-24 hours')
        )
      )
      ORDER BY l.last_interaction DESC
      LIMIT 1
    `).all<{ id: number; telefone: string; nome: string }>();
    
    console.log(`[SUMMARIZE] Found ${leadsToSummarize.results?.length || 0} leads to summarize`);
    
    for (const lead of leadsToSummarize.results || []) {
      try {
        // Get recent messages for this lead
        const messagesResult = await env.DB.prepare(`
          SELECT content, role 
          FROM messages 
          WHERE lead_id = ?
          ORDER BY created_at DESC
          LIMIT 30
        `).bind(lead.id).all<{ content: string; role: string }>();
        
        const messages = (messagesResult.results || []).reverse();
        
        if (messages.length < 5) {
          console.log(`[SUMMARIZE] Skipping ${lead.telefone} - only ${messages.length} messages`);
          continue;
        }
        
        // Generate summary with LLM
        const summary = await summarizeConversation(messages, env);
        
        if (!summary) {
          errors++;
          continue;
        }
        
        // Get conversation context to extract cars and qualification
        const ctx = await getContext(lead.telefone, env, false);
        
        const carsDiscussed = [
          ...ctx.carsShown.map(c => `${c.marca} ${c.modelo}`),
          ...ctx.carsFromImages.map(c => `${c.marca || ''} ${c.modelo}`)
        ];
        
        // Determine message range
        const messageRange = `${messages.length} mensagens`;
        
        // Save to D1
        await saveSummaryToD1(
          String(lead.id),
          summary,
          [...new Set(carsDiscussed)], // Dedupe
          ctx.qualification,
          messageRange,
          env
        );
        
        summarized++;
        console.log(`[SUMMARIZE] ✅ Summarized lead ${lead.telefone}: "${summary.substring(0, 50)}..."`);
        
      } catch (e) {
        errors++;
        console.error(`[SUMMARIZE] Error summarizing lead ${lead.id}:`, e);
      }
    }
    
  } catch (e) {
    console.error('[SUMMARIZE] Cron job error:', e);
  }
  
  console.log(`[SUMMARIZE] Completed: ${summarized} summarized, ${errors} errors`);
  return { summarized, errors };
}


// =============================================================================
// PLANNER ENTITY UPDATES
// =============================================================================

/**
 * Interface for Planner entities
 */
export interface PlannerEntities {
  user_car?: {
    marca?: string;
    modelo?: string;
    ano?: number;
  };
  interest_car?: {
    categoria?: string;
    marca?: string;
    modelo?: string;
    preco_max?: number;
  };
  user_name?: string;
}

/**
 * Update context with entities extracted by Planner
 */
export async function updateEntitiesFromPlanner(
  telefone: string,
  plannerEntities: PlannerEntities,
  env: Env
): Promise<void> {
  const updates: Partial<ConversationContext> = {};
  
  // User car (for trade-in)
  if (plannerEntities.user_car?.modelo || plannerEntities.user_car?.marca) {
    const tradeInModel = plannerEntities.user_car.modelo 
      ? `${plannerEntities.user_car.marca || ''} ${plannerEntities.user_car.modelo}`.trim()
      : plannerEntities.user_car.marca || '';
    
    updates.entities = {
      user_car: plannerEntities.user_car,
    };
    
    // CRITICAL: Sync with qualification for generateContextSummary
    updates.qualification = {
      hasTradeIn: true,
      tradeInModel: tradeInModel,
    };
    
    console.log(`[CONTEXT] Saved user_car: ${JSON.stringify(plannerEntities.user_car)} | qualification.hasTradeIn: true, tradeInModel: ${tradeInModel}`);
  }
  
  // Interest car
  if (plannerEntities.interest_car?.modelo || plannerEntities.interest_car?.categoria) {
    updates.entities = {
      ...updates.entities,
      interest_car: plannerEntities.interest_car,
    };
    console.log(`[CONTEXT] Saved interest_car: ${JSON.stringify(plannerEntities.interest_car)}`);
  }
  
  // User name
  if (plannerEntities.user_name) {
    updates.userName = plannerEntities.user_name;
    console.log(`[CONTEXT] Saved userName: ${plannerEntities.user_name}`);
  }
  
  if (Object.keys(updates).length > 0) {
    await updateContext(telefone, updates, env);
    
    // MELHORIA 3: Persistir entidades importantes no D1 (metadata do lead)
    // Isso mantém memória mesmo quando KV expira (24h)
    try {
      const { DBService } = await import('./db.service');
      const db = new DBService(env.DB);
      const lead = await db.getLeadByPhone(telefone);
      
      if (lead) {
        const meta = typeof lead.metadata === 'string' ? JSON.parse(lead.metadata) : (lead.metadata || {});
        let changed = false;
        
        // Salvar user_car no metadata
        if (plannerEntities.user_car?.modelo || plannerEntities.user_car?.marca) {
          meta.memory_user_car = plannerEntities.user_car;
          changed = true;
        }
        
        // Salvar interest_car no metadata
        if (plannerEntities.interest_car?.modelo || plannerEntities.interest_car?.categoria) {
          meta.memory_interest_car = plannerEntities.interest_car;
          changed = true;
        }
        
        if (changed) {
          await db.updateLead(lead.id, { metadata: meta });
          console.log(`[CONTEXT] Persisted entities to D1 for ${telefone}`);
        }
      }
    } catch (e) {
      console.warn(`[CONTEXT] Failed to persist entities to D1: ${e}`);
    }
  }
}

/**
 * Save bot response for anti-repetition tracking
 */
export async function saveBotResponseForAntiRepetition(
  telefone: string,
  response: string,
  env: Env
): Promise<void> {
  const ctx = await getContext(telefone, env, false);
  
  // Calculate hash
  const hash = simpleResponseHash(response);
  
  // Add to lastBotResponses (max 10)
  const lastResponses = ctx.lastBotResponses || [];
  lastResponses.unshift({
    text: response,
    hash,
    at: new Date().toISOString(),
  });
  
  // Keep only last 10
  const trimmed = lastResponses.slice(0, 10);
  
  await updateContext(telefone, {
    lastBotResponses: trimmed,
    lastBotMessage: {
      text: response,
      sentAt: new Date().toISOString(),
    },
  }, env);
}

function simpleResponseHash(str: string): string {
  let hash = 0;
  const normalized = str.toLowerCase().replace(/[^\w]/g, '');
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Get a human-readable summary of context for injection into prompts
 * Used by Planner and Executor to understand the conversation state
 */
export function getContextSummary(ctx: ConversationContext): string {
  const lines: string[] = [];
  
  // User name
  if (ctx.userName) {
    lines.push(`Cliente: ${ctx.userName}`);
  }
  
  // Entities
  if (ctx.entities?.user_car?.modelo) {
    const car = ctx.entities.user_car;
    const details: string[] = [];
    if (car.marca) details.push(car.marca);
    if (car.modelo) details.push(car.modelo);
    if (car.ano) details.push(String(car.ano));
    if (car.km) details.push(`${(car.km / 1000).toFixed(0)}mil km`);
    if (car.cor) details.push(car.cor);
    lines.push(`[MEMÓRIA] Carro do cliente para troca: ${details.join(' ')}`);
  }
  
  if (ctx.entities?.interest_car?.modelo || ctx.entities?.interest_car?.categoria) {
    const car = ctx.entities.interest_car;
    const parts: string[] = [];
    if (car.categoria) parts.push(`Categoria: ${car.categoria}`);
    if (car.marca) parts.push(`Marca: ${car.marca}`);
    if (car.modelo) parts.push(`Modelo: ${car.modelo}`);
    if (car.preco_max) parts.push(`Até R$ ${car.preco_max.toLocaleString('pt-BR')}`);
    lines.push(`Interesse: ${parts.join(', ')}`);
  }
  
  // Qualification
  if (ctx.qualification) {
    const q = ctx.qualification;
    if (q.paymentMethod && q.paymentMethod !== 'indefinido') {
      lines.push(`Pagamento: ${q.paymentMethod}`);
    }
    if (q.urgency) {
      lines.push(`Urgência: ${q.urgency}`);
    }
    if (q.cityOrRegion) {
      lines.push(`Cidade: ${q.cityOrRegion}`);
    }
  }
  
  // Handoff status
  if (ctx.sellerHandoff?.done) {
    const handoffAt = ctx.sellerHandoff.at ? new Date(ctx.sellerHandoff.at) : null;
    const minsAgo = handoffAt ? Math.floor((Date.now() - handoffAt.getTime()) / 60000) : 0;
    lines.push(`[HANDOFF feito há ${minsAgo}min - modo passivo]`);
  }
  
  // Cars shown
  if (ctx.carsShown && ctx.carsShown.length > 0) {
    lines.push(`Carros mostrados: ${ctx.carsShown.length}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : 'Novo cliente, sem histórico.';
}


