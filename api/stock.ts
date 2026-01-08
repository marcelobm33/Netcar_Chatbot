/**
 * API Stock
 * ==========
 * Dados do estoque: marcas, modelos, anos, preços
 * 
 * Endpoint: GET /api/v1/stock.php
 */

import { fetchAPI, ENDPOINTS } from './config';
import type { StockAction, StockFilters, StockResponse, StockItem } from './types';

/**
 * Fetch genérico do stock com action
 */
async function fetchStock(action: StockAction, params: Partial<StockFilters> = {}): Promise<StockResponse> {
  return fetchAPI<StockResponse>(ENDPOINTS.stock, { action, ...params });
}

// =============================================================================
// MARCAS (Enterprises)
// =============================================================================

/**
 * Lista todas as marcas disponíveis no estoque
 * 
 * @example
 * const brands = await getBrands();
 * // ['CHEVROLET', 'FORD', 'VOLKSWAGEN', 'FIAT', ...]
 */
export async function getBrands(): Promise<string[]> {
  const result = await fetchStock('enterprises');
  return result.data as string[];
}

/**
 * Alias para getBrands
 */
export const getEnterprises = getBrands;
export const getMarcas = getBrands;

// =============================================================================
// MODELOS
// =============================================================================

/**
 * Lista modelos de uma marca específica
 * 
 * @example
 * const models = await getModelsByBrand('FORD');
 * // ['KA', 'FIESTA', 'FOCUS', 'RANGER', ...]
 */
export async function getModelsByBrand(brand: string): Promise<string[]> {
  const result = await fetchStock('cars_by_brand', { brand });
  return result.data as string[];
}

/**
 * Alias para getModelsByBrand
 */
export const getCarsByBrand = getModelsByBrand;
export const getModelos = getModelsByBrand;

// =============================================================================
// ANOS
// =============================================================================

/**
 * Lista todos os anos disponíveis no estoque
 * 
 * @example
 * const years = await getYears();
 * // ['2024', '2023', '2022', '2021', ...]
 */
export async function getYears(): Promise<string[]> {
  const result = await fetchStock('years');
  return result.data as string[];
}

/**
 * Retorna range de anos (min, max)
 */
export async function getYearRange(): Promise<{ min: number; max: number }> {
  const years = await getYears();
  const numericYears = years.map(Number).filter(y => !isNaN(y));
  return {
    min: Math.min(...numericYears),
    max: Math.max(...numericYears),
  };
}

// =============================================================================
// PREÇOS
// =============================================================================

/**
 * Lista faixas de preço disponíveis
 * 
 * @example
 * const prices = await getPrices();
 */
export async function getPrices(): Promise<StockItem[]> {
  const result = await fetchStock('prices');
  return result.data as StockItem[];
}

/**
 * Retorna range de preços (min, max)
 */
export async function getPriceRange(): Promise<{ min: number; max: number }> {
  const prices = await getPrices();
  const numericPrices = prices
    .map(p => parseInt(p.value || String(p), 10))
    .filter(p => !isNaN(p));
  return {
    min: Math.min(...numericPrices),
    max: Math.max(...numericPrices),
  };
}

// =============================================================================
// OUTROS FILTROS
// =============================================================================

/**
 * Lista cores disponíveis
 */
export async function getColors(): Promise<string[]> {
  const result = await fetchStock('colors');
  return result.data as string[];
}

/**
 * Lista motores disponíveis
 */
export async function getEngines(): Promise<string[]> {
  const result = await fetchStock('engines');
  return result.data as string[];
}

/**
 * Lista combustíveis disponíveis
 */
export async function getFuels(): Promise<string[]> {
  const result = await fetchStock('fuels');
  return result.data as string[];
}

/**
 * Lista câmbios disponíveis
 */
export async function getTransmissions(): Promise<string[]> {
  const result = await fetchStock('transmissions');
  return result.data as string[];
}

// =============================================================================
// ALL-IN-ONE
// =============================================================================

/**
 * Retorna todos os filtros disponíveis de uma vez
 */
export async function getAllFilters(): Promise<{
  brands: string[];
  years: string[];
  colors: string[];
  engines: string[];
  fuels: string[];
  transmissions: string[];
}> {
  const [brands, years, colors, engines, fuels, transmissions] = await Promise.all([
    getBrands(),
    getYears(),
    getColors().catch(() => []),
    getEngines().catch(() => []),
    getFuels().catch(() => []),
    getTransmissions().catch(() => []),
  ]);
  
  return { brands, years, colors, engines, fuels, transmissions };
}
