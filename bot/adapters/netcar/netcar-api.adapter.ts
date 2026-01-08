/**
 * NetCar API Adapter - A "Bíblia" do Bot
 * ========================================
 * Adapter centralizado para a API NetCar.
 * O bot NUNCA inventa dados - tudo vem daqui.
 * 
 * REGRA DE OURO:
 * - LLM não "sabe" nada de carro
 * - LLM só decide qual endpoint chamar e filtros
 * - Dados reais vêm APENAS desta API
 */

import type { Car, CarFilters, CarRepository } from '../../types';

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const BASE_URL = 'https://www.netcarmultimarcas.com.br/api/v1';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRIES = 2;

// =============================================================================
// TIPOS DE RESPOSTA DA API (validados)
// =============================================================================

/** Resposta padrão da API */
interface APIResponse<T> {
  success: boolean;
  message: string;
  data: T;
  total_results?: number;
}

/** Veículo da API (raw) - TODOS os campos retornados */
interface VeiculoRaw {
  id: string;
  marca: string;
  modelo: string;
  ano: number;
  
  // Preços
  valor: number;
  valor_formatado: string;
  preco_com_troca?: number;
  preco_com_troca_formatado?: string;
  tem_desconto?: number;
  valor_sem_desconto?: number | null;
  
  // Especificações
  cor: string;
  motor: string;
  combustivel: string;
  cambio: string;
  potencia?: string;
  km?: number;
  portas?: number;
  lugares?: number;
  
  // Documentação
  placa?: string;
  chassi?: string | null;
  renavam?: string | null;
  
  // Equipamentos básicos
  direcao?: string | null;
  ar_condicionado?: string | null;
  vidros_eletricos?: string | null;
  travas_eletricas?: string | null;
  airbag?: string | null;
  abs?: string | null;
  alarme?: string | null;
  som?: string | null;
  rodas?: string | null;
  pneus?: string | null;
  freios?: string | null;
  suspensao?: string | null;
  
  // Status do veículo
  motor_status?: string | null;
  cambio_status?: string | null;
  pintura_status?: string | null;
  lataria_status?: string | null;
  interior_status?: string | null;
  pneus_status?: string | null;
  documentacao?: string | null;
  
  // Observações
  observacoes?: string | null;
  descricao?: string | null;
  
  // Links e mídia
  link?: string;
  have_galery?: number;
  imagens?: { thumb: string[]; full: string[] };
  
  // Opcionais completos
  opcionais?: Array<{ tag: string; descricao: string }>;
  
  // Datas e status  
  data?: string | null;
  data_cadastro?: string | null;
  data_atualizacao?: string | null;
  status?: string | null;
  destaque?: number;
  promocao?: number;
  full?: number;
}

// =============================================================================
// FILTROS CANÔNICOS (o que o core entende)
// =============================================================================

export interface CanonicalFilters {
  brand?: string;      // marca
  model?: string;      // modelo
  yearMin?: number;    // ano mínimo
  yearMax?: number;    // ano máximo
  priceMin?: number;   // preço mínimo
  priceMax?: number;   // preço máximo
  color?: string;      // cor
  transmission?: string; // cambio (manual, automatico)
  fuel?: string;       // combustível
  limit?: number;
}

// =============================================================================
// VALIDAÇÃO (simples, sem Zod - bundle size)
// =============================================================================

function validateVeiculo(raw: unknown): VeiculoRaw | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  
  // Campos obrigatórios
  if (typeof v.id !== 'string' && typeof v.id !== 'number') return null;
  if (typeof v.marca !== 'string') return null;
  if (typeof v.modelo !== 'string') return null;
  if (typeof v.ano !== 'number') return null;
  
  return raw as VeiculoRaw;
}

function validateAPIResponse<T>(
  raw: unknown,
  validateItem: (item: unknown) => T | null
): APIResponse<T[]> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  
  if (typeof r.success !== 'boolean') return null;
  if (!Array.isArray(r.data)) return null;
  
  const validData: T[] = [];
  for (const item of r.data) {
    const valid = validateItem(item);
    if (valid) validData.push(valid);
  }
  
  return {
    success: r.success,
    message: String(r.message || ''),
    data: validData,
    total_results: typeof r.total_results === 'number' ? r.total_results : validData.length,
  };
}

// =============================================================================
// CONVERSÃO (raw → Car) - TODOS OS CAMPOS
// =============================================================================

