/**
 * Message Debounce Service
 * 
 * Aggregates multiple messages from the same user before processing.
 * This prevents the bot from responding too quickly when user is typing
 * multiple messages in sequence.
 * 
 * Strategy:
 * 1. When a message arrives, add to buffer in-memory
 * 2. Wait 800ms before processing
 * 3. On processing, check if there are newer messages in buffer
 * 4. If yes, combine all messages and process together
 * 
 * OPTIMIZATION (Dec 2024):
 * Migrated from KV to in-memory to avoid KV put() limit exceeded errors.
 * In-memory is faster and has no rate limits. The tradeoff is that buffers
 * don't persist across Worker isolates, but Cloudflare's Smart Placement
 * routes same users to same Workers, so this works well in practice.
 */

import type { Env } from '@types';

const DEBOUNCE_DELAY_MS = 5000; // 5000ms (increased further to prevent duplicate responses when user sends multiple messages)
const BUFFER_EXPIRY_MS = 60000; // 60 seconds - auto-cleanup old buffers
const LOCK_EXPIRY_MS = 60000; // 60 seconds - auto-cleanup old locks

interface MessageBuffer {
  messages: Array<{
    text: string;
    timestamp: number;
    messageId: string;
    hasImage?: boolean;
    imageUrl?: string;
  }>;
  firstMessageAt: number;
  lastMessageAt: number;
  isProcessing: boolean;
}

interface ProcessingLock {
  timestamp: number;
  workerId: string;
}

// ==================== IN-MEMORY STORAGE ====================
// Global Maps that persist across requests in the same Worker isolate
// This is much faster than KV and has no rate limits

const messageBuffers = new Map<string, MessageBuffer>();
const processingLocks = new Map<string, ProcessingLock>();

// Track last cleanup time to avoid cleaning on every request
let lastCleanupTime = 0;

/**
 * Cleanup expired entries (called periodically)
 * Runs max once per 10 seconds to avoid overhead
 */
function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupTime < 10000) return; // Max once per 10s
  
  lastCleanupTime = now;
  let cleanedBuffers = 0;
  let cleanedLocks = 0;
  
  // Cleanup old message buffers
  for (const [key, buffer] of messageBuffers.entries()) {
    if (now - buffer.lastMessageAt > BUFFER_EXPIRY_MS) {
      messageBuffers.delete(key);
      cleanedBuffers++;
    }
  }
  
  // Cleanup old locks
  for (const [key, lock] of processingLocks.entries()) {
    if (now - lock.timestamp > LOCK_EXPIRY_MS) {
      processingLocks.delete(key);
      cleanedLocks++;
    }
  }
  
  if (cleanedBuffers > 0 || cleanedLocks > 0) {
    console.log(`[DEBOUNCE] Cleanup: ${cleanedBuffers} buffers, ${cleanedLocks} locks expired`);
  }
}

/**
 * Get the key for a sender (normalize phone number)
 */
function getKey(sender: string): string {
  return sender.replace('@s.whatsapp.net', '');
}

/**
 * Add a message to the buffer for debouncing
 * Returns true if this message should trigger processing (after delay)
 */
export async function bufferMessage(
  sender: string,
  text: string,
  messageId: string,
  env: Env,
  hasImage: boolean = false,
  imageUrl?: string
): Promise<boolean> {
  maybeCleanup();
  
  const key = getKey(sender);
  const now = Date.now();
  
  // Get existing buffer or create new
  let buffer = messageBuffers.get(key);
  
  if (!buffer) {
    buffer = {
      messages: [],
      firstMessageAt: now,
      lastMessageAt: now,
      isProcessing: false
    };
  }
  
  // If already processing, don't buffer (let the message through)
  if (buffer.isProcessing) {
    console.log(`[DEBOUNCE] Already processing for ${sender}, letting message through`);
    return true;
  }
  
  // Add message to buffer
  buffer.messages.push({
    text,
    timestamp: now,
    messageId,
    hasImage,
    imageUrl
  });
  buffer.lastMessageAt = now;
  
  // Save buffer (in-memory, instant)
  messageBuffers.set(key, buffer);
  
  console.log(`[DEBOUNCE] Buffered message ${buffer.messages.length} from ${sender}: "${text.substring(0, 30)}..."`);
  
  // Return true only if this is the first message (trigger delay)
  return buffer.messages.length === 1;
}

/**
 * Check if we should process now or wait more
 * Called after the delay to see if more messages arrived
 */
export async function shouldProcessNow(sender: string, env: Env): Promise<boolean> {
  const key = getKey(sender);
  const buffer = messageBuffers.get(key);
  
  if (!buffer) return true; // No buffer, process immediately
  
  const now = Date.now();
  const timeSinceLastMessage = now - buffer.lastMessageAt;
  
  // If last message was received less than 2 seconds ago, wait more
  if (timeSinceLastMessage < 2000) {
    console.log(`[DEBOUNCE] Last message was ${timeSinceLastMessage}ms ago, waiting more...`);
    return false;
  }
  
  return true;
}

/**
 * Try to acquire a processing lock for this sender
 * Returns true if lock acquired, false if another process is already handling it
 * 
 * DUAL-LAYER LOCK:
 * 1. In-memory lock (fast, for same-isolate serialization)
 * 2. KV-based lock (distributed, for cross-isolate protection)
 */
