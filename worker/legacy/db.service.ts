import { Env } from '@types';

export interface Lead {
  id: string; // UUID or String
  telefone: string;
  nome: string;
  interesse?: string;
  created_at?: string;
  last_interaction?: string;
  is_seller?: boolean;
  is_synthetic?: boolean; // Marks leads from Shadow Bot test numbers
  metadata?: any;
}

export interface Message {
  id?: number;
  lead_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
  sent?: boolean;
}

export class DBService {
  constructor(private db: D1Database) {}

  // --- LEADS ---

  async getLeadByPhone(phone: string): Promise<Lead | null> {
    const stmt = this.db.prepare('SELECT * FROM leads WHERE telefone = ?').bind(phone);
    const result = await stmt.first<Lead>();
    if (result && result.metadata && typeof result.metadata === 'string') {
        try { result.metadata = JSON.parse(result.metadata); } catch { /* Ignore invalid JSON */ }
    }
    return result;
  }

  async createLead(lead: Partial<Lead>): Promise<Lead | null> {
    const id = lead.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const metadata = lead.metadata ? JSON.stringify(lead.metadata) : '{}';
    
    // Extract is_synthetic from metadata if present
    const isSynthetic = lead.is_synthetic ?? lead.metadata?.is_synthetic ?? false;
    
    // Tenta INSERT, se falhar por unique constraint (telefone), retorna null ou lança erro (idealmente upsert ou check before)
    // Usando INSERT OR IGNORE para evitar crash, mas idealmente verificamos antes.
    const stmt = this.db.prepare(`
      INSERT INTO leads (id, telefone, nome, interesse, created_at, last_interaction, is_seller, is_synthetic, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      id, 
      lead.telefone, 
      lead.nome || 'Unknown', 
      lead.interesse || null, 
      now, 
      now, 
      lead.is_seller ? 1 : 0, 
      isSynthetic ? 1 : 0,
      metadata
    );
    
    const result = await stmt.first<Lead>();
    if (result && typeof result.metadata === 'string') {
        try { result.metadata = JSON.parse(result.metadata); } catch { /* Ignore invalid JSON */ }
    }
    return result;
  }

  async updateLead(id: string, data: Partial<Lead>): Promise<void> {
    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    // Safe: column names are from whitelist, not user input
    // Only predefined columns can be updated
    if (data.nome !== undefined) { updates.push('nome = ?'); values.push(data.nome); }
    if (data.interesse !== undefined) { updates.push('interesse = ?'); values.push(data.interesse); }
    if (data.last_interaction !== undefined) { updates.push('last_interaction = ?'); values.push(data.last_interaction); }
    if (data.is_seller !== undefined) { updates.push('is_seller = ?'); values.push(data.is_seller ? 1 : 0); }
    if (data.metadata !== undefined) { updates.push('metadata = ?'); values.push(JSON.stringify(data.metadata)); }

    if (updates.length === 0) return;

    values.push(id);
    // eslint-disable-next-line security/detect-sql-injection -- Updates from whitelist, values are parameterized
    const sql = `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`;
    await this.db.prepare(sql).bind(...values).run();
  }


  // --- MESSAGES ---

  async addMessage(msg: Message): Promise<void> {
    await this.db.prepare(`
      INSERT INTO messages (lead_id, role, content, created_at, sent)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      msg.lead_id,
      msg.role,
      msg.content,
      msg.created_at || new Date().toISOString(),
      msg.sent !== undefined ? (msg.sent ? 1 : 0) : 1
    ).run();
  }

  async getRecentMessages(leadId: string, limit: number = 20): Promise<Message[]> {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at DESC LIMIT ?').bind(leadId, limit);
    const { results } = await stmt.all<Message>();
    return results.reverse(); // Retorna em ordem cronológica (antiga -> nova) para contexto da IA
  }

  // --- FOLLOWUPS ---

