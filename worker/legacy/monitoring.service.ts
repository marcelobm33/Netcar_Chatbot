/**
 * Simplified Monitoring Service
 * Uses console.log for logging (Cloudflare Workers native logging)
 * 
 * Removed: Datadog and Sentry integrations
 */

import type { Env } from '@types';

/**
 * Initialize monitoring for the current request
 */
export function initMonitoring(): void {
  // No-op - native logging doesn't need initialization
}

/**
 * Capture and report an error
 */
export function captureError(
  error: Error | string,
  context?: Record<string, unknown>
): void {
  console.error('[ERROR]', error instanceof Error ? error.message : error, context || '');
}

/**
 * Log an info message
 */
export function logInfo(
  message: string,
  attributes?: Record<string, unknown>
): void {
  console.log('[INFO]', message, attributes ? JSON.stringify(attributes) : '');
}

/**
 * Log a warning
 */
export function logWarning(
  message: string,
  attributes?: Record<string, unknown>
): void {
  console.warn('[WARN]', message, attributes ? JSON.stringify(attributes) : '');
}

/**
 * Log an error
 */
export function logError(
  message: string,
  attributes?: Record<string, unknown>
): void {
  console.error('[ERROR]', message, attributes ? JSON.stringify(attributes) : '');
}

/**
 * Track a metric (no-op without Datadog)
 */
export function trackMetric(
  name: string,
  value: number,
  type: 'count' | 'gauge' | 'rate' = 'count',
  tags?: string[]
): void {
  // No-op - metrics disabled
}

/**
 * Set user context (no-op without external services)
 */
export function setUser(user: {
  id?: string;
  phone?: string;
  name?: string;
}): void {
  // No-op
}

/**
 * Set additional context (no-op without external services)
 */
export function setContext(
  name: string,
  context: Record<string, unknown>
): void {
  // No-op
}

/**
 * Set a tag (no-op without external services)
 */
export function setTag(key: string, value: string): void {
  // No-op
}

/**
 * Start a trace/timer
 */
export function traceStart(): number {
  return Date.now();
}

/**
 * End a trace and report duration
 */
export function traceEnd(
  startTime: number,
  operation: string,
  success = true
): void {
  const duration = Date.now() - startTime;
  console.log(`[TRACE] ${operation}: ${duration}ms (${success ? 'success' : 'failed'})`);
}

/**
 * Track webhook received
 */
export function webhookReceived(
  event: string,
  sender: string,
  hasImage: boolean
): void {
  console.log(`[WEBHOOK] Received: ${event} from ${sender}${hasImage ? ' (with image)' : ''}`);
}

/**
 * Track webhook processing completed
 */
export function webhookProcessed(
  sender: string,
  duration: number,
  success: boolean
): void {
  console.log(`[WEBHOOK] Processed: ${sender} in ${duration}ms (${success ? 'success' : 'failed'})`);
}

/**
 * Track AI call
 */
export function aiCall(model: string, hasImage: boolean): void {
  console.log(`[AI] Call: ${model}${hasImage ? ' (with image)' : ''}`);
}

/**
 * Track AI response
 */
export function aiResponse(
  model: string,
  duration: number,
  tokens?: number
): void {
  console.log(`[AI] Response: ${model} in ${duration}ms${tokens ? ` (${tokens} tokens)` : ''}`);
}

/**
 * Flush all pending data (no-op without external services)
 */
export async function flushMonitoring(): Promise<void> {
  // No-op - native logging is synchronous
}

/**
 * Wrap a handler with error boundary
 */
export async function withMonitoring<T>(
  handler: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const start = traceStart();

  try {
    const result = await handler();
    traceEnd(start, 'request', true);
    return result;
  } catch (error) {
    traceEnd(start, 'request', false);
    captureError(error instanceof Error ? error : new Error(String(error)), context);
    throw error;
  }
}
