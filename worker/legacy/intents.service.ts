/**
 * Intents Service - Deterministic Intent Detection
 * 
 * This service detects user intentions WITHOUT using AI, 
 * providing predictable and fast responses.
 */

// ============================================================
// CAR MODELS AND BRANDS DATABASE
// ============================================================

export const CAR_MODELS = [
  // Hatch
  'onix', 'hb20', 'polo', 'gol', 'argo', 'mobi', 'kwid', 'sandero', 'ka', 'fiesta',
  'up', 'fox', 'fit', 'city hatch', 'yaris hatch', '208', 'c3', 'clio',
  
  // Sedan
  'onix plus', 'hb20s', 'voyage', 'prisma', 'cronos', 'virtus', 'city', 'civic',
  'corolla', 'sentra', 'versa', 'cruze', 'cobalt', 'logan', 'siena', 'yaris sedan',
  
  // SUV
  'tracker', 'creta', 'kicks', 't-cross', 'tcross', 'renegade', 'compass', 
  'hr-v', 'hrv', 'ecosport', 'duster', 'captur', 'nivus', 'taos', 'tiguan',
  'tucson', 'sportage', 'ix35', 'asx', 'outlander', 'rav4', 'sw4', 'wrangler',
  '2008', '3008', '5008', 'c4 cactus', 'pulse', 'fastback',
  
  // Pickup
  'toro', 'strada', 'saveiro', 'montana', 'hilux', 's10', 'ranger', 'amarok',
  'frontier', 'l200', 'triton', 'oroch', 'ram',
  
  // Minivan/Van
  'spin', 'doblo', 'kangoo', 'partner'
];

export const CAR_BRANDS = [
  'chevrolet', 'gm', 'volkswagen', 'vw', 'fiat', 'ford', 'honda', 'toyota',
  'hyundai', 'nissan', 'renault', 'jeep', 'citroen', 'citroën', 'peugeot',
  'kia', 'mitsubishi', 'bmw', 'mercedes', 'audi', 'volvo', 'subaru',
  'suzuki', 'chery', 'jac', 'caoa', 'byd', 'gwm', 'ram', 'dodge', 'mini',
  'land rover', 'porsche', 'jaguar', 'alfa romeo', 'lexus', 'infiniti'
];

// ============================================================
// INTENT TYPES
// ============================================================

export type IntentType = 
  | 'SELLER_REQUEST'     // Wants to talk to a human
  | 'EXTERNAL_LINK'      // Sent a link from ads
  | 'CAR_SEARCH'         // Looking for a specific car
  | 'PRICE_QUERY'        // Asking about prices/FIPE
  | 'GREETING'           // Initial greeting
  | 'COMPLAINT'          // Negative sentiment
  | 'TRADE_IN'           // Wants to trade/sell car
  | 'APPOINTMENT'        // Wants to schedule visit
  | 'STOCK_QUERY'        // Asking about available stock
  | 'CONVERSATION';      // General conversation -> AI handles

export interface DetectedIntent {
  type: IntentType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  extractedData?: {
    carModel?: string;
    carBrand?: string;
    priceMin?: number;
    priceMax?: number;
    year?: number;
    motor?: string;      // Engine: 1.3, 2.0, 1.0 turbo
    opcional?: string;   // Optional: teto_panoramico, apple_carplay
  };
}

// ============================================================
// FIX #4: COMMON BRAZILIAN NAMES TO AVOID FALSE POSITIVES
// E.g., "Bruno" should NOT be detected as "uno"
// ============================================================

const COMMON_BRAZILIAN_NAMES = [
  // Names that contain car model strings
  'bruno', 'marco', 'polo', 'alex', 'enzo', 'ivan', 'igor', 'hugo',
  'kaique', 'thiago', 'diego', 'rodrigo', 'fernando', 'gustavo', 'julio',
  'lucas', 'mateus', 'pedro', 'rafael', 'vitor', 'antonio', 'carlos',
  'daniel', 'eduardo', 'fabio', 'gabriel', 'henrique', 'joao', 'jose',
  'leonardo', 'marcelo', 'nelson', 'oscar', 'paulo', 'renato', 'sergio',
  'wagner', 'willian', 'william', 'washington', 'anderson', 'victor'
];

/**
 * Check if a word is part of a name (e.g., 'uno' inside 'Bruno')
 */
