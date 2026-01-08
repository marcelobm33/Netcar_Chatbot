import type { Env } from "../types";
import { summarizeConversation, extractLeadMetadata } from "./openai.service";
import { DBService, Lead } from "./db.service";
import { dispatchWebhook, formatLeadPayload } from "./integration.service";

/**
 * CRM Service - Manages leads and messages in Cloudflare D1
 * Replaces the Supabase implementation
 */

/**
 * Numbers used for synthetic testing (Shadow Bot)
 * Leads from these numbers will be marked with is_synthetic: true
 */
const SYNTHETIC_TEST_NUMBERS = [
  '5522992363462', // OConnector Technology (Shadow Bot Principal)
  '5561999990001', // Persona: Cliente Decidido
  '5561999990002', // Persona: Cliente Pesquisador
  '5561999990003', // Persona: Cliente Trade-in
  '5561999990004', // Persona: Cliente Financiamento
  '5561999990005', // Persona: Cliente Negociador
  '5561999990006', // Persona: Cliente Objeções
  '5561999990007', // Persona: Cliente Agendamento
  // Add more test numbers here as needed
];

/**
 * Check if a phone number is from a synthetic test source
 */
function isSyntheticTestNumber(telefone: string): boolean {
  const cleanPhone = telefone.replace(/\D/g, '').replace(/^55/, '');
  return SYNTHETIC_TEST_NUMBERS.some(testNum => 
    cleanPhone.includes(testNum.replace(/^55/, ''))
  );
}

/**
 * Generate a unique journey ID for audit trail
 * Format: NET-YYYYMMDD-XXXX (e.g., NET-20251218-0001)
 */
