import type { Env } from '@types';
import { getFromCache, setInCache, getFromKV, setInKV, CACHE_TTL, CACHE_TTL_SECONDS } from './cache.service';

/**
 * Netcar API Service - Stock, Depoimentos, Site
 * Base URL: https://www.netcarmultimarcas.com.br/api/v1/
 */

const BASE_URL = 'https://www.netcarmultimarcas.com.br/api/v1';

// =============== STOCK API ===============

interface StockBrand {
  marca: string;
  quantidade: number;
}

interface StockModel {
  modelo: string;
  quantidade: number;
}

/**
 * Get available car brands (cached 10 minutes)
 */
export async function getBrands(env: Env): Promise<string[]> {
  // Check Memory cache first (L1)
  const cached = getFromCache('brands_list');
  if (cached) {
    return JSON.parse(cached);
  }

  // Check KV cache (L2)
  const kvCached = await getFromKV<string[]>(env, 'brands_list');
  if (kvCached) {
    // Populate L1 for next time
    setInCache('brands_list', JSON.stringify(kvCached), CACHE_TTL.BRANDS);
    return kvCached;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/stock.php?action=enterprises`);
    const data = await response.json() as any;
    
    console.log('[STOCK] Brands response:', JSON.stringify(data).substring(0, 200));
    
    if (data.success && data.data) {
      // Cache the result in Memory
      setInCache('brands_list', JSON.stringify(data.data), CACHE_TTL.BRANDS);
      // Cache in KV (persistent)
      await setInKV(env, 'brands_list', data.data, CACHE_TTL_SECONDS.CONFIG);

      return data.data; // Returns array of strings like ["CHERY", "CHEVROLET", ...]
    }
    return [];
  } catch (error) {
    console.error('[STOCK] Error fetching brands:', error);
    return [];
  }
}

/**
 * Get models by brand
 */
export async function getModelsByBrand(brand: string, env: Env): Promise<StockModel[]> {
   const cacheKey = `models_${brand.toLowerCase()}`;
   
   // L1 Cache
   const cached = getFromCache(cacheKey);
   if (cached) return JSON.parse(cached);

   // L2 Cache
   const kvCached = await getFromKV<StockModel[]>(env, cacheKey);
   if (kvCached) {
     setInCache(cacheKey, JSON.stringify(kvCached), CACHE_TTL.STOCK);
     return kvCached;
   }

  try {
    const response = await fetch(`${BASE_URL}/stock.php?action=cars_by_brand&brand=${encodeURIComponent(brand)}`);
    const data = await response.json() as any;
    
    if (data.success && data.data) {
      setInCache(cacheKey, JSON.stringify(data.data), CACHE_TTL.STOCK);
      await setInKV(env, cacheKey, data.data, CACHE_TTL_SECONDS.STOCK);
      return data.data;
    }
    return [];
  } catch (error) {
    console.error('[STOCK] Error fetching models:', error);
    return [];
  }
}

/**
 * Get price range
 */
export async function getPriceRange(env: Env): Promise<{ min: number; max: number } | null> {
  const cacheKey = 'price_range';
  
  const kvCached = await getFromKV<{ min: number; max: number }>(env, cacheKey);
  if (kvCached) return kvCached;

  try {
    const response = await fetch(`${BASE_URL}/stock.php?action=price_range`);
    const data = await response.json() as any;
    
    if (data.success && data.data) {
      const result = {
        min: data.data.valor_min || 0,
        max: data.data.valor_max || 500000,
      };
      await setInKV(env, cacheKey, result, CACHE_TTL_SECONDS.CONFIG);
      return result;
    }
    return null;
  } catch (error) {
    console.error('[STOCK] Error fetching price range:', error);
    return null;
  }
}

/**
 * Get all car identifiers (models + brands) from API - for intent detection
 * This allows the system to recognize ANY car in the client's stock
 */
export async function getAllCarIdentifiers(env: Env): Promise<{ models: string[]; brands: string[] }> {
  const cacheKey = 'car_identifiers';
  
  // Check KV cache first
  const kvCached = await getFromKV<{ models: string[]; brands: string[] }>(env, cacheKey);
  if (kvCached) {
    console.log('[STOCK] Using cached car identifiers');
    return kvCached;
  }
  
  try {
    // Get brands from stock API
    const brandsResponse = await fetch(`${BASE_URL}/stock.php?action=enterprises`);
    const brandsData = await brandsResponse.json() as any;
    
    const brands: string[] = [];
    const models: string[] = [];
    
    if (brandsData.success && brandsData.data) {
      for (const brand of brandsData.data) {
        brands.push(brand.toLowerCase());
        
        // Get models for each brand
        try {
          const modelsResponse = await fetch(`${BASE_URL}/stock.php?action=cars_by_brand&brand=${encodeURIComponent(brand)}`);
          const modelsData = await modelsResponse.json() as any;
          
          if (modelsData.success && modelsData.data) {
            for (const item of modelsData.data) {
              if (item.modelo) {
                const modelName = item.modelo.split(' ')[0].toLowerCase();
                if (!models.includes(modelName)) {
                  models.push(modelName);
                }
              }
            }
          }
        } catch (e) {
          console.error(`[STOCK] Error fetching models for ${brand}:`, e);
        }
      }
    }
    
    const result = { models, brands };
    await setInKV(env, cacheKey, result, 3600); // Cache 1 hour
    console.log(`[STOCK] Cached ${models.length} models and ${brands.length} brands`);
    
    return result;
  } catch (error) {
    console.error('[STOCK] Error fetching car identifiers:', error);
    return {
      models: ['onix', 'hb20', 'polo', 'corolla', 'civic', 'kicks', 'creta', 'tracker', 'renegade'],
      brands: ['chevrolet', 'hyundai', 'volkswagen', 'toyota', 'honda', 'nissan', 'fiat', 'ford', 'jeep']
    };
  }
}

// =============== DEPOIMENTOS API ===============

interface Depoimento {
  id: string;
  nome: string;
  depoimento: string;  // API returns 'depoimento', not 'texto'
  titulo?: string;
  nota?: number;
  data: string;
}

/**
 * Get customer testimonials
 */
export async function getDepoimentos(env: Env, limit: number = 5): Promise<Depoimento[]> {
  const cacheKey = `depoimentos_${limit}`;
  const kvCached = await getFromKV<Depoimento[]>(env, cacheKey);
  if (kvCached) return kvCached;

  try {
    const response = await fetch(`${BASE_URL}/depoimentos.php?action=list&limit=${limit * 3}`); // Fetch more to filter
    const data = await response.json() as any;
    
    if (data.success && data.data) {
      // Filter out empty or whitespace-only testimonials
      const validDepoimentos = data.data
        .filter((d: any) => d.depoimento && d.depoimento.trim().length > 10)
        .slice(0, limit);
      
      if (validDepoimentos.length > 0) {
        await setInKV(env, cacheKey, validDepoimentos, CACHE_TTL_SECONDS.CONFIG);
        return validDepoimentos;
      }
    }
    return [];
  } catch (error) {
    console.error('[DEPOIMENTOS] Error fetching:', error);
    return [];
  }
}

// =============== SITE API ===============

interface SiteInfo {
  nome: string;
  endereco: string;
  telefone: string;
  whatsapp: string;
  email: string;
  horario: string;
}

/**
 * Get store information from official Netcar API
 * Endpoint: /api/v1/site?action=info
 * Falls back to hardcoded values if API fails
 */
export async function getSiteInfo(env?: Env): Promise<SiteInfo | null> {
  // Try official API first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${BASE_URL}/site?action=info`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      const json = await response.json() as { success?: boolean; data?: Record<string, unknown> };
      if (json.success && json.data) {
        const data = json.data;
        return {
          nome: String(data.nome || data.name || 'Netcar Multimarcas'),
          endereco: String(data.address_loja1 || data.endereco || 'Av. Presidente Vargas, 740 – Centro – Esteio/RS'),
          telefone: String(data.phone_loja1 || data.telefone || '(51) 3473-7900'),
          whatsapp: String(data.whatsapp || '(51) 98879-2817'),
          email: String(data.email || 'contato@netcarmultimarcas.com.br'),
          horario: String(data.schedule || data.horario || 'Seg a Sex 9h–18h | Sábado 9h–16h30'),
        };
      }
    }
  } catch (e) {
    console.warn('[NETCAR-API] getSiteInfo failed, using fallback:', e);
  }
  
  // Fallback to hardcoded values
  return {
    nome: 'Netcar Multimarcas',
    endereco: 'Loja 1: Av. Presidente Vargas, 740 – Centro – Esteio/RS\nLoja 2: Av. Presidente Vargas, 1106 – Centro – Esteio/RS',
    telefone: '(51) 3473-7900',
    whatsapp: '(51) 98879-2817',
    email: 'contato@netcarmultimarcas.com.br',
    horario: 'Seg a Sex 9h–18h | Sábado 9h–16h30',
  };
}

