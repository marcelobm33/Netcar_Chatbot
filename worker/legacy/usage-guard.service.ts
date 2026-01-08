/**
 * Usage Guard Service - Cost Protection for Cloudflare Workers Pro
 * 
 * Monitors and limits daily usage to prevent overage charges.
 * 
 * Workers Pro Included Limits:
 * - Requests: 10M/month (~333k/day)
 * - CPU Time: 30M ms/month (~1M ms/day)
 * - KV Reads: 10M/month
 * - KV Writes: 1M/month
 * - D1 Rows: 25B reads, 50M writes
 * - Vectorize: 30M queries/month
 */

import type { Env } from '@types';

// Daily limits (safe margins below monthly limits)
const LIMITS = {
  // 10M requests/month = ~333k/day, use 300k for safety
  DAILY_REQUESTS: 300_000,
  
  // 30M ms CPU/month = ~1M ms/day, use 800k for safety
  DAILY_CPU_MS: 800_000,
  
  // 1M KV writes/month = ~33k/day, use 30k for safety
  DAILY_KV_WRITES: 30_000,
  
  // 50M D1 writes/month = ~1.67M/day, use 1M for safety
  DAILY_D1_WRITES: 1_000_000,
  
  // 30M Vectorize queries/month = ~1M/day, use 500k for safety
  DAILY_VECTORIZE_QUERIES: 500_000,
  
  // AI/LLM calls - based on cost, not Cloudflare limits
  // DeepSeek: ~$0.55/1M tokens, ~2000 tokens/call = ~$0.001/call
  // Budget: $10/day max = 10,000 calls max
  DAILY_AI_CALLS: 5_000,
};

// Thresholds for alerts and blocking
const WARNING_THRESHOLD = 0.8;  // Alert at 80%
const BLOCK_THRESHOLD = 0.95;   // Block at 95%

// KV keys for daily counters
const COUNTER_KEYS = {
  requests: 'usage:requests',
  cpuMs: 'usage:cpu_ms',
  kvWrites: 'usage:kv_writes',
  d1Writes: 'usage:d1_writes',
  vectorize: 'usage:vectorize',
  aiCalls: 'usage:ai_calls',
};

interface UsageCounters {
  requests: number;
  cpuMs: number;
  kvWrites: number;
  d1Writes: number;
  vectorize: number;
  aiCalls: number;
  date: string; // YYYY-MM-DD
}

/**
 * Get today's date key in Brazil timezone
 */
function getTodayKey(): string {
  const now = new Date();
  const brazil = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brazil.toISOString().split('T')[0];
}

/**
 * Get current usage counters
 */
async function getCounters(env: Env): Promise<UsageCounters> {
  const today = getTodayKey();
  const key = `usage:${today}`;
  
  try {
    const cached = await env.NETCAR_CACHE.get(key, 'json') as UsageCounters | null;
    
    if (cached && cached.date === today) {
      return cached;
    }
  } catch (e) {
    console.warn('[UsageGuard] Error reading counters:', e);
  }
  
  // Return fresh counters for new day
  return {
    requests: 0,
    cpuMs: 0,
    kvWrites: 0,
    d1Writes: 0,
    vectorize: 0,
    aiCalls: 0,
    date: today,
  };
}

/**
 * Save usage counters
 */
async function saveCounters(counters: UsageCounters, env: Env): Promise<void> {
  const key = `usage:${counters.date}`;
  
  try {
    await env.NETCAR_CACHE.put(key, JSON.stringify(counters), {
      expirationTtl: 86400 * 2, // Keep for 2 days for debugging
    });
  } catch (e) {
    console.warn('[UsageGuard] Error saving counters:', e);
  }
}

/**
 * Increment a usage counter
 */
