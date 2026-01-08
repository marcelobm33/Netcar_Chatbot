/**
 * Analytics Service - Custom Metrics with Workers Analytics Engine
 * 
 * Tracks rich metrics for business intelligence:
 * - Request latency
 * - LLM performance
 * - Conversion funnel
 * - Error rates
 * 
 * Data is stored in Analytics Engine and queryable via GraphQL API.
 * Dashboard: https://dash.cloudflare.com > Workers > Analytics
 */

import type { Env } from '@types';

// Metric event types
export type MetricEvent = 
  | 'request'
  | 'llm_call'
  | 'handoff'
  | 'car_search'
  | 'error'
  | 'cache_hit'
  | 'cache_miss';

interface MetricData {
  // Blobs (indexed, max 20)
  blob1?: string;  // event type
  blob2?: string;  // phone hash
  blob3?: string;  // model/brand
  blob4?: string;  // status
  blob5?: string;  // source
  
  // Doubles (aggregatable, max 20)
  double1?: number; // latency_ms
  double2?: number; // tokens_used
  double3?: number; // cost_usd
  double4?: number; // message_count
  double5?: number; // success (0 or 1)
}

/**
 * Record a metric event to Analytics Engine
 */
export function recordMetric(
  event: MetricEvent,
  data: Partial<MetricData>,
  env: Env
): void {
  if (!env.METRICS) {
    // Analytics Engine not configured, skip silently
    return;
  }

  try {
    env.METRICS.writeDataPoint({
      blobs: [
        event,
        data.blob2 || '',
        data.blob3 || '',
        data.blob4 || '',
        data.blob5 || '',
      ],
      doubles: [
        data.double1 || 0,
        data.double2 || 0,
        data.double3 || 0,
        data.double4 || 0,
        data.double5 || 0,
      ],
      indexes: [event], // Primary index for fast queries
    });
  } catch (error) {
    console.warn('[Analytics] Failed to record metric:', error);
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Record request latency
 */
export function recordRequestLatency(
  latencyMs: number,
  phoneHash: string,
  status: 'success' | 'error',
  env: Env
): void {
  recordMetric('request', {
    blob2: phoneHash,
    blob4: status,
    double1: latencyMs,
    double5: status === 'success' ? 1 : 0,
  }, env);
}

/**
 * Record LLM call metrics
 */
export function recordLLMCall(
  provider: 'deepseek' | 'openai' | 'gemini',
  latencyMs: number,
  tokensUsed: number,
  costUsd: number,
  success: boolean,
  env: Env
): void {
  recordMetric('llm_call', {
    blob3: provider,
    blob4: success ? 'success' : 'error',
    double1: latencyMs,
    double2: tokensUsed,
    double3: costUsd,
    double5: success ? 1 : 0,
  }, env);
}

/**
 * Record handoff event
 */
export function recordHandoffEvent(
  triggerType: string,
  messageCount: number,
  phoneHash: string,
  env: Env
): void {
  recordMetric('handoff', {
    blob2: phoneHash,
    blob3: triggerType,
    blob4: 'success',
    double4: messageCount,
    double5: 1,
  }, env);
}

/**
 * Record car search
 */
export function recordCarSearch(
  searchType: 'model' | 'brand' | 'category' | 'price',
  resultCount: number,
  searchTerm: string,
  env: Env
): void {
  recordMetric('car_search', {
    blob3: searchTerm,
    blob4: searchType,
    double4: resultCount,
    double5: resultCount > 0 ? 1 : 0,
  }, env);
}

/**
 * Record error
 */
export function recordError(
  errorType: string,
  source: string,
  env: Env
): void {
  recordMetric('error', {
    blob3: errorType,
    blob5: source,
    double5: 0,
  }, env);
}

/**
 * Record cache hit/miss
 */
export function recordCache(
  hit: boolean,
  cacheType: 'kv' | 'r2' | 'graph',
  env: Env
): void {
  recordMetric(hit ? 'cache_hit' : 'cache_miss', {
    blob3: cacheType,
    double5: hit ? 1 : 0,
  }, env);
}

// =============================================================================
// QUERY HELPERS (for GraphQL API)
// =============================================================================

/**
 * Example GraphQL query for Analytics Engine:
 * 
 * query {
 *   viewer {
 *     accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
 *       analyticsEngineDatasets(
 *         filter: { name: "netcar_metrics" }
 *       ) {
 *         sum {
 *           double1 # total latency
 *         }
 *         count
 *         dimensions {
 *           blob1 # event type
 *         }
 *       }
 *     }
 *   }
 * }
 */
