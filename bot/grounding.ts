/**
 * Grounding Context - Rastreabilidade de Dados
 * ==============================================
 * Estrutura para rastrear de onde vieram os dados usados pelo LLM.
 * Reduz alucinação e facilita debug.
 */

import type { Car, CarFilters, DetectedIntent } from './types';

// =============================================================================
// GROUNDING SOURCE
// =============================================================================

export interface GroundingSource {
  /** Tipo da fonte (api, cache, fallback) */
  type: 'api' | 'cache' | 'fallback' | 'user_input';
  
  /** Nome do endpoint ou serviço */
  endpoint: string;
  
  /** Timestamp da consulta */
  timestamp: Date;
  
  /** Filtros aplicados (se aplicável) */
  filters?: Record<string, unknown>;
  
  /** HTTP status (se API) */
  httpStatus?: number;
  
  /** Tempo de resposta em ms */
  latencyMs?: number;
  
  /** ID de cache (se cache) */
  cacheKey?: string;
  
  /** TTL restante (se cache) */
  cacheTtlMs?: number;
}

// =============================================================================
// GROUNDING CONTEXT (contexto completo de uma resposta)
// =============================================================================

export interface GroundingContext {
  /** ID único da requisição (para correlação) */
  requestId: string;
  
  /** Trace ID (para observabilidade distribuída) */
  traceId?: string;
  
  /** Timestamp de início do processamento */
  startedAt: Date;
  
  /** Intenção detectada */
  intent?: DetectedIntent;
  
  /** Filtros aplicados na busca */
  filtersApplied?: CarFilters;
  
  /** Fontes consultadas */
  sources: GroundingSource[];
  
  /** Dados retornados (resumo) */
  dataSnapshot: {
    carsFound: number;
    carsReturned: number;
    carIds?: string[];
  };
  
  /** Metadados adicionais */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Cria um novo GroundingContext
 */
export function createGroundingContext(traceId?: string): GroundingContext {
  return {
    requestId: generateRequestId(),
    traceId,
    startedAt: new Date(),
    sources: [],
    dataSnapshot: {
      carsFound: 0,
      carsReturned: 0,
    },
  };
}

/**
 * Adiciona uma fonte ao contexto
 */
export function addSource(
  ctx: GroundingContext,
  source: Omit<GroundingSource, 'timestamp'>
): void {
  ctx.sources.push({
    ...source,
    timestamp: new Date(),
  });
}

/**
 * Registra dados de carros no contexto
 */
export function recordCarData(
  ctx: GroundingContext,
  cars: Car[],
  filtersApplied?: CarFilters
): void {
  ctx.filtersApplied = filtersApplied;
  ctx.dataSnapshot = {
    carsFound: cars.length,
    carsReturned: cars.length,
    carIds: cars.map(c => c.id),
  };
}

/**
 * Gera log estruturado do grounding
 */
export function toLogPayload(ctx: GroundingContext): Record<string, unknown> {
  const duration = Date.now() - ctx.startedAt.getTime();
  
  return {
    request_id: ctx.requestId,
    trace_id: ctx.traceId,
    duration_ms: duration,
    intent_type: ctx.intent?.type,
    intent_confidence: ctx.intent?.confidence,
    filters: ctx.filtersApplied,
    sources_count: ctx.sources.length,
    sources: ctx.sources.map(s => ({
      type: s.type,
      endpoint: s.endpoint,
      latency_ms: s.latencyMs,
      http_status: s.httpStatus,
    })),
    cars_found: ctx.dataSnapshot.carsFound,
    cars_returned: ctx.dataSnapshot.carsReturned,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function generateRequestId(): string {
  // Formato: req_<timestamp>_<random>
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

/**
 * Gera trace ID único
 */
export function generateTraceId(): string {
  // Formato: trace_<timestamp>_<random>
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `trace_${timestamp}_${random}`;
}
