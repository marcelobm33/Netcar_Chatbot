import { Hono } from "hono";
import { cors } from "hono/cors";
// Sentry removed - using monitoring.service instead
// Stubs for removed services
const ddLog = (..._args: unknown[]) => {};
const ddMetric = (..._args: unknown[]) => {};
const ddFlush = async () => {};
const ddWebhookReceived = (..._args: unknown[]) => {};
const ddWebhookProcessed = (..._args: unknown[]) => {};
const ddAICall = (..._args: unknown[]) => {};
const ddAIResponse = (..._args: unknown[]) => {};
const ddError = (..._args: unknown[]) => {};
const ddTraceStart = (..._args: unknown[]) => ({});
const ddTraceEnd = (..._args: unknown[]) => {};
const sentryCapture = (..._args: unknown[]) => {};
const sentryBreadcrumb = (..._args: unknown[]) => {};
const sentryResetBreadcrumbs = () => {};
const sentryFlush = async () => {};
const getSentryDSN = () => '';
const getSentryEnvironment = () => 'production';

import type { Env, EvolutionWebhookPayload, CarData, Variables } from "./types";
// sentry.service removed - using monitoring.service instead
import {
  initMonitoring,
  flushMonitoring,
  captureError,
} from "@legacy/monitoring.service";
import {
  callOpenAI,
  getSystemPrompt,
  transcribeAudio,
  mergeSystemPrompt,
  injectDynamicVariablesAsync,
} from "@legacy/openai.service";
import { searchCars, formatCarList, formatCarCards } from "@legacy/cars.service";
import {
  sendMessage,
  sendCarCard,
  sendButtons,
  sendVCard,
  sendPresence,
  sendImage,
} from "@legacy/evolution.service";
import { DBService } from "@worker/db/db.service";
import {
  isBlocklisted,
  addToBlocklist,
  syncBlocklistFromD1,
  listBlocklist,
  restoreBlocklistEntry,
} from "@worker/auth/blocklist.service";
import {
  checkWebhookLimit,
  rateLimitExceededResponse,
} from "@worker/auth/ratelimit.service";

import {
  upsertLead,
  saveMessage as crmSaveMessage,
  assignSeller,
  autoCloseStaleLeads,
  getRecentMessages,
  updateLeadSummary,
  batchSummarizeLeads,
  autoQualifyLeads,
  getAvailableSellers,
  isSeller,
  isSpamMessage,
} from "@legacy/crm.service";
import {
  saveCarSession,
  getNextCarBatch,
  hasMoreCars,
  getRemainingCount,
  isAskingForMore,
  getConversationState,
  setConversationState,
  wasSellerCardSent,
} from "@worker/kv/session.service";
import {
  getBrands,
  getDepoimentos,
  getSiteInfo,
  formatBrandsList,
  formatDepoimentos,
  formatSiteInfo,
  getAllCarIdentifiers,
} from "@api/netcar-legacy";
import { logException, logWarning } from "@legacy/logger.service";
import {
  scheduleFollowup,
  cancelFollowup,
  processFollowups,
  checkFollowUpRules,
} from "@legacy/followup.service";
import { searchKnowledge as searchKnowledgeBase } from "@legacy/rag.service";
import { StorageService } from "@legacy/storage.service";
import {
  getContext,
  updateContext,
  addCarFromImage,
  addCarsShown,
  getPendingImageCars,
  addPendingAction,
  getPendingActions,
  consumePendingActions,
  recordSearch,
  generateContextSummary,
  type ConversationContext,
} from "@worker/kv/context.service";
import { verifyRole, logAudit, sanitizeUserInput } from "@worker/auth/security.service";
import {
  detectIntent,
  extractCarModel,
  extractCarBrand,
  extractPriceRange,
} from "@legacy/intents.service";
import { detectCarIntent, detectHumanRequest } from "./core/intent-detection";
import { checkResetCommand } from "./core/guards";
import { checkFAQScriptAsync } from "@legacy/scripts.service";
// datadog.service removed
import {
  routeMessage,
  createInitialState,
  updateStateFromContext,
  logRouterDecision,
  type RouterAction,
  type ConversationState,
} from "@legacy/router.service";
import {
  enforceNLGPolicy,
  logNLGMetrics,
} from "@legacy/nlg-policy.service";
import {
  getAskedSlots,
  markSlotAsAsked,
  updateSummaryAfterAction,
} from "@legacy/summary.service";
import {
  transitionStage,
  getStagePrompt,
  type TransitionContext,
} from "@legacy/fsm.service";
import {
  startMetricsSession,
  updateSessionMetrics,
  endMetricsSession,
  getActiveSession,
} from "@legacy/evaluation.service";

// === MODULAR ROUTES (REF-01) ===
import {
  publicRoutes,
  analyticsRoutes,
  ragRoutes,
  maintenanceRoutes,
  adminRoutes,
  dashboardRoutes,
  feedbackRoutes,
} from "./routes";
import { analyticsV2Routes } from "./routes/analytics-v2.routes";

// In-memory queue to serialize messages from the same user (Fix Race Condition)
const MESSAGE_QUEUES = new Map<string, Promise<void>>();

// Cache for car search results
const CAR_SEARCH_CACHE = new Map<
  string,
  { data: CarData[]; timestamp: number }
>();

// Message deduplication cache (prevent duplicate webhooks from triggering duplicate responses)
const PROCESSED_MESSAGES = new Map<string, number>(); // messageId -> timestamp
const MESSAGE_DEDUP_TTL = 60000; // 60 seconds TTL

// Spam/gibberish attempt counter per user (YAML v1.1: max 2 attempts before silence)
const SPAM_ATTEMPT_COUNT = new Map<
  string,
  { count: number; lastReset: number }
>();
const SPAM_RESET_WINDOW = 300000; // Reset counter after 5 min of no gibberish

// NATIVE GREETING DETECTION: WhatsApp Business auto-response message
// Used to detect when native greeting was sent and bot should NOT send duplicate
const NATIVE_GREETING_PATTERNS = [
  "olá! tudo bem? qual veículo você gostaria de mais informações",
  "ola! tudo bem? qual veiculo voce gostaria de mais informacoes",
  "olá! tudo bem?",
  "qual veículo você gostaria",
];
const NATIVE_GREETING_WINDOW_MS = 60000; // 60 seconds window to detect native greeting

// Cleanup old messages from dedup cache periodically
function cleanupProcessedMessages() {
  const now = Date.now();
  for (const [msgId, timestamp] of PROCESSED_MESSAGES) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      PROCESSED_MESSAGES.delete(msgId);
    }
  }
}

/**
 * Check if WhatsApp Business native greeting was sent recently
 * This prevents the bot from sending a duplicate greeting when native auto-response already handled it
 *
 * Note: The native greeting is sent by WhatsApp Business app, not by Evolution API
 * So we check if there's a recent outbound message that matches the greeting pattern
 */
async function wasNativeGreetingSentRecently(
  sender: string,
  env: Env
): Promise<boolean> {
  try {
    const db = new DBService(env.DB);
    const telefone = sender.replace("@s.whatsapp.net", "").replace("@lid", "");
    const lead = await db.getLeadByPhone(telefone);

    if (!lead) return false; // New lead, no previous messages

    // Get recent messages (last 2 minutes)
    const recentMessages = await db.getRecentMessages(lead.id, 5);
    if (!recentMessages || recentMessages.length === 0) return false;

    const now = Date.now();

    for (const msg of recentMessages) {
      // Check if it's an outbound message (from bot/native greeting)
      if (msg.role === "assistant" && msg.created_at) {
        const msgTime = new Date(msg.created_at).getTime();
        const timeDiff = now - msgTime;

        // Within the detection window?
        if (timeDiff < NATIVE_GREETING_WINDOW_MS) {
          // Check if content matches native greeting patterns
          const msgLower = msg.content
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          const matchesPattern = NATIVE_GREETING_PATTERNS.some((pattern) =>
            msgLower.includes(
              pattern.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            )
          );

          if (matchesPattern) {
            console.log(
              `[NATIVE_GREETING] Detected native greeting sent ${timeDiff}ms ago - will NOT duplicate`
            );
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    console.error("[NATIVE_GREETING] Error checking:", error);
    return false; // On error, proceed normally
  }
}

/**
 * Check if current time is within business hours (Brazil timezone)
 * Seg-Sex: 9h-18h | Sab: 9h-16h30 | Dom: FECHADO
 * Jan-Mar: Sábados até 13h30
 */
function isWithinBusinessHours(): { isOpen: boolean; message?: string } {
  const now = new Date();
  // Convert to Brazil timezone
  const brazilTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const dayOfWeek = brazilTime.getDay(); // 0=Sunday, 6=Saturday
  const hour = brazilTime.getHours();
  const minute = brazilTime.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const month = brazilTime.getMonth(); // 0=Jan, 1=Feb, 2=Mar

  // Sunday - CLOSED
  if (dayOfWeek === 0) {
    return {
      isOpen: false,
      message:
        "⏰ Estamos fechados aos domingos. \n\nNosso horário:\n📅 Seg a Sex: 9h às 18h\n📅 Sábado: 9h às 16h30\n\nDeixe sua mensagem que respondemos amanhã! 🚗",
    };
  }

  // Saturday
  if (dayOfWeek === 6) {
    // Jan-Mar: 9h-13h30
    const saturdayClose =
      month >= 0 && month <= 2 ? 13 * 60 + 30 : 16 * 60 + 30;
    const saturdayOpen = 9 * 60;

    if (currentMinutes < saturdayOpen || currentMinutes >= saturdayClose) {
      const closeTime = month >= 0 && month <= 2 ? "13h30" : "16h30";
      return {
        isOpen: false,
        message: `⏰ Nosso atendimento de sábado é das 9h às ${closeTime}.\n\nRetornamos na segunda-feira! 🚗`,
      };
    }
    return { isOpen: true };
  }

  // Weekdays (Mon-Fri): 9h-18h
  const weekdayOpen = 9 * 60;
  const weekdayClose = 18 * 60;

  if (currentMinutes < weekdayOpen || currentMinutes >= weekdayClose) {
    return {
      isOpen: false,
      message:
        "⏰ Nosso horário de atendimento é das 9h às 18h.\n\nDeixe sua mensagem que respondemos assim que abrirmos! 🚗",
    };
  }

  return { isOpen: true };
}

/**
 * Check if a chat ID belongs to a WhatsApp group
 */
function isGroupMessage(chatId: string): boolean {
  return chatId.includes("@g.us");
}

/**
 * Process leads that arrived outside business hours
 * Called by Cron at 9:00 AM Brazil time
 */
async function processPendingOpeningLeads(env: Env): Promise<void> {
  try {
    console.log(
      "[OPENING] 🌅 Processing leads that arrived outside business hours..."
    );

    const db = new DBService(env.DB);
    // Find all leads with next_step = 'pending_opening' in metadata
    // D1/SQLite specific JSON query
    const stmt = env.DB.prepare(
      "SELECT * FROM leads WHERE json_extract(metadata, '$.next_step') = 'pending_opening'"
    );
    const { results } = await stmt.all<any>();
    const pendingLeads = results || [];

    if (pendingLeads.length === 0) {
      console.log("[OPENING] No pending leads to process.");
      return;
    }

    console.log(`[OPENING] Found ${pendingLeads.length} leads to process.`);

    for (const lead of pendingLeads) {
      try {
        const chatId = `${lead.telefone}@s.whatsapp.net`;
        const nome = lead.nome || "Cliente";

        // Send morning greeting
        await sendMessage(
          chatId,
          `Bom dia, ${nome}! Recebemos sua mensagem ontem à noite.\n\nComo posso te ajudar hoje?`,
          env
        );

        // Clear the pending flag
        let meta = lead.metadata;
        if (typeof meta === "string") {
          try {
            meta = JSON.parse(meta);
          } catch {
            /* Ignore parse errors, metadata may not be valid JSON */
          }
        }
        if (!meta) meta = {};

        meta.next_step = null;

        await db.updateLead(lead.id, { metadata: meta });

        console.log(`[OPENING] ✅ Processed lead ${lead.telefone}`);

        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(
          `[OPENING] Failed to process lead ${lead.telefone}:`,
          err
        );
      }
    }

    console.log(
      `[OPENING] 🏁 Finished processing ${pendingLeads.length} pending leads.`
    );
  } catch (error) {
    console.error("[OPENING] Error processing pending leads:", error);
  }
}

/**
 * Helper to enqueue message processing per user
 * Ensures strict sequential execution: Request B waits for Request A to finish
 */
async function enqueueMessageProcessing(
  sender: string,
  task: () => Promise<void>
): Promise<void> {
  // Get current tail of the queue
  const previousTask = MESSAGE_QUEUES.get(sender) || Promise.resolve();

  // Create new task that waits for previous
  const myTask = (async () => {
    try {
      await previousTask;
    } catch (err) {
      console.warn(
        `[QUEUE] Previous task for ${sender} failed, continuing chain.`
      );
    }

    // Run current task
    try {
      await task();
    } catch (err) {
      console.error(`[QUEUE] Task failed for ${sender}`, err);
      throw err;
    }
  })();

  // Update tail
  MESSAGE_QUEUES.set(sender, myTask);

  // Cleanup after completion to free memory
  // (We use a slight delay or check strict equality to avoid deleting a newer task)
  myTask.finally(() => {
    if (MESSAGE_QUEUES.get(sender) === myTask) {
      MESSAGE_QUEUES.delete(sender);
    }
  });

  return myTask;
}

/**
 * Helper to fetch media with authentication from Evolution API
 */

// Helper to determine mime type from buffer
function getMimeType(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer).subarray(0, 4);
  let header = "";
  for (let i = 0; i < bytes.length; i++) {
    header += bytes[i].toString(16);
  }

  // Simple check for common image/audio types
  if (header.startsWith("ffd8")) return "image/jpeg";
  if (header.startsWith("89504e47")) return "image/png";
  if (header.startsWith("47494638")) return "image/gif";
  if (header.startsWith("494433")) return "audio/mp3"; // ID3
  if (header.startsWith("fff3") || header.startsWith("fff2"))
    return "audio/mp3";
  if (header.startsWith("4f676753")) return "audio/ogg"; // OggS

  return "application/octet-stream";
}

// Convert response to base64
async function responseToBase64(response: Response): Promise<string> {
  const arrayBuffer = await response.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

// Fetch media from URL or Evolution API (using message ID)
async function fetchMedia(
  mediaIdentifier: string | null,
  env: Env,
  key: any
): Promise<string | null> {
  try {
    // Strategy 1: Direct fetch if it's a valid URL and NOT a whatsapp.net URL (which are auth-protected)
    // We skip mmg.whatsapp.net entirely because we don't have the cookies/auth to fetch it directly.
    if (
      mediaIdentifier &&
      mediaIdentifier.startsWith("http") &&
      !mediaIdentifier.includes("whatsapp.net")
    ) {
      console.log(
        `[WEBHOOK] Attempting direct fetch from URL: ${mediaIdentifier}`
      );
      try {
        const directResponse = await fetch(mediaIdentifier, {
          headers: { "User-Agent": "NetcarBot/1.0" },
        });

        if (directResponse.ok) {
          return await responseToBase64(directResponse);
        }
      } catch (err) {
        console.warn(
          `[WEBHOOK] Direct fetch failed for ${mediaIdentifier}, falling back to Evolution API.`
        );
      }
    }

    // Strategy 2: Fetch via Evolution API using Message Key
    // Correct Endpoint: /chat/getBase64FromMediaMessage/{instance}
    const fetchUrl = `${env.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${env.EVOLUTION_INSTANCE}`;
    console.log(
      `[WEBHOOK] Fetching media via Evolution API: ${fetchUrl} for message ${key.id}`
    );

    const postResponse = await fetch(fetchUrl, {
      method: "POST",
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          key: key,
        },
        convertToBase64: true,
      }),
    });

    if (postResponse.ok) {
      const contentType = postResponse.headers.get("content-type") || "";

      // CRITICAL: Fail if response is HTML or Text (likely a proxy error or landing page)
      if (
        contentType.includes("text/html") ||
        contentType.includes("text/plain")
      ) {
        const msg = `[WEBHOOK] fetchMedia returned text/html instead of image. Content: ${contentType}`;
        console.error(msg);
        await logWarning(msg, "worker", env, {
          status: postResponse.status,
          contentType,
        });
        return null;
      }

      if (contentType.includes("application/json")) {
        // Clone response to avoid consuming body if we need to read it as binary later
        const jsonBody = (await postResponse.clone().json()) as any;

        if (jsonBody.base64) {
          console.log("[WEBHOOK] Got base64 from JSON response");
          return jsonBody.base64
            .replace(/^data:.*?;base64,/, "")
            .replace(/\s/g, "");
        }
        console.warn(
          "[WEBHOOK] JSON response, but no base64 field found:",
          JSON.stringify(jsonBody).substring(0, 200)
        );
        await logWarning(
          "[WEBHOOK] JSON response without base64",
          "worker",
          env,
          { body: jsonBody }
        );
        return null;
      }

      // If it returns raw binary directly (unlikely for this endpoint, but possible if configured)
      return await responseToBase64(postResponse);
    }

    const msg = `[WEBHOOK] All fetchMedia strategies failed. Last status: ${postResponse.status}`;
    console.error(msg);
    // Log invalid endpoint errors or auth errors
    const errBody = await postResponse.text();
    console.error(`[WEBHOOK] Error body: ${errBody}`);
    await logWarning(msg, "worker", env, {
      status: postResponse.status,
      url: fetchUrl,
      body: errBody,
    });
    return null;
  } catch (error) {
    console.error("[WEBHOOK] Media fetch error:", error);
    await logException(error, "worker", undefined, env, {
      context: "fetchMedia",
      mediaIdentifier,
    });
    return null;
  }
}

// --- OPTIMIZATION & PROTECTION ---
// In-memory rate limiter (resets on worker restart)
const RATE_LIMIT_MAP = new Map<string, { count: number; start: number }>();
// CAR_SEARCH_CACHE defined above with proper typing
// ---------------------------------

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Enable CORS for all routes
app.use("*", cors());

// ===========================================
// MODULAR ROUTES (REF-01 - Refactored Code)
// ===========================================
// These routes are modularized but kept as fallback.
// Original inline routes below take precedence.
// After testing, original can be safely removed.
app.route("/v2", publicRoutes);           // /v2/, /v2/health, /v2/public/*
app.route("/v2/analytics", analyticsRoutes); // /v2/analytics/*
app.route("/v2/api/admin/rag", ragRoutes);   // /v2/api/admin/rag/*
app.route("/v2/maintenance", maintenanceRoutes); // /v2/maintenance/*
app.route("/v2/api/admin", adminRoutes);     // /v2/api/admin/*
app.route("/v2/api/dashboard", dashboardRoutes); // /v2/api/dashboard/*
app.route("/v2/api/feedback", feedbackRoutes);   // /v2/api/feedback/*
app.route("/v2/api/analytics", analyticsV2Routes); // /v2/api/analytics/* (Dashboard metrics)


// ============================================
// API PROPRIETÁRIA (SAAS)
// ============================================

// 1. Documentation
// renderDocs removed - module was deleted
import { AuthService } from "@legacy/auth.service";
// Note: Variables type already imported at top of file
app.get("/docs", (c) => c.text("API Docs: Use Postman collection or check /api/health"));

// =======================
// PUBLIC AUTH (Login)
// =======================
app.post("/api/auth/login", async (c) => {
  try {
    const { email, password } = await c.req.json<{
      email: string;
      password: string;
    }>();

    // Credentials from environment variables (Security Best Practice)
    const validEmail = c.env.NETCAR_ADMIN_EMAIL;
    const validPass = c.env.NETCAR_ADMIN_PASSWORD;

    if (
      validEmail && validPass &&
      email === validEmail &&
      password === validPass
    ) {
      return c.json({
        success: true,
        token: c.env.NETCAR_ADMIN_KEY,
        user: { name: "Admin Netcar", email },
      });
    }

    return c.json({ error: "Invalid credentials" }, 401);
  } catch (e) {
    return c.json({ error: "Bad Request" }, 400);
  }
});

// 2. Secured API Routes
const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.NETCAR_ADMIN_KEY}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userRole', 'admin');
  await next();
});

// =======================
// INTERNAL: TOKEN MANAGEMENT
// =======================

api.post("/v1/internal/tokens", async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  try {
    const { label } = await c.req.json<{ label: string }>();
    if (!label) return c.json({ error: "Label required" }, 400);

    const auth = new AuthService(c.env.DB);
    const result = await auth.createToken(label);
    return c.json(result);
  } catch (e) {
    return c.json({ error: "Failed to create token" }, 500);
  }
});

api.get("/v1/internal/tokens", async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  try {
    const auth = new AuthService(c.env.DB);
    const tokens = await auth.listTokens();
    return c.json({ data: tokens });
  } catch (e) {
    return c.json({ error: "Failed to list tokens" }, 500);
  }
});

api.delete("/v1/internal/tokens/:id", async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  try {
    const id = parseInt(c.req.param("id"), 10);
    const auth = new AuthService(c.env.DB);
    await auth.revokeToken(id);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: "Failed to revoke token" }, 500);
  }
});

// =======================
// PUBLIC CLIENT API
// =======================

