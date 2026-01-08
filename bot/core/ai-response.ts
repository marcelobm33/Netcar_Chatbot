/**
 * AI Response - Geração de Resposta com IA
 * ==========================================
 * Gera respostas usando LLM.
 * Core puro, recebe LLMClient via interface.
 */

import type { LLMClient, LLMMessage, ConversationContext, DetectedIntent } from '../types';

/**
 * Gera resposta de IA para o usuário
 */
export async function generateAIResponse(
  context: ConversationContext,
  intent: DetectedIntent,
  llmClient: LLMClient,
  systemPrompt: string
): Promise<string> {
  // Montar mensagens para o LLM
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.history.slice(-10) // Últimas 10 mensagens para contexto
  ];
  
  // Gerar resposta
  const response = await llmClient.complete(messages);
  
  return response;
}

/**
 * Gera resposta de saudação
 */
export function generateGreetingResponse(userName?: string): string {
  const name = userName ? `, ${userName.split(' ')[0]}` : '';
  
  const greetings = [
    `E aí${name}! Tudo bem? Sou o iAN, assistente da Netcar! 🚗 Posso te ajudar a encontrar o carro ideal. O que você procura?`,
    `Opa${name}! Beleza? Aqui é o iAN da Netcar! 🚗 Me conta, que tipo de carro você tá procurando?`,
    `Olá${name}! Sou o iAN, seu assistente virtual da Netcar! 🚗 Como posso te ajudar hoje?`,
  ];
  
  return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Gera resposta de ajuda
 */
export function generateHelpResponse(): string {
  return `Posso te ajudar a:
• Encontrar carros por marca, modelo ou preço
• Ver opções disponíveis no nosso estoque
• Te conectar com um consultor

É só me dizer o que precisa! 🚗`;
}

/**
 * Gera resposta de fallback (quando não entende)
 */
export function generateFallbackResponse(): string {
  const fallbacks = [
    'Desculpa, não entendi bem. Você está procurando algum carro específico?',
    'Hmm, não captei. Me fala mais sobre o que você precisa?',
    'Pode reformular? Estou aqui pra te ajudar a encontrar o carro ideal!',
  ];
  
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Aplica pós-processamento na resposta
 * - Remove emojis excessivos
 * - Limita tamanho
 * - Garante CTA no final
 */
export function postProcessResponse(response: string): string {
  let processed = response;
  
  // Limitar a 3 frases aproximadamente
  const sentences = processed.split(/[.!?]+/).filter(s => s.trim());
  if (sentences.length > 4) {
    processed = sentences.slice(0, 4).join('. ') + '.';
  }
  
  // Remover emojis excessivos (manter apenas 1-2)
  const emojiCount = (processed.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 2) {
    // Remove emojis além dos 2 primeiros
    let count = 0;
    processed = processed.replace(/[\u{1F300}-\u{1F9FF}]/gu, (match) => {
      count++;
      return count <= 2 ? match : '';
    });
  }
  
  return processed.trim();
}
