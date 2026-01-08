/**
 * Rate Limiting Service
 * Protects against abuse and controls API costs
 */
import type { Env } from '../types';

/**
 * Check rate limit for a given key (e.g., phone number, IP)
 * Returns true if within limits, false if exceeded
 */
export async function checkRateLimit(
  limiter: RateLimit,
  key: string
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const result = await limiter.limit({ key });
    return {
      allowed: result.success,
      // RateLimitOutcome doesn't expose limit/used, so we estimate
      remaining: result.success ? 10 : 0,
    };
  } catch (error) {
    console.error(`[RATE_LIMIT] Error checking limit for ${key}:`, error);
    // Fail open - allow request if rate limiting fails
    return { allowed: true, remaining: 0 };
  }
}

/**
 * Check webhook rate limit per phone number
 * Limits: 60 requests per minute per phone
 */
export async function checkWebhookLimit(
  env: Env,
  phoneNumber: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.WEBHOOK_RATE_LIMITER) {
    console.log('[RATE_LIMIT] Webhook limiter not configured, allowing');
    return { allowed: true, remaining: 999 };
  }
  
  const result = await checkRateLimit(env.WEBHOOK_RATE_LIMITER, `webhook:${phoneNumber}`);
  
  if (!result.allowed) {
    console.warn(`[RATE_LIMIT] ⚠️ Webhook limit exceeded for ${phoneNumber}`);
  }
  
  return result;
}

/**
 * Check API rate limit (global)
 * Limits: 100 requests per minute total
 */
export async function checkAPILimit(
  env: Env,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.API_RATE_LIMITER) {
    console.log('[RATE_LIMIT] API limiter not configured, allowing');
    return { allowed: true, remaining: 999 };
  }
  
  const result = await checkRateLimit(env.API_RATE_LIMITER, `api:${endpoint}`);
  
  if (!result.allowed) {
    console.warn(`[RATE_LIMIT] ⚠️ API limit exceeded for ${endpoint}`);
  }
  
  return result;
}

/**
 * Check OpenAI rate limit (cost control)
 * Limits: 30 calls per minute to avoid excessive costs
 */
export async function checkOpenAILimit(
  env: Env
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.OPENAI_RATE_LIMITER) {
    console.log('[RATE_LIMIT] OpenAI limiter not configured, allowing');
    return { allowed: true, remaining: 999 };
  }
  
  const result = await checkRateLimit(env.OPENAI_RATE_LIMITER, 'openai:global');
  
  if (!result.allowed) {
    console.warn('[RATE_LIMIT] ⚠️ OpenAI rate limit exceeded - cost protection active');
  }
  
  return result;
}

/**
 * Check IP-based rate limit (DDoS protection)
 * Limits: 100 requests per minute per IP
 */
export async function checkIPLimit(
  env: Env,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.API_RATE_LIMITER || !ip) {
    return { allowed: true, remaining: 999 };
  }
  
  // Use API limiter with IP key for DDoS protection
  const result = await checkRateLimit(env.API_RATE_LIMITER, `ip:${ip}`);
  
  if (!result.allowed) {
    console.warn(`[RATE_LIMIT] ⚠️ IP limit exceeded for ${ip.substring(0, 10)}...`);
  }
  
  return result;
}

/**
 * Extract client IP from request headers
 * Uses Cloudflare's CF-Connecting-IP header
 */
export function getClientIP(req: Request): string {
  return req.headers.get('CF-Connecting-IP') 
    || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || req.headers.get('X-Real-IP')
    || 'unknown';
}

/**
 * Generate rate limit response headers
 */
export function getRateLimitHeaders(remaining: number, limit: number = 60): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 60),
  };
}

/**
 * Rate limit exceeded response
 */
export function rateLimitExceededResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Muitas requisições. Aguarde 1 minuto antes de tentar novamente.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        ...getRateLimitHeaders(0),
      },
    }
  );
}
