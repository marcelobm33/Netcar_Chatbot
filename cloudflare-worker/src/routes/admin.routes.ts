/**
 * Admin Routes
 * =============
 * Endpoints de administração (protegidos por verifyRole)
 * Inclui: CRUD leads, sellers, blocklist, config, chat actions
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { verifyRole, logAudit } from '@legacy/security.service';
import { DBService } from '@legacy/db.service';
import { StorageService } from '@legacy/storage.service';
import { sendVCard } from '@legacy/evolution.service';
import { listBlocklist, addToBlocklist, removeFromBlocklist } from '@legacy/blocklist.service';

const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============= LEADS =============

/**
 * GET /leads - Listar leads (paginado)
 */
adminRoutes.get('/leads', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const status = c.req.query('status');

  const db = new DBService(c.env.DB);
  const data = await db.getLeads(limit, offset, status);

  return c.json(data);
});

/**
 * PATCH /leads/:id - Atualizar lead
 */
adminRoutes.patch('/leads/:id', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const db = new DBService(c.env.DB);
  await db.updateLead(id, body);

  return c.json({ success: true });
});

/**
 * DELETE /leads/:id - Remover lead e dados relacionados
 */
adminRoutes.delete('/leads/:id', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM messages WHERE lead_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM followups WHERE lead_id = ?').bind(id).run();

  return c.json({ success: true });
});

/**
 * DELETE /leads/by-phone/:phone - LGPD Direito ao Esquecimento
 * Remove lead e todos os dados associados pelo número de telefone
 */
adminRoutes.delete('/leads/by-phone/:phone', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const phone = c.req.param('phone');
  
  if (!phone || phone.length < 10) {
    return c.json({ error: 'Invalid phone number' }, 400);
  }

  // Buscar lead pelo telefone
  const lead = await c.env.DB.prepare(
    'SELECT id FROM leads WHERE telefone = ? OR telefone LIKE ?'
  ).bind(phone, `%${phone}`).first<{ id: string }>();

  if (!lead) {
    return c.json({ error: 'Lead not found', phone }, 404);
  }

  const leadId = lead.id;

  // 1. Deletar mensagens
  const msgResult = await c.env.DB.prepare('DELETE FROM messages WHERE lead_id = ?')
    .bind(leadId).run();

  // 2. Deletar followups
  const fuResult = await c.env.DB.prepare('DELETE FROM followups WHERE lead_id = ?')
    .bind(leadId).run();

  // 3. Deletar lead
  await c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(leadId).run();

  // 4. Limpar contexto do KV cache
  try {
    if (c.env.NETCAR_CACHE) {
      await c.env.NETCAR_CACHE.delete(`ctx:${phone}`);
      await c.env.NETCAR_CACHE.delete(`context:${phone}`);
      await c.env.NETCAR_CACHE.delete(`lead:${phone}`);
    }
  } catch (e) {
    console.error('[LGPD] KV cleanup error:', e);
  }

  // 5. Log de auditoria
  c.executionCtx.waitUntil(
    logAudit('admin', 'LGPD_DATA_DELETION', phone, c.env, {
      lead_id: leadId,
      messages_deleted: msgResult.meta?.changes || 0,
      followups_deleted: fuResult.meta?.changes || 0,
    })
  );

  console.log(`[LGPD] Data deleted for phone ${phone.substring(0, 4)}*** (lead: ${leadId})`);

  return c.json({
    success: true,
    phone: phone.substring(0, 4) + '***',
    lead_id: leadId,
    messages_deleted: msgResult.meta?.changes || 0,
    followups_deleted: fuResult.meta?.changes || 0,
    kv_cleaned: true,
    timestamp: new Date().toISOString(),
  });
});

// ============= SELLERS =============

/**
 * GET /sellers - Listar vendedores
 */
adminRoutes.get('/sellers', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const db = new DBService(c.env.DB);
  const sellers = await db.getAllSellers();
  return c.json(sellers);
});

/**
 * GET /sellers/queue - Ver fila Round Robin
 */
adminRoutes.get('/sellers/queue', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const { getFromKV } = await import('@legacy/cache.service');
  const db = new DBService(c.env.DB);

  const currentIndex = (await getFromKV<number>(c.env, 'QUEUE_CURSOR_INDEX')) || 0;
  const activeSellers = await db.getActiveSellers();
  activeSellers.sort((a: { id: number }, b: { id: number }) => a.id - b.id);

  const nextIndex = (currentIndex + 1) % activeSellers.length;
  const nextSeller = activeSellers[nextIndex];

  return c.json({
    currentIndex,
    nextIndex,
    totalActiveSellers: activeSellers.length,
    nextSellerInQueue: nextSeller ? { id: nextSeller.id, nome: nextSeller.nome } : null,
    activeSellersOrder: activeSellers.map((s: { id: number; nome: string }, i: number) => ({
      position: i,
      id: s.id,
      nome: s.nome,
      isNext: i === nextIndex,
    })),
  });
});

/**
 * POST /sellers/queue/reset - Resetar fila Round Robin
 */
adminRoutes.post('/sellers/queue/reset', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const { setInKV } = await import('@legacy/cache.service');
  await setInKV(c.env, 'QUEUE_CURSOR_INDEX', 0);

  console.log('[CRM] ⚖️ Round Robin queue reset to 0');
  return c.json({ success: true, message: 'Queue reset to position 0' });
});

