import type { Env } from "../types";
import { sendMessage } from "./evolution.service";
import { callOpenAI } from "./openai.service";
import { DBService } from "./db.service";
import { getRecentMessages } from "./crm.service";
import { isBlocklisted } from "./blocklist.service";

/**
 * Follow-up Service
 * Manages inactivity reminders using Cloudflare D1 and Cron
 */

/**
 * Helper to get correct chatId format based on phone length
 * LIDs (from Facebook/Instagram ads) have more than 13 digits and need @lid suffix
 */
function getChatIdFromPhone(telefone: string): string {
  const isLid = telefone.length > 13;
  return isLid ? `${telefone}@lid` : `${telefone}@s.whatsapp.net`;
}

const DEFAULT_DELAY = 4; // Fallback if no config

/**
 * Helper to parse time config (e.g. "9", "09:00", "18:30") into minutes from midnight
 */
function parseTimeConfig(val: string | null, defaultHour: number): number {
  if (!val) return defaultHour * 60;

  // Format HH:MM
  if (val.includes(":")) {
    const [h, m] = val.split(":");
    return parseInt(h, 10) * 60 + (parseInt(m, 10) || 0);
  }

  // Format H (integer)
  return parseInt(val, 10) * 60;
}

/**
 * Schedule a follow-up for a chat
 * Should be called whenever the BOT sends a message
 * @param delayOverride Optional custom delay in minutes (e.g. 15 for handoff timer)
 * @param type Type of followup ('inactivity' | 'handoff_15m')
 */
export async function scheduleFollowup(
  chatId: string,
  env: Env,
  delayOverride?: number,
  type: string = "inactivity"
): Promise<void> {
  try {
    const db = new DBService(env.DB);

    // 1. Fetch delay/message config directly from D1, or use override
    let delayMinutes = DEFAULT_DELAY;
    let customMessage: string | undefined = undefined;

    if (delayOverride !== undefined) {
      delayMinutes = delayOverride;
    } else if (type === "inactivity") {
      // Dynamic Sequences Logic
      try {
        const sequencesJson = await db.getConfig("followup_sequences");
        if (sequencesJson) {
          const sequences = JSON.parse(sequencesJson);
          // Find first active sequence
          if (Array.isArray(sequences)) {
            const active = sequences
              .filter((s: any) => s.ativo)
              .sort((a: any, b: any) => a.delay_minutos - b.delay_minutos);
            if (active.length > 0) {
              delayMinutes = active[0].delay_minutos;
              customMessage = active[0].mensagem;
              console.log(
                `[FOLLOWUP] Using sequence: ${
                  active[0].nome
                } (${delayMinutes}m), message: "${
                  customMessage?.substring(0, 50) || "EMPTY"
                }..."`
              );
            }
          }
        } else {
          // Fallback to simple minute config
          const val = await db.getConfig("followup_delay_minutes");
          if (val) delayMinutes = parseInt(val, 10) || DEFAULT_DELAY;
        }
      } catch (e) {
        console.warn("[FOLLOWUP] Failed to fetch config, using default:", e);
      }
    }

    const scheduledTime = new Date();
    scheduledTime.setMinutes(scheduledTime.getMinutes() + delayMinutes);

    // Validate JID basic format
    if (!chatId.includes("@")) {
      console.warn(
        `[FOLLOWUP] Scheduling for potentially invalid ID (no @): ${chatId}`
      );
    }

    const phone = chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
    const lead = await db.getLeadByPhone(phone);

    if (!lead) {
      console.warn(`[FOLLOWUP] Cannot schedule: Lead not found for ${chatId}`);
      return;
    }

    // Cancel previous pending followups for this lead
    await db.cancelPendingFollowups(lead.id);

    // Create new followup
    console.log(
      `[FOLLOWUP] Creating followup with message: "${
        customMessage?.substring(0, 40) || "NONE"
      }"`
    );
    await db.createFollowup(
      lead.id,
      scheduledTime.toISOString(),
      type,
      "pending",
      customMessage
    );

    console.log(
      `[FOLLOWUP] Scheduled '${type}' for ${chatId} in ${delayMinutes}m (at ${scheduledTime.toISOString()})`
    );
  } catch (error) {
    console.error("[FOLLOWUP] Failed to schedule:", error);
  }
}

