/**
 * Process Message - Orquestrador Principal
 * ==========================================
 * Core do bot: recebe mensagem, detecta intenção, executa ação.
 * 
 * IMPORTANTE: Este arquivo NÃO deve importar de:
 * - services/evolution.*
 * - services/db.*
 * Deve usar apenas as interfaces de ../types.ts
 */

import type { 
  ProcessMessageInput, 
  ProcessMessageResult,
  MessageBus,
  CarRepository,
  LLMClient,
  ContextStore
} from '../types';

/**
 * Dependências injetadas (Dependency Injection)
 * Permite trocar implementações para testes ou diferentes plataformas
 */
export interface ProcessMessageDeps {
  messageBus: MessageBus;
  carRepository: CarRepository;
  llmClient: LLMClient;
  contextStore: ContextStore;
}

/**
 * Processa uma mensagem de entrada
 * 
 * @param input - Dados da mensagem
 * @param deps - Dependências injetadas
 * @returns Resultado do processamento
 * 
 * @example
 * const result = await processMessage(
 *   { message: "Quero um Onix", sender: "5551999999999" },
 *   { messageBus, carRepository, llmClient, contextStore }
 * );
 */
export async function processMessage(
  input: ProcessMessageInput,
  deps: ProcessMessageDeps
): Promise<ProcessMessageResult> {
  const { message, sender, senderName } = input;
  const { contextStore, llmClient, carRepository, messageBus } = deps;

  // 1. Carregar contexto do usuário
  let context = await contextStore.get(sender);
  if (!context) {
    context = {
      userId: sender,
      userName: senderName,
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // 2. Adicionar mensagem ao histórico
  context.history.push({ role: 'user', content: message });
  context.updatedAt = new Date();

  // 3. Detectar intenção (será implementado em intent-detection.ts)
  // const intent = await detectIntent(message, context);

  // 4. Executar ação baseada na intenção
  // TODO: Implementar lógica completa

  // 5. Gerar resposta IA se necessário
  // const response = await generateAIResponse(context, intent, deps);

  // 6. Salvar contexto atualizado
  await contextStore.set(sender, context);

  // Placeholder - será expandido
  return {
    shouldContinue: true,
    action: 'respond',
  };
}

/**
 * Cria as dependências com implementações concretas
 * Usado pelo adapter do WhatsApp para injetar as deps reais
 */
export function createDeps(/* env, etc */): ProcessMessageDeps {
  // TODO: Implementar factory com adapters reais
  throw new Error('Not implemented - use adapters');
}
