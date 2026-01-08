import type { Env, CarData } from "../types";
import { saveMessage } from "./crm.service";
import { removeEmojis } from "./nlg-policy.service";
import { createLogger } from './logger.service';

/**
 * Helper to get instance name
 * Priority: Param > Env > Default
 */
function getInstance(env: Env, instanceName?: string): string {
  return instanceName || env.EVOLUTION_INSTANCE;
}

// Cache global variable (module scope)
let cachedApiUrl: string | null = null;

// Helper to get API URL with KV override
async function getApiUrl(env: Env): Promise<string> {
  if (cachedApiUrl) return cachedApiUrl;

  try {
    // Check KV for override
    if (env.NETCAR_CACHE) {
      const kvUrl = await env.NETCAR_CACHE.get("EVOLUTION_API_URL");
      if (kvUrl && kvUrl.startsWith("http")) {
        // const log = createLogger('worker', env);
        // log.info(`[EVOLUTION] Using API URL from KV: ${kvUrl}`);
        cachedApiUrl = kvUrl;
        return kvUrl;
      }
    }
  } catch (e) {
    const log = createLogger('worker', env);
    log.warn("[EVOLUTION] Failed to read API URL from KV:", { error: e });
  }

  // Fallback to env var
  cachedApiUrl = env.EVOLUTION_API_URL;
  return env.EVOLUTION_API_URL;
}

/**
 * Format phone number to ensure valid Evolution API format
 * Audit recommendation: Validate format before API calls
 */
function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  // Handle @s.whatsapp.net or @lid suffix
  if (phone.includes("@")) {
    cleaned = phone.split("@")[0].replace(/\D/g, "");
  }

  // For international compatibility, we assume the webhook provider (Evolution)
  // already provides the number with DDI. We just clean it.

  return cleaned;
}

/**
 * Send text message via Evolution API on VPS
 * Includes retry logic for Cloudflare tunnel errors
 * NEW: Automatic LID to real phone fallback
 */
export async function sendMessage(
  to: string,
  text: string,
  env: Env,
  instanceName?: string,
  retryCount: number = 0,
  triedLidFallback: boolean = false
): Promise<void> {
  const MAX_RETRIES = 2;
  let formattedNumber = checkJid(to);
  const instance = getInstance(env, instanceName);
  
  // Get dynamic URL
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/message/sendText/${instance}`;

  // LID Fallback: If sending to a LID, check if we have the real phone number saved
  const isLid =
    to.includes("@lid") ||
    (formattedNumber.length > 13 && !formattedNumber.includes("@"));
  
  const log = createLogger('worker', env);

  if (isLid && !triedLidFallback) {
    try {
      const { DBService } = await import("./db.service");
      const db = new DBService(env.DB);
      const realPhone = await db.getLidMapping(formattedNumber);

      if (realPhone) {
        log.info(
          `[EVOLUTION] LID detected - using saved real phone: ${realPhone} (original: ${formattedNumber})`
        );
        formattedNumber = realPhone;
      }
    } catch (e) {
      log.warn("[EVOLUTION] Failed to lookup LID mapping:", { error: e });
    }
  }

  log.debug(
    `[EVOLUTION DEBUG] env.EVOLUTION_API_URL: ${baseUrl}`
  );
  log.debug(`[EVOLUTION DEBUG] Fetching URL: ${url}`);
  log.info(
    `[EVOLUTION] Sending text to ${formattedNumber} (raw: ${to}) via ${instance}: ${text.substring(
      0,
      50
    )}...`
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: formattedNumber,
        text: removeEmojis(text), // REGRA ABSOLUTA: ZERO EMOJIS - remove qualquer emoji antes de enviar
        options: {
          delay: 1200,
          presence: "composing",
          linkPreview: true,
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.log(`[EVOLUTION DEBUG] Response Status: ${response.status}`);
      console.log(`[EVOLUTION DEBUG] Response Body: ${responseText}`);

      // Detect Cloudflare Tunnel errors (returns HTML, not JSON)
      if (
        responseText.includes("error code:") ||
        responseText.includes("<!DOCTYPE") ||
        responseText.includes("<html")
      ) {
        const errorMsg = `Evolution API unavailable (Cloudflare error ${
          response.status
        }): ${responseText.substring(0, 100)}`;
        log.error(`[EVOLUTION] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Try to parse JSON normally
      let responseData: any = null;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Evolution API error (non-JSON): ${
            response.status
          } - ${responseText.substring(0, 200)}`
        );
      }

      // Handle "exists: false" - LID expired, try to find real phone in leads table
      if (
        response.status === 400 &&
        JSON.stringify(responseData).includes('exists":false')
      ) {
        log.warn(`[EVOLUTION] LID/Number not found: ${formattedNumber}`);

        // Try to find real phone from leads table if we haven't tried fallback yet
        if (isLid && !triedLidFallback) {
          try {
            const { DBService } = await import("./db.service");
            const db = new DBService(env.DB);

            // Search leads by old phone (LID)
            const lead = await db.getLeadByPhone(formattedNumber);
            if (lead && lead.metadata?.real_phone) {
              log.info(
                `[EVOLUTION] Found real phone in lead metadata: ${lead.metadata.real_phone}`
              );
              return sendMessage(
                lead.metadata.real_phone,
                text,
                env,
                instanceName,
                0,
                true
              );
            }
          } catch (lookupError) {
            log.warn(
              "[EVOLUTION] Failed to lookup alternative number:",
              { error: lookupError }
            );
          }
        }

        log.warn(
          `[EVOLUTION] Cannot reach ${formattedNumber} - LID may have expired`
        );
        return; // Don't throw, just log
      }

      throw new Error(
        `Evolution API error: ${response.status} - ${JSON.stringify(
          responseData
        )}`
      );
    }

    // CRM: Save outbound message
    await saveMessage(to, text, "outbound", env);
    log.info("[EVOLUTION] Text message sent successfully");
  } catch (error: any) {
    // Retry only for Cloudflare/connection errors
    const isCloudflareError =
      error.message?.includes("Cloudflare") ||
      error.message?.includes("unavailable") ||
      error.message?.includes("fetch failed");

    if (retryCount < MAX_RETRIES && isCloudflareError) {
      const delayMs = 1000 * (retryCount + 1); // Exponential backoff: 1s, 2s
      log.warn(
        `[EVOLUTION] Retry ${retryCount + 1}/${MAX_RETRIES} in ${delayMs}ms...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
      return sendMessage(
        to,
        text,
        env,
        instanceName,
        retryCount + 1,
        triedLidFallback
      );
    }

    // Re-throw after max retries or for non-retryable errors
    throw error;
  }
}