function rawToCar(raw: VeiculoRaw): Car {
  return {
    id: String(raw.id),
    marca: raw.marca,
    modelo: raw.modelo,
    ano: raw.ano,
    valor: raw.valor,
    valorFormatado: raw.valor_formatado,
    cor: raw.cor,
    motor: raw.motor,
    combustivel: raw.combustivel,
    cambio: raw.cambio,
    km: raw.km,
    potencia: raw.potencia,
    portas: raw.portas,
    lugares: raw.lugares,
    // Documentação
    placa: raw.placa,
    // Equipamentos
    direcao: raw.direcao,
    ar_condicionado: raw.ar_condicionado,
    vidros_eletricos: raw.vidros_eletricos,
    travas_eletricas: raw.travas_eletricas,
    airbag: raw.airbag,
    abs: raw.abs,
    alarme: raw.alarme,
    // Status do veículo
    documentacao: raw.documentacao,
    // Observações
    observacoes: raw.observacoes,
    descricao: raw.descricao,
    // Links e mídia
    link: raw.link,
    have_galery: raw.have_galery,
    imagens: raw.imagens,
    // Opcionais (extrai descrição para lista simples)
    opcionais: raw.opcionais?.map(o => o.descricao),
    opcionais_raw: raw.opcionais,
    // Preços extras
    preco_com_troca: raw.preco_com_troca,
    preco_com_troca_formatado: raw.preco_com_troca_formatado,
    tem_desconto: raw.tem_desconto,
    // Status
    destaque: raw.destaque,
    promocao: raw.promocao,
  };
}

// =============================================================================
// FILTROS SUPORTADOS PELA API vs MEMÓRIA
// =============================================================================

// API suporta diretamente via querystring:
const API_SUPPORTED_FILTERS = ['montadora', 'modelo', 'ano_min', 'ano_max', 'valor_min', 'valor_max'];

// Filtros aplicados em memória após busca:
const MEMORY_FILTERS = ['cor', 'cambio', 'combustivel'];

function canonicalToQueryParams(filters: CanonicalFilters): URLSearchParams {
  const params = new URLSearchParams();
  
  // APENAS filtros suportados pela API
  if (filters.brand) params.set('montadora', filters.brand.toUpperCase());
  if (filters.model) params.set('modelo', filters.model.toUpperCase());
  if (filters.yearMin) params.set('ano_min', String(filters.yearMin));
  if (filters.yearMax) params.set('ano_max', String(filters.yearMax));
  if (filters.priceMin) params.set('valor_min', String(filters.priceMin));
  if (filters.priceMax) params.set('valor_max', String(filters.priceMax));
  // NÃO enviamos cor/cambio/combustivel - API não filtra, faremos em memória
  if (filters.limit) params.set('limit', String(Math.max(filters.limit * 3, 50))); // Buscar mais para filtrar depois
  
  return params;
}

/**
 * Aplica filtros em memória (cor, cambio, combustivel)
 * IMPORTANTE: Estes filtros NÃO são suportados pela API
 */
function applyMemoryFilters(cars: Car[], filters: CanonicalFilters): Car[] {
  let result = cars;
  
  // Filtrar por cor (case-insensitive)
  if (filters.color) {
    const colorLower = filters.color.toLowerCase();
    result = result.filter(car => 
      car.cor?.toLowerCase().includes(colorLower)
    );
  }
  
  // Filtrar por câmbio (automático/manual)
  if (filters.transmission) {
    const transLower = filters.transmission.toLowerCase();
    result = result.filter(car => 
      car.cambio?.toLowerCase().includes(transLower)
    );
  }
  
  // Filtrar por combustível
  if (filters.fuel) {
    const fuelLower = filters.fuel.toLowerCase();
    result = result.filter(car => 
      car.combustivel?.toLowerCase().includes(fuelLower)
    );
  }
  
  return result;
}

// =============================================================================
// FETCH COM RETRY/TIMEOUT
// =============================================================================

async function fetchWithRetry<T>(
  url: string,
  options: { timeout?: number; retries?: number } = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES } = options;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json() as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (lastError.name === 'AbortError') {
        throw new Error(`Timeout: ${url}`);
      }
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  }
  
  throw lastError || new Error('Fetch failed');
}

// =============================================================================
// NETCAR API ADAPTER
// =============================================================================