/**
 * Get store phone by location
 */
export async function getStorePhone(loja: string = 'Loja1'): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/site.php?action=phone&loja=${encodeURIComponent(loja)}`);
    const data = await response.json() as any;
    
    if (data.success && data.data) {
      return data.data.telefone;
    }
    return null;
  } catch (error) {
    console.error('[SITE] Error fetching phone:', error);
    return null;
  }
}

// =============== FORMATTED RESPONSES ===============

/**
 * Format brands list for chat
 */
export function formatBrandsList(brands: string[]): string {
  if (brands.length === 0) return 'Não encontrei marcas disponíveis no momento.';
  
  const list = brands
    .slice(0, 10)
    .map(b => `• ${b}`)
    .join('\n');
  
  return `Temos as seguintes marcas disponíveis:\n\n${list}\n\nQual marca te interessa?`;
}

/**
 * Format testimonials for chat
 */
export function formatDepoimentos(depoimentos: Depoimento[]): string {
  if (depoimentos.length === 0) return 'Não encontrei avaliações no momento.';
  
  const list = depoimentos
    .slice(0, 3)
    .map(d => {
      const texto = d.depoimento?.trim() || '';
      const nome = d.nome?.trim() || 'Cliente';
      return `⭐ "${texto}" - ${nome}`;
    })
    .join('\n\n');
  
  return `Veja o que nossos clientes dizem:\n\n${list}`;
}

/**
 * Format store info for chat
 */
export function formatSiteInfo(info: SiteInfo): string {
  return `*Netcar Multimarcas*\n\n` +
    `Endereço: ${info.endereco}\n` +
    `Telefone: ${info.telefone}\n` +
    `WhatsApp: ${info.whatsapp}\n` +
    `Horário: ${info.horario}`;
}

