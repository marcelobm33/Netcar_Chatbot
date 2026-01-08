/**
 * API - Client Principal
 * =======================
 * Client centralizado para a API NetCar (netcarmultimarcas.com.br/api/v1)
 * 
 * Uso:
 *   import { netcarAPI } from './api';
 *   const cars = await netcarAPI.veiculos.searchVeiculos({ montadora: 'FORD' });
 *   const brands = await netcarAPI.stock.getBrands();
 */

// Re-exports de tipos e config
export * from './types';
export * from './config';

// Re-exports de módulos
export * from './veiculos';
export * from './stock';
export * from './depoimentos';
export * from './site';

// Imports para o client object
import * as veiculosAPI from './veiculos';
import * as stockAPI from './stock';
import * as depoimentosAPI from './depoimentos';
import * as siteAPI from './site';
import { BASE_URL, ENDPOINTS, fetchAPI } from './config';

/**
 * Client completo da API NetCar
 * 
 * Exemplo:
 *   const cars = await netcarAPI.veiculos.searchVeiculos({ marca: 'FORD' });
 *   const brands = await netcarAPI.stock.getBrands();
 */
export const netcarAPI = {
  veiculos: veiculosAPI,
  stock: stockAPI,
  depoimentos: depoimentosAPI,
  site: siteAPI,
  
  // Helpers
  BASE_URL,
  ENDPOINTS,
  fetchAPI,
};

export default netcarAPI;
