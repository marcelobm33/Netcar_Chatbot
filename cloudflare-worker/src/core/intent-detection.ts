/**
 * Intent Detection - Lógica de Detecção
 * =======================================
 * Extrai intenção e filtros de mensagens de usuário.
 * Separado do index.ts original (linhas 3676-4270).
 */

console.log('[DEBUG] Loading intent-detection module...');

import type { CarFilters, DetectedIntent } from '../types';
import {
  CAR_BRANDS,
  MODEL_TO_BRAND,
  CATEGORY_MAP,
  COLOR_MAP,
  TYPO_CORRECTIONS,
  TRADE_IN_KEYWORDS,
} from './intent-config';

// =============================================================================
// TIPOS
// =============================================================================

export interface ExtractedCarFilters {
  modelo?: string;
  marca?: string;
  precoMin?: number;
  precoMax?: number;
  categoria?: string;
  cor?: string;
  transmissao?: string;
  motor?: string;
  opcional?: string;
}

// =============================================================================
// DETECTOR DE PEDIDO DE HUMANO/VENDEDOR
// =============================================================================

/**
 * Detecta se usuário quer falar com um humano/vendedor
 * Regra B do prompt: PEDIU HUMANO → ENCAMINHAR_VENDEDOR
 */
export function detectHumanRequest(message: string): boolean {
  const lowerMsg = message.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove accents
    
  const humanPatterns = [
    // Pedindo vendedor/atendente
    /chame?\s*(um|o)?\s*(vendedor|atendente|consultor|humano|pessoa)/,
    /quero\s*(falar|conversar)\s*(com\s*(um|o)?\s*)?(vendedor|atendente|consultor|humano|pessoa|alguem)/,
    /falar\s*com\s*(vendedor|atendente|consultor|humano|pessoa|alguem)/,
    /chamar\s*(vendedor|atendente|consultor)/,
    /passar\s*(pra|para)\s*(um\s*)?(vendedor|atendente|consultor)/,
    /transferir\s*(pra|para)\s*(um\s*)?(vendedor|atendente|consultor)/,
    /preciso\s*(de\s*(um\s*)?)?(vendedor|atendente|consultor|humano)/,
    /pode\s*chamar\s*(o|um)?\s*(vendedor|atendente)/,
    // Frustração / não entendeu
    /nao\s*entendi/,
    /nao\s*(ta|esta)\s*ajudando/,
    /voce\s*(e|eh)\s*um\s*robo/,
    /quero\s*pessoa\s*de\s*verdade/,
    // Interesse alto (fechar negócio)
    /quero\s*fechar/,
    /vou\s*comprar/,
    /vou\s*fechar/,
    /fechou\s*negocio/,
    /bora\s*fechar/,
    // Financiamento/negociação
    /financiar/,
    /parcela/,
    /entrada/,
    /simular/,
    /ultimo\s*preco/,
    /melhor\s*preco/,
    /melhor\s*condicao/,
    /pode\s*baixar/,
    /faz\s*(um\s*)?desconto/,
    // Visita/agendamento
    /quero\s*visitar/,
    /agendar\s*(visita|horario)/,
    /posso\s*ir\s*(ai|la)/,
  ];
  
  return humanPatterns.some(pattern => pattern.test(lowerMsg));
}

// =============================================================================
// DETECTOR PRINCIPAL
// =============================================================================

/**
 * Detecta se usuário está pedindo um carro e extrai filtros
 * @param message Mensagem do usuário
 * @returns Filtros extraídos ou null se não for busca
 */
