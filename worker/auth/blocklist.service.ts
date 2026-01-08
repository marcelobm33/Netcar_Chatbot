import type { Env } from '../types';

/**
 * BLOCKLIST SERVICE - CLOUDFLARE KV EDITION
 * ===========================================================
 * 100% isolado do Supabase - programador do cliente NÃO tem acesso
 * Usa Cloudflare KV (NETCAR_CACHE) para armazenamento
 * ===========================================================
 */

// KV Key prefix for blocklist entries
const BLOCKLIST_PREFIX = "blocklist:";

// Interface for blocklist entry
interface BlocklistEntry {
  telefone: string;
  motivo: string;
  pausado_em: string;
  expira_em: string;
}

/**
 * Check if a phone number is blocklisted
 * Uses Cloudflare KV for ultra-fast edge lookup, with D1 fallback
 */
export async function isBlocklisted(remoteJid: string, env: Env): Promise<boolean> {
  try {
    // Clean input: preserve ONLY digits
    const cleanPhone = remoteJid.replace(/\D/g, '');
    
    if (cleanPhone.length < 10) {
      return false;
    }
    
    // Try multiple key formats for robust matching
    const keysToCheck = [
      `${BLOCKLIST_PREFIX}${cleanPhone}`, // Full number: blocklist:555199887766
    ];
    
    // Also check without country code if present (55 for Brazil)
    if (cleanPhone.startsWith("55") && cleanPhone.length >= 12) {
      keysToCheck.push(`${BLOCKLIST_PREFIX}${cleanPhone.substring(2)}`); // Without 55
    }
    
    // Also check with country code if not present
    if (!cleanPhone.startsWith("55") && cleanPhone.length <= 11) {
      keysToCheck.push(`${BLOCKLIST_PREFIX}55${cleanPhone}`); // With 55
    }
    
    // 1. Check KV first (fast)
    for (const key of keysToCheck) {
      const entry = await env.NETCAR_CACHE.get<BlocklistEntry>(key, "json");
      
      if (entry) {
        // Check if expired
        if (entry.expira_em) {
          const expirationDate = new Date(entry.expira_em);
          const now = new Date();
          
          if (expirationDate < now) {
            // Expired - delete from KV and continue
            await env.NETCAR_CACHE.delete(key);
            console.log(`[BLOCKLIST-KV] Expired entry removed: ${key}`);
            continue;
          }
        }
        
        console.log(`[BLOCKLIST-KV] BLOCKED: ${remoteJid} (Key: ${key}, Expires: ${entry.expira_em})`);
        return true;
      }
    }
    
    // 2. Fallback to D1 if not found in KV (handles sync issues)
    if (env.DB) {
      const phonesToCheck = [cleanPhone];
      if (cleanPhone.startsWith("55") && cleanPhone.length >= 12) {
        phonesToCheck.push(cleanPhone.substring(2));
      }
      if (!cleanPhone.startsWith("55") && cleanPhone.length <= 11) {
        phonesToCheck.push(`55${cleanPhone}`);
      }
      
      for (const phone of phonesToCheck) {
        const result = await env.DB.prepare(
          "SELECT * FROM blocklist WHERE telefone = ? LIMIT 1"
        ).bind(phone).first<BlocklistEntry>();
        
        if (result) {
          // Check expiration
          if (result.expira_em) {
            const expirationDate = new Date(result.expira_em);
            if (expirationDate < new Date()) {
              continue; // Expired
            }
          }
          
          console.log(`[BLOCKLIST-D1] BLOCKED: ${remoteJid} (Phone: ${phone}, Found in D1)`);
          
          // Sync to KV for next time
          const ttlMs = result.expira_em ? new Date(result.expira_em).getTime() - Date.now() : 30 * 24 * 60 * 60 * 1000;
          let ttlSeconds = Math.max(60, Math.floor(ttlMs / 1000));
          if (ttlSeconds > 315360000) ttlSeconds = 315360000; // Cap at 10 years
          
          await env.NETCAR_CACHE.put(`${BLOCKLIST_PREFIX}${phone}`, JSON.stringify(result), {
            expirationTtl: ttlSeconds,
          });
          
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error("[BLOCKLIST] Error checking:", error);
    return false; // Fail open
  }
}

/**
 * Add a phone number to blocklist with expiration
 * Stores in Cloudflare KV - completely isolated from Supabase
 */

/**
 * Add a phone number to blocklist with expiration
 * Stores in D1 (Source of Truth) and KV (Cache)
 */
export async function addToBlocklist(
  remoteJid: string, 
  env: Env, 
  motivo: string = "Pausa automática (30 dias)",
  diasExpiracao: number = 30
): Promise<boolean> {
  const BOT_NUMBER = "5522992363462";
  const ADMIN_NUMBER = "17813195478"; // Protection for admin as well

  if (remoteJid.includes(BOT_NUMBER) || remoteJid.includes(ADMIN_NUMBER)) {
      console.warn(`[BLOCKLIST] 🛡️ Prevented blocklisting of PROTECTED NUMBER: ${remoteJid}`);
      return false;
  }

  try {
    // Clean phone number - preserve only digits
    const cleanPhone = remoteJid.replace(/\D/g, '');
    
    if (cleanPhone.length < 10) {
      console.warn(`[BLOCKLIST] Invalid phone: ${remoteJid}`);
      return false;
    }
    
    // Calculate expiration
    const now = new Date();
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + diasExpiracao);
    const expiraIso = expiraEm.toISOString();
    const nowIso = now.toISOString();
    
    // 1. Store in D1 (Source of Truth for Admin Panel)
    if (env.DB) {
      // NOTE: We bind phone as STRING to prevent 32-bit integer overflow (Cloudflare D1/SQLite quirk)
      await env.DB.prepare(`
        INSERT INTO blocklist (telefone, motivo, pausado_em, expira_em) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telefone) DO UPDATE SET
          motivo = excluded.motivo,
          pausado_em = excluded.pausado_em,
          expira_em = excluded.expira_em
      `).bind(String(cleanPhone), motivo, nowIso, expiraIso).run();
    }
    
    // 2. Store in KV (Fast Access for Worker)
    const entry: BlocklistEntry = {
      telefone: cleanPhone,
      motivo: motivo,
      pausado_em: nowIso,
      expira_em: expiraIso,
    };
    
    // Store in KV with TTL (seconds)
    // IMPORTANT: Cap at 10 years to prevent 32-bit integer overflow in Cloudflare KV
    // Max safe value is ~2.1 billion (2^31-1), 10 years = ~315M seconds
    const MAX_TTL = 315360000; // 10 years in seconds
    let ttlSeconds = diasExpiracao * 24 * 60 * 60;
    if (ttlSeconds > MAX_TTL) {
      ttlSeconds = MAX_TTL;
      console.log(`[BLOCKLIST] TTL capped to 10 years for permanent block`);
    }
    const key = `${BLOCKLIST_PREFIX}${cleanPhone}`;
    
    await env.NETCAR_CACHE.put(key, JSON.stringify(entry), {
      expirationTtl: ttlSeconds,
    });
    
    console.log(`[BLOCKLIST] Added: ${cleanPhone} (expires: ${expiraIso})`);
    
    // 3. Cancel any pending follow-up immediately
    // Dynamic import to avoid circular dependency (blocklist <-> followup <-> blocklist)
    try {
        const { cancelFollowup } = await import('./followup.service');
        // Detect LID (more than 13 digits = WhatsApp internal ID from ads)
        const isLid = cleanPhone.length > 13;
        const chatId = isLid ? `${cleanPhone}@lid` : `${cleanPhone}@s.whatsapp.net`;
        await cancelFollowup(chatId, env);
    } catch (e) {
        console.warn(`[BLOCKLIST] Failed to cancel follow-up for ${cleanPhone}`, e);
    }

    return true;
  } catch (error) {
    console.error("[BLOCKLIST] Error adding:", error);
    return false;
  }
}

/**
 * RESTORE a phone number to blocklist with precise dates (Migration Tool)
 * Uses absolute timestamps from backup
 */
export async function restoreBlocklistEntry(
  item: { telefone: string; motivo: string; pausado_em: string; expira_em: string },
  env: Env
): Promise<boolean> {
  try {
    const cleanPhone = item.telefone.replace(/\D/g, '');
    if (cleanPhone.length < 10) return false;

    // 1. Store in D1
    if (env.DB) {
      await env.DB.prepare(`
        INSERT INTO blocklist (telefone, motivo, pausado_em, expira_em) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telefone) DO UPDATE SET
          motivo = excluded.motivo,
          pausado_em = excluded.pausado_em,
          expira_em = excluded.expira_em
      `).bind(String(cleanPhone), item.motivo, item.pausado_em, item.expira_em).run();
    }

    // 2. Store in KV
    const entry: BlocklistEntry = {
      telefone: cleanPhone,
      motivo: item.motivo,
      pausado_em: item.pausado_em,
      expira_em: item.expira_em,
    };

    // Calculate expiration TTL relative to now
    // Cloudflare KV TTL is seconds. Max safe 32-bit signed int is ~2B (~68 years from now).
    // 2099 is > 2025 + 74 years, which might overflow.
    // Cap at 10 years (approx 315M seconds)
    const MAX_TTL = 315360000; // 10 years
    const expiraDate = new Date(item.expira_em);
    
    // Calculate relative TTL
    const currentEpoch = Math.floor(Date.now() / 1000);
    const targetEpoch = Math.floor(expiraDate.getTime() / 1000);
    
    let ttl = targetEpoch - currentEpoch;
    
    // Cap TTL
    if (ttl > MAX_TTL) {
       ttl = MAX_TTL;
    }

    // Only put if future
    if (ttl > 60) {
      await env.NETCAR_CACHE.put(`${BLOCKLIST_PREFIX}${cleanPhone}`, JSON.stringify(entry), {
        expirationTtl: ttl,
      });
      console.log(`[RESTORE] Restored ${cleanPhone} to Blocklist`);
    } else {
      console.warn(`[RESTORE] Skipping expired/invalid entry: ${cleanPhone}`);
    }

    return true;
  } catch (error) {
    console.error(`[RESTORE] Error restoring ${item.telefone}:`, error);
    return false;
  }
}

/**
 * Remove a phone number from blocklist (D1 + KV)
 */
export async function removeFromBlocklist(remoteJid: string, env: Env): Promise<boolean> {
  try {
    const cleanPhone = remoteJid.replace(/\D/g, '');
    const key = `${BLOCKLIST_PREFIX}${cleanPhone}`;
    
    // 1. Remove from D1
    if (env.DB) {
      await env.DB.prepare("DELETE FROM blocklist WHERE telefone = ?").bind(cleanPhone).run();
    }
    
    // 2. Remove from KV
    await env.NETCAR_CACHE.delete(key);
    
    // Also try with/without country code variations in KV to be safe
    if (cleanPhone.startsWith("55")) {
      await env.NETCAR_CACHE.delete(`${BLOCKLIST_PREFIX}${cleanPhone.substring(2)}`);
    } else {
      await env.NETCAR_CACHE.delete(`${BLOCKLIST_PREFIX}55${cleanPhone}`);
    }
    
    console.log(`[BLOCKLIST] Removed: ${cleanPhone}`);
    return true;
  } catch (error) {
    console.error("[BLOCKLIST] Error removing:", error);
    return false;
  }
}

/**
 * List all active blocklisted numbers (D1 Preferred)
 */
export async function listBlocklist(env: Env, limit: number = 100, cursor?: string): Promise<{ entries: BlocklistEntry[], cursor?: string }> {
  try {
    // Prefer D1 for listing as it is simpler
    if (env.DB) {
      const { results } = await env.DB.prepare("SELECT * FROM blocklist ORDER BY pausado_em DESC LIMIT ?").bind(limit).all<BlocklistEntry>();
      return { entries: results || [] };
    }
    
    // Fallback to KV list if DB unavailable
    const list = await env.NETCAR_CACHE.list({ prefix: BLOCKLIST_PREFIX, limit, cursor });
    
    const entries: BlocklistEntry[] = [];
    await Promise.all(list.keys.map(async (k) => {
        const val = await env.NETCAR_CACHE.get<BlocklistEntry>(k.name, 'json');
        if (val) entries.push(val);
    }));
    
    return { 
        entries, 
        cursor: list.list_complete ? undefined : list.cursor 
    };
  } catch (e) {
    console.error('[BLOCKLIST] Error listing:', e);
    return { entries: [] };
  }
}

/**
 * Sync blocklist from D1 to KV (Recovery/Migration)
 * Removes dependency on Supabase
 */
export async function syncBlocklistFromD1(env: Env): Promise<{ synced: number; errors: number }> {
  if (!env.DB) return { synced: 0, errors: 1 };
  
  let synced = 0;
  let errors = 0;
  
  try {
    const { results } = await env.DB.prepare("SELECT * FROM blocklist").all<BlocklistEntry>();
    const now = new Date();
    
    for (const entry of results || []) {
      try {
        if (entry.expira_em && new Date(entry.expira_em) < now) continue;
        
        const cleanPhone = entry.telefone.replace(/\D/g, '');
        if (!cleanPhone) continue;
        
        const expirationDate = entry.expira_em ? new Date(entry.expira_em) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const ttlMs = expirationDate.getTime() - now.getTime();
        let ttlSeconds = Math.max(60, Math.floor(ttlMs / 1000));
        
        // Cap at 10 years to prevent 32-bit overflow (2038/2099 issues)
        const MAX_TTL = 315360000; 
        if (ttlSeconds > MAX_TTL) ttlSeconds = MAX_TTL;

        await env.NETCAR_CACHE.put(`${BLOCKLIST_PREFIX}${cleanPhone}`, JSON.stringify(entry), {
          expirationTtl: ttlSeconds,
        });
        
        synced++;
      } catch (e) {
        errors++;
      }
    }
    
    console.log(`[BLOCKLIST] Sync complete: ${synced} synced`);
    return { synced, errors };
  } catch (error) {
    console.error("[BLOCKLIST] Sync failed:", error);
    return { synced, errors: errors + 1 };
  }
}
