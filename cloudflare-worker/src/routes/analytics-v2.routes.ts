/**
 * Analytics Routes
 * =================
 * Dashboard endpoints for conversation metrics
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { getMetricsStats, getMetricsByPeriod, getActiveSession } from '@legacy/evaluation.service';

const app = new Hono<{ Bindings: Env }>();

// Middleware: API Key auth
app.use('*', async (c, next) => {
  const apiKey = c.req.header('X-Admin-Key') || c.req.header('Authorization')?.replace('Bearer ', '');
  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }
  if (apiKey !== c.env.NETCAR_ADMIN_KEY) {
    return c.json({ error: 'Invalid API key' }, 403);
  }
  await next();
});

/**
 * GET /v2/api/analytics/overview
 * Returns overall conversation metrics
 */
app.get('/overview', async (c) => {
  try {
    const stats = await getMetricsStats(c.env);
    return c.json({
      success: true,
      data: stats,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Overview error:', e);
    return c.json({ success: false, error: 'Failed to fetch metrics' }, 500);
  }
});

/**
 * GET /v2/api/analytics/period?start=2024-01-01&end=2024-01-31
 * Returns metrics for a specific period
 */
app.get('/period', async (c) => {
  try {
    const daysParam = c.req.query('days') || '7';
    const days = parseInt(daysParam, 10);
    
    const stats = await getMetricsByPeriod(days, c.env);
    return c.json({
      success: true,
      data: stats,
      period: { days },
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Period error:', e);
    return c.json({ success: false, error: 'Failed to fetch period metrics' }, 500);
  }
});

/**
 * GET /v2/api/analytics/session/:phone
 * Returns active session for a specific phone
 */
app.get('/session/:phone', async (c) => {
  try {
    const phone = c.req.param('phone');
    const session = await getActiveSession(phone, c.env);
    
    if (!session) {
      return c.json({ success: true, data: null, message: 'No active session' });
    }
    
    return c.json({
      success: true,
      data: session,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Session error:', e);
    return c.json({ success: false, error: 'Failed to fetch session' }, 500);
  }
});

/**
 * GET /v2/api/analytics/outcomes
 * Returns distribution of conversation outcomes
 */
app.get('/outcomes', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        outcome,
        COUNT(*) as count,
        ROUND(AVG(turn_count), 1) as avg_turns,
        ROUND(AVG(slots_collected), 1) as avg_slots
      FROM conversation_metrics
      WHERE outcome IS NOT NULL
      GROUP BY outcome
      ORDER BY count DESC
    `).all();
    
    return c.json({
      success: true,
      data: result.results || [],
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Outcomes error:', e);
    return c.json({ success: false, error: 'Failed to fetch outcomes' }, 500);
  }
});

/**
 * GET /v2/api/analytics/stages
 * Returns distribution of final FSM stages
 */
app.get('/stages', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        final_stage,
        COUNT(*) as count,
        ROUND(AVG(turn_count), 1) as avg_turns
      FROM conversation_metrics
      WHERE final_stage IS NOT NULL
      GROUP BY final_stage
      ORDER BY count DESC
    `).all();
    
    return c.json({
      success: true,
      data: result.results || [],
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Stages error:', e);
    return c.json({ success: false, error: 'Failed to fetch stages' }, 500);
  }
});

/**
 * GET /v2/api/analytics/leads
 * Returns recent leads with key info
 */
app.get('/leads', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const result = await c.env.DB.prepare(`
      SELECT 
        id,
        nome,
        telefone,
        interesse,
        created_at,
        seller_handoff,
        do_not_contact
      FROM leads
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();
    
    return c.json({
      success: true,
      data: result.results || [],
      total: result.results?.length || 0,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Leads error:', e);
    return c.json({ success: false, error: 'Failed to fetch leads' }, 500);
  }
});

/**
 * GET /v2/api/analytics/health
 * Returns system health status
 */
app.get('/health', async (c) => {
  try {
    // Check D1
    const dbCheck = await c.env.DB.prepare('SELECT 1 as ok').first();
    
    // Check KV
    const kvCheck = await c.env.NETCAR_CACHE.get('health_check');
    
    return c.json({
      success: true,
      health: {
        d1: dbCheck?.ok === 1 ? 'healthy' : 'degraded',
        kv: 'healthy', // KV read doesn't throw on missing key
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ANALYTICS] Health check error:', e);
    return c.json({ 
      success: false, 
      health: { d1: 'unhealthy', kv: 'unknown' },
      error: 'Health check failed' 
    }, 500);
  }
});

export const analyticsV2Routes = app;
export default app;
