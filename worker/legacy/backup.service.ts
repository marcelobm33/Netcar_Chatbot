/**
 * Backup Service - Cloudflare D1 Edition
 * ===========================================================
 * Exporta tabelas críticas do D1 para R2 diariamente
 * 100% sem Supabase
 * 
 * RTO: < 4 horas (Recovery Time Objective)
 * RPO: 24 horas (Recovery Point Objective - máx 1 dia de perda)
 * 
 * Retenção: 30 dias
 * ===========================================================
 */
import type { Env } from '@types';

// Tabelas para backup (dados críticos do D1)
const BACKUP_TABLES = [
  'leads',
  'config',
  'error_logs',
  'vendedores',
  'followup_queue',
];

// Período de retenção em dias
const RETENTION_DAYS = 30;

/**
 * Executa backup diário de todas as tabelas críticas para R2
 * Deve ser chamado pelo handler de scheduled (cron)
 */
export async function runDailyBackup(env: Env): Promise<{ success: boolean; tables: number; size: number }> {
  const startTime = Date.now();
  console.log('[BACKUP] Iniciando backup diário do D1...');
  
  if (!env.CACHE_BUCKET) {
    console.error('[BACKUP] Bucket R2 não configurado!');
    return { success: false, tables: 0, size: 0 };
  }
  
  if (!env.DB) {
    console.error('[BACKUP] Banco D1 não configurado!');
    return { success: false, tables: 0, size: 0 };
  }
  
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const timestamp = Date.now();
  
  let totalSize = 0;
  let tablesBackedUp = 0;
  const errors: string[] = [];
  
  for (const table of BACKUP_TABLES) {
    try {
      // Buscar todos os dados da tabela via D1
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      
      if (result.error) {
        console.error(`[BACKUP] Erro ao buscar ${table}:`, result.error);
        errors.push(`${table}: ${result.error}`);
        continue;
      }
      
      const data = result.results || [];
      
      // Preparar dados do backup
      const backupData = {
        table,
        source: 'cloudflare-d1',
        exportedAt: new Date().toISOString(),
        rowCount: data.length,
        data,
      };
      
      const jsonStr = JSON.stringify(backupData, null, 2);
      const size = new TextEncoder().encode(jsonStr).length;
      totalSize += size;
      
      // Salvar no R2
      const key = `backups/${date}/${table}_${timestamp}.json`;
      await env.CACHE_BUCKET.put(key, jsonStr, {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          table,
          source: 'd1',
          rowCount: String(data.length),
          exportedAt: new Date().toISOString(),
        },
      });
      
      console.log(`[BACKUP] ✅ ${table}: ${data.length} linhas, ${(size / 1024).toFixed(2)} KB`);
      tablesBackedUp++;
      
    } catch (err) {
      console.error(`[BACKUP] Falha ao fazer backup de ${table}:`, err);
      errors.push(`${table}: ${String(err)}`);
    }
  }
  
  // Criar manifesto do backup
  const manifest = {
    date,
    timestamp,
    source: 'cloudflare-d1',
    tablesBackedUp,
    totalSize,
    errors,
    duration: Date.now() - startTime,
    rpo: '24h',
    rto: '4h',
  };
  
  await env.CACHE_BUCKET.put(`backups/${date}/manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  
  console.log(`[BACKUP] Completo: ${tablesBackedUp}/${BACKUP_TABLES.length} tabelas, ${(totalSize / 1024).toFixed(2)} KB total, ${Date.now() - startTime}ms`);
  
  // Limpar backups antigos
  await cleanupOldBackups(env);
  
  return {
    success: errors.length === 0,
    tables: tablesBackedUp,
    size: totalSize,
  };
}

/**
 * Limpar backups mais antigos que RETENTION_DAYS
 */
async function cleanupOldBackups(env: Env): Promise<number> {
  console.log(`[BACKUP] Limpando backups com mais de ${RETENTION_DAYS} dias...`);
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  
  let deleted = 0;
  
  try {
    // Listar todas as pastas de backup
    const list = await env.CACHE_BUCKET.list({ prefix: 'backups/' });
    
    for (const obj of list.objects) {
      // Extrair data da key (backups/YYYY-MM-DD/...)
      const match = obj.key.match(/backups\/(\d{4}-\d{2}-\d{2})\//);
      if (match && match[1] < cutoffStr) {
        await env.CACHE_BUCKET.delete(obj.key);
        deleted++;
      }
    }
    
    if (deleted > 0) {
      console.log(`[BACKUP] Removidos ${deleted} arquivos de backup antigos`);
    }
  } catch (err) {
    console.error('[BACKUP] Erro durante limpeza:', err);
  }
  
  return deleted;
}

/**
 * Restaurar uma tabela a partir do backup
 * Usado em cenários de disaster recovery
 * ATENÇÃO: Isso sobrescreve dados existentes!
 */
export async function restoreFromBackup(
  env: Env,
  date: string,
  table: string
): Promise<{ success: boolean; rowsRestored: number }> {
  console.log(`[RESTORE] Iniciando restauração de ${table} de ${date}...`);
  
  try {
    // Encontrar o arquivo de backup
    const list = await env.CACHE_BUCKET.list({ 
      prefix: `backups/${date}/${table}_` 
    });
    
    if (list.objects.length === 0) {
      console.error(`[RESTORE] Nenhum backup encontrado para ${table} em ${date}`);
      return { success: false, rowsRestored: 0 };
    }
    
    // Pegar o backup mais recente daquele dia
    const latestBackup = list.objects.sort((a, b) => 
      b.key.localeCompare(a.key)
    )[0];
    
    const obj = await env.CACHE_BUCKET.get(latestBackup.key);
    if (!obj) {
      console.error('[RESTORE] Não foi possível recuperar arquivo de backup');
      return { success: false, rowsRestored: 0 };
    }
    
    const backupData = await obj.json() as { table: string; data: Record<string, unknown>[] };
    
    console.log(`[RESTORE] ⚠️ Restaurando ${backupData.data.length} linhas para ${table}...`);
    
    // Inserir dados em lotes
    let restored = 0;
    const batchSize = 50;
    
    for (let i = 0; i < backupData.data.length; i += batchSize) {
      const batch = backupData.data.slice(i, i + batchSize);
      
      for (const row of batch) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const placeholders = columns.map(() => '?').join(', ');
          
          // Usar INSERT OR REPLACE para upsert
          await env.DB.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
          ).bind(...values).run();
          
          restored++;
        } catch (rowErr) {
          console.error(`[RESTORE] Erro ao restaurar linha:`, rowErr);
        }
      }
    }
    
    console.log(`[RESTORE] ✅ Restauradas ${restored} linhas para ${table}`);
    return { success: true, rowsRestored: restored };
    
  } catch (err) {
    console.error('[RESTORE] Falha:', err);
    return { success: false, rowsRestored: 0 };
  }
}

/**
 * Listar backups disponíveis
 */
export async function listBackups(env: Env): Promise<{ date: string; tables: string[]; source: string }[]> {
  const backups: Map<string, string[]> = new Map();
  
  try {
    const list = await env.CACHE_BUCKET.list({ prefix: 'backups/' });
    
    for (const obj of list.objects) {
      const match = obj.key.match(/backups\/(\d{4}-\d{2}-\d{2})\/([^_]+)_/);
      if (match) {
        const date = match[1];
        const table = match[2];
        
        if (!backups.has(date)) {
          backups.set(date, []);
        }
        if (!backups.get(date)!.includes(table)) {
          backups.get(date)!.push(table);
        }
      }
    }
  } catch (err) {
    console.error('[BACKUP] Erro ao listar backups:', err);
  }
  
  return Array.from(backups.entries())
    .map(([date, tables]) => ({ date, tables, source: 'd1' }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
