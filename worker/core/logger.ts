import type { Env } from '../types';

/**
 * Logger Service - Structured logging with levels and Datadog integration
 * 
 * Levels:
 * - debug: Verbose development logs (disabled in production by default)
 * - info: General operational information
 * - warning: Potential issues that don't break functionality
 * - error: Errors that need attention
 */

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

interface LogEntry {
  source: 'worker' | 'admin' | 'evolution' | 'backend';
  level: LogLevel;
  message: string;
  stack_trace?: string;
  telefone?: string;
  metadata?: Record<string, unknown>;
}

// Admin phone for critical alerts
const ADMIN_PHONE = '5522992363462@s.whatsapp.net'; // Netcar admin (Updated)

// Log level priority (higher = more important)
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/**
 * Check if a log level should be output based on environment
 */
function shouldLog(level: LogLevel, env?: Env): boolean {
  const minLevel = env?.LOG_LEVEL as LogLevel || 'info';
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

/**
 * Send WhatsApp alert to admin
 */
async function sendWhatsAppAlert(message: string, env: Env): Promise<void> {
  try {
    const url = `${env.EVOLUTION_API_URL}/message/sendText/${env.EVOLUTION_INSTANCE}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': env.EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        number: ADMIN_PHONE,
        text: `🚨 *ALERTA DO SISTEMA*\n\n${message}\n\n_Horário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`,
      }),
    });
    // Consume body to prevent stalled response warning
    await response.text();
  } catch (error) {
    // Silent fail - don't log recursively
  }
}

/**
 * Log an entry to D1 and console
 */
export async function logEntry(entry: LogEntry, env: Env): Promise<void> {
  if (!shouldLog(entry.level, env)) return;
  
  try {
    // 1. D1 Insert (only for warning/error to avoid spam)
    if (env.DB && (entry.level === 'warning' || entry.level === 'error')) {
      await env.DB.prepare(
        `INSERT INTO error_logs (source, level, message, metadata, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(
        entry.source,
        entry.level,
        entry.message,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        new Date().toISOString()
      ).run();
    }
    
    // 2. Console output with proper level
    const prefix = `[${entry.source.toUpperCase()}]`;
    const msg = `${prefix} ${entry.message}`;
    
    switch (entry.level) {
      case 'debug':
        // eslint-disable-next-line no-console
        console.debug(msg, entry.metadata || '');
        break;
      case 'info':
        // eslint-disable-next-line no-console
        console.log(msg, entry.metadata || '');
        break;
      case 'warning':
        // eslint-disable-next-line no-console
        console.warn(msg, entry.metadata || '');
        break;
      case 'error':
        // eslint-disable-next-line no-console
        console.error(msg, entry.stack_trace || '', entry.metadata || '');
        break;
    }
    
    // 3. WhatsApp Alert (Critical/Warning only)
    if (entry.level === 'error' || entry.level === 'warning') {
      await sendWhatsAppAlert(
        `*${entry.level === 'error' ? '🔴 ERRO' : '⚠️ ALERTA'} no ${entry.source}*\n${entry.message}`,
        env
      );
    }
  } catch {
    // Don't throw - logging should never break the main flow
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a logger instance for a specific source
 * Usage: const log = createLogger('worker', env);
 *        log.info('Message here', { extra: 'data' });
 */
export function createLogger(source: LogEntry['source'], env: Env) {
  return {
    debug: (message: string, metadata?: Record<string, unknown>) => 
      logEntry({ source, level: 'debug', message, metadata }, env),
    
    info: (message: string, metadata?: Record<string, unknown>) => 
      logEntry({ source, level: 'info', message, metadata }, env),
    
    warn: (message: string, metadata?: Record<string, unknown>) => 
      logEntry({ source, level: 'warning', message, metadata }, env),
    
    error: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => {
      const errorObj = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
      return logEntry({ 
        source, 
        level: 'error', 
        message, 
        stack_trace: errorObj?.stack,
        metadata: { ...metadata, errorMessage: errorObj?.message }
      }, env);
    },
  };
}

// =============================================================================
// LEGACY EXPORTS (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use logEntry or createLogger instead
 */
export async function logError(entry: LogEntry, env: Env): Promise<void> {
  await logEntry(entry, env);
}

/**
 * Log error with automatic stack trace extraction
 */
export async function logException(
  error: Error | unknown,
  source: LogEntry['source'],
  telefone: string | undefined,
  env: Env,
  metadata?: Record<string, unknown>
): Promise<void> {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  
  await logEntry({
    source,
    level: 'error',
    message: errorObj.message,
    stack_trace: errorObj.stack,
    telefone,
    metadata,
  }, env);
}

/**
 * Log a warning
 */
export async function logWarning(
  message: string,
  source: LogEntry['source'],
  env: Env,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logEntry({
    source,
    level: 'warning',
    message,
    metadata,
  }, env);
}

/**
 * Log info (new)
 */
export async function logInfo(
  message: string,
  source: LogEntry['source'],
  env: Env,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logEntry({
    source,
    level: 'info',
    message,
    metadata,
  }, env);
}

/**
 * Log debug (new)
 */
export async function logDebug(
  message: string,
  source: LogEntry['source'],
  env: Env,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logEntry({
    source,
    level: 'debug',
    message,
    metadata,
  }, env);
}

