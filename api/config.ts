/**
 * API - Configuração Base
 * ========================
 * Configurações e helper de fetch compartilhados
 */

export const BASE_URL = 'https://www.netcarmultimarcas.com.br/api/v1';

export const ENDPOINTS = {
  veiculos: '/veiculos.php',
  stock: '/stock.php',
  depoimentos: '/depoimentos.php',
  site: '/site.php',
} as const;

export interface FetchOptions {
  timeout?: number;
  retries?: number;
  cache?: boolean;
}

/**
 * Fetch genérico para a API NetCar
 * Inclui timeout, retry e tratamento de erros
 */
export async function fetchAPI<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 10000, retries = 2 } = options;
  
  // Build URL with query params
  const url = new URL(`${BASE_URL}${endpoint}`);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }
  
  // Retry logic
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as T;
      return data;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on abort
      if (lastError.name === 'AbortError') {
        throw new Error(`API Timeout: ${endpoint} (${timeout}ms)`);
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }
  
  throw lastError || new Error(`API Error: ${endpoint}`);
}