/**
 * Cancel a pending follow-up
 * Should be called whenever the USER sends a message
 */
export async function cancelFollowup(chatId: string, env: Env): Promise<void> {
  try {
    const db = new DBService(env.DB);
    const phone = chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
    const lead = await db.getLeadByPhone(phone);

    if (lead) {
      await db.cancelPendingFollowups(lead.id); // Sets status='cancelled'
      console.log(`[FOLLOWUP] Cancelled for ${chatId}`);
    }
  } catch (error) {
    console.error("[FOLLOWUP] Failed to cancel:", error);
  }
}

/**
 * Process pending follow-ups
 * Called by Cron Trigger every minute
 * ONLY sends during business hours (no midnight messages!)
 */
export async function processFollowups(env: Env): Promise<void> {
  try {
    const db = new DBService(env.DB);

    // 1. Check if follow-up is enabled
    const enabled = await db.getConfig("followup_enabled");
    if (enabled === "false") {
      console.log("[FOLLOWUP] Disabled via config. Skipping.");
      return;
    }

    // 2. Load schedule config
    // 2. Load schedule config
    const scheduleStart = parseTimeConfig(
      await db.getConfig("followup_schedule_start"),
      9
    );
    const scheduleEnd = parseTimeConfig(
      await db.getConfig("followup_schedule_end"),
      18
    );
    const weekendEnabled = (await db.getConfig("followup_weekend")) === "true";
    const template = (await db.getConfig("followup_template")) || "";

    // 3. Business hours check
    const brazilTime = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    const dayOfWeek = brazilTime.getDay(); // 0=Sunday, 6=Saturday
    const hour = brazilTime.getHours();

    if (dayOfWeek === 0) {
      console.log("[FOLLOWUP] Sunday - not sending.");
      return;
    }

    // Saturday check
    if (dayOfWeek === 6) {
      if (!weekendEnabled) {
        console.log("[FOLLOWUP] Weekend disabled - not sending.");
        return;
      }

      const currentMinutes = hour * 60 + brazilTime.getMinutes();
      // Hardcoded Saturday hours 9h-17h (9*60=540, 17*60=1020)
      // Ideally this should also be configurable, but keeping per original logic
      if (currentMinutes < 540 || currentMinutes >= 1020) {
        console.log("[FOLLOWUP] Saturday outside 9-17h - not sending.");
        return;
      }
    }

    // Weekdays check
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const currentMinutes = hour * 60 + brazilTime.getMinutes();
      if (currentMinutes < scheduleStart || currentMinutes >= scheduleEnd) {
        console.log(
          `[FOLLOWUP] Outside schedule. Current: ${hour}h${new Date().getMinutes()} (${currentMinutes}m) - Limits: ${scheduleStart}m - ${scheduleEnd}m`
        );
        return;
      }
    }

    const dueFollowups = await db.getPendingFollowups(5);

    if (!dueFollowups || dueFollowups.length === 0) {
      console.log("[FOLLOWUP] No pending followups due.");
      return;
    }

    console.log(`[FOLLOWUP] Processing ${dueFollowups.length} followups...`);

    for (const followup of dueFollowups) {
      const chatId = getChatIdFromPhone(followup.telefone);
      try {
        console.log(`[FOLLOWUP] Processing followup for ${followup.telefone}`);

        // 0. CHECK BLOCKLIST FIRST
        const isBlocked = await isBlocklisted(chatId, env);
        if (isBlocked) {
          console.log(
            `[FOLLOWUP] Skipping - ${followup.telefone} is BLOCKLISTED`
          );
          await db.updateFollowupStatus(followup.id, "cancelled");
          continue;
        }

        // 1. Get Context
        const lead = await db.getLeadByPhone(followup.telefone);
        if (!lead) {
          await db.updateFollowupStatus(followup.id, "failed");
          continue;
        }

        if (
          lead.metadata?.status === "convertido" ||
          lead.metadata?.status === "perdido"
        ) {
          await db.updateFollowupStatus(followup.id, "cancelled");
          continue;
        }

        // 2. Logic based on Type
        console.log(
          `[FOLLOWUP] Processing: type=${followup.term}, message="${
            followup.message?.substring(0, 30) || "NULL"
          }"`
        );

        // CUSTOM MESSAGE (From Sequences) - Always send seller card!
        if (followup.message) {
          console.log(
            `[FOLLOWUP] Sending CUSTOM message + SELLER CARD for ${chatId}`
          );

          // If message has {{nome}}, replace it
          let text = followup.message;
          if (lead.nome) text = text.replace("{{nome}}", lead.nome);
          if (lead.metadata?.vendedor_nome)
            text = text.replace("{{vendedor}}", lead.metadata.vendedor_nome);

          await sendMessage(chatId, text, env);

          // ALWAYS send seller card after message
          // Uses stickiness: same seller if already assigned, new one if not
          const { assignSeller } = await import("./crm.service");
          const { sendVCard } = await import("./evolution.service");

          const seller = await assignSeller(chatId, env);
          if (seller) {
            console.log(
              `[FOLLOWUP] Sending seller card: ${seller.nome} (${seller.telefone})`
            );
            await sendVCard(
              chatId,
              seller.nome,
              seller.telefone,
              env,
              undefined,
              seller.imagem
            );

            // CRITICAL FIX: Reload lead to get updated metadata from assignSeller
            // (vendedor_id, vendedor_nome, assigned_at, status were set by assignSeller)
            const phoneClean = chatId.replace('@s.whatsapp.net', '').replace('@lid', '');
            const updatedLead = await db.getLeadByPhone(phoneClean);
            const meta = updatedLead?.metadata || lead.metadata || {};
            meta.followup_card_sent = true;
            meta.followup_card_sent_at = new Date().toISOString();
            await db.updateLead(lead.id, { metadata: meta });
            
            console.log(`[FOLLOWUP] ✅ Lead updated with seller card flag and preserved vendor data`);
          } else {
            console.warn(`[FOLLOWUP] No seller available to send card!`);
          }

          await db.updateFollowupStatus(followup.id, "sent");
          continue;
        }

        // POST_CARS (5 min após mostrar carros) - Mensagem engajadora
        if (followup.type === "post_cars") {
          console.log(`[FOLLOWUP] Post-cars follow-up for ${chatId}`);
          const postCarsMessages = [
            "E aí, algum desses te chamou atenção? 🚗",
            "Curtiu alguma das opções? Posso te dar mais detalhes!",
            "Algum desses combinou contigo? Me conta!",
            "Viu algum que te interessou? Bora conversar sobre!",
          ];
          const randomMsg = postCarsMessages[Math.floor(Math.random() * postCarsMessages.length)];
          await sendMessage(chatId, randomMsg, env);
          await db.updateFollowupStatus(followup.id, "sent");
          continue;
        }

        // HANDOFF 15M
        if (followup.type === "handoff_15m") {
          console.log(`[FOLLOWUP] Handoff 15m trigger for ${chatId}`);
          await sendMessage(
            chatId,
            "Como não tivemos retorno, vou passar seu contato para um de nossos consultores dar continuidade.",
            env
          );
          await db.updateFollowupStatus(followup.id, "sent");
          continue;
        }

        // STANDARD INACTIVITY (24h) - Cliente pediu texto específico + VCard
        const { sendMessage: sendFollowupMsg, sendVCard } = await import(
          "./evolution.service"
        );
        console.log(`[FOLLOWUP] Sending 24h check for ${chatId}`);

        // Texto exato conforme solicitado pelo cliente
        const msg =
          "Opa, só pra avisar que sigo por aqui se precisar, ou então pode chamar um dos nossos consultores.";

        await sendFollowupMsg(chatId, msg, env);

        // Enviar VCard do consultor - USAR assignSeller para garantir stickiness!
        // BUG FIX: Antes usava sellers[0] direto, não persistia no metadata,
        // fazendo a IA atribuir vendedor diferente depois
        try {
          const { assignSeller } = await import("./crm.service");
          const seller = await assignSeller(chatId, env);
          if (seller) {
            await sendVCard(
              chatId,
              seller.nome,
              seller.telefone,
              env,
              undefined,
              seller.imagem
            );
            console.log(
              `[FOLLOWUP] VCard sent via assignSeller (sticky): ${seller.nome}`
            );
          } else {
            // Fallback se assignSeller falhar
            const sellers = await db.getActiveSellers();
            if (sellers && sellers.length > 0) {
              const fallbackSeller = sellers[0];
              const sellerPhone = fallbackSeller.whatsapp.replace(/\D/g, "");
              await sendVCard(
                chatId,
                fallbackSeller.nome,
                sellerPhone,
                env,
                undefined,
                fallbackSeller.imagem
              );
              console.log(
                `[FOLLOWUP] VCard sent (fallback): ${fallbackSeller.nome}`
              );
            }
          }
        } catch (vcardErr) {
          console.error("[FOLLOWUP] Failed to send VCard:", vcardErr);
        }

        await db.updateFollowupStatus(followup.id, "sent");
      } catch (err) {
        console.error(`[FOLLOWUP] Failed to process ${chatId}:`, err);
        await db.updateFollowupStatus(followup.id, "failed");
      }
    }
  } catch (error) {
    console.error("[FOLLOWUP] Error processing cron:", error);
  }
}