export async function acquireProcessingLock(sender: string, env: Env): Promise<boolean> {
  const key = getKey(sender);
  const kvLockKey = `lock:${key}`;
  const now = Date.now();
  const lockId = `${now}-${Math.random().toString(36).substring(7)}`;
  
  // Layer 1: Check in-memory lock first (fast path)
  const existingMemLock = processingLocks.get(key);
  if (existingMemLock && (now - existingMemLock.timestamp) < LOCK_EXPIRY_MS) {
    console.log(`[DEBOUNCE] In-memory lock exists for ${sender}, age: ${now - existingMemLock.timestamp}ms`);
    return false;
  }
  
  // Layer 2: Check KV distributed lock (cross-isolate protection)
  try {
    const existingKvLock = await env.NETCAR_CACHE.get(kvLockKey);
    if (existingKvLock) {
      const lockData = JSON.parse(existingKvLock) as { timestamp: number; workerId: string };
      if (now - lockData.timestamp < 60000) { // 60 second TTL for KV lock (aligned with expirationTtl)
        console.log(`[DEBOUNCE] KV distributed lock exists for ${sender}, age: ${now - lockData.timestamp}ms`);
        return false;
      }
    }
    
    // Acquire KV lock with short TTL (60 seconds minimum for Cloudflare KV - auto-cleanup if worker crashes)
    await env.NETCAR_CACHE.put(kvLockKey, JSON.stringify({ timestamp: now, workerId: lockId }), {
      expirationTtl: 60 // 60 seconds TTL (Cloudflare KV minimum)
    });
  } catch (e) {
    console.warn(`[DEBOUNCE] KV lock check/acquire failed, continuing with in-memory only:`, e);
    // Continue with in-memory lock only if KV fails
  }
  
  // Acquire in-memory lock
  processingLocks.set(key, { timestamp: now, workerId: lockId });
  
  console.log(`[DEBOUNCE] Acquired dual-layer lock for ${sender} (lockId: ${lockId})`);
  return true;
}

/**
 * Release the processing lock (both in-memory and KV)
 */
export async function releaseProcessingLock(sender: string, env: Env): Promise<void> {
  const key = getKey(sender);
  const kvLockKey = `lock:${key}`;
  
  // Release in-memory lock
  processingLocks.delete(key);
  
  // Release KV distributed lock
  try {
    await env.NETCAR_CACHE.delete(kvLockKey);
  } catch (e) {
    console.warn(`[DEBOUNCE] Failed to delete KV lock, will auto-expire:`, e);
  }
  
  console.log(`[DEBOUNCE] Released dual-layer lock for ${sender}`);
}


/**
 * Get all buffered messages and clear the buffer
 * Also marks buffer as "processing" to prevent race conditions
 * 
 * IMPORTANT: Caller MUST have already acquired the lock via acquireProcessingLock()
 * This function does NOT acquire a lock to avoid deadlocks
 */
export async function getBufferedMessages(
  sender: string, 
  env: Env
): Promise<{ 
  combinedText: string; 
  messageIds: string[];
  hasImage: boolean;
  imageUrl?: string;
} | null> {
  const key = getKey(sender);
  
  // NOTE: Lock acquisition removed to avoid deadlock
  // Caller is responsible for acquiring lock via acquireProcessingLock()
  
  const buffer = messageBuffers.get(key);
  
  if (!buffer || buffer.messages.length === 0) {
    console.log(`[DEBOUNCE] No buffered messages for ${sender}`);
    return null;
  }
  
  // If already marked as processing by another instance, skip
  if (buffer.isProcessing) {
    console.log(`[DEBOUNCE] Buffer already being processed for ${sender}, skipping`);
    return null;
  }
  
  // Mark as processing
  buffer.isProcessing = true;
  messageBuffers.set(key, buffer);
  
  // Combine all messages
  const combinedText = buffer.messages
    .map(m => m.text)
    .filter(t => t && t.trim().length > 0)
    .join('\n');
  
  const messageIds = buffer.messages.map(m => m.messageId);
  const hasImage = buffer.messages.some(m => m.hasImage);
  const imageUrl = buffer.messages.find(m => m.imageUrl)?.imageUrl;
  
  console.log(`[DEBOUNCE] Processing ${buffer.messages.length} messages: "${combinedText.substring(0, 50)}..."`);
  
  // Clear buffer after getting messages
  messageBuffers.delete(key);
  
  // Note: Lock will be released by caller after processing completes
  
  return {
    combinedText,
    messageIds,
    hasImage,
    imageUrl
  };
}

/**
 * Clear the buffer without processing (e.g., on error)
 */
export async function clearBuffer(sender: string, env: Env): Promise<void> {
  const key = getKey(sender);
  messageBuffers.delete(key);
  console.log(`[DEBOUNCE] Buffer cleared for ${sender}`);
}

/**
 * Get the debounce delay in milliseconds
 */
export function getDebounceDelay(): number {
  return DEBOUNCE_DELAY_MS;
}

/**
 * Get stats for debugging
 */
export function getDebounceStats(): { bufferCount: number; lockCount: number } {
  return {
    bufferCount: messageBuffers.size,
    lockCount: processingLocks.size
  };
}
