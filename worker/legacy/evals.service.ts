/**
 * Evals Service - Automated Testing Framework
 * 
 * Ensures prompt/RAG/model changes don't cause regressions.
 * 
 * Based on full_bot_prompt_v4.md Section 8
 */

import type { Env } from '@types';
import type { RouterAction, ConversationState } from './router.service';
import { routeMessage } from './router.service';

// =============================================================================
// TYPES
// =============================================================================

export interface EvalCase {
  id: string;
  name: string;
  scenario: 'lead_frio' | 'lead_quente' | 'troca' | 'financiamento' | 'objecao' | 'urgencia' | 'handoff' | 'followup';
  user_message: string;
  state_seed: Partial<ConversationState>;
  expected_router_action: RouterAction;
  must_have: string[];
  must_not_have: string[];
}

export interface EvalResult {
  case_id: string;
  passed: boolean;
  score: number;
  details: {
    router_correct: boolean;
    cta_present: boolean;
    single_question: boolean;
    no_forbidden: boolean;
    tone_score?: number;
  };
  errors: string[];
}

export interface EvalSummary {
  total_cases: number;
  passed: number;
  failed: number;
  pass_rate: number;
  critical_failures: number;
  avg_score: number;
}

// =============================================================================
// TEST CASES DATASET
// =============================================================================

export const EVAL_DATASET: EvalCase[] = [
  // Lead frio - primeira mensagem
  {
    id: 'cold_001',
    name: 'Lead frio - saudação simples',
    scenario: 'lead_frio',
    user_message: 'Oi',
    state_seed: { stage: 'curioso', slots: {} },
    expected_router_action: 'ASK_ONE_QUESTION',
    must_have: ['?'],
    must_not_have: ['emoji', '😀', 'vendedor']
  },
  {
    id: 'cold_002',
    name: 'Lead frio - busca genérica',
    scenario: 'lead_frio',
    user_message: 'To procurando um carro',
    state_seed: { stage: 'curioso', slots: {} },
    expected_router_action: 'ASK_ONE_QUESTION',
    must_have: ['?'],
    must_not_have: ['preço', 'valor']
  },
  
  // Busca com slots
  {
    id: 'stock_001',
    name: 'Busca com modelo e cidade',
    scenario: 'lead_quente',
    user_message: 'Tem Onix em Porto Alegre?',
    state_seed: { 
      stage: 'comparando', 
      slots: { city_or_region: 'Porto Alegre', model: 'Onix' } 
    },
    expected_router_action: 'CALL_STOCK_API',
    must_have: [],
    must_not_have: ['inventar', 'garantia']
  },
  {
    id: 'stock_002',
    name: 'Busca SUV com orçamento',
    scenario: 'lead_quente',
    user_message: 'Quero um SUV até 80 mil',
    state_seed: { 
      stage: 'comparando', 
      slots: { city_or_region: 'Esteio', category: 'SUV', budget_max: 80000 } 
    },
    expected_router_action: 'CALL_STOCK_API',
    must_have: [],
    must_not_have: []
  },
  
  // Handoff
  {
    id: 'handoff_001',
    name: 'Cliente quer negociar',
    scenario: 'handoff',
    user_message: 'Quero negociar o preço',
    state_seed: { stage: 'comparando', handoff: { mode: 'BOT' }, slots: {} },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: []
  },
  {
    id: 'handoff_002',
    name: 'Cliente quer financiamento',
    scenario: 'financiamento',
    user_message: 'Vocês financiam?',
    state_seed: { stage: 'comparando', handoff: { mode: 'BOT' }, slots: {} },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: ['taxa', '%', 'aprovado']
  },
  {
    id: 'handoff_003',
    name: 'Cliente quer troca',
    scenario: 'troca',
    user_message: 'Aceita meu carro na troca?',
    state_seed: { stage: 'comparando', handoff: { mode: 'BOT' }, slots: {} },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: ['fipe', 'valor', 'R$']
  },
  {
    id: 'handoff_004',
    name: 'Cliente com urgência',
    scenario: 'urgencia',
    user_message: 'Preciso pra hoje, meu carro quebrou',
    state_seed: { stage: 'comparando', handoff: { mode: 'BOT' }, slots: {} },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: []
  },
  
  // Objeção
  {
    id: 'obj_001',
    name: 'Objeção de preço',
    scenario: 'objecao',
    user_message: 'Tá muito caro',
    state_seed: { stage: 'objecao', handoff: { mode: 'BOT' }, slots: {} },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: ['desconto', 'abatimento', 'reduzir']
  },
  
  // Safety
  {
    id: 'safety_001',
    name: 'Ameaça detectada',
    scenario: 'lead_frio',
    user_message: 'Vou processar vocês',
    state_seed: { stage: 'curioso', slots: {} },
    expected_router_action: 'SAFE_REFUSAL',
    must_have: [],
    must_not_have: []
  },
  
  // Follow-up
  {
    id: 'followup_001',
    name: 'Resposta a follow-up',
    scenario: 'followup',
    user_message: 'Opa, vi sua mensagem',
    state_seed: { 
      stage: 'comparando', 
      intent: 'followup_response',
      has_pending_followup: true,
      slots: {} 
    },
    expected_router_action: 'FOLLOWUP',
    must_have: ['?'],
    must_not_have: ['Bom dia', 'Boa tarde', 'Olá']
  },
  
  // Low signal
  {
    id: 'lowsig_001',
    name: 'Segunda resposta vaga',
    scenario: 'lead_frio',
    user_message: 'sei lá',
    state_seed: { 
      stage: 'curioso', 
      low_signal_count: 1,
      handoff: { mode: 'BOT' },
      slots: {} 
    },
    expected_router_action: 'HANDOFF_SELLER',
    must_have: [],
    must_not_have: []
  },
];

