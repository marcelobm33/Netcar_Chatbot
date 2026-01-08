/**
 * SaaS Routes
 * ============
 * API proprietária para clientes externos do SaaS.
 * Inclui: autenticação, token management, leads API pública
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { DBService } from '@legacy/db.service';
import { AuthService } from '@legacy/auth.service';
import { verifyRole } from '@legacy/security.service';

const saasRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============= DOCUMENTATION =============

/**
 * GET /docs - Renderizar documentação da API
 */
saasRoutes.get('/docs', (c) => c.text('API Docs: Use Postman collection or check /api/health'));

// ============= AUTHENTICATION =============

/**
 * POST /auth/login - Login com credenciais fixas
 */
saasRoutes.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json<{
      email: string;
      password: string;
    }>();

    // Hardcoded credentials as requested
    if (
      email === 'contato@netcarmultimarcas.com.br' &&
      password === '@Netcar2025'
    ) {
      return c.json({
        success: true,
        token: c.env.NETCAR_ADMIN_KEY,
        user: { name: 'Admin Netcar', email },
      });
    }

    return c.json({ error: 'Invalid credentials' }, 401);
  } catch (e) {
    return c.json({ error: 'Bad Request' }, 400);
  }
});

// ============= PROTECTED API =============
// Todas as rotas abaixo requerem autenticação

const protectedApi = new Hono<{ Bindings: Env; Variables: Variables }>();
protectedApi.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.NETCAR_ADMIN_KEY}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userRole', 'admin');
  await next();
});

// =======================
// INTERNAL: TOKEN MANAGEMENT
// =======================

/**
 * POST /v1/internal/tokens - Criar novo token de API
 */
protectedApi.post('/v1/internal/tokens', async (c) => {
  if (c.get('userRole') !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  try {
    const { label } = await c.req.json<{ label: string }>();
    if (!label) return c.json({ error: 'Label required' }, 400);

    const auth = new AuthService(c.env.DB);
    const result = await auth.createToken(label);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

/**
 * GET /v1/internal/tokens - Listar tokens de API
 */
protectedApi.get('/v1/internal/tokens', async (c) => {
  if (c.get('userRole') !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  try {
    const auth = new AuthService(c.env.DB);
    const tokens = await auth.listTokens();
    return c.json({ data: tokens });
  } catch (e) {
    return c.json({ error: 'Failed to list tokens' }, 500);
  }
});

/**
 * DELETE /v1/internal/tokens/:id - Revogar token de API
 */
protectedApi.delete('/v1/internal/tokens/:id', async (c) => {
  if (c.get('userRole') !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  try {
    const id = parseInt(c.req.param('id'), 10);
    const auth = new AuthService(c.env.DB);
    await auth.revokeToken(id);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: 'Failed to revoke token' }, 500);
  }
});

// =======================
// PUBLIC CLIENT API
// =======================

/**
 * GET /v1/leads - Listar leads com paginação
 */
protectedApi.get('/v1/leads', async (c) => {
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const offset = (page - 1) * limit;
  const status = c.req.query('status');

  try {
    const db = new DBService(c.env.DB);
    const { leads, total } = await db.getLeads(limit, offset, status);

    return c.json({
      data: leads.map((l) => {
        let meta = l.metadata;
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta);
          } catch {
            /* Ignore parse errors */
          }
        }
        return {
          id: l.id,
          phone: l.telefone,
          name: l.nome,
          interest: l.interesse,
          status: (meta as Record<string, unknown>)?.status || 'novo',
          summary: (meta as Record<string, unknown>)?.resumo_ia || null,
          created_at: l.created_at,
          last_interaction: l.last_interaction,
          seller: (meta as Record<string, unknown>)?.vendedor_nome || null,
        };
      }),
      meta: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (e) {
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

/**
 * GET /v1/leads/:id/transcript - Obter histórico de mensagens de um lead
 */
protectedApi.get('/v1/leads/:id/transcript', async (c) => {
  const leadId = c.req.param('id');
  try {
    const db = new DBService(c.env.DB);
    const messages = await db.getLeadTranscript(leadId);

    return c.json({
      lead_id: leadId,
      count: messages.length,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch transcript' }, 500);
  }
});

// Mount protected routes
saasRoutes.route('/', protectedApi);

export { saasRoutes };
