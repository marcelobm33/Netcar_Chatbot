
import type { Env } from '../types';

// =============================================================================
// INPUT SANITIZATION SYSTEM (REC-03)
// Previne prompt injection attacks sanitizando inputs de usuários
// =============================================================================

/**
 * Lista de padrões perigosos que podem indicar prompt injection
 */
const DANGEROUS_PATTERNS = [
  // Delimitadores de prompt comuns
  /```system/gi,
  /```assistant/gi,
  /```user/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  
  // Tentativas de override de instruções
  /ignore previous instructions/gi,
  /ignore all previous/gi,
  /disregard previous/gi,
  /forget your instructions/gi,
  /new instructions:/gi,
  /you are now/gi,
  /act as if you are/gi,
  /pretend you are/gi,
  /roleplay as/gi,
  
  // Tentativas de extração de prompt
  /what is your system prompt/gi,
  /show me your instructions/gi,
  /reveal your prompt/gi,
  /print your instructions/gi,
  /output your system/gi,
  
  // Delimitadores XML/JSON
  /<system>/gi,
  /<\/system>/gi,
  /<instructions>/gi,
  /<\/instructions>/gi,
];

/**
 * Sanitiza input do usuário removendo caracteres perigosos
 * e padrões que podem causar prompt injection
 * 
 * @param input - Texto do usuário
 * @param maxLength - Tamanho máximo (default: 4000 chars)
 * @returns Texto sanitizado
 */
export function sanitizeUserInput(input: string, maxLength: number = 4000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  let sanitized = input;
  
  // 1. Remove caracteres de controle (exceto newline e tab)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // 2. Normaliza espaços em branco excessivos
  sanitized = sanitized.replace(/\s{10,}/g, '    ');
  
  // 3. Remove padrões perigosos
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }
  
  // 4. Escapa delimitadores de código markdown
  // Substitui ``` por versão escapada para evitar quebra de blocos
  sanitized = sanitized.replace(/```/g, '` ` `');
  
  // 5. Remove tentativas de Unicode homoglyph
  // Caracteres que parecem normais mas são diferentes
  sanitized = sanitized
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
    .replace(/[\u2028\u2029]/g, '\n');     // Line/paragraph separators
  
  // 6. Limita tamanho
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    console.log(`[SANITIZE] Input truncated from ${input.length} to ${maxLength} chars`);
  }
  
  // 7. Log se houve alterações significativas
  if (sanitized !== input && sanitized.includes('[FILTERED]')) {
    console.log('[SANITIZE] ⚠️ Potential prompt injection detected and filtered');
  }
  
  return sanitized;
}

/**
 * Verifica se um input contém padrões suspeitos de prompt injection
 * Útil para logging/auditoria sem modificar o input
 * 
 * @param input - Texto a verificar
 * @returns true se padrões suspeitos foram detectados
 */
export function detectPromptInjection(input: string): {
  detected: boolean;
  patterns: string[];
} {
  const detectedPatterns: string[] = [];
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      detectedPatterns.push(pattern.source);
    }
  }
  
  return {
    detected: detectedPatterns.length > 0,
    patterns: detectedPatterns
  };
}

/**
 * Escapa variáveis para uso seguro em prompts
 * Usado para injetar dados dinâmicos no system prompt
 * 
 * @param value - Valor a escapar
 * @returns Valor escapado seguro para inserção em prompt
 */
export function escapeForPrompt(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }
  
  return value
    // Remove delimitadores XML
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    // Remove delimitadores de código
    .replace(/```/g, '` ` `')
    // Remove colchetes duplos (template vars)
    .replace(/\[\[/g, '[ [')
    .replace(/\]\]/g, '] ]')
    // Remove chaves duplas (mustache/handlebars)
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }');
}

/**
 * Interface para metadados de auditoria expandidos
 * Inclui rastreamento completo: IP, localização, timezone, dispositivo
 */
export interface AuditMeta {
  // Identificação
  ip?: string;
  userAgent?: string;
  
  // Geolocalização (via Cloudflare)
  country?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  
  // Valores alterados
  oldValue?: string;
  newValue?: string;
  
  // Contexto
  reason?: string;
  endpoint?: string;
  method?: string;
  
  // Genérico
  [key: string]: unknown;
}

/**
 * Interface para informações completas de rastreamento
 */
export interface TrackingInfo {
  ip: string;
  userAgent: string;
  country: string;
  city: string;
  region: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  asn: string;
  isp: string;
}

