/**
 * Bot - Tipos e Interfaces
 * =========================
 * Interfaces que o CORE define, ADAPTERS implementam.
 * Core depende apenas destas interfaces, nunca de implementações concretas.
 */

// =============================================================================
// MENSAGENS
// =============================================================================

export interface MessageBus {
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
// CARROS
// =============================================================================

export interface CarFilters {
  marca?: string;
  modelo?: string;
  anoMin?: number;
  anoMax?: number;
  valorMin?: number;
  valorMax?: number;
  cor?: string;
  combustivel?: string;
  cambio?: string;
  limit?: number;
}

export interface Car {
  id: string;
  marca: string;
  modelo: string;
  ano: number;
  
  // Preços
  valor: number;
  valorFormatado: string;
  preco_com_troca?: number;
  preco_com_troca_formatado?: string;
  tem_desconto?: number;
  
  // Especificações
  cor: string;
  motor: string;
  combustivel: string;
  cambio: string;
  km?: number;
  potencia?: string;
  portas?: number;
  lugares?: number;
  
  // Documentação
  placa?: string;
  
  // Equipamentos básicos
  direcao?: string | null;
  ar_condicionado?: string | null;
  vidros_eletricos?: string | null;
  travas_eletricas?: string | null;
  airbag?: string | null;
  abs?: string | null;
  alarme?: string | null;
  
  // Status do veículo
  documentacao?: string | null;
  
  // Observações
  observacoes?: string | null;
  descricao?: string | null;
  
  // Links e mídia
  link?: string;
  have_galery?: number;
  imagens?: { thumb: string[]; full: string[] };
  
  // Opcionais
  opcionais?: string[];              // Lista de descrições (ex: "Ar Condicionado")
  opcionais_raw?: Array<{ tag: string; descricao: string }>; // Raw da API (tag + descrição)
  
  // Status
  destaque?: number;
  promocao?: number;
}

export interface CarRepository {
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
// LLM (Large Language Model)
// =============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClient {
  /** Completa uma conversa */
  complete(messages: LLMMessage[]): Promise<string>;
  
  /** Completa com contexto de sistema */
  completeWithSystem(systemPrompt: string, userMessage: string): Promise<string>;
}

// =============================================================================
// CONTEXTO DE CONVERSAÇÃO
// =============================================================================

export interface ConversationContext {
  userId: string;
  userName?: string;
  leadId?: string;
  currentIntent?: string;
  lastFilters?: CarFilters;
  history: LLMMessage[];
  summary?: string;
  passiveMode?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextStore {
  /** Obtém contexto do usuário */
  get(userId: string): Promise<ConversationContext | null>;
  
  /** Salva contexto do usuário */
  set(userId: string, context: ConversationContext): Promise<void>;
  
  /** Limpa contexto do usuário */
  clear(userId: string): Promise<void>;
  
  /** Adiciona mensagem ao histórico */
  addMessage(userId: string, message: LLMMessage): Promise<void>;
}

// =============================================================================
// PROCESSAMENTO DE MENSAGEM
// =============================================================================

export interface ProcessMessageInput {
  message: string;
  sender: string;
  senderName?: string;
  imageUrl?: string;
  isGroup?: boolean;
}

export interface ProcessMessageResult {
  response?: string;
  action?: 'respond' | 'handoff' | 'ignore' | 'search';
  cars?: Car[];
  shouldContinue: boolean;
}

// =============================================================================
// INTENÇÃO
// =============================================================================

export type IntentType = 
  | 'car_search'      // Buscar carro
  | 'price_query'     // Perguntar preço
  | 'negotiation'     // Negociação/financiamento
  | 'greeting'        // Saudação
  | 'help'            // Pedir ajuda
  | 'handoff'         // Falar com humano
  | 'testimonial'     // Ver depoimentos
  | 'location'        // Localização/horário
  | 'other';          // Outros

export interface DetectedIntent {
  type: IntentType;
  confidence: number;
  filters?: CarFilters;
  raw?: string;
}

// =============================================================================
// VENDEDOR
// =============================================================================

export interface Seller {
  id: string;
  name: string;
  phone: string;
  available: boolean;
}

export interface SellerRepository {
  /** Obtém próximo vendedor disponível (round-robin) */
  getNext(): Promise<Seller | null>;
  
  /** Lista todos os vendedores */
  getAll(): Promise<Seller[]>;
}