/**
 * POST /sellers - Criar ou atualizar vendedor
 */
adminRoutes.post('/sellers', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ id?: number; nome: string; whatsapp: string; imagem?: string; ativo?: boolean }>();

  if (!body.nome || !body.whatsapp)
    return c.json({ error: 'Missing fields' }, 400);

  if (body.id) {
    await c.env.DB.prepare(
      'UPDATE vendedores SET nome = ?, whatsapp = ?, imagem = ?, ativo = ? WHERE id = ?'
    ).bind(body.nome, body.whatsapp, body.imagem || null, body.ativo !== undefined ? body.ativo : true, body.id).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO vendedores (nome, whatsapp, imagem, ativo) VALUES (?, ?, ?, ?)'
    ).bind(body.nome, body.whatsapp, body.imagem || null, true).run();
  }

  return c.json({ success: true });
});

/**
 * DELETE /sellers/:id - Remover vendedor
 */
adminRoutes.delete('/sellers/:id', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM vendedores WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ============= CHAT ACTIONS =============

/**
 * POST /chat/send-vcard - Enviar VCard de vendedor
 */
adminRoutes.post('/chat/send-vcard', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ phone: string; seller_id: number }>();
  if (!body.phone || !body.seller_id)
    return c.json({ error: 'Missing fields' }, 400);

  const db = new DBService(c.env.DB);
  const sellers = await db.getActiveSellers();
  const seller = sellers.find((s: { id: number }) => s.id === body.seller_id);

  if (seller) {
    const chatId = `${body.phone.replace(/\D/g, '')}@s.whatsapp.net`;
    let sellerPhone = seller.whatsapp || '';
    if (sellerPhone.includes('wa.me/'))
      sellerPhone = sellerPhone.split('wa.me/')[1] || sellerPhone;
    sellerPhone = sellerPhone.replace(/\D/g, '');
    await sendVCard(chatId, seller.nome, sellerPhone, c.env, undefined, seller.imagem);
    return c.json({ success: true });
  }
  return c.json({ error: 'Seller not found' }, 404);
});

// ============= BLOCKLIST =============

/**
 * GET /blocklist - Listar números bloqueados
 */
adminRoutes.get('/blocklist', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '100', 10);
  const cursor = c.req.query('cursor');

  const data = await listBlocklist(c.env, limit, cursor);
  return c.json(data);
});

/**
 * POST /blocklist - Bloquear número
 */
adminRoutes.post('/blocklist', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ phone: string; reason?: string; duration_days?: number }>();
  if (!body.phone) return c.json({ error: 'phone required' }, 400);

  await addToBlocklist(body.phone, c.env, body.reason || 'Manual block', body.duration_days || 30);
  return c.json({ success: true, message: `Blocked ${body.phone}` });
});

/**
 * DELETE /blocklist/:phone - Desbloquear número
 */
adminRoutes.delete('/blocklist/:phone', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const phone = c.req.param('phone');
  await removeFromBlocklist(phone, c.env);
  return c.json({ success: true });
});

// ============= CONFIG =============

/**
 * GET /config - Listar configurações
 */
adminRoutes.get('/config', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const db = new DBService(c.env.DB);
  const config = await db.getAllConfig();
  return c.json(config);
});

/**
 * PATCH /config/:key - Atualizar configuração
 */
adminRoutes.patch('/config/:key', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);
  const key = c.req.param('key');
  const body = await c.req.json<{ value: string }>();

  if (!body.value) return c.json({ error: 'value required' }, 400);

  const db = new DBService(c.env.DB);
  await db.setConfig(key, body.value);
  return c.json({ success: true });
});

// ============= UPLOAD =============

/**
 * POST /upload - Upload de imagem para R2
 */
adminRoutes.post('/upload', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  try {
    const formData = await c.req.parseBody();
    const file = formData['file'];

    if (!(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400);
    }

    const extension = file.name.split('.').pop();
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

    const storage = new StorageService(c.env.IMAGES);
    await storage.uploadImage(filename, file.stream(), file.type);

    const url = `${new URL(c.req.url).origin}/images/${filename}`;

    return c.json({ success: true, url, key: filename });
  } catch (e: unknown) {
    console.error('Upload failed', e);
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ============= MAINTENANCE MODE =============

/**
 * GET /maintenance - Verificar status do modo manutenção
 */
adminRoutes.get('/maintenance', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const maintenanceMode = await c.env.NETCAR_CACHE.get('MAINTENANCE_MODE');
  return c.json({ 
    enabled: maintenanceMode === 'true',
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /maintenance - Ativar/desativar modo manutenção
 */
adminRoutes.post('/maintenance', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ enabled: boolean }>();
  
  if (body.enabled) {
    await c.env.NETCAR_CACHE.put('MAINTENANCE_MODE', 'true');
    console.log('[ADMIN] Modo manutenção ATIVADO');
  } else {
    await c.env.NETCAR_CACHE.delete('MAINTENANCE_MODE');
    console.log('[ADMIN] Modo manutenção DESATIVADO');
  }

  return c.json({ 
    success: true, 
    enabled: body.enabled,
    timestamp: new Date().toISOString()
  });
});

export { adminRoutes };
