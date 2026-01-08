/**
 * Evaluation Service
 * ==================
 * Tracks and analyzes conversation metrics
 * 
 * Features:
 * - Session tracking
 * - Outcome classification
 * - FSM stage analysis
 * - Quality metrics
 */

import type { Env } from '../types';
import { getFSMState, type FSMState } from './fsm.service';

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationMetrics {
  id?: string;
  phone: string;
  session_start: string;
  session_end?: string;
  turn_count: number;
  slots_collected: number;
  cars_shown: number;
  handoff_occurred: boolean;
  final_stage?: string;
  stage_transitions?: string;
  avg_response_time_ms?: number;
  llm_calls: number;
  rag_queries: number;
  outcome?: ConversationOutcome;
  created_at?: string;
  updated_at?: string;
}

export type ConversationOutcome = 
  | 'converted'    // Lead convertido
  | 'handoff'      // Transferido para vendedor
  | 'abandoned'    // Abandonou sem resposta
  | 'exit'         // Disse tchau
  | 'in_progress'; // Ainda em andamento

// =============================================================================
// SESSION TRACKING
// =============================================================================

/**
 * Inicia uma nova sessão de métricas
 */
export async function startMetricsSession(
  phone: string,
  env: Env
): Promise<string> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  
  try {
    const id = crypto.randomUUID();
    
    await env.DB.prepare(`
      INSERT INTO conversation_metrics 
        (id, phone, session_start, turn_count, slots_collected, cars_shown, llm_calls, rag_queries)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0)
    `).bind(id, phoneClean, new Date().toISOString()).run();
    
    console.log(`[EVAL] Started metrics session: ${id}`);
    return id;
  } catch (e) {
    console.error('[EVAL] Error starting session:', e);
    return '';
  }
}

/**
 * Obtém sessão de métricas ativa para o telefone
 */
export async function getActiveSession(
  phone: string,
  env: Env
): Promise<ConversationMetrics | null> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM conversation_metrics 
      WHERE phone = ? AND session_end IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).bind(phoneClean).first<ConversationMetrics>();
    
    return result || null;
  } catch (e) {
    console.error('[EVAL] Error getting session:', e);
    return null;
  }
}

/**
 * Atualiza métricas da sessão
 */
export async function updateSessionMetrics(
  phone: string,
  updates: Partial<ConversationMetrics>,
  env: Env
): Promise<void> {
  const session = await getActiveSession(phone, env);
  if (!session?.id) {
    // Cria nova sessão se não existe
    await startMetricsSession(phone, env);
    return;
  }
  
  const fields: string[] = [];
  const values: (string | number | boolean)[] = [];
  
  if (updates.turn_count !== undefined) {
    fields.push('turn_count = turn_count + 1');
  }
  if (updates.slots_collected !== undefined) {
    fields.push('slots_collected = ?');
    values.push(updates.slots_collected);
  }
  if (updates.cars_shown !== undefined) {
    fields.push('cars_shown = cars_shown + ?');
    values.push(updates.cars_shown);
  }
  if (updates.handoff_occurred !== undefined) {
    fields.push('handoff_occurred = ?');
    values.push(updates.handoff_occurred ? 1 : 0);
  }
  if (updates.llm_calls !== undefined) {
    fields.push('llm_calls = llm_calls + 1');
  }
  if (updates.rag_queries !== undefined) {
    fields.push('rag_queries = rag_queries + 1');
  }
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(session.id);
  
  if (fields.length === 0) return;
  
  try {
    // eslint-disable-next-line security/detect-sql-injection -- Fields from whitelist, values parameterized
    await env.DB.prepare(`
      UPDATE conversation_metrics 
      SET ${fields.join(', ')}
      WHERE id = ?
    `).bind(...values).run();
  } catch (e) {
    console.error('[EVAL] Error updating session:', e);
  }
}

/**
 * Finaliza uma sessão de métricas
 */
export async function endMetricsSession(
  phone: string,
  outcome: ConversationOutcome,
  env: Env
): Promise<void> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  
  // Obtém estado FSM para histórico de stages
  const fsmState = await getFSMState(phone, env);
  
  try {
    await env.DB.prepare(`
      UPDATE conversation_metrics 
      SET session_end = ?, outcome = ?, final_stage = ?, stage_transitions = ?, updated_at = ?
      WHERE phone = ? AND session_end IS NULL
    `).bind(
      new Date().toISOString(),
      outcome,
      fsmState?.stage || 'UNKNOWN',
      fsmState?.stageHistory ? JSON.stringify(fsmState.stageHistory) : null,
      new Date().toISOString(),
      phoneClean
    ).run();
    
    console.log(`[EVAL] Session ended: ${outcome} | Stage: ${fsmState?.stage}`);
  } catch (e) {
    console.error('[EVAL] Error ending session:', e);
  }
}

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Obtém estatísticas gerais
 */
export async function getMetricsStats(env: Env): Promise<{
  total_sessions: number;
  handoff_rate: number;
  avg_turns: number;
  outcomes: Record<string, number>;
  top_stages: Array<{ stage: string; count: number }>;
}> {
  try {
    // Total sessions
    const totals = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN handoff_occurred = 1 THEN 1 ELSE 0 END) as handoffs,
        AVG(turn_count) as avg_turns
      FROM conversation_metrics
    `).first<{ total: number; handoffs: number; avg_turns: number }>();
    
    // Outcomes
    const outcomes = await env.DB.prepare(`
      SELECT outcome, COUNT(*) as count 
      FROM conversation_metrics 
      WHERE outcome IS NOT NULL
      GROUP BY outcome
    `).all<{ outcome: string; count: number }>();
    
    // Top stages
    const stages = await env.DB.prepare(`
      SELECT final_stage as stage, COUNT(*) as count 
      FROM conversation_metrics 
      WHERE final_stage IS NOT NULL
      GROUP BY final_stage
      ORDER BY count DESC LIMIT 5
    `).all<{ stage: string; count: number }>();
    
    return {
      total_sessions: totals?.total || 0,
      handoff_rate: totals ? (totals.handoffs / totals.total) * 100 : 0,
      avg_turns: totals?.avg_turns || 0,
      outcomes: (outcomes.results || []).reduce((acc, r) => {
        acc[r.outcome] = r.count;
        return acc;
      }, {} as Record<string, number>),
      top_stages: stages.results || []
    };
  } catch (e) {
    console.error('[EVAL] Error getting stats:', e);
    return {
      total_sessions: 0,
      handoff_rate: 0,
      avg_turns: 0,
      outcomes: {},
      top_stages: []
    };
  }
}

/**
 * Obtém métricas por período
 */
export async function getMetricsByPeriod(
  days: number,
  env: Env
): Promise<Array<{
  date: string;
  sessions: number;
  handoffs: number;
  avg_turns: number;
}>> {
  try {
    const result = await env.DB.prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sessions,
        SUM(CASE WHEN handoff_occurred = 1 THEN 1 ELSE 0 END) as handoffs,
        AVG(turn_count) as avg_turns
      FROM conversation_metrics
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).bind(days).all<{
      date: string;
      sessions: number;
      handoffs: number;
      avg_turns: number;
    }>();
    
    return result.results || [];
  } catch (e) {
    console.error('[EVAL] Error getting period stats:', e);
    return [];
  }
}
