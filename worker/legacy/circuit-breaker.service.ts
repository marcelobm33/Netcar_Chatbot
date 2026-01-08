/**
 * Circuit Breaker Service
 * =======================
 * Implementa pattern Circuit Breaker para proteção contra falhas em cascata
 * em APIs externas (OpenAI, Evolution, Netcar API)
 * 
 * Estados:
 * - CLOSED: Normal, requests passam
 * - OPEN: Circuit aberto, requests falham imediatamente
 * - HALF_OPEN: Teste de recuperação, permite alguns requests
 */

import type { Env } from '@types';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Nome do circuito para logging */
  name: string;
  /** Número de falhas para abrir o circuito */
  failureThreshold: number;
  /** Tempo em ms que o circuito fica aberto */
  resetTimeout: number;
  /** Número de sucessos para fechar o circuito em HALF_OPEN */
  successThreshold: number;
}

interface CircuitData {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number;
  openedAt: number;
}

const DEFAULT_CONFIGS: Record<string, CircuitBreakerConfig> = {
  openai: {
    name: 'OpenAI',
    failureThreshold: 5,
    resetTimeout: 30000, // 30 segundos
    successThreshold: 2,
  },
  evolution: {
    name: 'Evolution API',
    failureThreshold: 3,
    resetTimeout: 60000, // 1 minuto
    successThreshold: 2,
  },
  netcar: {
    name: 'Netcar API',
    failureThreshold: 3,
    resetTimeout: 30000,
    successThreshold: 2,
  },
};

/**
 * Obtém estado do circuit breaker do KV
 */
async function getCircuitState(
  kv: KVNamespace | undefined,
  circuitName: string
): Promise<CircuitData> {
  const defaultState: CircuitData = {
    state: 'CLOSED',
    failures: 0,
    successes: 0,
    lastFailure: 0,
    openedAt: 0,
  };

  if (!kv) return defaultState;

  try {
    const data = await kv.get(`circuit:${circuitName}`, 'json');
    return (data as CircuitData) || defaultState;
  } catch {
    return defaultState;
  }
}

/**
 * Salva estado do circuit breaker no KV
 */
async function setCircuitState(
  kv: KVNamespace | undefined,
  circuitName: string,
  data: CircuitData
): Promise<void> {
  if (!kv) return;

  try {
    await kv.put(`circuit:${circuitName}`, JSON.stringify(data), {
      expirationTtl: 3600, // 1 hora
    });
  } catch (e) {
    console.error(`[CIRCUIT] Failed to save state for ${circuitName}:`, e);
  }
}

/**
 * Verifica se o circuito permite a requisição
 */
export async function canExecute(
  env: Env,
  circuitName: string
): Promise<{ allowed: boolean; state: CircuitState; reason?: string }> {
  const config = DEFAULT_CONFIGS[circuitName] || DEFAULT_CONFIGS.openai;
  const circuit = await getCircuitState(env.NETCAR_CACHE, circuitName);
  const now = Date.now();

  // CLOSED - permite todas as requisições
  if (circuit.state === 'CLOSED') {
    return { allowed: true, state: 'CLOSED' };
  }

  // OPEN - verifica se timeout passou para transição para HALF_OPEN
  if (circuit.state === 'OPEN') {
    const elapsed = now - circuit.openedAt;
    if (elapsed >= config.resetTimeout) {
      // Transição para HALF_OPEN
      circuit.state = 'HALF_OPEN';
      circuit.successes = 0;
      await setCircuitState(env.NETCAR_CACHE, circuitName, circuit);
      console.log(`[CIRCUIT] ${config.name}: OPEN → HALF_OPEN (testing recovery)`);
      return { allowed: true, state: 'HALF_OPEN' };
    }
    const remaining = Math.ceil((config.resetTimeout - elapsed) / 1000);
    return {
      allowed: false,
      state: 'OPEN',
      reason: `Circuit ${config.name} OPEN. Retry in ${remaining}s`,
    };
  }

  // HALF_OPEN - permite algumas requisições de teste
  return { allowed: true, state: 'HALF_OPEN' };
}

