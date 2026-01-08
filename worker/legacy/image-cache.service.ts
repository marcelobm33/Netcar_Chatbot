
import type { Env } from '@types';

/**
 * Image Caching Service
 * Proxies and caches external images (via R2) to ensure Evolution API can send them reliability.
 */

// HARDCODED WORKER URL (Should be env var in future, but stable for now)
const WORKER_URL = "https://netcar-worker.contato-11e.workers.dev";

export async function getOrCacheImage(originalUrl: string, env: Env): Promise<string> {
  // If already internal, return as is
  if (originalUrl.includes(WORKER_URL)) {
    return originalUrl;
  }

  // 1. Compute Hash for Cache Key
  const hash = await sha256(originalUrl);
  
  // Extension extraction (robust)
  const ext = originalUrl.split('.').pop()?.split(/[#?]/)[0]?.substring(0, 4) || 'jpg';
  const key = `${hash}.${ext}`;
  const cachedUrl = `${WORKER_URL}/images/${key}`;

  try {
    // 2. Check R2 Existence (HEAD)
    const exists = await env.IMAGES.head(key);
    
    if (exists) {
        // Verify it's not empty/zero size if possible, but head is usually enough
        console.log(`[CACHE] Hit: ${key}`);
        return cachedUrl;
    }

    console.log(`[CACHE] Miss: ${originalUrl} -> Fetching...`);

    // 3. Fetch from Source
    // Handle spaces/etc by ensuring encoding
    // If double encoded, decode first? No, assume raw string.
    // encodeURI handles spaces but leaves protocols alone.
    const safeUrl = encodeURI(decodeURI(originalUrl)); 

    const response = await fetch(safeUrl, {
      method: "GET",
      headers: {
        "User-Agent": "NetcarBot/1.0 (Cloudflare Worker)",
        "Accept": "image/*"
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: true
      }
    });

    if (!response.ok) {
      console.warn(`[CACHE] Source fetch failed (${response.status}) for ${originalUrl}`);
      return originalUrl; // Fallback to original
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();

    if (buffer.byteLength === 0) {
        throw new Error("Empty image buffer");
    }

    // 4. Save to R2
    console.log(`[CACHE] Saving ${buffer.byteLength} bytes to R2: ${key}`);
    await env.IMAGES.put(key, buffer, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: "public, max-age=31536000" // 1 year cache header
      }
    });

    return cachedUrl;

  } catch (error) {
    console.error(`[CACHE] Error caching image:`, error);
    return originalUrl; // Fallback
  }
}

// Helper: SHA-256 Hex
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16); // Short hash (16 chars)
}
