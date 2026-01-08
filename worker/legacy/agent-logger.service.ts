/**
 * Agent Logger Service
 * ====================
 * Registra logs de auditoria do Planner/Executor em D1.
 * Permite análise de desempenho e debugging.
 * 
 * Spec iAN v2.0 §13
 */

import type { Env } from '@types';
import type { PlannerResult } from './planner.service';

// =============================================================================
// TYPES
// =============================================================================

export interface AgentLogEntry {
  sender: string;
  input_message: string;
  intent: string;
  user_state: string;
  action_name: string;
  confidence: number;
  latency_ms: number;
  response_length: number;
  was_reformulated: boolean;
  notes: string;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Registra um passo do agente no D1 para auditoria.
 * 
 * @param sender - Número do WhatsApp do usuário
 * @param message - Mensagem original do usuário
 * @param plannerResult - Resultado do Planner (se usado)
 * @param responseLength - Tamanho da resposta enviada
 * @param startTime - Timestamp de início do processamento
 * @param wasReformulated - Se a resposta foi reformulada por anti-repetição
 * @param env - Environment com binding D1
 */
export async function logAgentStep(
  sender: string,
  message: string,
  plannerResult: PlannerResult | null,
  responseLength: number,
  startTime: number,
  wasReformulated: boolean,
  env: Env
): Promise<void> {
  const latencyMs = Date.now() - startTime;
  
  try {
    const logEntry: AgentLogEntry = {
      sender: sender.substring(0, 30), // Truncar para segurança
      input_message: message.substring(0, 500), // Truncar mensagem longa
      intent: plannerResult?.intent || 'unknown',
      user_state: plannerResult?.user_state || 'unknown',
      action_name: plannerResult?.next_action || 'none',
      confidence: plannerResult?.confidence || 0,
      latency_ms: latencyMs,
      response_length: responseLength,
      was_reformulated: wasReformulated,
      notes: plannerResult?.context_summary?.substring(0, 200) || ''
    };
    
    // Insert into D1
    await env.DB.prepare(`
      INSERT INTO agent_logs (
        sender, input_message, intent, user_state, action_name,
        confidence, latency_ms, response_length, was_reformulated, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      logEntry.sender,
      logEntry.input_message,
      logEntry.intent,
      logEntry.user_state,
      logEntry.action_name,
      logEntry.confidence,
      logEntry.latency_ms,
      logEntry.response_length,
      logEntry.was_reformulated ? 1 : 0,
      logEntry.notes
    ).run();
    
    console.log(`[AGENT_LOG] ✅ Logged: intent=${logEntry.intent}, latency=${latencyMs}ms`);
    
  } catch (error) {
    // Não falhar se logging falhar - apenas registrar no console
    console.error('[AGENT_LOG] Failed to log:', error);
  }
}

// =============================================================================
// QUERY FUNCTIONS (para dashboard)
// =============================================================================

/**
 * Busca logs recentes para um sender específico
 */
export async function getLogsForSender(
  sender: string,
  limit: number = 20,
  env: Env
): Promise<AgentLogEntry[]> {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM agent_logs 
      WHERE sender = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).bind(sender, limit).all();
    
    return result.results as unknown as AgentLogEntry[];
  } catch (error) {
    console.error('[AGENT_LOG] Failed to get logs:', error);
    return [];
  }
}

/**
 * Busca estatísticas agregadas de intents
 */
export async function getIntentStats(
  env: Env,
  days: number = 7
): Promise<Record<string, number>> {
  try {
    const result = await env.DB.prepare(`
      SELECT intent, COUNT(*) as count 
      FROM agent_logs 
      WHERE timestamp > datetime('now', '-' || ? || ' days')
      GROUP BY intent
      ORDER BY count DESC
    `).bind(days).all();
    
    const stats: Record<string, number> = {};
    for (const row of result.results as Array<{ intent: string; count: number }>) {
      stats[row.intent] = row.count;
    }
    
    return stats;
  } catch (error) {
    console.error('[AGENT_LOG] Failed to get stats:', error);
    return {};
  }
}

/**
 * Busca latência média por intent
 */
export async function getLatencyStats(
  env: Env,
  days: number = 7
): Promise<Record<string, number>> {
  try {
    const result = await env.DB.prepare(`
      SELECT intent, AVG(latency_ms) as avg_latency 
      FROM agent_logs 
      WHERE timestamp > datetime('now', '-' || ? || ' days')
      GROUP BY intent
      ORDER BY avg_latency DESC
    `).bind(days).all();
    
    const stats: Record<string, number> = {};
    for (const row of result.results as Array<{ intent: string; avg_latency: number }>) {
      stats[row.intent] = Math.round(row.avg_latency);
    }
    
    return stats;
  } catch (error) {
    console.error('[AGENT_LOG] Failed to get latency stats:', error);
    return {};
  }
}