/**
 * Registra sucesso na requisição
 */
export async function recordSuccess(env: Env, circuitName: string): Promise<void> {
  const config = DEFAULT_CONFIGS[circuitName] || DEFAULT_CONFIGS.openai;
  const circuit = await getCircuitState(env.NETCAR_CACHE, circuitName);

  if (circuit.state === 'HALF_OPEN') {
    circuit.successes++;
    if (circuit.successes >= config.successThreshold) {
      // Transição para CLOSED
      circuit.state = 'CLOSED';
      circuit.failures = 0;
      circuit.successes = 0;
      console.log(`[CIRCUIT] ${config.name}: HALF_OPEN → CLOSED (recovered)`);
    }
  } else if (circuit.state === 'CLOSED') {
    // Reset failures no sucesso
    circuit.failures = Math.max(0, circuit.failures - 1);
  }

  await setCircuitState(env.NETCAR_CACHE, circuitName, circuit);
}

/**
 * Registra falha na requisição
 */
export async function recordFailure(env: Env, circuitName: string): Promise<void> {
  const config = DEFAULT_CONFIGS[circuitName] || DEFAULT_CONFIGS.openai;
  const circuit = await getCircuitState(env.NETCAR_CACHE, circuitName);
  const now = Date.now();

  if (circuit.state === 'HALF_OPEN') {
    // Falha em HALF_OPEN volta para OPEN
    circuit.state = 'OPEN';
    circuit.openedAt = now;
    circuit.lastFailure = now;
    console.log(`[CIRCUIT] ${config.name}: HALF_OPEN → OPEN (still failing)`);
  } else if (circuit.state === 'CLOSED') {
    circuit.failures++;
    circuit.lastFailure = now;

    if (circuit.failures >= config.failureThreshold) {
      // Abre o circuito
      circuit.state = 'OPEN';
      circuit.openedAt = now;
      console.warn(
        `[CIRCUIT] ⚠️ ${config.name}: CLOSED → OPEN (${circuit.failures} failures)`
      );
    }
  }

  await setCircuitState(env.NETCAR_CACHE, circuitName, circuit);
}

/**
 * Wrapper para executar chamada com circuit breaker
 */
export async function withCircuitBreaker<T>(
  env: Env,
  circuitName: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  const check = await canExecute(env, circuitName);

  if (!check.allowed) {
    console.warn(`[CIRCUIT] Request blocked: ${check.reason}`);
    if (fallback) {
      return fallback();
    }
    throw new Error(check.reason || 'Circuit breaker open');
  }

  try {
    const result = await fn();
    await recordSuccess(env, circuitName);
    return result;
  } catch (error) {
    await recordFailure(env, circuitName);
    if (fallback) {
      console.log(`[CIRCUIT] Using fallback for ${circuitName}`);
      return fallback();
    }
    throw error;
  }
}

/**
 * Obtém status de todos os circuit breakers
 */
export async function getAllCircuitStatus(
  env: Env
): Promise<Record<string, { state: CircuitState; failures: number }>> {
  const status: Record<string, { state: CircuitState; failures: number }> = {};

  for (const name of Object.keys(DEFAULT_CONFIGS)) {
    const circuit = await getCircuitState(env.NETCAR_CACHE, name);
    status[name] = {
      state: circuit.state,
      failures: circuit.failures,
    };
  }

  return status;
}

/**
 * Reset manual de um circuit breaker
 */
export async function resetCircuit(env: Env, circuitName: string): Promise<void> {
  const config = DEFAULT_CONFIGS[circuitName];
  if (!config) return;

  await setCircuitState(env.NETCAR_CACHE, circuitName, {
    state: 'CLOSED',
    failures: 0,
    successes: 0,
    lastFailure: 0,
    openedAt: 0,
  });

  console.log(`[CIRCUIT] ${config.name}: RESET → CLOSED (manual)`);
}
