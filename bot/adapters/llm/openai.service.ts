import type { Env } from '../types';
import { cleanPrompt } from '../config/clean-prompt';
import { sanitizeUserInput } from './security.service';
import { createLogger } from './logger.service';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'auto' | 'low' | 'high';
    };
  }>;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Estimate token count (char/4 is ~1 token for English/Portuguese)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate messages to fit within context limit
 * Keeps system prompt + ALWAYS keeps the last user message + as many recent messages as possible
 * Does NOT count image base64 data as text tokens (Vision API handles images separately)
 */
function truncateMessages(messages: OpenAIMessage[], env: Env, maxTokens: number = 7000): OpenAIMessage[] {
  if (messages.length === 0) return messages;
  const log = createLogger('worker', env);
  
  if (messages.length <= 2) return messages; // System + 1 user message - no need to truncate

  const result: OpenAIMessage[] = [];
  let tokenCount = 0;

  // Always include system prompt (first message)
  const systemMsg = messages[0];
  if (systemMsg?.role === 'system') {
    const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content);
    tokenCount += estimateTokens(systemContent);
    result.push(systemMsg);
  }

  // ALWAYS include the last message (current user message) - even if it has an image
  const lastMessage = messages[messages.length - 1];
  const mustIncludeLast = lastMessage && lastMessage.role === 'user';
  
  // Calculate tokens for last message (but skip base64 image data)
  if (mustIncludeLast) {
    if (typeof lastMessage.content === 'string') {
      tokenCount += estimateTokens(lastMessage.content);
    } else if (Array.isArray(lastMessage.content)) {
      // Only count text tokens, skip image_url tokens (they use Vision API pricing, not text tokens)
      for (const part of lastMessage.content) {
        if (part.type === 'text' && part.text) {
          tokenCount += estimateTokens(part.text);
        }
        // Skip image_url - OpenAI Vision handles image tokens separately
      }
    }
  }

  // Process history messages (from newest to oldest, excluding first and last)
  const historyMessages = messages.slice(1, -1).reverse();
  const fittingMessages: OpenAIMessage[] = [];

  for (const msg of historyMessages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const msgTokens = estimateTokens(content);

    if (tokenCount + msgTokens < maxTokens) {
      fittingMessages.push(msg);
      tokenCount += msgTokens;
    } else {
      log.info(`[OPENAI] Truncating: ${historyMessages.length - fittingMessages.length} history messages dropped. Total tokens: ~${tokenCount}`);
      break;
    }
  }

  // Build final array: system + history (in correct order) + current user message
  const finalMessages = [...result, ...fittingMessages.reverse()];
  if (mustIncludeLast) {
    finalMessages.push(lastMessage);
  }
  
  return finalMessages;
}


/**
 * Call OpenAI Chat Completion API (Edge-compatible via fetch)
 * With automatic truncation and retry logic
 */
