/**
 * Car Search - Busca de Carros (Grounded)
 * ========================================
 * Lógica de busca SEMPRE baseada na API.
 * REGRA: Nunca inventa dados - tudo vem do NetcarApiAdapter.
 */

import type { Car, CarFilters, CarRepository, DetectedIntent } from '../types';
import type { CanonicalFilters, SearchResult } from '../adapters/netcar';

// =============================================================================
// BUSCA PRINCIPAL
// =============================================================================

/**
 * Executa busca de carros baseado na intenção detectada
 * 
 * @param intent - Intenção detectada (contém filtros)
 * @param carRepository - Adapter da API (injetado)
 * @returns Lista de carros da API
 */
export async function executeCarSearch(
  intent: DetectedIntent,
  carRepository: CarRepository
): Promise<Car[]> {
  const filters = intentToFilters(intent);
  
  // Buscar carros via API
  const cars = await carRepository.search(filters);
  
  // Ordenar por relevância
  return sortByRelevance(cars, filters);
}

/**
 * Converte intenção detectada para filtros de busca
 */
export function intentToFilters(intent: DetectedIntent): CarFilters {
  const canonical = intent.filters || {};
  
  return {
    marca: canonical.brand || canonical.marca,
    modelo: canonical.model || canonical.modelo,
    anoMin: canonical.yearMin || canonical.anoMin,
    anoMax: canonical.yearMax || canonical.anoMax,
    valorMin: canonical.priceMin || canonical.valorMin,
    valorMax: canonical.priceMax || canonical.valorMax,
    cor: canonical.color || canonical.cor,
    cambio: canonical.transmission || canonical.cambio,
    combustivel: canonical.fuel || canonical.combustivel,
    limit: canonical.limit || 20,
  };
}

/**
 * Ordena carros por relevância
 */
function sortByRelevance(cars: Car[], filters: CarFilters): Car[] {
  return [...cars].sort((a, b) => {
    // Se tem filtro de preço, ordenar por proximidade ao preço máximo
    if (filters.valorMax) {
      const diffA = Math.abs(a.valor - (filters.valorMax || 0));
      const diffB = Math.abs(b.valor - (filters.valorMax || 0));
      if (diffA !== diffB) return diffA - diffB;
    }
    
    // Senão, ordenar por ano (mais novos primeiro)
    return b.ano - a.ano;
  });
}

// =============================================================================
// FORMATAÇÃO (usa dados da API, nunca inventa)
// =============================================================================

/**
 * Formata um carro para exibição em texto
 * REGRA: Só mostra campos que existem no objeto
 */
export function formatCarForText(car: Car): string {
  const parts: string[] = [
    `🚗 *${car.marca} ${car.modelo}*`,
  ];
  
  // Só adiciona campos que existem
  if (car.ano) parts.push(`📅 Ano: ${car.ano}`);
  if (car.valorFormatado) parts.push(`💰 ${car.valorFormatado}`);
  if (car.km !== undefined && car.km > 0) {
    parts.push(`📏 ${car.km.toLocaleString('pt-BR')} km`);
  }
  if (car.cor) parts.push(`🎨 ${car.cor}`);
  if (car.cambio) parts.push(`⚙️ ${car.cambio}`);
  
  return parts.join('\n');
}

/**
 * Formata lista de carros para exibição
 */
export function formatCarList(cars: Car[], maxItems = 5): string {
  if (cars.length === 0) {
    return ''; // Não inventa mensagem aqui
  }
  
  const items = cars.slice(0, maxItems).map((car, i) => {
    const price = car.valorFormatado || `R$ ${car.valor.toLocaleString('pt-BR')}`;
    return `${i + 1}. ${car.marca} ${car.modelo} ${car.ano} - ${price}`;
  });
  
  return items.join('\n');
}

// =============================================================================
// MENSAGENS DE RESULTADO (honestas sobre origem)
// =============================================================================

/**
 * Gera mensagem quando não encontra carros
 * REGRA: Ser honesto que é do estoque atual
 */
export function generateNoResultsMessage(filters: CarFilters): string {
  const parts: string[] = [];
  
  if (filters.modelo) {
    parts.push(`*${filters.modelo.toUpperCase()}*`);
  } else if (filters.marca) {
    parts.push(`veículos *${filters.marca.toUpperCase()}*`);
  }
  
  if (filters.valorMax) {
    parts.push(`até R$ ${filters.valorMax.toLocaleString('pt-BR')}`);
  }
  
  if (parts.length > 0) {
    return `Bah, não encontrei ${parts.join(' ')} no estoque agora. ` +
           `Quer que eu passe pro consultor? Ele pode te avisar quando chegar!`;
  }
  
  return 'Não encontrei carros com esses critérios no estoque atual. ' +
         'Quer tentar outros filtros ou falar com um consultor?';
}

/**
 * Gera mensagem de sucesso com count
 */
export function generateSuccessMessage(count: number): string {
  if (count === 1) {
    return 'Encontrei 1 opção no nosso estoque! 🚗';
  }
  return `Encontrei ${count} opções no nosso estoque! 🚗 Olha as melhores:`;
}

/**
 * Gera oferta de mais opções
 */
export function generateMoreOptionsMessage(remaining: number): string {
  if (remaining <= 0) {
    return 'Essas foram as opções do estoque. Alguma te interessou?';
  }
  return `Gostou de alguma? Tenho mais ${remaining} opções se quiser ver!`;
}
