/**
 * Prompt Layers Service
 * Manages base prompt (memory 0) and extensions
 */

import { Env } from '@types';

export interface PromptLayer {
  id: number;
  layer_type: 'base' | 'extension';
  name: string;
  content: string;
  is_active: boolean;
  is_deletable: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Initialize prompt layers table and migrate existing prompt
 */
export async function initPromptLayers(env: Env): Promise<void> {
  const db = env.DB;
  
  // Check if base prompt exists
  const existing = await db.prepare(
    `SELECT id FROM prompt_layers WHERE layer_type = 'base' LIMIT 1`
  ).first();
  
  if (!existing) {
    // Migrate current system_prompt to base layer
    const currentPrompt = await db.prepare(
      `SELECT value FROM config WHERE key = 'system_prompt'`
    ).first<{ value: string }>();
    
    if (currentPrompt?.value) {
      await db.prepare(`
        INSERT INTO prompt_layers (layer_type, name, content, is_deletable)
        VALUES ('base', 'Memória 0 - Prompt Base', ?, 0)
      `).bind(currentPrompt.value).run();
      
      console.log('[PROMPT_LAYERS] Migrated system_prompt to base layer');
    }
  }
}

/**
 * Get all prompt layers
 */
export async function getPromptLayers(env: Env): Promise<PromptLayer[]> {
  const db = env.DB;
  const result = await db.prepare(`
    SELECT * FROM prompt_layers 
    ORDER BY 
      CASE layer_type WHEN 'base' THEN 0 ELSE 1 END,
      created_at ASC
  `).all<PromptLayer>();
  
  return result.results || [];
}

/**
 * Get base prompt only
 */
export async function getBasePrompt(env: Env): Promise<string> {
  const db = env.DB;
  const result = await db.prepare(
    `SELECT content FROM prompt_layers WHERE layer_type = 'base' AND is_active = 1 LIMIT 1`
  ).first<{ content: string }>();
  
  return result?.content || '';
}

/**
 * Get active extensions
 */
export async function getActiveExtensions(env: Env): Promise<PromptLayer[]> {
  const db = env.DB;
  const result = await db.prepare(
    `SELECT * FROM prompt_layers WHERE layer_type = 'extension' AND is_active = 1 ORDER BY created_at ASC`
  ).all<PromptLayer>();
  
  return result.results || [];
}

/**
 * Build final prompt by combining base + active extensions
 */
export async function buildFinalPrompt(env: Env): Promise<string> {
  const base = await getBasePrompt(env);
  const extensions = await getActiveExtensions(env);
  
  if (extensions.length === 0) {
    return base;
  }
  
  const extensionContents = extensions.map(e => 
    `## Extensão: ${e.name}\n\n${e.content}`
  ).join('\n\n---\n\n');
  
  return `${base}\n\n---\n\n# EXTENSÕES ATIVAS\n\n${extensionContents}`;
}

/**
 * Analyze new extension proposal for duplicates/conflicts
 * NOTE: Simplified to always approve - no blocking for duplicates/conflicts
 */
export async function analyzeExtensionProposal(
  newContent: string,
  env: Env
): Promise<{
  status: 'approved' | 'duplicate' | 'conflict' | 'error';
  message?: string;
  suggestion?: string;
}> {
  // Always approve - let the user manage their own prompts
  // Previous AI analysis was too restrictive and blocking valid extensions
  console.log('[PROMPT_LAYERS] Extension proposal auto-approved (AI check disabled)');
  
  return { 
    status: 'approved', 
    message: 'Extensão aprovada. Você pode adicionar clicando em Salvar.' 
  };
}

/**
 * Add new extension
 */
export async function addExtension(
  name: string,
  content: string,
  env: Env
): Promise<{ success: boolean; id?: number; error?: string }> {
  const db = env.DB;
  
  try {
    const result = await db.prepare(`
      INSERT INTO prompt_layers (layer_type, name, content, is_deletable)
      VALUES ('extension', ?, ?, 1)
    `).bind(name, content).run();
    
    console.log(`[PROMPT_LAYERS] Added extension: ${name}`);
    return { success: true, id: result.meta.last_row_id };
  } catch (error: any) {
    console.error('[PROMPT_LAYERS] Error adding extension:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete extension (only if deletable)
 */
export async function deleteExtension(
  id: number,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const db = env.DB;
  
  // Check if deletable
  const layer = await db.prepare(
    `SELECT is_deletable, name FROM prompt_layers WHERE id = ?`
  ).bind(id).first<{ is_deletable: number; name: string }>();
  
  if (!layer) {
    return { success: false, error: 'Extensão não encontrada.' };
  }
  
  if (!layer.is_deletable) {
    return { success: false, error: 'Prompt base não pode ser deletado.' };
  }
  
  await db.prepare(`DELETE FROM prompt_layers WHERE id = ?`).bind(id).run();
  console.log(`[PROMPT_LAYERS] Deleted extension: ${layer.name}`);
  
  return { success: true };
}

/**
 * Toggle extension active status
 */
export async function toggleExtension(
  id: number,
  isActive: boolean,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const db = env.DB;
  
  await db.prepare(`
    UPDATE prompt_layers 
    SET is_active = ?, updated_at = datetime('now')
    WHERE id = ? AND layer_type = 'extension'
  `).bind(isActive ? 1 : 0, id).run();
  
  return { success: true };
}

/**
 * Update base prompt (admin only)
 */
export async function updateBasePrompt(
  content: string,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const db = env.DB;
  
  await db.prepare(`
    UPDATE prompt_layers 
    SET content = ?, updated_at = datetime('now')
    WHERE layer_type = 'base'
  `).bind(content).run();
  
  // Also update legacy config for backwards compatibility
  await db.prepare(`
    INSERT OR REPLACE INTO config (key, value, updated_at)
    VALUES ('system_prompt', ?, datetime('now'))
  `).bind(content).run();
  
  return { success: true };
}
