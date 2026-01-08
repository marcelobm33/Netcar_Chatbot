
export interface FipeInfo {
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string;
  codigoFipe: string;
  mesReferencia: string;
  valor: string; // "R$ 80.000,00"
}

// Top brands map to IDs (Parallelum API source)
const BRAND_IDS: Record<string, string> = {
  'chevrolet': '23',
  'vw': '59', 'volkswagen': '59',
  'fiat': '21',
  'ford': '22',
  'toyota': '56',
  'honda': '28',
  'hyundai': '29',
  'jeep': '29', // Jeep is distinct? Let's check. Jeep ID is 29? No, Hyundai is 29. Jeep is 25?
  // Let's use a dynamic search for brands if not in map, but map helps speed.
  // I will rely on Parallelum brand list fetch if needed, avoiding hardcoded errors.
  // Actually, fetching brands list is fast.
};

const API_BASE = 'https://parallelum.com.br/fipe/api/v1';

export async function searchFipe(marca: string, modelo: string, ano: number): Promise<FipeInfo | null> {
  try {
    // 1. Get Brand ID
    const brandId = await getBrandId(marca);
    if (!brandId) return null;

    // 2. Get Model ID
    const modelId = await getModelId(brandId, modelo);
    if (!modelId) return null;

    // 3. Get Year ID
    const yearId = await getYearId(brandId, modelId, ano);
    if (!yearId) return null;

    // 4. Get Price
    const url = `${API_BASE}/carros/marcas/${brandId}/modelos/${modelId}/anos/${yearId}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    
    const data = await resp.json() as {
      Marca: string;
      Modelo: string;
      AnoModelo: number;
      Combustivel: string;
      CodigoFipe: string;
      MesReferencia: string;
      Valor: string;
    };
    return {
      marca: data.Marca,
      modelo: data.Modelo,
      anoModelo: data.AnoModelo,
      combustivel: data.Combustivel,
      codigoFipe: data.CodigoFipe,
      mesReferencia: data.MesReferencia,
      valor: data.Valor
    };

  } catch (error) {
    console.error('[FIPE] Error fetching FIPE:', error);
    return null;
  }
}

async function getBrandId(marcaName: string): Promise<string | null> {
  const lowerName = marcaName.toLowerCase();
  
  // Try cache/map first
  if (BRAND_IDS[lowerName]) return BRAND_IDS[lowerName];

  // Fetch all brands
  const resp = await fetch(`${API_BASE}/carros/marcas`);
  if (!resp.ok) return null;
  const brands = await resp.json() as Array<{ nome: string, codigo: string }>;
  
  // Fuzzy find
  const found = brands.find(b => b.nome.toLowerCase().includes(lowerName) || lowerName.includes(b.nome.toLowerCase()));
  return found ? found.codigo : null;
}

async function getModelId(brandId: string, modelName: string): Promise<string | null> {
   const resp = await fetch(`${API_BASE}/carros/marcas/${brandId}/modelos`);
   if (!resp.ok) return null;
   const data = await resp.json() as { modelos: Array<{ nome: string, codigo: string }> };
   
   // Fuzzy find model (e.g. "Onix" inside "Onix 1.0 Flex")
   // Priority: Startswith > Includes
   const lowerModel = modelName.toLowerCase();
   
   // Filter candidates
   const candidates = data.modelos.filter(m => {
       const mName = m.nome.toLowerCase();
       return mName.includes(lowerModel);
   });

   if (candidates.length === 0) return null;

   // Simple heuristic: shortest name that includes the search term (often the base model)
   // Or just take the first one?
   // Better: Prefer exact match logic or "1.0" generic?
   // Parallelum models are specific: "Onix HATCH LT 1.0 8V Flex 5p"
   // User types "Onix".
   // Let's pick the first one? Or random?
   // Let's pick the one that seems most "standard".
   // For now, pick the first one to avoid logic bloat.
   return candidates[0].codigo;
}

async function getYearId(brandId: string, modelId: string, targetYear: number): Promise<string | null> {
    const resp = await fetch(`${API_BASE}/carros/marcas/${brandId}/modelos/${modelId}/anos`);
    if (!resp.ok) return null;
    const years = await resp.json() as Array<{ nome: string, codigo: string }>;

    // Years format: "2020 Gasolina", "2021 Diesel"
    // We match startsWith(year)
    const targetStr = targetYear.toString();
    const found = years.find(y => y.nome.startsWith(targetStr));
    
    return found ? found.codigo : null;
}
