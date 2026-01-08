import type { Env, CarData } from '@types';
import { getFromKV, setInKV, CACHE_TTL_SECONDS } from './cache.service';

const NETCAR_API_URL = 'https://www.netcarmultimarcas.com.br/api/v1/veiculos.php';

/**
 * Search cars from Netcar API
 */
export async function searchCars(
  filters: {
    modelo?: string;
    marca?: string;
    precoMin?: number;
    precoMax?: number;
    anoMin?: number;
    anoMax?: number;
    categoria?: string;  // SUV, HATCH, SEDAN, PICKUP, etc.
    cor?: string;        // Color filter
    transmissao?: string; // Automatic/Manual
    opcional?: string;   // Optional feature filter (teto_panoramico, apple_carplay, etc)
    motor?: string;      // Engine filter (1.3, 2.0, 1.0 turbo, etc)
    limit?: number;
  },
  env: Env
): Promise<CarData[]> {
  // Swap min/max if inverted
  let { precoMin, precoMax } = filters;
  if (precoMin && precoMax && precoMin > precoMax) {
    console.log(`[CAR_SEARCH] Swapping inverted prices: ${precoMin} <-> ${precoMax}`);
    [precoMin, precoMax] = [precoMax, precoMin];
  }

  // Validate prices (Bug #2: Input Validation)
  if (precoMin && precoMin < 0) {
    console.warn(`[CAR_SEARCH] Negative min price ${precoMin}, resetting to 0`);
    precoMin = 0;
  }
  
  // Reasonable max limit (5M) to avoid integer overflows or nonsense queries
  if (precoMax && precoMax > 5000000) {
     console.warn(`[CAR_SEARCH] Max price ${precoMax} too high, capping at 5000000`);
     precoMax = 5000000;
  }

  const params = new URLSearchParams();
  
  // Handle OR search: "ka|hb20" means search for both Ka AND HB20
  // If modelo contains "|", we'll do parallel searches and combine results
  const isOrSearch = filters.modelo ? filters.modelo.includes('|') : false;
  const modelos = isOrSearch && filters.modelo ? filters.modelo.split('|') : (filters.modelo ? [filters.modelo] : []);
  
  // ⚠️ IMPORTANT: Do NOT send 'modelo' to API - it's too strict!
  // The API returns 0 results for slight name variations (e.g., "Tigo" vs "Tiggo 5x")
  // Instead, we fetch a broader set and filter locally with robust matching.
  // The local filter (lines 303+) handles normalization, accents, and substring matching.
  
  // For OR search, we still search by each model to reduce dataset
  // But for single model, we search by brand only (if provided) or general
  
  // 🔧 BRAND NORMALIZATION: Map user-friendly names to API-compatible names
  // The Netcar API may use different brand names than what users type
  const brandNormalization: Record<string, string> = {
    'CAOA CHERY': 'CHERY',
    'CAOA': 'CHERY',
    'VW': 'VOLKSWAGEN',
    'GM': 'CHEVROLET',
    'GENERAL MOTORS': 'CHEVROLET',
    'MERCEDES BENZ': 'MERCEDES-BENZ',
    'MERCEDES': 'MERCEDES-BENZ',
    'LAND ROVER': 'LANDROVER',
  };
  
  let normalizedMarca = filters.marca?.toUpperCase() || '';
  if (normalizedMarca && brandNormalization[normalizedMarca]) {
    console.log(`[CAR_SEARCH] Normalizing brand: ${normalizedMarca} -> ${brandNormalization[normalizedMarca]}`);
    normalizedMarca = brandNormalization[normalizedMarca];
  }
  
  if (normalizedMarca) params.set('montadora', normalizedMarca);
  // NOTE: categoria is NOT supported by API - we filter locally
  if (precoMin) params.set('valor_min', String(precoMin));
  if (precoMax) params.set('valor_max', String(precoMax));
  if (filters.anoMin) params.set('ano_min', String(filters.anoMin));
  if (filters.anoMax) params.set('ano_max', String(filters.anoMax));
  // Increase limit to 500 since we're filtering locally for modelo
  // This ensures we find the car even if it's not in the first 100
  const needsLocalFiltering = !!filters.cor || !!filters.categoria || !!filters.transmissao || !!filters.opcional || !!filters.motor || !!filters.modelo;
  const defaultLimit = needsLocalFiltering ? 500 : 100;
  params.set('limit', String(filters.limit || defaultLimit));
  params.set('offset', '0');

  // Generating Cache Key for Search (KV)
  // We sort keys to ensure consistent hashing for {a:1, b:2} and {b:2, a:1}
  const cacheKeyObj = { ...filters, limit: filters.limit || defaultLimit };
  const sortedKeys = Object.keys(cacheKeyObj).sort();
  const cacheKeyStr = sortedKeys.map(k => `${k}:${(cacheKeyObj as any)[k]}`).join('|');
  
  // Create a short hash for the key
  let hash = 0;
  for (let i = 0; i < cacheKeyStr.length; i++) {
    const char = cacheKeyStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const cacheKey = `search_${Math.abs(hash)}`;

  // Try to get from KV
  try {
    const cachedResults = await getFromKV<CarData[]>(env, cacheKey);
    if (cachedResults) {
        console.log(`[CAR_SEARCH] Serving ${cachedResults.length} cars from KV Cache (${cacheKey})`);
        return cachedResults;
    }
  } catch (e) {
    console.warn('[CAR_SEARCH] Cache lookup failed', e);
  }
  // ============ OR SEARCH: Multiple models in parallel ============
  // If searching for "ka|hb20", we do parallel searches and merge results
  if (isOrSearch && modelos.length > 1) {
    console.log(`[CAR_SEARCH] OR Search detected: ${modelos.join(' OR ')}`);
    
    const parallelSearches = modelos.map(async (modelo) => {
      const singleParams = new URLSearchParams(params.toString());
      singleParams.set('modelo', modelo);
      const singleUrl = `${NETCAR_API_URL}?${singleParams}`;
      console.log(`[CAR_SEARCH] Parallel fetch for ${modelo}: ${singleUrl}`);
      
      const resp = await fetch(singleUrl);
      if (!resp.ok || resp.status === 404) {
        console.log(`[CAR_SEARCH] No results for ${modelo}`);
        return [];
      }
      const rawData = await resp.json() as Record<string, unknown>;
      const items = (rawData as Record<string, unknown>).veiculos || rawData;
      return Array.isArray(items) ? items : [];
    });
    
    const allResults = await Promise.all(parallelSearches);
    const mergedCars = allResults.flat();
    
    // Dedup by ID
    const seenIds = new Set<string>();
    const uniqueCars = mergedCars.filter((car: Record<string, unknown>) => {
      const id = String(car.id);
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
    
    console.log(`[CAR_SEARCH] OR Search found ${uniqueCars.length} unique cars from ${modelos.join(' + ')}`);
    
    // Return merged results - the calling code will apply any additional filters
    // Note: For OR search, we return all found cars without additional filtering here
    // to maximize results. The caller can filter further if needed.
    return uniqueCars as CarData[];
  }
  // ============ END OR SEARCH ============

  const url = `${NETCAR_API_URL}?${params}`;
  console.log(`[CAR_SEARCH] Fetching: ${url}`);

  try {
    const response = await fetch(url);
    
    // Handle 404 as "No cars found" (Netcar API behavior)
    if (response.status === 404) {
      console.log('[CAR_SEARCH] API returned 404 (No cars found for filters)');
      await response.body?.cancel();
      return [];
    }
    
    if (!response.ok) {
      console.error(`[CAR_SEARCH] API error: ${response.status}`);
      await response.body?.cancel();
      return [];
    }

    const rawData = await response.json() as any;
    console.log(`[CAR_SEARCH] Raw response type: ${typeof rawData}, isArray: ${Array.isArray(rawData)}, total: ${rawData?.total_results || 'N/A'}`);
    
    // Handle Netcar API response format: { total_results: N, data: [...] }
    let data: any[];
    if (Array.isArray(rawData)) {
      data = rawData;
    } else if (rawData && rawData.data && Array.isArray(rawData.data)) {
      data = rawData.data;
    } else {
      console.error('[CAR_SEARCH] Invalid response format, raw:', JSON.stringify(rawData).substring(0, 300));
      return [];
    }

    // Dedup Set (Bug #3)
    const seenIds = new Set<string>();
    
    // Moto Blocklist (Bug: Motos in car search)
    const motoKeywords = ['BIZ', 'CG ', 'TITAN', 'NMAX', 'XMAX', 'PCX', 'FACTOR', 'FAZER', 'CB ', 'XRE', 'BROS'];

    // Filter out sold cars AND mismatched brands (Toyota vs Honda bug) AND duplicates
    data = data.filter((car: any) => {
      // Check for sold cars - multiple conditions
      const valorStr = String(car.valor_formatado || car.valor || '').toUpperCase();
      const valorNum = parseFloat(String(car.valor || '0').replace(/[^\d]/g, '')) || 0;
      
      // Exclude if: contains "VENDIDO" OR valor is 0 (sold indicator)
      if (valorStr.includes('VENDIDO') || valorNum === 0) {
        console.log(`[CAR_SEARCH] Filtered out sold car: ${car.modelo} (valor: ${car.valor})`);
        return false;
      }

      // Dedup check
      const id = String(car.id);
      if (seenIds.has(id)) {
        console.warn(`[CAR_SEARCH] Duplicate car ID found: ${id}`);
        return false;
      }
      seenIds.add(id);

      // Moto Check
      const modeloUpper = String(car.modelo || '').toUpperCase();
      if (motoKeywords.some(keyword => modeloUpper.includes(keyword))) {
        console.warn(`[CAR_SEARCH] Filtered out motorcycle: ${car.modelo}`);
        return false;
      }

      // Strict brand check if filter exists and car has brand info
      if (filters.marca && car.marca) {
        const requested = filters.marca.toUpperCase();
        const actual = String(car.marca).toUpperCase();
        if (!actual.includes(requested) && !requested.includes(actual)) {
          console.warn(`[CAR_SEARCH] Filtered out mismatched brand: Requested ${requested}, Got ${actual}`);
          return false;
        }
      }
      
      // Color filter (Item 2) - Local filtering as API may not support
      if (filters.cor && car.cor) {
        const requestedColor = filters.cor.toUpperCase();
        const actualColor = String(car.cor).toUpperCase();
        if (!actualColor.includes(requestedColor) && !requestedColor.includes(actualColor)) {
          console.warn(`[CAR_SEARCH] Filtered out mismatched color: Requested ${requestedColor}, Got ${actualColor}`);
          return false;
        }
      }
      
      // Filter by Transmission (Fix "automático")
      if (filters.transmissao) {
        const carCambio = String(car.cambio || '').toUpperCase(); // AUTOMÁTICO, MANUAL
        const filterTransmissao = filters.transmissao.toUpperCase(); // AUTOMATICO, MANUAL
        
        // Normalize accents
        const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        if (!normalize(carCambio).includes(normalize(filterTransmissao))) {
           // console.log(`[CAR_SEARCH] Filtered out mismatched transmission: Requested ${filterTransmissao}, Got ${car.cambio}`);
           return false;
        }
      }

      // STRICT PRICE FILTER (QA Bug Fix: Cars above max price being returned)
      // The API may not filter precisely, so we enforce it locally
      if (precoMax && precoMax < 5000000) {
        const carPrice = parseFloat(String(car.valor || '0').replace(/[^\d.]/g, '')) || 0;
        if (carPrice > precoMax) {
          console.log(`[CAR_SEARCH] ❌ Filtered out over-priced car: ${car.modelo} (R$ ${carPrice} > max R$ ${precoMax})`);
          return false;
        }
      }
      
      // STRICT MIN PRICE FILTER 
      if (precoMin && precoMin > 0) {
        const carPrice = parseFloat(String(car.valor || '0').replace(/[^\d.]/g, '')) || 0;
        if (carPrice < precoMin) {
          console.log(`[CAR_SEARCH] ❌ Filtered out under-priced car: ${car.modelo} (R$ ${carPrice} < min R$ ${precoMin})`);
          return false;
        }
      }

      return true;
    });

    // POST-FILTER: Enforce strict precoMax (API may not filter precisely)
    if (precoMax) {
      const beforeCount = data.length;
      data = data.filter((car: any) => {
        // Parse price: Remove "R$", dots, spaces, and convert comma to dot
        const rawPrice = String(car.valor || car.valor_formatado || '0')
          .replace(/R\$\s*/gi, '')
          .replace(/\./g, '') // Remove thousand separators
          .replace(',', '.') // Convert decimal comma
          .replace(/[^\d.]/g, ''); // Keep only digits and dot
        const numericPrice = parseFloat(rawPrice) || 0;
        
        if (numericPrice > precoMax) {
          console.warn(`[CAR_SEARCH] Filtered out over-budget car: ${car.modelo} R$${numericPrice} > R$${precoMax}`);
          return false;
        }
        return true;
      });
      console.log(`[CAR_SEARCH] Price filter: ${beforeCount} -> ${data.length} cars (max R$${precoMax})`);
    }

    // POST-FILTER: Category filter (API doesn't support this, so we filter locally)
    if (filters.categoria) {
      const beforeCount = data.length;
      const categoryKeywords: Record<string, string[]> = {
        'SUV': ['SUV', 'TRACKER', 'COMPASS', 'RENEGADE', 'KICKS', 'CRETA', 'T-CROSS', 'TIGUAN', 'SPORTAGE', 'TUCSON', 'RAV4', 'HR-V', 'CAPTUR', 'DUSTER', 'ECOSPORT', 'TRAILBLAZER', '2008', '3008', 'AIRCROSS'],
        'HATCH': ['HATCH', 'ONIX', 'HB20', 'ARGO', 'POLO', 'GOL', 'KA', 'MOBI', 'KWID', 'SANDERO', 'FOX', 'UP', 'FIT', 'YARIS', '208', 'C3'],
        'SEDAN': ['SEDAN', 'CRUZE', 'CIVIC', 'COROLLA', 'VIRTUS', 'VOYAGE', 'PRISMA', 'ONIX PLUS', 'HB20S', 'CRONOS', 'JETTA', 'SENTRA', 'VERSA', 'CITY'],
        'PICKUP': ['PICKUP', 'HILUX', 'S10', 'RANGER', 'SAVEIRO', 'STRADA', 'TORO', 'AMAROK', 'FRONTIER', 'OROCH', 'MONTANA'],
      };
      
      const keywords = categoryKeywords[filters.categoria.toUpperCase()] || [];
      if (keywords.length > 0) {
        data = data.filter((car: any) => {
          const modelo = String(car.modelo || '').toUpperCase();
          const matchesCategory = keywords.some(kw => modelo.includes(kw));
          if (!matchesCategory) {
            console.log(`[CAR_SEARCH] Filtered out non-${filters.categoria}: ${car.modelo}`);
          }
          return matchesCategory;
        });
        console.log(`[CAR_SEARCH] Category filter (${filters.categoria}): ${beforeCount} -> ${data.length} cars`);
      }
    }

    // POST-FILTER: Model filter (CRITICAL: API may return wrong models!)
    // Example: Asked for "Argo", API returned "Ka" - this filter ensures we only return matching models
    if (filters.modelo && !isOrSearch) {
      const beforeCount = data.length;
      const targetModelo = filters.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      
      data = data.filter((car: any) => {
        const carModelo = String(car.modelo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // FIX #10: Check if car model CONTAINS the target model
        // "TAOS HIGHLINE" contains "taos" ✓
        // "T CROSS SENSE" does NOT contain "taos" ✗
        const carContainsTarget = carModelo.includes(targetModelo);
        
        // FIX #10: Also check if first word of car model matches target
        // This allows "argo" to match "ARGO DRIVE 1.0"
        // BUT require minimum 3 chars to prevent "t" matching "taos"
        const carFirstWord = carModelo.split(' ')[0];
        const targetFirstWord = targetModelo.split(' ')[0];
        const firstWordMatches = carFirstWord.length >= 3 && 
          (carFirstWord === targetFirstWord || 
           carFirstWord.startsWith(targetFirstWord) || 
           targetFirstWord.startsWith(carFirstWord));
        
        const matches = carContainsTarget || firstWordMatches;
        
        if (!matches) {
          console.log(`[CAR_SEARCH] ❌ Filtered out wrong model: Asked "${filters.modelo}", Got "${car.modelo}"`);
        }
        return matches;
      });
      
      if (beforeCount !== data.length) {
        console.log(`[CAR_SEARCH] Model filter (${filters.modelo}): ${beforeCount} -> ${data.length} cars`);
      }
    }


    // POST-FILTER: Opcional filter (API doesn't support this, so we filter locally)
    // UPDATED: Supports multiple optionals separated by comma (e.g., "teto_panoramico,apple_carplay")
    if (filters.opcional) {
      const beforeCount = data.length;
      const targetTags = filters.opcional.toLowerCase().split(',').map(t => t.trim());
      
      data = data.filter((car: any) => {
        if (!car.opcionais || !Array.isArray(car.opcionais)) return false;
        
        // Car must have ALL requested optionals
        const hasAllOptionals = targetTags.every(targetTag => {
          return car.opcionais.some((op: any) => 
            (op.tag || '').toLowerCase().includes(targetTag) ||
            (op.descricao || '').toLowerCase().includes(targetTag.replace(/_/g, ' '))
          );
        });
        
        if (!hasAllOptionals) {
          console.log(`[CAR_SEARCH] Filtered out car missing optionals: ${car.modelo}`);
        }
        return hasAllOptionals;
      });
      console.log(`[CAR_SEARCH] Opcional filter (${filters.opcional}): ${beforeCount} -> ${data.length} cars`);
    }

    // POST-FILTER: Motor/Engine filter (API doesn't support this, so we filter locally)
    if (filters.motor) {
      const beforeCount = data.length;
      const targetMotor = filters.motor.toLowerCase().replace(/[.,]/g, '');
      data = data.filter((car: any) => {
        const carMotor = String(car.motor || '').toLowerCase().replace(/[.,]/g, '');
        const carModelo = String(car.modelo || '').toLowerCase();
        // Match motor field or modelo that contains motor spec (e.g. "ONIX 1.0 TURBO")
        const matchesMotor = carMotor.includes(targetMotor) || carModelo.includes(targetMotor);
        if (!matchesMotor) {
          console.log(`[CAR_SEARCH] Filtered out car with different motor: ${car.modelo} (motor: ${car.motor})`);
        }
        return matchesMotor;
      });
      console.log(`[CAR_SEARCH] Motor filter (${filters.motor}): ${beforeCount} -> ${data.length} cars`);
    }

    const cars: CarData[] = data.map((car: any) => {
      // Build image URL from imagens.full array (correct field from API)
      let imageUrl = '';
      if (car.imagens?.full?.[0]) {
        // Fix: Encode URL to handle spaces and parentheses (e.g. "image (1).jpg")
        const imgPath = car.imagens.full[0].replace('./', '/');
        const baseUrl = 'https://www.netcarmultimarcas.com.br';
        // Simpler approach: just encode spaces and parens if split/join is too aggressive
        imageUrl = `https://www.netcarmultimarcas.com.br${imgPath}`.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
      }
      
      // Clean up price (remove HTML tags)
      const preco = (car.valor_formatado || car.valor || '').toString().replace(/<[^>]*>/g, '').trim();
      
      // Extract potencia (e.g. "82 cv")
      const potencia = car.potencia ? `${car.potencia} cv` : '';
      
      // Extract portas with auto-correction for inconsistent data
      // Bug #2 Fix: SUVs and SEDANs never have < 4 doors - correct API errors
      let portas = parseInt(car.portas, 10) || 4;
      const modeloUpper = String(car.modelo || '').toUpperCase();
      
      // Models that are definitely 4-5 door vehicles
      const fourDoorModels = ['SUV', 'SEDAN', 'HATCH', 'CROSSOVER', 'TRACKER', 'COMPASS', 'RENEGADE',
        'KICKS', 'CRETA', 'T-CROSS', 'TIGUAN', 'HR-V', 'DUSTER', 'ECOSPORT', '2008', '3008', '5008',
        'AIRCROSS', 'ONIX', 'HB20', 'ARGO', 'POLO', 'GOL', 'KA', 'CRUZE', 'CIVIC', 'COROLLA'];
      
      const isFourDoorModel = fourDoorModels.some(m => modeloUpper.includes(m));
      if (isFourDoorModel && portas < 4) {
        console.log(`[CAR_SEARCH] Auto-correcting portas for ${car.modelo}: ${portas} -> 4`);
        portas = 4;
      }
      
      // Extract top 5 opcionais
      let opcionais: string[] = [];
      if (car.opcionais && Array.isArray(car.opcionais)) {
        // Priority opcionais - most desirable features shown first
        const priority = [
          'teto_panoramico', 'teto_solar', // Teto é diferencial importante
          'apple_carplay', 'android_auto', // Conectividade moderna
          'camera_de_re', 'sensor', // Segurança ao estacionar
          'piloto_automatico', 'cruise', // Conforto em viagem
          'bancos_de_couro', 'couro', // Interior premium
          'air_bag', 'abs', 'airbag', // Segurança básica
          'ar_condicionado', 'ar_quente', // Climatização
          'direcao', 'rodas', 'multimidia'
        ];
        const sorted = car.opcionais.sort((a: any, b: any) => {
          const aTag = (a.tag || '').toLowerCase();
          const bTag = (b.tag || '').toLowerCase();
          const aScore = priority.findIndex(p => aTag.includes(p));
          const bScore = priority.findIndex(p => bTag.includes(p));
          // Lower index = higher priority, -1 means not found (put at end)
          const aFinal = aScore >= 0 ? aScore : 999;
          const bFinal = bScore >= 0 ? bScore : 999;
          return aFinal - bFinal;
        });
        opcionais = sorted.slice(0, 5).map((op: any) => op.descricao || op.tag || '');
      }
      
      return {
        id: car.id,
        marca: car.marca || '',
        modelo: car.modelo || '',
        ano: parseInt(car.ano, 10) || 0,
        preco: preco,
        cor: car.cor || '',
        km: parseInt(String(car.km || '0').replace(/\D/g, ''), 10) || 0,
        cambio: car.cambio || 'N/A',
        combustivel: car.combustivel || 'N/A',
        motor: car.motor || 'N/A',
        potencia: potencia,
        portas: portas,
        opcionais: opcionais,
        imageUrl: imageUrl,
        link: `https://www.netcarmultimarcas.com.br/detalhe-veiculo.php?id=${car.id}`,
      };
    });

    console.log(`[CAR_SEARCH] Found ${cars.length} cars, first has image: ${cars[0]?.imageUrl ? 'YES' : 'NO'}`);
    
    // Save to KV Cache (Async - don't await/block response)
    if (cars.length > 0) {
        setInKV(env, cacheKey, cars, CACHE_TTL_SECONDS.STOCK)
            .catch(err => console.error('[CAR_SEARCH] Failed to cache results', err));
    }

    return cars;
  } catch (error) {
    console.error('[CAR_SEARCH] Error:', error);
    return [];
  }
}

/**
 * Format car data for display in chat
 * LIMIT: Max 6 cars to avoid spam
 * NOTE: Does NOT include intro count message - caller should add it
 */
export function formatCarList(cars: CarData[], maxCars: number = 6): string {
  if (cars.length === 0) {
    return 'Não encontrei carros com esses critérios. Quer tentar outra busca?';
  }

  const toShow = cars.slice(0, maxCars);
  const remaining = cars.length - toShow.length;
  
  // Just the car list, no intro (caller adds intro with total count)
  let response = '';

  for (const car of toShow) {
    response += `*${car.marca} ${car.modelo} ${car.ano}* - ${car.preco}\n`;
    response += `Cor: ${car.cor} | ${car.km.toLocaleString('pt-BR')} km | ${car.cambio}\n`;
    response += `Ver detalhes: ${car.link}\n\n`;
  }

  if (remaining > 0) {
    response += `Gostou de alguma destas ou quer ver as próximas? Tenho mais ${remaining} opções.`;
  }

  return response;
}

/**
 * Format car data as individual cards for WhatsApp link preview
 * Each card is a separate message so WhatsApp shows the preview image
 * Returns array of messages to be sent sequentially
 * @param searchedOptionals - Optional: the optional features the customer searched for (comma-separated)
 */
export function formatCarCards(cars: CarData[], maxCars: number = 6, searchedOptionals?: string): string[] {
  if (cars.length === 0) {
    return ['Não encontrei carros com esses critérios. Quer tentar outra busca?'];
  }

  const toShow = cars.slice(0, maxCars);
  const remaining = cars.length - toShow.length;
  const messages: string[] = [];
  
  // Format searched optionals if provided (these are what the customer asked for)
  let searchedOpcionaisLine = '';
  if (searchedOptionals) {
    const searchedTags = searchedOptionals.split(',').map(op => 
      op.trim().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    );
    searchedOpcionaisLine = `\n✅ ${searchedTags.join(' • ')}`;
  }

  for (const car of toShow) {
    // Build detailed card with 6 info fields: cor, km, cambio, motor, portas, combustivel
    const motorInfo = car.motor ? ` | Motor ${car.motor}` : '';
    const portasInfo = car.portas ? ` | ${car.portas}p` : '';
    const combustivelInfo = car.combustivel ? ` | ${car.combustivel}` : '';
    
    const cardMessage = `*${car.marca} ${car.modelo} ${car.ano}* - ${car.preco}
Cor: ${car.cor} | ${car.km.toLocaleString('pt-BR')} km | ${car.cambio}${motorInfo}${portasInfo}${combustivelInfo}${searchedOpcionaisLine}
${car.link}`;
    messages.push(cardMessage);
  }

  if (remaining > 0) {
    messages.push(`Gostou de algum? Tenho mais ${remaining} opções! 🚗`);
  }

  return messages;
}

