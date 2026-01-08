/**
 * Retry Service - Intelligent Retry with Exponential Backoff
 * 
 * Provides resilient API calls for:
 * - OpenAI API
 * - Evolution API (WhatsApp)
 * - Any async operation that may fail transiently
 */

// =============================================================================
// TYPES
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number;
  
  /** Maximum delay between retries in ms (default: 10000) */
  maxDelayMs?: number;
  
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  
  /** Timeout for each individual attempt in ms (default: 30000) */
  timeoutMs?: number;
  
  /** Error types that should be retried (default: all) */
  retryableErrors?: string[];
  
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'retryableErrors'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  timeoutMs: 30000,
};

// Errors that are worth retrying (transient failures)
const RETRYABLE_ERROR_PATTERNS = [
  'fetch failed',
  'network',
  'timeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up',
  '429', // Rate limit
  '500', // Internal server error
  '502', // Bad gateway
  '503', // Service unavailable
  '504', // Gateway timeout
];

// =============================================================================
// HELPERS
// =============================================================================

function isRetryableError(error: Error, customPatterns?: string[]): boolean {
  const errorMessage = error.message.toLowerCase();
  const patterns = customPatterns || RETRYABLE_ERROR_PATTERNS;
  
  return patterns.some(pattern => 
    errorMessage.includes(pattern.toLowerCase())
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number, 
  initialDelay: number, 
  multiplier: number, 
  maxDelay: number
): number {
  // Exponential backoff with jitter
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  const delayWithJitter = exponentialDelay + jitter;
  
  return Math.min(delayWithJitter, maxDelay);
}

// =============================================================================
// MAIN RETRY FUNCTION
// =============================================================================

/**
 * Execute an async operation with retries and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      // Create timeout wrapper
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);
      });
      
      // Race between operation and timeout
      const data = await Promise.race([operation(), timeoutPromise]);
      
      return {
        success: true,
        data,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      const isLastAttempt = attempt > opts.maxRetries;
      const isRetryable = isRetryableError(lastError, opts.retryableErrors);
      
      if (isLastAttempt || !isRetryable) {
        console.error(`[RETRY] Failed after ${attempt} attempts:`, lastError.message);
        return {
          success: false,
          error: lastError,
          attempts: attempt,
          totalTimeMs: Date.now() - startTime,
        };
      }
      
      // Calculate delay for next retry
      const delay = calculateDelay(
        attempt, 
        opts.initialDelayMs, 
        opts.backoffMultiplier, 
        opts.maxDelayMs
      );
      
      console.warn(`[RETRY] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${Math.round(delay)}ms...`);
      
      // Call retry callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt, lastError, delay);
      }
      
      await sleep(delay);
    }
  }
  
  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    error: lastError || new Error('Unknown error'),
    attempts: opts.maxRetries + 1,
    totalTimeMs: Date.now() - startTime,
  };
}

// =============================================================================
// SPECIALIZED RETRY WRAPPERS
// =============================================================================

/**
 * Retry wrapper for OpenAI API calls
 */
export async function retryOpenAI<T>(
  operation: () => Promise<T>,
  customOptions: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  return withRetry(operation, {
    maxRetries: 2,
    initialDelayMs: 1000,
    timeoutMs: 60000, // OpenAI can be slow
    ...customOptions,
    onRetry: (attempt, error, delay) => {
      console.warn(`[OPENAI-RETRY] Attempt ${attempt} failed: ${error.message}. Next retry in ${Math.round(delay)}ms`);
    },
  });
}

/**
 * Retry wrapper for Evolution API (WhatsApp) calls
 */
export async function retryEvolution<T>(
  operation: () => Promise<T>,
  customOptions: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  return withRetry(operation, {
    maxRetries: 3,
    initialDelayMs: 500,
    timeoutMs: 15000,
    ...customOptions,
    onRetry: (attempt, error, delay) => {
      console.warn(`[EVOLUTION-RETRY] Attempt ${attempt} failed: ${error.message}. Next retry in ${Math.round(delay)}ms`);
    },
  });
}

/**
 * Retry wrapper for database operations
 */
export async function retryDB<T>(
  operation: () => Promise<T>,
  customOptions: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  return withRetry(operation, {
    maxRetries: 2,
    initialDelayMs: 200,
    timeoutMs: 5000,
    ...customOptions,
    onRetry: (attempt, error, delay) => {
      console.warn(`[DB-RETRY] Attempt ${attempt} failed: ${error.message}. Next retry in ${Math.round(delay)}ms`);
    },
  });
}

// =============================================================================
// CIRCUIT BREAKER (Optional Enhancement)
// =============================================================================

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const circuitStates: Map<string, CircuitState> = new Map();

/**
 * Check if circuit is open (too many failures)
 */
export function isCircuitOpen(serviceName: string): boolean {
  const state = circuitStates.get(serviceName);
  if (!state) return false;
  
  // Reset after 60 seconds
  if (state.isOpen && Date.now() - state.lastFailure > 60000) {
    circuitStates.set(serviceName, { failures: 0, lastFailure: 0, isOpen: false });
    return false;
  }
  
  return state.isOpen;
}

/**
 * Record a failure for circuit breaker
 */
export function recordFailure(serviceName: string): void {
  const state = circuitStates.get(serviceName) || { failures: 0, lastFailure: 0, isOpen: false };
  state.failures++;
  state.lastFailure = Date.now();
  
  // Open circuit after 5 failures
  if (state.failures >= 5) {
    state.isOpen = true;
    console.error(`[CIRCUIT] Circuit opened for ${serviceName} after ${state.failures} failures`);
  }
  
  circuitStates.set(serviceName, state);
}

/**
 * Record a success (reset failures)
 */
export function recordSuccess(serviceName: string): void {
  circuitStates.set(serviceName, { failures: 0, lastFailure: 0, isOpen: false });
}