/**
 * Helper to smart-format JID for Evolution
 */
function checkJid(to: string): string {
  if (to.endsWith("@g.us")) return to;
  if (to.endsWith("@lid")) return to; // Linked Device ID - trust it
  return formatPhoneNumber(to); // Removes @s.whatsapp.net and non-digits
}

/**
 * Delay helper for multiple messages
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Split a long response into multiple message blocks.
 * Breaks on paragraph breaks, bullet points, or after ~150 chars.
 * Returns array of message blocks to be sent separately.
 */
export function splitResponseIntoBlocks(text: string): string[] {
  // If short enough, send as single message
  if (text.length <= 200) {
    return [text];
  }
  
  const blocks: string[] = [];
  
  // Try to split by double newline (paragraphs) first
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  if (paragraphs.length >= 2) {
    // Multiple paragraphs - each becomes a block
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed) {
        blocks.push(trimmed);
      }
    }
    return blocks;
  }
  
  // Try to split by single newlines if substantial content
  const lines = text.split(/\n/).filter(l => l.trim());
  if (lines.length >= 3) {
    // Group lines into blocks of ~2-3 lines or by semantic breaks
    let currentBlock = '';
    for (const line of lines) {
      if (currentBlock.length + line.length > 250 && currentBlock.trim()) {
        blocks.push(currentBlock.trim());
        currentBlock = line;
      } else {
        currentBlock += (currentBlock ? '\n' : '') + line;
      }
    }
    if (currentBlock.trim()) {
      blocks.push(currentBlock.trim());
    }
    return blocks;
  }
  
  // Fallback: split by sentences for very long single paragraphs
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentBlock = '';
  for (const sentence of sentences) {
    if (currentBlock.length + sentence.length > 200 && currentBlock.trim()) {
      blocks.push(currentBlock.trim());
      currentBlock = sentence;
    } else {
      currentBlock += sentence;
    }
  }
  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim());
  }
  
  return blocks.length > 0 ? blocks : [text];
}

/**
 * Send multiple message blocks with typing simulation between them.
 * Simulates more natural, human-like conversation flow.
 */
export async function sendMultipleMessages(
  to: string,
  blocks: string[],
  env: Env,
  instanceName?: string,
  delayBetweenMs: number = 800
): Promise<void> {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    
    // Send typing status before each block (except first - already typing)
    if (i > 0) {
      await sendPresence(to, 'composing', 2000, env, instanceName);
      await delay(delayBetweenMs);
    }
    
    await sendMessage(to, block, env, instanceName);
    
    // Small delay after sending (simulates reading/thinking)
    if (i < blocks.length - 1) {
      await delay(300);
    }
  }
}