export function detectCarIntent(message: string): ExtractedCarFilters | null {
  const lowerMsg = message.toLowerCase();
  
  // FIX #8: REMOVIDO o return null para trade-in
  // A lógica de trade-in agora é tratada em detectModel() que prioriza o carro de INTERESSE
  // Antes: retornava null aqui e não buscava nada
  // Agora: continua e deixa detectModel extrair o carro correto

  
  const result: ExtractedCarFilters = {};
  let hasAnyIntent = false;
  
  // 1. Transmissão
  const transmission = detectTransmission(lowerMsg);
  if (transmission) {
    result.transmissao = transmission;
    hasAnyIntent = true;
  }
  
  // 2. Motor
  const motor = detectMotor(lowerMsg);
  if (motor) {
    result.motor = motor;
    hasAnyIntent = true;
  }
  
  // 3. Preço
  const price = detectPrice(lowerMsg);
  if (price.precoMin || price.precoMax) {
    result.precoMin = price.precoMin;
    result.precoMax = price.precoMax;
    hasAnyIntent = true;
  }
  
  // 4. Categoria
  const category = detectCategory(lowerMsg);
  if (category) {
    result.categoria = category;
    hasAnyIntent = true;
  }
  
  // 5. Marca
  const brand = detectBrand(lowerMsg);
  if (brand) {
    result.marca = brand;
    hasAnyIntent = true;
  }
  
  // 6. Modelo (pode sobrescrever marca)
  const modelResult = detectModel(lowerMsg);
  if (modelResult.modelo) {
    result.modelo = modelResult.modelo;
    if (modelResult.marca) {
      result.marca = modelResult.marca;
    }
    hasAnyIntent = true;
  }
  
  // 7. Opcionais (teto panorâmico, apple carplay, etc)
  const optional = detectOptional(lowerMsg);
  if (optional) {
    result.opcional = optional;
    hasAnyIntent = true;
  }
  
  // 8. Cor
  const color = detectColor(lowerMsg);
  if (color) {
    result.cor = color;
    hasAnyIntent = true;
  }
  
  // 8. Intenção genérica (sem filtros específicos)
  if (!hasAnyIntent && isGenericCarIntent(lowerMsg)) {
    return {}; // Busca geral
  }
  
  return hasAnyIntent ? result : null;
}

// =============================================================================
// DETECTORES ESPECÍFICOS
// =============================================================================

function isTradeInIntent(lowerMsg: string): boolean {
  return TRADE_IN_KEYWORDS.some(kw => lowerMsg.includes(kw));
}

function detectTransmission(lowerMsg: string): string | null {
  if (lowerMsg.includes("automatico") || lowerMsg.includes("automático")) {
    return "AUTOMATICO";
  }
  if (lowerMsg.includes("manual")) {
    return "MANUAL";
  }
  return null;
}

function detectMotor(lowerMsg: string): string | null {
  const patterns = [
    /motor\s*(\d[.,]\d)\s*(turbo)?/i,
    /(\d[.,]\d)\s*(turbo|tsi|tfsi)/i,
    /(?:carro|quero|tem)\s*(\d[.,]\d)/i,
  ];
  
  for (const pattern of patterns) {
    const match = lowerMsg.match(pattern);
    if (match) {
      const motorValue = match[1].replace(",", ".");
      const hasTurbo = match[2] || lowerMsg.includes("turbo");
      return hasTurbo ? `${motorValue} turbo` : motorValue;
    }
  }
  return null;
}

function detectPrice(lowerMsg: string): { precoMin?: number; precoMax?: number } {
  const result: { precoMin?: number; precoMax?: number } = {};
  
  // Range: "entre X e Y", "de X a Y"
  const rangeMatch = lowerMsg.match(/(?:entre|de)\s*(\d+)\s*(?:mil|k)?\s*(?:e|a)\s*(\d+)\s*(?:mil|k)?/i);
  if (rangeMatch) {
    result.precoMin = parsePrice(rangeMatch[1], lowerMsg);
    result.precoMax = parsePrice(rangeMatch[2], lowerMsg);
    return result;
  }
  
  // Até: "até 80 mil"
  const maxMatch = lowerMsg.match(/at[eé]\s*(\d+)\s*(?:mil|k)?/i);
  if (maxMatch) {
    result.precoMax = parsePrice(maxMatch[1], lowerMsg) * 1.05;
    return result;
  }
  
  // Acima/partir: "acima de 50 mil"
  const minMatch = lowerMsg.match(/(?:acima|partir|mais)\s*(?:de)?\s*(\d+)\s*(?:mil|k)?/i);
  if (minMatch) {
    result.precoMin = parsePrice(minMatch[1], lowerMsg) * 0.95;
    return result;
  }
  
  // Simples: "100 mil"
  const simpleMatch = lowerMsg.match(/(\d+)\s*(?:mil|k)(?!\s*km)/i);
  if (simpleMatch) {
    const price = parsePrice(simpleMatch[1], lowerMsg);
    result.precoMin = price * 0.95;
    result.precoMax = price * 1.05;
    return result;
  }
  
  return result;
}

