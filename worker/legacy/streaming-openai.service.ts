/**
 * OpenAI Streaming Service using Vercel AI SDK
 * 
 * Benefits:
 * - Streaming responses (user sees text appearing)
 * - Automatic retries with backoff
 * - Type-safe API
 * - Smaller bundle than raw fetch implementation
 */

import { createOpenAI } from 'ai';
import { generateText, streamText } from 'ai';
import type { Env } from '@types';
import { sanitizeUserInput } from './security.service';
import { createLogger } from './logger.service';

// Re-export types for compatibility
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamCallbacks {
  onChunk?: (chunk: string) => void | Promise<void>;
  onComplete?: (fullText: string) => void | Promise<void>;
}

/**
 * Get OpenAI client configured for the environment
 */
function getOpenAIClient(env: Env, isDeepSeek: boolean = false) {
  const CF_ACCOUNT_ID = '11edc212d8f0ae41b9594f87b2724ea4';
  const CF_GATEWAY_ID = 'netcar-ian';
  
  if (isDeepSeek) {
    return createOpenAI({
      apiKey: env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY,
      baseURL: 'https://api.deepseek.com/v1',
    });
  }
  
  // Use Cloudflare AI Gateway for caching/logging
  return createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`,
  });
}

/**
 * Determine which model to use (DB > env > default)
 */
async function resolveModel(env: Env, requestedModel?: string): Promise<{ model: string; isDeepSeek: boolean }> {
  let model = requestedModel;
  
  if (!model) {
    try {
      const { DBService } = await import('./db.service');
      const db = new DBService(env.DB);
      const dbModel = await db.getConfig('ai_model');
      if (dbModel?.trim()) {
        model = dbModel.trim();
      }
    } catch {
      // Ignore DB errors, use fallback
    }
  }
  
  model = model || env.AI_MODEL || 'gpt-4.1';
  const isFineTuned = model.startsWith('ft:');
  const isDeepSeek = model.toLowerCase().includes('deepseek') && !isFineTuned;
  
  return { model, isDeepSeek };
}

/**
 * Sanitize messages for safety
 */
function sanitizeMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return { ...msg, content: sanitizeUserInput(msg.content) };
    }
    return msg;
  });
}

/**
 * Call OpenAI with streaming support
 * 
 * @param messages - Chat messages
 * @param env - Cloudflare environment
 * @param callbacks - Optional callbacks for streaming
 * @returns Full response text
 */
export async function callOpenAIStream(
  messages: OpenAIMessage[],
  env: Env,
  callbacks?: StreamCallbacks,
  options?: { model?: string; temperature?: number }
): Promise<string> {
  const log = createLogger('worker', env);
  const { model, isDeepSeek } = await resolveModel(env, options?.model);
  const temperature = options?.temperature ?? 0.7;
  
  log.info(`[AI-STREAM] Using ${model} (streaming: ${!!callbacks?.onChunk})`);
  
  const openai = getOpenAIClient(env, isDeepSeek);
  const sanitizedMessages = sanitizeMessages(messages);
  
  const startTime = Date.now();
  
  try {
    // If no streaming callbacks, use simple generateText
    if (!callbacks?.onChunk) {
      const result = await generateText({
        model: openai(model),
        messages: sanitizedMessages,
        temperature,
      });
      
      log.info(`[AI-STREAM] Complete in ${Date.now() - startTime}ms: ${result.text.substring(0, 80)}...`);
      
      if (callbacks?.onComplete) {
        await callbacks.onComplete(result.text);
      }
      
      return result.text;
    }
    
    // Streaming mode
    const result = await streamText({
      model: openai(model),
      messages: sanitizedMessages,
      temperature,
    });
    
    let fullText = '';
    
    for await (const chunk of result.textStream) {
      fullText += chunk;
      if (callbacks.onChunk) {
        await callbacks.onChunk(chunk);
      }
    }
    
    log.info(`[AI-STREAM] Streamed in ${Date.now() - startTime}ms: ${fullText.substring(0, 80)}...`);
    
    if (callbacks.onComplete) {
      await callbacks.onComplete(fullText);
    }
    
    return fullText;
    
  } catch (error) {
    log.error('[AI-STREAM] Error:', { error });
    throw error;
  }
}

/**
 * Generate AI response with automatic chunked sending to WhatsApp
 * Sends partial messages as they stream in for better UX
 * 
 * @param messages - Chat messages
 * @param env - Cloudflare environment  
 * @param sendPartial - Function to send partial message to user
 * @param chunkSize - Characters to accumulate before sending (default: 100)
 */
export async function callOpenAIWithProgress(
  messages: OpenAIMessage[],
  env: Env,
  sendPartial: (text: string) => Promise<void>,
  chunkSize: number = 100
): Promise<string> {
  let buffer = '';
  let sentLength = 0;
  
  const fullText = await callOpenAIStream(messages, env, {
    onChunk: async (chunk) => {
      buffer += chunk;
      
      // Send when buffer exceeds chunk size
      if (buffer.length - sentLength >= chunkSize) {
        // Find a good break point (sentence end or word boundary)
        const breakPoint = findBreakPoint(buffer, sentLength + chunkSize);
        if (breakPoint > sentLength) {
          await sendPartial(buffer.substring(0, breakPoint));
          sentLength = breakPoint;
        }
      }
    },
    onComplete: async () => {
      // Send remaining buffer
      if (buffer.length > sentLength) {
        await sendPartial(buffer);
      }
    }
  });
  
  return fullText;
}

/**
 * Find a good break point for sending partial text
 */
function findBreakPoint(text: string, targetPos: number): number {
  // Look for sentence endings first
  const sentenceEnd = /[.!?]\s/g;
  let lastMatch = 0;
  let match;
  
  while ((match = sentenceEnd.exec(text)) !== null) {
    if (match.index + 2 <= targetPos) {
      lastMatch = match.index + 2;
    } else {
      break;
    }
  }
  
  if (lastMatch > 0) return lastMatch;
  
  // Fall back to word boundary
  const lastSpace = text.lastIndexOf(' ', targetPos);
  return lastSpace > 0 ? lastSpace : targetPos;
}
