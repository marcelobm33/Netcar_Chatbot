
export interface CarPhoto {
  url: string;
}

export interface Car {
  id: number;
  modelo: string;
  marca: string;
  ano: number;
  ano_modelo: number;
  cor: string;
  km: number;
  combustivel: string;
  cambio: string;
  preco: number;
  fotos: CarPhoto[];
}

const API_URL = 'https://netcar-worker.contato-11e.workers.dev';

/**
 * Fetch all cars from the external API
 * Note: Since this is a client-side fetch in Admin Panel, we might hit CORS.
 * Ideally, this should be proxied via the Worker or Next.js API route.
 * For now, we'll try direct fetch, if fails, we'll make a Next.js Proxy.
 */
export async function fetchCars(): Promise<Car[]> {
  try {
    const response = await fetch(`${API_URL}/api/estoque`);
    if (!response.ok) {
        throw new Error('Failed to fetch cars');
    }
    const json = await response.json();
    
    // Worker response format: { success: true, total: N, data: [...] }
    let rawData: any[] = [];
    
    if (json && json.data && Array.isArray(json.data)) {
        rawData = json.data;
    } else if (Array.isArray(json)) {
        rawData = json;
    } else {
        console.warn('Unexpected API response format:', json);
        return [];
    }
    
    // Transform API data to match Car interface
    return rawData.map((item: any) => {
        // Parse price from string "R$ 29.900,00" to number 29900
        let preco = 0;
        if (typeof item.preco === 'number') {
            preco = item.preco;
        } else if (typeof item.preco === 'string') {
            preco = parseFloat(item.preco.replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
        }
        
        // Convert imageUrl to fotos array
        const fotos: CarPhoto[] = item.imageUrl 
            ? [{ url: item.imageUrl }] 
            : (item.fotos || []);
        
        return {
            id: parseInt(String(item.id), 10) || 0,
            modelo: item.modelo || 'N/A',
            marca: item.marca || 'N/A',
            ano: item.ano || 0,
            ano_modelo: item.ano_modelo || item.ano || 0,
            cor: item.cor || 'N/A',
            km: item.km || 0,
            combustivel: item.combustivel || 'N/A',
            cambio: item.cambio || 'N/A',
            preco,
            fotos
        } as Car;
    });
  } catch (error) {
    console.error('Error fetching cars:', error);
    return [];
  }
}
