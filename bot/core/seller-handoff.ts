/**
 * Seller Handoff - Transferência para Vendedor
 * ==============================================
 * Lógica de transferência de atendimento para vendedor humano.
 * Core puro, usa interfaces.
 */

import type { Seller, SellerRepository, MessageBus } from '../types';

/**
 * Resultado do handoff
 */
export interface HandoffResult {
  success: boolean;
  seller?: Seller;
  message: string;
}

/**
 * Verifica se está em horário comercial
 * Seg-Sex: 9h-18h, Sáb: 9h-17h
 */
export function isBusinessHours(): boolean {
  const now = new Date();
  // Ajuste para horário de Brasília (UTC-3)
  const brasiliaOffset = -3 * 60;
  const localOffset = now.getTimezoneOffset();
  const adjustedMinutes = now.getMinutes() + localOffset + brasiliaOffset;
  const adjustedDate = new Date(now.getTime() + adjustedMinutes * 60 * 1000);
  
  const dayOfWeek = adjustedDate.getDay(); // 0=Dom, 6=Sab
  const hour = adjustedDate.getHours();
  
  // Domingo fechado
  if (dayOfWeek === 0) return false;
  
  // Sábado: 9h-17h
  if (dayOfWeek === 6) {
    return hour >= 9 && hour < 17;
  }
  
  // Seg-Sex: 9h-18h
  return hour >= 9 && hour < 18;
}

/**
 * Gera mensagem de horário de funcionamento
 */
export function getBusinessHoursMessage(): string {
  return 'Nosso horário de atendimento é Segunda a Sexta das 9h às 18h e Sábados das 9h às 17h.';
}

/**
 * Gera mensagem de handoff para o cliente
 */
export function generateHandoffMessage(seller: Seller | null, inBusinessHours: boolean): string {
  if (!inBusinessHours) {
    return `Estamos fora do horário de atendimento agora, mas registrei seu interesse! ` +
           `Um consultor vai entrar em contato assim que abrirmos. ${getBusinessHoursMessage()}`;
  }
  
  if (!seller) {
    return 'Vou passar você para um de nossos consultores. Aguarde um momento!';
  }
  
  return `Vou te passar pro ${seller.name}! Ele é fera e vai te ajudar com tudo. ` +
         `Já já ele te chama, beleza?`;
}

/**
 * Executa o handoff para vendedor
 */
export async function executeHandoff(
  userId: string,
  sellerRepository: SellerRepository,
  messageBus: MessageBus
): Promise<HandoffResult> {
  const inBusinessHours = isBusinessHours();
  
  // Obter próximo vendedor disponível
  const seller = await sellerRepository.getNext();
  
  // Gerar mensagem apropriada
  const message = generateHandoffMessage(seller, inBusinessHours);
  
  // Enviar mensagem ao cliente
  await messageBus.send(userId, message);
  
  // Se tem vendedor e está em horário comercial, enviar VCard
  if (seller && inBusinessHours) {
    await messageBus.sendVCard(userId, seller.name, seller.phone);
  }
  
  return {
    success: true,
    seller: seller || undefined,
    message
  };
}
