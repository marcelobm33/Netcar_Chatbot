/**
 * Intent Detection - Configuração de Dados
 * ==========================================
 * Mapas de marcas, modelos, cores e categorias.
 * Separados da lógica para facilitar manutenção.
 */

// =============================================================================
// MARCAS
// =============================================================================

export const CAR_BRANDS: Record<string, string> = {
  ford: "FORD",
  chevrolet: "CHEVROLET",
  volkswagen: "VOLKSWAGEN",
  vw: "VOLKSWAGEN",
  fiat: "FIAT",
  toyota: "TOYOTA",
  honda: "HONDA",
  hyundai: "HYUNDAI",
  jeep: "JEEP",
  nissan: "NISSAN",
  renault: "RENAULT",
  peugeot: "PEUGEOT",
  citroen: "CITROEN",
  citroën: "CITROEN",
  mitsubishi: "MITSUBISHI",
  chery: "CHERY",
  caoa: "CAOA CHERY",
  bmw: "BMW",
  mercedes: "MERCEDES-BENZ",
  audi: "AUDI",
  kia: "KIA",
  "land rover": "LAND ROVER",
  landrover: "LAND ROVER",
  volvo: "VOLVO",
  subaru: "SUBARU",
  suzuki: "SUZUKI",
  jac: "JAC",
  ram: "RAM",
  byd: "BYD",
  gwm: "GWM",
  // Marcas que não temos (para dar resposta adequada)
  tesla: "TESLA",
  ferrari: "FERRARI",
  lamborghini: "LAMBORGHINI",
  porsche: "PORSCHE",
};

// =============================================================================
// MODELO → MARCA
// =============================================================================

export const MODEL_TO_BRAND: Record<string, string> = {
  // FORD
  ka: "FORD", fiesta: "FORD", focus: "FORD", ecosport: "FORD", ranger: "FORD",
  bronco: "FORD", territory: "FORD", maverick: "FORD", fusion: "FORD", edge: "FORD",
  kuga: "FORD",
  // CHEVROLET
  onix: "CHEVROLET", prisma: "CHEVROLET", cruze: "CHEVROLET", tracker: "CHEVROLET",
  spin: "CHEVROLET", s10: "CHEVROLET", equinox: "CHEVROLET", trailblazer: "CHEVROLET",
  montana: "CHEVROLET", cobalt: "CHEVROLET", joy: "CHEVROLET",
  // HYUNDAI
  hb20: "HYUNDAI", creta: "HYUNDAI", tucson: "HYUNDAI", "santa fe": "HYUNDAI",
  ix35: "HYUNDAI", azera: "HYUNDAI", i30: "HYUNDAI", elantra: "HYUNDAI",
  // TOYOTA
  corolla: "TOYOTA", yaris: "TOYOTA", hilux: "TOYOTA", etios: "TOYOTA",
  sw4: "TOYOTA", rav4: "TOYOTA", camry: "TOYOTA", prius: "TOYOTA",
  // VOLKSWAGEN
  polo: "VOLKSWAGEN", gol: "VOLKSWAGEN", virtus: "VOLKSWAGEN", "t-cross": "VOLKSWAGEN",
  tcross: "VOLKSWAGEN", nivus: "VOLKSWAGEN", taos: "VOLKSWAGEN", tiguan: "VOLKSWAGEN",
  jetta: "VOLKSWAGEN", amarok: "VOLKSWAGEN", fusca: "VOLKSWAGEN", golf: "VOLKSWAGEN",
  voyage: "VOLKSWAGEN", saveiro: "VOLKSWAGEN", up: "VOLKSWAGEN", fox: "VOLKSWAGEN",
  kombi: "VOLKSWAGEN", passat: "VOLKSWAGEN",
  // NISSAN
  kicks: "NISSAN", versa: "NISSAN", sentra: "NISSAN", frontier: "NISSAN",
  march: "NISSAN", livina: "NISSAN",
  // JEEP
  renegade: "JEEP", compass: "JEEP", commander: "JEEP", wrangler: "JEEP",
  cherokee: "JEEP",
  // FIAT
  toro: "FIAT", argo: "FIAT", cronos: "FIAT", strada: "FIAT", mobi: "FIAT",
  pulse: "FIAT", fastback: "FIAT", uno: "FIAT", palio: "FIAT", siena: "FIAT",
  // HONDA
  civic: "HONDA", city: "HONDA", fit: "HONDA", "hr-v": "HONDA", hrv: "HONDA",
  "cr-v": "HONDA", crv: "HONDA", "wr-v": "HONDA", wrv: "HONDA", accord: "HONDA",
  // RENAULT
  sandero: "RENAULT", logan: "RENAULT", duster: "RENAULT", captur: "RENAULT",
  kwid: "RENAULT", oroch: "RENAULT", clio: "RENAULT",
  // CITROEN
  c3: "CITROEN", c4: "CITROEN", aircross: "CITROEN",
  // PEUGEOT
  "208": "PEUGEOT", "2008": "PEUGEOT", "3008": "PEUGEOT", "308": "PEUGEOT",
  // MITSUBISHI
  lancer: "MITSUBISHI", outlander: "MITSUBISHI", pajero: "MITSUBISHI", 
  l200: "MITSUBISHI", asx: "MITSUBISHI",
  // CHERY
  tiggo: "CAOA CHERY", "tiggo 5": "CAOA CHERY", "tiggo 5x": "CAOA CHERY", 
  "tiggo 7": "CAOA CHERY", "tiggo 8": "CAOA CHERY", arrizo: "CAOA CHERY",
  tigo: "CAOA CHERY", tiago: "CAOA CHERY", // Typos comuns
  // KIA
  sportage: "KIA", cerato: "KIA", seltos: "KIA", sorento: "KIA", 
  carnival: "KIA", picanto: "KIA",
  // RAM
  rampage: "RAM", "1500": "RAM", "2500": "RAM",
  // BYD
  dolphin: "BYD", seal: "BYD", song: "BYD", yuan: "BYD",
  // GWM
  haval: "GWM", "haval h6": "GWM",
};