// =============================================================================
// GRADERS
// =============================================================================

/**
 * Score router correctness (3 points)
 */
export function gradeRouterCorrectness(
  userMessage: string,
  state: ConversationState,
  expectedAction: RouterAction
): { score: number; passed: boolean; actual: RouterAction } {
  const result = routeMessage(userMessage, state);
  const passed = result.action === expectedAction;
  return {
    score: passed ? 3 : 0,
    passed,
    actual: result.action
  };
}

/**
 * Score CTA presence (2 points)
 */
export function gradeCTAPresence(responseText: string): { score: number; passed: boolean } {
  const hasCTA = responseText.includes('?') || 
                 /quer|pode|gostaria|prefere|que tal/i.test(responseText);
  return {
    score: hasCTA ? 2 : 0,
    passed: hasCTA
  };
}

/**
 * Score single question rule (2 points)
 */
export function gradeSingleQuestion(responseText: string): { score: number; passed: boolean } {
  const questionCount = (responseText.match(/\?/g) || []).length;
  const passed = questionCount <= 1;
  return {
    score: passed ? 2 : 0,
    passed
  };
}

/**
 * Score forbidden content absence (3 points)
 */
export function gradeForbiddenAbsence(
  responseText: string, 
  mustNotHave: string[]
): { score: number; passed: boolean; violations: string[] } {
  const violations: string[] = [];
  const normalizedResponse = responseText.toLowerCase();
  
  for (const forbidden of mustNotHave) {
    if (normalizedResponse.includes(forbidden.toLowerCase())) {
      violations.push(forbidden);
    }
  }
  
  // Also check universal forbidden content
  const universalForbidden = ['😀', '😊', '🚗', 'inventar', 'prometo'];
  for (const forbidden of universalForbidden) {
    if (normalizedResponse.includes(forbidden.toLowerCase())) {
      violations.push(forbidden);
    }
  }
  
  return {
    score: violations.length === 0 ? 3 : 0,
    passed: violations.length === 0,
    violations
  };
}

// =============================================================================
// EVAL RUNNER
// =============================================================================

/**
 * Run a single eval case
 */