/**
 * Extrai informações COMPLETAS do request para auditoria máxima
 * Usa headers do Cloudflare para geolocalização precisa
 */
export function extractFullTrackingInfo(req: Request): TrackingInfo {
  // Cloudflare adiciona essas informações automaticamente
  const cfData = (req as unknown as { cf?: Record<string, unknown> }).cf || {};
  
  return {
    // IP - múltiplas fontes para garantir
    ip: req.headers.get('CF-Connecting-IP') 
      || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
      || req.headers.get('X-Real-IP')
      || 'unknown',
    
    // User Agent
    userAgent: req.headers.get('User-Agent') || 'unknown',
    
    // Geolocalização via Cloudflare
    country: (cfData.country as string) || req.headers.get('CF-IPCountry') || 'unknown',
    city: (cfData.city as string) || 'unknown',
    region: (cfData.region as string) || 'unknown',
    postalCode: (cfData.postalCode as string) || 'unknown',
    latitude: (cfData.latitude as string) || 'unknown',
    longitude: (cfData.longitude as string) || 'unknown',
    timezone: (cfData.timezone as string) || 'unknown',
    
    // ASN e ISP (útil para identificar origem)
    asn: (cfData.asn as string) || 'unknown',
    isp: (cfData.asOrganization as string) || 'unknown'
  };
}

/**
 * Formata timestamp completo no fuso horário brasileiro
 */