function parsePrice(value: string, lowerMsg: string): number {
  let num = parseInt(value, 10);
  if (lowerMsg.includes("mil") || lowerMsg.includes("k")) {
    num *= 1000;
  }
  if (num < 1000) {
    num *= 1000;
  }
  return num;
}

function detectCategory(lowerMsg: string): string | null {
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lowerMsg.includes(keyword)) {
      return category;
    }
  }
  return null;
}

function detectBrand(lowerMsg: string): string | null {
  for (const [keyword, brand] of Object.entries(CAR_BRANDS)) {
    if (lowerMsg.includes(keyword)) {
      // Exclusão: "mini" não deve match "mínimo"
      if (keyword === "mini" && /m[ií]nim[oa]/i.test(lowerMsg)) {
        continue;
      }
      return brand;
    }
  }
  return null;
}

// FIX #9: Exportada para uso no router.service.ts
export function detectModel(lowerMsg: string): { modelo?: string; marca?: string } {
  const models = Object.keys(MODEL_TO_BRAND);
  const sortedModels = models.sort((a, b) => b.length - a.length);
  
  // Buscar padrão "X ou Y"
  const orMatch = lowerMsg.match(/(\w+)\s+ou\s+(\w+)/i);
  if (orMatch) {
    const model1 = orMatch[1].toLowerCase();
    const model2 = orMatch[2].toLowerCase();
    
    if (models.includes(model1) && models.includes(model2)) {
      return { modelo: `${normalizeModel(model1)}|${normalizeModel(model2)}` };
    }
  }
  
  // FIX #5: Em cenários de TROCA, priorizar o carro de INTERESSE (o que ele QUER)
  // Detectar cenário de troca
  const isTradeScenario = /tenho|ela tem|ele tem|meu carro|minha .* [eé]|quero trocar|na troca/.test(lowerMsg);
  
  if (isTradeScenario) {
    // Palavras que indicam o carro de INTERESSE (o que ele quer COMPRAR)
    // FIX #6: Melhorado para capturar modelo mesmo com artigos "um", "uma", "o", "a"
    const interestPatterns = [
      /quer(?:o|endo)?\s+(?:uma?|[ao])?\s*(\w+)/i,           // "quero Taos", "quero um Taos"
      /olhando\s+(?:uma?|[ao])?\s*(\w+)/i,                   // "olhando uma Taos"
      /(?:ta|tá|está)\s+olhando\s+(?:uma?|[ao])?\s*(\w+)/i,  // "ta olhando uma Taos"
      /procurando\s+(?:uma?|[ao])?\s*(\w+)/i,                // "procurando Taos"
      /interesse\s+(?:n[oa])?\s*(\w+)/i,                     // "interesse na Taos"
      /trocar\s+por\s+(?:uma?|[ao])?\s*(\w+)/i,              // "trocar por uma Taos"
      /(?:comprar|pegar|adquirir)\s+(?:uma?|[ao])?\s*(\w+)/i // "comprar uma Taos"
    ];
    
    // Artigos e palavras a ignorar se capturadas
    const SKIP_WORDS = ['um', 'uma', 'o', 'a', 'os', 'as', 'uns', 'umas', 'de', 'da', 'do', 'pra', 'para'];
    
    // Primeiro: buscar modelo após padrões de interesse
    for (const pattern of interestPatterns) {
      const match = lowerMsg.match(pattern);
      if (match && match[1]) {
        let potentialModel = match[1].toLowerCase();
        console.log(`[INTENT] Trade scenario: pattern ${pattern} matched "${potentialModel}"`);
        
        // FIX #6: Se capturou um artigo, buscar próxima palavra
        if (SKIP_WORDS.includes(potentialModel)) {
          console.log(`[INTENT] Trade scenario: matched SKIP_WORD "${potentialModel}", looking ahead...`);
          // Buscar próxima palavra após o artigo
          const afterArticle = lowerMsg.indexOf(potentialModel) + potentialModel.length;
          const remainingText = lowerMsg.substring(afterArticle).trim();
          const nextWordMatch = remainingText.match(/^(\w+)/);
          if (nextWordMatch) {
            potentialModel = nextWordMatch[1].toLowerCase();
            console.log(`[INTENT] Trade scenario: found next word "${potentialModel}"`);
          } else {
            continue;
          }
        }
        
        for (const model of sortedModels) {
          if (potentialModel === model || potentialModel.includes(model) || model.includes(potentialModel)) {
            const normalized = normalizeModel(model);
            const brand = MODEL_TO_BRAND[model];
            console.log(`[INTENT] Trade scenario: found INTEREST car "${normalized}" (matched from "${potentialModel}")`);
            return { modelo: normalized, marca: brand };
          }
        }
      }
    }

    
    // Segundo: buscar modelo APÓS palavras de interesse no texto
    // FIX #7: Buscar por ORDEM DE APARIÇÃO no texto, não por tamanho do modelo
    const interestIdx = Math.max(
      lowerMsg.indexOf('quero'),
      lowerMsg.indexOf('quer '),
      lowerMsg.indexOf('olhando'),
      lowerMsg.indexOf('procurando'),
      lowerMsg.indexOf('trocar por'),
      lowerMsg.indexOf('interesse')
    );
    
    console.log(`[INTENT] Trade scenario: interestIdx=${interestIdx}`);
    
    if (interestIdx > 0) {
      const afterInterest = lowerMsg.substring(interestIdx);
      console.log(`[INTENT] Trade scenario: checking afterInterest text: "${afterInterest}"`);
      
      // Encontrar QUAL modelo aparece PRIMEIRO no texto após o keyword
      let firstModelFound: { model: string; position: number } | null = null;
      
      for (const model of sortedModels) {
        const modelPos = afterInterest.indexOf(model);
        if (modelPos >= 0) {
          console.log(`[INTENT] Trade scenario: found candidate model "${model}" at pos ${modelPos}`);
          // Se é a primeira ocorrência OU aparece antes do modelo anterior
          if (!firstModelFound || modelPos < firstModelFound.position) {
            firstModelFound = { model, position: modelPos };
          }
        }
      }
      
      if (firstModelFound) {
        const normalized = normalizeModel(firstModelFound.model);
        const brand = MODEL_TO_BRAND[firstModelFound.model];
        console.log(`[INTENT] Trade scenario: SELECTED INTEREST car "${normalized}" at position ${firstModelFound.position}`);
        return { modelo: normalized, marca: brand };
      }
    }


  }
  
  // FIX #14c: Check if user is asking a generic question (price, availability)
  // In such cases, ignore models mentioned in casual/narrative context
  const isGenericQuery = /(?:qual|quais|tem|vocês têm|voces tem|tem algum|ate|até)\s+(?:\d+\s*mil|carro|algo)/i.test(lowerMsg);
  
  // Patterns that indicate narrative/casual context (NOT purchase interest)
  const casualContextPatterns = [
    /(?:anda|dirige|usa|pilota)\s+(?:num|numa|n'um|n'uma|um|uma)\s+/i,
    /(?:avo|avô|avó|tio|tia|primo|prima|vizinho|amigo|pai|mae|mãe|falecido)\s+.*?\s+(?:tem|tinha|anda|dirige|usa|achou)/i,
    /(?:tem|tinha|possui|achou)\s+(?:\d+\s+)?(?:gatos?|cachorros?|filhos?|caminhao|caminhão|bicicleta)/i,
    /garagem\s+.*?\s+(?:um|uma)\s+/i,
  ];
  
  const hasCasualContext = casualContextPatterns.some(p => p.test(lowerMsg));
  
  // If it's a generic query AND there's casual context, skip model detection entirely
  if (isGenericQuery && hasCasualContext) {
    console.log('[INTENT] Skipping model detection: generic query with casual context');
    return {};
  }
  
  // Comportamento padrão: retornar primeiro modelo encontrado (para cenários sem troca)
  for (const model of sortedModels) {
    if (lowerMsg.includes(model)) {
      // FIX #14c: Double-check this specific model isn't in casual context
      const casualModelPatterns = [
        new RegExp(`(?:anda|dirige|usa)\\s+(?:num|numa|n'um|n'uma|um|uma)\\s+${model}`, 'i'),
        new RegExp(`achou\\s+(?:um|uma)\\s+${model}`, 'i'),
        new RegExp(`(?:tio|tia|avo|avô|avó|falecido)\\s+.*?${model}`, 'i'),
      ];
      
      const modelInCasualContext = casualModelPatterns.some(p => p.test(lowerMsg));
      if (modelInCasualContext && isGenericQuery) {
        console.log(`[INTENT] Skipping model "${model}": casual mention + generic query`);
        continue;
      }
      
      const normalized = normalizeModel(model);
      const brand = MODEL_TO_BRAND[model];
      return { modelo: normalized, marca: brand };
    }
  }
  
  return {};
}


