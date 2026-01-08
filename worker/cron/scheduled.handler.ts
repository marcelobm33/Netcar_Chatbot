/**
 * Scheduled Handler
 * =================
 * Handles Cloudflare Worker scheduled (cron) events.
 * Extracted from index.ts for better organization.
 */

import type { Env } from '../../types';
import { processFollowups, checkFollowUpRules } from '../../services/followup.service';
import {
  autoCloseStaleLeads,
  batchSummarizeLeads,
  autoQualifyLeads,
  checkSlaAlerts,
} from '../../services/crm.service';
import { runSummarizationCron } from '../../services/context.service';
import { runRecoverySweep } from '../../services/recovery.service';
import { runDailyBackup } from '../../services/backup.service';
import { sendMessage } from '../../services/evolution.service';

/**
 * Process leads that arrived outside business hours.
 * Called at 9:00 AM Brazil time.
 */
async function processPendingOpeningLeads(env: Env): Promise<void> {
  try {
    console.log('[OPENING] 🌅 Processing leads that arrived outside business hours...');

    const stmt = env.DB.prepare(
      "SELECT * FROM leads WHERE json_extract(metadata, '$.next_step') = 'pending_opening'"
    );
    const { results } = await stmt.all<any>();
    const pendingLeads = results || [];

    if (pendingLeads.length === 0) {
      console.log('[OPENING] No pending leads to process.');
      return;
    }

    console.log(`[OPENING] Found ${pendingLeads.length} leads to process.`);

    for (const lead of pendingLeads) {
      try {
        const chatId = `${lead.telefone}@s.whatsapp.net`;
        const nome = lead.nome || 'Cliente';

        await sendMessage(
          chatId,
          `Bom dia, ${nome}! Recebemos sua mensagem ontem à noite.\n\nComo posso te ajudar hoje?`,
          env
        );

        let meta = lead.metadata;
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta);
          } catch {
            /* Ignore parse errors */
          }
        }
        if (!meta) meta = {};
        meta.next_step = null;

        await env.DB.prepare('UPDATE leads SET metadata = ? WHERE id = ?')
          .bind(JSON.stringify(meta), lead.id)
          .run();

        console.log(`[OPENING] ✅ Processed lead ${lead.telefone}`);
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[OPENING] Failed to process lead ${lead.telefone}:`, err);
      }
    }

    console.log(`[OPENING] 🏁 Finished processing ${pendingLeads.length} pending leads.`);
  } catch (error) {
    console.error('[OPENING] Error processing pending leads:', error);
  }
}

/**
 * Auto-recover Evolution API webhook if missing.
 */
async function checkAndRecoverWebhook(env: Env): Promise<void> {
  try {
    const webhookRes = await fetch(
      `${env.EVOLUTION_API_URL}/webhook/find/${env.EVOLUTION_INSTANCE}`,
      { headers: { apikey: env.EVOLUTION_API_KEY } }
    );
    const webhookData = (await webhookRes.json()) as any;
    const webhookUrl = webhookData?.webhook?.url;
    const webhookEnabled = webhookData?.webhook?.enabled;

    const expectedUrl = 'https://netcar-worker.contato-11e.workers.dev/webhook/evolution';

    if (!webhookUrl || !webhookEnabled || webhookUrl !== expectedUrl) {
      console.log('[HEALTH] 🔧 Webhook missing, auto-reconfiguring...');

      const setRes = await fetch(
        `${env.EVOLUTION_API_URL}/webhook/set/${env.EVOLUTION_INSTANCE}`,
        {
          method: 'POST',
          headers: {
            apikey: env.EVOLUTION_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook: {
              url: expectedUrl,
              enabled: true,
              events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
              webhookByEvents: false,
              webhookBase64: false,
            },
          }),
        }
      );

      if (setRes.ok) {
        console.log('[HEALTH] ✅ Webhook auto-reconfigured!');
      } else {
        console.error('[HEALTH] ❌ Failed to reconfigure webhook:', await setRes.text());
      }
    }
  } catch (err) {
    console.error('[HEALTH] ❌ Failed to check/reconfigure webhook:', err);
  }
}

/**
 * Check Evolution API connection and auto-restart if needed.
 */
async function checkEvolutionHealth(env: Env, minute: number): Promise<void> {
  try {
    const res = await fetch(
      `${env.EVOLUTION_API_URL}/instance/connectionState/${env.EVOLUTION_INSTANCE}`,
      { headers: { apikey: env.EVOLUTION_API_KEY } }
    );
    const data = (await res.json()) as any;
    const state = data?.instance?.state;
    const shouldNotify = minute % 5 === 0;

    if (state !== 'open') {
      console.warn(`[HEALTH] ⚠️ Evolution API disconnected! State: ${state}`);

      // Try auto-restart
      let restartSuccess = false;
      try {
        console.log('[HEALTH] 🔄 Attempting auto-restart of Evolution instance...');

        const restartRes = await fetch(
          `${env.EVOLUTION_API_URL}/instance/restart/${env.EVOLUTION_INSTANCE}`,
          {
            method: 'PUT',
            headers: { apikey: env.EVOLUTION_API_KEY },
          }
        );

        if (restartRes.ok) {
          console.log('[HEALTH] ✅ Instance restart initiated!');
          restartSuccess = true;

          await new Promise((r) => setTimeout(r, 5000));

          const checkRes = await fetch(
            `${env.EVOLUTION_API_URL}/instance/connectionState/${env.EVOLUTION_INSTANCE}`,
            { headers: { apikey: env.EVOLUTION_API_KEY } }
          );
          const checkData = (await checkRes.json()) as any;
          const newState = checkData?.instance?.state;

          if (newState === 'open') {
            console.log('[HEALTH] ✅ Auto-restart successful! Connection restored.');
            try {
              await sendMessage(
                '5551988792811@s.whatsapp.net',
                `✅ WhatsApp reconectado automaticamente!\nHora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
                env
              );
            } catch {
              /* ignore */
            }
            return;
          } else {
            console.warn(`[HEALTH] ⚠️ Restart initiated but state still: ${newState}`);
            restartSuccess = false;
          }
        } else {
          const errText = await restartRes.text();
          console.error('[HEALTH] ❌ Restart failed:', errText);
        }
      } catch (restartErr) {
        console.error('[HEALTH] ❌ Auto-restart error:', restartErr);
      }

      if (!restartSuccess && shouldNotify) {
        console.error('[HEALTH] 🚨 Auto-restart failed! Manual intervention required.');
        const alertMsg = `🚨 ALERTA: WhatsApp desconectado!

📊 Estado: ${state}
🕐 Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

❌ Tentativa automática de reconexão FALHOU.

📋 Ação necessária:
1. Acesse o painel admin
2. Vá em Configurações > Docs
3. Siga o passo a passo para reconectar

Ou acesse: https://netcar-admin.pages.dev/docs`;

        try {
          await sendMessage('5551988792811@s.whatsapp.net', alertMsg, env);
        } catch (e) {
          console.error('[HEALTH] Failed to send alert:', e);
        }
      }
    } else {
      // Connection OK, check webhook
      await checkAndRecoverWebhook(env);
    }
  } catch (e) {
    console.error('[HEALTH] ❌ Failed to check Evolution API:', e);
  }
}