export function runEvalCase(
  evalCase: EvalCase,
  botResponse: string
): EvalResult {
  const state = createStateFromSeed(evalCase.state_seed);
  const errors: string[] = [];
  
  // Grade router
  const routerGrade = gradeRouterCorrectness(
    evalCase.user_message, 
    state, 
    evalCase.expected_router_action
  );
  if (!routerGrade.passed) {
    errors.push(`Router: expected ${evalCase.expected_router_action}, got ${routerGrade.actual}`);
  }
  
  // Grade CTA
  const ctaGrade = gradeCTAPresence(botResponse);
  if (!ctaGrade.passed) {
    errors.push('Missing CTA (question or call-to-action)');
  }
  
  // Grade single question
  const questionGrade = gradeSingleQuestion(botResponse);
  if (!questionGrade.passed) {
    errors.push('More than 1 question in response');
  }
  
  // Grade forbidden
  const forbiddenGrade = gradeForbiddenAbsence(botResponse, evalCase.must_not_have);
  if (!forbiddenGrade.passed) {
    errors.push(`Forbidden content: ${forbiddenGrade.violations.join(', ')}`);
  }
  
  // Calculate total score (max 10)
  const totalScore = routerGrade.score + ctaGrade.score + questionGrade.score + forbiddenGrade.score;
  const normalizedScore = totalScore / 10;
  
  return {
    case_id: evalCase.id,
    passed: normalizedScore >= 0.85 && routerGrade.passed,
    score: normalizedScore,
    details: {
      router_correct: routerGrade.passed,
      cta_present: ctaGrade.passed,
      single_question: questionGrade.passed,
      no_forbidden: forbiddenGrade.passed,
    },
    errors
  };
}

/**
 * Run all eval cases (for testing router only, no LLM call)
 */
export function runRouterEvals(): EvalSummary {
  let passed = 0;
  let criticalFailures = 0;
  let totalScore = 0;
  
  for (const evalCase of EVAL_DATASET) {
    const state = createStateFromSeed(evalCase.state_seed);
    const result = routeMessage(evalCase.user_message, state);
    
    if (result.action === evalCase.expected_router_action) {
      passed++;
      totalScore += 1;
    } else {
      console.log(`[EVAL FAIL] ${evalCase.id}: expected ${evalCase.expected_router_action}, got ${result.action}`);
      
      // Critical failures
      if (evalCase.expected_router_action === 'HANDOFF_SELLER' && result.action !== 'HANDOFF_SELLER') {
        criticalFailures++;
      }
      if (evalCase.expected_router_action === 'SAFE_REFUSAL' && result.action !== 'SAFE_REFUSAL') {
        criticalFailures++;
      }
    }
  }
  
  return {
    total_cases: EVAL_DATASET.length,
    passed,
    failed: EVAL_DATASET.length - passed,
    pass_rate: passed / EVAL_DATASET.length,
    critical_failures: criticalFailures,
    avg_score: totalScore / EVAL_DATASET.length
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function createStateFromSeed(seed: Partial<ConversationState>): ConversationState {
  return {
    phone: '+5500000000000',
    stage: seed.stage || 'curioso',
    intent: seed.intent || 'idle',
    handoff: seed.handoff || { mode: 'BOT' },
    slots: seed.slots || {},
    cars_shown: seed.cars_shown || [],
    pending_actions: seed.pending_actions || [],
    low_signal_count: seed.low_signal_count || 0,
    has_pending_followup: seed.has_pending_followup || false,
  };
}

// =============================================================================
// EXPORTS FOR CLI/CI
// =============================================================================

export function getEvalDataset(): EvalCase[] {
  return EVAL_DATASET;
}

export function printEvalSummary(summary: EvalSummary): void {
  console.log('\n========== EVAL SUMMARY ==========');
  console.log(`Total: ${summary.total_cases}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Pass Rate: ${(summary.pass_rate * 100).toFixed(1)}%`);
  console.log(`Critical Failures: ${summary.critical_failures}`);
  console.log(`Avg Score: ${(summary.avg_score * 100).toFixed(1)}%`);
  console.log('==================================\n');
  
  // CI Gate
  if (summary.pass_rate < 0.85) {
    console.error('❌ GATE FAILED: Pass rate < 85%');
  }
  if (summary.critical_failures > 0) {
    console.error('❌ GATE FAILED: Critical failures detected');
  }
  if (summary.pass_rate >= 0.85 && summary.critical_failures === 0) {
    console.log('✅ GATE PASSED');
  }
}
