/**
 * Fallback Cascade Service
 * =========================
 * Provides resilient LLM calls with automatic fallback
 * 
 * Priority order:
 * 1. DeepSeek (primary - cost-effective)
 * 2. OpenAI (fallback - reliable)
 * 3. Gemini via CF AI (backup - free tier)
 * 4. Cached response (last resort)
 */

import type { Env } from '@types';
import { getFromKV, setInKV } from './cache.service';

// =============================================================================
// TYPES
// =============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: 'deepseek' | 'openai' | 'gemini' | 'cache';
  latencyMs: number;
  isFallbackUsed: boolean;
}

export interface FallbackConfig {
  maxRetries?: number;
  timeoutMs?: number;
  isCacheEnabled?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL = 60 * 60 * 24; // 24 hours
const DEFAULT_TIMEOUT = 30000; // 30s

// =============================================================================
// PROVIDER IMPLEMENTATIONS
// =============================================================================

/**
 * Call DeepSeek API (primary)
 */
async function callDeepSeek(
  messages: LLMMessage[],
  env: Env,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL || 'deepseek-reasoner',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`DeepSeek error: ${response.status}`);
    }
    
    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call OpenAI API (fallback 1)
 */
async function callOpenAI(
  messages: LLMMessage[],
  env: Env,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }
    
    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Gemini via Cloudflare Workers AI (fallback 2)
 */
async function callGemini(
  messages: LLMMessage[],
  env: Env
): Promise<string> {
  // CF Workers AI has different message format
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - Cloudflare AI binding
    const result = await env.AI?.run('@cf/google/gemma-7b-it-lora', {
      prompt,
      max_tokens: 800,
    });
    
    return result?.response || '';
  } catch (e) {
    console.error('[FALLBACK] Gemini error:', e);
    throw e;
  }
}

/**
 * Get cached response (last resort)
 */
async function getCachedResponse(
  messages: LLMMessage[],
  env: Env
): Promise<string | null> {
  // Create hash from last user message
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  const hash = await hashMessage(lastUserMsg);
  const cacheKey = `llm_cache:${hash}`;
  
  return getFromKV<string>(env, cacheKey);
}

/**
 * Cache a response for future fallback
 */
async function cacheResponse(
  messages: LLMMessage[],
  response: string,
  env: Env
): Promise<void> {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  const hash = await hashMessage(lastUserMsg);
  const cacheKey = `llm_cache:${hash}`;
  
  await setInKV(env, cacheKey, response, CACHE_TTL);
}

/**
 * Simple hash function for cache keys
 */
async function hashMessage(msg: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(msg.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// MAIN FALLBACK CASCADE
// =============================================================================

/**
 * Call LLM with automatic fallback cascade
 */
export async function callLLMWithFallback(
  messages: LLMMessage[],
  env: Env,
  config: FallbackConfig = {}
): Promise<LLMResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT, isCacheEnabled = true } = config;
  const start = Date.now();
  
  const providers: {
    name: 'deepseek' | 'openai' | 'gemini';
    fn: () => Promise<string>;
  }[] = [
    { name: 'deepseek', fn: () => callDeepSeek(messages, env, timeoutMs) },
    { name: 'openai', fn: () => callOpenAI(messages, env, timeoutMs) },
    { name: 'gemini', fn: () => callGemini(messages, env) },
  ];
  
  let lastError: Error | null = null;
  
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      console.log(`[FALLBACK] Trying provider: ${provider.name}`);
      const content = await provider.fn();
      
      if (content) {
        // Cache successful response
        if (isCacheEnabled) {
          env.ctx.waitUntil(cacheResponse(messages, content, env));
        }
        
        return {
          content,
          model: provider.name === 'deepseek' ? (env.AI_MODEL || 'deepseek-reasoner') : provider.name,
          provider: provider.name,
          latencyMs: Date.now() - start,
          isFallbackUsed: i > 0,
        };
      }
    } catch (e) {
      lastError = e as Error;
      console.error(`[FALLBACK] ${provider.name} failed:`, e);
      // Continue to next provider
    }
  }
  
  // All providers failed, try cache
  if (isCacheEnabled) {
    console.log('[FALLBACK] All providers failed, trying cache...');
    const cached = await getCachedResponse(messages, env);
    if (cached) {
      return {
        content: cached,
        model: 'cache',
        provider: 'cache',
        latencyMs: Date.now() - start,
        isFallbackUsed: true,
      };
    }
  }
  
  // Complete failure
  console.error('[FALLBACK] All providers and cache failed');
  return {
    content: 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou entre em contato pelo telefone (51) 99207-3506.',
    model: 'fallback_message',
    provider: 'cache',
    latencyMs: Date.now() - start,
    isFallbackUsed: true,
  };
}

/**
 * Check health of all providers
 */
export async function checkProvidersHealth(env: Env): Promise<{
  isDeepseekHealthy: boolean;
  isOpenaiHealthy: boolean;
  isGeminiHealthy: boolean;
}> {
  const testMessages: LLMMessage[] = [
    { role: 'user', content: 'ping' }
  ];
  
  const results = await Promise.allSettled([
    callDeepSeek(testMessages, env, 5000),
    callOpenAI(testMessages, env, 5000),
    callGemini(testMessages, env),
  ]);
  
  return {
    isDeepseekHealthy: results[0].status === 'fulfilled',
    isOpenaiHealthy: results[1].status === 'fulfilled',
    isGeminiHealthy: results[2].status === 'fulfilled',
  };
}
