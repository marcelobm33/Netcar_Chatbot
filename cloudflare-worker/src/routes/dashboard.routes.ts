/**
 * Dashboard Routes
 * ================
 * Endpoints para dashboard operacional:
 * - Stats: métricas gerais
 * - Health: status dos serviços
 * - Conversations: resumo de conversas recentes
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { verifyRole } from '@legacy/security.service';
import { getMetricsSnapshot, getMetricsHistory, getHandoffRate } from '@legacy/metrics.service';
import { isCircuitOpen } from '@legacy/retry.service';

const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// =============================================================================
// GET /dashboard/stats - Métricas gerais
// =============================================================================
dashboardRoutes.get('/stats', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const metrics = getMetricsSnapshot();
  const handoffRate = getHandoffRate();

  return c.json({
    success: true,
    data: {
      summary: {
        totalConversations: metrics.totalConversations,
        handoffRate: `${handoffRate}%`,
        botResolvedCount: metrics.botResolvedCount,
        avgMessagesPerConversation: metrics.avgMessagesPerConversation,
        avgResponseTimeMs: metrics.avgResponseTimeMs,
      },
      routerDecisions: metrics.routerDecisions,
      errors: metrics.errors,
      updatedAt: metrics.updatedAt,
    }
  });
});

// =============================================================================
// GET /dashboard/health - Status dos serviços
// =============================================================================
dashboardRoutes.get('/health', async (c) => {
  const services = {
    openai: !isCircuitOpen('openai'),
    evolution: !isCircuitOpen('evolution'),
    d1: !isCircuitOpen('d1'),
    kv: !!c.env.NETCAR_CACHE,
    vectorize: !!c.env.VECTORIZE,
  };

  const allHealthy = Object.values(services).every(Boolean);

  // Check D1 connectivity
  let d1Connected = false;
  try {
    if (c.env.DB) {
      await c.env.DB.prepare('SELECT 1').first();
      d1Connected = true;
    }
  } catch {
    d1Connected = false;
  }

  return c.json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      ...services,
      d1Connected,
    },
    circuitBreakers: {
      openai: isCircuitOpen('openai') ? 'OPEN' : 'CLOSED',
      evolution: isCircuitOpen('evolution') ? 'OPEN' : 'CLOSED',
      d1: isCircuitOpen('d1') ? 'OPEN' : 'CLOSED',
    }
  });
});

// =============================================================================
// GET /dashboard/history - Histórico de métricas (últimos N dias)
// =============================================================================
dashboardRoutes.get('/history', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const days = parseInt(c.req.query('days') || '7', 10);
  const history = await getMetricsHistory(c.env, Math.min(days, 30));

  return c.json({
    success: true,
    data: {
      days,
      history,
    }
  });
});

// =============================================================================
// GET /dashboard/conversations - Conversas recentes (resumo)
// =============================================================================
dashboardRoutes.get('/conversations', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database not configured' }, 500);
  }

  try {
    // Get recent conversations with stats
    const result = await c.env.DB.prepare(`
      SELECT 
        sender,
        COUNT(*) as message_count,
        MIN(timestamp) as first_message,
        MAX(timestamp) as last_message,
        MAX(CASE WHEN role = 'handoff' THEN 1 ELSE 0 END) as had_handoff
      FROM messages
      WHERE timestamp > datetime('now', '-24 hours')
      GROUP BY sender
      ORDER BY last_message DESC
      LIMIT 50
    `).all();

    const conversations = result.results?.map((row) => ({
      sender: (row.sender as string)?.substring(0, 6) + '****', // Mask phone
      messageCount: row.message_count,
      firstMessage: row.first_message,
      lastMessage: row.last_message,
      hadHandoff: Boolean(row.had_handoff),
    })) || [];

    return c.json({
      success: true,
      data: {
        period: 'last_24h',
        count: conversations.length,
        conversations,
      }
    });
  } catch (error) {
    console.error('[DASHBOARD] Conversations error:', error);
    return c.json({ error: 'Failed to fetch conversations' }, 500);
  }
});

// =============================================================================
// GET /dashboard/quality - Métricas de qualidade
// =============================================================================
dashboardRoutes.get('/quality', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const metrics = getMetricsSnapshot();
  const handoffRate = getHandoffRate();

  // Calculate quality score (0-100)
  let qualityScore = 100;
  
  // Penalize high handoff rate (ideal < 20%)
  if (handoffRate > 20) qualityScore -= (handoffRate - 20) * 2;
  
  // Penalize slow response times (ideal < 3000ms)
  if (metrics.avgResponseTimeMs > 3000) {
    qualityScore -= Math.min(20, (metrics.avgResponseTimeMs - 3000) / 200);
  }
  
  // Penalize errors
  const totalErrors = Object.values(metrics.errors).reduce((a, b) => a + b, 0);
  if (totalErrors > 0) qualityScore -= Math.min(30, totalErrors * 2);

  qualityScore = Math.max(0, Math.round(qualityScore));

  return c.json({
    success: true,
    data: {
      qualityScore,
      grade: qualityScore >= 90 ? 'A' : qualityScore >= 80 ? 'B' : qualityScore >= 70 ? 'C' : qualityScore >= 60 ? 'D' : 'F',
      breakdown: {
        handoffPenalty: handoffRate > 20 ? Math.round((handoffRate - 20) * 2) : 0,
        responsePenalty: metrics.avgResponseTimeMs > 3000 ? Math.round(Math.min(20, (metrics.avgResponseTimeMs - 3000) / 200)) : 0,
        errorPenalty: Math.min(30, totalErrors * 2),
      },
      recommendations: [
        handoffRate > 30 ? 'Considere expandir a base de conhecimento RAG para reduzir handoffs' : null,
        metrics.avgResponseTimeMs > 5000 ? 'Tempo de resposta alto - verifique latência da OpenAI' : null,
        totalErrors > 10 ? 'Alto número de erros - verifique logs para investigar' : null,
      ].filter(Boolean),
    }
  });
});

export default dashboardRoutes;