function normalizeModel(model: string): string {
  return TYPO_CORRECTIONS[model] || model;
}

function detectColor(lowerMsg: string): string | null {
  // FIX #15: Check if this is a generic query with casual context
  // Same logic as detectModel - if colors appear only in narrative context, ignore them
  const genericQueryPatterns = [
    /quais?\s+carros?\s+(?:voce|vc|tu)\s+tem/i,
    /(?:qual|quais|que)\s+(?:opcao|opcoes|carro|carros)/i,
    /tem\s+(?:carro|opcao|algum)/i,
    /entre\s+\d+\s*(?:mil|k|m)?\s*e\s*\d+/i,
    /ate\s+\d+\s*(?:mil|k|m)?/i,
    /quer\s+saber\s+quais/i
  ];
  
  const casualContextPatterns = [
    /(?:meu\s+)?(?:avo|tio|tia|prima?o?|vizinho|amigo|colega|pai|mae|irmao?|irma|avô|vovô|vovó)\s+(?:tem|tinha|anda|andava|possui|tem\s+um|tem\s+uma)/i,
    /(?:achou|encontrou|ganhou|herdou)\s+(?:um|uma|o|a)\s+/i,
    /(?:na\s+garagem|do\s+(?:meu\s+)?(?:falecido|finado))/i,
    /(?:ela|ele)\s+(?:tem|tinha|possui|anda)/i
  ];
  
  const isGenericQuery = genericQueryPatterns.some(p => p.test(lowerMsg));
  const hasCasualContext = casualContextPatterns.some(p => p.test(lowerMsg));
  
  if (isGenericQuery && hasCasualContext) {
    // Find colors and check if they appear AFTER the main query intent
    const queryMatch = lowerMsg.match(/(?:quais?\s+carros|que\s+carros|tem\s+carro|entre\s+\d+.*\d+|ate\s+\d+)/i);
    if (queryMatch && queryMatch.index !== undefined) {
      const queryIdx = queryMatch.index;
      
      // Check each color - only extract if it appears AFTER the query intent
      for (const [keyword, color] of Object.entries(COLOR_MAP)) {
        const colorIdx = lowerMsg.indexOf(keyword);
        if (colorIdx !== -1) {
          // If color appears BEFORE the query intent, it's casual context - skip it
          if (colorIdx < queryIdx) {
            console.log(`[INTENT] Skipping color ${color}: appears before query intent (casual context)`);
            continue;
          }
          return color;
        }
      }
      console.log(`[INTENT] Skipping color extraction: generic query with casual context`);
      return null;
    }
  }
  
  // Standard extraction for non-casual contexts
  for (const [keyword, color] of Object.entries(COLOR_MAP)) {
    if (lowerMsg.includes(keyword)) {
      return color;
    }
  }
  return null;
}