/**
 * Check for automatic follow-up rules (The "Invisible Seller")
 * Rule 1: 24h Silence on 'novo' leads -> Gentle nudge
 */
export async function checkFollowUpRules(env: Env): Promise<void> {
  try {
    const db = new DBService(env.DB);

    // CRITICAL: Check if follow-up is enabled
    const enabled = await db.getConfig("followup_enabled");
    if (enabled === "false") {
      console.log("[FOLLOWUP] Disabled via config. Skipping auto-nudges.");
      return;
    }

    // CRITICAL: Load schedule config and check business hours
    const scheduleStart = parseTimeConfig(
      await db.getConfig("followup_schedule_start"),
      9
    );
    const scheduleEnd = parseTimeConfig(
      await db.getConfig("followup_schedule_end"),
      18
    );
    const weekendEnabled = (await db.getConfig("followup_weekend")) === "true";

    // Use proper timezone conversion
    const now = new Date();
    const brazilTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
    });
    const brazilTime = new Date(brazilTimeStr);
    const dayOfWeek = brazilTime.getDay();
    const hour = brazilTime.getHours();
    const minutes = brazilTime.getMinutes();
    const currentMinutes = hour * 60 + minutes;

    console.log(
      `[FOLLOWUP] Timezone check - UTC: ${now.toISOString()}, Brazil: ${brazilTimeStr}, Hour: ${hour}:${minutes}, Minutes: ${currentMinutes}`
    );

    // Sunday - never send
    if (dayOfWeek === 0) {
      console.log("[FOLLOWUP] Sunday - not sending auto-nudges.");
      return;
    }

    // Saturday check
    if (dayOfWeek === 6) {
      if (!weekendEnabled) {
        console.log("[FOLLOWUP] Weekend disabled - not sending auto-nudges.");
        return;
      }
      // Saturday: 9h-17h (540-1020 minutos)
      if (currentMinutes < 540 || currentMinutes >= 1020) {
        console.log(
          `[FOLLOWUP] Saturday outside 9-17h. Current: ${hour}:${minutes} (${currentMinutes}m) - not sending.`
        );
        return;
      }
    }

    // Weekdays check - STRICT: must be WITHIN business hours with 5 minute margin
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      // Add 5 minute safety margin at start (wait until 9:05)
      const safeStart = scheduleStart + 5;

      if (currentMinutes < safeStart || currentMinutes >= scheduleEnd) {
        console.log(
          `[FOLLOWUP] Outside business hours. Current: ${hour}:${String(
            minutes
          ).padStart(
            2,
            "0"
          )} (${currentMinutes}m) - Limits: ${safeStart}m (${Math.floor(
            safeStart / 60
          )}:${String(safeStart % 60).padStart(
            2,
            "0"
          )}) - ${scheduleEnd}m (${Math.floor(scheduleEnd / 60)}:${
            scheduleEnd % 60
          })`
        );
        return;
      }
    }

    const queryNow = new Date();
    const twentyFourHoursAgo = new Date(
      queryNow.getTime() - 24 * 60 * 60 * 1000
    ).toISOString();
    const twentyFiveHoursAgo = new Date(
      queryNow.getTime() - 25 * 60 * 60 * 1000
    ).toISOString();

    console.log("[FOLLOWUP] Checking for silent leads (24h)...");

    // D1 Query for leads:
    // json_extract(metadata, '$.status') = 'novo'  AND last_interaction BETWEEN ...
    // Note: D1 JSON extraction might require specific syntax or just select all and filter in app if not huge.
    // Assuming metadata is stored as JSON string.
    // Simpler: SELECT * FROM leads WHERE last_interaction BETWEEN ? AND ?
    // Then filter in JS for status='novo'. efficient enough for reasonable dataset.

    const stmt = env.DB.prepare(
      `
        SELECT * FROM leads 
        WHERE last_interaction >= ? AND last_interaction <= ?
    `
    ).bind(twentyFiveHoursAgo, twentyFourHoursAgo);

    const { results } = await stmt.all<any>();

    if (!results || results.length === 0) return;

    const silentLeads = results.filter((l) => {
      try {
        const meta =
          typeof l.metadata === "string" ? JSON.parse(l.metadata) : l.metadata;
        return meta.status === "novo";
      } catch {
        return false;
      }
    });

    console.log(`[FOLLOWUP] Found ${silentLeads.length} leads silent for 24h.`);

    // db already declared at function start

    for (const lead of silentLeads) {
      // 0. SECURITY CHECK: BLOCKLIST
      const chatId = getChatIdFromPhone(lead.telefone);
      if (await isBlocklisted(chatId, env)) {
        console.log(
          `[FOLLOWUP] Skipping auto-nudge for BLOCKLISTED lead: ${lead.telefone}`
        );
        continue;
      }

      // Send AI Nudge
      const nome = lead.nome || "";

      const prompt = `
        O cliente ${nome} mostrou interesse ontem mas não falou mais nada.
        Mande uma mensagem CURTA e CASUAL (estilo gaúcho, sem parecer robô) perguntando se ele ainda tá buscando carro.
        REGRA ABSOLUTA: ZERO EMOJIS. Nenhum emoji, nenhum emoticon.
        Ex: "E aí ${nome}, ainda procurando aquele carro? Posso ajudar em algo?"
        `;

      const tokens = [
        {
          role: "system",
          content:
            "Você é o iAN, assistente de vendas da Netcar. Gaúcho, parceiro, sem frescura. REGRA ABSOLUTA: ZERO EMOJIS - nenhum emoji, nenhum emoticon em hipótese alguma.",
        },
        { role: "user", content: prompt },
      ];

      const message = await callOpenAI(tokens as any, env, {
        temperature: 0.6,
      });

      if (message) {
        // Double-check: Remove any emojis that might have slipped through
        const cleanMessage = message
          .replace(
            /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
            ""
          )
          .trim();

        console.log(
          `[FOLLOWUP] Auto-nudge to ${lead.telefone}: "${cleanMessage}"`
        );
        await sendMessage(chatId, cleanMessage, env);

        // Update last_interaction
        await db.updateLead(lead.id, {
          last_interaction: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.error("[FOLLOWUP] Error in automatic rules:", e);
  }
}
