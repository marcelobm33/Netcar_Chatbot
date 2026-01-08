/**
 * Anti-Repeat Service
 * ===================
 * Prevents repetitive responses by comparing with recent responses.
 * 
 * Features:
 * - Simple hash comparison for exact duplicates
 * - Similarity check based on word overlap
 * - Auto-reformulation if too similar
 */

import type { Env } from '@types';

// =============================================================================
// TYPES
// =============================================================================

export interface ResponseRecord {
  hash: string;
  text: string;
  at: string;
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Check if a new response is too similar to recent responses
 */
export function isResponseTooSimilar(
  newResponse: string,
  lastResponses: ResponseRecord[],
  threshold: number = 0.75
): boolean {
  if (!lastResponses || lastResponses.length === 0) {
    return false;
  }

  const normalizedNew = normalizeText(newResponse);
  const newHash = simpleHash(normalizedNew);

  for (const prev of lastResponses.slice(0, 5)) {
    // Exact hash match = definitely too similar
    if (prev.hash === newHash) {
      console.log(`[ANTI-REPEAT] Exact hash match detected`);
      return true;
    }

    // Word-based similarity check
    const similarity = calculateSimilarity(normalizedNew, normalizeText(prev.text));
    if (similarity > threshold) {
      console.log(`[ANTI-REPEAT] High similarity detected: ${(similarity * 100).toFixed(1)}%`);
      return true;
    }
  }

  return false;
}

/**
 * Create a response record for storage
 */
export function createResponseRecord(text: string): ResponseRecord {
  const normalized = normalizeText(text);
  return {
    hash: simpleHash(normalized),
    text: text,
    at: new Date().toISOString()
  };
}

/**
 * Generate variation instructions for reformulation
 */
export function getVariationInstructions(originalResponse: string): string {
  return `
A resposta anterior era muito similar às anteriores. Reformule usando:
- Ângulo diferente (foco em outro benefício)
- Estrutura de frase diferente
- Palavras diferentes (sinônimos)

Resposta original para reformular:
"${originalResponse}"

IMPORTANTE: Mantenha o mesmo significado e CTA, apenas mude a forma.
`;
}

/**
 * Reformulate a response using the AI to avoid repetition
 * Uses GPT-4o-mini with higher temperature for variation
 */
export async function reformulateResponse(
  originalResponse: string,
  env: Env
): Promise<string> {
  const startTime = Date.now();
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente que reformula mensagens para evitar repetição.
Mantenha o mesmo tom, significado e objetivo, mas mude:
- A estrutura da frase
- As palavras (use sinônimos)
- A abertura (se começa com "Opa", mude para "E aí", "Fala", etc)
Responda APENAS com a mensagem reformulada, sem explicações.`
          },
          {
            role: 'user',
            content: `Reformule esta mensagem de forma diferente:\n\n"${originalResponse}"`
          }
        ],
        temperature: 0.7, // Alta para mais variação
        max_tokens: 300
      })
    });

    if (!response.ok) {
      console.error(`[ANTI-REPEAT] Reformulation API error: ${response.status}`);
      return originalResponse; // Fallback to original
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const reformulated = data.choices?.[0]?.message?.content?.trim();
    
    if (reformulated && reformulated.length > 10) {
      const latency = Date.now() - startTime;
      console.log(`[ANTI-REPEAT] ✅ Reformulated in ${latency}ms`);
      return reformulated;
    }

    return originalResponse;
  } catch (error) {
    console.error('[ANTI-REPEAT] Reformulation failed:', error);
    return originalResponse;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove pontuação
    .replace(/\s+/g, ' ')     // Normaliza espaços
    .trim();
}

/**
 * Simple hash function for quick comparison
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Calculate word-based Jaccard similarity between two texts
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(text2.split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  // Jaccard similarity: intersection / union
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Check if response starts with same greeting pattern
 */
export function hasSameGreetingPattern(newResponse: string, prevResponse: string): boolean {
  const greetingPatterns = [
    /^opa[,!]?\s*/i,
    /^e a[íi][,!]?\s*/i,
    /^fala[,!]?\s*/i,
    /^show[,!]?\s*/i,
    /^beleza[,!]?\s*/i,
    /^tranquilo[,!]?\s*/i,
    /^entendi[,!]?\s*/i,
  ];

  for (const pattern of greetingPatterns) {
    const newMatches = pattern.test(newResponse);
    const prevMatches = pattern.test(prevResponse);
    if (newMatches && prevMatches) {
      return true;
    }
  }

  return false;
}