function generateJourneyId(): string {
  const now = new Date();
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const year = brazilTime.getFullYear();
  const month = String(brazilTime.getMonth() + 1).padStart(2, '0');
  const day = String(brazilTime.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `NET-${year}${month}${day}-${random}`;
}

/**
 * Detect spam/promotional messages that are NOT related to vehicle sales
 * These messages should not create leads or trigger the sales flow
 */
const SPAM_KEYWORDS = [
  // Crédito/Empréstimo
  'amicred', 'consignado', 'empréstimo', 'emprestimo', 'aposentados', 'pensionistas',
  'antecipação fgts', 'antecipacao fgts', 'saque aniversário', 'saque aniversario',
  'crédito na conta', 'credito na conta', 'crédito pessoal', 'credito pessoal',
  'cartão benefício', 'cartao beneficio', 'bpc/loas', 'bpc loas', 'inss',
  'simulação agora', 'simulacao agora', 'faça sua simulação', 'faca sua simulacao',
  // Propagandas genéricas
  'click aqui', 'clique aqui para', 'promoção imperdível', 'promocao imperdivel',
  'oferta exclusiva', 'tempo limitado', 'últimas vagas', 'ultimas vagas',
  'não perca', 'nao perca essa', 'aproveite já', 'aproveite ja',
  // Outros serviços
  'plano de saúde', 'plano de saude', 'seguro de vida', 'seguro residencial',
  'energia solar', 'painel solar', 'consórcio imobiliário', 'consorcio imobiliario',
  // Spam clássico
  'você foi selecionado', 'voce foi selecionado', 'parabéns você ganhou', 'parabens voce ganhou',
  'prêmio em dinheiro', 'premio em dinheiro', 'dinheiro extra', 'renda extra fácil'
];

/**
 * Check if a message is spam/promotional content
 * @param message - The message content to analyze
 * @returns true if message appears to be spam
 */
export function isSpamMessage(message: string): boolean {
  if (!message || message.length < 10) return false;
  
  const msgLower = message.toLowerCase();
  
  // Check for spam keywords
  for (const keyword of SPAM_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      console.log(`[SPAM] 🚫 Detected spam keyword: "${keyword}" in message`);
      return true;
    }
  }
  
  // Additional heuristics: Forwarded promotional messages often have these patterns
  if (msgLower.includes('encaminhada') || msgLower.includes('forwarded')) {
    // Check if it's a forwarded message with promotional content indicators
    if (
      msgLower.includes('✅') || 
      msgLower.includes('📞') ||
      msgLower.includes('linhas de crédito') ||
      msgLower.includes('linhas de credito') ||
      msgLower.includes('atendimento que supre')
    ) {
      console.log(`[SPAM] 🚫 Detected forwarded promotional message`);
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a phone number belongs to a registered Seller/Admin
 * Used to prevent creating leads for internal staff
 */
export async function isSeller(telefone: string, env: Env): Promise<boolean> {
  const clean = telefone.replace(/\D/g, "");
  // Match last 8 digits to be safe (flexible format)
  // D1 doesn't support 'ilike' or regex easily in raw SQL without extension, using LIKE
  const last8 = clean.slice(-8);

  try {
    const db = new DBService(env.DB);
    // Simple check: if any seller whatsapp contains these last 8 digits
    const sellers = await db.getActiveSellers();
    const isSeller = sellers.some(s => s.whatsapp && s.whatsapp.includes(last8));

    if (isSeller) {
        console.log(`[CRM] 🛡️ isSeller MATCH: ${telefone} (Clean: ${clean})`);
    } else {
        console.log(`[CRM] isSeller CHECK: ${telefone} (Last8: ${last8}) -> False`);
    }
    return isSeller;
  } catch (e) {
    console.error("[CRM] Error checking isSeller:", e);
    return false;
  }
}

/**
 * Auto-qualify leads that have engaged significantly
 */
export async function autoQualifyLeads(env: Env): Promise<number> {
  try {
    console.log("[CRM] Starting auto-qualification...");
    // Logic for auto-qualification would go here using DBService
    return 0; 
  } catch (e) {
    console.error("[CRM] Auto-qualify error:", e);
    return 0;
  }
}

/**
 * Check SLA Alerts - Notify Manager if HOT leads are idle for too long
 * Called by Cron Trigger every minute
 */
export async function checkSlaAlerts(env: Env): Promise<void> {
  try {
    const db = new DBService(env.DB);
    
    // 1. Get manager phone from config
    const managerPhone = await db.getConfig('sla_alert_phone');
    if (!managerPhone) {
      console.log('[SLA] No sla_alert_phone configured. Skipping alerts.');
      return;
    }
    
    // 2. Get SLA threshold (default: 30 minutes)
    const slaMinutesStr = await db.getConfig('sla_threshold_minutes');
    const slaMinutes = parseInt(slaMinutesStr || '30', 10);
    
    // 3. Calculate cutoff time
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (slaMinutes * 60 * 1000)).toISOString();
    
    // 4. Find HOT leads idle since cutoff in 'novo' status (not yet attended)
    // Hot leads have lead_quadrant = 'hot' OR engagement_score >= 70 in metadata
    const query = `
      SELECT id, telefone, nome, interesse, last_interaction, 
             json_extract(metadata, '$.lead_quadrant') as quadrant,
             json_extract(metadata, '$.engagement_score') as engagement,
             json_extract(metadata, '$.sla_alerted') as already_alerted
      FROM leads 
      WHERE json_extract(metadata, '$.status') = 'novo'
        AND last_interaction < ?
        AND (
          json_extract(metadata, '$.lead_quadrant') = 'hot' 
          OR CAST(json_extract(metadata, '$.engagement_score') AS INTEGER) >= 70
        )
      LIMIT 10
    `;
    
    const { results } = await env.DB.prepare(query).bind(cutoffTime).all();
    
    if (!results || results.length === 0) {
      console.log('[SLA] No HOT leads breaching SLA.');
      return;
    }
    
    console.log(`[SLA] Found ${results.length} HOT leads breaching SLA!`);
    
    // 5. Send alert to manager (one consolidated message)
    const { sendMessage } = await import('./evolution.service');
    
    const alertLines = results.map((lead: any, idx: number) => {
      const nome = lead.nome || 'Sem Nome';
      const interesse = lead.interesse || 'Interesse não informado';
      const telefone = lead.telefone;
      const minAgo = Math.floor((now.getTime() - new Date(lead.last_interaction).getTime()) / 60000);
      return `${idx + 1}. *${nome}* (${telefone})\n   Interesse: ${interesse}\n   Parado há: ${minAgo} min`;
    }).join('\n\n');
    
    const alertMessage = `🔥 *ALERTA SLA - Leads HOT Parados!*\n\nOs seguintes leads estão aguardando há mais de ${slaMinutes} minutos:\n\n${alertLines}\n\n_Acesse o painel para atribuir vendedores._`;
    
    const chatId = `${managerPhone.replace(/\D/g, '')}@s.whatsapp.net`;
    await sendMessage(chatId, alertMessage, env);
    
    console.log(`[SLA] Alert sent to manager: ${managerPhone}`);
    
    // 6. Mark leads as alerted to avoid spamming
    for (const lead of results as any[]) {
      if (!lead.already_alerted) {
        const existingMeta = await db.getLeadByPhone(lead.telefone);
        if (existingMeta) {
          const meta = existingMeta.metadata || {};
          meta.sla_alerted = true;
          meta.sla_alerted_at = now.toISOString();
          await db.updateLead(lead.id, { metadata: meta });
        }
      }
    }
    
  } catch (e) {
    console.error('[SLA] Error checking alerts:', e);
  }
}

/**
 * Create or update a lead (first contact only creates, subsequent just counts)
 */
export async function upsertLead(
  telefone: string,
  nome: string,
  messageContent: string,
  env: Env,
  carroInteresse?: string
): Promise<Lead | null> {
  const telefoneClean = telefone
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "");

  const db = new DBService(env.DB);

  // BLOCKLIST CHECK: Não criar/atualizar leads bloqueados
  const { isBlocklisted } = await import('./blocklist.service');
  const blocked = await isBlocklisted(telefone, env);
  if (blocked) {
    console.log(`[CRM] 🚫 Blocklisted number ${telefoneClean} - skipping upsertLead`);
    return null;
  }

  try {
    // Check if lead exists
    const existing = await db.getLeadByPhone(telefoneClean);

    // Dynamic Import for Integration (Circular Dependency Avoidance)
    const { dispatchWebhook, formatLeadPayload } = await import('./integration.service');

    if (existing) {
      // Lead exists - Update logic
      const updates: any = {
          last_interaction: new Date().toISOString()
      };
      
      const metadata = existing.metadata || {};
      let hasSignificantChanges = false;
      
      if (carroInteresse) {
          console.log(`[CRM] Updating car interest for existing lead ${telefoneClean}: ${carroInteresse}`);
          updates.interesse = carroInteresse; // Column 'interesse' exists
          metadata.last_intent = new Date().toISOString();
          hasSignificantChanges = true; 
      }
      
      // Update metadata message count
      metadata.total_mensagens = (metadata.total_mensagens || 0) + 1;
      metadata.ultimo_contato = new Date().toISOString();
      
      updates.metadata = metadata;
      
      await db.updateLead(existing.id, updates);

      // Webhook: Update
      if (hasSignificantChanges) {
         dispatchWebhook('lead_updated', formatLeadPayload(existing, { interest: carroInteresse }), env);
      }

      // 🧠 SMART QUALIFICATION
      if ((!metadata.title || metadata.title === 'Lead sem Título') && (metadata.total_mensagens > 2)) {
          console.log(`[CRM] 🧠 Triggering Smart Qualification for ${telefoneClean}...`);
          
          const history = await db.getRecentMessages(existing.id, 15);
          const mappedHistory = history.map(m => ({ role: m.role, content: m.content }));
          
          const aiMeta = await extractLeadMetadata(mappedHistory, env);
          
          if (aiMeta) {
              const metaUpdates: any = {};
              metadata.title = aiMeta.title;
              metadata.intent = aiMeta.intent;
              metadata.deal_value = aiMeta.budget; // Store in JSON for now
              
              metaUpdates.metadata = metadata;
              await db.updateLead(existing.id, metaUpdates);
              console.log(`[CRM] 🧠 Smart Qualification Applied for ${existing.id}`);

              // Webhook: Update (Enrichment)
              dispatchWebhook('lead_updated', formatLeadPayload(existing, { qualification: aiMeta }), env);

              if (!metadata.vendedor_id) {
                  console.log(`[CRM] 🚀 Auto-routing qualified lead...`);
                  await assignSeller(telefone, env);
              }
          }
      }

      return existing;
    } else {
      // New lead
      const now = new Date().toISOString();
      const newLead = await db.createLead({
          telefone: telefoneClean,
          nome: nome || 'Unknown',
          interesse: carroInteresse,
          metadata: {
              status: "novo",
              total_mensagens: 1,
              origem: "WhatsApp",
              canal: "WhatsApp",
              primeiro_contato: now,
              ultimo_contato: now,
              score: 10,
              temperature: "blue",
              journey_id: generateJourneyId(),
              // Mark as synthetic if from test number (Shadow Bot)
              is_synthetic: isSyntheticTestNumber(telefoneClean)
          }
      });
      console.log(`[CRM] Created new lead: ${telefoneClean}`);

      // Webhook: Create
      if (newLead) {
          dispatchWebhook('lead_created', formatLeadPayload(newLead), env);
      }

      return newLead;
    }
  } catch (error) {
    console.error("[CRM] Error in upsertLead:", error);
    return null;
  }
}

/**
 * Save a message to history
 */
export async function saveMessage(
  telefone: string,
  content: string,
  direction: "inbound" | "outbound",
  env: Env
): Promise<boolean> {
  const telefoneClean = telefone.replace("@s.whatsapp.net", "").replace("@lid", "");
  const db = new DBService(env.DB);

  try {
    const lead = await db.getLeadByPhone(telefoneClean);
    if (!lead) return false;

    const role = direction === "outbound" ? "assistant" : "user";
    await db.addMessage({
        lead_id: lead.id,
        role: role,
        content: content,
        created_at: new Date().toISOString(),
        sent: true
    });
    return true;
  } catch (error) {
    console.error("[CRM] Error in saveMessage:", error);
    return false;
  }
}

/**
 * Get recent messages for context
 */
export async function getRecentMessages(
  telefone: string,
  limit: number = 6,
  env: Env
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const telefoneClean = telefone.replace("@s.whatsapp.net", "").replace("@lid", "");
  const db = new DBService(env.DB);

  try {
    const lead = await db.getLeadByPhone(telefoneClean);
    if (!lead) return [];

    const messages = await db.getRecentMessages(lead.id, limit);
    return messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content
    }));
  } catch (error) {
    console.error("[CRM] Error fetching history:", error);
    return [];
  }
}

