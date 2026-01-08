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
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string; // gpt-4o-mini | deepseek-chat | claude-3-5-sonnet

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


