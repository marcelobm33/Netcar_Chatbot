/**
 * Response Validator Service
 * ===========================
 * Valida respostas ANTES de enviar ao cliente.
 * Garante que código decide, não LLM.
 * 
 * Regras:
 * 1. Após handoff, NÃO fazer perguntas de qualificação
 * 2. Não repetir respostas similares
 * 3. Limite de tamanho
 * 4. Reformular se necessário
 */

import type { Env } from '@types';
import type { ConversationContext } from './context.service';
import type { PlannerResult } from './planner.service';

// =============================================================================
// TYPES
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  response: string;
  reason?: string;
  wasReformulated: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Padrões de perguntas de qualificação que não devem aparecer após handoff */
const QUALIFICATION_PATTERNS = [
  /qual\s*valor/i,
  /quanto\s*(quer|pode)\s*investir/i,
  /tem\s*carro\s*pra\s*troca/i,
  /qual\s*modelo\s*te\s*interessa/i,
  /qual\s*(é\s*)?o?\s*tipo\s*de\s*ve[ií]culo/i,
  /que\s*tipo\s*de\s*carro/i,
  /quanto\s*quer\s*pagar/i,
  /qual\s*(é\s*)?seu\s*or[çc]amento/i,
  /prefere\s*financiar/i,
  /vai\s*dar\s*entrada/i,
];

/** Limite máximo de caracteres na resposta */
const MAX_RESPONSE_LENGTH = 500;

/** Threshold de similaridade para considerar repetição */
const SIMILARITY_THRESHOLD = 0.75;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Valida a resposta antes de enviar ao cliente.
 * Pode reformular se necessário.
 */
