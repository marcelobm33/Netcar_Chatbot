/**
 * NLG Policy Service - Response Format Validator
 * 
 * Enforces Prompt V4 Spec Section 6 (Política de resposta):
 * - Até 3 frases por turno
 * - Máximo 1 pergunta
 * - Sem emojis
 * - Sempre com CTA no final
 */

// =============================================================================
// TYPES
// =============================================================================

export interface NLGValidationResult {
  isValid: boolean;
  violations: string[];
  sanitizedResponse?: string;
  metrics: {
    sentenceCount: number;
    questionCount: number;
    emojiCount: number;
    hasCTA: boolean;
    wordCount: number;
  };
}

// =============================================================================
// EMOJI DETECTION
// =============================================================================

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FAFF}]/gu;

export function removeEmojis(text: string): string {
  return text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
}

export function countEmojis(text: string): number {
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

// =============================================================================
// SENTENCE & QUESTION DETECTION
// =============================================================================

function countSentences(text: string): number {
  // Split by sentence-ending punctuation
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length;
}

function countQuestions(text: string): number {
  const matches = text.match(/\?/g);
  return matches ? matches.length : 0;
}

/**
 * CRITICAL FIX: Truncate response to only ONE question
 * If response has multiple questions, keep only the first one
 * and all non-question sentences
 */
function truncateToOneQuestion(text: string): string {
  // Split by sentence boundaries (keep the punctuation)
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  
  let result: string[] = [];
  let questionCount = 0;
  
  for (const sentence of sentences) {
    const hasQuestion = sentence.includes('?');
    
    if (hasQuestion) {
      if (questionCount === 0) {
        // Keep the first question
        result.push(sentence);
        questionCount++;
      }
      // Skip additional questions (violation fix)
    } else {
      // Keep all non-question sentences
      result.push(sentence);
    }
  }
  
  return result.join(' ').trim();
}

// =============================================================================
// CTA DETECTION
// =============================================================================

const CTA_PATTERNS = [
  // Questions as CTA
  /\?$/,
  /o que (tu )?acha/i,
  /quer (que eu|ver|saber)/i,
  /te (interessa|chamou)/i,
  /posso te/i,
  /me (conta|diz|fala)/i,
  
  // Action prompts
  /vamos/i,
  /bora/i,
  /fechou/i,
  /beleza\??$/i,
  /topa\??$/i,
  /combina(do)?\??$/i,
  
  // Explicit CTAs
  /precisando/i,
  /qualquer (coisa|dúvida)/i,
  /é só (me )?chamar/i,
  /tô (aqui|por aqui)/i,
];

function hasCTA(text: string): boolean {
  // Check if ends with question
  if (text.trim().endsWith('?')) return true;
  
  // Check for CTA patterns
  return CTA_PATTERNS.some(pattern => pattern.test(text));
}

// =============================================================================
// FORBIDDEN PHRASES
// =============================================================================

const FORBIDDEN_PHRASES = [
  'vou verificar',
  'deixa eu ver',
  'posso te mostrar',
  'vou dar uma olhada',
  'já te passo',
  'vou buscar aqui',
];

function containsForbiddenPhrase(text: string): string | null {
  const normalized = text.toLowerCase();
  return FORBIDDEN_PHRASES.find(phrase => normalized.includes(phrase)) || null;
}

// =============================================================================
// MAIN VALIDATOR
// =============================================================================

export function validateResponse(response: string): NLGValidationResult {
  const violations: string[] = [];
  
  // Metrics
  const sentenceCount = countSentences(response);
  const questionCount = countQuestions(response);
  const emojiCount = countEmojis(response);
  const ctaPresent = hasCTA(response);
  const wordCount = response.split(/\s+/).filter(w => w.length > 0).length;
  
  // Validation checks
  if (sentenceCount > 3) {
    violations.push(`Excede 3 frases (tem ${sentenceCount})`);
  }
  
  if (questionCount > 1) {
    violations.push(`Excede 1 pergunta (tem ${questionCount})`);
  }
  
  if (emojiCount > 0) {
    violations.push(`Contém ${emojiCount} emoji(s)`);
  }
  
  if (!ctaPresent) {
    violations.push('Falta CTA no final');
  }
  
  const forbidden = containsForbiddenPhrase(response);
  if (forbidden) {
    violations.push(`Contém frase proibida: "${forbidden}"`);
  }
  
  return {
    isValid: violations.length === 0,
    violations,
    sanitizedResponse: emojiCount > 0 ? removeEmojis(response) : undefined,
    metrics: {
      sentenceCount,
      questionCount,
      emojiCount,
      hasCTA: ctaPresent,
      wordCount,
    }
  };
}

// =============================================================================
// RESPONSE SANITIZER
// =============================================================================

export function sanitizeResponse(response: string): string {
  let sanitized = response;
  
  // Remove emojis
  sanitized = removeEmojis(sanitized);
  
  // Remove multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  // Remove numbered menus (forbidden)
  sanitized = sanitized.replace(/\d+[.)]\s+/g, '');
  
  return sanitized;
}

// =============================================================================
// CTA INJECTION
// =============================================================================

const DEFAULT_CTAS = [
  'O que tu acha?',
  'Te interessa?',
  'Quer ver mais opções?',
  'Posso te ajudar com algo mais?',
  'Me conta o que tu procura.',
  'Alguma dúvida?',
  'Quer saber mais?',
  'Bora conferir?',
  'Fechou?',
  'Curtiu?',
  'Que tal?',
  'Posso ajudar em mais algo?',
  'Quer que eu busque algo específico?',
];

export function addCTAIfMissing(response: string): string {
  if (hasCTA(response)) {
    return response;
  }
  
  // Pick a random CTA
  const cta = DEFAULT_CTAS[Math.floor(Math.random() * DEFAULT_CTAS.length)];
  
  // Ensure proper spacing
  const trimmed = response.trim();
  const needsSpace = !trimmed.endsWith('.') && !trimmed.endsWith('!');
  
  return needsSpace 
    ? `${trimmed}. ${cta}` 
    : `${trimmed} ${cta}`;
}

// =============================================================================
// FULL PIPELINE
// =============================================================================

export function enforceNLGPolicy(response: string): {
  response: string;
  wasModified: boolean;
  validation: NLGValidationResult;
} {
  const validation = validateResponse(response);
  let finalResponse = response;
  let wasModified = false;
  
  // CRITICAL FIX: Truncate to one question (audit violation #1)
  if (validation.metrics.questionCount > 1) {
    finalResponse = truncateToOneQuestion(finalResponse);
    wasModified = true;
    console.log(`[NLG-POLICY] Truncated from ${validation.metrics.questionCount} to 1 question`);
  }
  
  // Remove emojis
  if (validation.metrics.emojiCount > 0) {
    finalResponse = removeEmojis(finalResponse);
    wasModified = true;
  }
  
  // Add CTA if missing
  if (!validation.metrics.hasCTA) {
    finalResponse = addCTAIfMissing(finalResponse);
    wasModified = true;
  }
  
  // Log if modified
  if (wasModified) {
    console.log('[NLG-POLICY] Response was modified to comply with policy');
    console.log('[NLG-POLICY] Violations fixed:', validation.violations);
  }
  
  return {
    response: finalResponse,
    wasModified,
    validation,
  };
}

// =============================================================================
// LOGGING
// =============================================================================

export function logNLGMetrics(validation: NLGValidationResult): void {
  console.log('[NLG-POLICY] Metrics:', JSON.stringify(validation.metrics));
  if (!validation.isValid) {
    console.warn('[NLG-POLICY] Violations:', validation.violations.join(', '));
  }
}
