import type { Env, CarData } from '@types';
import { getFromKV, setInKV, CACHE_TTL_SECONDS } from './cache.service';

/**
 * Session Service - Manages user session state for pagination
 * 
 * OPTIMIZATION (Dec 2024):
 * Migrated car sessions to in-memory to avoid KV put() limit errors.
 * KV is only used as fallback for reads. In-memory is primary for writes.
 * 
 * Trade-off: Sessions don't persist across different Worker isolates,
 * but Smart Placement routes same users to same Workers most of the time.
 */

interface CarSession {
  cars: CarData[];
  currentIndex: number;
  searchQuery: any;
  createdAt: string;
  lastAccess: number;
}

// Conversation state for flow management (items 1, 6, 7)
interface ConversationState {
  lastAction: 'idle' | 'sent_cars' | 'sent_seller' | 'followup_pending';
  sellerCardSentAt?: string;
  lastCarResults?: number;
  createdAt: string;
}

// ==================== IN-MEMORY SESSION STORAGE ====================
// Global Maps that persist across requests in the same Worker isolate
// This eliminates KV writes for session data

const carSessions = new Map<string, CarSession>();
const conversationStates = new Map<string, ConversationState>();

// Session expiry times
const SESSION_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours for car sessions
const STATE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours for conversation state

// Track last cleanup time
let lastCleanupTime = 0;

/**
 * Cleanup expired sessions (runs max once per 60 seconds)
 */
function maybeCleanupSessions(): void {
  const now = Date.now();
  if (now - lastCleanupTime < 60000) return;
  
  lastCleanupTime = now;
  let cleanedSessions = 0;
  let cleanedStates = 0;
  
  // Cleanup old car sessions
  for (const [key, session] of carSessions.entries()) {
    if (now - session.lastAccess > SESSION_EXPIRY_MS) {
      carSessions.delete(key);
      cleanedSessions++;
    }
  }
  
  // Cleanup old conversation states
  for (const [key, state] of conversationStates.entries()) {
    const createdAt = new Date(state.createdAt).getTime();
    if (now - createdAt > STATE_EXPIRY_MS) {
      conversationStates.delete(key);
      cleanedStates++;
    }
  }
  
  if (cleanedSessions > 0 || cleanedStates > 0) {
    console.log(`[SESSION] Cleanup: ${cleanedSessions} sessions, ${cleanedStates} states expired`);
  }
}

/**
 * Normalize phone number
 */
function cleanPhone(telefone: string): string {
  return telefone.replace('@s.whatsapp.net', '').replace('@lid', '');
}

/**
 * Get conversation state for a user
 * Tries in-memory first, falls back to KV
 */
export async function getConversationState(
  telefone: string,
  env: Env
): Promise<ConversationState | null> {
  maybeCleanupSessions();
  
  const key = cleanPhone(telefone);
  
  // Try in-memory first
  const memState = conversationStates.get(key);
  if (memState) {
    return memState;
  }
  
  // Fallback to KV for reads (no writes)
  return await getFromKV<ConversationState>(env, `state:${key}`);
}

/**
 * Set conversation state
 * Writes to in-memory only (no KV writes)
 */
export async function setConversationState(
  telefone: string, 
  state: Partial<ConversationState>,
  env: Env
): Promise<void> {
  const key = cleanPhone(telefone);
  
  const existing = await getConversationState(telefone, env) || { 
    lastAction: 'idle' as const, 
    createdAt: new Date().toISOString() 
  };
  
  const newState: ConversationState = { 
    ...existing, 
    ...state,
    lastAction: state.lastAction || existing.lastAction
  };
  
  // Save to in-memory only (no KV write = no limit issues)
  conversationStates.set(key, newState);
  
  console.log(`[SESSION] State updated for ${key} in memory`);
}

/**
 * Check if seller card was sent recently (within 30 days)
 */
export async function wasSellerCardSent(telefone: string, env: Env): Promise<boolean> {
  const state = await getConversationState(telefone, env);
  if (!state?.sellerCardSentAt) return false;
  
  const sentAt = new Date(state.sellerCardSentAt);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  return sentAt > thirtyDaysAgo;
}

/**
 * Store car search results for pagination
 * Writes to in-memory only
 */
