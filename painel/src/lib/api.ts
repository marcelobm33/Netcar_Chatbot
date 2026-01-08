const WORKER_URL = process.env.NEXT_PUBLIC_API_URL || 'https://netcar-worker.contato-11e.workers.dev';

// Helper for authorized fetch
async function adminFetch(path: string, options: RequestInit = {}) {
  // Retrieve token from storage (Client only)
  let token = '';
  if (typeof window !== 'undefined') {
    token = localStorage.getItem('admin_token') || '';
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
        window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API Error ${res.status}: ${err}`);
  }

  return res.json();
}

export interface Vendedor {
  id: number;
  nome: string;
  whatsapp: string;
  imagem?: string;
  ativo: boolean;
}

export interface Lead {
  id: string;
  telefone: string;
  nome: string;
  interesse?: string;
  last_interaction?: string;
  created_at: string;
  
  // Flattened metadata fields
  status: string;
  vendedor_id?: number;
  vendedor_nome?: string;
  score?: number;
  next_step?: string;
  origin_source?: string;
  ia_summary?: string;
  modelo_interesse?: string;
  
  metadata?: any;
}

export interface BlocklistEntry {
    telefone: string; 
    motivo: string; 
    pausado_em: string; 
    expira_em: string;
}

export const api = {
  getLeads: async (limit: number = 50, offset: number = 0, status?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.append('status', status);
    
    const response: any = await adminFetch(`/api/admin/leads?${params.toString()}`);
    const rawLeads = response.leads || [];
    
    // Client-side flattening to match React component expectations
    const leads: Lead[] = rawLeads.map((l: any) => {
        const meta = l.metadata || {};
        return {
            ...l,
            status: meta.status || 'novo',
            vendedor_id: meta.vendedor_id,
            vendedor_nome: meta.vendedor_nome,
            score: meta.score,
            next_step: meta.next_step,
            origin_source: meta.origin_source || 'organic',
            ia_summary: meta.ia_summary || meta.resumo_ia,
            modelo_interesse: meta.modelo_interesse || l.interesse,
            // Ensure created_at exists
            created_at: l.created_at || new Date().toISOString()
        };
    });

    return { leads, total: 0 };
  },

  getBlocklist: async (limit: number = 100, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return adminFetch(`/api/admin/blocklist?${params.toString()}`);
  },

  addToBlocklist: async (phone: string, reason: string, days: number = 30) => {
    return adminFetch('/api/admin/blocklist', {
      method: 'POST',
      body: JSON.stringify({ phone, reason, days })
    });
  },

  removeFromBlocklist: async (phone: string) => {
    return adminFetch('/api/admin/blocklist', {
      method: 'DELETE', // Assuming DELETE method added or handled
      body: JSON.stringify({ phone })
    });
  },

  getConfig: async (key?: string) => {
    const path = key ? `/api/admin/config?key=${encodeURIComponent(key)}` : '/api/admin/config';
    return adminFetch(path);
  },


  setConfig: async (key: string, value: string) => {
    return adminFetch('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify({ key, value })
    });
  },

  appendSystemPrompt: async (instruction: string) => {
    return adminFetch('/api/admin/prompt/append', {
        method: 'POST',
        body: JSON.stringify({ instruction })
    });
  },

  getPromptDebug: async () => {
    return adminFetch('/api/admin/debug/prompt');
  },

  getSellers: async () => {
      return adminFetch('/api/admin/sellers');
  },

  updateLead: async (id: string, data: any) => {
      return adminFetch(`/api/admin/leads/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data)
      });
  },

  deleteLead: async (id: string) => {
      return adminFetch(`/api/admin/leads/${id}`, {
          method: 'DELETE'
      });
  },

  sendVCard: async (phone: string, seller_id: number) => {
      return adminFetch('/api/admin/chat/send-vcard', {
          method: 'POST',
          body: JSON.stringify({ phone, seller_id })
      });
  },

  saveSeller: async (data: any) => {
      return adminFetch('/api/admin/sellers', {
          method: 'POST',
          body: JSON.stringify(data)
      });
  },

  deleteSeller: async (id: number) => {
      return adminFetch(`/api/admin/sellers/${id}`, {
          method: 'DELETE'
      });
  },

  uploadImage: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const token = localStorage.getItem('admin_token') || '';
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://netcar-worker.contato-11e.workers.dev';
      const res = await fetch(`${apiUrl}/api/admin/upload`, {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${token}`
              // Content-Type header must NOT be set manually for FormData
          },
          body: formData
      });
      
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
      }

      if (!res.ok) throw new Error('Upload failed');
      return res.json();
  },

  // Store Hours - REMOVED
  // Store hours now come from official Netcar API (/api/v1/site?action=info)
  // No longer configurable via admin panel

  // Prompt Version APIs
  getPromptVersions: async () => {
    return adminFetch('/api/admin/prompt/versions');
  },

  restorePromptVersion: async (id: number) => {
    return adminFetch(`/api/admin/prompt/versions/${id}/restore`, {
      method: 'POST'
    });
  },

  restoreFallbackPrompt: async () => {
    return adminFetch('/api/admin/prompt/restore-fallback', {
      method: 'POST'
    });
  },

  // ========================================
  // Prompt Layers API (Arquitetura em Camadas)
  // ========================================

  /**
   * Retorna todas as camadas de prompt (base + extensões)
   */
  getPromptLayers: async () => {
    return adminFetch('/api/admin/prompts');
  },

  /**
   * Envia uma proposta de extensão para análise da IA Guardiã
   */
  proposeExtension: async (content: string) => {
    return adminFetch('/api/admin/prompts/propose', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  },

  /**
   * Adiciona uma nova extensão após aprovação da IA Guardiã
   */
  addExtension: async (name: string, content: string) => {
    return adminFetch('/api/admin/prompts', {
      method: 'POST',
      body: JSON.stringify({ name, content })
    });
  },

  /**
   * Deleta uma extensão (não permite deletar o prompt base)
   */
  deleteLayer: async (id: number) => {
    return adminFetch(`/api/admin/prompts/${id}`, {
      method: 'DELETE'
    });
  },

  /**
   * Atualiza o prompt base (Memória 0) - Por conta e risco do cliente
   */
  updateBasePrompt: async (prompt: string) => {
    return adminFetch('/api/admin/prompt/update', {
      method: 'POST',
      body: JSON.stringify({ prompt })
    });
  },

  /**
   * Ativa ou desativa uma extensão
   */
  toggleLayer: async (id: number) => {
    return adminFetch(`/api/admin/prompts/${id}/toggle`, {
      method: 'PATCH'
    });
  },

  // ========================================
  // Maintenance Mode API
  // ========================================

  /**
   * Verifica se o modo manutenção está ativo
   */
  getMaintenanceMode: async () => {
    return adminFetch('/api/admin/maintenance');
  },

  /**
   * Ativa ou desativa o modo manutenção
   */
  setMaintenanceMode: async (enabled: boolean) => {
    return adminFetch('/api/admin/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
  }
};

