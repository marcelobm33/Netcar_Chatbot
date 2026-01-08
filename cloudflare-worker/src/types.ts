/**
 * Environment bindings for Cloudflare Worker
 */
export interface Env {
  // Variables from wrangler.toml
  EVOLUTION_API_URL: string;
  EVOLUTION_INSTANCE: string;

  // Secrets (added via wrangler secret put)
  EVOLUTION_API_KEY: string;
  OPENAI_API_KEY: string;
  NETCAR_ADMIN_KEY: string;
  NETCAR_ADMIN_EMAIL?: string;
  NETCAR_ADMIN_PASSWORD?: string;
  DEEPSEEK_API_KEY?: string;
  AI_MODEL?: string; // gpt-4o-mini | deepseek-chat

  // Feature Flags
  AGENT_V2_ENABLED?: string; // "true" = Planner-Executor-Validator, "false" = legacy

  // Sentry Error Monitoring
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;

  // Logging
  LOG_LEVEL?: 'debug' | 'info' | 'warning' | 'error';

  // D1 Database (when enabled)
  DB: D1Database;

  // R2 Bucket for Images
  IMAGES: R2Bucket;

  // R2 Cache Bucket
  CACHE_BUCKET: R2Bucket;

  // KV Cache Namespace
  NETCAR_CACHE: KVNamespace;

  // Vectorize - Busca Vetorial (RAG)
  VECTORIZE: VectorizeIndex;

  // Rate Limiters
  WEBHOOK_RATE_LIMITER: RateLimit;
  API_RATE_LIMITER: RateLimit;
  OPENAI_RATE_LIMITER: RateLimit;
  
  // Additional Rate Limiters (Cost Protection)
  D1_WRITE_LIMITER?: RateLimit;
  KV_WRITE_LIMITER?: RateLimit;
  VECTORIZE_LIMITER?: RateLimit;
  AI_LIMITER?: RateLimit;

  // Queues - Background Processing
  BACKGROUND_QUEUE?: Queue<Record<string, unknown>>;

  // Analytics Engine - Custom Metrics
  METRICS?: AnalyticsEngineDataset;

  // Webhook Configuration
  CLIENT_WEBHOOK_URL?: string;

  // Context injection (Runtime)
  ctx: ExecutionContext;
}

/**
 * Hono Context Variables
 */
export type Variables = {
  userRole: 'admin' | 'client';
}

/**
 * Evolution API Webhook Payload
 */
export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      remoteJidAlt?: string;
      remoteJidAlternativo?: string; // Evolution v2.3.6+ - número real quando remoteJid é @lid
      fromMe: boolean;
      id: string;
      participant?: string;
    };
    pushName: string;
    // senderPn: Phone number when available (Evolution API >= some version)
    // This is the REAL phone number when remoteJid is a @lid
    senderPn?: string;
    message: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
        title?: string;        // Preview card title (e.g. "YARIS SEDAN XLS CONNECT")
        description?: string;  // Preview card description
        canonicalUrl?: string; // The actual URL (fb.me, instagram.com, etc)
        matchedText?: string;  // The URL in the message text
      };
      audioMessage?: {
        base64?: string; // Evolution often sends this if includeBase64 is on
        url?: string;
        mimetype: string;
      };
      imageMessage?: {
        base64?: string;
        url?: string;
        caption?: string;
        mimetype: string;
      };
    };
    messageType: string;
    messageTimestamp: number;
  };
}

/**
 * Car data from NetCar API
 */
export interface CarData {
  id: string;
  marca: string;
  modelo: string;
  ano: number;
  preco: string;
  cor: string;
  km: number;
  cambio: string;
  combustivel: string;
  motor: string;
  potencia: string;    // e.g. "82 cv"
  portas: number;      // e.g. 4
  opcionais: string[]; // Top 5 opcionais
  imageUrl: string;
  link: string;
}

/**
 * Lead Interface (Synced with DB)
 */
export interface Lead {
  id: string;
  telefone: string;
  nome: string;
  interesse?: string;
  metadata?: any;
  created_at?: string;
  last_interaction?: string;
}




// =============================================================================
// BOT CORE TYPES (Merged from bot/types.ts)
// =============================================================================

// MENSAGENS
export interface MessageBus {
  send(to: string, message: string): Promise<void>;
  sendImage(to: string, imageUrl: string, caption?: string): Promise<void>;
  sendVCard(to: string, name: string, phone: string): Promise<void>;
  sendReaction(to: string, messageId: string, emoji: string): Promise<void>;
}

// CARROS
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
  search(filters: CarFilters): Promise<Car[]>;
  getById(id: string): Promise<Car | null>;
  getBrands(): Promise<string[]>;
  getModelsByBrand(brand: string): Promise<string[]>;
}

// LLM
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClient {
  complete(messages: LLMMessage[]): Promise<string>;
  completeWithSystem(systemPrompt: string, userMessage: string): Promise<string>;
}

// CONTEXTO
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
  get(userId: string): Promise<ConversationContext | null>;
  set(userId: string, context: ConversationContext): Promise<void>;
  clear(userId: string): Promise<void>;
  addMessage(userId: string, message: LLMMessage): Promise<void>;
}

// INTENÇÃO
export type IntentType = 
  | 'car_search'
  | 'price_query'
  | 'negotiation'
  | 'greeting'
  | 'help'
  | 'handoff'
  | 'testimonial'
  | 'location'
  | 'other';

export interface DetectedIntent {
  type: IntentType;
  confidence: number;
  filters?: CarFilters;
  raw?: string;
}

// VENDEDOR
export interface Seller {
  id: string;
  name: string;
  phone: string;
  available: boolean;
}

export interface SellerRepository {
  getNext(): Promise<Seller | null>;
  getAll(): Promise<Seller[]>;
}
