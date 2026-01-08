
import type { Env, Lead } from '@types';

/**
 * Integration Service - Standardized Universal Webhook
 * Pushes events to external CRM
 */

export interface WebhookPayload {
  event: 'lead_created' | 'lead_updated' | 'lead_handover' | 'chat_message';
  timestamp: string;
  data: any;
}

/**
 * Dispatch a webhook event to the client's CRM
 */
export async function dispatchWebhook(
  event: WebhookPayload['event'],
  data: any,
  env: Env
): Promise<void> {
  // 1. Get URL from KV (cache), D1 (database), or Env (static)
  let webhookUrl = '';
  
  // Try KV cache first (fastest)
  if (env.NETCAR_CACHE) {
      const { getFromKV } = await import('./cache.service');
      const configUrl = await getFromKV<string>(env, 'CLIENT_WEBHOOK_URL');
      if (configUrl) webhookUrl = configUrl;
  }
  
  // If not in KV, try D1 database (where /api/admin/config saves)
  if (!webhookUrl) {
      try {
          const { DBService } = await import('./db.service');
          const db = new DBService(env.DB);
          const dbUrl = await db.getConfig('CLIENT_WEBHOOK_URL');
          if (dbUrl) {
              webhookUrl = dbUrl;
              console.log(`[INTEGRATION] Loaded CLIENT_WEBHOOK_URL from D1: ${dbUrl.substring(0, 50)}...`);
          }
      } catch (e) {
          console.warn(`[INTEGRATION] Failed to read from D1:`, e);
      }
  }
  
  // Fallback to Env variable
  if (!webhookUrl && (env as any).CLIENT_WEBHOOK_URL) {
      webhookUrl = (env as any).CLIENT_WEBHOOK_URL;
  }

  if (!webhookUrl) {
      console.log(`[INTEGRATION] ⚠️ No webhook URL configured. Skipping '${event}' event.`);
      return;
  }

  const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data
  };

  console.log(`[INTEGRATION] 🚀 Dispatching '${event}' to ${webhookUrl.substring(0, 60)}...`);
  console.log(`[INTEGRATION] Payload keys: ${Object.keys(data || {}).join(', ')}`);

  // Create the fetch promise
  const webhookPromise = fetch(webhookUrl, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NetcarBot-Webhook/1.0',
          'X-Webhook-Secret': (env as any).WEBHOOK_SECRET || ''
      },
      body: JSON.stringify(payload)
  })
  .then(async res => {
      if (!res.ok) {
          console.error(`[INTEGRATION] ❌ Webhook failed: ${res.status} ${res.statusText}`);
          const text = await res.text();
          console.error(`[INTEGRATION] Response body: ${text.substring(0, 500)}`);
          console.error(`[INTEGRATION] Sent payload (truncated): ${JSON.stringify(payload).substring(0, 500)}`);
          
          // If 400, log more details for debugging
          if (res.status === 400) {
            console.error(`[INTEGRATION] 🔍 400 Bad Request - Check if:
              1. CLIENT_WEBHOOK_URL is correct: ${webhookUrl.substring(0, 80)}
              2. Payload format matches expected schema
              3. Required fields are present: phone, name, event`);
          }
      } else {
          console.log(`[INTEGRATION] ✅ Webhook delivered successfully (${event}).`);
      }
  })
  .catch(err => {
      console.error(`[INTEGRATION] ❌ Webhook network error:`, err.message || err);
  });

  // Use waitUntil if available, otherwise fire-and-forget
  if (env.ctx && typeof env.ctx.waitUntil === 'function') {
      env.ctx.waitUntil(webhookPromise);
  } else {
      // Fallback: just execute without waiting (may get cut off in edge cases)
      console.log(`[INTEGRATION] ⚠️ No ctx.waitUntil available, executing inline.`);
      webhookPromise; // Fire and forget
  }
}

/**
 * Format a Lead for external consumption
 * Removes internal D1 specific fields, flattens metadata if needed
 */
export function formatLeadPayload(lead: Lead, extraData?: any): any {
    let meta = lead.metadata;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { /* Ignore invalid JSON */ }
    }
    
    return {
        id: lead.id,
        phone: lead.telefone,
        name: lead.nome,
        interest: lead.interesse,
        status: meta?.status || 'novo',
        origem: meta?.origem || 'whatsapp_direto',       // NOVO: Origem do lead (facebook_ads, whatsapp_direto)
        summary: meta?.resumo_ia || meta?.ia_summary || null,
        seller_name: meta?.vendedor_nome || null,
        seller_id: meta?.vendedor_id || null,
        modelo_interesse: meta?.modelo_interesse || null,  // Modelo de interesse
        carro_id: meta?.carro_id || null,                  // ID do carro no estoque
        created_at: lead.created_at,
        last_interaction: lead.last_interaction,
        qualification: meta?.qualification || null,        // Dados de qualificação
        ...extraData
    };
}
