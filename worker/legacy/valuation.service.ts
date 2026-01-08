/**
 * Valuation Service - Estimativa de valor de veículos
 * 
 * MVP: Tabela estática de preços por modelo/ano
 * Futuro: Integração com API FIPE
 */

import type { Env } from '@types';

export interface ValuationResult {
  marca: string;
  modelo: string;
  ano: number;
  valorMin: number;
  valorMax: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'table' | 'fipe' | 'stock';
}

// Tabela de preços por modelo (modelo_ano como chave)
// Valores em R$ baseados em médias de mercado 2025
const PRICE_TABLE: Record<string, { min: number; max: number }> = {
  // Chevrolet
  'CRUZE_2017': { min: 55000, max: 65000 },
  'CRUZE_2018': { min: 65000, max: 75000 },
  'CRUZE_2019': { min: 75000, max: 85000 },
  'CRUZE_2020': { min: 85000, max: 95000 },
  'CRUZE_2021': { min: 95000, max: 110000 },
  'CRUZE_2022': { min: 105000, max: 120000 },
  'ONIX_2017': { min: 35000, max: 42000 },
  'ONIX_2018': { min: 40000, max: 48000 },
  'ONIX_2019': { min: 45000, max: 55000 },
  'ONIX_2020': { min: 50000, max: 60000 },
  'ONIX_2021': { min: 55000, max: 65000 },
  'ONIX_2022': { min: 60000, max: 72000 },
  'ONIX_2023': { min: 70000, max: 82000 },
  'TRACKER_2020': { min: 85000, max: 100000 },
  'TRACKER_2021': { min: 95000, max: 110000 },
  'TRACKER_2022': { min: 105000, max: 120000 },
  'TRACKER_2023': { min: 115000, max: 130000 },
  'S10_2019': { min: 140000, max: 170000 },
  'S10_2020': { min: 160000, max: 190000 },
  'S10_2021': { min: 180000, max: 210000 },
  
  // Hyundai
  'CRETA_2018': { min: 70000, max: 80000 },
  'CRETA_2019': { min: 80000, max: 90000 },
  'CRETA_2020': { min: 90000, max: 105000 },
  'CRETA_2021': { min: 100000, max: 115000 },
  'CRETA_2022': { min: 110000, max: 130000 },
  'HB20_2018': { min: 40000, max: 48000 },
  'HB20_2019': { min: 45000, max: 55000 },
  'HB20_2020': { min: 50000, max: 60000 },
  'HB20_2021': { min: 55000, max: 65000 },
  'HB20_2022': { min: 60000, max: 72000 },
  
  // Honda
  'HRV_2019': { min: 85000, max: 100000 },
  'HRV_2020': { min: 95000, max: 110000 },
  'HRV_2021': { min: 105000, max: 120000 },
  'HRV_2022': { min: 115000, max: 135000 },
  'CIVIC_2019': { min: 85000, max: 100000 },
  'CIVIC_2020': { min: 95000, max: 115000 },
  'CIVIC_2021': { min: 110000, max: 130000 },
  'CIVIC_2022': { min: 130000, max: 150000 },
  'FIT_2018': { min: 50000, max: 60000 },
  'FIT_2019': { min: 55000, max: 65000 },
  'FIT_2020': { min: 60000, max: 72000 },
  
  // Volkswagen
  'TCROSS_2020': { min: 90000, max: 105000 },
  'TCROSS_2021': { min: 100000, max: 115000 },
  'TCROSS_2022': { min: 110000, max: 130000 },
  'POLO_2019': { min: 55000, max: 65000 },
  'POLO_2020': { min: 60000, max: 72000 },
  'POLO_2021': { min: 68000, max: 80000 },
  'POLO_2022': { min: 75000, max: 88000 },
  'VIRTUS_2019': { min: 60000, max: 72000 },
  'VIRTUS_2020': { min: 68000, max: 80000 },
  'VIRTUS_2021': { min: 75000, max: 88000 },
  'VIRTUS_2022': { min: 82000, max: 95000 },
  'GOL_2018': { min: 35000, max: 42000 },
  'GOL_2019': { min: 40000, max: 48000 },
  'GOL_2020': { min: 45000, max: 55000 },
  'GOL_2021': { min: 50000, max: 60000 },
  
  // Fiat
  'ARGO_2019': { min: 50000, max: 60000 },
  'ARGO_2020': { min: 55000, max: 65000 },
  'ARGO_2021': { min: 60000, max: 72000 },
  'ARGO_2022': { min: 68000, max: 80000 },
  'TORO_2019': { min: 90000, max: 110000 },
  'TORO_2020': { min: 100000, max: 120000 },
  'TORO_2021': { min: 115000, max: 135000 },
  'TORO_2022': { min: 130000, max: 155000 },
  'STRADA_2020': { min: 65000, max: 78000 },
  'STRADA_2021': { min: 75000, max: 90000 },
  'STRADA_2022': { min: 85000, max: 100000 },
  'MOBI_2019': { min: 35000, max: 42000 },
  'MOBI_2020': { min: 40000, max: 48000 },
  'MOBI_2021': { min: 45000, max: 55000 },
  'MOBI_2022': { min: 50000, max: 60000 },
  
  // Ford
  'KA_2018': { min: 32000, max: 40000 },
  'KA_2019': { min: 38000, max: 46000 },
  'KA_2020': { min: 42000, max: 52000 },
  'KA_2021': { min: 48000, max: 58000 },
  'ECOSPORT_2018': { min: 55000, max: 68000 },
  'ECOSPORT_2019': { min: 62000, max: 75000 },
  'ECOSPORT_2020': { min: 70000, max: 85000 },
  'RANGER_2019': { min: 140000, max: 170000 },
  'RANGER_2020': { min: 160000, max: 195000 },
  'RANGER_2021': { min: 185000, max: 220000 },
  
  // Toyota
  'COROLLA_2019': { min: 90000, max: 105000 },
  'COROLLA_2020': { min: 105000, max: 120000 },
  'COROLLA_2021': { min: 115000, max: 135000 },
  'COROLLA_2022': { min: 130000, max: 150000 },
  'YARIS_2019': { min: 60000, max: 72000 },
  'YARIS_2020': { min: 68000, max: 80000 },
  'YARIS_2021': { min: 75000, max: 88000 },
  'HILUX_2019': { min: 160000, max: 195000 },
  'HILUX_2020': { min: 180000, max: 220000 },
  'HILUX_2021': { min: 210000, max: 250000 },
  
  // Jeep
  'COMPASS_2019': { min: 100000, max: 120000 },
  'COMPASS_2020': { min: 115000, max: 135000 },
  'COMPASS_2021': { min: 130000, max: 155000 },
  'COMPASS_2022': { min: 145000, max: 175000 },
  'RENEGADE_2019': { min: 75000, max: 90000 },
  'RENEGADE_2020': { min: 85000, max: 100000 },
  'RENEGADE_2021': { min: 95000, max: 115000 },
  'RENEGADE_2022': { min: 105000, max: 125000 },
  
  // Renault
  'KWID_2019': { min: 32000, max: 40000 },
  'KWID_2020': { min: 38000, max: 46000 },
  'KWID_2021': { min: 42000, max: 52000 },
  'KWID_2022': { min: 48000, max: 58000 },
  'DUSTER_2019': { min: 65000, max: 78000 },
  'DUSTER_2020': { min: 72000, max: 85000 },
  'DUSTER_2021': { min: 80000, max: 95000 },
  'DUSTER_2022': { min: 90000, max: 108000 },
  
  // Nissan
  'KICKS_2019': { min: 75000, max: 88000 },
  'KICKS_2020': { min: 82000, max: 95000 },
  'KICKS_2021': { min: 90000, max: 105000 },
  'KICKS_2022': { min: 100000, max: 118000 },
};

