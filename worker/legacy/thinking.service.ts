/**
 * Thinking Service - Two-Pass Reasoning System (Pass 1)
 * ======================================================
 * Analisa o contexto da conversa ANTES de gerar a resposta.
 * Isso permite que a IA "pense" sobre o que o cliente quer.
 * 
 * Custo: ~$0.0005 por análise (gpt-4o-mini com prompt curto)
 * Latência: ~300-500ms adicionais
 */

import type { Env } from '@types';
import { THINKING_PROMPT } from '../config/unified-prompt';

// =============================================================================
// TYPES
// =============================================================================

export interface ThinkingResult {
  /** Último assunto discutido na conversa */
  lastTopic: string;
  
  /** Intenção atual do cliente */
  currentIntent: string;
  
  /** Como a mensagem atual conecta com o contexto anterior */
  connection: string;
  
  /** Ação sugerida para a resposta */
  suggestedAction: string;
  
  /** Se deve passar para vendedor humano */
  shouldHandoff: boolean;
  
  /** Resumo de contexto para injetar no Pass 2 */
  contextSummary: string;
  
  /** Tempo de processamento em ms */
  processingTime: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Analisa o contexto da conversa para entender a intenção real do cliente.
 * 
 * @param currentMessage - Mensagem atual do cliente
 * @param recentHistory - Últimas mensagens da conversa
 * @param env - Bindings do Worker
 * @returns Resultado da análise de contexto
 */
export async function analyzeContext(
  currentMessage: string,
  recentHistory: Message[],
  env: Env
): Promise<ThinkingResult> {
  const startTime = Date.now();
  
  // Fallback para mensagens muito curtas ou simples
  if (currentMessage.length < 3 || isSimpleGreeting(currentMessage)) {
    return createDefaultResult(currentMessage, startTime);
  }
  
  try {
    // Construir resumo do histórico (últimas 5 mensagens)
    const historyContext = recentHistory
      .slice(-5)
      .map(m => `${m.role === 'user' ? 'Cliente' : 'Bot'}: ${m.content.substring(0, 100)}`)
      .join('\n');
    
    const userPrompt = `HISTÓRICO RECENTE:
${historyContext || 'Início da conversa'}

MENSAGEM ATUAL DO CLIENTE:
"${currentMessage}"

Analise e retorne o JSON:`;

    // Chamar gpt-4o-mini com temperatura baixa para consistência
    // AI Gateway da Cloudflare
    const CF_ACCOUNT_ID = '11edc212d8f0ae41b9594f87b2724ea4';
    const CF_GATEWAY_ID = 'netcar-ian';
    const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`;
    
    const response = await fetch(`${AI_GATEWAY_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: THINKING_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      }),
    });
    
    if (!response.ok) {
      console.error(`[THINKING] API error: ${response.status}`);
      return createDefaultResult(currentMessage, startTime);
    }
    
    const data = await response.json() as { 
      choices: { message: { content: string } }[];
      usage?: { total_tokens: number };
    };
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return createDefaultResult(currentMessage, startTime);
    }
    
    const parsed = JSON.parse(content) as Partial<ThinkingResult>;
    const processingTime = Date.now() - startTime;
    
    console.log(`[THINKING] ✅ Analyzed in ${processingTime}ms | Intent: ${parsed.currentIntent} | Action: ${parsed.suggestedAction}`);
    
    return {
      lastTopic: parsed.lastTopic || 'Não identificado',
      currentIntent: parsed.currentIntent || 'conversa_geral',
      connection: parsed.connection || 'Sem conexão clara',
      suggestedAction: parsed.suggestedAction || 'responder_naturalmente',
      shouldHandoff: parsed.shouldHandoff || false,
      contextSummary: parsed.contextSummary || '',
      processingTime,
    };
    
  } catch (error) {
    console.error('[THINKING] Error:', error);
    return createDefaultResult(currentMessage, startTime);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Verifica se é uma saudação simples (não precisa de análise profunda)
 */
function isSimpleGreeting(message: string): boolean {
  const greetings = [
    'oi', 'olá', 'ola', 'opa', 'bom dia', 'boa tarde', 'boa noite',
    'e aí', 'eai', 'hey', 'hi', 'hello', 'começar', 'iniciar'
  ];
  const normalized = message.toLowerCase().trim();
  return greetings.some(g => normalized === g || normalized.startsWith(g + ' '));
}

/**
 * Cria resultado padrão quando não consegue analisar
 */
function createDefaultResult(message: string, startTime: number): ThinkingResult {
  return {
    lastTopic: 'Início ou conversa geral',
    currentIntent: 'conversa_geral',
    connection: 'Primeira mensagem ou contexto não disponível',
    suggestedAction: 'responder_naturalmente',
    shouldHandoff: false,
    contextSummary: '',
    processingTime: Date.now() - startTime,
  };
}

/**
 * Formata o contexto de thinking para injetar no prompt principal
 */
export function formatThinkingContext(thinking: ThinkingResult): string {
  if (!thinking.contextSummary && thinking.currentIntent === 'conversa_geral') {
    return ''; // Não adicionar nada se for conversa geral
  }
  
  return `
[CONTEXTO DA ANÁLISE - Use isso para guiar sua resposta]
• Último assunto: ${thinking.lastTopic}
• Intenção atual: ${thinking.currentIntent}
• Conexão: ${thinking.connection}
• Ação sugerida: ${thinking.suggestedAction}
• Resumo: ${thinking.contextSummary}
[/CONTEXTO]`;
}