export async function callOpenAI(
  messages: OpenAIMessage[],
  env: Env,
  options?: {
    model?: string;
    temperature?: number;
  }
): Promise<string> {
  const log = createLogger('worker', env);
  
  // Determinar modelo: parâmetro > DB config > env.AI_MODEL > default
  let model = options?.model;
  
  // Se não foi passado via parâmetro, buscar do DB
  if (!model) {
    try {
      const { DBService } = await import('./db.service');
      const db = new DBService(env.DB);
      const dbModel = await db.getConfig('ai_model');
      log.info(`[AI] DB ai_model value: "${dbModel}"`);
      if (dbModel && dbModel.trim()) {
        model = dbModel.trim();
        log.info(`[AI] Using model from DB config: ${model}`);
      }
    } catch (e) {
      log.warn('[AI] Failed to fetch ai_model from DB, using fallback', { error: e });
    }
  }
  
  // Fallback para env ou default (deepseek-chat conforme painel)
  model = model || env.AI_MODEL || 'deepseek-chat';
  const temperature = options?.temperature ?? 0.7; // Increased from 0.4 for more natural variation
  
  // Detectar se é DeepSeek ou OpenAI
  // Modelos fine-tuned (ft:) sempre usam API OpenAI
  const isFineTuned = model.startsWith('ft:');
  const isDeepSeek = model.toLowerCase().includes('deepseek') && !isFineTuned;
  
  log.info(`[AI] Model: ${model}, isFineTuned: ${isFineTuned}, isDeepSeek: ${isDeepSeek}`);
  
  // AI Gateway da Cloudflare (cache, logs, retry) - apenas para OpenAI
  const CF_ACCOUNT_ID = '11edc212d8f0ae41b9594f87b2724ea4';
  const CF_GATEWAY_ID = 'netcar-ian';
  const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`;
  
  const apiUrl = isDeepSeek 
    ? 'https://api.deepseek.com/v1/chat/completions'
    : `${AI_GATEWAY_URL}/chat/completions`;
  const apiKey = isDeepSeek 
    ? (env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY) 
    : env.OPENAI_API_KEY;
  
  log.info(`[AI] Using API: ${isDeepSeek ? 'DeepSeek' : 'OpenAI'}, URL: ${apiUrl.substring(0, 50)}...`);

  // ========================================
  // SECURITY: Sanitize user messages to prevent prompt injection
  // ========================================
  const sanitizedMessages = messages.map((msg) => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return {
        ...msg,
        content: sanitizeUserInput(msg.content),
      };
    }
    // For array content (images), sanitize text parts
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === 'text' && part.text) {
            return { ...part, text: sanitizeUserInput(part.text) };
          }
          return part;
        }),
      };
    }
    return msg;
  });

  // Truncate messages to prevent 400 errors
  const truncatedMessages = truncateMessages(sanitizedMessages, env);
  const apiStartTime = Date.now();

  log.info(`[AI] Calling ${model} (${isDeepSeek ? 'DeepSeek' : 'OpenAI'}) with ${truncatedMessages.length} messages (original: ${messages.length})...`);

  // Retry logic with exponential backoff
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: truncatedMessages,
          temperature,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        log.error(`[OPENAI] Attempt ${attempt}: Error ${response.status} - ${errorBody.substring(0, 200)}`);
        
        // If 400, throw immediately (truncation should have fixed this, but if not, retrying won't help)
        if (response.status === 400) {
          throw new Error(`OpenAI API error: 400 - ${errorBody.substring(0, 500)}`);
        }
        
        // For 429/5xx, retry with backoff
        if (response.status === 429 || response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
            log.info(`[OPENAI] Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }
        
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json() as OpenAIResponse;
      const content = data.choices?.[0]?.message?.content || '';
      
      log.info(`[OPENAI] Success (attempt ${attempt}) in ${Date.now() - apiStartTime}ms: ${content.substring(0, 80)}...`);
      return content;

    } catch (err) {
      lastError = err as Error;
      log.error(`[OPENAI] Attempt ${attempt} exception:`, { error: err });
      
      if (attempt >= MAX_RETRIES) {
        throw lastError;
      }
      
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('OpenAI call failed after retries');
}

/**
 * Generate Embedding for RAG
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  try {
    // AI Gateway da Cloudflare (cache, logs, retry)
    const CF_ACCOUNT_ID = '11edc212d8f0ae41b9594f87b2724ea4';
    const CF_GATEWAY_ID = 'netcar-ian';
    const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`;
    
    const response = await fetch(`${AI_GATEWAY_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
        dimensions: 1536
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      const log = createLogger('worker', env);
      log.error(`[OPENAI] Embedding Error: ${response.status}`, { error: err });
      throw new Error('Failed to generate embedding');
    }

    const data = await response.json() as any;
    return data.data[0].embedding;
  } catch (error) {
    const log = createLogger('worker', env);
    log.error('[OPENAI] Embedding Exception:', { error });
    // Return empty array or throw? Throw is better so RAG fails gracefully (skips context)
    throw error;
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeAudio(audioBase64: string, env: Env, mimetype: string = 'audio/ogg'): Promise<string> {
  const log = createLogger('worker', env);
  log.info(`[OPENAI] Transcribing audio... (Base64 length: ${audioBase64.length}, Mime: ${mimetype})`);
  
  if (!audioBase64 || audioBase64.length < 100) {
    throw new Error('Audio base64 is too short or empty');
  }

  // Create form data boundary
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  
  // Convert base64 to blob-like structure for the body
  const binaryAudio = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  // Determine file extension based on mimetype
  const mimeBase = mimetype.split(';')[0].trim(); 
  const subtype = mimeBase.split('/')[1] || 'ogg';
  // OpenAI Whisper handles these well, but let's be explicit
  const extension = (subtype === 'mpeg' || subtype === 'mpga') ? 'mp3' : subtype; 

  log.info(`[OPENAI] Audio config: mime=${mimeBase}, ext=${extension}, size=${binaryAudio.length} bytes`);

  const formData = new FormData();
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');
  // Prompt hint with car names to improve transcription of automotive terms (e.g., "Onix" was being transcribed as "ônibus")
  formData.append('prompt', 'Chevrolet Onix, HB20, Polo, Corolla, Civic, Tracker, Creta, T-Cross, Compass, Renegade, Kicks, Argo, Mobi, Ka, Corsa, Sandero, Logan, Duster, Jeep, Toyota, Honda, Volkswagen, Fiat, Hyundai, Nissan, Renault, Ford, Peugeot, Citroën, troca, avaliação');
  
  if (binaryAudio.length === 0) {
    throw new Error('Audio buffer is empty');
  }
  
  const audioBlob = new Blob([binaryAudio], { type: mimeBase });
  formData.append('file', audioBlob, `audio.${extension}`);

  try {
    // AI Gateway da Cloudflare (cache, logs, retry)
    const CF_ACCOUNT_ID = '11edc212d8f0ae41b9594f87b2724ea4';
    const CF_GATEWAY_ID = 'netcar-ian';
    const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`;
    
    const response = await fetch(`${AI_GATEWAY_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`[OPENAI] Transcription error status: ${response.status}`);
      log.error(`[OPENAI] Transcription error body: ${errorText}`);
      throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { text: string };
    log.info(`[OPENAI] Transcription success: "${data.text}"`);
    return data.text;
  } catch (err) {
    log.error('[OPENAI] Transcription fetch exception:', { error: err });
    throw err;
  }
}

/**
 * Fetch system prompt from Supabase (Config table)
 * Fallback to hardcoded if fails
 */