  async createFollowup(leadId: string, scheduledAt: string, type: string, status: string = 'pending', message?: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO followups (lead_id, scheduled_at, term, status, message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(leadId, scheduledAt, type, status, message || null).run();
  }

  async cancelPendingFollowups(leadId: string): Promise<void> {
    await this.db.prepare('UPDATE followups SET status = ? WHERE lead_id = ? AND status = ?')
      .bind('cancelled', leadId, 'pending').run();
  }

  async getPendingFollowups(limit: number = 10): Promise<any[]> {
      const now = new Date().toISOString();
      // Pegar followups pendentes cuja data já passou ou é agora
      // GROUP BY lead_id para evitar múltiplos follow-ups para o mesmo lead
      // ORDER BY scheduled_at ASC para processar os mais antigos primeiro
      const stmt = this.db.prepare(`
          SELECT f.*, l.telefone, l.nome 
          FROM followups f
          JOIN leads l ON f.lead_id = l.id
          WHERE f.status = 'pending' AND f.scheduled_at <= ?
          GROUP BY f.lead_id
          ORDER BY f.scheduled_at ASC
          LIMIT ?
      `).bind(now, limit);
      const { results } = await stmt.all();
      return results;
  }

  async updateFollowupStatus(id: number, status: string): Promise<void> {
      await this.db.prepare('UPDATE followups SET status = ? WHERE id = ?').bind(status, id).run();
  }

  async getAllFollowups(limit: number = 50, offset: number = 0, status?: string): Promise<{ followups: any[], total: number }> {
      let query = `
        SELECT f.*, l.nome as lead_nome, l.telefone as lead_telefone 
        FROM followups f
        LEFT JOIN leads l ON f.lead_id = l.id
      `;
      const params: any[] = [];
      
      if (status) {
          query += ' WHERE f.status = ?';
          params.push(status);
      }
      
      query += ' ORDER BY f.scheduled_at ASC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const { results } = await this.db.prepare(query).bind(...params).all();
      
      // Count total
      const countQuery = status 
         ? 'SELECT COUNT(*) as total FROM followups WHERE status = ?'
         : 'SELECT COUNT(*) as total FROM followups';
      const countResult = await this.db.prepare(countQuery).bind(...(status ? [status] : [])).first<{ total: number }>();
      
      return { followups: results, total: countResult?.total || 0 };
  }

  async deleteFollowup(id: number): Promise<void> {
      await this.db.prepare('DELETE FROM followups WHERE id = ?').bind(id).run();
  }

  // --- CONFIG & VENDEDORES ---

  async getConfig(key: string): Promise<string | null> {
      const result = await this.db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first<{ value: string }>();
      return result ? result.value : null;
  }

  async getActiveSellers(): Promise<any[]> {
      const { results } = await this.db.prepare('SELECT * FROM vendedores WHERE ativo = 1').all();
      return results;
  }

  async getAllSellers(): Promise<any[]> {
      const { results } = await this.db.prepare('SELECT * FROM vendedores').all();
      return results;
  }

  async getLeads(limit: number = 50, offset: number = 0, status?: string): Promise<{ leads: Lead[], total: number }> {
    let query = 'SELECT * FROM leads';
    const params: any[] = [];
    
    if (status) { 
        query += " WHERE json_extract(metadata, '$.status') = ?";
        params.push(status);
    }
    
    query += ' ORDER BY last_interaction DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const { results } = await this.db.prepare(query).bind(...params).all<Lead>();
    
    // Parse metadata
    const leads = results.map(l => {
        if (typeof l.metadata === 'string') {
            try { l.metadata = JSON.parse(l.metadata); } catch { /* Ignore invalid JSON */ }
        }
        return l;
    });
    
    // Get total count for pagination headers
    const countQuery = status 
        ? "SELECT COUNT(*) as total FROM leads WHERE json_extract(metadata, '$.status') = ?" 
        : "SELECT COUNT(*) as total FROM leads";
    
    const countResult = await this.db.prepare(countQuery).bind(...(status ? [status] : [])).first<{ total: number }>();

    return { leads, total: countResult?.total || 0 }; 
  }

  async getLeadTranscript(leadId: string): Promise<Message[]> {
      // Get all messages for export (limit 1000 safety)
      const stmt = this.db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT 1000').bind(leadId);
      const { results } = await stmt.all<Message>();
      return results; // Chronological order
  }

  async getAllConfig(): Promise<any[]> {
      const { results } = await this.db.prepare('SELECT * FROM config').all();
      return results;
  }

  async setConfig(key: string, value: string): Promise<void> {
      await this.db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
        .bind(key, value, value).run();
  }

  // ============================================================
  // LID MAPPING FUNCTIONS (resolve LID to real phone number)
  // ============================================================

  /**
   * Get real phone number from LID mapping
   */
  async getLidMapping(lid: string): Promise<string | null> {
    try {
      const cleanLid = lid.replace('@lid', '').replace('@s.whatsapp.net', '');
      const { results } = await this.db.prepare('SELECT real_phone FROM lid_mappings WHERE lid = ?').bind(cleanLid).all<{real_phone: string}>();
      if (results && results.length > 0) {
        return results[0].real_phone;
      }
      return null;
    } catch (error) {
      console.error('[DB] Error getting LID mapping:', error);
      return null;
    }
  }

  /**
   * Save LID to real phone mapping
   */
  async saveLidMapping(lid: string, realPhone: string): Promise<void> {
    try {
      const cleanLid = lid.replace('@lid', '').replace('@s.whatsapp.net', '');
      const cleanPhone = realPhone.replace('@s.whatsapp.net', '').replace('@lid', '');
      
      await this.db.prepare(`
        INSERT INTO lid_mappings (lid, real_phone) 
        VALUES (?, ?) 
        ON CONFLICT(lid) DO UPDATE SET real_phone = ?, updated_at = datetime('now')
      `).bind(cleanLid, cleanPhone, cleanPhone).run();
      
      console.log(`[DB] Saved LID mapping: ${cleanLid} -> ${cleanPhone}`);
    } catch (error) {
      console.error('[DB] Error saving LID mapping:', error);
    }
  }

  /**
   * Update lead with real phone number (when we discover it from a LID)
   */
  async updateLeadRealPhone(lidPhone: string, realPhone: string): Promise<void> {
    try {
      const cleanLid = lidPhone.replace('@lid', '').replace('@s.whatsapp.net', '');
      const cleanReal = realPhone.replace('@s.whatsapp.net', '').replace('@lid', '');
      
      // Update lead telefone from LID to real number
      await this.db.prepare(`
        UPDATE leads SET telefone = ?, updated_at = datetime('now')
        WHERE telefone = ?
      `).bind(cleanReal, cleanLid).run();
      
      console.log(`[DB] Updated lead phone: ${cleanLid} -> ${cleanReal}`);
    } catch (error) {
      console.error('[DB] Error updating lead real phone:', error);
    }
  }
}
