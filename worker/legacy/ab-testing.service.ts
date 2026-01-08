/**
 * A/B Testing Service
 * 
 * Framework para testar variantes de prompts
 * e medir conversão por variante
 */

import { Env } from '@types';

// =============================================================================
// TYPES
// =============================================================================

export interface Variant {
  id: string;
  name: string;
  weight: number; // 0-100, peso para seleção
  active: boolean;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  variants: Variant[];
  startDate: string;
  endDate?: string;
  active: boolean;
}

export interface ExperimentResult {
  experimentId: string;
  variantId: string;
  userId: string;
  timestamp: string;
  converted: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// IN-MEMORY EXPERIMENTS (for MVP)
// =============================================================================

const EXPERIMENTS: Map<string, Experiment> = new Map();

// Default experiment: Greeting style
EXPERIMENTS.set('greeting-style', {
  id: 'greeting-style',
  name: 'Estilo de Saudação',
  description: 'Testar diferentes estilos de saudação inicial',
  variants: [
    { id: 'formal', name: 'Formal', weight: 50, active: true },
    { id: 'casual', name: 'Casual', weight: 50, active: true },
  ],
  startDate: '2024-01-01',
  active: false, // Disabled by default
});

// Default experiment: CTA style
EXPERIMENTS.set('cta-style', {
  id: 'cta-style',
  name: 'Estilo de CTA',
  description: 'Testar diferentes chamadas para ação',
  variants: [
    { id: 'question', name: 'Pergunta', weight: 33, active: true },
    { id: 'statement', name: 'Afirmação', weight: 33, active: true },
    { id: 'emoji', name: 'Com Emoji', weight: 34, active: true },
  ],
  startDate: '2024-01-01',
  active: false, // Disabled by default
});

// =============================================================================
// VARIANT SELECTION
// =============================================================================

/**
 * Hash-based user assignment (deterministic)
 */
function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Select variant for a user (deterministic based on userId)
 */
export function getVariant(experimentId: string, userId: string): Variant | null {
  const experiment = EXPERIMENTS.get(experimentId);
  
  if (!experiment || !experiment.active) {
    return null;
  }
  
  const activeVariants = experiment.variants.filter(v => v.active);
  if (activeVariants.length === 0) {
    return null;
  }
  
  // Calculate total weight
  const totalWeight = activeVariants.reduce((sum, v) => sum + v.weight, 0);
  
  // Deterministic selection based on user hash
  const userHash = hashUserId(userId);
  const position = userHash % totalWeight;
  
  let cumulative = 0;
  for (const variant of activeVariants) {
    cumulative += variant.weight;
    if (position < cumulative) {
      return variant;
    }
  }
  
  return activeVariants[0]; // Fallback
}

/**
 * Get all experiments
 */
export function getExperiments(): Experiment[] {
  return Array.from(EXPERIMENTS.values());
}

/**
 * Get experiment by ID
 */
export function getExperiment(experimentId: string): Experiment | null {
  return EXPERIMENTS.get(experimentId) || null;
}

/**
 * Activate/deactivate experiment
 */
export function setExperimentActive(experimentId: string, active: boolean): boolean {
  const experiment = EXPERIMENTS.get(experimentId);
  if (experiment) {
    experiment.active = active;
    return true;
  }
  return false;
}

// =============================================================================
// RESULT TRACKING (in-memory for MVP, should use D1 in production)
// =============================================================================

const RESULTS: ExperimentResult[] = [];

/**
 * Record experiment exposure
 */
export function recordExposure(
  experimentId: string,
  variantId: string,
  userId: string
): void {
  RESULTS.push({
    experimentId,
    variantId,
    userId,
    timestamp: new Date().toISOString(),
    converted: false,
  });
}

/**
 * Record conversion
 */
export function recordConversion(
  experimentId: string,
  userId: string,
  metadata?: Record<string, unknown>
): void {
  // Find the most recent exposure for this user/experiment
  const exposure = [...RESULTS]
    .reverse()
    .find(r => r.experimentId === experimentId && r.userId === userId);
  
  if (exposure) {
    exposure.converted = true;
    exposure.metadata = metadata;
  }
}

/**
 * Get experiment statistics
 */
export function getExperimentStats(experimentId: string): {
  variants: { id: string; exposures: number; conversions: number; rate: number }[];
} {
  const experiment = EXPERIMENTS.get(experimentId);
  if (!experiment) {
    return { variants: [] };
  }
  
  const filteredResults = RESULTS.filter(r => r.experimentId === experimentId);
  
  const stats = experiment.variants.map(variant => {
    const variantResults = filteredResults.filter(r => r.variantId === variant.id);
    const exposures = variantResults.length;
    const conversions = variantResults.filter(r => r.converted).length;
    const rate = exposures > 0 ? (conversions / exposures) * 100 : 0;
    
    return {
      id: variant.id,
      exposures,
      conversions,
      rate: Math.round(rate * 100) / 100,
    };
  });
  
  return { variants: stats };
}

// =============================================================================
// PROMPT VARIANTS (actual prompt text)
// =============================================================================

export const GREETING_VARIANTS = {
  formal: 'Olá! Bem-vindo à NetCar Multimarcas. Como posso ajudá-lo hoje?',
  casual: 'Oi! 😊 Que bom ter você aqui! No que posso te ajudar?',
};

export const CTA_VARIANTS = {
  question: 'Gostaria de saber mais sobre esse modelo?',
  statement: 'Posso te passar mais informações sobre esse veículo.',
  emoji: 'Quer saber mais? 🚗✨',
};

/**
 * Get prompt text for variant
 */
export function getGreetingForVariant(variantId: string): string {
  return GREETING_VARIANTS[variantId as keyof typeof GREETING_VARIANTS] || GREETING_VARIANTS.formal;
}

export function getCTAForVariant(variantId: string): string {
  return CTA_VARIANTS[variantId as keyof typeof CTA_VARIANTS] || CTA_VARIANTS.question;
}