import { getFromCache, setInCache, CACHE_TTL } from './cache.service';

/**
 * Fetch system prompt from D1 (Config table)
 * Cached in KV for 5 minutes to reduce DB load
 * Fallback to hardcoded if fails
 */
export async function getSystemPrompt(env: Env): Promise<string> {
  const log = createLogger('worker', env);
  const CACHE_KEY = 'system_prompt_cached';
  const CACHE_TTL_SECONDS = 1800; // 30 minutes (increased from 5min for better performance)
  const startTime = Date.now();
  
  // Try KV cache first (fastest)
  try {
    if (env.NETCAR_CACHE) {
      const cached = await env.NETCAR_CACHE.get(CACHE_KEY);
      if (cached && cached.length > 50) {
        log.info(`[OPENAI] System prompt loaded from KV cache (${cached.length} chars) in ${Date.now() - startTime}ms`);
        return cached;
      }
    }
  } catch (e) {
    log.warn('[OPENAI] KV cache read failed:', { error: e });
  }
  
  // Try D1 database
  const { DBService } = await import('./db.service');
  const db = new DBService(env.DB);
  
  try {
    const storedPrompt = await db.getConfig('system_prompt');
    if (storedPrompt && storedPrompt.length > 50) {
      log.info(`[OPENAI] Loaded system_prompt from D1 (${storedPrompt.length} chars). Caching in KV...`);
      
      // Cache in KV for next requests
      try {
        if (env.NETCAR_CACHE) {
          await env.NETCAR_CACHE.put(CACHE_KEY, storedPrompt, { expirationTtl: CACHE_TTL_SECONDS });
        }
      } catch (e) {
        log.warn('[OPENAI] KV cache write failed:', { error: e });
      }
      
      return storedPrompt;
    } else {
      log.info(`[OPENAI] DB prompt is empty or too short (${storedPrompt?.length || 0} chars). Using cleanPrompt fallback.`);
    }
  } catch (e) {
    log.error("[OPENAI] Failed to fetch system_prompt from DB, using fallback", { error: e });
  }

  // FALLBACK: Use cleanPrompt (único prompt oficial v4)
  log.info("[OPENAI] Using cleanPrompt v4 fallback.");
  return cleanPrompt;
}


/**
 * Extract structured metadata from lead conversation (JSON Mode)
 */
export interface LeadMetadata {
  title: string;
  intent: 'buy' | 'sell' | 'trade' | 'info' | 'other';
  budget?: number;
  urgency: 'high' | 'medium' | 'low';
  car_interest?: string;
}