/**
 * Send presence status (typing/recording) to simulate human behavior
 * status: 'composing' (typing), 'recording', 'available', 'unavailable'
 * delay: time in milliseconds to maintain the status (Evolution handles this)
 */
export async function sendPresence(
  to: string,
  presenceType: "composing" | "recording" | "available" | "unavailable",
  delay: number = 12000, // Default 12s to cover GPT latency
  env: Env,
  instanceName?: string
): Promise<void> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/chat/sendPresence/${instance}`;

  const log = createLogger('worker', env);
  log.info(`[TYPING] Set '${presenceType}' for ${to.split("@")[0]}`);

  try {
    // Evolution API v2 requires number with @s.whatsapp.net suffix
    const fullNumber = to.includes("@")
      ? to
      : `${to.replace(/\D/g, "")}@s.whatsapp.net`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: fullNumber,
        presence: presenceType,
        delay: delay,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(
        `[TYPING] Failed to set presence: ${response.status} - ${errorText}`
      );
    }
  } catch (error) {
    log.warn("[TYPING] Error setting presence:", { error });
  }
}

/**
 * Send image with caption via Evolution API
 * Uses base64 encoding which is the supported method
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption: string,
  env: Env,
  instanceName?: string
): Promise<void> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/message/sendMedia/${instance}`;

  const log = createLogger('worker', env);
  log.info(`[EVOLUTION] Sending image to ${to} via ${instance}...`);

  try {
    // Optimization: Send URL directly instead of fetching + base64
    // This reduces worker execution time from ~30s to <1s
    log.info(`[EVOLUTION] Sending image via URL payload: ${imageUrl}`);

    // Add 15s Timeout to prevent Worker hang
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        number: to,
        // Evolution API v2 - formato plano sem wrapper 'mediaMessage'
        mediatype: "image",
        mimetype: imageUrl.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg",
        media: imageUrl,
        caption: caption,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(
        `[EVOLUTION] Image URL send failed (${response.status}): ${errorBody}`
      );
      throw new Error(`Evolution API error: ${response.status} - ${errorBody}`);
    }

    // Ensure success body is consumed/closed
    await response.body?.cancel();

    // CRM: Save outbound message (Image caption)
    await saveMessage(to, caption || "[Imagem enviada]", "outbound", env);

    log.info("[EVOLUTION] Image sent successfully via URL");
  } catch (error: any) {
    if (error.name === "AbortError") {
      log.error(`[EVOLUTION] Image send TIMED OUT (>15s): ${imageUrl}`);
    } else {
      log.error(
        "[EVOLUTION] Image send failed, falling back to text:",
        { error }
      );
    }

    // Fallback: send as text with link
    const fallbackMessage = `${caption}\n\n📷 Ver foto: ${imageUrl}`;
    await sendMessage(to, fallbackMessage, env, instanceName);
  }
}

/**
 * Send car card with image and info
 */
export async function sendCarCard(
  to: string,
  car: CarData,
  env: Env,
  instanceName?: string
): Promise<void> {
  // Build enriched caption with all car details (NO EMOJIS per prompt rules)
  let caption = `*${car.marca} ${car.modelo} ${car.motor} ${car.ano}*\n`;
  caption += `${car.preco}\n\n`;
  caption += `*Especificações:*\n`;
  caption += `• Cor: ${car.cor}\n`;
  caption += `• ${car.km.toLocaleString("pt-BR")} km rodados\n`;
  caption += `• Câmbio: ${car.cambio}\n`;
  caption += `• Combustível: ${car.combustivel}\n`;

  // Add motor/potencia if available
  if (car.potencia) {
    caption += `• Motor: ${car.motor} (${car.potencia})\n`;
  }

  // Add portas
  caption += `• ${car.portas} portas\n`;

  // Add opcionais if available
  if (car.opcionais && car.opcionais.length > 0) {
    caption += `\n*Destaques:*\n`;
    for (const opt of car.opcionais) {
      if (opt) caption += `• ${opt}\n`;
    }
  }

  caption += `\nVer detalhes: ${car.link}`;

  if (car.imageUrl) {
    // FIX: Evolution API returns 401 when fetching from our Worker cache
    // Use original NetCar URL directly (it's public and Evolution can fetch it)
    const imageUrlToSend = car.imageUrl;
    
    // NOTE: Cache disabled temporarily due to Evolution API 401 errors
    // TODO: Re-enable when Evolution API can access Worker URLs
    // try {
    //   const { getOrCacheImage } = await import("./image-cache.service");
    //   const cachedUrl = await getOrCacheImage(car.imageUrl, env);
    //   if (cachedUrl) imageUrlToSend = cachedUrl;
    // } catch (e) {
    //   const log = createLogger('worker', env);
    //   log.error("[EVOLUTION] Failed to cache image, using original:", { error: e });
    // }

    await sendImage(to, imageUrlToSend, caption, env, instanceName);
  } else {
    await sendMessage(to, caption, env, instanceName);
  }
}