export function getBrazilianTimestamp(): { 
  iso: string; 
  readable: string; 
  date: string; 
  time: string;
  dayOfWeek: string;
} {
  const now = new Date();
  const brOptions: Intl.DateTimeFormatOptions = { 
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  
  const brFormatter = new Intl.DateTimeFormat('pt-BR', brOptions);
  const parts = brFormatter.formatToParts(now);
  
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  
  const date = `${get('day')}/${get('month')}/${get('year')}`;
  const time = `${get('hour')}:${get('minute')}:${get('second')}`;
  
  const dayFormatter = new Intl.DateTimeFormat('pt-BR', { 
    timeZone: 'America/Sao_Paulo', 
    weekday: 'long' 
  });
  const dayOfWeek = dayFormatter.format(now);
  
  return {
    iso: now.toISOString(),
    readable: `${date} às ${time} (Horário de Brasília)`,
    date,
    time,
    dayOfWeek
  };
}

/**
 * Log sensitive actions to Audit Table
 * Implementação COMPLETA com rastreamento máximo
 * 
 * OBJETIVO: Proteger contra acusações falsas do cliente
 * Rastreia: IP, Localização, Dispositivo, Data/Hora BR, Antes/Depois
 */
export async function logAudit(
  actor: string,
  action: string,
  resource: string,
  env: Env,
  meta?: AuditMeta
): Promise<void> {
  try {
    const timestamp = getBrazilianTimestamp();
    
    // Extrai campos específicos do meta
    const ip = meta?.ip || null;
    const userAgent = meta?.userAgent || null;
    const oldValue = meta?.oldValue || null;
    const newValue = meta?.newValue || null;
    
    // Remove campos já extraídos para evitar duplicação no JSON
    const metaClean = meta ? { ...meta } : {};
    delete metaClean.ip;
    delete metaClean.userAgent;
    delete metaClean.oldValue;
    delete metaClean.newValue;
    
    // Adiciona timestamp brasileiro ao meta
    metaClean.timestamp_br = timestamp.readable;
    metaClean.timestamp_iso = timestamp.iso;
    metaClean.day_of_week = timestamp.dayOfWeek;
    
    const metaStr = Object.keys(metaClean).length > 0 
      ? JSON.stringify(metaClean) 
      : null;

    console.log(`[AUDIT] ${timestamp.readable} | ${action} by ${actor} on ${resource} from ${ip || 'unknown'}`);

    // D1 Insert com campos expandidos
    await env.DB.prepare(`
      INSERT INTO audit_logs 
        (actor, action, resource, meta, created_at, ip, user_agent, old_value, new_value) 
      VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      actor, 
      action, 
      resource, 
      metaStr, 
      timestamp.iso,
      ip,
      userAgent,
      oldValue,
      newValue
    ).run().catch(err => console.error('[AUDIT] Failed to save log:', err));

  } catch (e) {
    console.error('[AUDIT] Critical Error:', e);
  }
}

/**
 * Log de alteração de prompt com RASTREAMENTO COMPLETO
 * Usado para proteger contra acusações do cliente
 * 
 * Registra:
 * - IP e localização geográfica
 * - Data/hora exata no fuso BR
 * - Prompt antes e depois da alteração
 * - Dispositivo usado
 * - ASN/ISP (provedor de internet)
 */
export async function logPromptChange(
  req: Request,
  promptType: 'base_prompt' | 'extra_prompt' | 'negative_prompt' | 'system_prompt',
  oldValue: string | null,
  newValue: string,
  env: Env
): Promise<void> {
  const tracking = extractFullTrackingInfo(req);
  const timestamp = getBrazilianTimestamp();
  
  // Trunca valores muito longos para não sobrecarregar o DB (máx 10KB cada)
  const maxLen = 10000;
  const truncatedOld = oldValue && oldValue.length > maxLen 
    ? oldValue.substring(0, maxLen) + '...[TRUNCATED]' 
    : oldValue;
  const truncatedNew = newValue.length > maxLen 
    ? newValue.substring(0, maxLen) + '...[TRUNCATED]' 
    : newValue;
  
  await logAudit(
    'CLIENT',
    'PROMPT_CHANGE',
    promptType,
    env,
    {
      // Identificação
      ip: tracking.ip,
      userAgent: tracking.userAgent,
      
      // Geolocalização completa
      country: tracking.country,
      city: tracking.city,
      region: tracking.region,
      postalCode: tracking.postalCode,
      latitude: tracking.latitude,
      longitude: tracking.longitude,
      timezone: tracking.timezone,
      
      // ISP/ASN
      asn: tracking.asn,
      isp: tracking.isp,
      
      // Valores alterados
      oldValue: truncatedOld || '',
      newValue: truncatedNew,
      
      // Contexto
      reason: 'Client edited prompt via admin panel - AT THEIR OWN RISK',
      endpoint: '/api/admin/prompt/update',
      method: 'POST',
      
      // Aviso legal
      warning: '⚠️ CLIENTE É RESPONSÁVEL POR QUALQUER PROBLEMA CAUSADO POR ESTA ALTERAÇÃO',
      disclaimer: 'Esta alteração foi feita pelo cliente por sua conta e risco. A equipe de desenvolvimento NÃO é responsável por problemas decorrentes desta modificação.',
      
      // Estatísticas da mudança
      old_length: oldValue?.length || 0,
      new_length: newValue.length,
      chars_added: newValue.length - (oldValue?.length || 0)
    }
  );
  
  console.log(`[AUDIT][PROMPT] ⚠️ CLIENT changed ${promptType}`);
  console.log(`[AUDIT][PROMPT] 📍 Location: ${tracking.city}, ${tracking.region}, ${tracking.country}`);
  console.log(`[AUDIT][PROMPT] 🌐 IP: ${tracking.ip} | ISP: ${tracking.isp}`);
  console.log(`[AUDIT][PROMPT] 📅 ${timestamp.readable}`);
}

/**
 * Log de alteração de configuração genérica
 */
export async function logConfigChange(
  req: Request,
  configKey: string,
  oldValue: string | null,
  newValue: string,
  env: Env,
  actor: string = 'CLIENT'
): Promise<void> {
  const tracking = extractFullTrackingInfo(req);
  const timestamp = getBrazilianTimestamp();
  
  await logAudit(
    actor,
    'CONFIG_CHANGE',
    configKey,
    env,
    {
      ip: tracking.ip,
      userAgent: tracking.userAgent,
      country: tracking.country,
      city: tracking.city,
      region: tracking.region,
      timezone: tracking.timezone,
      oldValue: oldValue || '',
      newValue,
      reason: 'Client-initiated change via admin panel',
      timestamp_br: timestamp.readable
    }
  );
}

/**
 * Log de erro do sistema (para diferenciar de erros causados pelo cliente)
 */
export async function logSystemError(
  errorType: string,
  errorMessage: string,
  context: string,
  env: Env,
  req?: Request
): Promise<void> {
  const timestamp = getBrazilianTimestamp();
  const tracking = req ? extractFullTrackingInfo(req) : null;
  
  await logAudit(
    'SYSTEM',
    'SYSTEM_ERROR',
    errorType,
    env,
    {
      error_message: errorMessage,
      context,
      ip: tracking?.ip,
      userAgent: tracking?.userAgent,
      country: tracking?.country,
      city: tracking?.city,
      timestamp_br: timestamp.readable,
      note: 'Este é um erro do SISTEMA, NÃO causado por alteração do cliente'
    }
  );
  
  console.error(`[AUDIT][SYSTEM_ERROR] ${timestamp.readable} | ${errorType}: ${errorMessage}`);
}

// =============================================================================
// TOKEN AUTHENTICATION SYSTEM (REC-02)
// =============================================================================

/**
 * Gera hash SHA-256 de uma string
 * Usado para comparar tokens sem armazenar o valor original
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Gera um novo token seguro
 * Formato: prefix_randomUUID_timestamp
 */
export function generateSecureToken(prefix: string = 'ntc'): string {
  const uuid = crypto.randomUUID();
  const timestamp = Date.now().toString(36);
  return `${prefix}_${uuid}_${timestamp}`;
}

/**
 * Verifica se dois hashes são iguais usando timing-safe comparison
 * Previne timing attacks
 */
export async function verifyTokenHash(
  providedToken: string, 
  storedHash: string
): Promise<boolean> {
  const providedHash = await hashToken(providedToken);
  
  // Timing-safe comparison
  if (providedHash.length !== storedHash.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < providedHash.length; i++) {
    result |= providedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Verify if request has required permission
 * Suporta múltiplos métodos de autenticação:
 * 1. Token direto (legado) - comparação com NETCAR_ADMIN_KEY
 * 2. Token hasheado - comparação com hash armazenado no config
 * 
 * Headers aceitos:
 * - X-Admin-Key: <token>
 * - Authorization: Bearer <token>
 */
export async function verifyRole(
  req: Request, 
  env: Env, 
  requiredRole: 'admin' | 'system' = 'admin'
): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  const adminKey = req.headers.get('X-Admin-Key') || '';
  
  // Extrai token do header
  const token = adminKey || authHeader.replace('Bearer ', '');
  
  if (!token) {
    return false;
  }
  
  // 1. Verificação legada (comparação direta)
  // Mantida para compatibilidade durante migração
  const legacySecret = env.NETCAR_ADMIN_KEY;
  if (legacySecret && token === legacySecret) {
    console.log('[AUTH] Legacy token authentication successful');
    return true;
  }
  
  // 2. Verificação por hash (novo método)
  // Busca hash armazenado no config
  try {
    const storedHash = await env.DB.prepare(
      'SELECT value FROM config WHERE key = ?'
    ).bind('admin_token_hash').first<{ value: string }>();
    
    if (storedHash?.value) {
      const isValid = await verifyTokenHash(token, storedHash.value);
      if (isValid) {
        console.log('[AUTH] Hashed token authentication successful');
        return true;
      }
    }
  } catch (e) {
    console.error('[AUTH] Error checking hashed token:', e);
  }
  
  return false;
}

/**
 * Rota para rotacionar o token admin
 * Gera novo token, armazena hash no DB, retorna token ao admin
 * 
 * ⚠️ O token retornado é a ÚNICA vez que ele será visível
 * O sistema armazena apenas o hash
 */
export async function rotateAdminToken(env: Env): Promise<{
  token: string;
  hash: string;
  expiresAt: string;
}> {
  // Gera novo token seguro
  const newToken = generateSecureToken('ntc');
  const tokenHash = await hashToken(newToken);
  
  // Define expiração (90 dias)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  
  // Armazena hash no DB
  await env.DB.prepare(`
    INSERT OR REPLACE INTO config (key, value, description)
    VALUES (?, ?, ?)
  `).bind(
    'admin_token_hash',
    tokenHash,
    `Admin token hash - expires ${expiresAt.toISOString()}`
  ).run();
  
  // Armazena data de expiração
  await env.DB.prepare(`
    INSERT OR REPLACE INTO config (key, value, description)
    VALUES (?, ?, ?)
  `).bind(
    'admin_token_expires',
    expiresAt.toISOString(),
    'Admin token expiration date'
  ).run();
  
  console.log(`[AUTH] Admin token rotated. Expires: ${expiresAt.toISOString()}`);
  
  return {
    token: newToken,
    hash: tokenHash,
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Verifica se o token admin está expirado
 */
export async function isTokenExpired(env: Env): Promise<boolean> {
  try {
    const expiry = await env.DB.prepare(
      'SELECT value FROM config WHERE key = ?'
    ).bind('admin_token_expires').first<{ value: string }>();
    
    if (!expiry?.value) {
      return false; // Sem data de expiração = não expira (legado)
    }
    
    const expiryDate = new Date(expiry.value);
    return new Date() > expiryDate;
  } catch {
    return false;
  }
}