/**
 * Assign a seller to a lead
 */
export async function assignSeller(
  telefone: string,
  env: Env
): Promise<{ nome: string; telefone: string; imagem?: string } | null> {
  const telefoneClean = telefone.replace("@s.whatsapp.net", "").replace("@lid", "");
  const db = new DBService(env.DB);

  try {
    const lead = await db.getLeadByPhone(telefoneClean);
    if (!lead) return null;

    const metadata = lead.metadata || {};

    // 1. Check Stickiness
    if (metadata.vendedor_id) {
        // Find specific seller by ID in active cache or DB
        const sellers = await db.getActiveSellers();
        const existing = sellers.find(s => s.id === metadata.vendedor_id);
        
        if (existing) {
            console.log(`[CRM] 🔒 Seller Lock Active. Returning ${existing.nome}.`);
            let phone = existing.whatsapp || '';
            if (phone.includes('wa.me/')) phone = phone.split('wa.me/')[1] || phone;
            return { nome: existing.nome, telefone: phone.replace(/\D/g, ''), imagem: existing.imagem };
        }
    }

    // 2. New Assignment (Round Robin Queue)
    const sellers = await db.getActiveSellers();
    
    console.log(`[CRM] assignSeller found ${sellers ? sellers.length : 0} active sellers.`);
    
    if (!sellers || sellers.length === 0) {
       console.warn(`[CRM] No active sellers found! Triggering fallback.`);
       return null;
    }

    // Sort to ensure stable rotation order (by ID)
    sellers.sort((a, b) => a.id - b.id);

    // Get Queue Cursor from KV
    const { getFromKV, setInKV } = await import('./cache.service');
    const KV_KEY = 'QUEUE_CURSOR_INDEX';
    let currentIndex = await getFromKV<number>(env, KV_KEY) ?? 0;

    // Validate bounds (in case sellers list changed)
    if (currentIndex >= sellers.length) {
        currentIndex = 0;
    }

    // Select Seller at CURRENT index
    const selectedSeller = sellers[currentIndex];

    // Calculate and persist NEXT index for next call
    const TTL_30_DAYS = 30 * 24 * 60 * 60; // 30 days in seconds
    let nextIndex = currentIndex + 1;
    if (nextIndex >= sellers.length) {
        nextIndex = 0;
    }
    await setInKV(env, KV_KEY, nextIndex, TTL_30_DAYS);
    
    console.log(`[CRM] ⚖️  Round Robin: Selected index ${currentIndex} (${selectedSeller.nome}), next will be ${nextIndex}`);


    let sellerPhone = selectedSeller.whatsapp || "";
    if (sellerPhone.includes("wa.me/")) sellerPhone = sellerPhone.split("wa.me/")[1] || sellerPhone;
    sellerPhone = sellerPhone.replace(/\D/g, "");

    // 3. Update Lead
    metadata.vendedor_id = selectedSeller.id;
    metadata.vendedor_nome = selectedSeller.nome;
    metadata.assigned_at = new Date().toISOString();
    metadata.status = "em_atendimento";

    await db.updateLead(lead.id, { metadata });

    // 4. DISPATCH WEBHOOK - Garantir que CRM externo receba dados do vendedor
    console.log(`[CRM] 📤 Dispatching lead_updated webhook after seller assignment...`);
    const updatedLead: Lead = {
      ...lead,
      metadata
    };
    dispatchWebhook('lead_updated', formatLeadPayload(updatedLead, {
      handover: true,
      seller_assigned: true,
      seller_name: selectedSeller.nome,
      seller_id: selectedSeller.id,
      assigned_at: metadata.assigned_at
    }), env);

    return {
        nome: selectedSeller.nome,
        telefone: sellerPhone,
        imagem: selectedSeller.imagem
    };

  } catch (error) {
    console.error("[CRM] Error in assignSeller:", error);
    return null;
  }
}