export async function extractLeadMetadata(
  messages: OpenAIMessage[],
  env: Env
): Promise<LeadMetadata | null> {
  try {
    const systemPrompt = `
    You are a CRM Data Extraction Expert.
    Analyze the conversation history and extract structured data about the lead.
    
    Output JSON format:
    {
      "title": "Short catchy summary (Max 5 words), e.g. 'Civic 2020 Preto', 'Troca de Renegade'",
      "intent": "buy" | "sell" | "trade" | "info" | "other",
      "budget": 0 (Numeric value if mentioned, else null),
      "urgency": "high" | "medium" | "low",
      "car_interest": "Model mentioned"
    }
    
    Rules:
    - Title MUST be specific. Avoid "Lead sem título".
    - If user wants to trade, intent is 'trade'.
    - If user just asks questions, intent is 'info'.
    - If user wants to buy, intent is 'buy'.
    `;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o', // Use a smart model for extraction
        messages: [
          { role: 'system', content: systemPrompt },
          ...truncateMessages(messages, env, 3000) // Don't need full history, just recent context
        ],
        temperature: 0.1, // Low temp for extraction
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
        throw new Error(`Extraction failed: ${response.status}`);
    }

    const data = await response.json() as OpenAIResponse;
    const jsonStr = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(jsonStr) as LeadMetadata;

  } catch (error) {
    const log = createLogger('worker', env);
    log.error('[OPENAI] Metadata Extraction Error:', { error });
    return null;
  }
}

