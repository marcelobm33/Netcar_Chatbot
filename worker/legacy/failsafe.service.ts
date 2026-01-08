/**
 * Failsafe Service - Handles failed message processing
 * Saves pending messages for retry and sends fallback responses
 * Works with Recovery Service to ensure no customer is left unanswered
 */

import type { Env } from '@types';

const FALLBACK_MESSAGE = "Oi! Recebi tua mensagem. Me diz, em que posso te ajudar?";
const PENDING_TTL_SECONDS = 3600; // 1 hour

interface PendingMessage {
  sender: string;
  content: string;
  timestamp: number;
  retryCount: number;
  leadId?: string;
}

/**
 * Save a message that failed to process for later retry
 */
export async function savePendingMessage(
  sender: string,
  content: string,
  env: Env,
  leadId?: string
): Promise<void> {
  const key = `pending:${sender.replace('@s.whatsapp.net', '').replace('@lid', '')}`;
  
  try {
    // Check if already exists
    const existing = await env.NETCAR_CACHE.get(key);
    let retryCount = 0;
    
    if (existing) {
      const parsed = JSON.parse(existing) as PendingMessage;
      retryCount = parsed.retryCount + 1;
      console.log(`[FAILSAFE] Updating pending message for ${sender}, retry #${retryCount}`);
    }
    
    const pending: PendingMessage = {
      sender,
      content,
      timestamp: Date.now(),
      retryCount,
      leadId
    };
    
    await env.NETCAR_CACHE.put(key, JSON.stringify(pending), {
      expirationTtl: PENDING_TTL_SECONDS
    });
    
    console.log(`[FAILSAFE] 💾 Saved pending message for ${sender}`);
  } catch (error) {
    console.error(`[FAILSAFE] Failed to save pending message:`, error);
  }
}

/**
 * Get pending message for a sender
 */
export async function getPendingMessage(
  sender: string,
  env: Env
): Promise<PendingMessage | null> {
  const key = `pending:${sender.replace('@s.whatsapp.net', '').replace('@lid', '')}`;
  
  try {
    const data = await env.NETCAR_CACHE.get(key);
    if (data) {
      return JSON.parse(data) as PendingMessage;
    }
  } catch (error) {
    console.error(`[FAILSAFE] Failed to get pending message:`, error);
  }
  
  return null;
}

/**
 * Clear pending message after successful processing
 */
export async function clearPendingMessage(
  sender: string,
  env: Env
): Promise<void> {
  const key = `pending:${sender.replace('@s.whatsapp.net', '').replace('@lid', '')}`;
  
  try {
    await env.NETCAR_CACHE.delete(key);
    console.log(`[FAILSAFE] ✅ Cleared pending message for ${sender}`);
  } catch (error) {
    console.error(`[FAILSAFE] Failed to clear pending message:`, error);
  }
}

/**
 * Send fallback message when processing fails
 * Returns true if sent successfully
 */
export async function sendFallbackMessage(
  sender: string,
  env: Env
): Promise<boolean> {
  try {
    const { sendMessage } = await import('./evolution.service');
    
    console.log(`[FAILSAFE] 📤 Sending fallback message to ${sender}`);
    await sendMessage(sender, FALLBACK_MESSAGE, env);
    
    console.log(`[FAILSAFE] ✅ Fallback sent successfully`);
    return true;
  } catch (error) {
    console.error(`[FAILSAFE] ❌ Failed to send fallback:`, error);
    return false;
  }
}

/**
 * Handle webhook processing failure
 * 1. Save the message for retry
 * 2. Send fallback message to customer
 * 3. Mark for recovery sweep
 */
export async function handleProcessingFailure(
  sender: string,
  messageContent: string,
  env: Env,
  leadId?: string
): Promise<void> {
  console.log(`[FAILSAFE] 🚨 Processing failed for ${sender}, activating fallback...`);
  
  // 1. Save for retry
  await savePendingMessage(sender, messageContent, env, leadId);
  
  // 2. Try to send fallback message
  const fallbackSent = await sendFallbackMessage(sender, env);
  
  if (!fallbackSent) {
    console.log(`[FAILSAFE] ⚠️ Could not send fallback, will retry via recovery sweep`);
  }
  
  // 3. The recovery service will pick this up if no response is registered
}

/**
 * Check if sender has a pending failed message
 */
export async function hasPendingFailure(
  sender: string,
  env: Env
): Promise<boolean> {
  const pending = await getPendingMessage(sender, env);
  return pending !== null;
}
