/**
 * Feedback Service - Vendor Feedback Loop
 * 
 * Permite vendedores avaliarem respostas do bot para:
 * - Identificar respostas problemáticas
 * - Melhorar treinamento contínuo
 * - Medir qualidade percebida
 */

import { Env } from '@types';

// =============================================================================
// TYPES
// =============================================================================

export interface Feedback {
  id: string;
  messageId: string;
  conversationId: string;
  rating: 'positive' | 'negative' | 'neutral';
  category?: 'incorrect' | 'rude' | 'slow' | 'helpful' | 'other';
  comment?: string;
  vendorId: string;
  createdAt: string;
}

export interface FeedbackStats {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  satisfactionRate: number; // 0-100%
  topIssues: { category: string; count: number }[];
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/**
 * Initialize feedback table (run once)
 */
export async function initFeedbackTable(env: Env): Promise<void> {
  if (!env.DB) {
    console.warn('[FEEDBACK] Database not configured');
    return;
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      category TEXT,
      comment TEXT,
      vendor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  // Create index for analytics
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating)
  `).run();

  console.log('[FEEDBACK] Table initialized');
}

/**
 * Submit feedback for a message
 */
export async function submitFeedback(
  env: Env,
  feedback: Omit<Feedback, 'id' | 'createdAt'>
): Promise<Feedback | null> {
  if (!env.DB) {
    console.warn('[FEEDBACK] Database not configured');
    return null;
  }

  const id = `fb_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const createdAt = new Date().toISOString();

  try {
    await env.DB.prepare(`
      INSERT INTO feedback (id, message_id, conversation_id, rating, category, comment, vendor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      feedback.messageId,
      feedback.conversationId,
      feedback.rating,
      feedback.category || null,
      feedback.comment || null,
      feedback.vendorId,
      createdAt
    ).run();

    console.log(`[FEEDBACK] Recorded: ${feedback.rating} from ${feedback.vendorId}`);

    return {
      id,
      ...feedback,
      createdAt,
    };
  } catch (error) {
    console.error('[FEEDBACK] Error submitting:', error);
    return null;
  }
}

/**
 * Get feedback statistics
 */
export async function getFeedbackStats(
  env: Env,
  days: number = 7
): Promise<FeedbackStats | null> {
  if (!env.DB) return null;

  try {
    // Get rating counts
    const ratingsResult = await env.DB.prepare(`
      SELECT 
        rating,
        COUNT(*) as count
      FROM feedback
      WHERE created_at > datetime('now', '-' || ? || ' days')
      GROUP BY rating
    `).bind(days).all();

    const ratings = ratingsResult.results || [];
    const positive = ratings.find(r => r.rating === 'positive')?.count as number || 0;
    const negative = ratings.find(r => r.rating === 'negative')?.count as number || 0;
    const neutral = ratings.find(r => r.rating === 'neutral')?.count as number || 0;
    const total = positive + negative + neutral;

    // Get category breakdown for negative feedback
    const issuesResult = await env.DB.prepare(`
      SELECT 
        category,
        COUNT(*) as count
      FROM feedback
      WHERE rating = 'negative' 
        AND category IS NOT NULL
        AND created_at > datetime('now', '-' || ? || ' days')
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `).bind(days).all();

    const topIssues = (issuesResult.results || []).map(r => ({
      category: r.category as string,
      count: r.count as number,
    }));

    const satisfactionRate = total > 0 
      ? Math.round((positive / total) * 100) 
      : 0;

    return {
      totalFeedback: total,
      positiveCount: positive,
      negativeCount: negative,
      neutralCount: neutral,
      satisfactionRate,
      topIssues,
    };
  } catch (error) {
    console.error('[FEEDBACK] Error getting stats:', error);
    return null;
  }
}

/**
 * Get recent negative feedback for review
 */
export async function getNegativeFeedback(
  env: Env,
  limit: number = 20
): Promise<Feedback[]> {
  if (!env.DB) return [];

  try {
    const result = await env.DB.prepare(`
      SELECT *
      FROM feedback
      WHERE rating = 'negative'
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return (result.results || []).map(r => ({
      id: r.id as string,
      messageId: r.message_id as string,
      conversationId: r.conversation_id as string,
      rating: r.rating as 'negative',
      category: (r.category as Feedback['category']),
      comment: r.comment as string | undefined,
      vendorId: r.vendor_id as string,
      createdAt: r.created_at as string,
    }));
  } catch (error) {
    console.error('[FEEDBACK] Error getting negative feedback:', error);
    return [];
  }
}
