/**
 * Feedback Routes
 * ===============
 * Endpoints para vendedores submitirem feedback sobre respostas do bot
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { verifyRole } from '@legacy/security.service';
import { submitFeedback, getFeedbackStats, getNegativeFeedback, initFeedbackTable } from '@legacy/feedback.service';

const feedbackRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// =============================================================================
// POST /feedback - Submeter feedback
// =============================================================================
feedbackRoutes.post('/', async (c) => {
  // Only admin can submit feedback (vendor role not implemented yet)
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      messageId: string;
      conversationId: string;
      rating: 'positive' | 'negative' | 'neutral';
      category?: 'incorrect' | 'rude' | 'slow' | 'helpful' | 'other';
      comment?: string;
      vendorId: string;
    }>();

    if (!body.messageId || !body.conversationId || !body.rating || !body.vendorId) {
      return c.json({ error: 'messageId, conversationId, rating, and vendorId are required' }, 400);
    }

    const feedback = await submitFeedback(c.env, body);

    if (!feedback) {
      return c.json({ error: 'Failed to submit feedback' }, 500);
    }

    return c.json({
      success: true,
      data: feedback,
    });
  } catch (error) {
    console.error('[FEEDBACK] Submit error:', error);
    return c.json({ error: 'Failed to submit feedback' }, 500);
  }
});

// =============================================================================
// GET /feedback/stats - Estatísticas de feedback
// =============================================================================
feedbackRoutes.get('/stats', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const days = parseInt(c.req.query('days') || '7', 10);
  const stats = await getFeedbackStats(c.env, Math.min(days, 90));

  if (!stats) {
    return c.json({ error: 'Failed to get feedback stats' }, 500);
  }

  return c.json({
    success: true,
    data: {
      period: `last_${days}_days`,
      ...stats,
    },
  });
});

// =============================================================================
// GET /feedback/issues - Feedback negativo recente para revisão
// =============================================================================
feedbackRoutes.get('/issues', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const limit = parseInt(c.req.query('limit') || '20', 10);
  const issues = await getNegativeFeedback(c.env, Math.min(limit, 100));

  return c.json({
    success: true,
    data: {
      count: issues.length,
      issues,
    },
  });
});

// =============================================================================
// POST /feedback/init - Inicializar tabela (admin only, run once)
// =============================================================================
feedbackRoutes.post('/init', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await initFeedbackTable(c.env);
  
  return c.json({
    success: true,
    message: 'Feedback table initialized',
  });
});

export default feedbackRoutes;
