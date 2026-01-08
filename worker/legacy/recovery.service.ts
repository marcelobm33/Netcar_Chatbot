/**
 * Recovery Service - Automatic recovery for orphaned leads
 * Detects leads that sent messages but never received a response
 */

import type { Env } from '@types';

interface OrphanedLead {
  id: string;
  telefone: string;
  nome: string;
  last_inbound: string;
  last_outbound: string | null;
  minutes_waiting: number;
}

const RECOVERY_MESSAGE = "Tô pronto pra te atender! Em que posso te ajudar?";
const RECOVERY_COOLDOWN_HOURS = 4;
const MAX_WAITING_MINUTES = 240; // 4 horas - leads recentes em limbo
const MIN_WAITING_MINUTES = 1; // Wait at least 1 min before considering orphaned
const MAX_RECOVERIES_PER_RUN = 5; // Aumentado para processar mais leads
const LIMBO_SEARCH_HOURS = 24; // Buscar leads em limbo até 24h atrás

/**
 * Check if current time is within business hours
 * Recovery agora roda 7 dias por semana para não deixar leads em limbo
 */
function isBusinessHours(): boolean {
  const now = new Date();
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hour = brazilTime.getHours();
  const day = brazilTime.getDay(); // 0 = Sunday
  
  // Recovery roda todos os dias, incluindo domingo
  // Horário: 8h-22h (horário estendido para pegar leads que chegaram tarde)
  if (day === 0 || day === 6) {
    // Fim de semana: 8h-22h
    return hour >= 8 && hour < 22;
  }
  
  // Mon-Fri: 8h-22h
  return hour >= 8 && hour < 22;
}

/**
 * Find leads that sent messages but never received a response
 */
async function findOrphanedLeads(env: Env): Promise<OrphanedLead[]> {
  const db = env.DB;
  
  // Query to find leads with unanswered messages
  // A lead is orphaned if:
  // - Has inbound message in last LIMBO_SEARCH_HOURS
  // - No outbound message after the last inbound, OR no outbound at all
  // - Not already recovered recently
  const query = `
    WITH lead_messages AS (
      SELECT 
        l.id,
        l.telefone,
        l.nome,
        l.metadata,
        MAX(CASE WHEN m.role = 'user' THEN m.created_at END) as last_inbound,
        MAX(CASE WHEN m.role = 'assistant' THEN m.created_at END) as last_outbound
      FROM leads l
      LEFT JOIN messages m ON m.lead_id = l.id
      WHERE l.last_interaction > datetime('now', '-${LIMBO_SEARCH_HOURS} hours')
      GROUP BY l.id
    )
    SELECT 
      id,
      telefone,
      nome,
      last_inbound,
      last_outbound,
      CAST((julianday('now') - julianday(last_inbound)) * 24 * 60 AS INTEGER) as minutes_waiting
    FROM lead_messages
    WHERE last_inbound IS NOT NULL
      AND (last_outbound IS NULL OR last_outbound < last_inbound)
      AND (
        json_extract(metadata, '$.recovery_sent_at') IS NULL
        OR json_extract(metadata, '$.recovery_sent_at') < datetime('now', '-${RECOVERY_COOLDOWN_HOURS} hours')
      )
      AND CAST((julianday('now') - julianday(last_inbound)) * 24 * 60 AS INTEGER) >= ${MIN_WAITING_MINUTES}
      AND CAST((julianday('now') - julianday(last_inbound)) * 24 * 60 AS INTEGER) <= ${MAX_WAITING_MINUTES}
    ORDER BY last_inbound ASC
    LIMIT ${MAX_RECOVERIES_PER_RUN}
  `;
  
  try {
    const { results } = await db.prepare(query).all<OrphanedLead>();
    return results || [];
  } catch (error) {
    console.error('[RECOVERY] Error finding orphaned leads:', error);
    return [];
  }
}

/**
 * Send recovery message to a lead
 */
async function sendRecoveryMessage(
  lead: OrphanedLead,
  env: Env
): Promise<boolean> {
  try {
    const { sendMessage } = await import('./evolution.service');
    const { DBService } = await import('./db.service');
    const { isBlocklisted } = await import('./blocklist.service');
    
    // Detect if phone is a LID (more than 13 digits = WhatsApp internal ID from ads)
    const isLid = lead.telefone.length > 13;
    const chatId = isLid 
      ? `${lead.telefone}@lid` 
      : `${lead.telefone}@s.whatsapp.net`;
    
    // CHECK BLOCKLIST BEFORE SENDING - Skip if blocked
    const blocked = await isBlocklisted(chatId, env);
    if (blocked) {
      console.log(`[RECOVERY] ⏸️ Skipping blocked number: ${chatId}`);
      return false;
    }
    
    console.log(`[RECOVERY] Sending to ${lead.nome || 'lead'} via ${isLid ? 'LID' : 'phone'}: ${chatId}`);
    
    // Send the recovery message
    await sendMessage(chatId, RECOVERY_MESSAGE, env);
    
    // Mark lead as recovered
    const db = new DBService(env.DB);
    const existingLead = await db.getLeadByPhone(lead.telefone);
    
    if (existingLead) {
      const metadata = existingLead.metadata || {};
      metadata.recovery_sent_at = new Date().toISOString();
      metadata.recovery_count = (metadata.recovery_count || 0) + 1;
      
      await db.updateLead(existingLead.id, { metadata });
    }
    
    // Save the message to history
    await db.addMessage({
      lead_id: lead.id,
      role: 'assistant',
      content: RECOVERY_MESSAGE,
      created_at: new Date().toISOString(),
      sent: true
    });
    
    console.log(`[RECOVERY] ✅ Sent recovery to ${lead.nome || lead.telefone} (waiting ${lead.minutes_waiting}min)`);
    return true;
    
  } catch (error) {
    console.error(`[RECOVERY] ❌ Failed to send recovery to ${lead.telefone}:`, error);
    return false;
  }
}

/**
 * Main recovery sweep function - called by CRON
 */
export async function runRecoverySweep(env: Env): Promise<void> {
  // Only run during business hours (extended)
  if (!isBusinessHours()) {
    console.log('[RECOVERY] Outside business hours. Skipping sweep.');
    return;
  }
  
  console.log('[RECOVERY] Starting sweep for orphaned leads...');
  
  const orphanedLeads = await findOrphanedLeads(env);
  
  if (orphanedLeads.length === 0) {
    console.log('[RECOVERY] No orphaned leads found.');
    return;
  }
  
  console.log(`[RECOVERY] Found ${orphanedLeads.length} orphaned leads!`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const lead of orphanedLeads) {
    const success = await sendRecoveryMessage(lead, env);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`[RECOVERY] Sweep complete: ${successCount} sent, ${failCount} failed`);
}