export async function getAvailableSellers(env: Env): Promise<any[]> {
    const db = new DBService(env.DB);
    return await db.getActiveSellers();
}

// Deprecated or mapped aliases for compatibility
export const getMessages = async (t: string, l: number, e: Env) => getRecentMessages(t, l, e);

export async function autoCloseStaleLeads(env: Env): Promise<number> {
    // Skipping logic for now as it requires complex D1 queries on JSON metadata
    return 0;
}

export async function updateLeadSummary(telefone: string, env: Env): Promise<string | null> {
    try {
        const messages = await getRecentMessages(telefone, 30, env);
        if (messages.length < 2) return null;
        
        const result = await summarizeConversation(messages, env);
        if (result && result.resumo) {
             const telefoneClean = telefone.replace("@s.whatsapp.net", "").replace("@lid", "");
             const db = new DBService(env.DB);
             const lead = await db.getLeadByPhone(telefoneClean);
             if (lead) {
                 const meta = lead.metadata || {};
                 meta.resumo_ia = result.resumo;
                 
                 // CRM 3.0: Salvar modelo_interesse e carro_id para integração com CRM externo
                 if (result.modelo_interesse) {
                     meta.modelo_interesse = result.modelo_interesse;
                     console.log(`[CRM] 🚗 Modelo de interesse capturado: ${result.modelo_interesse}`);
                 }
                 if (result.carro_id) {
                     meta.carro_id = result.carro_id;
                     console.log(`[CRM] 🆔 Carro ID capturado: ${result.carro_id}`);
                 }
                 
                 await db.updateLead(lead.id, { metadata: meta });
             }
             return result.resumo;
        }
        return null;
    } catch(e) {
        console.error('[CRM] Error updating lead summary:', e);
        return null;
    }
}