/**
 * Main scheduled handler - called by Cloudflare Worker cron.
 */
export async function handleScheduledEvent(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  console.log('[CRON] Running scheduled tasks...');

  // Core automation tasks
  ctx.waitUntil(processFollowups(env));
  ctx.waitUntil(checkFollowUpRules(env));
  ctx.waitUntil(autoCloseStaleLeads(env));
  ctx.waitUntil(batchSummarizeLeads(env));
  ctx.waitUntil(autoQualifyLeads(env));
  ctx.waitUntil(checkSlaAlerts(env));
  ctx.waitUntil(runSummarizationCron(env));
  ctx.waitUntil(runRecoverySweep(env));

  // Time-based tasks
  const now = new Date();
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const brazilHour = brazilTime.getHours();
  const brazilMinute = brazilTime.getMinutes();

  // Morning opening (9:00 AM Brazil)
  if (brazilHour === 9 && brazilMinute < 5) {
    console.log('[CRON] 🌅 Store opening time - processing pending leads...');
    ctx.waitUntil(processPendingOpeningLeads(env));
  }

  // Daily backup (3:00 AM UTC)
  const hour = new Date().getUTCHours();
  const minute = new Date().getUTCMinutes();
  if (hour === 3 && minute === 0) {
    console.log('[CRON] 🗄️ Starting daily backup...');
    ctx.waitUntil(runDailyBackup(env));
  }

  // Webhook health check (every minute)
  ctx.waitUntil(checkEvolutionHealth(env, minute));
}
