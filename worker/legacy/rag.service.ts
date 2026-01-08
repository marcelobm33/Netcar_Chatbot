/**
 * RAG Service - Cloudflare Vectorize Edition
 * ===========================================================
 * Busca vetorial usando Cloudflare Vectorize (100% sem Supabase)
 * ===========================================================
 */
import { Env } from '@types';

interface VectorMatch {
  id: string;
  score: number;
  metadata?: {
    content?: string;
    title?: string;
    category?: string;
  };
}

// Score mínimo para considerar um match relevante
const MIN_RELEVANCE_SCORE = 0.70;

/**
 * Gera embedding para uma query
 */
async function generateEmbedding(query: string, env: Env): Promise<number[] | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query.replace(/\n/g, ' ').substring(0, 8000),
      }),
    });

    if (!response.ok) {
      console.error('[RAG] Embedding error:', await response.text());
      return null;
    }

    const data = await response.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  } catch (error) {
    console.error('[RAG] Embedding exception:', error);
    return null;
  }
}

/**
 * Busca no Vectorize com filtro opcional por categoria
 */
async function searchVectorize(
  embedding: number[],
  env: Env,
  options: { excludeCategory?: string; onlyCategory?: string } = {}
): Promise<VectorMatch[]> {
  if (!env.VECTORIZE) {
    console.warn('[RAG] Vectorize não configurado');
    return [];
  }

  const results = await env.VECTORIZE.query(embedding, {
    topK: 5,
    returnMetadata: 'all',
  });

  if (!results.matches?.length) return [];

  // Filtrar por categoria se especificado
  let matches = results.matches as VectorMatch[];
  
  if (options.excludeCategory) {
    matches = matches.filter(m => m.metadata?.category !== options.excludeCategory);
  }
  
  if (options.onlyCategory) {
    matches = matches.filter(m => m.metadata?.category === options.onlyCategory);
  }

  // Filtrar por score mínimo
  return matches.filter(m => m.score >= MIN_RELEVANCE_SCORE);
}

/**
 * Busca conhecimento (FAQs, policies, products) - EXCLUI style
 */
export async function searchKnowledge(query: string, env: Env): Promise<string | null> {
  // Skip very short queries - not worth the embedding API call
  if (query.trim().length < 15) return null;

  try {
    const embedding = await generateEmbedding(query, env);
    if (!embedding) return null;

    const matches = await searchVectorize(embedding, env, { excludeCategory: 'style' });

    if (matches.length > 0) {
      // Log estruturado
      const matchInfo = matches.slice(0, 3).map(m => 
        `${m.metadata?.title || m.id}(${(m.score * 100).toFixed(0)}%)`
      ).join(', ');
      console.log(`[RAG:Knowledge] Query: "${query.substring(0, 30)}..." → ${matchInfo}`);

      return matches
        .map(m => m.metadata?.content || '')
        .filter(c => c.length > 0)
        .join('\n\n');
    }

    console.log(`[RAG:Knowledge] No match for: "${query.substring(0, 30)}..."`);
    return null;
  } catch (error) {
    console.error('[RAG:Knowledge] Error:', error);
    return null;
  }
}

/**
 * Busca exemplos de estilo (tom, linguagem) - APENAS style
 */
export async function searchStyle(query: string, env: Env): Promise<string | null> {
  if (query.trim().length < 5) return null;

  try {
    const embedding = await generateEmbedding(query, env);
    if (!embedding) return null;

    const matches = await searchVectorize(embedding, env, { onlyCategory: 'style' });

    if (matches.length > 0) {
      const matchInfo = matches.slice(0, 2).map(m => 
        `${m.metadata?.title || m.id}(${(m.score * 100).toFixed(0)}%)`
      ).join(', ');
      console.log(`[RAG:Style] Query: "${query.substring(0, 30)}..." → ${matchInfo}`);

      // Retorna apenas o melhor match de estilo
      return matches[0].metadata?.content || null;
    }

    console.log(`[RAG:Style] No style match for: "${query.substring(0, 30)}..."`);
    return null;
  } catch (error) {
    console.error('[RAG:Style] Error:', error);
    return null;
  }
}

/**
 * Busca combinada: conhecimento + estilo (para respostas completas)
 */
export async function searchCombined(
  query: string,
  env: Env
): Promise<{ knowledge: string | null; style: string | null }> {
  const [knowledge, style] = await Promise.all([
    searchKnowledge(query, env),
    searchStyle(query, env),
  ]);

  return { knowledge, style };
}

/**
 * Adiciona um documento à base vetorial
 * @param id - ID único do documento
 * @param content - Conteúdo do documento
 * @param title - Título opcional
 * @param env - Bindings do Worker
 */
export async function addDocument(
  id: string,
  content: string,
  title: string,
  env: Env
): Promise<boolean> {
  try {
    if (!env.VECTORIZE) {
      console.warn('[RAG] Vectorize não configurado.');
      return false;
    }

    // 1. Gerar embedding do conteúdo
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: content.replace(/\n/g, ' '),
      }),
    });

    if (!embeddingResponse.ok) {
      console.error('[RAG] Erro ao gerar embedding para inserção:', await embeddingResponse.text());
      return false;
    }

    const embeddingData = await embeddingResponse.json() as { data: { embedding: number[] }[] };
    const embedding = embeddingData.data[0].embedding;

    // 2. Inserir no Vectorize
    await env.VECTORIZE.upsert([
      {
        id,
        values: embedding,
        metadata: {
          content,
          title,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    console.log(`[RAG] Documento inserido: ${id}`);
    return true;

  } catch (error) {
    console.error('[RAG] Erro ao inserir documento:', error);
    return false;
  }
}