export class NetcarApiAdapter implements CarRepository {
  private cache = new Map<string, { data: unknown; expires: number }>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Busca veículos com filtros canônicos
   * REGRA: Retorna APENAS o que a API retornar, nunca inventa
   * 
   * NOTA: Filtros cor/cambio/combustivel são aplicados em MEMÓRIA
   * após a busca, pois a API não os suporta nativamente.
   */
  async search(filters: CarFilters): Promise<Car[]> {
    // Converter para filtros canônicos
    const canonical: CanonicalFilters = {
      brand: filters.marca,
      model: filters.modelo,
      yearMin: filters.anoMin,
      yearMax: filters.anoMax,
      priceMax: filters.valorMax,
      priceMin: filters.valorMin,
      color: filters.cor,
      transmission: filters.cambio,
      fuel: filters.combustivel,
      limit: filters.limit || 50,
    };
    
    return this.searchWithCanonical(canonical);
  }

  /**
   * Busca com filtros canônicos
   * 
   * Fluxo:
   * 1. Busca na API com filtros suportados (marca, modelo, ano, valor)
   * 2. Aplica filtros em memória (cor, cambio, combustivel)
   * 3. Aplica limit final
   */
  async searchWithCanonical(filters: CanonicalFilters): Promise<Car[]> {
    const params = canonicalToQueryParams(filters);
    const url = `${BASE_URL}/veiculos?${params.toString()}`;
    
    // Check cache (cache key inclui URL base, não filtros de memória)
    const cached = this.getFromCache<APIResponse<VeiculoRaw[]>>(url);
    let cars: Car[];
    
    if (cached) {
      cars = cached.data.map(rawToCar);
    } else {
      try {
        const raw = await fetchWithRetry<unknown>(url);
        const validated = validateAPIResponse(raw, validateVeiculo);
        
        if (!validated || !validated.success) {
          console.warn('[NETCAR-API] Invalid response:', raw);
          return [];
        }
        
        this.setCache(url, validated);
        cars = validated.data.map(rawToCar);
      } catch (error) {
        console.error('[NETCAR-API] Search failed:', error);
        return []; // NUNCA inventa dados no erro
      }
    }
    
    // Aplicar filtros em memória (cor, cambio, combustivel)
    cars = applyMemoryFilters(cars, filters);
    
    // Aplicar limit final
    const limit = filters.limit || 50;
    return cars.slice(0, limit);
  }

  /**
   * Busca carro por ID
   */
  async getById(id: string): Promise<Car | null> {
    const all = await this.searchWithCanonical({ limit: 100 });
    return all.find(c => c.id === id) || null;
  }

  /**
   * Lista marcas disponíveis
   */
  async getBrands(): Promise<string[]> {
    const url = `${BASE_URL}/stock?action=enterprises`;
    
    const cached = this.getFromCache<APIResponse<string[]>>(url);
    if (cached) return cached.data;
    
    try {
      const raw = await fetchWithRetry<{ success: boolean; data: string[] }>(url);
      if (!raw.success || !Array.isArray(raw.data)) return [];
      
      this.setCache(url, raw);
      return raw.data;
    } catch {
      return [];
    }
  }

  /**
   * Lista modelos de uma marca
   */
  async getModelsByBrand(brand: string): Promise<string[]> {
    const url = `${BASE_URL}/stock?action=cars_by_brand&brand=${encodeURIComponent(brand)}`;
    
    const cached = this.getFromCache<APIResponse<string[]>>(url);
    if (cached) return cached.data;
    
    try {
      const raw = await fetchWithRetry<{ success: boolean; data: string[] }>(url);
      if (!raw.success || !Array.isArray(raw.data)) return [];
      
      this.setCache(url, raw);
      return raw.data;
    } catch {
      return [];
    }
  }

  // Cache helpers
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, expires: Date.now() + this.cacheTTL });
  }
}

// =============================================================================
// RESULTADO DE BUSCA (com metadados)
// =============================================================================

export interface SearchResult {
  /** Endpoints consultados */
  sources: string[];
  /** Filtros aplicados */
  filters_applied: CanonicalFilters;
  /** Total de resultados */
  total_results: number;
  /** Dados (lista de carros) */
  data: Car[];
  /** Se veio da API ou não */
  from_api: boolean;
}

/**
 * Executa busca com metadados completos
 * Usado pelo core para garantir rastreabilidade
 */
export async function searchWithMetadata(
  filters: CanonicalFilters,
  adapter: NetcarApiAdapter
): Promise<SearchResult> {
  const cars = await adapter.searchWithCanonical(filters);
  
  return {
    sources: [`${BASE_URL}/veiculos`],
    filters_applied: filters,
    total_results: cars.length,
    data: cars,
    from_api: true,
  };
}

// Singleton para uso fácil
export const netcarApi = new NetcarApiAdapter();