/**
 * Detecta opcionais/features de carro
 * teto panorâmico, teto solar, apple carplay, android auto, etc
 * UPDATED: Returns multiple optionals as comma-separated string
 */
function detectOptional(lowerMsg: string): string | null {
  const OPTIONAL_MAP: Record<string, string> = {
    'teto panoramico': 'teto_panoramico',
    'teto panorâmico': 'teto_panoramico',
    'teto solar': 'teto_solar',
    'apple carplay': 'apple_carplay',
    'carplay': 'apple_carplay',
    'android auto': 'android_auto',
    'camera de re': 'camera_de_re',
    'câmera de ré': 'camera_de_re',
    'sensor de estacionamento': 'sensor',
    'sensor de ré': 'sensor',
    'piloto automatico': 'piloto_automatico',
    'piloto automático': 'piloto_automatico',
    'cruise control': 'piloto_automatico',
    'banco de couro': 'bancos_de_couro',
    'bancos de couro': 'bancos_de_couro',
    'couro': 'bancos_de_couro',
    'multimidia': 'multimidia',
    'multimídia': 'multimidia',
    'central multimidia': 'multimidia',
  };

  // Find ALL matching optionals
  const foundOptionals = new Set<string>();
  for (const [keyword, tag] of Object.entries(OPTIONAL_MAP)) {
    if (lowerMsg.includes(keyword)) {
      foundOptionals.add(tag);
    }
  }
  
  if (foundOptionals.size > 0) {
    return Array.from(foundOptionals).join(',');
  }
  return null;
}