export async function injectDynamicVariablesAsync(prompt: string, env: Env): Promise<string> {
  // Get current date/time in Brazil timezone
  const now = new Date();
  const brasilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  
  const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const diaSemana = diasSemana[brasilTime.getDay()];
  const hora = brasilTime.getHours();
  const minuto = brasilTime.getMinutes();
  const horaFormatada = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`;
  const dataFormatada = brasilTime.toLocaleDateString('pt-BR');
  const dayOfWeek = brasilTime.getDay();
  
  // AUDIT FIX: Saudação correta baseada no horário atual
  let saudacaoCorreta = 'Bom dia';
  if (hora >= 12 && hora < 18) {
    saudacaoCorreta = 'Boa tarde';
  } else if (hora >= 18 || hora < 6) {
    saudacaoCorreta = 'Boa noite';
  }
  
  const log = createLogger('worker', env);
  log.info(`[GREETING] Hour: ${hora}, Correct greeting: ${saudacaoCorreta}`);
  
  // ====== FETCH HOURS FROM DATABASE ======
  const { getStoreHoursConfig } = await import('./scripts.service');
  const hoursConfig = await getStoreHoursConfig(env);
  
  // Parse hours from config (format: "9h às 18h" or "9h30 às 16h30")
  const parseHourToMinutes = (str: string): { start: number; end: number } => {
    // Match patterns like "9h às 18h" or "9h30 às 16h30"
    const match = str.match(/(\d+)h(\d{2})?\s*às?\s*(\d+)h(\d{2})?/i);
    if (match) {
      const startHour = parseInt(match[1], 10);
      const startMin = parseInt(match[2] || '0', 10);
      const endHour = parseInt(match[3], 10);
      const endMin = parseInt(match[4] || '0', 10);
      return { 
        start: startHour * 60 + startMin, 
        end: endHour * 60 + endMin 
      };
    }
    return { start: 9 * 60, end: 18 * 60 }; // fallback: 9:00 to 18:00
  };
  
  const weekdayHours = parseHourToMinutes(hoursConfig.weekday);
  const saturdayHours = parseHourToMinutes(hoursConfig.saturday);
  const sundayClosed = hoursConfig.sunday === 'Fechado';
  
  // Current time in minutes for comparison
  const currentMinutes = hora * 60 + minuto;
  
  // Check if store is open based on DB config
  let lojaAberta = false;
  let mensagemHorario = '';
  
  // Check for SPECIAL RULES first (from DB)
  if (hoursConfig.special_rules && hoursConfig.special_rules.length > 0) {
    // Active special rules override regular schedule
    const specialMessages = hoursConfig.special_rules
      .map(r => `${r.label}: ${r.description}`)
      .join(' | ');
    mensagemHorario = specialMessages;
    // Don't set lojaAberta here, let the special rule description explain
  }
  
  // REGULAR SCHEDULE (from DB config)
  if (!mensagemHorario) {
    if (dayOfWeek === 0) {
      // Sunday
      lojaAberta = !sundayClosed;
      mensagemHorario = sundayClosed 
        ? 'Hoje é domingo e a loja está FECHADA. Reabrimos segunda às 9h.'
        : 'A loja está ABERTA hoje (domingo).';
    } else if (dayOfWeek === 6) {
      // Saturday - using minutes for precise comparison
      if (currentMinutes >= saturdayHours.start && currentMinutes < saturdayHours.end) {
        lojaAberta = true;
        mensagemHorario = `A loja está ABERTA agora. Sábado: ${hoursConfig.saturday}.`;
      } else {
        lojaAberta = false;
        mensagemHorario = `A loja está FECHADA agora. Sábado: ${hoursConfig.saturday}.`;
      }
    } else {
      // Weekdays (Mon-Fri) - using minutes for precise comparison
      if (currentMinutes >= weekdayHours.start && currentMinutes < weekdayHours.end) {
        lojaAberta = true;
        mensagemHorario = `A loja está ABERTA agora. Seg-Sex: ${hoursConfig.weekday}.`;
      } else {
        lojaAberta = false;
        mensagemHorario = `A loja está FECHADA agora. Seg-Sex: ${hoursConfig.weekday}.`;
      }
    }
  }

  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mes = meses[brasilTime.getMonth()];
  const dia = brasilTime.getDate();
  const ano = brasilTime.getFullYear();
  
  // Build hours info string for prompt
  let hoursInfo = `Seg-Sex: ${hoursConfig.weekday} | Sáb: ${hoursConfig.saturday} | Dom: ${hoursConfig.sunday}`;
  if (hoursConfig.special_rules && hoursConfig.special_rules.length > 0) {
    hoursInfo += '\nRegras especiais ativas: ' + hoursConfig.special_rules.map(r => r.label).join(', ');
  }

  return prompt
    // New bracket-style placeholders (from prompt)
    .replace(/\[dia da semana\]/gi, diaSemana)
    .replace(/\[dia\]/gi, String(dia))
    .replace(/\[mês\]/gi, mes)
    .replace(/\[mes\]/gi, mes) // without accent
    .replace(/\[ano\]/gi, String(ano))
    // Old curly-brace placeholders (for backwards compatibility)
    .replace('{{DATE}}', `${dataFormatada} (${diaSemana})`)
    .replace('{{TIME}}', `${horaFormatada} (horário de Brasília)`)
    .replace('{{STORE_STATUS}}', lojaAberta ? 'ABERTA' : 'FECHADA')
    .replace('{{STORE_MSG}}', mensagemHorario)
    .replace('{{STORE_HOURS}}', hoursInfo)
    // AUDIT FIX: Inject correct greeting based on current hour
    .replace('{{SAUDACAO}}', saudacaoCorreta)
    .replace(/\{\{DATA_HORA\}\}/gi, `${dataFormatada} ${horaFormatada} - Use "${saudacaoCorreta}" como saudação, NÃO repita saudação incorreta do usuário`);
}


/**
 * Summarize conversation for CRM
 * Returns JSON: { resumo, modelo_interesse, carro_id }
 */
export interface ConversationSummary {
  resumo: string;
  modelo_interesse?: string;
  carro_id?: string;
}

export async function summarizeConversation(messages: OpenAIMessage[], env: Env): Promise<ConversationSummary> {
  const summaryPrompt: OpenAIMessage = {
    role: 'system',
    content: `Você é um Gerente de Vendas experiente da Netcar.
Analise a conversa e retorne um JSON com:
1. "resumo": Resumo NATURAL e HUMANIZADO sobre o lead (max 200 caracteres). Diga O QUE o cliente quer, CONDIÇÃO (entrada/troca/financiamento) e NÍVEL DE INTERESSE.
2. "modelo_interesse": O modelo de carro que o cliente demonstrou mais interesse (ex: "Onix 1.0", "HB20 Sedan", "Tracker LTZ"). Se não mencionou modelo específico, deixe null.
3. "carro_id": Se a IA apresentou um carro específico do estoque (com link ou ID), extraia o código/ID do veículo. Formato esperado: número ou código. Se não houver, deixe null.

Exemplos de resumo:
"O cliente está super interessado num Onix 2020. Falou que tem 10k de entrada e quer financiar o resto. Parece urgente."
"Curioso sobre SUVs, mas achou tudo caro. Tem um Gol pra troca mas não tá muito decidido ainda."

IMPORTANTE: Retorne APENAS o JSON, sem markdown ou texto adicional.

Exemplo de resposta:
{"resumo":"Cliente quer Tracker com financiamento 100%. Tem 15k de entrada.","modelo_interesse":"Tracker Premier","carro_id":"12345"}`
  };

  const mappedMessages = messages
    .filter(m => m && m.content)
    .map(m => {
        if ((m as any).role) return { role: (m as any).role, content: m.content };
        const role = (m as any).direction === 'inbound' ? 'user' : 'assistant';
        return { role, content: m.content };
    });

  const msgsToAnalyze = [summaryPrompt, ...mappedMessages.slice(-20)];

  try {
     const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', 
          messages: msgsToAnalyze,
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: "json_object" }
        }),
      });
      
      if (!response.ok) {
          const err = await response.text();
          const log = createLogger('worker', env);
          log.error(`[OPENAI] Summarize API error: ${response.status} - ${err}`);
          return { resumo: 'Erro API Resumo.' };
      }
      
      const data = await response.json() as any;
      if (data.choices && data.choices[0]) {
          try {
              const parsed = JSON.parse(data.choices[0].message.content);
              return {
                  resumo: parsed.resumo || 'Sem resumo',
                  modelo_interesse: parsed.modelo_interesse || undefined,
                  carro_id: parsed.carro_id || undefined
              };
          } catch (parseErr) {
              const log = createLogger('worker', env);
              log.error('[OPENAI] Failed to parse summary JSON:', { error: parseErr });
              return { resumo: data.choices[0].message.content };
          }
      }
      return { resumo: 'Erro ao gerar resumo (No Choice).' };
  } catch (e) {
      const log = createLogger('worker', env);
      log.error('[OPENAI] Summarize error:', { error: e });
      return { resumo: 'Erro API Resumo.' };
  }
}

/**
 * Merges a new instruction into the existing System Prompt using AI logic
 * SAFETY: This function only APPENDS to a designated section, never rewrites the whole prompt
 */
export async function mergeSystemPrompt(currentPrompt: string, newInstruction: string, env: Env): Promise<string> {
  const log = createLogger('worker', env);
  log.info(`[PROMPT] Adding new instruction to system prompt (Additive Mode)...`);
  
  // SAFETY: Store original length for validation
  const originalLength = currentPrompt.length;
  
  // Check if there's already a "REGRAS CUSTOMIZADAS" section
  const customRulesMarker = '## REGRAS CUSTOMIZADAS DO ADMIN';
  let updatedPrompt = currentPrompt;
  
  if (!currentPrompt.includes(customRulesMarker)) {
    // Create the section at the end of the prompt
    updatedPrompt = currentPrompt.trim() + `\n\n${customRulesMarker}\n<!-- Regras adicionadas via Painel Admin -->\n`;
  }
  
  // Use AI to format the new instruction nicely
  const formatPrompt = `
Você é um formatador de regras. Formate a seguinte instrução como um item de lista Markdown:

INSTRUÇÃO DO USUÁRIO:
"${newInstruction}"

SAÍDA ESPERADA:
Retorne APENAS o item formatado (1-3 linhas), começando com "- ". Exemplo:
- **Nome do Cliente**: Sempre pergunte o nome do cliente antes de mostrar veículos.

NÃO inclua explicações, apenas o item formatado.
`;

  try {
    const formattedRule = await callOpenAI(
      [{ role: 'system', content: 'Format rules as markdown list items.' }, { role: 'user', content: formatPrompt }],
      env,
      { temperature: 0.1 }
    );
    
    // Clean up the response
    let cleanRule = formattedRule.trim();
    if (!cleanRule.startsWith('-')) {
      cleanRule = `- ${cleanRule}`;
    }
    
    // Add timestamp
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const ruleWithMeta = `${cleanRule} _(Adicionado em ${timestamp})_`;
    
    // Append to the custom rules section
    const insertPoint = updatedPrompt.indexOf(customRulesMarker) + customRulesMarker.length;
    const beforeInsert = updatedPrompt.slice(0, insertPoint);
    const afterInsert = updatedPrompt.slice(insertPoint);
    
    // Find where to insert (after the comment line if exists)
    const newPrompt = beforeInsert + '\n' + ruleWithMeta + afterInsert;
    
    // SAFETY VALIDATION: New prompt must be LARGER than original
    if (newPrompt.length < originalLength) {
      log.error(`[PROMPT] SAFETY: New prompt (${newPrompt.length}) smaller than original (${originalLength}). REJECTED.`);
      throw new Error('Safety check failed: Result would be smaller than original.');
    }
    
    log.info(`[PROMPT] ✅ Rule added. New length: ${newPrompt.length} (was ${originalLength})`);
    return newPrompt;
    
  } catch (error) {
    log.error("[PROMPT] Failed to add rule:", { error });
    throw new Error("Failed to add rule to prompt.");
  }
}

