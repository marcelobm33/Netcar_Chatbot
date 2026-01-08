import type { Env } from '@types';

/**
 * Cache Service for Cloudflare Workers
 * Uses in-memory cache + KV for persistence + R2 for images
 * 
 * OPTIMIZATION (Dec 2024):
 * Added hybrid cache strategy - in-memory for high-frequency writes,
 * KV only for important persistent data. This avoids KV put() limit errors.
 */

interface CacheEntry {
  value: string;
  expiry: number;
}

// Global cache storage (persists across requests in same isolate)
const cache: Map<string, CacheEntry> = new Map();

// ==================== SEARCH CACHE (IN-MEMORY) ====================
// Stores search results to avoid hitting KV limits
// Max 50 entries with LRU eviction
interface SearchCacheEntry {
  data: any;
  expiry: number;
  accessTime: number;
}
const searchCache = new Map<string, SearchCacheEntry>();
const MAX_SEARCH_CACHE_SIZE = 200; // Increased to handle ctx, fsm, summary, etc.

// Cache TTLs in milliseconds (for in-memory) and seconds (for KV)
// AGGRESSIVE CACHING: Increased TTLs to reduce API calls and latency
const CACHE_TTL = {
  STORE_INFO: 15 * 60 * 1000,     // 15 minutes - store info rarely changes
  BRANDS: 30 * 60 * 1000,         // 30 minutes - brands list (was 10)
  SYSTEM_PROMPT: 5 * 60 * 1000,   // 5 minutes - prompt from Supabase (was 2)
  GREETING: 60 * 60 * 1000,       // 60 minutes - static greeting (was 30)
  STOCK: 15 * 60 * 1000,          // 15 minutes - car stock (was 5)
  BLOCKLIST: 15 * 60 * 1000,      // 15 minutes - blocklist (was 10)
};

const CACHE_TTL_SECONDS = {
  STOCK: 900,       // 15 minutes for car stock (was 5 = 300)
  IMAGES: 172800,   // 48 hours for images (was 24h)
  CONFIG: 7200,     // 2 hours for config (was 1h)
  BLOCKLIST: 900,   // 15 minutes for blocklist (was 10)
};

// ==================== IN-MEMORY CACHE ====================

/**
 * Get a value from in-memory cache
 */
export function getFromCache(key: string): string | null {
  const entry = cache.get(key);
  
  if (!entry) {
    return null;
  }
  
  // Check if expired
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    console.log(`[CACHE] Expired: ${key}`);
    return null;
  }
  
  console.log(`[CACHE] Hit: ${key}`);
  return entry.value;
}

/**
 * Set a value in in-memory cache with TTL
 */
export function setInCache(key: string, value: string, ttlMs: number = CACHE_TTL.STORE_INFO): void {
  cache.set(key, {
    value,
    expiry: Date.now() + ttlMs,
  });
  console.log(`[CACHE] Set: ${key} (TTL: ${ttlMs / 1000}s)`);
}

/**
 * Clear expired entries (call periodically)
 */
