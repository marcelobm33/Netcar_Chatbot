/**
 * Bot Integration - Ponto de Integração com Worker
 * ==================================================
 * Este arquivo serve como ponte entre o index.ts e o novo bot/core.
 * Permite migração gradual sem quebrar código existente.
 * 
 * USO:
 * 1. Importar funções daqui no index.ts
 * 2. Substituir imports antigos gradualmente
 * 3. Quando tudo funcionar, deletar código duplicado
 */

import type { Env } from './types';
import { createLogger } from '@worker/core/logger';

// =============================================================================
// IMPORTS DO NOVO CORE
// =============================================================================

import {
  detectCarIntent as detectCarIntentNew,
  toDetectedIntent,
  type ExtractedCarFilters,
} from '@bot/core/intent-detection';

import {
  runAllGuards as runAllGuardsNew,
  checkHelpCommand,
  checkResetCommand,
  type GuardResult,
  type AllGuardsParams,
} from '@bot/core/guards';

import {
  netcarApi,
  type CanonicalFilters,
} from '@bot/adapters/netcar';

import {
  createGroundingContext,
  addSource,
  recordCarData,
  toLogPayload,
} from '@bot/grounding';

// =============================================================================
// FEATURE FLAGS (para migração gradual)
// =============================================================================

const FEATURE_FLAGS = {
  USE_NEW_INTENT_DETECTION: true,   // ✅ HABILITADO - usando novo core
  USE_NEW_GUARDS: true,             // ✅ HABILITADO - usando novo core
  USE_NEW_CAR_SEARCH: false,
  LOG_COMPARISON: true,  // Compara resultados antigo vs novo
};

// =============================================================================
// WRAPPERS COM COMPARAÇÃO (A/B Testing)
// =============================================================================

/**
 * Wrapper para detectCarIntent que compara resultado do novo vs antigo
 */
export function detectCarIntentWithComparison(
  message: string,
  oldResult: ExtractedCarFilters | null,
  env: Env
): ExtractedCarFilters | null {
  const log = createLogger('bot-integration', env);
  
  // Resultado do novo core
  const newResult = detectCarIntentNew(message);
  
  if (FEATURE_FLAGS.LOG_COMPARISON) {
    const oldJson = JSON.stringify(oldResult);
    const newJson = JSON.stringify(newResult);
    
    if (oldJson !== newJson) {
      log.info(`[INTENT_COMPARISON] Diferença detectada!`);
      log.info(`[INTENT_COMPARISON] OLD: ${oldJson}`);
      log.info(`[INTENT_COMPARISON] NEW: ${newJson}`);
    }
  }
  
  // Retorna resultado baseado na feature flag
  return FEATURE_FLAGS.USE_NEW_INTENT_DETECTION ? newResult : oldResult;
}

/**
 * Wrapper para guards que compara resultado
 */
export function runAllGuardsWithComparison(
  params: AllGuardsParams,
  oldResult: GuardResult,
  env: Env
): GuardResult {
  const log = createLogger('bot-integration', env);
  
  const newResult = runAllGuardsNew(params);
  
  if (FEATURE_FLAGS.LOG_COMPARISON) {
    if (oldResult.continue !== newResult.continue) {
      log.info(`[GUARDS_COMPARISON] Diferença! OLD.continue=${oldResult.continue}, NEW.continue=${newResult.continue}`);
    }
  }
  
  return FEATURE_FLAGS.USE_NEW_GUARDS ? newResult : oldResult;
}

// =============================================================================
// FUNÇÕES DIRETAS DO NOVO CORE (para uso quando feature flag = true)
// =============================================================================

/**
 * Busca carros usando o novo adapter (grounded)
 */
export async function searchCarsWithGrounding(
  filters: CanonicalFilters,
  sender: string,
  env: Env
) {
  const log = createLogger('bot-integration', env);
  const ctx = createGroundingContext();
  
  try {
    // Registrar fonte
    const startTime = Date.now();
    const cars = await netcarApi.searchWithCanonical(filters);
    const latency = Date.now() - startTime;
    
    addSource(ctx, {
      type: 'api',
      endpoint: '/veiculos.php',
      latencyMs: latency,
      filters: filters as unknown as Record<string, unknown>,
    });
    
    recordCarData(ctx, cars, {
      marca: filters.brand,
      modelo: filters.model,
      anoMin: filters.yearMin,
      anoMax: filters.yearMax,
      valorMin: filters.priceMin,
      valorMax: filters.priceMax,
    });
    
    // Log estruturado
    log.info(`[GROUNDING] ${JSON.stringify(toLogPayload(ctx))}`);
    
    return { cars, grounding: ctx };
  } catch (error) {
    log.error(`[GROUNDING] Search failed:`, error);
    return { cars: [], grounding: ctx };
  }
}

// =============================================================================
// EXPORTS PARA USO NO INDEX.TS
// =============================================================================

export {
  detectCarIntentNew,
  runAllGuardsNew,
  checkHelpCommand,
  checkResetCommand,
  netcarApi,
  createGroundingContext,
  toLogPayload,
};

// Re-export tipos
export type { CanonicalFilters, GuardResult, ExtractedCarFilters };
