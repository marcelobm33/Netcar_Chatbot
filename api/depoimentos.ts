/**
 * API Depoimentos
 * =================
 * Depoimentos de clientes
 * 
 * Endpoint: GET /api/v1/depoimentos.php
 */

import { fetchAPI, ENDPOINTS } from './config';
import type { Depoimento, DepoimentoFilters, DepoimentoResponse } from './types';

/**
 * Lista depoimentos com paginação
 * 
 * @example
 * const deps = await listDepoimentos(10, 0);
 */
export async function listDepoimentos(limit = 50, offset = 0): Promise<DepoimentoResponse> {
  return fetchAPI<DepoimentoResponse>(ENDPOINTS.depoimentos, {
    action: 'list',
    limit,
    offset,
  });
}

/**
 * Busca depoimento específico por ID
 * 
 * @example
 * const dep = await getDepoimento(1);
 */
export async function getDepoimento(id: number): Promise<Depoimento | null> {
  const result = await fetchAPI<DepoimentoResponse>(ENDPOINTS.depoimentos, {
    action: 'single',
    id,
  });
  
  if (result.success && result.data) {
    return result.data as Depoimento;
  }
  return null;
}

/**
 * Retorna galeria de imagens dos depoimentos
 */
export async function getDepoimentosGallery(): Promise<string[]> {
  const result = await fetchAPI<DepoimentoResponse>(ENDPOINTS.depoimentos, {
    action: 'gallery',
  });
  
  if (result.success && Array.isArray(result.data)) {
    return (result.data as Depoimento[]).map(d => d.imagem_link);
  }
  return [];
}

/**
 * Conta total de depoimentos
 */
export async function countDepoimentos(): Promise<number> {
  const result = await listDepoimentos(1, 0);
  return result.total_results || 0;
}

/**
 * Retorna depoimentos aleatórios para exibição
 */
export async function getRandomDepoimentos(count = 3): Promise<Depoimento[]> {
  const result = await listDepoimentos(50, 0);
  
  if (!result.success || !Array.isArray(result.data)) {
    return [];
  }
  
  const depoimentos = result.data as Depoimento[];
  
  // Shuffle e pegar os primeiros
  const shuffled = depoimentos.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}