export async function saveCarSession(
  telefone: string,
  cars: CarData[],
  searchQuery: any,
  env: Env
): Promise<void> {
  maybeCleanupSessions();
  
  const key = cleanPhone(telefone);

  const session: CarSession = {
    cars,
    currentIndex: 0,
    searchQuery,
    createdAt: new Date().toISOString(),
    lastAccess: Date.now(),
  };
  
  // Save to in-memory only (no KV write = no limit issues)
  carSessions.set(key, session);
  
  console.log(`[SESSION] Saved ${cars.length} cars for ${key} in memory`);
}

/**
 * Get next batch of cars (6 at a time)
 */
export async function getNextCarBatch(
  telefone: string, 
  batchSize: number = 6,
  env: Env
): Promise<CarData[] | null> {
  const key = cleanPhone(telefone);
  
  // Try in-memory first
  let session = carSessions.get(key);
  
  // Fallback to KV if not in memory
  if (!session) {
    const kvSession = await getFromKV<CarSession>(env, `session:${key}`);
    if (kvSession) {
      // Migrate to in-memory
      session = { ...kvSession, lastAccess: Date.now() };
      carSessions.set(key, session);
    }
  }
  
  if (!session) {
    console.log(`[SESSION] No session found for ${key}`);
    return null;
  }
  
  const { cars, currentIndex } = session;
  
  // Check if we have more cars
  if (currentIndex >= cars.length) {
    console.log(`[SESSION] No more cars for ${key}`);
    return null;
  }
  
  // Get next batch
  const batch = cars.slice(currentIndex, currentIndex + batchSize);
  
  // Update index in memory
  session.currentIndex = currentIndex + batchSize;
  session.lastAccess = Date.now();
  carSessions.set(key, session);
  
  console.log(`[SESSION] Returning batch ${currentIndex}-${currentIndex + batchSize} for ${key}`);
  return batch;
}

/**
 * Check if there are more cars available
 */
export async function hasMoreCars(telefone: string, env: Env): Promise<boolean> {
  const key = cleanPhone(telefone);
  
  // Try in-memory first
  let session = carSessions.get(key);
  
  // Fallback to KV
  if (!session) {
    session = await getFromKV<CarSession>(env, `session:${key}`) || undefined;
  }
  
  if (!session) return false;
  
  return session.currentIndex < session.cars.length;
}

/**
 * Get remaining car count
 */
export async function getRemainingCount(telefone: string, env: Env): Promise<number> {
  const key = cleanPhone(telefone);
  
  // Try in-memory first
  let session = carSessions.get(key);
  
  // Fallback to KV
  if (!session) {
    session = await getFromKV<CarSession>(env, `session:${key}`) || undefined;
  }
  
  if (!session) return 0;
  
  return Math.max(0, session.cars.length - session.currentIndex);
}

/**
 * Clear session for user
 */
export async function clearSession(telefone: string, env: Env): Promise<void> {
  const key = cleanPhone(telefone);
  
  // Remove from in-memory
  carSessions.delete(key);
  
  console.log(`[SESSION] Cleared session for ${key}`);
}

/**
 * Detect if user is asking for more cars
 */
export function isAskingForMore(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  
  // First, check if message contains a car brand/model - if so, it's NOT asking for more
  const carBrands = ['chevrolet', 'fiat', 'ford', 'toyota', 'volkswagen', 'hyundai', 'honda', 'nissan', 'renault', 'jeep', 'kia', 'bmw', 'mercedes', 'audi'];
  const hasCarBrand = carBrands.some(brand => lowerMsg.includes(brand));
  if (hasCarBrand) return false; // Not asking for more if mentioning a brand
  
  const morePatterns = [
    'mais',
    'outras',
    'outros',
    'próximos',
    'proximos',
    'próximas',      // ADDED: Word used in the pagination message
    'proximas',      // ADDED: Without accent
    'mais opções',
    'mais opcoes',
    'ver mais',
    'quero ver mais',  // Changed from 'quero ver' to be more specific
    'continua',
    'continue',
    'próximo',
    'proximo',
    'avança',
    'avanca',
    'sim',
  ];
  
  return morePatterns.some(pattern => lowerMsg.includes(pattern));
}

/**
 * Get session stats for debugging
 */
export function getSessionStats(): { sessionCount: number; stateCount: number } {
  return {
    sessionCount: carSessions.size,
    stateCount: conversationStates.size,
  };
}