export async function incrementUsage(
  type: keyof Omit<UsageCounters, 'date'>,
  amount: number,
  env: Env
): Promise<{ allowed: boolean; warning?: string }> {
  const counters = await getCounters(env);
  const limit = LIMITS[`DAILY_${type.toUpperCase()}` as keyof typeof LIMITS] as number;
  
  if (!limit) {
    console.warn(`[UsageGuard] Unknown usage type: ${type}`);
    return { allowed: true };
  }
  
  const currentUsage = counters[type] as number;
  const newUsage = currentUsage + amount;
  const percentage = newUsage / limit;
  
  // Check if should block
  if (percentage >= BLOCK_THRESHOLD) {
    console.error(`[UsageGuard] 🛑 BLOCKED: ${type} at ${(percentage * 100).toFixed(1)}% (${newUsage}/${limit})`);
    return {
      allowed: false,
      warning: `Daily limit exceeded for ${type}. Blocked to prevent overage charges.`,
    };
  }
  
  // Increment counter
  (counters[type] as number) = newUsage;
  await saveCounters(counters, env);
  
  // Check if should warn
  if (percentage >= WARNING_THRESHOLD) {
    const warning = `⚠️ ${type} at ${(percentage * 100).toFixed(1)}% of daily limit`;
    console.warn(`[UsageGuard] ${warning}`);
    return { allowed: true, warning };
  }
  
  return { allowed: true };
}

/**
 * Check if a request should be allowed
 */
export async function checkRequestAllowed(env: Env): Promise<{ allowed: boolean; reason?: string }> {
  const result = await incrementUsage('requests', 1, env);
  
  if (!result.allowed) {
    return { allowed: false, reason: result.warning };
  }
  
  return { allowed: true };
}

/**
 * Check if an AI call should be allowed
 */
export async function checkAICallAllowed(env: Env): Promise<{ allowed: boolean; reason?: string }> {
  const result = await incrementUsage('aiCalls', 1, env);
  
  if (!result.allowed) {
    return { 
      allowed: false, 
      reason: 'Daily AI usage limit reached. Try again tomorrow.',
    };
  }
  
  return { allowed: true };
}

/**
 * Track CPU time used
 */
export async function trackCPUTime(cpuMs: number, env: Env): Promise<void> {
  await incrementUsage('cpuMs', cpuMs, env);
}

/**
 * Track D1 writes
 */
export async function trackD1Write(rows: number, env: Env): Promise<void> {
  await incrementUsage('d1Writes', rows, env);
}

/**
 * Track Vectorize queries
 */
export async function trackVectorize(queries: number, env: Env): Promise<void> {
  await incrementUsage('vectorize', queries, env);
}

/**
 * Get usage summary for monitoring
 */
export async function getUsageSummary(env: Env): Promise<{
  counters: UsageCounters;
  percentages: Record<string, number>;
  alerts: string[];
}> {
  const counters = await getCounters(env);
  const percentages: Record<string, number> = {};
  const alerts: string[] = [];
  
  for (const [key, limit] of Object.entries(LIMITS)) {
    const counterKey = key.replace('DAILY_', '').toLowerCase() as keyof Omit<UsageCounters, 'date'>;
    if (counterKey in counters) {
      const value = counters[counterKey] as number;
      const percentage = value / limit;
      percentages[counterKey] = percentage;
      
      if (percentage >= BLOCK_THRESHOLD) {
        alerts.push(`🛑 ${counterKey}: ${(percentage * 100).toFixed(1)}% - BLOCKED`);
      } else if (percentage >= WARNING_THRESHOLD) {
        alerts.push(`⚠️ ${counterKey}: ${(percentage * 100).toFixed(1)}% - WARNING`);
      }
    }
  }
  
  return { counters, percentages, alerts };
}

/**
 * Log usage summary (for cron job)
 */
export async function logUsageSummary(env: Env): Promise<void> {
  const { counters, percentages, alerts } = await getUsageSummary(env);
  
  console.log('[UsageGuard] Daily Summary:', {
    date: counters.date,
    requests: `${counters.requests} (${(percentages.requests * 100).toFixed(1)}%)`,
    aiCalls: `${counters.aiCalls} (${(percentages.aicalls * 100).toFixed(1)}%)`,
    cpuMs: `${counters.cpuMs} (${(percentages.cpums * 100).toFixed(1)}%)`,
  });
  
  if (alerts.length > 0) {
    console.warn('[UsageGuard] ALERTS:', alerts.join(', '));
  }
}
