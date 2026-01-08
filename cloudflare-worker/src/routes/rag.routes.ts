/**
 * RAG Routes
 * ==========
 * Endpoints para gerenciamento do Cloudflare Vectorize (RAG)
 * Inclui: indexação, bulk-index, seed automático
 */

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { verifyRole } from '@legacy/security.service';

const ragRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /rag/index - Indexar um documento
 */
ragRoutes.post('/index', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json<{
      id: string;
      content: string;
      title?: string;
    }>();
    if (!body.id || !body.content) {
      return c.json({ error: 'id and content are required' }, 400);
    }

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize not configured' }, 500);
    }

    // Generate embedding via OpenAI
    const embeddingResponse = await fetch(
      'https://api.openai.com/v1/embeddings',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: body.content.replace(/\n/g, ' ').substring(0, 8000),
        }),
      }
    );

    if (!embeddingResponse.ok) {
      const err = await embeddingResponse.text();
      return c.json({ error: 'Embedding failed', details: err }, 500);
    }

    const embeddingData = (await embeddingResponse.json()) as {
      data: { embedding: number[] }[];
    };
    const embedding = embeddingData.data[0].embedding;

    await c.env.VECTORIZE.upsert([
      {
        id: body.id,
        values: embedding,
        metadata: {
          content: body.content.substring(0, 10000),
          title: body.title || body.id,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    console.log(`[RAG] Indexed document: ${body.id} (${body.content.length} chars)`);
    return c.json({ success: true, id: body.id, chars: body.content.length });
  } catch (error) {
    console.error('[RAG] Index error:', error);
    return c.json({ error: 'Index failed', details: String(error) }, 500);
  }
});

/**
 * POST /rag/bulk-index - Indexar múltiplos documentos
 */
ragRoutes.post('/bulk-index', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  try {
    const body = await c.req.json<{
      documents: { id: string; content: string; title?: string }[];
    }>();
    if (!body.documents || !Array.isArray(body.documents)) {
      return c.json({ error: 'documents array required' }, 400);
    }

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize not configured' }, 500);
    }

    let indexed = 0;
    for (const doc of body.documents) {
      try {
        const embeddingResponse = await fetch(
          'https://api.openai.com/v1/embeddings',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: doc.content.replace(/\n/g, ' ').substring(0, 8000),
            }),
          }
        );

        if (!embeddingResponse.ok) continue;

        const embeddingData = (await embeddingResponse.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = embeddingData.data[0].embedding;

        await c.env.VECTORIZE.upsert([
          {
            id: doc.id,
            values: embedding,
            metadata: {
              content: doc.content.substring(0, 10000),
              title: doc.title || doc.id,
              createdAt: new Date().toISOString(),
            },
          },
        ]);
        indexed++;
      } catch (e) {
        console.error(`[RAG] Failed to index ${doc.id}:`, e);
      }
    }

    return c.json({ success: true, indexed, total: body.documents.length });
  } catch (error) {
    console.error('[RAG] Bulk index error:', error);
    return c.json({ error: 'Bulk index failed', details: String(error) }, 500);
  }
});

/**
 * POST /rag/seed - Popular base com documentos embutidos
 */
ragRoutes.post('/seed', async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, 'admin')))
    return c.json({ error: 'Unauthorized' }, 401);

  try {
    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize not configured' }, 500);
    }

    const { getAllDocuments, getDocumentStats } = await import('../data/knowledge-base');
    const documents = getAllDocuments();
    const stats = getDocumentStats();

    console.log(`[RAG SEED] Starting seed with ${documents.length} documents...`);

    let indexed = 0;
    let failed = 0;
    const results: { id: string; status: string }[] = [];

    for (const doc of documents) {
      try {
        const embeddingResponse = await fetch(
          'https://api.openai.com/v1/embeddings',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: doc.content.replace(/\n/g, ' ').substring(0, 8000),
            }),
          }
        );

        if (!embeddingResponse.ok) {
          console.error(`[RAG SEED] Failed embedding for ${doc.id}`);
          failed++;
          results.push({ id: doc.id, status: 'embedding_failed' });
          continue;
        }

        const embeddingData = (await embeddingResponse.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = embeddingData.data[0].embedding;

        await c.env.VECTORIZE.upsert([
          {
            id: doc.id,
            values: embedding,
            metadata: {
              content: doc.content.substring(0, 10000),
              title: doc.title,
              category: doc.category,
              createdAt: new Date().toISOString(),
            },
          },
        ]);

        indexed++;
        results.push({ id: doc.id, status: 'indexed' });
        console.log(`[RAG SEED] ✅ Indexed: ${doc.id}`);

        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`[RAG SEED] Error indexing ${doc.id}:`, e);
        failed++;
        results.push({ id: doc.id, status: 'error' });
      }
    }

    console.log(`[RAG SEED] Completed: ${indexed}/${documents.length} indexed, ${failed} failed`);

    return c.json({
      success: true,
      indexed,
      failed,
      total: documents.length,
      stats,
      results,
    });
  } catch (error) {
    console.error('[RAG SEED] Error:', error);
    return c.json({ error: 'Seed failed', details: String(error) }, 500);
  }
});

export { ragRoutes };
