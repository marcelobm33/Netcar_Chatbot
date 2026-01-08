/**
 * Metrics Service - Quality and Performance Tracking
 * 
 * Tracks:
 * - Conversation metrics (length, handoff rate)
 * - Response times
 * - Error rates
 * - Router decisions distribution
 */

import { Env } from '@types';

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationMetrics {
  /** Total conversations started */
  totalConversations: number;
  
  /** Conversations handed off to human */
  handoffCount: number;
  
  /** Conversations resolved by bot */
  botResolvedCount: number;
  
  /** Average messages per conversation */
  avgMessagesPerConversation: number;
  
  /** Average response time in ms */
  avgResponseTimeMs: number;
  
  /** Distribution of router decisions */
  routerDecisions: Record<string, number>;
  
  /** Error count by type */
  errors: Record<string, number>;
  
  /** Last updated timestamp */
  updatedAt: string;
}

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  conversations: number;
  messages: number;
  handoffs: number;
  errors: number;
  avgResponseTimeMs: number;
}

// In-memory counters (reset on worker restart)
const metrics = {
  responseTimeSamples: [] as number[],
  routerDecisions: {} as Record<string, number>,
  errors: {} as Record<string, number>,
  messagesProcessed: 0,
  conversationsStarted: 0,
  handoffs: 0,
};

// =============================================================================
// METRIC RECORDING
// =============================================================================

/**
 * Record a response time sample
 */
export function recordResponseTime(durationMs: number): void {
  // Keep last 1000 samples for averaging
  if (metrics.responseTimeSamples.length > 1000) {
    metrics.responseTimeSamples.shift();
  }
  metrics.responseTimeSamples.push(durationMs);
}

/**
 * Record a router decision
 */
export function recordRouterDecision(decision: string): void {
  metrics.routerDecisions[decision] = (metrics.routerDecisions[decision] || 0) + 1;
}

/**
 * Record an error
 */
export function recordError(errorType: string): void {
  metrics.errors[errorType] = (metrics.errors[errorType] || 0) + 1;
  console.error(`[METRICS] Error recorded: ${errorType}`);
}

/**
 * Record a new conversation
 */
export function recordConversationStart(): void {
  metrics.conversationsStarted++;
}

/**
 * Record a message processed
 */
export function recordMessageProcessed(): void {
  metrics.messagesProcessed++;
}

/**
 * Record a handoff
 */
export function recordHandoff(): void {
  metrics.handoffs++;
}

// =============================================================================
// METRIC RETRIEVAL
// =============================================================================

/**
 * Get current metrics snapshot
 */
export function getMetricsSnapshot(): ConversationMetrics {
  const avgResponseTime = metrics.responseTimeSamples.length > 0
    ? Math.round(metrics.responseTimeSamples.reduce((a, b) => a + b, 0) / metrics.responseTimeSamples.length)
    : 0;

  const avgMessages = metrics.conversationsStarted > 0
    ? Math.round((metrics.messagesProcessed / metrics.conversationsStarted) * 10) / 10
    : 0;

  const botResolved = metrics.conversationsStarted - metrics.handoffs;

  return {
    totalConversations: metrics.conversationsStarted,
    handoffCount: metrics.handoffs,
    botResolvedCount: Math.max(0, botResolved),
    avgMessagesPerConversation: avgMessages,
    avgResponseTimeMs: avgResponseTime,
    routerDecisions: { ...metrics.routerDecisions },
    errors: { ...metrics.errors },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Calculate handoff rate percentage
 */
export function getHandoffRate(): number {
  if (metrics.conversationsStarted === 0) return 0;
  return Math.round((metrics.handoffs / metrics.conversationsStarted) * 1000) / 10;
}

// =============================================================================
// PERSISTENCE (KV Storage)
// =============================================================================

const METRICS_KEY_PREFIX = 'metrics:';

/**
 * Persist daily metrics to KV
 */
export async function persistDailyMetrics(env: Env): Promise<void> {
  if (!env.NETCAR_CACHE) {
    console.warn('[METRICS] KV not configured, skipping persistence');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const key = `${METRICS_KEY_PREFIX}daily:${today}`;

  const existing = await env.NETCAR_CACHE.get(key, 'json') as DailyMetrics | null;

  const updated: DailyMetrics = {
    date: today,
    conversations: (existing?.conversations || 0) + metrics.conversationsStarted,
    messages: (existing?.messages || 0) + metrics.messagesProcessed,
    handoffs: (existing?.handoffs || 0) + metrics.handoffs,
    errors: (existing?.errors || 0) + Object.values(metrics.errors).reduce((a, b) => a + b, 0),
    avgResponseTimeMs: getMetricsSnapshot().avgResponseTimeMs,
  };

  await env.NETCAR_CACHE.put(key, JSON.stringify(updated), {
    expirationTtl: 60 * 60 * 24 * 90, // Keep 90 days
  });

  console.log(`[METRICS] Persisted daily metrics for ${today}`);
}

/**
 * Get metrics for a specific date
 */
export async function getDailyMetrics(env: Env, date: string): Promise<DailyMetrics | null> {
  if (!env.NETCAR_CACHE) return null;
  
  const key = `${METRICS_KEY_PREFIX}daily:${date}`;
  return await env.NETCAR_CACHE.get(key, 'json') as DailyMetrics | null;
}

/**
 * Get metrics for last N days
 */
export async function getMetricsHistory(env: Env, days: number = 7): Promise<DailyMetrics[]> {
  if (!env.NETCAR_CACHE) return [];

  const results: DailyMetrics[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const metrics = await getDailyMetrics(env, dateStr);
    if (metrics) {
      results.push(metrics);
    }
  }

  return results.reverse(); // Oldest first
}

// =============================================================================
// RESET (for testing or manual reset)
// =============================================================================

/**
 * Reset in-memory counters
 */
export function resetMetrics(): void {
  metrics.responseTimeSamples = [];
  metrics.routerDecisions = {};
  metrics.errors = {};
  metrics.messagesProcessed = 0;
  metrics.conversationsStarted = 0;
  metrics.handoffs = 0;
  console.log('[METRICS] In-memory metrics reset');
}