/**
 * Send options buttons
 */
export async function sendButtons(
  to: string,
  text: string,
  buttons: { id: string; label: string }[],
  env: Env,
  instanceName?: string
): Promise<void> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/message/sendButtons/${instance}`;

  const log = createLogger('worker', env);
  log.info(
    `[EVOLUTION] Sending buttons to ${to} via ${instance}: ${buttons
      .map((b) => b.label)
      .join(", ")}`
  );

  // FORCE FALLBACK TO TEXT LIST (Buttons are deprecated/unreliable)
  // We skip the API call to /message/sendButtons entirely
  // IMPORTANT: Use natural conversation style, NOT numbered menus (per prompt rules)
  log.info(
    `[EVOLUTION] Skipping native buttons, sending natural text instead`
  );

  // Build natural question with options inline (not numbered)
  const options = buttons.map((b) => b.label).join(" ou ");
  const naturalText = `${text}\n\n${options}?`;

  await sendMessage(to, naturalText, env, instanceName);
}

/**
 * Send seller contact as image with clickable wa.me link
 * Format: Image with caption "Falar com {nome}:\nhttps://wa.me/..."
 */
export async function sendVCard(
  to: string,
  contactName: string,
  contactPhone: string,
  env: Env,
  instanceName?: string,
  imageUrl?: string
): Promise<void> {
  const instance = getInstance(env, instanceName);
  const phoneClean = contactPhone.replace(/\D/g, "");

  const log = createLogger('worker', env);
  log.info(
    `[EVOLUTION] Sending contact ${contactName} to ${to} via ${instance}`
  );

  const waLink = `https://wa.me/55${phoneClean}`;
  const caption = `${contactName}:\n${waLink}`;

  // Send seller photo with caption (or just text if no image)
  if (imageUrl) {
    try {
      const baseUrl = await getApiUrl(env);
      const url = `${baseUrl}/message/sendMedia/${instance}`;
      // Evolution API v2+ format: mediatype at root level
      const response = await fetch(url, {
        method: "POST",
        headers: {
          apikey: env.EVOLUTION_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: to,
          mediatype: "image",
          mimetype: imageUrl.toLowerCase().endsWith(".png")
            ? "image/png"
            : "image/jpeg",
          media: imageUrl,
          caption: caption,
          options: {
            delay: 1200,
            presence: "composing",
          },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        log.error(`[EVOLUTION] Failed to send seller image: ${errorBody}`);
        // Fallback to text
        await sendMessage(to, caption, env, instanceName);
      }
    } catch (e) {
      log.error("[EVOLUTION] Exception sending seller image:", { error: e });
      // Fallback to text
      await sendMessage(to, caption, env, instanceName);
    }
  } else {
    // No image: just send text with link
    await sendMessage(to, caption, env, instanceName);
  }

  await saveMessage(
    to,
    `[Contato] ${contactName} - ${contactPhone}`,
    "outbound",
    env
  );
}

/**
 * Get instance status
 */
export async function fetchInstance(
  instanceName: string,
  env: Env
): Promise<any> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/instance/connectionState/${instance}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch instance: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    const log = createLogger('worker', env);
    log.error("[EVOLUTION] Error fetching instance:", { error });
    throw error;
  }
}

/**
 * Restart instance
 */
export async function restartInstance(
  instanceName: string,
  env: Env
): Promise<any> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/instance/restart/${instance}`;

  try {
    const response = await fetch(url, {
      method: "POST", // Evolution v2 usually accepts POST for restart
      headers: {
        apikey: env.EVOLUTION_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to restart instance: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    const log = createLogger('worker', env);
    log.error("[EVOLUTION] Error restarting instance:", { error });
    throw error;
  }
}

/**
 * Set webhook
 */
export async function setWebhook(
  instanceName: string,
  webhookUrl: string,
  env: Env
): Promise<any> {
  const instance = getInstance(env, instanceName);
  const baseUrl = await getApiUrl(env);
  const url = `${baseUrl}/webhook/set/${instance}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to set webhook: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    const log = createLogger('worker', env);
    log.error("[EVOLUTION] Error setting webhook:", { error });
    throw error;
  }
}
