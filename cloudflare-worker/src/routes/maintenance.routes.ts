/**
 * Maintenance Routes
 * ==================
 * Endpoints de manutenção do sistema
 * Inclui: cleanup, fix-tables, re-summarize, analyze-phones
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { verifyRole, logAudit } from '@legacy/security.service';
import { DBService } from '@legacy/db.service';
import { autoCloseStaleLeads } from '@legacy/crm.service';
import { syncBlocklistFromD1 } from '@legacy/blocklist.service';

const maintenanceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /cleanup - Limpar leads obsoletos
 */
maintenanceRoutes.post('/cleanup', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  console.log('[MAINTENANCE] Starting manual cleanup...');

  try {
    const closedCount = await autoCloseStaleLeads(c.env);

    c.executionCtx.waitUntil(
      logAudit('admin', 'MAINTENANCE_CLEANUP', 'stale_leads', c.env, { closed: closedCount })
    );

    return c.json({
      status: 'ok',
      action: 'cleanup_stale_leads',
      leads_closed: closedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[MAINTENANCE] Cleanup error:', error);
    return c.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * POST /sync-blocklist - Sincronizar blocklist D1 → KV
 */
maintenanceRoutes.post('/sync-blocklist', async (c) => {
  try {
    console.log('[SYNC] Starting blocklist sync from D1 to KV...');
    const result = await syncBlocklistFromD1(c.env);

    return c.json({
      status: 'success',
      message: `Sync complete: ${result.synced} entries synced, ${result.errors} errors`,
      synced: result.synced,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[SYNC] Error:', error);
    return c.json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * POST /fix-tables - Auto-migração de tabelas
 */
maintenanceRoutes.post('/fix-tables', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const db = c.env.DB;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS blocklist (
        telefone TEXT PRIMARY KEY,
        motivo TEXT,
        pausado_em DATETIME,
        expira_em DATETIME
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS vendedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        imagem TEXT,
        ativo BOOLEAN DEFAULT TRUE
      )
    `).run();

    return c.json({
      success: true,
      message: 'Tables ensured (blocklist, config, vendedores)',
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /re-summarize - Re-gerar resumos de leads
 */
maintenanceRoutes.post('/re-summarize', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const force = c.req.query('force') === 'true';

  try {
    let query = "SELECT * FROM leads WHERE ia_summary IS NULL OR ia_summary = '' ORDER BY created_at DESC LIMIT ?";
    if (force) {
      query = 'SELECT * FROM leads ORDER BY created_at DESC LIMIT ?';
    }

    const { results } = await c.env.DB.prepare(query).bind(limit).all();

    let processed = 0;
    const { summarizeConversation } = await import('@legacy/openai.service');

    for (const lead of results) {
      const { results: msgs } = await c.env.DB.prepare(
        'SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT 30'
      ).bind(lead.id).all();

      if (msgs.length > 0) {
        const summaryResult = await summarizeConversation(msgs as any[], c.env);
        const summary = summaryResult || '';

        await c.env.DB.prepare('UPDATE leads SET ia_summary = ? WHERE id = ?')
          .bind(summary, lead.id).run();

        const meta = JSON.parse((lead.metadata as string) || '{}');
        meta.last_summarized = new Date().toISOString();
        await c.env.DB.prepare('UPDATE leads SET metadata = ? WHERE id = ?')
          .bind(JSON.stringify(meta), lead.id).run();

        processed++;
      }
    }

    return c.json({
      success: true,
      processed,
      total_candidates: results.length,
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * GET /analyze-phones - Analisar telefones suspeitos
 */
maintenanceRoutes.get('/analyze-phones', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, nome, telefone, json_extract(metadata, '$.origin_source') as origin_source FROM leads"
    ).all();

    const suspicious: { id: string; telefone: string; length: number }[] = [];
    const distribution: Record<number, number> = {};

    for (const lead of results) {
      const phone = String(lead.telefone || '');
      const clean = phone.replace(/\D/g, '');
      const len = clean.length;

      distribution[len] = (distribution[len] || 0) + 1;

      if (len > 13 || len < 10) {
        suspicious.push({ id: String(lead.id), telefone: phone, length: len });
      }
    }

    return c.json({
      total: results.length,
      suspicious_count: suspicious.length,
      length_distribution: distribution,
      suspicious_leads: suspicious.slice(0, 100),
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * POST /cleanup-suspects - Limpar leads com telefones inválidos
 */
maintenanceRoutes.post('/cleanup-suspects', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ mode: 'dry_run' | 'execute'; ids?: string[] }>();
  const mode = body.mode || 'dry_run';

  try {
    let leadsToDelete: string[] = [];

    if (body.ids && body.ids.length > 0) {
      // Validate IDs are valid UUIDs to prevent injection
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      leadsToDelete = body.ids.filter(id => uuidRegex.test(id));
    } else {
      const { results } = await c.env.DB.prepare('SELECT id, telefone FROM leads').all();
      for (const lead of results) {
        const phone = String(lead.telefone || '');
        const clean = phone.replace(/\D/g, '');
        if (clean.length > 13 || clean.length < 10) {
          leadsToDelete.push(String(lead.id));
        }
      }
    }

    if (mode === 'execute' && leadsToDelete.length > 0) {
      // Process in batches of 50 to avoid SQL limits
      const batchSize = 50;
      for (let i = 0; i < leadsToDelete.length; i += batchSize) {
        const batch = leadsToDelete.slice(i, i + batchSize);
        // Use parameterized batch - each ID as separate bound parameter
        const statements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id)
        );
        const msgStatements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM messages WHERE lead_id = ?').bind(id)
        );
        const followupStatements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM followups WHERE lead_id = ?').bind(id)
        );
        
        // Execute all deletes in batch
        await c.env.DB.batch([...statements, ...msgStatements, ...followupStatements]);
      }
    }

    return c.json({
      success: true,
      mode,
      count: leadsToDelete.length,
      ids: leadsToDelete,
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});


/**
 * POST /cleanup-old-messages - LGPD: Limpar mensagens com mais de 90 dias
 * Mantém apenas resumo no lead.ia_summary
 */
maintenanceRoutes.post('/cleanup-old-messages', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ 
    days?: number; 
    mode?: 'dry_run' | 'execute';
  }>().catch(() => ({ days: undefined, mode: undefined }));
  
  const retentionDays = body.days || 90;
  const mode = body.mode || 'dry_run';

  console.log(`[LGPD] Starting message cleanup: ${retentionDays} days retention, mode: ${mode}`);

  try {
    // Calcular data limite
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffISO = cutoffDate.toISOString();

    // Contar mensagens a serem deletadas
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM messages 
      WHERE created_at < ?
    `).bind(cutoffISO).first<{ count: number }>();

    const messageCount = countResult?.count || 0;

    // Contar leads afetados
    const leadsResult = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT lead_id) as count FROM messages 
      WHERE created_at < ?
    `).bind(cutoffISO).first<{ count: number }>();

    const leadsAffected = leadsResult?.count || 0;

    let deletedCount = 0;

    if (mode === 'execute' && messageCount > 0) {
      // Deletar mensagens antigas
      const deleteResult = await c.env.DB.prepare(`
        DELETE FROM messages 
        WHERE created_at < ?
      `).bind(cutoffISO).run();

      deletedCount = deleteResult.meta?.changes || 0;

      // Log de auditoria
      c.executionCtx.waitUntil(
        logAudit('system', 'LGPD_MESSAGE_CLEANUP', 'messages', c.env, {
          retention_days: retentionDays,
          messages_deleted: deletedCount,
          leads_affected: leadsAffected,
          cutoff_date: cutoffISO,
        })
      );

      console.log(`[LGPD] Deleted ${deletedCount} messages older than ${retentionDays} days`);
    }

    return c.json({
      success: true,
      mode,
      retention_days: retentionDays,
      cutoff_date: cutoffISO,
      messages_to_delete: messageCount,
      leads_affected: leadsAffected,
      messages_deleted: mode === 'execute' ? deletedCount : 0,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    console.error('[LGPD] Cleanup error:', e);
    return c.json({ 
      error: e instanceof Error ? e.message : String(e) 
    }, 500);
  }
});

export { maintenanceRoutes };