function isPartOfName(word: string, message: string): boolean {
  const msgLower = message.toLowerCase();
  
  for (const name of COMMON_BRAZILIAN_NAMES) {
    // Check if the message contains a name that includes this word
    // E.g., 'Bruno' contains 'uno', but 'uno' alone is valid
    if (name.includes(word) && msgLower.includes(name)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================
// EXTRACTION FUNCTIONS
// ============================================================

/**
 * Extract car model from message text
 * FIX #4: Now ignores words that are parts of common names
 * FIX #5: In trade-in scenarios, prioritizes the INTEREST car (what they WANT)
 *         over the TRADE car (what they HAVE)
 */
export function extractCarModel(message: string): string | null {
  const msgLower = message.toLowerCase();
  
  // FIX #5: Detect trade-in scenario - customer has one car, wants another
  const isTradeScenario = /tenho|ela tem|ele tem|meu carro|minha .* é|quero trocar|na troca/.test(msgLower);
  
  if (isTradeScenario) {
    // In trade scenarios, find the INTEREST car (what they WANT to buy)
    // Interest keywords: quero, olhando, procurando, buscando, interesse
    const interestPatterns = [
      /quer(?:o|endo)?\s+(?:uma?\s+)?(\w+)/i,        // "quero Taos", "querendo uma Taos"
      /olhando\s+(?:uma?\s+)?(\w+)/i,                // "olhando uma Taos"
      /(?:ta|tá|está)\s+olhando\s+(?:uma?\s+)?(\w+)/i, // "ta olhando uma Taos"
      /procurando\s+(?:uma?\s+)?(\w+)/i,             // "procurando Taos"
      /interesse\s+(?:n[oa])?\s*(\w+)/i,             // "interesse na Taos"
      /trocar\s+por\s+(?:uma?\s+)?(\w+)/i,           // "trocar por uma Taos"
      /(?:comprar|pegar|adquirir)\s+(?:uma?\s+)?(\w+)/i // "comprar uma Taos"
    ];
    
    for (const pattern of interestPatterns) {
      const match = msgLower.match(pattern);
      if (match && match[1]) {
        const potentialModel = match[1].toLowerCase();
        // Verify it's actually a car model
        for (const model of CAR_MODELS) {
          if (potentialModel.includes(model) || model.includes(potentialModel)) {
            // FIX #4: Check if this is part of a name
            if (isPartOfName(model, message)) continue;
            return model;
          }
        }
      }
    }
    
    // Secondary: Look for model after interest keywords in the text
    // E.g., "tenho Compass e quero ver a Taos" -> find model after "quero"
    const interestIdx = Math.max(
      msgLower.indexOf('quero'),
      msgLower.indexOf('quer '),
      msgLower.indexOf('olhando'),
      msgLower.indexOf('procurando'),
      msgLower.indexOf('trocar por'),
      msgLower.indexOf('interesse')
    );
    
    if (interestIdx > 0) {
      const afterInterest = msgLower.substring(interestIdx);
      for (const model of CAR_MODELS) {
        if (afterInterest.includes(model)) {
          if (isPartOfName(model, message)) continue;
          return model;
        }
      }
    }
  }
  
  // FIX #14b: Check if user is asking a generic question (price, availability)
  // In such cases, ignore models mentioned in casual/narrative context
  const isGenericQuery = /(?:qual|quais|tem|vocês têm|voces tem|tem algum|ate|até)\s+(?:\d+\s*mil|carro|algo)/i.test(msgLower);
  
  // Patterns that indicate narrative/casual context (NOT purchase interest)
  const casualContextPatterns = [
    /(?:anda|dirige|usa|pilota)\s+(?:num|numa|n'um|n'uma|um|uma)\s+/i,
    /(?:avo|avô|avó|tio|tia|primo|prima|vizinho|amigo|pai|mae|mãe)\s+.*?\s+(?:tem|anda|dirige|usa)/i,
    /(?:tem|tinha|possui)\s+(?:\d+\s+)?(?:gatos?|cachorros?|filhos?)/i,
  ];
  
  const hasCasualContext = casualContextPatterns.some(p => p.test(msgLower));
  
  // If it's a generic query AND there's casual context, skip model detection entirely
  if (isGenericQuery && hasCasualContext) {
    console.log('[INTENTS] Skipping model detection: generic query with casual context');
    return null;
  }
  
  // Default behavior: return first model found (for non-trade scenarios)
  for (const model of CAR_MODELS) {
    if (msgLower.includes(model)) {
      // FIX #14b: Double-check this specific model isn't in casual context
      const modelRegex = new RegExp(`(?:anda|dirige|usa)\\s+(?:num|numa|n'um|n'uma|um|uma)\\s+${model}`, 'i');
      if (modelRegex.test(msgLower) && isGenericQuery) {
        console.log(`[INTENTS] Skipping model "${model}": casual mention + generic query`);
        continue;
      }
      
      // FIX #4: Check if this is part of a name (false positive)
      if (isPartOfName(model, message)) {
        continue; // Skip - it's part of a name, not a car model
      }
      return model;
    }
  }
  
  return null;
}


/**
 * Extract car brand from message text
 */
export function extractCarBrand(message: string): string | null {
  const msgLower = message.toLowerCase();
  
  for (const brand of CAR_BRANDS) {
    if (msgLower.includes(brand)) {
      return brand;
    }
  }
  
  return null;
}

/**
 * Extract price range from message
 * Examples:
 *   "até 50 mil" -> { max: 50000 }
 *   "de 30 a 50" -> { min: 30000, max: 50000 }
 *   "carro de 80k" -> { max: 80000 }
 *   "100 mil" -> { max: 100000 }
 */
export function extractPriceRange(message: string): { min?: number; max?: number } | null {
  const msgLower = message.toLowerCase();
  const result: { min?: number; max?: number } = {};
  
  // Pattern: "até X mil" or "até X k"
  const ateMatch = msgLower.match(/até\s*(\d+)\s*(mil|k|reais|conto)/);
  if (ateMatch) {
    const value = parseInt(ateMatch[1], 10);
    result.max = ateMatch[2] === 'mil' || ateMatch[2] === 'k' || ateMatch[2] === 'conto' 
      ? value * 1000 
      : value;
    return result;
  }
  
  // Pattern: "de X a Y"
  const deAMatch = msgLower.match(/de\s*(\d+)\s*a\s*(\d+)/);
  if (deAMatch) {
    result.min = parseInt(deAMatch[1], 10) * 1000;
    result.max = parseInt(deAMatch[2], 10) * 1000;
    return result;
  }
  
  // Pattern: "X mil" or "Xk" at the end or standalone
  const milMatch = msgLower.match(/(\d+)\s*(mil|k)/);
  if (milMatch) {
    result.max = parseInt(milMatch[1], 10) * 1000;
    return result;
  }
  
  // Pattern: R$ X.XXX or R$XX.XXX
  const realMatch = msgLower.match(/r\$\s*(\d{1,3}\.?\d{3})/);
  if (realMatch) {
    result.max = parseInt(realMatch[1].replace('.', ''), 10);
    return result;
  }
  
  return null;
}

/**
 * Extract year from message
 */
export function extractYear(message: string): number | null {
  // Pattern: 4-digit year between 2000 and current year + 1
  const currentYear = new Date().getFullYear();
  const yearMatch = message.match(/(20[0-2]\d|199\d)/);
  
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1990 && year <= currentYear + 1) {
      return year;
    }
  }
  
  return null;
}

// ============================================================
// INTENT DETECTION KEYWORDS
// ============================================================

const SELLER_KEYWORDS = [
  'vendedor', 'consultor', 'atendente', 'humano', 'pessoa',
  'falar com', 'contato', 'ligar', 'whatsapp', 'numero', 'número',
  'quero falar', 'preciso falar', 'me passa', 'passa pra',
  'chama alguem', 'chama alguém', 'chamar'
];

const GREETING_KEYWORDS = [
  'oi', 'olá', 'ola', 'opa', 'ei', 'hey', 'eai', 'e aí',
  'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'tudo bom',
  'boa', 'começar', 'iniciar', 'menu'
];

const COMPLAINT_KEYWORDS = [
  'absurdo', 'horrível', 'péssimo', 'pessimo', 'lixo', 'vergonha',
  'nunca mais', 'reclamar', 'reclamação', 'problema', 'defeito',
  'enganado', 'mentira', 'enrolando', 'demora', 'não funciona',
  'nao funciona', 'quebrado', 'estragado', 'insatisfeito'
];

const TRADE_IN_KEYWORDS = [
  'aceita', 'aceitar', 'aceitam', 'pegam', 'pega na', 'pegar',
  'troca', 'trocar', 'trocam', 'tenho um', 'tenho uma', 'meu carro',
  'minha moto', 'avaliar', 'avaliação', 'quanto vale', 'quanto paga',
  'compram', 'compraria', 'na troca', 'como entrada', 'dar na troca',
  'vender', 'vendo', 'vendendo', 'quero vender', 'preciso vender'
];

const APPOINTMENT_KEYWORDS = [
  'agendar', 'agendamento', 'visita', 'visitar', 'ir na loja',
  'conhecer a loja', 'marcar horário', 'marcar horario', 'aparecer',
  'passar aí', 'ir aí', 'vou aí'
];

const PRICE_KEYWORDS = [
  'fipe', 'tabela fipe', 'quanto custa', 'qual o valor', 'qual valor',
  'preço', 'preco', 'valor do', 'custa quanto', 'sai por quanto'
];

const LINK_PATTERNS = [
  /https?:\/\//,
  /www\./,
  /instagram\.com/,
  /facebook\.com/,
  /fb\.me/,
  /olx\./,
  /webmotors\./,
  /mercadolivre\./,
  /kavak\./,
  /mobiauto\./,
  /autocarro\./,
  /icarros\./
];

// ============================================================
// MAIN INTENT DETECTION
// ============================================================

/**
 * Detect the user's intent from message text
 * Returns the intent type and any extracted data
 */
export function detectIntent(message: string): DetectedIntent {
  const msgLower = message.toLowerCase().trim();
  
  // Priority 1: External links (most specific)
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(message)) {
      return {
        type: 'EXTERNAL_LINK',
        confidence: 'HIGH',
        extractedData: {
          carModel: extractCarModel(message) || undefined,
          carBrand: extractCarBrand(message) || undefined
        }
      };
    }
  }
  
  // Priority 2: Complaints (handle with care)
  for (const keyword of COMPLAINT_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      return { type: 'COMPLAINT', confidence: 'HIGH' };
    }
  }
  
  // Priority 3: Seller request
  for (const keyword of SELLER_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      return { type: 'SELLER_REQUEST', confidence: 'HIGH' };
    }
  }
  
  // Priority 4: Trade-in request
  for (const keyword of TRADE_IN_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      return { type: 'TRADE_IN', confidence: 'HIGH' };
    }
  }
  
  // Priority 5: Appointment
  for (const keyword of APPOINTMENT_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      return { type: 'APPOINTMENT', confidence: 'HIGH' };
    }
  }
  
  // Priority 6: Price query
  for (const keyword of PRICE_KEYWORDS) {
    if (msgLower.includes(keyword)) {
      return { type: 'PRICE_QUERY', confidence: 'HIGH' };
    }
  }
  
  // Priority 7: Car search (model, brand, or price)
  const carModel = extractCarModel(message);
  const carBrand = extractCarBrand(message);
  const priceRange = extractPriceRange(message);
  const year = extractYear(message);
  
  if (carModel || carBrand || priceRange) {
    return {
      type: 'CAR_SEARCH',
      confidence: carModel ? 'HIGH' : 'MEDIUM',
      extractedData: {
        carModel: carModel || undefined,
        carBrand: carBrand || undefined,
        priceMin: priceRange?.min,
        priceMax: priceRange?.max,
        year: year || undefined
      }
    };
  }
  
  // Priority 8: Greeting (short messages only)
  if (msgLower.length < 20) {
    for (const keyword of GREETING_KEYWORDS) {
      if (msgLower === keyword || msgLower.startsWith(keyword + ' ') || msgLower.endsWith(' ' + keyword)) {
        return { type: 'GREETING', confidence: 'HIGH' };
      }
    }
  }
  
  // Priority 9: Stock query
  if (msgLower.includes('estoque') || msgLower.includes('disponível') || 
      msgLower.includes('disponivel') || msgLower.includes('tem carro')) {
    return { type: 'STOCK_QUERY', confidence: 'MEDIUM' };
  }
  
  // Default: Conversation (let AI handle)
  return { type: 'CONVERSATION', confidence: 'LOW' };
}