// GET /api/v1/leads
api.get("/v1/leads", async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = (page - 1) * limit;
  const status = c.req.query("status");

  try {
    const db = new DBService(c.env.DB);
    const { leads, total } = await db.getLeads(limit, offset, status);

    return c.json({
      data: leads.map((l) => {
        let meta = l.metadata;
        if (typeof meta === "string") {
          try {
            meta = JSON.parse(meta);
          } catch {
            /* Ignore parse errors, metadata may not be valid JSON */
          }
        }
        return {
          id: l.id,
          phone: l.telefone,
          name: l.nome,
          interest: l.interesse,
          status: (meta as any)?.status || "novo",
          summary: (meta as any)?.resumo_ia || null,
          created_at: l.created_at,
          last_interaction: l.last_interaction,
          seller: (meta as any)?.vendedor_nome || null,
        };
      }),
      meta: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (e) {
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// GET /api/v1/leads/:id/transcript
api.get("/v1/leads/:id/transcript", async (c) => {
  const leadId = c.req.param("id");
  try {
    const db = new DBService(c.env.DB);
    const messages = await db.getLeadTranscript(leadId);

    return c.json({
      lead_id: leadId,
      count: messages.length,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: "Failed to fetch transcript" }, 500);
  }
});

// Mount API
app.route("/api", api);

// PUBLIC ENDPOINTS (No Auth Required)
// Store Hours - Used by bot/AI to get current hours
app.get("/public/store-hours", async (c) => {
  const db = new DBService(c.env.DB);

  const hoursJson = await db.getConfig("store_hours");
  if (!hoursJson) {
    return c.json({
      weekday: "9h às 18h",
      saturday: "9h às 17h",
      sunday: "Fechado",
      special_rules: [],
    });
  }

  try {
    const hours = JSON.parse(hoursJson);

    // Format for AI consumption
    const activeRules = (hours.special_rules || [])
      .filter((r: { active?: boolean }) => r.active)
      .map((r: { label: string; description: string }) => ({
        label: r.label,
        description: r.description,
      }));

    return c.json({
      weekday: `${hours.weekday_start}h às ${hours.weekday_end}h`,
      saturday: `${hours.saturday_start}h às ${hours.saturday_end}h`,
      sunday: hours.sunday_closed ? "Fechado" : "Aberto",
      special_rules: activeRules,
    });
  } catch {
    return c.json({
      weekday: "9h às 18h",
      saturday: "9h às 17h",
      sunday: "Fechado",
      special_rules: [],
    });
  }
});

// Basic health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "netcar-worker",
    version: "5.3.0", // Sprint 2 improvements
    timestamp: new Date().toISOString(),
  });
});

// Detailed health check with connectivity tests
app.get("/health", async (c) => {
  const startTime = Date.now();
  const checks: Record<
    string,
    { status: string; latency?: number; error?: string }
  > = {};

  // Check D1 Database
  try {
    const db = new DBService(c.env.DB);
    const dbStart = Date.now();
    await db.getConfig("bot_enabled"); // Simple read query
    checks.db = {
      status: "ok",
      latency: Date.now() - dbStart,
    };
  } catch (err: any) {
    checks.db = { status: "error", error: err.message };
  }

  // Check Evolution API
  try {
    const evolutionStart = Date.now();
    const evolutionRes = await fetch(
      `${c.env.EVOLUTION_API_URL}/instance/connectionState/${c.env.EVOLUTION_INSTANCE}`,
      {
        headers: {
          apikey: c.env.EVOLUTION_API_KEY,
          "User-Agent": "NetcarWorker/1.0",
        },
      }
    );
    const evolutionData = (await evolutionRes.json()) as any;
    checks.evolution = {
      status:
        evolutionRes.ok && evolutionData?.instance?.state === "open"
          ? "ok"
          : "warning",
      latency: Date.now() - evolutionStart,
      ...(evolutionData?.instance?.state
        ? { connection: evolutionData.instance.state }
        : {}),
    };
  } catch (err: any) {
    checks.evolution = {
      status: "error",
      error: err.message,
    };
  }

  // Check Netcar API
  try {
    const netcarStart = Date.now();
    const netcarRes = await fetch(
      "https://www.netcarmultimarcas.com.br/api/v1/veiculos.php?limit=1"
    );
    checks.netcar = {
      status: netcarRes.ok ? "ok" : "error",
      latency: Date.now() - netcarStart,
      ...(netcarRes.ok ? {} : { error: `HTTP ${netcarRes.status}` }),
    };
  } catch (err: any) {
    checks.netcar = { status: "error", error: err.message };
  }

  // Check KV Cache
  try {
    const kvStart = Date.now();
    if (c.env.NETCAR_CACHE) {
      await c.env.NETCAR_CACHE.get("health_check_test");
      checks.kv = {
        status: "ok",
        latency: Date.now() - kvStart,
      };
    } else {
      checks.kv = { status: "warning", error: "KV not bound" };
    }
  } catch (err: any) {
    checks.kv = { status: "error", error: err.message };
  }

  // Check Vectorize (RAG)
  try {
    const vectorStart = Date.now();
    if (c.env.VECTORIZE) {
      // Simple describe to verify connection
      const info = await c.env.VECTORIZE.describe();
      checks.vectorize = {
        status: "ok",
        latency: Date.now() - vectorStart,
        ...(info?.vectorsCount !== undefined
          ? { vectors: info.vectorsCount }
          : {}),
      };
    } else {
      checks.vectorize = { status: "warning", error: "Vectorize not bound" };
    }
  } catch (err: any) {
    checks.vectorize = { status: "error", error: err.message };
  }

  // Overall status
  const hasErrors = Object.values(checks).some((c) => c.status === "error");
  const hasWarnings = Object.values(checks).some((c) => c.status === "warning");

  return c.json({
    status: hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy",
    service: "netcar-worker",
    version: "5.4.0", // Bumped version for this release
    uptime: Math.round((Date.now() - startTime) / 1000),
    checks,
    timestamp: new Date().toISOString(),
  });
});

// Maintenance endpoint - cleanup stale leads (manual trigger)
// PROTECTED: Requires Admin Role
app.post("/maintenance/cleanup", async (c) => {
  const isAuthorized = await verifyRole(c.req.raw, c.env, "admin");
  if (!isAuthorized) {
    console.warn(
      "[SECURITY] Unauthorized access attempt to /maintenance/cleanup"
    );
    return c.json(
      { error: "Unauthorized", timestamp: new Date().toISOString() },
      401
    );
  }

  console.log("[MAINTENANCE] Starting manual cleanup...");

  try {
    const closedCount = await autoCloseStaleLeads(c.env);

    // Audit Log
    c.executionCtx.waitUntil(
      logAudit("admin", "MAINTENANCE_CLEANUP", "stale_leads", c.env, {
        closed: closedCount,
      })
    );

    return c.json({
      status: "ok",
      action: "cleanup_stale_leads",
      leads_closed: closedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[MAINTENANCE] Cleanup error:", error);
    return c.json(
      {
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// ===========================================================
// BLOCKLIST SYNC ENDPOINT
// Sync blocklist from D1 (Truth) to Cloudflare KV (Cache)
// ===========================================================
app.post("/api/sync-blocklist", async (c) => {
  try {
    console.log("[SYNC] Starting blocklist sync from D1 to KV...");
    const result = await syncBlocklistFromD1(c.env);

    return c.json({
      status: "success",
      message: `Sync complete: ${result.synced} entries synced, ${result.errors} errors`,
      synced: result.synced,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[SYNC] Error:", error);
    return c.json(
      {
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

/**
 * Helper to extract FULL message content, including forwarded context and quoted messages
 * Critical for handling replies like "qual o preço dessa?" referring to a previous photo/text
 */
function extractFullMessage(data: any): string {
  const msg = data.message;
  if (!msg) return "";

  let text = "";

  // 1. Base Text
  if (msg.conversation) text = msg.conversation;
  else if (msg.extendedTextMessage?.text) text = msg.extendedTextMessage?.text;
  else if (msg.imageMessage?.caption) text = msg.imageMessage?.caption;
  else if (msg.videoMessage?.caption) text = msg.videoMessage?.caption;
  else if (msg.productMessage) {
    // Handle Product Messages (Catalog)
    const prod = msg.productMessage.product;
    text = `[Interesse em Produto do Catálogo]\nTítulo: ${
      prod?.title || "Produto"
    }\nDescrição: ${prod?.description || ""}`;
  }

  // 2. Quoted Message Context
  // NOTE: messageContextInfo is used for simple text replies (conversation)
  // while extendedTextMessage.contextInfo is used for formatted text replies
  const contextInfo =
    msg.messageContextInfo ||
    msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    msg.productMessage?.contextInfo;

  // DEBUG: Log context info to investigate quoted message structure
  if (contextInfo) {
    console.log(
      `[DEBUG] contextInfo keys:`,
      Object.keys(contextInfo),
      `quotedMessage: ${contextInfo.quotedMessage ? "YES" : "NO"}`,
      `stanzaId: ${contextInfo.stanzaId || "N/A"}`
    );
  }

  if (contextInfo?.quotedMessage) {
    const quoted = contextInfo.quotedMessage;
    let quotedText =
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption ||
      "";

    // If quoted message was a BOT message (fromMe), it might contain technical text.
    // Ideally we pass it to AI so it knows what it said previously.
    if (quotedText) {
      // Clean up common bot artifacts if needed, or pass raw
      text = `${text}\n\n[SISTEMA - CONTEXTO: O usuário está respondendo à mensagem anterior:]\n"${quotedText}"`;
    }
  }

  return text || "";
}

// Evolution API Webhook Handler
app.post("/webhook/evolution", async (c) => {
  const startTime = Date.now();

  const webhookStartTime = ddTraceStart();

  try {
    const body = await c.req.json<EvolutionWebhookPayload>();

    // 🚀 EARLY EXIT: Ignore non-message events BEFORE any processing
    // This prevents timeouts from messages.update flooding
    const normalizedEvent = body.event?.toLowerCase().replace(/_/g, ".");
    if (normalizedEvent !== "messages.upsert") {
      return c.json({ status: "ignored", reason: "not a message event" });
    }

    // DATADOG: Log webhook received (only for actual messages)
    ddLog(`Webhook received: ${body.event}`, "info", {
      event: body.event,
      instance: (body as any).instance,
      fromMe: body.data?.key?.fromMe,
      sender: body.data?.key?.remoteJid,
    });
    ddMetric("webhook.received", 1, "count", [`event:${body.event}`]);

    console.log(`[WEBHOOK] Event: ${body.event}`);

    // --- Dynamic Instance Injection ---
    // Allow using 'netcar-bot' or 'test-bot' dynamically
    const instanceName = (body as any).instance;
    let env = c.env;
    if (instanceName && instanceName !== env.EVOLUTION_INSTANCE) {
      console.log(
        `[WEBHOOK] Dynamic Instance Detected: ${instanceName} (overriding ${env.EVOLUTION_INSTANCE})`
      );
      env = { ...c.env, EVOLUTION_INSTANCE: instanceName };
    }
    // ----------------------------------

    // 🛡️ COST PROTECTION: Rate Limiting
    // Block excessive requests to save costs (as requested by client)
    const rawSender = body.data?.key?.remoteJid || "unknown";
    const rateLimit = await checkWebhookLimit(c.env, rawSender);
    if (!rateLimit.allowed) {
      console.warn(`[RATE_LIMIT] Blocking request from ${rawSender}`);
      ddMetric("webhook.ratelimited", 1, "count", [`sender:${rawSender}`]);
      return rateLimitExceededResponse();
    }

    // Note: Event filtering already done by early exit above

    // Ignore messages sent by us
    if (body.data.key.fromMe) {
      return c.json({ status: "ignored", reason: "outgoing message" });
    }

    // Extract message content
    // Extract message content using robust helper
    let message = extractFullMessage(body.data);

    // IMPORTANT: If message has a preview card (link from Facebook/Instagram/OLX),
    // append the title and description to help AI understand context
    const extMsg = body.data.message?.extendedTextMessage;
    if (extMsg) {
      const previewParts: string[] = [];
      if (extMsg.title) previewParts.push(`[Link Preview: ${extMsg.title}]`);
      if (extMsg.description)
        previewParts.push(`[Descrição: ${extMsg.description}]`);
      // Canonical URL often contains the vehicle ID or slug
      if (extMsg.canonicalUrl)
        previewParts.push(`[URL: ${extMsg.canonicalUrl}]`);

      if (previewParts.length > 0) {
        // Avoid duplicating if extractFullMessage already got text
        if (!message.includes(extMsg.title || "")) {
          message = `${message}\n\n${previewParts.join("\n")}`;
        }
      }
    }

    // --- SANITIZE SENDER NAME ---
    // Prevent AI from confusing "Loja Eliane" (user name) with a competitor store
    let senderName = body.data.pushName || "Cliente";
    const commercialKeywords = [
      "Loja",
      "Veiculos",
      "Veículos",
      "Multimarcas",
      "Motors",
      "Auto",
      "Automoveis",
      "Automóveis",
      "Carros",
      "Vendas",
    ];
    const isCommercialName = commercialKeywords.some((keyword) =>
      senderName.toLowerCase().includes(keyword.toLowerCase())
    );

    if (isCommercialName) {
      console.log(
        `[WEBHOOK] 🛡️ Sanitizing commercial sender name: "${senderName}" -> "Cliente"`
      );
      // Update senderName locally for processing.
      // Note: We might still save original logic in CRM if needed, but for AI interaction we use "Cliente"
      senderName = "Cliente";
    }

    // 🔴 GLOBAL BOT SWITCH CHECK (User Request: "Switch auto/manual")
    if (message) {
      try {
        const db = new DBService(c.env.DB);
        const botEnabledStr = await db.getConfig("bot_enabled");
        // If Explicitly 'false', we STOP. Default to true if missing.
        if (botEnabledStr === "false") {
          const tempSender = body.data.key.remoteJid;
          const tempSenderName = body.data.pushName || "Cliente";
          console.log(
            `[WEBHOOK] Bot is DISABLED via Global Switch. Ignoring message from ${tempSender}.`
          );

          // Still save inbound message to CRM so human can see it!
          await upsertLead(tempSender, tempSenderName, message, c.env);
          await crmSaveMessage(tempSender, message, "inbound", c.env);

          return c.json({ status: "ignored", reason: "bot_disabled" });
        }
      } catch (e) {
        console.error("[WEBHOOK] Failed to check bot_enabled status", e);
      }
    }

    // ℹ️ AI is available 24/7 - business hours check moved to follow-up scheduling only

    // Extract message ID (key.id) for media fetching and deduplication
    const messageId = body.data.key.id;

    // DEDUPLICATION: Check if we already processed this message (prevent duplicate responses)
    if (PROCESSED_MESSAGES.has(messageId)) {
      console.log(
        `[WEBHOOK] ⚠️ Duplicate message detected (${messageId}) - IGNORING`
      );
      return c.json({ status: "ignored", reason: "duplicate_message" });
    }
    // Mark message as processed
    PROCESSED_MESSAGES.set(messageId, Date.now());
    // Cleanup old entries to prevent memory leak
    if (PROCESSED_MESSAGES.size > 1000) {
      cleanupProcessedMessages();
    }

    let imageUrl: string | undefined = undefined;

    // Handle Audio Message - Transcribe with Whisper
    if (body.data.message?.audioMessage) {
      console.log(
        `[WEBHOOK] Receiving Audio Message from ${body.data.pushName || "User"}`
      );

      const audioMsg = body.data.message.audioMessage;
      let audioBase64 = "";

      // 1. Get Audio Data (Base64)
      if (audioMsg.base64) {
        audioBase64 = audioMsg.base64;
      } else if (audioMsg.url) {
        // Fetch with auth and messageId
        const fetched = await fetchMedia(audioMsg.url, env, body.data.key);
        if (fetched) audioBase64 = fetched;
      }

      if (audioBase64) {
        try {
          // Notify user we are listening
          await sendPresence(body.data.key.remoteJid, "recording", 10000, env);

          const transcript = await transcribeAudio(
            audioBase64,
            env,
            audioMsg.mimetype
          );

          if (transcript) {
            message = transcript;
            console.log(`[WEBHOOK] 🎙️ Audio Transcribed: "${transcript}"`);
            // NOTE: Removed "[Transcrição de Áudio]" tag - it was confusing GPT
            // into thinking user was TALKING about audio instead of processing the content
          } else {
            return c.json({ status: "ignored", reason: "empty_transcription" });
          }
        } catch (e) {
          console.error("[WEBHOOK] Transcription failed:", e);
          await sendMessage(
            body.data.key.remoteJid,
            "Não consegui ouvir o áudio. Pode escrever?",
            env
          );
          return c.json({ status: "error", reason: "transcription_failed" });
        }
      } else {
        return c.json({ status: "ignored", reason: "no_audio_content" });
      }
    }

    // Handle Image Message
    if (body.data.message?.imageMessage) {
      console.log(
        `[WEBHOOK] Receiving Image Message from ${body.data.pushName || "User"}`
      );
      const img = body.data.message.imageMessage;

      // Use caption as message if available, otherwise context-aware prompt
      // for cars: the user might be sending a car they want to TRADE-IN (sell/exchange)
      // or a screenshot of an ad they're interested in BUYING
      message =
        img.caption ||
        "[IMAGEM DE VEÍCULO RECEBIDA] O cliente enviou uma foto de carro. Primeiro, IDENTIFIQUE a MARCA e MODELO do carro na imagem (ex: 'Vi que é um Chevrolet Cruze'). Depois pergunte se é um carro que ele TEM para dar na TROCA ou se é um anúncio de carro que ele quer COMPRAR.";

      let rawBase64 = "";
      let mimetype = img.mimetype || "image/jpeg";

      if (img.base64) {
        rawBase64 = img.base64;
      } else if (img.url) {
        // Fetch with auth and messageId
        const fetchedB64 = await fetchMedia(img.url, env, body.data.key);
        if (fetchedB64) {
          rawBase64 = fetchedB64;
        } else {
          console.warn(
            "[WEBHOOK] Failed to resolve image URL, proceeding without image"
          );
        }
      }

      if (rawBase64) {
        // Clean the base64 string
        // 1. Remove any existing data:image/...;base64, prefix (Generic regex)
        const cleanB64 = rawBase64
          .replace(/^data:.*?;base64,/, "")
          .replace(/\s/g, "");

        // 2. Validate length (min 100 chars to be valid image data)
        if (cleanB64.length < 100) {
          console.error(
            `[WEBHOOK] Base64 too short (${cleanB64.length} chars). Ignoring image.`
          );
          message += " (Erro: Imagem corrompida ou muito pequena)";
        } else {
          // 3. Reconstruct valid data URI
          imageUrl = `data:${mimetype};base64,${cleanB64}`;
          console.log(
            `[WEBHOOK] Image processed successfully (Length: ${cleanB64.length}, Mime: ${mimetype})`
          );
        }
      } else {
        console.warn(
          "[WEBHOOK] Image handling failed: No base64 data obtained."
        );
        // Change prompt to inform AI that image failed
        message +=
          " [SISTEMA: O usuário enviou uma imagem, mas ocorreu um erro técnico ao baixá-la. Peça gentilmente para ele descrever o carro ou reenviar a foto.]";
      }
    }

    // Handle Quoted Image Message (Reply to an image)
    // When user replies to a car image with "Tem esse?" or "Tem outro deste?"
    // we need to extract the quoted image for Vision analysis
    if (!imageUrl) {
      const msgData = body.data.message as any;
      const contextInfo = 
        msgData?.extendedTextMessage?.contextInfo ||
        msgData?.contextInfo ||
        (body.data as any).contextInfo;
      
      if (contextInfo?.quotedMessage?.imageMessage) {
        console.log(`[WEBHOOK] Quoted Image detected - extracting for Vision analysis`);
        const quotedImg = contextInfo.quotedMessage.imageMessage;
        
        let quotedBase64 = "";
        const mimetype = quotedImg.mimetype || "image/jpeg";
        
        // Try to get base64 from quoted image
        if (quotedImg.base64) {
          quotedBase64 = quotedImg.base64;
        } else if (quotedImg.url) {
          // Fetch the quoted image
          const fetchedB64 = await fetchMedia(quotedImg.url, env, {
            ...body.data.key,
            id: contextInfo.stanzaId || body.data.key.id
          });
          if (fetchedB64) {
            quotedBase64 = fetchedB64;
          }
        }
        
        if (quotedBase64) {
          const cleanB64 = quotedBase64
            .replace(/^data:.*?;base64,/, "")
            .replace(/\s/g, "");
          
          if (cleanB64.length > 100) {
            imageUrl = `data:${mimetype};base64,${cleanB64}`;
            console.log(`[WEBHOOK] ✅ Quoted image extracted successfully (${cleanB64.length} chars)`);
            
            // Add context to message about what user is asking about the quoted image
            const quotedCaption = quotedImg.caption || "";
            if (quotedCaption) {
              message += `\n\n[SISTEMA - CONTEXTO: O usuário está respondendo à uma imagem anterior com legenda: "${quotedCaption}"]`;
            } else {
              message += `\n\n[SISTEMA - CONTEXTO: O usuário está perguntando sobre a imagem de carro marcada. Use a Vision API para analisar.]`;
            }
          }
        } else {
          console.warn(`[WEBHOOK] Could not extract quoted image data`);
        }
      }
    }

    if (!message) {
      return c.json({ status: "ignored", reason: "empty message" });
    }

    let sender = body.data.key.remoteJid;
    // senderName defined/sanitized above
    let isGroup = false; // Track if message is from a group

    // RESOLVE @lid (Linked Device ID) to real phone number
    // Based on Evolution API v2.3.6+ and community recommendations:
    // Priority order:
    // 1. remoteJidAlternativo (Evolution v2.3.6+ - best source)
    // 2. senderPn (phone number when available)
    // 3. remoteJidAlt (older versions)
    // 4. participant (groups)
    // 5. LID directly (last resort - Evolution accepts sending to @lid)
    // NOTE: LID cannot be programmatically converted to phone - only use what webhook provides
    const getRealSender = (msg: EvolutionWebhookPayload["data"]): string => {
      const remoteJid = msg.key.remoteJid;

      // 1. TOP PRIORITY: remoteJidAlternativo (Evolution v2.3.6+)
      // This is the BEST source - contains real phone when remoteJid is @lid
      if (
        msg.key.remoteJidAlternativo &&
        !msg.key.remoteJidAlternativo.endsWith("@lid")
      ) {
        console.log(
          `[WEBHOOK] ✅ remoteJidAlternativo available: ${msg.key.remoteJidAlternativo} (remoteJid was: ${remoteJid})`
        );
        return msg.key.remoteJidAlternativo;
      }

      // 2. HIGH PRIORITY: senderPn (phone number field)
      if (msg.senderPn) {
        const realPhone = msg.senderPn.includes("@")
          ? msg.senderPn
          : `${msg.senderPn}@s.whatsapp.net`;
        console.log(
          `[WEBHOOK] ✅ senderPn available: ${realPhone} (remoteJid was: ${remoteJid})`
        );
        return realPhone;
      }

      // 3. If remoteJid is already a phone number (@s.whatsapp.net), use it
      if (remoteJid.endsWith("@s.whatsapp.net")) {
        return remoteJid;
      }

      // 4. Handle @lid (Linked Device ID) - try alternate sources
      if (remoteJid.endsWith("@lid")) {
        // Try remoteJidAlt (older fallback)
        if (msg.key.remoteJidAlt && !msg.key.remoteJidAlt.endsWith("@lid")) {
          console.log(
            `[WEBHOOK] @lid detected - Using remoteJidAlt: ${msg.key.remoteJidAlt}`
          );
          return msg.key.remoteJidAlt;
        }

        // Try participant (for groups)
        if (msg.key.participant && !msg.key.participant.endsWith("@lid")) {
          console.log(
            `[WEBHOOK] @lid detected - Using participant: ${msg.key.participant}`
          );
          return msg.key.participant;
        }

        // No alternative available - use LID directly
        // Evolution API accepts sending to @lid in v2.x versions
        const clientName = msg.pushName || "Unknown";
        console.log(
          `[WEBHOOK] 📩 LID não resolvido: ${remoteJid} (${clientName}) - Usando LID diretamente`
        );
        ddLog(`[WEBHOOK] LID sem resolução: ${remoteJid}`, "info", {
          key: msg.key,
          pushName: clientName,
          hasSenderPn: !!msg.senderPn,
          hasRemoteJidAlternativo: !!msg.key.remoteJidAlternativo,
          source: "lid_fallback",
        });

        return remoteJid;
      }

      // 5. Fallback for any other case (groups, status, etc)
      return remoteJid;
    };

    // Add detailed logging after getRealSender
    console.log(
      `[WEBHOOK] getRealSender input msg.key: ${JSON.stringify(body.data.key)}`
    );
    console.log(
      `[WEBHOOK] getRealSender input msg (full): ${JSON.stringify(body.data)}`
    );
    sender = getRealSender(body.data);

    // AUTO-SAVE LID MAPPING: If original was @lid and we resolved to a real number, save the mapping
    const originalJid = body.data.key.remoteJid;
    if (originalJid.endsWith("@lid") && !sender.endsWith("@lid")) {
      try {
        const db = new DBService(c.env.DB);
        await db.saveLidMapping(originalJid, sender);
        console.log(
          `[WEBHOOK] 💾 Saved LID mapping: ${originalJid} -> ${sender}`
        );
      } catch (mapErr) {
        console.warn("[WEBHOOK] Failed to save LID mapping:", mapErr);
      }
    }

    // PROCESSAR LIDs NÃO RESOLVIDOS (antes era bloqueado)
    // Leads do Facebook/Instagram vêm com @lid e DEVEM ser atendidos!
    // A Evolution API aceita envio de mensagem diretamente para @lid
    let isLidSender = false;
    if (sender.includes("@lid")) {
      isLidSender = true;
      console.log(
        `[WEBHOOK] 📩 Processando LID: ${sender} (${senderName}) - Respondendo pelo próprio LID`
      );
      ddLog(`[WEBHOOK] Processando LID sem resolução: ${sender}`, "info", {
        sender,
        name: senderName,
      });
    }

    // COMPLETELY IGNORE GROUP MESSAGES
    // Bot should NOT process messages from groups AT ALL (no private responses either!)
    if (sender.endsWith("@g.us")) {
      console.log(
        `[WEBHOOK] Group message detected (${sender}) - IGNORING completely`
      );
      return c.json({ status: "ignored", reason: "group_message" });
    }

    // --- RATE LIMITING ---
    const now = Date.now();
    const limitData = RATE_LIMIT_MAP.get(sender) || { count: 0, start: now };

    // Reset window every 60s
    if (now - limitData.start > 60000) {
      limitData.count = 0;
      limitData.start = now;
    }

    limitData.count++;
    RATE_LIMIT_MAP.set(sender, limitData);

    if (limitData.count > 20) {
      console.warn(
        `[RATE_LIMIT] Blocking ${sender} (Count: ${limitData.count})`
      );
      return c.json({ status: "ignored", reason: "rate_limit_exceeded" }, 429);
    }
    // ---------------------
    // Extract Sender ID (Handling Groups)
    // ---------------------
    // (Logic moved to top of function to fix scope issues)

    console.log(
      `[WEBHOOK] Message from ${senderName} (${sender}): ${message.substring(
        0,
        50
      )}...`
    );

    // Validate sender phone number format (allow international)
    const senderDigits = sender.replace(/\D/g, "");
    if (senderDigits.length < 10 || senderDigits.length > 15) {
      console.warn(
        `[WEBHOOK] ⚠️ Ignoring invalid sender: ${sender} (${senderDigits.length} digits)`
      );
      return c.json({ status: "ignored", reason: "invalid_sender_format" });
    }

    // CRM: Create or update lead (GUARANTEE ALL CONTACTS REGISTERED)
    // Detect car interest early for CRM
    let carIntent;
    try {
      if (typeof detectCarIntent === 'function') {
        carIntent = detectCarIntent(message);
      } else {
        console.error('[CRITICAL] detectCarIntent is not a function/defined:', detectCarIntent);
      }
    } catch (e) {
      console.error('[CRITICAL] Error calling detectCarIntent:', e);
    }
    
    // SPAM FILTER: Detect promotional/spam messages BEFORE creating lead
    if (isSpamMessage(message)) {
      console.log(`[WEBHOOK] 🚫 Spam/promotional message detected - NOT creating lead for ${sender}`);
      // Save message for history but don't process further
      await crmSaveMessage(sender, message, "inbound", env);
      return c.json({ status: "ignored", reason: "spam_detected" });
    }
    
    await upsertLead(sender, senderName, message, env, carIntent?.modelo);

    // Check blocklist AFTER registration (but before processing AI)
    console.log(`[BLOCKLIST] Checking sender: ${sender}`);
    const blocked = await isBlocklisted(sender, env);
    if (blocked) {
      console.log(`[WEBHOOK] ⏸️ Ignoring blocklisted number: ${sender}`);
      // Save inbound message even if blocked, for history
      await crmSaveMessage(sender, message, "inbound", env);
      return c.json({ status: "ignored", reason: "blocklisted" });
    }

    // CRM: Save inbound message
    await crmSaveMessage(sender, message, "inbound", env);

    // 🛑 CONCURRENCY CONTROL (DEBOUNCE / "PAUSA INTELIGENTE")
    // Removed old KV-based debounce to prevent conflicts with debounce.service
    // The new service handles aggregation and locking efficiently.

    // NOTE: Typing indicator moved to processMessage/generateAIResponse
    // to avoid duplicate animations (was causing double "typing" on client)

    // Process with AI (Serialized to prevent race conditions)
    // processMessage is now wrapped in the user's queue
    // DEBOUNCE: Wait 2 seconds before processing to allow multiple messages
    await enqueueMessageProcessing(sender, async () => {
      const {
        bufferMessage,
        shouldProcessNow,
        getBufferedMessages,
        getDebounceDelay,
        releaseProcessingLock,
      } = await import("@legacy/debounce.service");

      // Buffer this message
      const isFirstMessage = await bufferMessage(
        sender,
        message,
        messageId,
        env,
        !!imageUrl,
        imageUrl
      );

      // Wait for debounce delay (allows more messages to arrive)
      if (isFirstMessage) {
        await new Promise((resolve) => setTimeout(resolve, getDebounceDelay()));
      }

      // Check if we should process now or wait more
      if (!(await shouldProcessNow(sender, env))) {
        // More messages arriving, wait a bit more
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Get all buffered messages (also acquires a lock)
      const buffered = await getBufferedMessages(sender, env);

      if (buffered) {
        try {
          // Process combined message
          console.log(
            `[DEBOUNCE] Processing ${buffered.messageIds.length} aggregated messages`
          );

          // NOTE: Typing indicator is now in generateAIResponse/executeCarSearch
          // to avoid duplicate animations

          await processMessage(
            buffered.combinedText,
            sender,
            senderName,
            env,
            buffered.imageUrl,
            isGroup
          );
        } finally {
          // Always release lock after processing
          await releaseProcessingLock(sender, env);
        }
      } else {
        // buffered is null - either no messages or another worker is already processing
        // Just skip, don't do fallback processing (that causes duplicates)
        console.log(
          `[DEBOUNCE] Skipping - buffer is empty or locked by another worker`
        );
      }
    });

    const duration = Date.now() - startTime;
    console.log(`[WEBHOOK] Processed in ${duration}ms`);

    // DATADOG: Track successful processing
    ddWebhookProcessed(sender, duration, true);
    ddTraceEnd(webhookStartTime, "webhook", true);

    // [LATENCY_ALERT] - Threshold 30s for GPT + car search + multiple messages
    if (duration > 30000) {
      console.warn(
        `[LATENCY_ALERT] Processing took ${duration}ms (>30s) for ${sender}`
      );
      ddLog(`Latency alert: ${duration}ms`, "warn", { duration, sender });
      c.executionCtx.waitUntil(
        logWarning(
          `[LATENCY_ALERT] Slow Request: ${duration}ms`,
          "worker",
          env,
          { duration, sender }
        )
      );
    }

    // DATADOG: Flush all logs at end of request
    c.executionCtx.waitUntil(ddFlush());

    return c.json({
      status: "processed",
      duration: `${duration}ms`,
    });
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);

    // DATADOG: Track error
    ddError(error instanceof Error ? error : new Error(String(error)), {
      endpoint: "/webhook/evolution",
    });
    ddTraceEnd(webhookStartTime, "webhook", false);
    c.executionCtx.waitUntil(ddFlush());

    // Log error to Supabase
    await logException(error, "worker", undefined, c.env, {
      endpoint: "/webhook/evolution",
    });

    return c.json({ status: "error", message: String(error) }, 500);
  }
});

/**
 * Process incoming message with AI
 */
async function processMessage(
  message: string,
  sender: string,
  senderName: string,
  env: Env,
  imageUrl?: string, // Optional image for Vision
  isGroup: boolean = false // Flag indicating if message is from a group
): Promise<void> {
  // Process incoming message

  // 0. BLOCKLIST CHECK (Strict - Flowchart Requirement)
  // Check this FIRST to ensure blocked users get NO response/action.
  const isBlocked = await isBlocklisted(sender, env);
  if (isBlocked) {
    console.log(`[BLOCKLIST] Blocking message from ${sender}`);
    return;
  }

  // 0.2. RESET COMMAND CHECK (debug feature)
  const cleanLowerMsg = message.toLowerCase().trim();
  const resetResult = checkResetCommand(cleanLowerMsg);
  if (!resetResult.continue && resetResult.response === '__RESET_CONTEXT__') {
    console.log(`[DEBUG] Reset command detected for ${sender}`);
    // Execute full context reset
    await env.NETCAR_CACHE.delete(`context:${sender}`);
    await env.NETCAR_CACHE.delete(`history:${sender}`);
    await env.NETCAR_CACHE.delete(`handoff:${sender}`);
    await env.NETCAR_CACHE.delete(`shown_cars:${sender}`);
    // Reset lead status in D1 (if exists)
    try {
      await env.DB.prepare("UPDATE leads SET stage = 'novo', last_interaction = datetime('now') WHERE phone = ?").bind(sender).run();
    } catch (e) {
      // Ignore if lead doesn't exist
    }
    // Send debug response
    const resetMessage = `🔧 *DEBUG: Contexto Resetado*
✅ Histórico de contexto limpo
✅ Handoff resetado
✅ Carros mostrados zerados
✅ Lead voltou ao status "novo"

Agora você pode testar como se fosse a primeira conversa.
Digite qualquer coisa para começar!`;
    await sendMessage(sender, resetMessage, env);
    return;
  }

  // 0.5. NATIVE GREETING DETECTION: Check if WhatsApp Business native greeting was just sent
  // This prevents duplicate greetings when using both native auto-response + iAN bot
  const nativeGreetingDetected = await wasNativeGreetingSentRecently(
    sender,
    env
  );

  // 1. Cancel any pending follow-up (user responded)
  await cancelFollowup(sender, env);

  // VISION API HANDLING
  if (imageUrl) {
    console.log(`[VISION] Analyzing image sent by ${sender}...`);
    try {
       const visionContent = [
          { type: "text", text: "Identifique a MARCA, MODELO, ANO (aproximado) e COR deste carro. Seja conciso. Exemplo: 'Chevrolet Cruze Branco 2020'." },
          { type: "image_url", image_url: { url: imageUrl } }
       ];
       const visionResponse = await callOpenAI(
         [{ role: "user", content: visionContent as any }], 
         env
       );
       const visionText = visionResponse?.choices?.[0]?.message?.content || "";
       
       if (visionText) {
          console.log(`[VISION] Identification: ${visionText}`);
          message += `\n[SISTEMA: O usuário enviou uma imagem. Análise visual da IA: ${visionText}]`;
       }
    } catch (err) {
       console.error(`[VISION] Error analyzing image:`, err);
       message += `\n[SISTEMA: O usuário enviou uma imagem, mas houve erro na análise visual.]`;
    }
  }


  // Prepare lowercase message for comparisons - SINGLE DECLARATION
  const lowerMsg = message.toLowerCase();
  const cleanMessage = lowerMsg
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // ============================================================
  // MEMORY LANE: Check for pending image cars (Vision identified but not searched)
  // ============================================================
  const pendingImageCars = await getPendingImageCars(sender, env);
  if (pendingImageCars.length > 0) {
    console.log(
      `[CONTEXT] Found ${
        pendingImageCars.length
      } pending image cars: ${pendingImageCars.map((c) => c.modelo).join(", ")}`
    );

    // Check if user is confirming interest (e.g., "sim", "quero ver", "busca", "faça isso")
    const confirmPatterns = [
      "sim",
      "quero",
      "busca",
      "buscar",
      "procura",
      "mostra",
      "ver",
      "faça",
      "faz isso",
      "ok",
      "beleza",
      "pode ser",
      "manda",
      "show",
      "bora",
      "vamos",
      "dale",
    ];

    const isConfirming = confirmPatterns.some((p) => lowerMsg.includes(p));

    if (isConfirming) {
      console.log(
        `[CONTEXT] User confirmed interest in image cars - auto-searching`
      );

      // Mark pending actions as consumed
      await consumePendingActions(sender, "search", env);

      // Search for each identified car model
      for (const car of pendingImageCars) {
        const searchFilters = { modelo: car.modelo, marca: car.marca };
        console.log(
          `[CONTEXT] Auto-searching for image car: ${car.marca || ""} ${
            car.modelo
          }`
        );

        try {
          await executeCarSearch(searchFilters, sender, env);
        } catch (e) {
          console.error(`[CONTEXT] Auto-search failed for ${car.modelo}:`, e);
        }
      }

      // Clear pending image cars (they were searched)
      await updateContext(sender, { carsFromImages: [] }, env);
      return;
    }
  }

  // ============================================================
  // CHECK FOR PENDING SEARCH ACTIONS (User confirmed with "Sim")
  // Bot asked "Você quer ver Corolla?" and user said "Sim"
  // ============================================================
  const pendingSearches = await getPendingActions(sender, "search", env);
  if (pendingSearches.length > 0) {
    const confirmPatterns = [
      "sim",
      "quero",
      "busca",
      "buscar",
      "procura",
      "mostra",
      "ver",
      "faça",
      "faz isso",
      "ok",
      "beleza",
      "pode ser",
      "manda",
      "show",
      "bora",
      "vamos",
      "dale",
      "isso",
      "esse",
    ];

    const isConfirming =
      confirmPatterns.some((p) => lowerMsg.includes(p)) && lowerMsg.length < 50;

    if (isConfirming) {
      console.log(
        `[CONTEXT] User confirmed pending search - executing ${pendingSearches.length} searches`
      );

      // Execute each pending search
      for (const action of pendingSearches) {
        const searchFilters = action.params.filters || {
          modelo: action.params.modelo,
          marca: action.params.marca,
        };
        console.log(
          `[CONTEXT] Auto-executing pending search: ${JSON.stringify(
            searchFilters
          )}`
        );

        try {
          await executeCarSearch(searchFilters, sender, env);
        } catch (e) {
          console.error(`[CONTEXT] Pending search failed:`, e);
        }
      }

      // Mark searches as consumed
      await consumePendingActions(sender, "search", env);
      return;
    }
  }

  // First check if user is asking for more cars from previous search
  if (isAskingForMore(message)) {
    if (await hasMoreCars(sender, env)) {
      const remaining = await getRemainingCount(sender, env);
      const batch = await getNextCarBatch(sender, 6, env);

      if (batch && batch.length > 0) {
        await sendMessage(sender, `Aqui vão mais ${batch.length} opções:`, env);

        for (const car of batch) {
          await sendCarCard(sender, car, env);
        }

        const stillRemaining = await getRemainingCount(sender, env);
        if (stillRemaining > 0) {
          await sendMessage(
            sender,
            `Tenho mais ${stillRemaining} opções. Quer ver mais?`,
            env
          );
        } else {
          await sendButtons(
            sender,
            "Essas foram todas as opções que encontrei!",
            [
              { id: "falar_vendedor", label: "Falar com Vendedor" },
              { id: "nova_busca", label: "Nova Busca" },
            ],
            env
          );
          // Also send text to be sure
          await sendMessage(sender, "Alguma delas te interessou?", env);
        }
        await scheduleFollowup(sender, env, 15, "handoff_15m"); // Schedule 15m handoff timer for pagination
        return;
      }
    } else {
      // Session empty but user asking for more - let AI handle naturally
      // REMOVED: Robotic menu trigger that was confusing customers
      console.log(
        `[PROCESS] User asked for more, but session empty/finished. Letting AI respond.`
      );
      // Don't return here - let the message flow to AI processing
    }
  }

  // ============================================================
  // NUMERIC MENU RESPONSE HANDLER (MUST RUN BEFORE GIBBERISH)
  // When sendButtons creates text menus like "1. Falar com Vendedor",
  // users respond with just "1" or "2". Handle those here.
  // ============================================================
  if (cleanMessage === "1") {
    console.log(
      '[PROCESS] User responded with "1" - assuming "Falar com Vendedor"'
    );
    await handleSellerHandover(sender, env);
    return;
  }

  if (cleanMessage === "2") {
    console.log('[PROCESS] User responded with "2" - assuming "Nova Busca"');
    await sendMessage(
      sender,
      "Claro! O que você está procurando? Me conta o modelo, marca ou faixa de preço.",
      env
    );
    return;
  }

  // ============================================================
  // SPAM/GIBBERISH DETECTION (YAML v1.1)
  // Max 2 attempts for unintelligible messages, then silence
  // ============================================================
  const isGibberish = (msg: string): boolean => {
    const clean = msg.replace(/[^\w\s]/g, "").trim();
    // Too short or only special chars
    if (clean.length < 2) return true;
    // Random keyboard mashing (consonants only, no vowels)
    if (clean.length > 3 && !/[aeiouáéíóúãõâêô]/i.test(clean)) return true;
    // Repeated single char
    if (/^(.)\1{3,}$/.test(clean)) return true;
    return false;
  };

  if (isGibberish(message) && message.length < 50) {
    const now = Date.now();
    let spamData = SPAM_ATTEMPT_COUNT.get(sender) || {
      count: 0,
      lastReset: now,
    };

    // Reset if window expired
    if (now - spamData.lastReset > SPAM_RESET_WINDOW) {
      spamData = { count: 0, lastReset: now };
    }

    spamData.count++;
    SPAM_ATTEMPT_COUNT.set(sender, spamData);

    if (spamData.count === 1) {
      await sendMessage(
        sender,
        "Não entendi muito bem. Você está buscando algum carro específico ou quer ver opções por faixa de preço?",
        env
      );
      return;
    } else if (spamData.count === 2) {
      await sendMessage(
        sender,
        "Acho que estamos com algum problema na comunicação. Se precisar de algo, é só me chamar. Continuo por aqui. Qual carro você procura?",
        env
      );
      return;
    } else {
      // After 2 attempts: silence
      console.log(
        `[SPAM] User ${sender} exceeded gibberish limit (${spamData.count}) - IGNORING`
      );
      return;
    }
  } else {
    // Reset spam count on valid message
    SPAM_ATTEMPT_COUNT.delete(sender);
  }

  // ============================================================
  // ROUTER v4: Deterministic Policy Engine (full_bot_prompt_v4.md)
  // Executes BEFORE LLM to decide action. LLM cannot override.
  // ============================================================
  const ctx = await getContext(sender, env, false);
  const routerState = createInitialState(sender, ctx.leadId);
  // CRITICAL FIX: Load slots from ctx.qualification to persist between turns
  // Without this, slots would be lost and bot would ask same questions repeatedly
  const updatedState = updateStateFromContext(routerState, {
    city: ctx.qualification?.cityOrRegion,
    budget: ctx.qualification?.budgetMax,
    category: ctx.qualification?.category,
    make: ctx.qualification?.make,
    model: ctx.qualification?.model,
    handoff: ctx.sellerHandoff?.done ? { mode: 'HUMAN' } : undefined,
    carsShown: ctx.carsShown || [],
  });
  
  // ============================================================
  // PRIORITY CHECK: HUMAN REQUEST (before router)
  // Regra B do prompt: PEDIU HUMANO → ENCAMINHAR_VENDEDOR imediatamente
  // ============================================================
  if (detectHumanRequest(message)) {
    console.log('[HANDOFF] 🔥 Cliente pediu vendedor! Fazendo handoff imediato.');
    try {
      // Mark handoff in context
      await updateContext(sender, {
        sellerHandoff: { done: true, at: new Date().toISOString() },
        currentIntent: 'handoff',
      }, env);
      
      // Call handleSellerHandover to:
      // 1. Assign seller via Round Robin
      // 2. Send seller VCard with image
      await handleSellerHandover(sender, env);
      return new Response('OK - HANDOFF');
    } catch (handoffError) {
      console.error('[HANDOFF] Error in handleSellerHandover:', handoffError);
      // Fallback: Send generic message if handover fails
      await sendMessage(sender, 'Estou encaminhando você para um dos nossos consultores. Em instantes ele entrará em contato!', env);
      return new Response('OK - HANDOFF FALLBACK');
    }
  }
  // ============================================================
  
  const routerResult = routeMessage(message, updatedState, env);
  logRouterDecision(routerResult, message);
  
  // ROUTER PRIORITY 0: ASK_ONE_QUESTION - Force slot collection before anything else
  // BUT: If message contains a CAR MODEL (via link preview, etc), SEARCH STOCK FIRST
  if (routerResult.action === 'ASK_ONE_QUESTION' && routerResult.missing_slot) {
    // CHECK: Does the message contain a car model OR optional filter? If so, search stock FIRST
    const carIntent = detectCarIntent(message);
    // FIXED: Include opcional as valid filter for immediate search (e.g., "teto panorâmico")
    const hasCarFilters = !!(carIntent && (carIntent.modelo || carIntent.marca || carIntent.opcional || carIntent.categoria));
    
    if (hasCarFilters) {
      const filterDesc = carIntent.modelo || carIntent.marca || carIntent.opcional || carIntent.categoria;
      console.log(`[ROUTER] ⚡ Car filter detected: ${filterDesc}. SEARCHING STOCK FIRST before conversation.`);
      
      // SEARCH STOCK FIRST - this is the new priority
      try {
        const searchParams: Record<string, string | number> = {};
        if (carIntent.modelo) searchParams.modelo = carIntent.modelo;
        if (carIntent.marca) searchParams.marca = carIntent.marca;
        if (carIntent.precoMax) searchParams.preco_max = carIntent.precoMax;
        if (carIntent.precoMin) searchParams.preco_min = carIntent.precoMin;
        if (carIntent.opcional) searchParams.opcional = carIntent.opcional;
        if (carIntent.categoria) searchParams.categoria = carIntent.categoria;
        if (carIntent.cor) searchParams.cor = carIntent.cor;
        if (carIntent.transmissao) searchParams.cambio = carIntent.transmissao;
        
        const cars = await searchCars(searchParams, env);
        console.log(`[ROUTER] Stock search result: ${cars.length} cars found for ${filterDesc}`);
        
        if (cars.length > 0) {
          // We have the car! Show it and offer to connect with seller
          // UPDATED: Use formatCarCards for individual link previews with images
          // Pass searched optionals to display what customer asked for
          const cardMessages = formatCarCards(cars, 6, carIntent.opcional);
          
          // Send cars directly with a smart intro
          // FIXED: Use filterDesc for optional/category searches
          const searchDesc = filterDesc || 'carros';
          const intro = cars.length === 1 
            ? `Opa! Achei exatamente o que você procura no estoque! 🚗`
            : `Show! Tenho ${cars.length} opções com ${searchDesc} disponíveis! Olha só as melhores:`;
          
          await sendMessage(sender, intro, env);
          
          // Send each car as separate message for link preview
          for (const cardMsg of cardMessages) {
            await sendMessage(sender, cardMsg, env);
          }
          
          // RULE: Bot doesn't negotiate - connect to seller for pricing
          const handoffMsg = "Gostou de algum? Posso te conectar com um consultor agora pra te passar os valores e melhores condições! 🤝";
          await sendMessage(sender, handoffMsg, env);
          return;
        } else {
          // No stock - inform and offer alternatives
          const searchDesc = filterDesc || 'veículos';
          console.log(`[ROUTER] No stock for ${searchDesc}. Informing customer.`);
          const noStockMsg = `Poxa, no momento não temos veículos com ${searchDesc} no estoque. 😔 Quer que eu te mostre outras opções?`;
          await sendMessage(sender, noStockMsg, env);
          return;
        }
      } catch (error) {
        console.error(`[ROUTER] Error searching stock:`, error);
        // Fall through to normal flow on error
      }
    } else {
      // ANTI-REPETITION FIX: Check if slot was already asked
      const askedSlots = await getAskedSlots(sender, env);
      const alreadyAsked = askedSlots.includes(routerResult.missing_slot);
      
      if (alreadyAsked) {
        console.log(`[ROUTER] ANTI-REP: Slot ${routerResult.missing_slot} already asked, skipping to LLM`);
        // Don't ask again - fall through to LLM processing below
      } else {
        console.log(`[ROUTER] ASK_ONE_QUESTION - forcing collection of: ${routerResult.missing_slot}`);
        // Mark this slot as asked to prevent future repetition
        await markSlotAsAsked(sender, routerResult.missing_slot, env);
    
      // CRITICAL FIX: Persist slots extracted by router BEFORE returning
      if (routerResult.state_update) {
        const qualificationUpdate: Record<string, string | number | undefined> = {};
        const stateUpdate = routerResult.state_update as Record<string, unknown>;
        
        // Extract slots from router's state update
        if (stateUpdate.slots && typeof stateUpdate.slots === 'object') {
          const slots = stateUpdate.slots as Record<string, string | number | undefined>;
          if (slots.city_or_region) qualificationUpdate.cityOrRegion = slots.city_or_region as string;
          if (slots.budget_max) qualificationUpdate.budgetMax = slots.budget_max as number;
          if (slots.category) qualificationUpdate.category = slots.category as string;
          if (slots.make) qualificationUpdate.make = slots.make as string;
          if (slots.model) qualificationUpdate.model = slots.model as string;
        }
        
        // Also check direct state_update properties from router
        if (stateUpdate.city) qualificationUpdate.cityOrRegion = stateUpdate.city as string;
        if (stateUpdate.budgetMax || stateUpdate.budget_max) {
          qualificationUpdate.budgetMax = (stateUpdate.budgetMax || stateUpdate.budget_max) as number;
        }
        if (stateUpdate.category) qualificationUpdate.category = stateUpdate.category as string;
        if (stateUpdate.make) qualificationUpdate.make = stateUpdate.make as string;
        if (stateUpdate.model) qualificationUpdate.model = stateUpdate.model as string;
        
        if (Object.keys(qualificationUpdate).length > 0) {
          console.log(`[ROUTER] Persisting extracted slots:`, JSON.stringify(qualificationUpdate));
          // Update qualification within context
          await updateContext(sender, { 
            qualification: { 
              ...ctx.qualification, 
              ...qualificationUpdate 
            } 
          }, env);
        }
      }
      
      // Detect if user sent a greeting
      const normalizedMsg = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const hasGreeting = /^(oi|ola|bom dia|boa tarde|boa noite|oi!|ola!|e ai|eai|hey|hello)/i.test(normalizedMsg.trim());
      const hasInterest = /(interesse|interessado|interessada|queria|quero|gostaria|informac)/i.test(normalizedMsg);
      
      // Build greeting prefix based on time of day (Brazil timezone)
      let greetingPrefix = '';
      if (hasGreeting || hasInterest) {
        // FIX: Use Brazil timezone instead of UTC
        const brazilTime = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
        const hour = parseInt(brazilTime, 10);
        if (hour >= 5 && hour < 12) {
          greetingPrefix = 'Bom dia! ';
        } else if (hour >= 12 && hour < 18) {
          greetingPrefix = 'Boa tarde! ';
        } else {
          greetingPrefix = 'Boa noite! ';
        }
        
        // Add welcome message for first interaction with interest
        if (hasInterest) {
          greetingPrefix += 'Que bom que voce tem interesse! ';
        }
      }
      
      const slotQuestions: Record<string, string> = {
        'city_or_region': 'Qual sua cidade ou regiao? Assim consigo filtrar os carros mais proximos de voce.',
        'budget_max': 'Qual valor maximo voce esta pensando em investir? Assim filtro as melhores opcoes.',
        'category': 'Voce procura algum tipo especifico? SUV, sedan, hatch ou picape?',
        'payment_method': 'Voce pensa em pagar a vista, financiar ou entrar em consorcio?',
        'urgency': 'Voce tem urgencia? Quer resolver essa semana ou esta so pesquisando por enquanto?'
      };
      
      const baseQuestion = slotQuestions[routerResult.missing_slot] || 
        'Me conta mais sobre o que voce procura? Modelo, ano, faixa de preco...';
      
      const question = greetingPrefix + baseQuestion;
      
      await sendMessage(sender, question, env);
      return; // CRITICAL: Return here to enforce slot collection
      } // Close the else for !alreadyAsked
    } // Close the else for !hasCarModel
    // If alreadyAsked=true OR hasCarModel=true, we fall through to LLM below (no return)
  }
  
  // ROUTER PRIORITY 1: Safe Refusal (security)
  if (routerResult.action === 'SAFE_REFUSAL') {
    console.log(`[ROUTER] SAFE_REFUSAL - blocking message`);
    await sendMessage(
      sender,
      "Não consigo processar essa solicitação. Se precisar de ajuda com veículos, estou à disposição.",
      env
    );
    return;
  }
  
  // BUG-002 FIX: ROUTER PRIORITY 2 - EXIT_INTENT handler
  // When user says "nao quero mais", "chega", etc., end conversation gracefully
  if (routerResult.action === 'EXIT') {
    console.log(`[ROUTER] EXIT_INTENT detected - ending conversation gracefully`);
    
    // Track metrics: session ended with exit
    env.ctx.waitUntil(endMetricsSession(sender, 'exit', env).catch(e => console.error('[EVAL] Exit tracking failed:', e)));
    
    // Mark as do_not_contact in context
    await updateContext(sender, {
      sellerHandoff: { done: true, at: new Date().toISOString() },
      currentIntent: 'idle',
    }, env);
    
    // Update lead in D1 to mark do_not_contact
    try {
      await env.DB.prepare(`
        UPDATE leads SET 
          do_not_contact = 1, 
          exit_reason = ?,
          updated_at = datetime('now')
        WHERE telefone LIKE ?
      `).bind('user_explicit_exit', `%${sender.replace('@s.whatsapp.net', '').replace(/\D/g, '')}%`).run();
    } catch (e) {
      console.error('[EXIT] Failed to update lead:', e);
    }
    
    // Send polite exit message
    const exitMessages = [
      "Entendido! Removemos você da lista de contatos. Obrigado por visitar a Netcar Multimarcas! Qualquer dúvida, estamos aqui.",
      "Ok, respeitamos sua escolha. Não enviaremos mais mensagens. Quando quiser retomar, é só chamar!"
    ];
    const exitMessage = exitMessages[Math.floor(Math.random() * exitMessages.length)];
    
    await sendMessage(sender, exitMessage, env);
    console.log(`[EXIT] User ${sender} opted out - do_not_contact set`);
    return;
  }
  
  // ROUTER PRIORITY 2: Handoff (high intent detected by router)
  // Note: We log but don't force here yet - existing flow handles handoff keywords
  if (routerResult.action === 'HANDOFF_SELLER') {
    console.log(`[ROUTER] HANDOFF_SELLER recommended - reason: ${routerResult.reason}`);
    // Let existing flow handle, but log for observability
    ddLog(`Router recommends handoff: ${routerResult.reason}`, 'info', { phone: sender });
  }

  // ============================================================
  // DECISION PRECEDENCE (YAML v1.1) - Priority order matters!
  // ============================================================

  // PRIORITY 2: Angry customer detection
  const angryKeywords = [
    "absurdo",
    "péssimo",
    "pessimo",
    "demora",
    "reclamação",
    "reclamacao",
    "problema",
    "irritado",
    "frustrado",
    "enganado",
    "enganaram",
    "mentira",
  ];
  const isAngry = angryKeywords.some((kw) => lowerMsg.includes(kw));
  if (isAngry) {
    console.log(`[INTENT] Angry customer detected - using empathy protocol`);
    // Override: serious tone, no slang, validate emotion first
    await sendMessage(
      sender,
      "Entendo sua frustração. Isso é realmente chato e faz sentido você estar chateado. Peço desculpas por essa experiência. Pra resolver isso agora, posso acionar um consultor com prioridade. Posso fazer isso?",
      env
    );
    await handleSellerHandover(sender, env);
    return;
  }

  // EXTERNAL LINKS: Smart detection with DYNAMIC models from API
  const externalLinkRegex =
    /(https?:\/\/|www\.|\.com\b|\.br\b|olx|webmotors|mercadolivre|kavak|mobiauto|instagram|facebook|fb\.me|autocarro|icarros|google\.com\/aclk)/i;
  if (externalLinkRegex.test(message)) {
    console.log(
      `[INTENT] External link/AD detected - checking for car model in: "${message.substring(
        0,
        100
      )}..."`
    );

    // First try dynamic identifiers from API (auto-updates with client's stock)
    const dynamicIds = await getAllCarIdentifiers(env);
    const msgLower = message.toLowerCase();

    let foundModel: string | null = null;
    let foundBrand: string | null = null;

    // Check dynamic models from API
    for (const model of dynamicIds.models) {
      if (msgLower.includes(model)) {
        foundModel = model;
        break;
      }
    }

    // Check dynamic brands from API
    if (!foundModel) {
      for (const brand of dynamicIds.brands) {
        if (msgLower.includes(brand)) {
          foundBrand = brand;
          break;
        }
      }
    }

    // Fallback to static intents service if not found in dynamic list
    if (!foundModel) foundModel = extractCarModel(message);
    if (!foundBrand) foundBrand = extractCarBrand(message);

    const priceRange = extractPriceRange(message);

    if (foundModel || foundBrand) {
      const searchTerm = foundModel || foundBrand;
      console.log(`[INTENT] Car identified in AD: "${searchTerm}"`);

      // Only send greeting if native greeting wasn't already sent
      if (!nativeGreetingDetected) {
        await sendMessage(
          sender,
          `Vi que você está interessado em ${searchTerm!.toUpperCase()}! Um momento...`,
          env
        );
      } else {
        console.log(
          `[NATIVE_GREETING] Skipping duplicate greeting - native already sent`
        );
      }

      try {
        await executeCarSearch(
          {
            modelo: foundModel || undefined,
            marca: foundBrand || undefined,
            precoMax: priceRange?.max,
          },
          sender,
          env
        );
      } catch (e) {
        console.error("[INTENT] Search failed:", e);
        await sendMessage(
          sender,
          "Não encontrei esse modelo no estoque agora. Quer buscar outro?",
          env
        );
      }
      return;
    } else {
      console.log(`[INTENT] AD detected but NO identifiable car found yet`);

      // Special case: If user just said "Olá" or similar without identifying a car
      // And we already sent native greeting "Qual veículo você gostaria?"
      // We should NOT send another question "Qual modelo te interessou?"
      // BUT: If the message has substantive content (not just greeting), let AI process it!
      const isJustGreeting =
        /^(ol[aá]|oi|bom dia|boa tarde|boa noite|opa|ei|hey|tudo bem|td bem)\b/i.test(
          cleanMessage
        ) && cleanMessage.length < 30;

      if (nativeGreetingDetected && isJustGreeting) {
        console.log(
          `[NATIVE_GREETING] Native greeting already sent and user just said greeting. Waiting for real question.`
        );
        return;
      } else if (!nativeGreetingDetected) {
        await sendMessage(
          sender,
          "Vi que você veio de um anúncio! Qual modelo de carro te interessou? Me fala que eu busco aqui.",
          env
        );
        return;
      }
      // else: nativeGreetingDetected BUT user sent substantive message -> let AI handle below
      console.log(
        `[NATIVE_GREETING] Native greeting sent, but user has real question. Letting AI process.`
      );
    }
  }

  // PRIORITY 3: FIPE/price queries -> seller (per YAML v1.1)
  if (
    (lowerMsg.includes("fipe") ||
      lowerMsg.includes("tabela") ||
      lowerMsg.includes("quanto vale") ||
      lowerMsg.includes("qual o valor")) &&
    !isGroup
  ) {
    console.log(`[INTENT] Price/FIPE query detected - redirecting to seller`);
    await sendMessage(
      sender,
      "Para informações sobre valores e avaliações, vou te passar para um dos nossos consultores que pode te ajudar melhor!",
      env
    );
    await handleSellerHandover(sender, env);
    return;
  }

  // APPOINTMENT SPECIAL CASE (YAML v1.1): Don't ask day/time, go directly to seller
  const appointmentKeywords = [
    "agendar",
    "agendamento",
    "visita",
    "visitar",
    "ir na loja",
    "conhecer a loja",
    "marcar horário",
    "marcar horario",
  ];
  const isAppointment = appointmentKeywords.some((kw) => lowerMsg.includes(kw));
  if (isAppointment) {
    console.log(
      `[INTENT] Appointment request - direct handover (no day/time question)`
    );
    await sendMessage(
      sender,
      "Perfeito. Vou te conectar com um consultor pra agendar isso agora.",
      env
    );
    await handleSellerHandover(sender, env);
    return;
  }

  // Check for stock/brands query
  if (
    lowerMsg.includes("quais marcas") ||
    lowerMsg.includes("que marcas") ||
    lowerMsg.includes("marcas vocês têm") ||
    lowerMsg.includes("marcas disponiveis")
  ) {
    // 1. Check brands
    const brands = await getBrands(env);
    if (!brands || brands.length === 0) {
      await sendMessage(
        sender,
        "Não consegui encontrar as marcas disponíveis no momento. Por favor, tente novamente mais tarde.",
        env
      );
      return;
    }
    const response = formatBrandsList(brands);
    await sendMessage(sender, response, env);
    return;
  }

  // Check for testimonials/reviews query
  if (
    lowerMsg.includes("avaliação") ||
    lowerMsg.includes("avaliações") ||
    lowerMsg.includes("depoimento") ||
    lowerMsg.includes("opinião") ||
    lowerMsg.includes("golpe") ||
    lowerMsg.includes("confiável")
  ) {
    const depoimentos = await getDepoimentos(env, 3);
    const response = formatDepoimentos(depoimentos);
    await sendMessage(sender, response, env);
    return;
  }

  // Check for FAQ questions (hours, location, financing, etc.)
  // Uses deterministic scripts instead of AI for common questions
  // ASYNC version fetches hours from DB dynamically
  const faqResult = await checkFAQScriptAsync(message, env);
  if (faqResult.matched && faqResult.response) {
    console.log(
      `[SCRIPT] FAQ answered without AI: ${faqResult.metadata?.category}`
    );
    // Typing indicator not needed for FAQ (instant response)
    await sendMessage(sender, faqResult.response, env);
    await scheduleFollowup(sender, env, undefined, "inactivity");
    return;
  }

  // PRIORITY 1: Check for direct seller/human request BEFORE car intent
  // Expanded patterns to catch more variations
  const humanRequestPatterns = [
    // Direct requests
    /(falar|contato|atendimento|humano|vendedor|consultor|vendedores|consultores|atendentes?)/i,
    // "Tem alguém?" patterns
    /tem\s*(algue?m|pessoa|gente)/i,
    // "Poderia/Posso falar" patterns
    /(poderia|posso|quero|preciso|gostaria\s*de)\s*falar/i,
    // Frustation signals
    /^[\?!]{2,}$/,  // "???" or "!!" alone
    /por\s*favor.*por\s*favor/i, // repeated "por favor"
    // Explicit requests
    /(quero|preciso)\s*(de\s*)?(um|uma)?\s*(pessoa|humano|atendente)/i,
    // "ligar" requests
    /(me\s*)?liga(r|m)?\s*(pra\s*mim|aqui)?/i,
    // Short frustrated messages after multiple interactions
  ];
  
  const wantsHuman = humanRequestPatterns.some(p => p.test(lowerMsg));
  
  // Also detect frustration: short messages after a question was asked
  const isFrustrated = (
    (lowerMsg === '???' || lowerMsg === '??' || lowerMsg === '?') ||
    (lowerMsg.includes('por favor') && cleanMessage.length < 30) ||
    (lowerMsg === 'alguem' || lowerMsg === 'alguém') ||
    (lowerMsg.match(/^(falar|ligar|me\s*liga)/i))
  );
  
  if (wantsHuman || isFrustrated) {
    console.log(
      `[PROCESS] User asked for human/vendedor (wantsHuman=${wantsHuman}, frustrated=${isFrustrated}). Triggering handover.`
    );
    await handleSellerHandover(sender, env);
    return;
  }

  // ============================================================
  // GREETING MENU (Flowchart Requirement)
  // Standardize initial contact with specific options
  // ============================================================
  // ============================================================
  // GREETING MENU (DISABLED - LET AI HANDLE GREETING)
  // ============================================================
  /* 
  const greetingPatterns = ['oi', 'ola', 'olá', 'opa', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'começar', 'inicio', 'menu'];
  const isGreeting = greetingPatterns.includes(cleanMessage);
  
  if (isGreeting && cleanMessage.length < 20 && !isAskingForMore(message) && !isGroup) {
       // SPAM DETECTION
       const spamKey = `spam:${sender}:greeting`;
       const lastGreeting = await env.NETCAR_CACHE.get(spamKey);
       if (lastGreeting) {
         console.log(`[PROCESS] Spam detected - ignoring repeated greeting from ${sender}`);
         return; 
       }
       await env.NETCAR_CACHE.put(spamKey, 'sent', { expirationTtl: 60 });
       
       console.log(`[PROCESS] Greeting detected - sending Standard Menu`);
       const menuMessage = `Olá! Sou o iAN, seu assistente virtual da Netcar. 🚗\n\nComo posso te ajudar hoje? Selecione uma opção abaixo:`;
       
       const buttons = [
           { id: 'buscar_carros', label: 'Consultar Carros' },
           { id: 'faixa_preco', label: 'Faixa de Preço' },
           { id: 'estoque', label: 'Estoque Disponível' }
       ];
       
       await sendButtons(sender, menuMessage, buttons, env);
       return;
  }
  */

  // ============================================================
  // HANDOFF LOGIC (Flowchart Requirement: "Não ou Sem Resposta")
  // Check if user replied "Não" to "Quer fazer outra busca?"
  // ============================================================
  // CRITICAL FIX: EXIT_INTENT is now handled by router (lines 2069-2103)
  // This block should only handle "nao" as refusal to continue browsing,
  // NOT "nao quero mais" which is an exit intent
  if (
    (cleanMessage === "nao" || cleanMessage === "nao obrigado") &&
    !cleanMessage.includes("quero") &&
    !cleanMessage.includes("mais") &&
    !cleanMessage.includes("pare") &&
    !cleanMessage.includes("chega")
  ) {
    // Check if previous bot message was asking about "outra busca" or "gostou?"
    // Only trigger handoff for simple "nao" responses (not exit intent)
    console.log(`[PROCESS] User said 'Não' to browsing - Triggering Handoff`);
    await handleSellerHandover(sender, env);
    return;
  }

  // Detect if user is asking for more cars (pagination)
  if (isAskingForMore(message) && (await hasMoreCars(sender, env))) {
    console.log("[PROCESS] User asking for more cars. Fetching next batch.");
    const batch = await getNextCarBatch(sender, 6, env);

    if (batch && batch.length > 0) {
      for (let i = 0; i < batch.length; i++) {
        const car = batch[i];
        // await sendCarCard...
        console.log(`[PROCESS] Sending card for: ${car.marca} ${car.modelo}`);
        await sendCarCard(sender, car, env);
        if (i < batch.length - 1) await new Promise((r) => setTimeout(r, 500));
      }

      const remaining = await getRemainingCount(sender, env);
      if (remaining > 0) {
        // Natural message only - NO numbered menus per client request
        await sendMessage(
          sender,
          `Gostou de alguma destas ou quer ver as próximas? Tenho mais ${remaining} opções.`,
          env
        );
      } else {
        // Natural message only - NO numbered menus
        await sendMessage(
          sender,
          "Essas foram as opções que encontrei. Alguma te interessou ou prefere falar com um consultor?",
          env
        );
      }
      return;
    }
  }

  // ============================================================
  // EXTERNAL LINK HANDLER (Instagram, Facebook, OLX, etc)
  // When user sends a link with car info, extract and search
  // ============================================================
  const linkPatterns = [
    /instagram\.com/i,
    /facebook\.com/i,
    /fb\.me/i,
    /olx\./i,
    /webmotors\./i,
    /mercadolivre\./i,
  ];

  const hasExternalLink = linkPatterns.some((p) => p.test(message));
  if (hasExternalLink) {
    console.log(
      `[PROCESS] External link detected - attempting to extract car info`
    );

    // Try to extract car from the message text
    const carIntent = detectCarIntent(message);

    if (carIntent) {
      console.log(
        `[PROCESS] Car extracted from link message: ${JSON.stringify(
          carIntent
        )}`
      );
      try {
        await executeCarSearch(carIntent, sender, env);
        return; // Early return - search was successful
      } catch (error) {
        console.error("[PROCESS] Car search from link failed:", error);
        // Continue to AI fallback
      }
    } else {
      console.log(
        `[PROCESS] No car info extracted from link - using AI to handle`
      );
      // Let AI handle the link - it should ask for more details
    }
  }

  // Detect if user is asking for a car
  const carIntent = detectCarIntent(message);

  console.log(
    `[PROCESS] Message: "${message.substring(
      0,
      50
    )}...", CarIntent: ${JSON.stringify(carIntent)}, HasImage: ${!!imageUrl}`
  );

  // CRITICAL: If user sent an image, use Vision API to analyze it
  // Per YAML v1.1: image of car/anuncio can be analyzed; but NO intermediate message
  if (imageUrl) {
    console.log(
      "[PROCESS] Image detected - using Vision API for analysis (silent)"
    );
    // SILENCE RULE: No message before tool call per YAML v1.1
    try {
      await generateAIResponse(message, sender, senderName, env, imageUrl);
    } catch (imgError) {
      console.error("[PROCESS] Vision API/Image handling failed:", imgError);
      // Fallback: Try processing only text if image fails
      console.log("[PROCESS] Retrying without image...");
      await generateAIResponse(message, sender, senderName, env, undefined);
    }
    return;
  }

  // ============================================================
  // CONTEXT-AWARE SEARCH: Check if this is a refinement question
  // E.g., "é automático?" after searching for "Yaris" should ask
  // about the Yaris, not search for ALL automatic cars
  // ============================================================
  if (carIntent) {
    const ctx = await getContext(sender, env, false);
    const isAttributeOnlyQuery = detectAttributeOnlyQuery(message);
    const hasRecentSearch =
      ctx.lastSearch &&
      Date.now() - new Date(ctx.lastSearch.timestamp).getTime() < 5 * 60 * 1000; // 5 min

    if (isAttributeOnlyQuery && hasRecentSearch) {
      // User is asking about attribute (ex: "é automático?") after a recent search
      // Let AI answer about the searched car instead of new search
      console.log(
        `[CONTEXT] Attribute query "${message}" detected after recent search (filters: ${JSON.stringify(
          ctx.lastSearch?.filters
        )}). Letting AI handle.`
      );
      await generateAIResponse(message, sender, senderName, env, imageUrl);
      return;
    }

    let effectiveIntent = carIntent;

    // REFINEMENT CHECK: If new intent has no model/brand/category but has details (color, year, price),
    // and we have a recent active search, MERGE the filters.
    // Example: "Tem Tracker?" (Search Tracker) -> "E a branca?" (Search Tracker + Branca)
    // Instead of searching for ALL white cars.
    if (
      hasRecentSearch &&
      !carIntent.modelo &&
      !carIntent.marca &&
      !carIntent.categoria
    ) {
      // Only merge if we have meaningful filters in history
      if (
        ctx.lastSearch?.filters?.modelo ||
        ctx.lastSearch?.filters?.marca ||
        ctx.lastSearch?.filters?.categoria
      ) {
        console.log(
          `[CONTEXT] Refining search - Merging new intent ${JSON.stringify(
            carIntent
          )} with previous ${JSON.stringify(ctx.lastSearch.filters)}`
        );
        effectiveIntent = { ...ctx.lastSearch.filters, ...carIntent };
        // Reset irrelevant fields if needed, but usually merge is safe.
        // E.g. if previous had "cor: preto" and new has "cor: branco", new overrides old. Correct.
      }
    }
    // QUALIFICATION-FIRST (Helena Flow):
    // Check if intent is specific enough or has enough filters (2+)
    const isSpecific = effectiveIntent?.modelo || effectiveIntent?.marca;
    
    const filterCount = [
        effectiveIntent?.precoMin || effectiveIntent?.precoMax,
        effectiveIntent?.categoria,
        effectiveIntent?.cor,
        effectiveIntent?.transmissao,
        effectiveIntent?.motor,
        effectiveIntent?.opcional
    ].filter(Boolean).length;

    // If not specific AND has less than 2 filters, force AI response/qualification
    // But allow if user EXPLICITLY asked for stock (keywords checked by isGenericCarIntent but that returns empty intent)
    // Actually, if we are here, isGenericCarIntent returned {} which means NO intent fields.
    // So this logic holds: IF we have intent fields, check count. IF intent is empty {}, count is 0.
    
    if (!isSpecific && filterCount < 2) {
       console.log(`[PROCESS] Qualification needed: Generic intent with only ${filterCount} filters. Fallback to AI.`);
       await generateAIResponse(message, sender, senderName, env, imageUrl);
       return;
    }
    try {
      // Search logic moved to executeCarSearch
      await executeCarSearch(effectiveIntent, sender, env);
    } catch (error) {
      console.error("[PROCESS] Car search error:", error);
      // Fallback to AI if car search failed
      await generateAIResponse(message, sender, senderName, env, imageUrl);
      return;
    }
  } else {
    // Fallback to AI for general conversation
    console.log("[PROCESS] Using AI response");
    await generateAIResponse(message, sender, senderName, env, imageUrl);
  }
}

/**
 * Execute car search flow based on intent
 */
async function executeCarSearch(
  carIntent: {
    modelo?: string;
    marca?: string;
    precoMin?: number;
    precoMax?: number;
    categoria?: string;
    cor?: string;
    transmissao?: string;
    motor?: string; // Engine: 1.3, 2.0, 1.0 turbo
    opcional?: string; // Optional: teto_panoramico, apple_carplay
  },
  sender: string,
  env: Env
): Promise<void> {
  // Search for cars
  // Search for cars (with Cache)
  const cacheKey = JSON.stringify(carIntent);
  const now = Date.now();
  let cars: CarData[] = [];

  const cached = CAR_SEARCH_CACHE.get(cacheKey);
  if (cached && now - cached.timestamp < 60000) {
    // 60s TTL
    console.log("[CACHE] Hit for car search");
    cars = cached.data;
  } else {
    console.log("[PROCESS] Searching cars with intent:", carIntent);
    cars = await searchCars(carIntent, env);
    CAR_SEARCH_CACHE.set(cacheKey, { data: cars, timestamp: now });
    console.log(`[PROCESS] Search returned ${cars.length} cars (Cached)`);
  }

  if (cars.length > 0) {
    // FIX: Auto-save car ID and Model Interest to Lead Metadata
    try {
      const { DBService } = await import("@worker/db/db.service");
      const db = new DBService(env.DB);
      const cleanPhone = sender.replace(/\D/g, "");
      const lead = await db.getLeadByPhone(cleanPhone);

      if (lead) {
        const meta = lead.metadata || {};
        let changed = false;

        // 1. Update Model Interest if explicit in intent
        if (carIntent.modelo && meta.modelo_interesse !== carIntent.modelo) {
          meta.modelo_interesse = carIntent.modelo;
          changed = true;
        }

        // 2. Update Car ID (Use the first match as the specific car of interest)
        // This ensures we capture the ID *before* the webhook fires
        if (cars[0].id && meta.carro_id !== cars[0].id) {
          meta.carro_id = cars[0].id;
          changed = true;
        }

        if (changed) {
          console.log(
            `[PROCESS] 💾 Auto-saved interest: ${meta.modelo_interesse} (ID: ${meta.carro_id})`
          );
          await db.updateLead(lead.id, { metadata: meta });

          // CRM 3.0: Dispatch webhook with updated carro_id to external CRM
          try {
            const { dispatchWebhook, formatLeadPayload } = await import(
              "@legacy/integration.service"
            );
            dispatchWebhook(
              "lead_updated",
              formatLeadPayload(lead, {
                modelo_interesse: meta.modelo_interesse,
                carro_id: meta.carro_id,
              }),
              env
            );
            console.log(
              `[PROCESS] 🚀 Webhook dispatched with carro_id: ${meta.carro_id}`
            );
          } catch (webhookErr) {
            console.error("[PROCESS] Failed to dispatch webhook:", webhookErr);
          }
        }
      }
    } catch (e) {
      console.error("[PROCESS] Failed to auto-save metadata:", e);
    }

    // Save all cars to session for pagination
    await saveCarSession(sender, cars, carIntent, env);

    // User preference: 6 cars per batch
    const batch = await getNextCarBatch(sender, 6, env);

    if (batch) {
      // Show explicit count to user (User Request: Prevent hallucinations/expectations)
      const countMsg =
        cars.length === 1
          ? "Encontrei 1 opção no nosso estoque:"
          : `Encontrei ${cars.length} opções no nosso estoque. Aqui estão as primeiras:`;

      await sendMessage(sender, countMsg, env);

      // Send car cards with short delay to prevent rate limit
      for (let i = 0; i < batch.length; i++) {
        const car = batch[i];
        console.log(`[PROCESS] Sending card for: ${car.marca} ${car.modelo}`);
        await sendCarCard(sender, car, env);

        // Add 500ms delay between cards (reduced from 2s)
        if (i < batch.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Check if there are more
      const remaining = await getRemainingCount(sender, env);
      if (remaining > 0) {
        // Natural message only - NO numbered menus per client request (REGRA: NUNCA usar menus numerados)
        await sendMessage(
          sender,
          `Gostou de alguma destas ou quer ver as próximas? Tenho mais ${remaining} opções.`,
          env
        );
      } else {
        // Natural message only - NO numbered menus
        await sendMessage(
          sender,
          "Essas foram as opções que encontrei. Alguma te interessou ou prefere falar com um consultor?",
          env
        );
      }
      await scheduleFollowup(sender, env, 15, "handoff_15m"); // Schedule 15m handoff timer per flowchart

      // Track state for flow continuity
      await setConversationState(sender, { lastAction: "sent_cars" }, env);

      // MEMORY LANE: Track cars shown in context
      await addCarsShown(sender, batch, env);
      await recordSearch(sender, carIntent, cars.length, env);
      await setConversationState(
        sender,
        {
          lastAction: "sent_cars",
          lastCarResults: cars.length,
        },
        env
      );
    }
  } else {
    console.log("[PROCESS] No cars found matching criteria");
    // Handle empty results with EXPLICIT message logic
    let suggestion = "";

    // Generate specific suggestion based on what was searched
    // NEW FORMAT: Offer to pass to consultant when not found
    if (carIntent.modelo) {
      const modelName = carIntent.marca
        ? `${carIntent.marca.toUpperCase()} ${carIntent.modelo.toUpperCase()}`
        : carIntent.modelo.toUpperCase();

      suggestion =
        `Bah, *${modelName}* não temos no momento. ` +
        `Quer que eu passe pro consultor? Ele pode te avisar quando chegar ou ver outras opções contigo.`;
    } else if (carIntent.marca) {
      const requestedBrand = carIntent.marca.toUpperCase();

      suggestion =
        `Bah, veículos *${requestedBrand}* não temos agora. ` +
        `Quer que eu passe pro consultor? Ele pode te avisar quando chegar ou ver outras opções contigo.`;
    } else if (carIntent.precoMax) {
      suggestion =
        `Não encontrei carros até R$ ${carIntent.precoMax.toLocaleString(
          "pt-BR"
        )}. ` +
        `Quer que eu passe pro consultor? Ele pode te ajudar a encontrar algo no seu orçamento.`;
    } else {
      suggestion =
        `Bah, esse modelo não temos agora. ` +
        `Quer que eu passe pro consultor? Ele pode te avisar quando chegar ou ver outras opções contigo.`;
    }

    await sendMessage(sender, suggestion, env);
  }
}

/**
 * Handle Seller Handover (Assign and Send VCard)
 * Item 7: Prevents sending duplicate seller cards within 30 days
 */
async function handleSellerHandover(sender: string, env: Env) {
  // Check if seller card was recently sent (item 7)
  const alreadySent = await wasSellerCardSent(sender, env);

  // Even if already sent, we STILL want to provide the seller contact
  // Client complained the bot was saying "você já está em contato" without giving the contact
  if (alreadySent) {
    console.log(
      `[HANDOVER] Seller card already sent for ${sender}, but resending contact as requested`
    );
  }

  // Assign a seller (Round Robin or Stickiness 30 days)
  const seller = await assignSeller(sender, env);

  if (seller) {

    // Check Business Hours (Seg-Sex 9-18, Sáb 9-17)
    const brazilNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    const day = brazilNow.getDay(); // 0=Dom, 6=Sab
    const hour = brazilNow.getHours();

    let isOpen = false;
    if (day >= 1 && day <= 5) {
      if (hour >= 9 && hour < 18) isOpen = true;
    } else if (day === 6) {
      if (hour >= 9 && hour < 17) isOpen = true;
    }

    if (!isOpen) {
      // OUT OF OFFICE MESSAGE
      if (alreadySent) {
        await sendMessage(
          sender,
          `Claro! Segue novamente o contato do consultor *${seller.nome}*. Como estamos fora do horário de atendimento, ele entrará em contato no próximo horário comercial.`,
          env
        );
      } else {
        await sendMessage(
          sender,
          `Como estamos fora do nosso horário de atendimento agora, já deixei registrado seu interesse com prioridade. No próximo horário comercial, o consultor *${seller.nome}* entrará em contato com você!`,
          env
        );
      }
      // Optional: still send card below so they have the info
    } else {
      // OPEN MESSAGE
      if (alreadySent) {
        await sendMessage(
          sender,
          `Claro! Segue novamente o contato do consultor *${seller.nome}*:`,
          env
        );
      } else {
        await sendMessage(
          sender,
          `Perfeito! Vou passar seu contato para o *${seller.nome}*. Ele vai continuar seu atendimento com total prioridade.`,
          env
        );
      }
    }

    // Send Seller Card (Image + Link)
    // FIX: Extract just phone digits since seller.telefone may contain full wa.me URL
    const sellerPhone = seller.telefone.replace(/\D/g, "");
    if (seller.imagem) {
      const caption = `${seller.nome}: https://wa.me/${sellerPhone}`;
      try {
        await sendImage(sender, seller.imagem, caption, env);
      } catch (e) {
        // Fallback: Just text link if image fails (SSL error 526 etc)
        console.error(
          `[HANDOVER] Image blocked/failed for ${seller.nome}, sending text link.`
        );
        await sendMessage(sender, caption, env);
      }
    } else {
      // Fallback if no image
      await sendMessage(
        sender,
        `${seller.nome}: https://wa.me/${sellerPhone}`,
        env
      );
    }

    await setConversationState(
      sender,
      {
        lastAction: "sent_seller",
        sellerCardSentAt: new Date().toISOString(),
      },
      env
    );
  } else {
    // Fallback if no sellers generally (should not happen if DB has active sellers)
    await sendMessage(
      sender,
      "No momento nossos consultores estão ocupados, mas já registrei seu interesse e entraremos em contato o mais breve possível!",
      env
    );
  }

  // Trigger AI Summary (Fire and forget)
  try {
    console.log(`[HANDOVER] Generating AI Summary for ${sender}...`);
    await updateLeadSummary(sender, env);
  } catch (e) {
    console.error("[HANDOVER] Summary failed:", e);
  }

  // REMOVED: Automatic blocklist was blocking customers for 30 days silently
  // Now only admin can manually block numbers via Admin Panel
  // Old code added sender to blocklist after handover which caused issues
  console.log(
    `[HANDOVER] Complete for ${sender} - NOT adding to blocklist (manual only)`
  );
}

/**
 * Generate AI response for general conversation
 */
async function generateAIResponse(
  message: string,
  sender: string,
  senderName: string,
  env: Env,
  imageUrl?: string
): Promise<void> {
  // ==========================================================================
  // PERFORMANCE OPTIMIZATION: Execute independent operations in parallel
  // This reduces total latency from ~15s to ~5s (3x faster)
  // ==========================================================================

  const parallelStart = Date.now();

  // FIRE AND FORGET: sendPresence OUTSIDE Promise.all to avoid blocking!
  // This was causing 30s latency because it was inside Promise.all
  sendPresence(sender, "composing", 30000, env).catch(() => null);

  // Helper to wrap operations with timing
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    const result = await fn();
    console.log(`[PERF] ${name}: ${Date.now() - start}ms`);
    return result;
  };

  // Execute all independent operations in parallel with individual timing
  // NOTE: sendPresence removed from here - it was blocking for 30s!
  const [baseSystemPrompt, knowledge, ctx, history, siteInfo] = await Promise.all([
    // 1. System prompt from KV/D1 (cached 30min)
    timed("getSystemPrompt", () => getSystemPrompt(env)),

    // 2. RAG knowledge search (with 1s timeout - reduced from 2s for faster response)
    //    RAG can fail silently, responses still work without it
    timed("searchKnowledge", () =>
      Promise.race([
        searchKnowledgeBase(message, env).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ])
    ),

    // 3. User context from KV only (no D1 long-term query for faster response)
    timed("getContext", () => getContext(sender, env, false).catch(() => null)),

    // 4. Recent message history from D1 (reduced from 10 to 6 for faster queries)
    timed("getRecentMessages", () =>
      getRecentMessages(sender, 6, env).catch(() => [])
    ),

    // 5. Store hours from official Netcar API (for LLM to answer hours questions)
    timed("getSiteInfo", async () => {
      const { getSiteInfo } = await import("@legacy/netcar-api.service");
      return getSiteInfo(env).catch(() => null);
    }),
  ]);

  console.log(
    `[PERF] Parallel fetch completed in ${Date.now() - parallelStart}ms`
  );

  // Build system prompt with all the fetched data
  let systemPrompt = baseSystemPrompt;

  // Add current date/time to prevent date confusion
  const brazilNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const dayNames = [
    "domingo",
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
  ];
  const monthNames = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const currentDate = `${
    dayNames[brazilNow.getDay()]
  }, ${brazilNow.getDate()} de ${
    monthNames[brazilNow.getMonth()]
  } de ${brazilNow.getFullYear()}`;
  const currentTime = `${brazilNow
    .getHours()
    .toString()
    .padStart(2, "0")}:${brazilNow.getMinutes().toString().padStart(2, "0")}`;
  systemPrompt += `\n\nDATA E HORA ATUAIS: ${currentDate}, ${currentTime}h (Horario de Brasilia).\nIMPORTANTE: Use SEMPRE esta data como referencia. NAO confunda instrucoes de datas futuras com a data de hoje.`;

  // STORE HOURS: Inject from official Netcar API
  if (siteInfo && siteInfo.horario) {
    systemPrompt += `\n\nHORARIO DE FUNCIONAMENTO OFICIAL: ${siteInfo.horario}`;
    console.log(`[HOURS] Injecting store hours: ${siteInfo.horario}`);
  }

  // RAG: Inject knowledge if found
  if (knowledge) {
    console.log(`[RAG] Injecting extra context.`);
    systemPrompt += `\n\n📌 CONTEXTO EXTRA (Base de Conhecimento):\nUse essas informações se forem relevantes para a resposta. Elas representam manuais de venda ou casos de sucesso anteriores:\n\n${knowledge}`;
  }

  // MEMORY LANE: Inject context if loaded
  if (ctx) {
    const contextSummary = generateContextSummary(ctx);
    if (contextSummary) {
      console.log(`[CONTEXT] Injecting memory context into prompt`);
      systemPrompt += contextSummary;
    }
  }

  // FSM: Transition stage and inject stage-specific prompt
  try {
    const slotsFilled = ctx?.qualification 
      ? Object.keys(ctx.qualification).filter(k => (ctx.qualification as Record<string, unknown>)[k])
      : [];
    const fsmContext: TransitionContext = {
      action: 'SMALLTALK', // Will be overridden by router if needed
      slotsFilled,
      slotsTotal: slotsFilled.length,
      hasCarShown: (ctx?.carsShown?.length || 0) > 0,
      hasHandoff: ctx?.sellerHandoff?.done || false,
      minutesSinceLastMessage: ctx?.lastMessageAt 
        ? Math.floor((Date.now() - new Date(ctx.lastMessageAt).getTime()) / 60000)
        : 0,
      userIntent: ctx?.currentIntent || 'browse',
    };
    const fsmResult = await transitionStage(sender, fsmContext, env);
    console.log(`[FSM] Stage: ${fsmResult.currentStage} | Transitioned: ${fsmResult.transitioned}`);
    systemPrompt += `\n\n${fsmResult.prompt}`;
  } catch (fsmError) {
    console.error(`[FSM] Error:`, fsmError);
  }

  // Update last message timestamp in BACKGROUND (don't block)
  env.ctx.waitUntil(
    updateContext(
      sender,
      { lastMessageAt: new Date().toISOString() },
      env
    ).catch((err) => console.error("[CONTEXT] Background update failed:", err))
  );

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  if (imageUrl) {
    // VISION: Commercial car identification context - DETAILED MODE
    // Log image info for debugging
    const imageSize = imageUrl.length;
    console.log(`[VISION] Processing image (size: ${imageSize} chars, ~${Math.round(imageSize / 1024)}KB base64)`);
    
    // IMPORTANTE: O prompt de Vision vai JUNTO com a mensagem do usuário
    // para garantir que o GPT-4o leia as instruções ao analisar a imagem
    const visionInstruction = `🖼️ ANALISE A IMAGEM E IDENTIFIQUE O CARRO!

REGRA: Você DEVE identificar marca, modelo e ano aproximado do veículo na foto.

FORMATO OBRIGATÓRIO DE RESPOSTA (Seja preciso):
"**IDENTIFICADO: [MARCA] [MODELO] [ANO-ANO]**

📸 Como identifiquei:
• [detalhe 1 - ex: grade frontal]
• [detalhe 2 - ex: faróis]
• [detalhe 3 - ex: proporções]

🔎 Versão provável: [versão] baseado nos detalhes.

É o teu carro (pra troca) ou viu num anúncio e quer um parecido?"

⚠️ IMPORTANTE: NÃO ofereça buscar no estoque ainda! Primeiro descubra a intenção:
- Se for TROCA: O cliente quer dar seu carro como entrada
- Se for COMPRA: Aí sim buscaremos no estoque

EXEMPLOS:
- VW Nivus = Grade com linhas horizontais, faróis LED conectados, crossover compacto
- VW T-Cross = Grade VW, faróis separados, SUV compacto
- Chevrolet Cruze = Logo Chevrolet central, faróis alongados afilados, sedan médio
- Toyota Corolla = Grade boca larga, faróis LED em C
- Hyundai HB20 = Grade cascata, faróis dois níveis

⚠️ PROIBIDO: "não consigo identificar", "não sei qual é", "não consigo ver"
✅ OBRIGATÓRIO: Sempre identificar! Se não tiver 100% certeza, dê seu melhor palpite.

---
Mensagem do cliente: ${message}`;

    // Multimodal Visual Request - Vision instruction + Image
    messages.push({
      role: "user",
      content: [
        { type: "text", text: visionInstruction },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    });
  } else {
    // Standard Text Request
    messages.push({ role: "user", content: `${senderName}: ${message}` });
  }

  // ==================================================================================
  // PILAR 2: AGENT EVOLUTIVO (RAG + FIPE)
  // ==================================================================================
  if (!imageUrl && message.length > 5) {
    // 1. RAG (Conhecimento Técnico) - JÁ INJETADO NO SYSTEM PROMPT ACIMA
    // Otimização: Evitar dupla chamada de Vector Search (latência)

    // 2. FIPE (Preço de Mercado)
    const isFipeQuery = message
      .toLowerCase()
      .match(/(fipe|tabela|valor de mercado|preço médio|quanto vale)/i);

    // Only check FIPE if keyword present to save API calls
    if (isFipeQuery) {
      const carData = detectCarIntent(message);
      if (carData && carData.modelo && carData.marca) {
        const yearMatch = message.match(/\b(19|20)\d{2}\b/);
        const targetYear = yearMatch
          ? parseInt(yearMatch[0], 10)
          : new Date().getFullYear();

        console.log(
          `[AGENT] Buscando FIPE para ${carData.marca} ${carData.modelo} ${targetYear}`
        );
        try {
          const { searchFipe } = await import("@api/fipe");
          const fipeData = await searchFipe(
            carData.marca,
            carData.modelo,
            targetYear
          );

          if (fipeData) {
            console.log("[AGENT] FIPE encontrada e injetada.");
            messages.push({
              role: "system",
              content: `[SISTEMA - DADOS FIPE]\nVeículo: ${fipeData.marca} ${fipeData.modelo} ${fipeData.anoModelo}\nValor FIPE: ${fipeData.valor}\nRef: ${fipeData.mesReferencia}\nCombustível: ${fipeData.combustivel}\n(Use como referência de mercado)`,
            });
          }
        } catch (e) {
          console.error("[AGENT] FIPE Error:", e);
        }
      }
    }
  }
  // ==================================================================================

  try {
    // ============ HYBRID MODEL SELECTION ============
    // gpt-4o: images (vision required)
    // gpt-4o-mini: simple messages (fast, ~400ms)
    // deepseek-chat: complex queries (quality, ~1800ms)

    const lowerMessage = message.toLowerCase();

    // Complex patterns that benefit from DeepSeek reasoning
    const complexPatterns = [
      // Negociação
      "desconto",
      "melhor preço",
      "negociar",
      "proposta",
      "oferta",
      // Financiamento
      "financiar",
      "financiamento",
      "parcela",
      "entrada",
      "consórcio",
      // Avaliação/Troca
      "avaliar",
      "avaliação",
      "quanto vale",
      "trocar",
      "troca",
      // Técnico
      "procedência",
      "sinistro",
      "leilão",
      "laudo",
      "mecânico",
      // Comparação
      "diferença entre",
      "comparar",
      "qual melhor",
      "vale a pena",
      // PCD
      "pcd",
      "isenção",
      "deficiente",
    ];

    const isComplexQuery = complexPatterns.some((pattern) =>
      lowerMessage.includes(pattern)
    );

    // Model selection priority:
    // 1. Images -> gpt-4o (vision required)
    // 2. Complex queries -> deepseek-chat (better reasoning)
    // 3. Simple messages -> gpt-4o-mini (fast response)
    let modelToUse: string;
    let modelReason: string;

    if (imageUrl) {
      modelToUse = "gpt-4o";
      modelReason = "vision";
    } else if (isComplexQuery) {
      modelToUse = "deepseek-chat";
      modelReason = "complex";
    } else {
      modelToUse = "gpt-4o-mini";
      modelReason = "simple";
    }

    console.log(
      `[AI] Hybrid model selection: ${modelToUse} (reason: ${modelReason}, hasImage: ${!!imageUrl})`
    );
    
    // Send "typing" indicator while generating response (better UX)
    await sendPresence(sender, "composing", 15000, env);
    
    let response = await callOpenAI(messages, env, { model: modelToUse });

    // CHECK FOR HANDOFF TOOL CALL (Simulated by text)
    if (
      response.includes("encaminhaVendedores") ||
      response.includes("CARD DO VENDEDOR")
    ) {
      console.log("[AI] Detected handover trigger in response");

      // Strip the internal command from user view if present
      response = response
        .replace(/encaminhaVendedores/g, "")
        .replace(/CARD DO VENDEDOR/g, "")
        .trim();

      if (response) {
        // Strip tool calls before sending
        let cleanResponse = response
          .replace(/chamaApiCarros(?:\([^)]*\))?/g, "")
          .replace(/encaminhaVendedores/g, "")
          .replace(/CARD DO VENDEDOR/g, "")
          .replace(/\(\s*\)/g, "") // Remove empty parentheses ()
          .replace(/\s{2,}/g, " ") // Collapse multiple spaces
          .trim();

        if (cleanResponse.length > 0) {
          // Apply NLG Policy: ≤3 sentences, 1 question, CTA, no emojis
          const nlgResult = enforceNLGPolicy(cleanResponse);
          cleanResponse = nlgResult.response;
          
          await sendMessage(sender, cleanResponse, env);
        }
      }

      // TOOL 1: chamaApiCarros
      if (response.includes("chamaApiCarros")) {
        console.log("[AI] Detected 'chamaApiCarros' tool call");

        // Try to extract parameters: chamaApiCarros(key='value', ...)
        // Simple regex to find the content inside parens
        const match = response.match(/chamaApiCarros\(([^)]+)\)/);
        let searchParams: any = {};

        if (match && match[1]) {
          const paramsStr = match[1];
          // extract key='value' pairs
          const pairs = paramsStr.match(/(\w+)=['"]([^'"]+)['"]/g);
          if (pairs) {
            pairs.forEach((p) => {
              const [k, v] = p.split(/=['"]/);
              if (k && v)
                searchParams[k.trim()] = v.replace(/['"]$/, "").trim();
            });
          }
        }

        // If no params extracted, try to fallback to detectCarIntent on the original message
        // But usually AI adds params. If not, maybe use empty obj?
        if (Object.keys(searchParams).length === 0) {
          // Fallback: detect from last user message content if possible
          // Or just run empty search (not recommended) or specific intent
          const fallbackIntent = detectCarIntent(message);
          if (fallbackIntent) searchParams = fallbackIntent;
        }

        console.log("[AI] Executing Search from Tool:", searchParams);
        await executeCarSearch(searchParams, sender, env);
      }

      // TOOL 2: Seller Handover
      if (
        response.includes("encaminhaVendedores") ||
        response.includes("CARD DO VENDEDOR")
      ) {
        console.log("[AI] Detected 'encaminhaVendedores' tool call");
        await handleSellerHandover(sender, env);
        // FIX: Schedule follow-up after handover
        await scheduleFollowup(sender, env);
      }
    } else {
      // ✅ FIX: Normal AI response - MUST be sent to user!
      // Bug: Previously, OpenAI response was generated but never sent in normal flow
      let cleanResponse = response
        .replace(/chamaApiCarros(?:\([^)]*\))?/g, "")
        .replace(/\(\s*\)/g, "") // Remove empty parentheses ()
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .trim();

      if (cleanResponse.length > 0) {
        // Apply NLG Policy: ≤3 sentences, 1 question, CTA, no emojis
        const nlgResult = enforceNLGPolicy(cleanResponse);
        cleanResponse = nlgResult.response;
        
        console.log(`[AI] Sending normal response to ${sender}`);
        await sendMessage(sender, cleanResponse, env);
      }
    }

    // COMMITMENT RULE (YAML v1.1): If AI promised to call consultant, MUST trigger handover
    const consultantPromisePatterns = [
      "vou chamar",
      "vou passar",
      "vou acionar",
      "vou conectar",
      "vou te passar",
      "já vou chamar",
      "já vou passar",
      "já estou acionando",
      "já estou chamando",
    ];
    const responseLower = response.toLowerCase();
    const promisedConsultant = consultantPromisePatterns.some((p) =>
      responseLower.includes(p)
    );
    if (promisedConsultant) {
      console.log(`[COMMITMENT] AI promised consultant - triggering handover`);
      await handleSellerHandover(sender, env);
    }

    // COMMITMENT RULE (Search): If AI promised to search, MUST execute search
    const searchPromisePatterns = [
      "vou buscar",
      "vou procurar",
      "buscando",
      "um momento",
      "vou verificar",
      "já estou buscando",
      "deixa eu ver",
      "vou ver o que temos",
      "vou checar",
    ];
    const promisedSearch = searchPromisePatterns.some((p) =>
      responseLower.includes(p)
    );

    // Check if user message had search criteria (category, price, model)
    const userSearchIntent = detectCarIntent(message);
    const hasSearchCriteria = userSearchIntent && (
      userSearchIntent.modelo ||
      userSearchIntent.marca ||
      userSearchIntent.categoria ||
      userSearchIntent.precoMax ||
      userSearchIntent.precoMin
    );

    if (promisedSearch && hasSearchCriteria) {
      console.log(`[COMMITMENT] AI promised search - executing for:`, userSearchIntent);
      await executeCarSearch(userSearchIntent, sender, env);
    }

    // FIX: Schedule follow-up after every AI response
    await scheduleFollowup(sender, env);


    // ============================================================
    // MEMORY LANE: Detect car identification in Vision response
    // ONLY save when user shows INTEREST (not just asking for identification)
    // ============================================================
    if (imageUrl) {
      // Check if user message indicates INTEREST (wants to buy/see the car)
      // vs just IDENTIFICATION (asking "what car is this?")
      const messageLower = message.toLowerCase();
      
      // CRITICAL: Check if this is the default image message (no user caption)
      // If so, we should NOT auto-search - the AI asked if it's trade-in or purchase
      // We need to WAIT for the user's response before searching
      const isDefaultImageMessage = messageLower.includes("[imagem de veículo recebida]") ||
                                    messageLower.includes("identifique a marca e modelo");
      
      if (isDefaultImageMessage) {
        console.log(`[CONTEXT] Default image message detected - NOT auto-searching. Waiting for user response.`);
        // Just save that we saw a car, but don't search yet
        // The user needs to tell us if it's trade-in or purchase interest
        return; // Skip the auto-search logic entirely
      }
      
      // Trade-in patterns - when user mentions trade-in, DON'T auto-search
      // Just save the car info and let AI ask what they're looking for
      const tradeInPatterns = [
        "troca",
        "trocar",
        "avaliar",
        "avaliação",
        "avaliaçao",
        "tenho esse",
        "tenho este",
        "tenho um",
        "tenho uma",
        "meu carro",
        "meu veículo",
        "dar de entrada",
        "pegar na troca",
      ];
      
      const isTradeIn = tradeInPatterns.some((p) => messageLower.includes(p));
      
      if (isTradeIn) {
        console.log(`[VISION] Trade-in detected - extracting vehicle info for FIPE valuation`);
        
        // Extract vehicle info from Vision response (AI already identified the car)
        // Updated regex to look for "IDENTIFICADO: MARCA MODELO"
        const strictMatch = response.match(/\*\*IDENTIFICADO:\s*(\w+)\s+([\w\s-]+?)\s+(\d{4}(?:-\d{4})?)\*\*/i);
        
        let marcaDetected = "";
        let modeloDetected = "";
        let detectedYear = new Date().getFullYear() - 3; // Default fallback

        // Initialize fallback variable in outer scope
        let brandMatch: RegExpMatchArray | null = null;

        if (strictMatch) {
           marcaDetected = strictMatch[1].trim();
           modeloDetected = strictMatch[2].trim();
           // Try to use the first year if range
           const yearVal = strictMatch[3].split('-')[0];
           detectedYear = parseInt(yearVal, 10);
           console.log(`[VISION-TRADE-IN] Strict Match: ${marcaDetected} ${modeloDetected} ${detectedYear}`);
        } else {
           // Fallback to loose regex
           const brands = [
          "volkswagen", "vw", "fiat", "chevrolet", "gm", "ford", "toyota",
          "honda", "hyundai", "jeep", "renault", "nissan", "peugeot", "citroen",
          "mitsubishi", "kia", "bmw", "mercedes", "audi",
        ];
        // Regex atualizado para capturar Mark/Model mais flexível
        // Ex: "É um Volkswagen Nivus" ou "Trata-se de um Fiat Uno"
        const brandPattern = new RegExp(
          `(?:é\\s+(?:um|uma|o|a)\\s+)?(?:trata-se\\s+(?:de\\s+)?(?:um|uma)\\s+)?(${brands.join("|")})\\s+([a-záéíóúàèìòùãõâêîôûç0-9-]{2,})`,
          "i"
        );
        brandMatch = responseLower.match(brandPattern);
        }

        
        // Fallback year extraction
        if (!strictMatch) {
           const yearMatch = responseLower.match(/(\d{4})/);
           if (yearMatch) detectedYear = parseInt(yearMatch[1], 10);
        }
        
        if (marcaDetected && modeloDetected || (brandMatch && brandMatch[1] && brandMatch[2])) {
          if (!marcaDetected) {
             marcaDetected = brandMatch![1].trim();
             modeloDetected = brandMatch![2].trim();
          }
          
          console.log(`[VISION-TRADE-IN] Detected: ${marcaDetected} ${modeloDetected} ~${detectedYear}`);
          
          // Save trade-in car to context
          await addCarFromImage(sender, { 
            modelo: modeloDetected, 
            marca: marcaDetected,
            isTradeIn: true,
          }, env);
          
          // Try FIPE lookup for trade-in valuation
          try {
            const { searchFipe } = await import("@api/fipe");
            const fipeData = await searchFipe(marcaDetected, modeloDetected, detectedYear);
            
            if (fipeData && fipeData.valor) {
              // Calculate trade-in range (typically 80-90% of FIPE for good condition)
              const fipeValue = parseFloat(fipeData.valor.replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
              const minValue = Math.round(fipeValue * 0.80);
              const maxValue = Math.round(fipeValue * 0.92);
              
              const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              
              const valuationMsg = `Show! Identifiquei um *${marcaDetected.toUpperCase()} ${modeloDetected.toUpperCase()}*.

📊 *Avaliação prévia para troca:*
• FIPE ${fipeData.mesReferencia}: ${fipeData.valor}
• Estimativa na troca: ${formatBRL(minValue)} a ${formatBRL(maxValue)}

Agora me conta: *que tipo de carro você está procurando?* 🚗
(ex: SUV, sedan, hatch, até X mil, ano 2020+...)`;

              await sendMessage(sender, valuationMsg, env);
              
              console.log(`[VISION-TRADE-IN] Sent FIPE valuation: ${fipeData.valor}`);
              return; // Done - await user's preference
            }
          } catch (fipeError) {
            console.log(`[VISION-TRADE-IN] FIPE lookup failed, falling back to generic response:`, fipeError);
          }
          
          // Fallback: FIPE not found, ask what they're looking for
          const fallbackMsg = `Beleza! Vi que você tem um *${marcaDetected.toUpperCase()} ${modeloDetected.toUpperCase()}* para troca. Aceitamos sim! 🤝

Pra eu te ajudar melhor: *que tipo de carro você está procurando?*
(ex: SUV, sedan, até X mil, ano 2020+...)`;
          
          await sendMessage(sender, fallbackMsg, env);
          return;
        }
        
        // Could not identify car - ask for more info
        const genericMsg = `Aceitamos troca sim! 🤝

Pra eu fazer uma avaliação prévia, me diz:
• Qual a *marca e modelo* do seu carro?
• Qual o *ano*?

E enquanto isso, *que tipo de carro você está buscando?*`;
        
        await sendMessage(sender, genericMsg, env);
        return;
      }

      const interestPatterns = [
        "tem",
        "quero",
        "procuro",
        "busca",
        "esse",
        "esses",
        "essa",
        "essas",
        "igual",
        "parecido",
        "similar",
        "gostei",
        "interessei",
        "quanto custa",
        "preço",
        "valor",
        "disponível",
        "estoque",
      ];
      const identificationPatterns = [
        "qual",
        "quais",
        "que carro",
        "o que você vê",
        "identifica",
        "reconhece",
        "que modelo",
        "que marca",
        "que veículo",
      ];

      const hasInterest = interestPatterns.some((p) =>
        messageLower.includes(p)
      );
      const isJustIdentification =
        identificationPatterns.some((p) => messageLower.includes(p)) &&
        !hasInterest;

      // Only save to context if user shows INTEREST, not just identification
      if (!isJustIdentification) {
        // Pattern: "Olha só, um Volkswagen Nivus!" - extract brand and model separately
        const brands = [
          "volkswagen",
          "vw",
          "fiat",
          "chevrolet",
          "gm",
          "ford",
          "toyota",
          "honda",
          "hyundai",
          "jeep",
          "renault",
          "nissan",
          "peugeot",
          "citroen",
          "mitsubishi",
          "kia",
          "bmw",
          "mercedes",
          "audi",
        ];

        const brandModelPattern = new RegExp(
          `(?:é\\s+(?:um|uma)\\s+)?(${brands.join("|")})\\s+([a-záéíóúàèìòùãõâêîôûç0-9-]+)`,
          "i"
        );
        const brandModelMatch = responseLower.match(brandModelPattern);

        // Also try to detect classic Brazilian models that are very recognizable
        const classicModels: Record<string, string> = {
          "fusca": "volkswagen",
          "kombi": "volkswagen",
          "brasilia": "volkswagen",
          "gol": "volkswagen",
          "opala": "chevrolet",
          "maverick": "ford",
          "corcel": "ford",
          "chevette": "chevrolet",
          "monza": "chevrolet",
          "voyage": "volkswagen",
          "parati": "volkswagen",
          "santana": "volkswagen",
          "passat": "volkswagen",
          "variant": "volkswagen",
          "sp2": "volkswagen",
          "puma": "puma",
          "uno": "fiat",
          "147": "fiat",
          "elba": "fiat",
        };

        let marcaDetected: string | null = null;
        let modeloDetected: string | null = null;

        if (brandModelMatch && brandModelMatch[2]) {
          marcaDetected = brandModelMatch[1].trim();
          modeloDetected = brandModelMatch[2].trim();
        } else {
          // Fallback: try to find classic models by name alone
          for (const [model, brand] of Object.entries(classicModels)) {
            if (responseLower.includes(model)) {
              modeloDetected = model;
              marcaDetected = brand;
              console.log(`[CONTEXT] Vision detected classic car: ${brand} ${model}`);
              break;
            }
          }
        }

        if (marcaDetected && modeloDetected) {
          console.log(
            `[CONTEXT] Vision detected car with interest: ${marcaDetected} ${modeloDetected}`
          );

          // PRE-SEARCH: Check availability BEFORE asking the user
          try {
            const searchFilters = { modelo: modeloDetected, marca: marcaDetected };
            const carsFound = await searchCars(searchFilters, env);
            
            if (carsFound && carsFound.length > 0) {
              console.log(`[VISION] Found ${carsFound.length} ${modeloDetected} in stock - will show to user`);
              
              // Save to context and auto-search
              await addCarFromImage(sender, { modelo: modeloDetected, marca: marcaDetected }, env);
              
              // Instead of asking, directly show results!
              await saveCarSession(sender, carsFound, { modelo: modeloDetected, marca: marcaDetected }, env);
              const batch = await getNextCarBatch(sender, 6, env);
              
              // Send availability message
              const availabilityMsg = carsFound.length === 1
                ? `Achei *1 ${modeloDetected.toUpperCase()}* no estoque! Olha só:`
                : `Achei *${carsFound.length} opções de ${modeloDetected.toUpperCase()}* no estoque! Aqui estão as primeiras:`;
              
              await sendMessage(sender, availabilityMsg, env);
              
              // Send car cards
              if (batch && batch.length > 0) {
                for (const car of batch.slice(0, 3)) {
                  await sendCarCard(sender, car, env);
                }
                await addCarsShown(sender, batch.slice(0, 3), env);
              }
              
            } else {
              console.log(`[VISION] No ${modeloDetected} in stock - searching for alternatives`);
              
              // Try to find alternatives: first by brand, then general
              let alternatives: CarData[] = [];
              let altMessage = "";
              
              // Try searching by brand only
              if (marcaDetected) {
                alternatives = await searchCars({ marca: marcaDetected }, env) || [];
              }
              
              if (alternatives.length > 0) {
                // Has same brand models
                altMessage = `Infelizmente não temos *${modeloDetected.toUpperCase()}* no estoque. Mas temos ${alternatives.length} outros modelos *${marcaDetected?.toUpperCase()}* disponíveis! Olha só:`;
              } else {
                // Search for any popular cars
                alternatives = await searchCars({}, env) || [];
                if (alternatives.length > 0) {
                  altMessage = `Infelizmente não temos *${modeloDetected.toUpperCase()}* no estoque. Mas posso te mostrar outras opções que temos disponíveis:`;
                }
              }
              
              if (alternatives.length > 0) {
                await sendMessage(sender, altMessage, env);
                
                // Show top 3 alternatives
                await saveCarSession(sender, alternatives, { marca: marcaDetected }, env);
                const batch = await getNextCarBatch(sender, 6, env);
                if (batch && batch.length > 0) {
                  for (const car of batch.slice(0, 3)) {
                    await sendCarCard(sender, car, env);
                  }
                  await addCarsShown(sender, batch.slice(0, 3), env);
                }
              } else {
                // Really no cars at all
                const noStockMsg = `Infelizmente não temos *${modeloDetected.toUpperCase()}* no estoque no momento. Estamos renovando nosso estoque, deixa seu contato que te aviso quando chegar!`;
                await sendMessage(sender, noStockMsg, env);
              }
              
              // Save to context anyway for future reference
              await addCarFromImage(sender, { modelo: modeloDetected, marca: marcaDetected }, env);
            }
          } catch (searchError) {
            console.error(`[VISION] Pre-search failed for ${modeloDetected}:`, searchError);
            
            // Fallback: save to context for manual search later
            await addCarFromImage(sender, { modelo: modeloDetected, marca: marcaDetected }, env);
            await addPendingAction(sender, {
              type: "search",
              params: { modelo: modeloDetected, marca: marcaDetected },
            }, env);
          }
        }
      } else {
        // MESMO que seja apenas identificação, salvar o carro no contexto
        // para que mensagens subsequentes tenham referência
        const brands = [
          "volkswagen", "vw", "fiat", "chevrolet", "gm", "ford", "toyota",
          "honda", "hyundai", "jeep", "renault", "nissan", "peugeot", "citroen",
          "mitsubishi", "kia", "bmw", "mercedes", "audi",
        ];
        const brandModelPattern = new RegExp(
          `(${brands.join("|")})\\s+([a-záéíóúàèìòùãõâêîôûç]+)`,
          "i"
        );
        const brandModelMatch = responseLower.match(brandModelPattern);

        if (brandModelMatch && brandModelMatch[2]) {
          const marcaDetected = brandModelMatch[1].trim();
          const modeloDetected = brandModelMatch[2].trim();
          
          console.log(
            `[CONTEXT] Vision identified ${marcaDetected} ${modeloDetected} - saving to context for future reference`
          );

          // Save to context WITHOUT creating pending action (no auto-search)
          await addCarFromImage(
            sender,
            {
              modelo: modeloDetected,
              marca: marcaDetected,
            },
            env
          );
        } else {
          console.log(
          `[CONTEXT] Vision identified car but could not extract brand/model from response`
          );
        }
      }
    }
  } catch (error) {
    console.error("[AI] Error generating response:", error);

    // FALLBACK: If we tried with an image and failed (likely 400 Bad Request),
    // retry WITHOUT the image so the bot at least responds to the text.
    if (imageUrl) {
      console.log("[AI] 🔄 Retrying without image due to error...");
      // Remove the multimodal user message and replace with text-only
      messages.pop(); // Remove failed message
      messages.push({
        role: "user",
        content: `${senderName}: ${message} (Imagem não pôde ser processada)`,
      });

      try {
        // Use gpt-4o-mini for text-only retry (faster)
        const retryResponse = await callOpenAI(messages, env, {
          model: "gpt-4o-mini",
        });
        await sendMessage(sender, retryResponse, env);
        return; // Success on retry
      } catch (retryError) {
        console.error("[AI] Retry also failed:", retryError);
        throw retryError; // Throw original error to logger if both fail
      }
    }

    throw error; // Re-throw if no image or fallback failed
  }
}

/**
 * Detect if message is a short attribute question (e.g., "é automático?", "qual o ano?")
 * These should be answered in context of recent search, not trigger a new search
 */
function detectAttributeOnlyQuery(message: string): boolean {
  const lowerMsg = message.toLowerCase().trim();

  // Only for SHORT messages (under 40 chars) - longer messages are likely new requests
  if (lowerMsg.length > 40) return false;

  // Attribute-only patterns (short questions about car features)
  const attributePatterns = [
    /^[eé]\s*(autom[aá]tico|manual|flex|diesel)\s*\??$/i, // "é automático?"
    /^tem\s*(autom[aá]tico|manual|ar|direção|airbag|camera)/i, // "tem ar?"
    /^qual\s*(o\s+)?ano\??$/i, // "qual o ano?"
    /^quantos?\s*km\??$/i, // "quantos km?"
    /^aceita\s*(troca|financiamento)\??$/i, // "aceita troca?"
    /^tem\s*(garantia|revisão|ipva)\??$/i, // "tem garantia?"
    /^[eé]\s*(flex|completo|zero|novo)\s*\??$/i, // "é flex?"
    /^qual\s*(valor|preço|cor)\??$/i, // "qual valor?"
  ];

  return attributePatterns.some((p) => p.test(lowerMsg));
}

/**
 * Detect if user is asking for a car and extract filters
 * Returns combined filters for price, brand, model, category, and color
 */

// Restore Blocklist Debug Endpoint REMOVED

// Summary Debug Endpoint
app.get("/debug/summarize", async (c) => {
  const phone = c.req.query("phone");
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 5;
  const env = c.env as Env;

  if (phone) {
    const sum = await updateLeadSummary(phone, env);
    return c.json({ success: !!sum, summary: sum });
  } else {
    // Run batch summary for leads without summary
    const count = await batchSummarizeLeads(env, limit);
    return c.json({
      success: true,
      processed_count: count,
      message: `Processed ${count} leads in batch.`,
    });
  }
});

// ============ MAINTENANCE API ============

// Analyze Phone Numbers
app.get("/api/admin/maintenance/analyze-phones", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, nome, telefone, json_extract(metadata, '$.origin_source') as origin_source FROM leads"
    ).all();

    const suspicious: any[] = [];
    const distribution: any = {};

    for (const lead of results) {
      const phone = String(lead.telefone || "");
      const clean = phone.replace(/\D/g, "");
      const len = clean.length;

      distribution[len] = (distribution[len] || 0) + 1;

      let status = "valid";
      if (len < 10) status = "too_short";
      else if (len > 13) status = "too_long";
      else if (len === 10 || len === 11) status = "missing_ddi"; // Potential missing 55

      // Check for JID junk
      if (phone.includes("@") || phone.includes(":")) status = "has_jid_junk";

      if (status !== "valid") {
        suspicious.push({
          id: lead.id,
          nome: lead.nome,
          original: phone,
          clean: clean,
          length: len,
          issue: status,
          source: lead.origin_source,
        });
      }
    }

    return c.json({
      total_leads: results.length,
      suspicious_count: suspicious.length,
      length_distribution: distribution,
      suspicious_leads: suspicious.slice(0, 100), // Limit output
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Re-run AI Summary for ALL leads (Batch)
// Maintenance: FIX MISSING TABLES (Auto-Migration)
app.post("/api/admin/maintenance/fix-tables", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const db = c.env.DB;
  try {
    // 1. Blocklist
    await db
      .prepare(
        `
            CREATE TABLE IF NOT EXISTS blocklist (
              telefone TEXT PRIMARY KEY,
              motivo TEXT,
              pausado_em DATETIME,
              expira_em DATETIME
            )
        `
      )
      .run();

    // 2. Config
    await db
      .prepare(
        `
            CREATE TABLE IF NOT EXISTS config (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              description TEXT
            )
        `
      )
      .run();

    // 3. Vendedores
    await db
      .prepare(
        `
            CREATE TABLE IF NOT EXISTS vendedores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nome TEXT NOT NULL,
              whatsapp TEXT NOT NULL,
              imagem TEXT,
              ativo BOOLEAN DEFAULT TRUE
            )
        `
      )
      .run();

    return c.json({
      success: true,
      message: "Tables ensured (blocklist, config, vendedores)",
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

app.post("/api/admin/maintenance/re-summarize", async (c) => {
  // if (!await verifyRole(c.req.raw, c.env, "admin")) return c.json({ error: "Unauthorized" }, 401);

  const limit = parseInt(c.req.query("limit") || "50", 10);
  const force = c.req.query("force") === "true"; // If true, re-summarize even if exists

  try {
    let query =
      "SELECT * FROM leads WHERE ia_summary IS NULL OR ia_summary = '' ORDER BY created_at DESC LIMIT ?";
    if (force) {
      query = "SELECT * FROM leads ORDER BY created_at DESC LIMIT ?"; // Re-do everything
    }

    const { results } = await c.env.DB.prepare(query).bind(limit).all();

    let processed = 0;
    const { summarizeConversation } = await import("@legacy/openai.service");

    for (const lead of results) {
      // Get messages
      const { results: msgs } = await c.env.DB.prepare(
        "SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT 30"
      )
        .bind(lead.id)
        .all();

      if (msgs && msgs.length > 0) {
        // Map to OpenAI format
        const history = msgs.map((m: any) => ({
          role: (m.direction === "inbound" ? "user" : "assistant") as
            | "user"
            | "assistant"
            | "system",
          content: m.content as string,
        }));

        const summary = await summarizeConversation(history, c.env);

        // Save to METADATA (ia_summary is inside metadata)
        let meta = {};
        try {
          meta =
            typeof lead.metadata === "string"
              ? JSON.parse(lead.metadata)
              : lead.metadata || {};
        } catch {
          /* Ignore parse errors, continue with empty meta */
        }

        // @ts-ignore
        meta.ia_summary = summary;

        await c.env.DB.prepare("UPDATE leads SET metadata = ? WHERE id = ?")
          .bind(JSON.stringify(meta), lead.id)
          .run();

        processed++;
      }
    }

    return c.json({
      success: true,
      processed: processed,
      total_candidates: results.length,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ============ ANALYTICS API (Tier 1) ============
// Simple endpoints for Dashboard consumption (protected by Admin Key or similar in future)

// 1. Funnel Stats
app.get("/analytics/funnel", async (c) => {
  const env = c.env as Env;
  // D1 Funnel Query
  const db = new DBService(env.DB);
  // Manual aggregation since D1 is SQLite and we can do it via code or SQL 'GROUP BY'
  // GROUP BY is better.
  const stmt = env.DB.prepare(
    "SELECT json_extract(metadata, '$.status') as status, COUNT(*) as count FROM leads GROUP BY json_extract(metadata, '$.status')"
  );
  const { results } = await stmt.all<any>();

  const counts: Record<string, number> = {
    novo: 0,
    em_atendimento: 0,
    qualificado: 0,
    perdido: 0,
  };

  let total = 0;
  if (results) {
    results.forEach((row: any) => {
      const s = row.status || "novo";
      counts[s] = (counts[s] || 0) + row.count;
      total += row.count;
    });
  }

  // Return same format
  const data = results || [];

  return c.json({
    timestamp: new Date().toISOString(),
    funnel: counts,
    total: data.length,
  });
});

// 2. Performance Stats (Leads Today/Month + Avg Score)
app.get("/analytics/performance", async (c) => {
  const env = c.env as Env;
  // Simple mock-up of what would be complex aggregate queries
  // In real PostgREST we might use rpc() calls for heavy aggregation to avoid fetching all data

  // For now, let's just return basic health metrics
  return c.json({
    timestamp: new Date().toISOString(),
    metrics: {
      response_time_avg: "4.2s", // Placeholder for now
      leads_today: 12, // Placeholder
      messages_today: 145, // Placeholder
      conversion_rate: "8.5%", // Placeholder
    },
  });
});

// Proxy for Stock Attention (CORS Fix)
// Proxy for Stock Attention (CORS Fix)
app.get("/api/proxy/stock-attention", async (c) => {
  try {
    // URL Broken/Missing on upstream. Returning empty array to prevent error spam.
    // const response = await fetch("https://www.netcarmultimarcas.com.br/api/v1/api/brain/stock-attention");

    console.warn(
      "[PROXY] Upstream stock-attention endpoint missing. Returning empty array."
    );
    return c.json([]);

    /*
    if (!response.ok) {
        return c.json({ error: "Failed to fetch stock attention" }, 500);
    }
    const data = await response.json();
    console.log("[PROXY] Stock attention fetched:", Array.isArray(data) ? data.length : "Not an array");
    return c.json(data);
    */
  } catch (e) {
    console.error("[PROXY] Error fetching stock attention:", e);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// ======= ADMIN PANEL PROXY API =======
// Endpoint for Admin Panel to fetch cars without CORS issues
app.get("/api/estoque", async (c) => {
  const env = c.env as Env;
  try {
    const cars = await searchCars({}, env);
    return c.json({
      success: true,
      total: cars.length,
      data: cars,
    });
  } catch (error: any) {
    console.error("[API] Error fetching estoque:", error);
    return c.json({ success: false, error: error.message, data: [] }, 500);
  }
});

// Cleanup Suspect Leads (Maintenance)
app.post("/api/admin/maintenance/cleanup-suspects", async (c) => {
  // if (!await verifyRole(c.req.raw, c.env, "admin")) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    mode: "dry_run" | "execute";
    ids?: string[];
  }>();
  const mode = body.mode || "dry_run";

  try {
    let leadsToDelete: string[] = [];

    if (body.ids && body.ids.length > 0) {
      // Validate IDs are valid UUIDs to prevent injection
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      leadsToDelete = body.ids.filter(id => uuidRegex.test(id));
    } else {
      // Auto-detect based on length > 13 OR length < 10
      const { results } = await c.env.DB.prepare(
        "SELECT id, telefone FROM leads"
      ).all();
      for (const lead of results) {
        const phone = String(lead.telefone || "");
        const clean = phone.replace(/\D/g, "");
        if (clean.length > 13 || clean.length < 10) {
          leadsToDelete.push(String(lead.id));
        }
      }
    }

    if (mode === "execute" && leadsToDelete.length > 0) {
      // Process in batches of 50 to avoid SQL limits
      const batchSize = 50;
      for (let i = 0; i < leadsToDelete.length; i += batchSize) {
        const batch = leadsToDelete.slice(i, i + batchSize);
        // Use parameterized batch - each ID as separate bound parameter
        const statements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id)
        );
        const msgStatements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM messages WHERE lead_id = ?').bind(id)
        );
        const followupStatements = batch.map(id => 
          c.env.DB.prepare('DELETE FROM followups WHERE lead_id = ?').bind(id)
        );
        
        // Execute all deletes in batch
        await c.env.DB.batch([...statements, ...msgStatements, ...followupStatements]);
      }
    }

    return c.json({
      success: true,
      mode: mode,
      count: leadsToDelete.length,
      ids: leadsToDelete,
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});


// ===========================================================
// ADMIN API (Protected by verifyRole)
// ===========================================================

// 1. Get Leads (Paginated)
app.get("/api/admin/leads", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const status = c.req.query("status");

  const db = new DBService(c.env.DB);
  const data = await db.getLeads(limit, offset, status);

  return c.json(data);
});

// ============ ML EXPORT ENDPOINT ============
// Returns conversations in JSONL format for fine-tuning
app.get("/api/admin/export-ml", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const syntheticOnly = c.req.query("synthetic_only") === "true";
  const limit = parseInt(c.req.query("limit") || "1000", 10);
  const format = c.req.query("format") || "jsonl"; // jsonl or json
  
  try {
    // Get leads with messages
    let query = `
      SELECT 
        l.id as lead_id,
        l.telefone,
        l.nome,
        l.is_synthetic,
        m.id as message_id,
        m.role,
        m.content,
        m.created_at
      FROM leads l
      JOIN messages m ON l.id = m.lead_id
      ${syntheticOnly ? "WHERE l.is_synthetic = 1" : ""}
      ORDER BY l.id, m.created_at ASC
      LIMIT ?
    `;
    
    const result = await c.env.DB.prepare(query).bind(limit).all();
    
    if (!result.results || result.results.length === 0) {
      return c.json({ error: "No conversations found", count: 0 }, 404);
    }
    
    // Group by lead_id to form conversations
    const conversations: Record<string, any[]> = {};
    for (const row of result.results) {
      const leadId = row.lead_id as string;
      if (!conversations[leadId]) {
        conversations[leadId] = [];
      }
      // role is already 'user' or 'assistant' in DB
      const role = (row.role as string) === "bot" || (row.role as string) === "assistant" ? "assistant" : "user";
      conversations[leadId].push({
        role,
        content: row.content as string
      });
    }
    
    // Format for fine-tuning
    const systemPrompt = "Você é o iAN, assistente da Netcar. Ajude clientes a encontrar carros. Seja direto, sem emojis, máximo 3 frases. Sempre termine com CTA.";
    
    const mlData = Object.entries(conversations).map(([leadId, messages]) => ({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ]
    }));
    
    if (format === "jsonl") {
      // Return as JSONL (one JSON per line)
      const jsonl = mlData.map(item => JSON.stringify(item)).join("\n");
      return new Response(jsonl, {
        headers: {
          "Content-Type": "application/jsonl",
          "Content-Disposition": "attachment; filename=netcar_conversations.jsonl"
        }
      });
    }
    
    return c.json({
      count: mlData.length,
      conversations: mlData
    });
    
  } catch (error) {
    console.error("[ML-EXPORT] Error:", error);
    return c.json({ error: "Failed to export conversations" }, 500);
  }
});

// ============================================
// RAG Index Endpoint - Para indexar documentos no Vectorize
// ============================================
app.post("/api/admin/rag/index", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json() as {
      id: string;
      content: string;
      title: string;
      category?: string;
      metadata?: Record<string, any>;
    };

    if (!body.id || !body.content || !body.title) {
      return c.json({ error: "id, content, and title are required" }, 400);
    }

    // Import RAG service
    const { addDocument } = await import('@legacy/rag.service');
    
    const success = await addDocument(
      body.id,
      body.content,
      body.title,
      c.env
    );

    if (success) {
      console.log(`[RAG:Index] Document indexed: ${body.id}`);
      return c.json({ 
        success: true, 
        id: body.id,
        message: `Document "${body.title}" indexed successfully`
      });
    } else {
      return c.json({ 
        success: false, 
        error: "Failed to index document - check Vectorize configuration" 
      }, 500);
    }
  } catch (error) {
    console.error("[RAG:Index] Error:", error);
    return c.json({ error: "Failed to index document" }, 500);
  }
});

app.patch("/api/admin/leads/:id", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<any>();

  const db = new DBService(c.env.DB);
  // Update logic maps body fields to Lead fields
  await db.updateLead(id, body);

  return c.json({ success: true });
});

app.delete("/api/admin/leads/:id", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");

  // D1 delete
  await c.env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
  // Clean up messages/followups?
  // FKs should cascade if configured? No cascade in schema usually.
  // Manual cleanup
  await c.env.DB.prepare("DELETE FROM messages WHERE lead_id = ?")
    .bind(id)
    .run();
  await c.env.DB.prepare("DELETE FROM followups WHERE lead_id = ?")
    .bind(id)
    .run();

  return c.json({ success: true });
});

// 1.5 Sellers
app.get("/api/admin/sellers", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const db = new DBService(c.env.DB);
  const sellers = await db.getAllSellers();

  // Enrich with full URL if needed (currently storing relative or absolute? Let's check db insert)
  // If DB stores just 'filename.jpg', we might want to prepend base URL.
  // But typical flow stores full URL. Let's assume full URL is stored.

  return c.json(sellers);
});

// Round Robin Queue Management
app.get("/api/admin/sellers/queue", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const { getFromKV } = await import("@legacy/cache.service");
  const db = new DBService(c.env.DB);

  const currentIndex =
    (await getFromKV<number>(c.env, "QUEUE_CURSOR_INDEX")) || 0;
  const activeSellers = await db.getActiveSellers();
  activeSellers.sort((a: any, b: any) => a.id - b.id);

  const nextIndex = (currentIndex + 1) % activeSellers.length;
  const nextSeller = activeSellers[nextIndex];

  return c.json({
    currentIndex,
    nextIndex,
    totalActiveSellers: activeSellers.length,
    nextSellerInQueue: nextSeller
      ? { id: nextSeller.id, nome: nextSeller.nome }
      : null,
    activeSellersOrder: activeSellers.map((s: any, i: number) => ({
      position: i,
      id: s.id,
      nome: s.nome,
      isNext: i === nextIndex,
    })),
  });
});

app.post("/api/admin/sellers/queue/reset", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const { setInKV } = await import("@legacy/cache.service");
  await setInKV(c.env, "QUEUE_CURSOR_INDEX", 0);

  console.log("[CRM] ⚖️ Round Robin queue reset to 0");
  return c.json({ success: true, message: "Queue reset to position 0" });
});

// --- ONE-TIME SCHEMA MIGRATION ---
app.post("/api/admin/migrate-schema-images", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  try {
    await c.env.DB.prepare(
      "ALTER TABLE vendedores ADD COLUMN imagem TEXT"
    ).run();
    return c.json({
      success: true,
      message: "Schema updated: added imagem column to vendedores",
    });
  } catch (e: any) {
    if (e.message?.includes("duplicate column")) {
      return c.json({ success: true, message: "Column already exists" });
    }
    return c.json({ error: e.message }, 500);
  }
});

// --- IMAGE UPLOAD & SERVING ---

// Public Image Serving (can be cached heavily)
app.get("/images/:key", async (c) => {
  const key = c.req.param("key");
  const storage = new StorageService(c.env.IMAGES);
  const object = await storage.getImage(key);

  if (!object) return c.json({ error: "Image not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000"); // 1 year cache

  return new Response(object.body, {
    headers,
  });
});

// Admin Upload
app.post("/api/admin/upload", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const formData = await c.req.parseBody();
    const file = formData["file"]; // Watch out: 'file' or 'image'

    if (!(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    const extension = file.name.split(".").pop();
    const filename = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${extension}`;

    const storage = new StorageService(c.env.IMAGES);
    await storage.uploadImage(filename, file.stream(), file.type);

    // Return full URL
    const url = `${new URL(c.req.url).origin}/images/${filename}`;

    return c.json({
      success: true,
      url: url,
      key: filename,
    });
  } catch (e: any) {
    console.error("Upload failed", e);
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/admin/sellers", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<any>();

  // Validate
  if (!body.nome || !body.whatsapp)
    return c.json({ error: "Missing fields" }, 400);

  const db = new DBService(c.env.DB);

  // Simple update or insert? Usually we need ID for update
  if (body.id) {
    // Update
    await c.env.DB.prepare(
      "UPDATE vendedores SET nome = ?, whatsapp = ?, imagem = ?, ativo = ? WHERE id = ?"
    )
      .bind(
        body.nome,
        body.whatsapp,
        body.imagem || null,
        body.ativo !== undefined ? body.ativo : true,
        body.id
      )
      .run();
  } else {
    // Insert
    await c.env.DB.prepare(
      "INSERT INTO vendedores (nome, whatsapp, imagem, ativo) VALUES (?, ?, ?, ?)"
    )
      .bind(body.nome, body.whatsapp, body.imagem || null, true)
      .run();
  }

  return c.json({ success: true });
});

app.delete("/api/admin/sellers/:id", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM vendedores WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// 1.6 Chat Actions
app.post("/api/admin/chat/send-vcard", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ phone: string; seller_id: number }>();
  if (!body.phone || !body.seller_id)
    return c.json({ error: "Missing fields" }, 400);

  const db = new DBService(c.env.DB);
  const sellers = await db.getActiveSellers();
  const seller = sellers.find((s) => s.id === body.seller_id);

  if (seller) {
    const chatId = `${body.phone.replace(/\D/g, "")}@s.whatsapp.net`;
    // Extract phone from whatsapp field (may be URL like https://wa.me/5551996176340)
    let sellerPhone = seller.whatsapp || "";
    if (sellerPhone.includes("wa.me/"))
      sellerPhone = sellerPhone.split("wa.me/")[1] || sellerPhone;
    sellerPhone = sellerPhone.replace(/\D/g, "");
    await sendVCard(
      chatId,
      seller.nome,
      sellerPhone,
      c.env,
      undefined,
      seller.imagem
    );
    return c.json({ success: true });
  }
  return c.json({ error: "Seller not found" }, 404);
});

// 2. Blocklist Management
app.get("/api/admin/blocklist", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const limit = parseInt(c.req.query("limit") || "100", 10);
  const cursor = c.req.query("cursor");

  const data = await listBlocklist(c.env, limit, cursor);
  return c.json(data);
});

app.post("/api/admin/blocklist", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    phone: string;
    reason?: string;
    days?: number;
  }>();
  if (!body.phone) return c.json({ error: "Phone required" }, 400);

  // Normalize phone: accept formats like +55 51 9839-7276, 51 9839-7276, etc.
  let normalizedPhone = body.phone.replace(/\D/g, "");

  // Add Brazil country code if missing (assume Brazilian numbers)
  if (normalizedPhone.length <= 11 && !normalizedPhone.startsWith("55")) {
    normalizedPhone = "55" + normalizedPhone;
  }

  console.log(
    `[BLOCKLIST] Normalizing: "${body.phone}" -> "${normalizedPhone}"`
  );

  const success = await addToBlocklist(
    normalizedPhone,
    c.env,
    body.reason,
    body.days
  );
  return c.json({ success, normalizedPhone });
});

app.delete("/api/admin/blocklist", async (c) => {
  // Remove (unblock)
  const { removeFromBlocklist } = await import("@worker/auth/blocklist.service");
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ phone: string }>();
  if (!body.phone) return c.json({ error: "Phone required" }, 400);

  // Normalize phone: accept formats like +55 51 9839-7276, 51 9839-7276, etc.
  let normalizedPhone = body.phone.replace(/\D/g, "");
  if (normalizedPhone.length <= 11 && !normalizedPhone.startsWith("55")) {
    normalizedPhone = "55" + normalizedPhone;
  }
  console.log(
    `[BLOCKLIST] Removing (normalized): "${body.phone}" -> "${normalizedPhone}"`
  );

  const success = await removeFromBlocklist(normalizedPhone, c.env);
  return c.json({ success, normalizedPhone });
});

// 2.5 Prompt Layers Management (Base + Extensions)
app.get("/api/admin/prompts", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const { getPromptLayers, buildFinalPrompt } = await import(
    "@legacy/prompt-layers.service"
  );
  const layers = await getPromptLayers(c.env);
  const finalPrompt = await buildFinalPrompt(c.env);

  return c.json({
    layers,
    final_prompt: finalPrompt,
    stats: {
      baseCount: layers.filter((l) => l.layer_type === "base").length,
      extensionCount: layers.filter((l) => l.layer_type === "extension").length,
      activeExtensions: layers.filter(
        (l) => l.layer_type === "extension" && l.is_active
      ).length,
    },
  });
});

app.post("/api/admin/prompts/propose", async (c) => {
  // Propose new extension - AI analyzes for duplicates/conflicts
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: "Content required" }, 400);

  const { analyzeExtensionProposal } = await import(
    "@legacy/prompt-layers.service"
  );
  const analysis = await analyzeExtensionProposal(body.content, c.env);

  return c.json(analysis);
});

app.post("/api/admin/prompts", async (c) => {
  // Add approved extension
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ name: string; content: string }>();
  if (!body.name || !body.content)
    return c.json({ error: "Name and content required" }, 400);

  const { addExtension } = await import("@legacy/prompt-layers.service");
  const result = await addExtension(body.name, body.content, c.env);

  return c.json(result);
});

app.delete("/api/admin/prompts/:id", async (c) => {
  // Delete extension (cannot delete base)
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const id = parseInt(c.req.param("id"), 10);
  const { deleteExtension } = await import("@legacy/prompt-layers.service");
  const result = await deleteExtension(id, c.env);

  return c.json(result);
});

app.patch("/api/admin/prompts/:id/toggle", async (c) => {
  // Toggle extension active/inactive
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ is_active: boolean }>();

  const { toggleExtension } = await import("@legacy/prompt-layers.service");
  const result = await toggleExtension(id, body.is_active, c.env);

  return c.json(result);
});

app.post("/api/admin/prompts/init", async (c) => {
  // Initialize prompt layers (migrate from legacy system_prompt)
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const { initPromptLayers } = await import("@legacy/prompt-layers.service");
  await initPromptLayers(c.env);

  return c.json({ success: true, message: "Prompt layers initialized" });
});

// 3. Config Management - MOVED TO UNIFIED SECTION BELOW
// (Routes removed to avoid duplicates)

// 4. Follow-up Management
app.get("/api/admin/followups", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const status = c.req.query("status");

  const db = new DBService(c.env.DB);
  const data = await db.getAllFollowups(limit, offset, status);
  return c.json(data);
});

app.post("/api/admin/followups", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    lead_id: string;
    scheduled_at: string;
    type: string;
    message?: string;
  }>();

  if (!body.lead_id || !body.scheduled_at || !body.type) {
    return c.json(
      { error: "Missing fields (lead_id, scheduled_at, type)" },
      400
    );
  }

  const db = new DBService(c.env.DB);
  // Status default is 'pending'
  await db.createFollowup(
    body.lead_id,
    body.scheduled_at,
    body.type,
    "pending",
    body.message
  );

  return c.json({ success: true });
});

app.post("/api/admin/followups/cancel", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ phone: string }>();
  if (!body.phone) return c.json({ error: "Phone required" }, 400);

  const db = new DBService(c.env.DB);
  const lead = await db.getLeadByPhone(body.phone);

  if (lead) {
    await db.cancelPendingFollowups(lead.id);
    console.log(`[API] Manually cancelled follow-ups for ${body.phone}`);
    return c.json({ success: true, count: 1 }); // count is dummy, but signals success
  }

  return c.json({ error: "Lead not found" }, 404);
});

// 3. Config Management (Unified)
app.get("/api/admin/config", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const db = new DBService(c.env.DB);
  const key = c.req.query("key");

  // Case 1: Fetch single key
  if (key) {
    const value = await db.getConfig(key);
    return c.json({ [key]: value || null });
  }

  // Case 2: Fetch ALL config as simple object { key: value } used by frontend
  // The frontend expects keys like 'system_prompt', 'bot_enabled', etc.
  // DBService.getAllConfig() returns array of { key, value, description }
  const allConfigs = await db.getAllConfig();

  // Transform array to object
  const result: Record<string, string> = {};
  for (const entry of allConfigs) {
    result[entry.key] = entry.value;
  }

  return c.json(result);
});

app.post("/api/admin/config", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const rawText = await c.req.text();
    let body;
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      console.error("[ADMIN_CONFIG] JSON Parse Error:", e);
      return c.json({ error: "Invalid JSON format" }, 400);
    }

    if (!body.key) return c.json({ error: "Key required" }, 400);

    const db = new DBService(c.env.DB);
    const valString = String(body.value);
    await db.setConfig(body.key, valString);

    console.log(
      `[ADMIN_CONFIG] Updated key: ${body.key}, Value: "${valString}" (Length: ${valString.length})`
    );
    return c.json({ success: true, key: body.key, value: body.value });
  } catch (e: any) {
    console.error("[ADMIN_CONFIG] Error updating config:", e);
    return c.json({ error: e.message }, 500);
  }
});

app.delete("/api/admin/followups/:id", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const db = new DBService(c.env.DB);
  await db.deleteFollowup(id);

  return c.json({ success: true });
});

// 5. System Debug
app.get("/api/admin/debug/prompt", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const prompt = await getSystemPrompt(c.env);
  const injected = await injectDynamicVariablesAsync(prompt, c.env);

  console.log(
    "[DEBUG] System Prompt with Injected Variables:\n" +
      injected.substring(0, 1000) +
      "..."
  );

  return c.json({
    length: prompt.length,
    preview: prompt.substring(0, 500),
    preview_injected: injected.substring(0, 500),
    full_text: prompt, // User can inspect full text if needed
  });
});

// 6. Append System Prompt Instruction (AI Merged)
app.post("/api/admin/prompt/append", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ instruction: string }>();
  if (!body.instruction) return c.json({ error: "Instruction required" }, 400);

  const currentPrompt = await getSystemPrompt(c.env);

  try {
    const mergedPrompt = await mergeSystemPrompt(
      currentPrompt,
      body.instruction,
      c.env
    );

    // Save back to DB with versioning
    const db = new DBService(c.env.DB);

    // VERSIONING: Save current prompt as a version before overwriting
    const timestamp = new Date().toISOString();
    const versions = (await db.getConfig("prompt_versions")) || "[]";
    const versionList = JSON.parse(versions) as Array<{
      date: string;
      length: number;
      preview: string;
      prompt: string;
    }>;

    // Keep only last 10 versions
    if (versionList.length >= 10) {
      versionList.shift();
    }

    // Add current prompt as a version
    versionList.push({
      date: timestamp,
      length: currentPrompt.length,
      preview: currentPrompt.substring(0, 100),
      prompt: currentPrompt,
    });

    await db.setConfig("prompt_versions", JSON.stringify(versionList));
    await db.setConfig("system_prompt", mergedPrompt);

    return c.json({
      success: true,
      new_length: mergedPrompt.length,
      preview: mergedPrompt.substring(0, 200),
      version_saved: true,
    });
  } catch (error) {
    console.error("[ADMIN] Failed to append prompt:", error);
    return c.json(
      { error: "Failed to merge prompt", details: String(error) },
      500
    );
  }
});

// 6.1 Restore Fallback Prompt
app.post("/api/admin/prompt/restore-fallback", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const db = new DBService(c.env.DB);

    // Save current prompt as version before restoring
    const currentPrompt = (await db.getConfig("system_prompt")) || "";
    const timestamp = new Date().toISOString();
    const versions = (await db.getConfig("prompt_versions")) || "[]";
    const versionList = JSON.parse(versions) as Array<{
      date: string;
      length: number;
      preview: string;
      prompt: string;
    }>;

    if (currentPrompt.length > 50) {
      if (versionList.length >= 10) versionList.shift();
      versionList.push({
        date: timestamp,
        length: currentPrompt.length,
        preview: currentPrompt.substring(0, 100),
        prompt: currentPrompt,
      });
      await db.setConfig("prompt_versions", JSON.stringify(versionList));
    }

    // Get fallback prompt from openai.service
    const { getSystemPrompt: getFallback } = await import(
      "@legacy/openai.service"
    );
    // Delete the current prompt to force fallback
    await db.setConfig("system_prompt", "");

    // Get the fallback (which is hardcoded in the service)
    const fallbackPrompt = await getFallback(c.env);

    // Save it as the new prompt
    await db.setConfig("system_prompt", fallbackPrompt);

    return c.json({
      success: true,
      restored_length: fallbackPrompt.length,
      preview: fallbackPrompt.substring(0, 200) + "...",
      previous_saved: currentPrompt.length > 50,
    });
  } catch (error) {
    console.error("[ADMIN] Failed to restore fallback:", error);
    return c.json({ error: "Failed to restore", details: String(error) }, 500);
  }
});

// 6.2 List Prompt Versions
app.get("/api/admin/prompt/versions", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const db = new DBService(c.env.DB);
  const versions = (await db.getConfig("prompt_versions")) || "[]";
  const versionList = JSON.parse(versions) as Array<{
    date: string;
    length: number;
    preview: string;
    prompt: string;
  }>;

  // Return without full prompt for listing (save bandwidth)
  const listView = versionList.map((v, i) => ({
    id: i,
    date: v.date,
    length: v.length,
    preview: v.preview,
  }));

  return c.json({ versions: listView, total: versionList.length });
});

// 6.3 Get Specific Version
app.get("/api/admin/prompt/versions/:id", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const id = parseInt(c.req.param("id"), 10);
  const db = new DBService(c.env.DB);
  const versions = (await db.getConfig("prompt_versions")) || "[]";
  const versionList = JSON.parse(versions) as Array<{
    date: string;
    length: number;
    preview: string;
    prompt: string;
  }>;

  if (id < 0 || id >= versionList.length) {
    return c.json({ error: "Version not found" }, 404);
  }

  return c.json(versionList[id]);
});

// 6.4 Restore Specific Version
app.post("/api/admin/prompt/versions/:id/restore", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const id = parseInt(c.req.param("id"), 10);
  const db = new DBService(c.env.DB);
  const versions = (await db.getConfig("prompt_versions")) || "[]";
  const versionList = JSON.parse(versions) as Array<{
    date: string;
    length: number;
    preview: string;
    prompt: string;
  }>;

  if (id < 0 || id >= versionList.length) {
    return c.json({ error: "Version not found" }, 404);
  }

  const versionToRestore = versionList[id];

  // Save current as new version before restoring
  const currentPrompt = (await db.getConfig("system_prompt")) || "";
  if (currentPrompt.length > 50) {
    if (versionList.length >= 10) versionList.shift();
    versionList.push({
      date: new Date().toISOString(),
      length: currentPrompt.length,
      preview: currentPrompt.substring(0, 100),
      prompt: currentPrompt,
    });
    await db.setConfig("prompt_versions", JSON.stringify(versionList));
  }

  // Restore the selected version
  await db.setConfig("system_prompt", versionToRestore.prompt);

  return c.json({
    success: true,
    restored_from: versionToRestore.date,
    restored_length: versionToRestore.length,
  });
});

// 6.5 Update Full Prompt (with versioning and FULL AUDIT LOG)
app.post("/api/admin/prompt/update", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ prompt: string }>();
  if (!body.prompt || body.prompt.length < 50) {
    return c.json({ error: "Prompt too short (min 50 chars)" }, 400);
  }

  const db = new DBService(c.env.DB);

  // Get current prompt BEFORE updating (for audit log)
  const currentPrompt = (await db.getConfig("system_prompt")) || "";
  
  // Save current as version before updating
  if (currentPrompt.length > 50) {
    const versions = (await db.getConfig("prompt_versions")) || "[]";
    const versionList = JSON.parse(versions) as Array<{
      date: string;
      length: number;
      preview: string;
      prompt: string;
    }>;

    if (versionList.length >= 10) versionList.shift();
    versionList.push({
      date: new Date().toISOString(),
      length: currentPrompt.length,
      preview: currentPrompt.substring(0, 100),
      prompt: currentPrompt,
    });
    await db.setConfig("prompt_versions", JSON.stringify(versionList));
  }

  // Update with new prompt
  await db.setConfig("system_prompt", body.prompt);

  // ⚠️ AUDIT LOG COMPLETO - Rastreia IP, Localização, Data/Hora BR, Antes/Depois
  // Usado para proteger contra acusações falsas do cliente
  try {
    const { logPromptChange } = await import('@worker/auth/security.service');
    await logPromptChange(
      c.req.raw,
      'system_prompt',
      currentPrompt,
      body.prompt,
      c.env
    );
  } catch (auditError) {
    console.error('[AUDIT] Failed to log prompt change:', auditError);
    // Não falha o request se o audit falhar, mas loga o erro
  }

  return c.json({
    success: true,
    new_length: body.prompt.length,
    previous_saved: currentPrompt.length > 50,
    audit_logged: true,
    warning: "⚠️ Esta alteração foi registrada. O cliente é responsável por qualquer problema causado por esta modificação."
  });
});

// ====== 6.6 Store Hours APIs ======

// Get store hours configuration
app.get("/api/admin/store-hours", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const db = new DBService(c.env.DB);

  // Helper to ensure HH:MM format for time inputs
  const toTimeInput = (val: string) => {
    if (!val) return "";
    if (val.includes(":")) return val;
    // Handle single numbers like "9" -> "09:00"
    const num = parseInt(val, 10);
    if (!isNaN(num)) return `${num.toString().padStart(2, "0")}:00`;
    return val;
  };

  const hoursJson = await db.getConfig("store_hours");
  if (hoursJson) {
    try {
      const hours = JSON.parse(hoursJson);
      // Normalize time fields for frontend inputs
      hours.weekday_start = toTimeInput(hours.weekday_start);
      hours.weekday_end = toTimeInput(hours.weekday_end);
      hours.saturday_start = toTimeInput(hours.saturday_start);
      hours.saturday_end = toTimeInput(hours.saturday_end);

      return c.json({ hours });
    } catch {
      // Invalid JSON, return defaults
    }
  }

  // Return defaults
  return c.json({
    hours: {
      weekday_start: "09:00",
      weekday_end: "18:00",
      saturday_start: "09:00",
      saturday_end: "17:00",
      sunday_closed: true,
      special_rules: [],
    },
  });
});

// Update store hours configuration
app.post("/api/admin/store-hours", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    weekday_start: string;
    weekday_end: string;
    saturday_start: string;
    saturday_end: string;
    sunday_closed: boolean;
    special_rules: Array<{
      id: string;
      label: string;
      description: string;
      active: boolean;
      created_at: string;
    }>;
  }>();

  const db = new DBService(c.env.DB);

  // Save the hours configuration
  await db.setConfig("store_hours", JSON.stringify(body));

  console.log(
    `[ADMIN] Store hours updated. Special rules: ${
      body.special_rules?.length || 0
    }`
  );

  return c.json({ success: true });
});

// Get store hours for AI (public, used by bot)
app.get("/api/store-hours", async (c) => {
  const db = new DBService(c.env.DB);

  const hoursJson = await db.getConfig("store_hours");
  if (!hoursJson) {
    return c.json({
      weekday: "9h às 18h",
      saturday: "9h às 17h",
      sunday: "Fechado",
      special_rules: [],
    });
  }

  try {
    const hours = JSON.parse(hoursJson);

    // Format for AI consumption
    const activeRules = (hours.special_rules || [])
      .filter((r: { active?: boolean }) => r.active)
      .map((r: { label: string; description: string }) => ({
        label: r.label,
        description: r.description,
      }));

    return c.json({
      weekday: `${hours.weekday_start}h às ${hours.weekday_end}h`,
      saturday: `${hours.saturday_start}h às ${hours.saturday_end}h`,
      sunday: hours.sunday_closed
        ? "Fechado"
        : `${hours.sunday_start || "9"}h às ${hours.sunday_end || "13"}h`,
      special_rules: activeRules,
    });
  } catch {
    return c.json({
      weekday: "9h às 18h",
      saturday: "9h às 17h",
      sunday: "Fechado",
      special_rules: [],
    });
  }
});

// 7. RAG - Index Document
app.post("/api/admin/rag/index", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json<{
      id: string;
      content: string;
      title?: string;
    }>();
    if (!body.id || !body.content) {
      return c.json({ error: "id and content are required" }, 400);
    }

    // Check if Vectorize is available
    if (!c.env.VECTORIZE) {
      return c.json({ error: "Vectorize not configured" }, 500);
    }

    // Generate embedding via OpenAI
    const embeddingResponse = await fetch(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: body.content.replace(/\n/g, " ").substring(0, 8000), // Limit to 8K chars
        }),
      }
    );

    if (!embeddingResponse.ok) {
      const err = await embeddingResponse.text();
      return c.json({ error: "Embedding failed", details: err }, 500);
    }

    const embeddingData = (await embeddingResponse.json()) as {
      data: { embedding: number[] }[];
    };
    const embedding = embeddingData.data[0].embedding;

    // Upsert to Vectorize
    await c.env.VECTORIZE.upsert([
      {
        id: body.id,
        values: embedding,
        metadata: {
          content: body.content.substring(0, 10000), // Vectorize metadata limit
          title: body.title || body.id,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    console.log(
      `[RAG] Indexed document: ${body.id} (${body.content.length} chars)`
    );
    return c.json({ success: true, id: body.id, chars: body.content.length });
  } catch (error) {
    console.error("[RAG] Index error:", error);
    return c.json({ error: "Index failed", details: String(error) }, 500);
  }
});

// 8. RAG - Bulk Index (for manual)
app.post("/api/admin/rag/bulk-index", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json<{
      documents: { id: string; content: string; title?: string }[];
    }>();
    if (!body.documents || !Array.isArray(body.documents)) {
      return c.json({ error: "documents array required" }, 400);
    }

    if (!c.env.VECTORIZE) {
      return c.json({ error: "Vectorize not configured" }, 500);
    }

    let indexed = 0;
    for (const doc of body.documents) {
      try {
        const embeddingResponse = await fetch(
          "https://api.openai.com/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "text-embedding-3-small",
              input: doc.content.replace(/\n/g, " ").substring(0, 8000),
            }),
          }
        );

        if (!embeddingResponse.ok) continue;

        const embeddingData = (await embeddingResponse.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = embeddingData.data[0].embedding;

        await c.env.VECTORIZE.upsert([
          {
            id: doc.id,
            values: embedding,
            metadata: {
              content: doc.content.substring(0, 10000),
              title: doc.title || doc.id,
              createdAt: new Date().toISOString(),
            },
          },
        ]);
        indexed++;
      } catch (e) {
        console.error(`[RAG] Failed to index ${doc.id}:`, e);
      }
    }

    return c.json({ success: true, indexed, total: body.documents.length });
  } catch (error) {
    console.error("[RAG] Bulk index error:", error);
    return c.json({ error: "Bulk index failed", details: String(error) }, 500);
  }
});

// 9. RAG - Seed Knowledge Base (auto-populate with built-in docs)
app.post("/api/admin/rag/seed", async (c) => {
  if (!(await verifyRole(c.req.raw, c.env, "admin")))
    return c.json({ error: "Unauthorized" }, 401);

  try {
    if (!c.env.VECTORIZE) {
      return c.json({ error: "Vectorize not configured" }, 500);
    }

    // Import knowledge base
    const { getAllDocuments, getDocumentStats } = await import("./data/knowledge-base");
    const documents = getAllDocuments();
    const stats = getDocumentStats();

    console.log(`[RAG SEED] Starting seed with ${documents.length} documents...`);

    let indexed = 0;
    let failed = 0;
    const results: { id: string; status: string }[] = [];

    for (const doc of documents) {
      try {
        // Generate embedding
        const embeddingResponse = await fetch(
          "https://api.openai.com/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "text-embedding-3-small",
              input: doc.content.replace(/\n/g, " ").substring(0, 8000),
            }),
          }
        );

        if (!embeddingResponse.ok) {
          console.error(`[RAG SEED] Failed embedding for ${doc.id}`);
          failed++;
          results.push({ id: doc.id, status: "embedding_failed" });
          continue;
        }

        const embeddingData = (await embeddingResponse.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = embeddingData.data[0].embedding;

        // Upsert to Vectorize
        await c.env.VECTORIZE.upsert([
          {
            id: doc.id,
            values: embedding,
            metadata: {
              content: doc.content.substring(0, 10000),
              title: doc.title,
              category: doc.category,
              createdAt: new Date().toISOString(),
            },
          },
        ]);

        indexed++;
        results.push({ id: doc.id, status: "indexed" });
        console.log(`[RAG SEED] ✅ Indexed: ${doc.id}`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`[RAG SEED] Error indexing ${doc.id}:`, e);
        failed++;
        results.push({ id: doc.id, status: "error" });
      }
    }

    console.log(`[RAG SEED] Completed: ${indexed}/${documents.length} indexed, ${failed} failed`);

    return c.json({
      success: true,
      indexed,
      failed,
      total: documents.length,
      stats,
      results,
    });
  } catch (error) {
    console.error("[RAG SEED] Error:", error);
    return c.json({ error: "Seed failed", details: String(error) }, 500);
  }
});

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    // Initialize monitoring for this request
    initMonitoring();

    // Inject ctx into env so services can use it universally
    env.ctx = ctx;

    try {
      const response = await app.fetch(request, env, ctx);

      // Flush monitoring data at the end of request
      ctx.waitUntil(flushMonitoring());

      return response;
    } catch (error) {
      // Capture error
      captureError(
        error instanceof Error ? error : new Error(String(error)),
        { url: request.url, method: request.method }
      );

      // Flush before returning error
      ctx.waitUntil(flushMonitoring());

      throw error;
    }
  },
  async scheduled(event: any, env: Env, ctx: any) {
      console.log("[CRON] Running scheduled tasks...");
      ctx.waitUntil(processFollowups(env));
      ctx.waitUntil(checkFollowUpRules(env)); // New "Invisible Seller" automation
      ctx.waitUntil(autoCloseStaleLeads(env));
      ctx.waitUntil(batchSummarizeLeads(env));
      ctx.waitUntil(autoQualifyLeads(env));

      // SLA Alerts - Notify manager about idle HOT leads
      const { checkSlaAlerts } = await import("@legacy/crm.service");
      ctx.waitUntil(checkSlaAlerts(env));

      // Long-Term Memory: Persist conversation summaries to D1
      const { runSummarizationCron } = await import(
        "@worker/kv/context.service"
      );
      ctx.waitUntil(runSummarizationCron(env));

      // 🔄 Recovery Sweep: Detect and recover orphaned leads (no response from bot)
      const { runRecoverySweep } = await import("@legacy/recovery.service");
      ctx.waitUntil(runRecoverySweep(env));

      // 🌅 Process leads that arrived outside business hours
      // Runs at 9:00 AM Brazil time (12:00 UTC during summer, 12:00-13:00 UTC during winter)
      const now = new Date();
      const brazilTime = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
      );
      const brazilHour = brazilTime.getHours();
      const brazilMinute = brazilTime.getMinutes();

      if (brazilHour === 9 && brazilMinute < 5) {
        console.log(
          "[CRON] 🌅 Store opening time - processing pending leads..."
        );
        ctx.waitUntil(processPendingOpeningLeads(env));
      }

      // Daily backup - runs at 3:00 AM UTC (first minute of hour 3)
      const hour = new Date().getUTCHours();
      const minute = new Date().getUTCMinutes();
      if (hour === 3 && minute === 0) {
        console.log("[CRON] 🗄️ Starting daily backup...");
        const { runDailyBackup } = await import("@legacy/backup.service");
        ctx.waitUntil(runDailyBackup(env));
      }

      // 🔍 Webhook Health Check - EVERY MINUTE check and auto-recover webhook
      // (Evolution API v2.3.6 has a bug that deletes webhook config frequently)
      ctx.waitUntil(
        (async () => {
          try {
            const res = await fetch(
              `${env.EVOLUTION_API_URL}/instance/connectionState/${env.EVOLUTION_INSTANCE}`,
              { headers: { apikey: env.EVOLUTION_API_KEY } }
            );
            const data = (await res.json()) as any;
            const state = data?.instance?.state;

            // Only alert every 5 minutes, not every minute
            const shouldNotify = minute % 5 === 0;

            if (state !== "open") {
              console.warn(
                `[HEALTH] ⚠️ Evolution API disconnected! State: ${state}`
              );

              // 🔄 AUTO-RESTART: Try to restart the instance automatically
              let restartSuccess = false;
              try {
                console.log(
                  "[HEALTH] 🔄 Attempting auto-restart of Evolution instance..."
                );

                // Try restart first
                const restartRes = await fetch(
                  `${env.EVOLUTION_API_URL}/instance/restart/${env.EVOLUTION_INSTANCE}`,
                  {
                    method: "PUT",
                    headers: { apikey: env.EVOLUTION_API_KEY },
                  }
                );

                if (restartRes.ok) {
                  console.log("[HEALTH] ✅ Instance restart initiated!");
                  restartSuccess = true;

                  // Wait 5 seconds and check connection again
                  await new Promise((r) => setTimeout(r, 5000));

                  const checkRes = await fetch(
                    `${env.EVOLUTION_API_URL}/instance/connectionState/${env.EVOLUTION_INSTANCE}`,
                    { headers: { apikey: env.EVOLUTION_API_KEY } }
                  );
                  const checkData = (await checkRes.json()) as any;
                  const newState = checkData?.instance?.state;

                  if (newState === "open") {
                    console.log(
                      "[HEALTH] ✅ Auto-restart successful! Connection restored."
                    );
                    // Send success notification
                    const { sendMessage } = await import(
                      "@legacy/evolution.service"
                    );
                    try {
                      await sendMessage(
                        "5551988792811@s.whatsapp.net",
                        `✅ WhatsApp reconectado automaticamente!\nHora: ${new Date().toLocaleString(
                          "pt-BR",
                          { timeZone: "America/Sao_Paulo" }
                        )}`,
                        env
                      );
                    } catch (e) {
                      /* ignore */
                    }
                    return; // Success, no need to continue
                  } else {
                    console.warn(
                      `[HEALTH] ⚠️ Restart initiated but state still: ${newState}`
                    );
                    restartSuccess = false;
                  }
                } else {
                  const errText = await restartRes.text();
                  console.error("[HEALTH] ❌ Restart failed:", errText);
                }
              } catch (restartErr) {
                console.error("[HEALTH] ❌ Auto-restart error:", restartErr);
              }

              // If restart failed and should notify, send alert with instructions
              if (!restartSuccess && shouldNotify) {
                console.error(
                  `[HEALTH] 🚨 Auto-restart failed! Manual intervention required.`
                );
                const { sendMessage } = await import(
                  "@legacy/evolution.service"
                );
                const alertMsg = `🚨 ALERTA: WhatsApp desconectado!

📊 Estado: ${state}
🕐 Hora: ${new Date().toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}

❌ Tentativa automática de reconexão FALHOU.

📋 Ação necessária:
1. Acesse o painel admin
2. Vá em Configurações > Docs
3. Siga o passo a passo para reconectar

Ou acesse: https://netcar-admin.pages.dev/docs`;
                try {
                  await sendMessage(
                    "5551988792811@s.whatsapp.net",
                    alertMsg,
                    env
                  );
                } catch (e) {
                  console.error("[HEALTH] Failed to send alert:", e);
                }
              }
            } else {
              // 🔧 AUTO-RECOVERY: Check webhook EVERY minute, reconfigure if missing
              try {
                const webhookRes = await fetch(
                  `${env.EVOLUTION_API_URL}/webhook/find/${env.EVOLUTION_INSTANCE}`,
                  { headers: { apikey: env.EVOLUTION_API_KEY } }
                );
                const webhookData = (await webhookRes.json()) as any;
                const webhookUrl = webhookData?.webhook?.url;
                const webhookEnabled = webhookData?.webhook?.enabled;

                const expectedUrl =
                  "https://netcar-worker.contato-11e.workers.dev/webhook/evolution";

                if (
                  !webhookUrl ||
                  !webhookEnabled ||
                  webhookUrl !== expectedUrl
                ) {
                  // console.debug(`[HEALTH] 🔧 Webhook missing (URL: ${webhookUrl || 'null'}), auto-reconfiguring...`);

                  const setRes = await fetch(
                    `${env.EVOLUTION_API_URL}/webhook/set/${env.EVOLUTION_INSTANCE}`,
                    {
                      method: "POST",
                      headers: {
                        apikey: env.EVOLUTION_API_KEY,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        webhook: {
                          url: expectedUrl,
                          enabled: true,
                          events: [
                            "MESSAGES_UPSERT",
                            "MESSAGES_UPDATE",
                            "CONNECTION_UPDATE",
                            "QRCODE_UPDATED",
                          ],
                          webhookByEvents: false,
                          webhookBase64: false,
                        },
                      }),
                    }
                  );

                  if (setRes.ok) {
                    console.log("[HEALTH] ✅ Webhook auto-reconfigured!");
                  } else {
                    console.error(
                      "[HEALTH] ❌ Failed to reconfigure webhook:",
                      await setRes.text()
                    );
                  }
                }
              } catch (webhookErr) {
                console.error(
                  "[HEALTH] ❌ Failed to check/reconfigure webhook:",
                  webhookErr
                );
              }
            }
          } catch (e) {
            console.error("[HEALTH] ❌ Failed to check Evolution API:", e);
          }
        })()
      );
    },
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    // Process background queue messages
    for (const message of batch.messages) {
      try {
        console.log('[QUEUE] Processing message:', message.id);
        // Handle message based on type
        const data = message.body as { type: string; payload: unknown };
        if (data.type) {
          console.log(`[QUEUE] Message type: ${data.type}`);
        }
        message.ack();
      } catch (error) {
        console.error('[QUEUE] Error processing message:', error);
        message.retry();
      }
    }
  },
} as ExportedHandler<Env>;