export function cleanExpiredCache(): number {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiry) {
      cache.delete(key);
      cleaned++;
    }
  }
  
  // Also clean search cache
  for (const [key, entry] of searchCache.entries()) {
    if (now > entry.expiry) {
      searchCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[CACHE] Cleaned ${cleaned} expired entries`);
  }
  
  return cleaned;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; keys: string[]; searchCacheSize: number } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    searchCacheSize: searchCache.size,
  };
}

// ==================== KV PERSISTENT CACHE ====================

/**
 * Get cached data from KV (persistent across workers)
 * Also checks in-memory cache first for high-frequency keys
 * CRITICAL: ctx: keys now fall through to KV to prevent context loss across isolates
 */
export async function getFromKV<T>(
  env: Env,
  key: string
): Promise<T | null> {
  // Check in-memory cache first for high-frequency keys
  const useInMemory = 
    key.startsWith('search_') || 
    key.startsWith('session:') ||
    key.startsWith('ctx:') ||
    key.startsWith('fsm:') ||
    key.startsWith('summary:') ||
    key.startsWith('debounce:') ||
    key.startsWith('state:');
  
  if (useInMemory) {
    const memEntry = searchCache.get(key);
    if (memEntry && Date.now() < memEntry.expiry) {
      memEntry.accessTime = Date.now(); // Update LRU
      return memEntry.data as T;
    }
    // CRITICAL FIX: ctx: and fsm: keys should fallback to KV for cross-isolate persistence
    // This prevents context loss when requests hit different Workers
    const shouldFallbackToKV = key.startsWith('ctx:') || key.startsWith('fsm:');
    if (!shouldFallbackToKV) {
      return null;
    }
    // Fall through to KV lookup for ctx: and fsm: keys
  }
  
  try {
    if (!env.NETCAR_CACHE) {
      console.log(`[KV] Not available, skipping: ${key}`);
      return null;
    }
    
    const cached = await env.NETCAR_CACHE.get(key, 'json');
    if (cached) {
      console.log(`[KV] HIT for key: ${key}`);
      return cached as T;
    }
    console.log(`[KV] MISS for key: ${key}`);
    return null;
  } catch (error) {
    console.error(`[KV] Error getting ${key}:`, error);
    return null;
  }
}

/**
 * Set data in KV cache (persistent)
 * For high-frequency keys, uses in-memory cache instead to avoid KV limits
 */
export async function setInKV(
  env: Env,
  key: string,
  data: any,
  ttlSeconds: number = CACHE_TTL_SECONDS.STOCK
): Promise<void> {
  // For high-frequency keys, use in-memory cache only (avoid KV write limits)
  // These keys are written frequently and can afford to be ephemeral
  const useInMemory = 
    key.startsWith('search_') || 
    key.startsWith('session:') ||
    key.startsWith('ctx:') ||       // Conversation context - very frequent
    key.startsWith('fsm:') ||       // FSM state - every message
    key.startsWith('summary:') ||   // Turn summary - every turn
    key.startsWith('debounce:') ||  // Debounce locks - very frequent
    key.startsWith('state:');       // Session state - frequent
  
  if (useInMemory) {
    // LRU eviction if cache is full
    if (searchCache.size >= MAX_SEARCH_CACHE_SIZE) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [k, v] of searchCache.entries()) {
        if (v.accessTime < oldestTime) {
          oldestTime = v.accessTime;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        searchCache.delete(oldestKey);
        console.log(`[CACHE] LRU evicted: ${oldestKey}`);
      }
    }
    
    searchCache.set(key, {
      data,
      expiry: Date.now() + (ttlSeconds * 1000),
      accessTime: Date.now(),
    });
    
    // CRITICAL FIX: ctx: and fsm: keys should ALSO persist to KV for cross-isolate persistence
    // This ensures context is preserved when requests hit different Workers
    const shouldAlsoPersistToKV = key.startsWith('ctx:') || key.startsWith('fsm:');
    if (!shouldAlsoPersistToKV) {
      return;
    }
    // Fall through to also persist to KV
  }
  
  try {
    if (!env.NETCAR_CACHE) {
      console.log(`[KV] Not available, skipping set: ${key}`);
      return;
    }
    
    await env.NETCAR_CACHE.put(key, JSON.stringify(data), {
      expirationTtl: ttlSeconds,
    });
    console.log(`[KV] SET key: ${key}, TTL: ${ttlSeconds}s`);
  } catch (error) {
    console.error(`[KV] Error setting ${key}:`, error);
  }
}

/**
 * Delete from KV cache
 */
export async function deleteFromKV(env: Env, key: string): Promise<void> {
  // Also delete from search cache
  if (key.startsWith('search_') || key.startsWith('session:')) {
    searchCache.delete(key);
  }
  
  try {
    if (!env.NETCAR_CACHE) return;
    await env.NETCAR_CACHE.delete(key);
    console.log(`[KV] DELETE key: ${key}`);
  } catch (error) {
    console.error(`[KV] Error deleting ${key}:`, error);
  }
}

// ==================== R2 IMAGE CACHE ====================

/**
 * Cache image in R2 and return the key
 * For future: Can serve via custom domain for faster delivery
 */
export async function cacheImageInR2(
  env: Env,
  imageUrl: string
): Promise<string> {
  try {
    if (!env.CACHE_BUCKET) {
      console.log(`[R2] Not available, using original URL`);
      return imageUrl;
    }
    
    // Generate key from URL
    const urlHash = await hashString(imageUrl);
    const key = `images/${urlHash}`;
    
    // Check if already cached
    const existing = await env.CACHE_BUCKET.head(key);
    if (existing) {
      console.log(`[R2] Image already cached: ${key}`);
      return imageUrl; // For now, return original (needs custom domain for R2 public)
    }
    
    // Fetch and cache
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`[R2] Failed to fetch image: ${imageUrl}`);
      // Cancel body to prevent stalled response warning
      try { await response.body?.cancel(); } catch { /* Ignore stream already consumed */ }
      return imageUrl;
    }
    
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    await env.CACHE_BUCKET.put(key, imageBuffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=86400',
      },
    });
    
    console.log(`[R2] Cached image: ${key} (${imageBuffer.byteLength} bytes)`);
    
    return imageUrl; // Return original for now
  } catch (error) {
    console.error(`[R2] Error caching image:`, error);
    return imageUrl;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Simple hash function for generating cache keys
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// Export TTL constants for use in other services
export { CACHE_TTL, CACHE_TTL_SECONDS };
