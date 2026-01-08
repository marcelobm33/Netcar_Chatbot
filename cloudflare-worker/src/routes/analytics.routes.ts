/**
 * Analytics Routes
 * ================
 * Endpoints de analytics para o Dashboard
 * Métricas de funil, performance e estoque
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { DBService } from '@legacy/db.service';

const analyticsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /analytics/funnel - Estatísticas de funil de vendas
 */
analyticsRoutes.get('/funnel', async (c) => {
  const env = c.env as Env;
  const db = new DBService(env.DB);

  // GROUP BY via D1/SQLite
  const stmt = env.DB.prepare(
    "SELECT json_extract(metadata, '$.status') as status, COUNT(*) as count FROM leads GROUP BY json_extract(metadata, '$.status')"
  );
  const { results } = await stmt.all<{ status: string; count: number }>();

  const counts: Record<string, number> = {
    novo: 0,
    em_atendimento: 0,
    qualificado: 0,
    perdido: 0,
  };

  let total = 0;
  if (results) {
    results.forEach((row) => {
      const s = row.status || 'novo';
      counts[s] = (counts[s] || 0) + row.count;
      total += row.count;
    });
  }

  return c.json({
    timestamp: new Date().toISOString(),
    funnel: counts,
    total: results?.length || 0,
  });
});

/**
 * GET /analytics/performance - Métricas de performance
 */
analyticsRoutes.get('/performance', async (c) => {
  const env = c.env as Env;
  const db = new DBService(env.DB);

  // Query para leads hoje
  const today = new Date().toISOString().split('T')[0];
  const leadsToday = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE created_at >= ?"
  ).bind(`${today}T00:00:00.000Z`).first<{ count: number }>();

  // Query para mensagens hoje
  const messagesResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE created_at >= ?"
  ).bind(`${today}T00:00:00.000Z`).first<{ count: number }>();

  // Calcular taxa de conversão (leads qualificados / total)
  const qualifiedResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE json_extract(metadata, '$.status') = 'qualificado'"
  ).first<{ count: number }>();

  const totalLeads = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads"
  ).first<{ count: number }>();

  const conversionRate = totalLeads?.count && totalLeads.count > 0
    ? ((qualifiedResult?.count || 0) / totalLeads.count * 100).toFixed(1) + '%'
    : '0%';

  return c.json({
    timestamp: new Date().toISOString(),
    metrics: {
      leads_today: leadsToday?.count || 0,
      messages_today: messagesResult?.count || 0,
      total_leads: totalLeads?.count || 0,
      qualified_leads: qualifiedResult?.count || 0,
      conversion_rate: conversionRate,
    },
  });
});

/**
 * GET /api/proxy/stock-attention - Proxy para estoque em destaque (CORS fix)
 */
analyticsRoutes.get('/proxy/stock-attention', async (c) => {
  try {
    // Buscar carros em destaque da API Netcar
    const response = await fetch(
      'https://www.netcarmultimarcas.com.br/api/v1/veiculos.php?limite=6&ordem=data_cadastro&direcao=desc'
    );

    if (!response.ok) {
      console.warn('[PROXY] Stock API returned:', response.status);
      return c.json({ success: true, data: [] });
    }

    const data = await response.json() as { veiculos?: unknown[] };
    const cars = data.veiculos || [];

    return c.json({
      success: true,
      count: cars.length,
      data: cars,
    });
  } catch (error: unknown) {
    console.error('[PROXY] Error fetching estoque:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : String(error), data: [] }, 500);
  }
});

export { analyticsRoutes };