// Aliases para modelos com nomes diferentes
const MODEL_ALIASES: Record<string, string> = {
  'T-CROSS': 'TCROSS',
  'T CROSS': 'TCROSS',
  'HR-V': 'HRV',
  'ONIX PLUS': 'ONIX',
  'HB20S': 'HB20',
  'CRUZE LT': 'CRUZE',
  'CRUZE LTZ': 'CRUZE',
};

/**
 * Normaliza o nome do modelo para busca na tabela
 */
function normalizeModel(modelo: string): string {
  let normalized = modelo.toUpperCase().trim();
  
  // Aplicar aliases
  for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
    if (normalized.includes(alias)) {
      normalized = target;
      break;
    }
  }
  
  // Remover sufixos comuns (LT, LTZ, SPORT, etc.)
  normalized = normalized
    .replace(/\s+(LT|LTZ|SPORT|PREMIER|RS|TURBO|PLUS|SEDAN|HATCH).*$/i, '')
    .replace(/\s+\d+\.\d+.*$/, '') // Remove motor (1.0, 1.6, etc)
    .trim();
  
  return normalized;
}

/**
 * Estima o valor de um veículo baseado em modelo/ano
 */
export async function estimateCarValue(
  marca: string,
  modelo: string,
  ano: number,
  km?: number,
  _env?: Env
): Promise<ValuationResult | null> {
  const normalizedModelo = normalizeModel(modelo);
  const key = `${normalizedModelo}_${ano}`;
  
  console.log(`[VALUATION] Looking up: ${key} (original: ${modelo} ${ano})`);
  
  // Primeira tentativa: match exato
  let priceData = PRICE_TABLE[key];
  
  // Segunda tentativa: buscar ano mais próximo
  if (!priceData) {
    const years = [ano - 1, ano + 1, ano - 2, ano + 2];
    for (const y of years) {
      const altKey = `${normalizedModelo}_${y}`;
      if (PRICE_TABLE[altKey]) {
        priceData = PRICE_TABLE[altKey];
        console.log(`[VALUATION] Fallback to nearby year: ${altKey}`);
        break;
      }
    }
  }
  
  if (!priceData) {
    console.log(`[VALUATION] Model not found in table: ${key}`);
    return null;
  }
  
  // Ajuste por quilometragem (±5% por cada 20k km acima/abaixo de 60k)
  let { min, max } = priceData;
  if (km) {
    const kmDiff = km - 60000; // 60k como referência
    const adjustment = (kmDiff / 20000) * 0.05; // 5% por 20k km
    const factor = 1 - adjustment;
    min = Math.round(min * factor);
    max = Math.round(max * factor);
  }
  
  const result: ValuationResult = {
    marca: marca.toUpperCase(),
    modelo: normalizedModelo,
    ano,
    valorMin: min,
    valorMax: max,
    confidence: priceData ? 'high' : 'medium',
    source: 'table',
  };
  
  console.log(`[VALUATION] Result: R$ ${min.toLocaleString('pt-BR')} - R$ ${max.toLocaleString('pt-BR')}`);
  
  return result;
}

/**
 * Formata a estimativa para exibição ao cliente
 */
export function formatValuation(valuation: ValuationResult): string {
  const minFormatted = valuation.valorMin.toLocaleString('pt-BR');
  const maxFormatted = valuation.valorMax.toLocaleString('pt-BR');
  
  return `*R$ ${minFormatted}* e *R$ ${maxFormatted}*`;
}

/**
 * Gera resposta para o cliente com estimativa
 */
export function generateValuationResponse(
  valuation: ValuationResult,
  askConfirmation: boolean = true
): string {
  const valorStr = formatValuation(valuation);
  
  let response = `Perfeito! Um *${valuation.marca} ${valuation.modelo} ${valuation.ano}* `;
  response += `em dia costuma girar entre ${valorStr}, dependendo da versão e do estado geral.`;
  
  if (askConfirmation) {
    response += `\n\nQuer que eu use esse valor como base e já te mostre opções de troca que façam sentido pra você?`;
  }
  
  return response;
}
