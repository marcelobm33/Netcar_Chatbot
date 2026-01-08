/**
 * API NetCar - Funções legadas migradas
 * ======================================
 * Este arquivo mantém compatibilidade com o código existente
 * que importa de services/netcar-api.service.ts
 * 
 * Gradualmente migrar para usar diretamente:
 *   import { stock, site, depoimentos } from '../api';
 */

import type { Env } from '../types';
import { getFromCache, setInCache, getFromKV, setInKV, CACHE_TTL, CACHE_TTL_SECONDS } from '../worker/legacy/cache.service';
import * as stockAPI from './stock';
import * as siteAPI from './site';
import * as depoimentosAPI from './depoimentos';

// Re-export tipos originais para compatibilidade
export interface StockBrand {
  marca: string;
  quantidade: number;
}

export interface StockModel {
  modelo: string;
  quantidade: number;
}

export interface Depoimento {
  id: string;
  nome: string;
  depoimento: string;
  titulo?: string;
  nota?: number;
  data: string;
}

export interface SiteInfo {
  nome: string;
  endereco: string;
  telefone: string;
  whatsapp: string;
  email: string;
  horario: string;
}

// =============================================================================
// FUNÇÕES LEGADAS (mantidas para compatibilidade)
// =============================================================================

/**
 * @deprecated Use stockAPI.getBrands() diretamente
 */
export async function getBrands(env: Env): Promise<string[]> {
  // Usa cache existente
  const cacheKey = 'netcar:brands';
  const cached = await getFromKV<string[]>(env, cacheKey);
  if (cached) return cached;

  try {
    const brands = await stockAPI.getBrands();
    await setInKV(env, cacheKey, brands, CACHE_TTL_SECONDS.BRANDS);
    return brands;
  } catch (error) {
    console.error('[NETCAR-API] Error fetching brands:', error);
    return [];
  }
}

/**
 * @deprecated Use stockAPI.getModelsByBrand() diretamente
 */
export async function getModelsByBrand(brand: string, env: Env): Promise<StockModel[]> {
  const cacheKey = `netcar:models:${brand.toLowerCase()}`;
  const cached = await getFromKV<StockModel[]>(env, cacheKey);
  if (cached) return cached;

  try {
    const models = await stockAPI.getModelsByBrand(brand);
    const result: StockModel[] = models.map(m => ({ modelo: m, quantidade: 0 }));
    await setInKV(env, cacheKey, result, CACHE_TTL_SECONDS.MODELS);
    return result;
  } catch (error) {
    console.error('[NETCAR-API] Error fetching models:', error);
    return [];
  }
}

/**
 * @deprecated Use stockAPI.getPriceRange() diretamente
 */
export async function getPriceRange(env: Env): Promise<{ min: number; max: number } | null> {
  try {
    return await stockAPI.getPriceRange();
  } catch (error) {
    console.error('[NETCAR-API] Error fetching price range:', error);
    return null;
  }
}

/**
 * Get all car identifiers (models + brands) from API - for intent detection
 */
export async function getAllCarIdentifiers(env: Env): Promise<{ models: string[]; brands: string[] }> {
  const cacheKey = 'netcar:identifiers';
  const cached = await getFromKV<{ models: string[]; brands: string[] }>(env, cacheKey);
  if (cached) return cached;

  try {
    const brands = await getBrands(env);
    const allModels: string[] = [];

    for (const brand of brands) {
      const models = await getModelsByBrand(brand, env);
      allModels.push(...models.map(m => m.modelo));
    }

    const result = { models: allModels, brands };
    await setInKV(env, cacheKey, result, CACHE_TTL_SECONDS.BRANDS);
    return result;
  } catch (error) {
    console.error('[NETCAR-API] Error fetching identifiers:', error);
    return { models: [], brands: [] };
  }
}

/**
 * @deprecated Use depoimentosAPI.listDepoimentos() diretamente
 */
export async function getDepoimentos(env: Env, limit: number = 5): Promise<Depoimento[]> {
  try {
    const result = await depoimentosAPI.listDepoimentos(limit, 0);
    if (result.success && Array.isArray(result.data)) {
      return (result.data as any[]).map(d => ({
        id: String(d.id),
        nome: d.nome,
        depoimento: d.depoimento,
        titulo: d.titulo,
        nota: d.avaliacao,
        data: d.data,
      }));
    }
    return [];
  } catch (error) {
    console.error('[NETCAR-API] Error fetching depoimentos:', error);
    return [];
  }
}

/**
 * @deprecated Use siteAPI.getSiteInfo() diretamente
 */
export async function getSiteInfo(): Promise<SiteInfo | null> {
  return {
    nome: 'Netcar Multimarcas',
    endereco: 'Av. Assis Brasil, 5000 - Sarandi, Porto Alegre - RS',
    telefone: '(51) 3364-3737',
    whatsapp: '(51) 99999-9999',
    email: 'contato@netcarmultimarcas.com.br',
    horario: 'Segunda a Sexta: 8h às 18h | Sábado: 8h às 12h',
  };
}

/**
 * @deprecated Use siteAPI.getPhone() diretamente
 */
export async function getStorePhone(loja: string = 'Loja1'): Promise<string | null> {
  try {
    return await siteAPI.getPhone(loja);
  } catch {
    return '(51) 3364-3737';
  }
}

// =============================================================================
// FORMATTERS (mantidos)
// =============================================================================

export function formatBrandsList(brands: string[]): string {
  if (!brands.length) return 'Não encontrei marcas disponíveis no momento.';
  
  const formatted = brands
    .slice(0, 15)
    .map(b => `• ${b}`)
    .join('\n');
  
  return `🚗 *Marcas disponíveis:*\n\n${formatted}`;
}

export function formatDepoimentos(depoimentos: Depoimento[]): string {
  if (!depoimentos.length) return 'Não encontrei depoimentos no momento.';
  
  return depoimentos
    .slice(0, 3)
    .map(d => `⭐ *${d.nome}*: "${d.depoimento.slice(0, 100)}..."`)
    .join('\n\n');
}

export function formatSiteInfo(info: SiteInfo): string {
  return `📍 *${info.nome}*
📞 ${info.telefone}
📱 WhatsApp: ${info.whatsapp}
📧 ${info.email}
⏰ ${info.horario}`;
}
