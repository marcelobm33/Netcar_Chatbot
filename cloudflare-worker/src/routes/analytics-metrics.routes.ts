/**
 * Analytics Dashboard API Routes
 * 
 * Provides endpoints for viewing Analytics Engine metrics.
 * 
 * Endpoints:
 * - GET /api/analytics/metrics - Get usage metrics summary
 * - GET /api/analytics/llm - Get LLM performance metrics
 * - GET /api/analytics/searches - Get car search metrics
 * - GET /api/analytics/handoffs - Get handoff metrics
 */

import { Hono } from 'hono';
import type { Env } from '../types';

// Create router
const analyticsMetricsRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/analytics/metrics
 * Returns daily usage summary from KV
 */
analyticsMetricsRoutes.get('/metrics', async (c) => {
  const env = c.env;
  
  try {
    // Get today's usage from KV
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${today}`;
    
    const cached = await env.NETCAR_CACHE.get(usageKey, 'json') as Record<string, unknown> | null;
    
    if (!cached) {
      return c.json({
        date: today,
        requests: 0,
        aiCalls: 0,
        cpuMs: 0,
        kvWrites: 0,
        d1Writes: 0,
        vectorize: 0,
        message: 'No usage data for today',
      });
    }
    
    return c.json(cached);
  } catch (error) {
    console.error('[Analytics Dashboard] Error:', error);
    return c.json({ error: 'Failed to fetch metrics' }, 500);
  }
});

/**
 * GET /api/analytics/llm
 * Returns LLM call statistics from D1
 */
analyticsMetricsRoutes.get('/llm', async (c) => {
  const env = c.env;
  
  try {
    // Get LLM stats from D1 (last 24 hours)
    const result = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        AVG(json_extract(metadata, '$.response_time_ms')) as avg_latency,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as ai_responses
      FROM messages
      WHERE created_at > datetime('now', '-1 day')
    `).first();
    
    return c.json({
      period: 'last_24h',
      totalCalls: result?.total_calls || 0,
      avgLatencyMs: Math.round(result?.avg_latency as number || 0),
      aiResponses: result?.ai_responses || 0,
    });
  } catch (error) {
    console.error('[Analytics Dashboard] LLM error:', error);
    return c.json({ error: 'Failed to fetch LLM metrics' }, 500);
  }
});

/**
 * GET /api/analytics/searches
 * Returns car search statistics from D1
 */
analyticsMetricsRoutes.get('/searches', async (c) => {
  const env = c.env;
  
  try {
    // Get search stats from lead_events (last 24 hours)
    const result = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_searches,
        COUNT(DISTINCT lead_id) as unique_leads
      FROM lead_events
      WHERE event_type LIKE '%search%'
        AND timestamp > datetime('now', '-1 day')
    `).first();
    
    return c.json({
      period: 'last_24h',
      totalSearches: result?.total_searches || 0,
      uniqueLeads: result?.unique_leads || 0,
    });
  } catch (error) {
    console.error('[Analytics Dashboard] Searches error:', error);
    return c.json({ error: 'Failed to fetch search metrics' }, 500);
  }
});

/**
 * GET /api/analytics/handoffs
 * Returns handoff statistics from D1
 */
analyticsMetricsRoutes.get('/handoffs', async (c) => {
  const env = c.env;
  
  try {
    // Get handoff stats from handoff_metrics (last 24 hours)
    const result = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_handoffs,
        AVG(messages_before_handoff) as avg_messages,
        COUNT(DISTINCT lead_id) as unique_leads
      FROM handoff_metrics
      WHERE executed_at > datetime('now', '-1 day')
    `).first();
    
    return c.json({
      period: 'last_24h',
      totalHandoffs: result?.total_handoffs || 0,
      avgMessagesBeforeHandoff: Math.round(result?.avg_messages as number || 0),
      uniqueLeads: result?.unique_leads || 0,
    });
  } catch (error) {
    console.error('[Analytics Dashboard] Handoffs error:', error);
    return c.json({ error: 'Failed to fetch handoff metrics' }, 500);
  }
});

/**
 * GET /api/analytics/overview
 * Returns complete overview of all metrics
 */
analyticsMetricsRoutes.get('/overview', async (c) => {
  const env = c.env;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get usage from KV
    const usageKey = `usage:${today}`;
    const usage = await env.NETCAR_CACHE.get(usageKey, 'json') as Record<string, unknown> | null;
    
    // Get leads count from D1
    const leadsResult = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) as hot,
        SUM(CASE WHEN score >= 50 AND score < 80 THEN 1 ELSE 0 END) as warm,
        SUM(CASE WHEN score < 50 OR score IS NULL THEN 1 ELSE 0 END) as cold
      FROM leads
      WHERE created_at > datetime('now', '-1 day')
    `).first();
    
    // Get handoff conversion rate
    const conversionResult = await env.DB.prepare(`
      SELECT 
        COUNT(DISTINCT hm.lead_id) as handoffs,
        COUNT(DISTINCT l.id) as total_leads
      FROM leads l
      LEFT JOIN handoff_metrics hm ON l.id = hm.lead_id
      WHERE l.created_at > datetime('now', '-1 day')
    `).first();
    
    const totalLeads = conversionResult?.total_leads as number || 1;
    const handoffs = conversionResult?.handoffs as number || 0;
    const conversionRate = ((handoffs / totalLeads) * 100).toFixed(1);
    
    return c.json({
      date: today,
      usage: usage || { requests: 0, aiCalls: 0 },
      leads: {
        total: leadsResult?.total || 0,
        hot: leadsResult?.hot || 0,
        warm: leadsResult?.warm || 0,
        cold: leadsResult?.cold || 0,
      },
      conversion: {
        rate: `${conversionRate}%`,
        handoffs,
        totalLeads,
      },
    });
  } catch (error) {
    console.error('[Analytics Dashboard] Overview error:', error);
    return c.json({ error: 'Failed to fetch overview' }, 500);
  }
});

export { analyticsMetricsRoutes };