export async function batchSummarizeLeads(env: Env, limit: number = 5): Promise<number> {
    try {
        const db = new DBService(env.DB);
        // Look for leads active in last 24h
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const stmt = env.DB.prepare("SELECT * FROM leads WHERE last_interaction > ? ORDER BY last_interaction DESC LIMIT 50").bind(since);
        const { results } = await stmt.all<any>();
        
        if (!results) return 0;
        
        let processed = 0;
        
        for (const lead of results) {
            if (processed >= limit) break;
            
            let meta = lead.metadata;
            if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { /* Ignore invalid JSON */ } }
            meta = meta || {};
            
            // Skip if already summarized or convertible/lost/venda
            // We want to summarize active discussion leads
            // Skip if already summarized
            if (meta.ia_summary || meta.resumo_ia) continue; 
            // For now, only empty ones to save tokens.
            if (meta.status === 'perdido' || meta.status === 'convertido') continue;
            
            // Summarize
            // Detect LID (more than 13 digits = WhatsApp internal ID from ads)
            const isLid = lead.telefone.length > 13;
            const chatId = isLid ? `${lead.telefone}@lid` : `${lead.telefone}@s.whatsapp.net`;
            const summary = await updateLeadSummary(chatId, env);
            if (summary) {
                // Also update ia_summary in metadata explicitly here if updateLeadSummary didn't persist it adequately (it does calling updateLead)
                processed++;
            }
        }
        
        return processed;
    } catch (e) {
        console.error('[CRM] Batch summarize error:', e);
        return 0;
    }
}
