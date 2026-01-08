/**
 * API Veículos
 * =============
 * Busca de veículos com filtros
 * 
 * Endpoint: GET /api/v1/veiculos.php
 */

import { fetchAPI, ENDPOINTS } from './config';
import type { Veiculo, VeiculoFilters, VeiculoResponse } from './types';

/**
 * Busca veículos com filtros opcionais
 * 
 * @example
 * // Buscar todos os Ford
 * const fords = await searchVeiculos({ montadora: 'FORD' });
 * 
 * // Buscar por preço
 * const baratos = await searchVeiculos({ valor_max: 50000 });
 * 
 * // Busca completa
 * const result = await searchVeiculos({
 *   montadora: 'CHEVROLET',
 *   modelo: 'ONIX',
 *   ano_min: 2020,
 *   valor_max: 80000,
 *   limit: 10
 * });
 */
export async function searchVeiculos(filters: VeiculoFilters = {}): Promise<VeiculoResponse> {
  return fetchAPI<VeiculoResponse>(ENDPOINTS.veiculos, filters);
}

/**
 * Busca todos os veículos (sem filtros)
 */
export async function listAllVeiculos(limit = 50, offset = 0): Promise<VeiculoResponse> {
  return searchVeiculos({ limit, offset });
}

/**
 * Busca veículos por montadora
 */
export async function getVeiculosByMontadora(
  montadora: string,
  options: Omit<VeiculoFilters, 'montadora'> = {}
): Promise<VeiculoResponse> {
  return searchVeiculos({ montadora, ...options });
}

/**
 * Busca veículos por faixa de preço
 */
export async function getVeiculosByPreco(
  valorMin: number,
  valorMax: number,
  options: Omit<VeiculoFilters, 'valor_min' | 'valor_max'> = {}
): Promise<VeiculoResponse> {
  return searchVeiculos({ valor_min: valorMin, valor_max: valorMax, ...options });
}

/**
 * Busca veículos por faixa de ano
 */
export async function getVeiculosByAno(
  anoMin: number,
  anoMax: number,
  options: Omit<VeiculoFilters, 'ano_min' | 'ano_max'> = {}
): Promise<VeiculoResponse> {
  return searchVeiculos({ ano_min: anoMin, ano_max: anoMax, ...options });
}

/**
 * Busca veículos por modelo específico
 */
export async function getVeiculosByModelo(
  modelo: string,
  options: Omit<VeiculoFilters, 'modelo'> = {}
): Promise<VeiculoResponse> {
  return searchVeiculos({ modelo, ...options });
}

/**
 * Conta total de veículos (sem paginação)
 */
export async function countVeiculos(filters: VeiculoFilters = {}): Promise<number> {
  const result = await searchVeiculos({ ...filters, limit: 1 });
  return result.total_results || 0;
}

/**
 * Busca veículo por ID
 */
export async function getVeiculoById(id: string): Promise<Veiculo | null> {
  // A API não tem endpoint direto por ID, então buscamos todos e filtramos
  // TODO: Verificar se existe endpoint específico
  const result = await searchVeiculos({ limit: 500 });
  return result.data.find(v => v.id === id) || null;
}