export async function validateResponse(
  response: string,
  ctx: ConversationContext,
  plannerResult: PlannerResult | null,
  env: Env,
  options?: { skipPassiveMode?: boolean; originalMessage?: string }
): Promise<ValidationResult> {
  
  // Regra 1: Após handoff, NÃO fazer perguntas de qualificação
  if (ctx.sellerHandoff?.done) {
    if (hasQualificationQuestion(response)) {
      console.log('[VALIDATOR] Removing qualification question after handoff');
      const reformulated = await reformulateResponse(
        response,
        'Remova perguntas de qualificação. Apenas confirme e se coloque à disposição. O consultor já foi acionado.',
        env
      );
      return {
        valid: true,
        response: reformulated,
        reason: 'Removed qualification question after handoff',
        wasReformulated: true,
      };
    }
  }
  
  // Regra 2: Anti-repetição
  if (ctx.lastBotMessage?.text) {
    const similarity = calculateSimilarity(response, ctx.lastBotMessage.text);
    if (similarity > SIMILARITY_THRESHOLD) {
      console.log(`[VALIDATOR] Response too similar (${(similarity * 100).toFixed(0)}%)`);
      const reformulated = await reformulateResponse(
        response,
        'Reformule de forma COMPLETAMENTE diferente. Mude o ângulo, use outras palavras, aborde de outra forma.',
        env
      );
      return {
        valid: true,
        response: reformulated,
        reason: `Similarity ${(similarity * 100).toFixed(0)}% - reformulated`,
        wasReformulated: true,
      };
    }
  }
  
  // Regra 3: Limite de tamanho
  if (response.length > MAX_RESPONSE_LENGTH) {
    console.log(`[VALIDATOR] Response too long (${response.length} chars)`);
    const reformulated = await reformulateResponse(
      response,
      `Encurte para máximo ${MAX_RESPONSE_LENGTH} caracteres. Mantenha apenas o essencial.`,
      env
    );
    return {
      valid: true,
      response: reformulated.substring(0, MAX_RESPONSE_LENGTH + 50), // Safety margin
      reason: 'Truncated long response',
      wasReformulated: true,
    };
  }

  // Regra 3.5: Anti-respostas genéricas que matam a venda
  // Captura padrões como "Beleza! Qualquer coisa, tô por aqui!"
  const genericPatterns = [
    /^beleza!?\s*(qualquer|qqer)?\s*coisa/i,
    /^(ok|tá|ta|valeu)!?\s*(qualquer|qqer)?\s*coisa/i,
    /qualquer\s*(coisa|dúvida).*tô\s*por\s*aqui/i,
    /^entendi!?\s*$/, // Respostas muito curtas
    /^show!?\s*$/,
    /^beleza!?\s*$/,
    /^ok!?\s*$/,
  ];
  
  const isGenericResponse = genericPatterns.some(p => p.test(response.trim()));
  
  if (isGenericResponse) {
    console.log('[VALIDATOR] ⚠️ Detected generic "conversation killer" response - reformulating');
    const reformulated = await reformulateResponse(
      response,
      'Esta resposta é muito genérica e "mata" a conversa. Reformule de forma ENGAJADORA: faça uma pergunta relevante, ofereça algo específico, ou dê uma dica útil sobre carros. NUNCA responda apenas "Qualquer coisa, tô por aqui".',
      env
    );
    return {
      valid: true,
      response: reformulated,
      reason: 'Reformulated generic response',
      wasReformulated: true,
    };
  }
  
  // Regra 3.6: Cooldown de Nome
  // O nome só pode aparecer:
  // - Na primeira resposta (turno 1)
  // - Após 5+ mensagens sem usar o nome
  // - Quando há mudança clara de estado (FSM)
  // NUNCA em mensagens consecutivas!
  const clientName = (ctx as any)?.qualification?.nome || ctx?.userName;
  if (clientName && clientName.length > 1) {
    const namePattern = new RegExp(`\\b${clientName}\\b`, 'gi');
    const hasNameInResponse = namePattern.test(response);
    
    if (hasNameInResponse) {
      const turnCount = (ctx as any)?.turnCount || 0;
      const lastNameUsedAt = (ctx as any)?.lastNameUsedAt || 0;
      const turnsSinceLastName = turnCount - lastNameUsedAt;
      
      // Permitir nome apenas em: 1ª msg, após 5+ turnos, ou mudança de estado
      const isFirstMessage = turnCount <= 1;
      const hasCooldownPassed = turnsSinceLastName >= 5;
      const isStateChange = (ctx as any)?.stateChanged === true;
      
      const canUseName = isFirstMessage || hasCooldownPassed || isStateChange;
      
      if (!canUseName) {
        console.log(`[VALIDATOR] ⚠️ Name cooldown active (turn ${turnCount}, last used at ${lastNameUsedAt}). Removing name from response.`);
        // Remove o nome da resposta
        const responseWithoutName = response.replace(namePattern, '').replace(/^,\s*/, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
        return {
          valid: true,
          response: responseWithoutName,
          reason: `Name cooldown - removed "${clientName}" (turn ${turnCount})`,
          wasReformulated: true,
        };
      } else {
        console.log(`[VALIDATOR] ✅ Name allowed (turn ${turnCount}, first=${isFirstMessage}, cooldown=${hasCooldownPassed})`);
      }
    }
  }
  
  // Regra 4: Modo passivo (plannerResult)
  // SKIP if: option explicitly set, or message looks like new car interest
  // IMPORTANTE: Modo passivo NÃO deve bloquear perguntas reais do cliente!
  if (plannerResult?.passive_mode && !options?.skipPassiveMode) {
    // Check if original message looks like new car interest OR is a real question
    const originalMsg = options?.originalMessage?.toLowerCase().trim() || '';
    
    // Detectar interesse em carro ou pergunta real
    const isNewCarInterest = /^(tem|quero|busco|procuro|quer|voces tem|vocês tem)\s+\w+/i.test(originalMsg);
    const isRealQuestion = originalMsg.includes('?'); // QUALQUER pergunta deve ser respondida!
    const isCarComparison = /(melhor|diferença|comparar|creta|tracker|compass|kicks|hb20|onix|argo|polo|t-cross|nivus|tcross|corolla|civic|sentra|cruze|spin)/i.test(originalMsg);
    const isAboutCar = /(carro|veículo|modelo|motor|consumo|espaço|porta-malas|banco|preço|km|quilometragem|ano)/i.test(originalMsg);
    
    // Se é uma pergunta real, comparação ou sobre carros, deixar resposta passar
    if (isNewCarInterest || isRealQuestion || isCarComparison || isAboutCar) {
      console.log('[VALIDATOR] Skipping passive mode - client has real question or car interest');
      // Don't enforce passive mode, let response through
    } else if (response.length > 150 || hasQualificationQuestion(response)) {
      console.log('[VALIDATOR] Enforcing passive mode');
      return {
        valid: true,
        response: 'Entendi! Me conta mais: tá buscando algo específico ou quer ver nossas novidades? 🚗',
        reason: 'Enforced passive mode',
        wasReformulated: true,
      };
    }
  }

  
  // Tudo OK
  return {
    valid: true,
    response,
    wasReformulated: false,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Verifica se a resposta contém perguntas de qualificação
 */
function hasQualificationQuestion(text: string): boolean {
  return QUALIFICATION_PATTERNS.some(p => p.test(text));
}

/**
 * Calcula similaridade entre duas strings (0-1)
 * Usando algoritmo simples de Jaccard com n-grams
 */
function calculateSimilarity(str1: string, str2: string): number {
  const normalize = (s: string) => 
    s.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  
  // Se strings são idênticas
  if (s1 === s2) return 1;
  
  // N-grams (3 caracteres)
  const ngrams = (s: string, n: number = 3): Set<string> => {
    const result = new Set<string>();
    for (let i = 0; i <= s.length - n; i++) {
      result.add(s.substring(i, i + n));
    }
    return result;
  };
  
  const set1 = ngrams(s1);
  const set2 = ngrams(s2);
  
  if (set1.size === 0 || set2.size === 0) return 0;
  
  // Jaccard similarity
  let intersection = 0;
  for (const gram of set1) {
    if (set2.has(gram)) intersection++;
  }
  
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

/**
 * Reformula a resposta usando LLM
 * Inclui cache para evitar chamadas repetidas
 */
async function reformulateResponse(
  original: string,
  instruction: string,
  env: Env
): Promise<string> {
  try {
    // CHECK CACHE FIRST
    const cacheKey = `REFORMULATE:${simpleHash(original + instruction)}`;
    
    if (env.NETCAR_CACHE) {
      const cached = await env.NETCAR_CACHE.get(cacheKey);
      if (cached) {
        console.log('[VALIDATOR] Using cached reformulation');
        return cached;
      }
    }
    
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/11edc212d8f0ae41b9594f87b2724ea4/netcar-ian/openai/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: `Você é um assistente de reformulação. Reescreva a mensagem seguindo a instrução.
Mantenha o tom de vendedor de carros amigável e informal.
Retorne APENAS a mensagem reformulada, sem explicações.`,
            },
            {
              role: 'user',
              content: `INSTRUÇÃO: ${instruction}\n\nMENSAGEM ORIGINAL:\n${original}`,
            },
          ],
        }),
      }
    );
    
    if (!response.ok) {
      console.error('[VALIDATOR] Reformulation API error:', response.status);
      return original; // Fallback para original
    }
    
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reformulated = data.choices?.[0]?.message?.content || original;
    
    // SAVE TO CACHE (1 hour TTL)
    if (env.NETCAR_CACHE && reformulated !== original) {
      await env.NETCAR_CACHE.put(cacheKey, reformulated, { expirationTtl: 3600 });
      console.log('[VALIDATOR] Reformulation cached');
    }
    
    return reformulated;
    
  } catch (error) {
    console.error('[VALIDATOR] Reformulation error:', error);
    return original;
  }
}

/**
 * Calcula hash simples para anti-repetição
 */
export function simpleHash(str: string): string {
  let hash = 0;
  const normalized = str.toLowerCase().replace(/[^\w]/g, '');
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Verifica se resposta é similar às últimas N respostas
 */
export function isSimilarToRecentResponses(
  response: string,
  lastResponses: Array<{ text: string; hash: string }>,
  threshold: number = SIMILARITY_THRESHOLD
): boolean {
  const responseHash = simpleHash(response);
  
  for (const prev of lastResponses.slice(0, 5)) {
    // Hash match = identical
    if (prev.hash === responseHash) return true;
    
    // Similarity check
    if (calculateSimilarity(response, prev.text) > threshold) return true;
  }
  
  return false;
}
