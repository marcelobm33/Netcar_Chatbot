/**
 * Public Routes
 * =============
 * Rotas públicas que não requerem autenticação
 * Inclui: status, health check, store hours
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { DBService } from '@legacy/db.service';

const publicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET / - Status básico do serviço
 */
publicRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'netcar-worker',
    version: '5.5.0', // Refactored modular version
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health - Health check detalhado com testes de conectividade
 */
publicRoutes.get('/health', async (c) => {
  const startTime = Date.now();
  const checks: Record<string, { status: string; latency?: number; error?: string; connection?: string; vectors?: number }> = {};

  // Check D1 Database
  try {
    const db = new DBService(c.env.DB);
    const dbStart = Date.now();
    await db.getConfig('bot_enabled');
    checks.db = { status: 'ok', latency: Date.now() - dbStart };
  } catch (err: unknown) {
    checks.db = { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  // Check Evolution API
  try {
    const evolutionStart = Date.now();
    const evolutionRes = await fetch(
      `${c.env.EVOLUTION_API_URL}/instance/connectionState/${c.env.EVOLUTION_INSTANCE}`,
      {
        headers: {
          apikey: c.env.EVOLUTION_API_KEY,
          'User-Agent': 'NetcarWorker/1.0',
        },
      }
    );
    const evolutionData = (await evolutionRes.json()) as { instance?: { state?: string } };
    checks.evolution = {
      status: evolutionRes.ok && evolutionData?.instance?.state === 'open' ? 'ok' : 'warning',
      latency: Date.now() - evolutionStart,
      ...(evolutionData?.instance?.state ? { connection: evolutionData.instance.state } : {}),
    };
  } catch (err: unknown) {
    checks.evolution = { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  // Check Netcar API (CRM externo)
  try {
    const netcarStart = Date.now();
    const netcarRes = await fetch('https://www.netcarmultimarcas.com.br/api/v1/veiculos.php?limit=1');
    checks.netcar = {
      status: netcarRes.ok ? 'ok' : 'error',
      latency: Date.now() - netcarStart,
      ...(netcarRes.ok ? {} : { error: `HTTP ${netcarRes.status}` }),
    };
  } catch (err: unknown) {
    checks.netcar = { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  // Check KV Cache
  try {
    const kvStart = Date.now();
    if (c.env.NETCAR_CACHE) {
      await c.env.NETCAR_CACHE.get('health_check_test');
      checks.kv = { status: 'ok', latency: Date.now() - kvStart };
    } else {
      checks.kv = { status: 'warning', error: 'KV not bound' };
    }
  } catch (err: unknown) {
    checks.kv = { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  // Check Vectorize (RAG)
  try {
    const vectorStart = Date.now();
    if (c.env.VECTORIZE) {
      const info = await c.env.VECTORIZE.describe();
      checks.vectorize = {
        status: 'ok',
        latency: Date.now() - vectorStart,
        ...(info?.vectorsCount !== undefined ? { vectors: info.vectorsCount } : {}),
      };
    } else {
      checks.vectorize = { status: 'warning', error: 'Vectorize not bound' };
    }
  } catch (err: unknown) {
    checks.vectorize = { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  // Overall status
  const hasErrors = Object.values(checks).some((check) => check.status === 'error');
  const hasWarnings = Object.values(checks).some((check) => check.status === 'warning');

  return c.json({
    status: hasErrors ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
    service: 'netcar-worker',
    version: '5.5.0',
    uptime: Math.round((Date.now() - startTime) / 1000),
    checks,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /public/store-hours - Horário de funcionamento (usado pelo bot/AI)
 */
publicRoutes.get('/public/store-hours', async (c) => {
  const db = new DBService(c.env.DB);

  const hoursJson = await db.getConfig('store_hours');
  if (!hoursJson) {
    return c.json({
      weekday: '9h às 18h',
      saturday: '9h às 17h',
      sunday: 'Fechado',
      special_rules: [],
    });
  }

  try {
    const hours = JSON.parse(hoursJson);
    const activeRules = (hours.special_rules || [])
      .filter((r: { active?: boolean }) => r.active)
      .map((r: { label: string; description: string }) => ({
        label: r.label,
        description: r.description,
      }));

    return c.json({
      weekday: `${hours.weekday_start}h às ${hours.weekday_end}h`,
      saturday: `${hours.saturday_start}h às ${hours.saturday_end}h`,
      sunday: hours.sunday_closed ? 'Fechado' : 'Aberto',
      special_rules: activeRules,
    });
  } catch {
    return c.json({
      weekday: '9h às 18h',
      saturday: '9h às 17h',
      sunday: 'Fechado',
      special_rules: [],
    });
  }
});

export { publicRoutes };