// =============================================================================
// CATEGORIAS
// =============================================================================

export const CATEGORY_MAP: Record<string, string> = {
  suv: "SUV",
  hatch: "HATCH",
  hatchback: "HATCH",
  sedan: "SEDAN",
  pickup: "PICKUP",
  picape: "PICKUP",
  caminhonete: "PICKUP",
  utilitario: "UTILITARIO",
  esportivo: "ESPORTIVO",
};

// =============================================================================
// CORES
// =============================================================================

export const COLOR_MAP: Record<string, string> = {
  branco: "BRANCA", branca: "BRANCA",
  preto: "PRETA", preta: "PRETA",
  prata: "PRATA",
  cinza: "CINZA",
  vermelho: "VERMELHA", vermelha: "VERMELHA",
  azul: "AZUL",
  verde: "VERDE",
  amarelo: "AMARELA", amarela: "AMARELA",
  bege: "BEGE",
  marrom: "MARROM",
  dourado: "DOURADA", dourada: "DOURADA",
  laranja: "LARANJA",
  vinho: "VINHO", bordô: "VINHO", bordo: "VINHO",
};

// =============================================================================
// TYPOS COMUNS
// =============================================================================

export const TYPO_CORRECTIONS: Record<string, string> = {
  'tigo': 'tiggo', 'tigo 5': 'tiggo 5', 'tigo 5x': 'tiggo 5x',
  'tiago': 'tiggo', 'tiago 5': 'tiggo 5',
  'onics': 'onix', 'onyx': 'onix',
  'hb 20': 'hb20', 'h20': 'hb20',
  't cross': 't-cross', 'tcross': 't-cross',
  'compasss': 'compass', 'compaas': 'compass',
  'renegate': 'renegade', 'renegad': 'renegade',
};

// =============================================================================
// TRADE-IN KEYWORDS (não deve buscar, é carro do cliente)
// =============================================================================

export const TRADE_IN_KEYWORDS = [
  "aceita", "aceitar", "aceitam", "pegam", "pega na", "pegar",
  "troca", "trocar", "trocam",
  "tenho um", "tenho uma", "tenho o", "tenho a",
  "meu carro", "minha moto", "meu", "minha",
  "avaliar", "avaliação", "quanto vale", "quanto paga", "quanto pagam",
  "compram", "compraria", "comprar meu", "comprar minha",
  "na troca", "como entrada", "da entrada", "de entrada",
  "vender", "vendo", "quero vender",
  "pra negocio", "pra negociar", "para negociar",
];
