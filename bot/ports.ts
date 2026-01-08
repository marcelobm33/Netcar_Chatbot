/**
 * Bot Ports - Interfaces Formais para DI
 * ========================================
 * Ports que o CORE usa. Adapters implementam.
 * Core NUNCA importa implementações, só estas interfaces.
 * 
 * NOTA: Tipos base (Car, CarFilters, etc) estão em types.ts
 * Aqui definimos apenas os "Ports" (interfaces de serviço)
 */

import type { Car, CarFilters, LLMMessage } from './types';

// =============================================================================
// CAR REPOSITORY PORT
// =============================================================================

export interface CarRepositoryPort {
  /** Busca carros com filtros */
  search(filters: CarFilters): Promise<Car[]>;
  
  /** Busca carro por ID */
  getById(id: string): Promise<Car | null>;
  
  /** Lista marcas disponíveis */
  getBrands(): Promise<string[]>;
  
  /** Lista modelos de uma marca */
  getModelsByBrand(brand: string): Promise<string[]>;
}

// =============================================================================
// LLM PORT
// =============================================================================

export interface LLMPort {
  /** Completa uma conversa */
  complete(messages: LLMMessage[]): Promise<LLMPortResponse>;
  
  /** Completa com contexto de sistema */
  completeWithSystem(systemPrompt: string, userMessage: string): Promise<LLMPortResponse>;
}

export interface LLMPortResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  finishReason?: string;
}

// =============================================================================
// FIPE PORT
// =============================================================================

export interface FipePort {
  /** Busca preço FIPE por marca/modelo/ano */
  getPrice(marca: string, modelo: string, ano: number): Promise<FipePrice | null>;
  
  /** Lista marcas disponíveis na FIPE */
  getBrands(): Promise<FipeBrand[]>;
}

export interface FipePrice {
  valor: string;
  valorNumerico: number;
  combustivel: string;
  anoModelo: number;
  codigoFipe: string;
  mesReferencia: string;
}

export interface FipeBrand {
  codigo: string;
  nome: string;
}

// =============================================================================
// MESSAGE BUS PORT
// =============================================================================

export interface MessageBusPort {
  /** Envia mensagem de texto */
  send(to: string, message: string): Promise<void>;
  
  /** Envia imagem com opcional caption */
  sendImage(to: string, imageUrl: string, caption?: string): Promise<void>;
  
  /** Envia VCard de contato */
  sendVCard(to: string, name: string, phone: string): Promise<void>;
  
  /** Envia reação a uma mensagem */
  sendReaction(to: string, messageId: string, emoji: string): Promise<void>;
}

// =============================================================================
// CONTEXT STORE PORT
// =============================================================================

export interface ContextStorePort {
  /** Obtém contexto do usuário */
  get(userId: string): Promise<ConversationContextData | null>;
  
  /** Salva contexto do usuário */
  set(userId: string, context: ConversationContextData): Promise<void>;
  
  /** Limpa contexto do usuário */
  clear(userId: string): Promise<void>;
}

export interface ConversationContextData {
  userId: string;
  userName?: string;
  leadId?: string;
  history: LLMMessage[];
  lastFilters?: CarFilters;
  passiveMode?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// SELLER REPOSITORY PORT
// =============================================================================

export interface SellerRepositoryPort {
  /** Obtém próximo vendedor disponível (round-robin) */
  getNext(): Promise<SellerData | null>;
  
  /** Lista todos os vendedores */
  getAll(): Promise<SellerData[]>;
}

export interface SellerData {
  id: string;
  name: string;
  phone: string;
  available: boolean;
}
