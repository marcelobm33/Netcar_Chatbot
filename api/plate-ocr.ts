/**
 * API de Consulta de Placas - Módulo preparado para integração
 * 
 * IMPORTANTE: Requer PLATE_API_TOKEN configurado no ambiente
 * APIs compatíveis: APIBrasil, PlacaAPI, ConsultarPlaca
 */

export interface PlateData {
  placa: string;
  marca: string;
  modelo: string;
  ano: number;
  anoModelo: number;
  cor: string;
  combustivel: string;
  uf: string;
  municipio?: string;
  chassi?: string;
  renavam?: string;
}

// API Endpoints (configurar conforme provedor escolhido)
const API_PROVIDERS = {
  // APIBrasil - https://apibrasil.io
  apibrasil: {
    url: 'https://gateway.apibrasil.io/api/v2/veiculos/dados',
    headers: (token: string) => ({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    transform: (data: Record<string, unknown>): PlateData | null => {
      if (!data || data.error) return null;
      const d = data as Record<string, string | number>;
      return {
        placa: String(d.placa || ''),
        marca: String(d.marca || ''),
        modelo: String(d.modelo || ''),
        ano: Number(d.ano) || 0,
        anoModelo: Number(d.anoModelo || d.ano) || 0,
        cor: String(d.cor || ''),
        combustivel: String(d.combustivel || ''),
        uf: String(d.uf || ''),
        municipio: String(d.municipio || ''),
      };
    },
  },
  // PlacaAPI.com
  placaapi: {
    url: 'https://placaapi.com/api/v1/consulta',
    headers: (token: string) => ({
      'Authorization': token,
      'Content-Type': 'application/json',
    }),
    transform: (data: Record<string, unknown>): PlateData | null => {
      if (!data) return null;
      const d = data as Record<string, string | number>;
      return {
        placa: String(d.placa || ''),
        marca: String(d.marca || d.fabricante || ''),
        modelo: String(d.modelo || ''),
        ano: Number(d.anoFabricacao || d.ano) || 0,
        anoModelo: Number(d.anoModelo || d.ano) || 0,
        cor: String(d.cor || ''),
        combustivel: String(d.combustivel || ''),
        uf: String(d.uf || d.estado || ''),
      };
    },
  },
};

/**
 * Normaliza placa para formato padrão (sem hífen)
 * Aceita: ABC1234, ABC-1234, ABC1D23
 */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Valida formato de placa brasileira (antiga e Mercosul)
 */
export function isValidPlate(plate: string): boolean {
  const normalized = normalizePlate(plate);
  // Antiga: AAA1234
  const oldPattern = /^[A-Z]{3}[0-9]{4}$/;
  // Mercosul: AAA1A23
  const mercosulPattern = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  
  return oldPattern.test(normalized) || mercosulPattern.test(normalized);
}

/**
 * Consulta dados do veículo pela placa
 * 
 * @param plate - Placa do veículo
 * @param token - Token da API (de PLATE_API_TOKEN)
 * @param provider - Provedor da API ('apibrasil' | 'placaapi')
 */
export async function consultaPlaca(
  plate: string,
  token: string,
  provider: 'apibrasil' | 'placaapi' = 'apibrasil'
): Promise<PlateData | null> {
  if (!token) {
    console.warn('[PLATE-OCR] Token não configurado. Configure PLATE_API_TOKEN.');
    return null;
  }

  const normalized = normalizePlate(plate);
  if (!isValidPlate(normalized)) {
    console.warn(`[PLATE-OCR] Placa inválida: ${plate}`);
    return null;
  }

  const config = API_PROVIDERS[provider];
  if (!config) {
    console.error(`[PLATE-OCR] Provedor desconhecido: ${provider}`);
    return null;
  }

  try {
    console.log(`[PLATE-OCR] Consultando placa ${normalized} via ${provider}...`);
    
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers(token),
      body: JSON.stringify({ placa: normalized }),
    });

    if (!response.ok) {
      console.error(`[PLATE-OCR] Erro na API: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const result = config.transform(data);
    
    if (result) {
      console.log(`[PLATE-OCR] Encontrado: ${result.marca} ${result.modelo} ${result.ano}`);
    }
    
    return result;
  } catch (error) {
    console.error('[PLATE-OCR] Erro na consulta:', error);
    return null;
  }
}

/**
 * Extrai placa de texto usando regex (para uso com OCR)
 * Retorna a primeira placa encontrada ou null
 */
export function extractPlateFromText(text: string): string | null {
  // Padrão antigo: AAA-1234 ou AAA1234
  const oldPattern = /[A-Z]{3}[-\s]?[0-9]{4}/gi;
  // Padrão Mercosul: AAA1A23
  const mercosulPattern = /[A-Z]{3}[0-9][A-Z][0-9]{2}/gi;
  
  const text_upper = text.toUpperCase();
  
  // Tenta Mercosul primeiro (mais recente)
  const mercosulMatch = text_upper.match(mercosulPattern);
  if (mercosulMatch) {
    return normalizePlate(mercosulMatch[0]);
  }
  
  // Tenta padrão antigo
  const oldMatch = text_upper.match(oldPattern);
  if (oldMatch) {
    return normalizePlate(oldMatch[0]);
  }
  
  return null;
}