function isGenericCarIntent(lowerMsg: string): boolean {
  // Perguntas contextuais - não buscar
  if (/tem\s+algo|tem\s+algum|desses\s+tem/i.test(lowerMsg)) {
    return false;
  }
  
  // Padrões genéricos de busca
  const patterns = [
    /tem\s+[\w]{4,}/i,
    /procuro\s+\w+/i,
    /quero\s+ver\s+(carros?|veículos?)/i,
    /mostra\s+(carros?|veículos?)/i,
    /(quero|procuro|busco)\s*(um\s*)?(carros?|veículos?|seminovos?)/i,
  ];
  
  return patterns.some(p => p.test(lowerMsg));
}

// =============================================================================
// CONVERSÃO PARA TIPO DO BOT
// =============================================================================

/**
 * Converte filtros extraídos para DetectedIntent
 */
export function toDetectedIntent(
  filters: ExtractedCarFilters | null,
  message: string
): DetectedIntent {
  if (!filters) {
    // Verificar se é outro tipo de intenção
    const lowerMsg = message.toLowerCase();
    
    if (isTradeInIntent(lowerMsg)) {
      return { type: 'negotiation', confidence: 0.8, raw: message };
    }
    
    if (/falar|atendente|vendedor|humano|pessoa/i.test(lowerMsg)) {
      return { type: 'handoff', confidence: 0.9, raw: message };
    }
    
    if (/oi|olá|bom dia|boa tarde|boa noite|eae|opa/i.test(lowerMsg)) {
      return { type: 'greeting', confidence: 0.7, raw: message };
    }
    
    return { type: 'other', confidence: 0.5, raw: message };
  }
  
  // Converter para CarFilters
  const carFilters: CarFilters = {
    marca: filters.marca,
    modelo: filters.modelo,
    anoMin: undefined,
    anoMax: undefined,
    valorMin: filters.precoMin,
    valorMax: filters.precoMax,
    cor: filters.cor,
    cambio: filters.transmissao,
    combustivel: undefined,
  };
  
  return {
    type: 'car_search',
    confidence: 0.85,
    filters: carFilters,
    raw: message,
  };
}
