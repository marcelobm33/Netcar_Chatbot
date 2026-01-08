/**
 * GraphRAG Service - Knowledge Graph for Car Inventory
 * 
 * Builds an in-memory knowledge graph from car inventory to enable
 * relationship-based queries like:
 * - "Qual SUV mais barato que o Tracker?"
 * - "Mostre carros similares ao Polo"
 * - "Tem carro concorrente do HRV?"
 * 
 * Uses in-memory graph because:
 * 1. Cloudflare Workers can't maintain persistent DB connections
 * 2. Inventory is small (~100-500 cars)
 * 3. Graph can be cached in KV for reuse
 */

import type { Env, CarData } from '@types';

// =============================================================================
// TYPES
// =============================================================================

interface CarNode {
  id: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  category: string;
  km: number;
  color?: string;
}

interface CarGraph {
  nodes: Map<string, CarNode>;
  brandIndex: Map<string, Set<string>>;      // brand -> car IDs
  categoryIndex: Map<string, Set<string>>;   // category -> car IDs
  priceIndex: CarNode[];                     // sorted by price ascending
  updatedAt: string;
}

// Brand competition mapping (which brands compete with which)
const BRAND_COMPETITORS: Record<string, string[]> = {
  'volkswagen': ['chevrolet', 'fiat', 'hyundai', 'toyota'],
  'chevrolet': ['volkswagen', 'fiat', 'hyundai', 'ford'],
  'fiat': ['volkswagen', 'chevrolet', 'renault', 'hyundai'],
  'hyundai': ['volkswagen', 'chevrolet', 'toyota', 'honda'],
  'toyota': ['honda', 'hyundai', 'nissan', 'volkswagen'],
  'honda': ['toyota', 'hyundai', 'nissan', 'volkswagen'],
  'jeep': ['chevrolet', 'hyundai', 'volkswagen', 'ford'],
  'renault': ['fiat', 'volkswagen', 'peugeot', 'citroen'],
  'nissan': ['toyota', 'honda', 'hyundai', 'mitsubishi'],
  'ford': ['chevrolet', 'volkswagen', 'fiat', 'toyota'],
  'caoa chery': ['jac', 'byd', 'gwm', 'hyundai'],
  'byd': ['caoa chery', 'gwm', 'jac', 'hyundai'],
};

// Category similarity (which categories are similar)
const CATEGORY_SIMILAR: Record<string, string[]> = {
  'suv': ['crossover', 'suv compacto'],
  'sedan': ['sedan compacto', 'sedan médio'],
  'hatch': ['hatch compacto', 'compacto'],
  'pickup': ['picape', 'utilitário'],
};

// Price range tolerance for "similar" (20%)
const SIMILAR_PRICE_TOLERANCE = 0.2;

// =============================================================================
// GRAPH CONSTRUCTION
// =============================================================================

/**
 * Build in-memory knowledge graph from car inventory
 */
export function buildCarGraph(cars: CarData[]): CarGraph {
  const nodes = new Map<string, CarNode>();
  const brandIndex = new Map<string, Set<string>>();
  const categoryIndex = new Map<string, Set<string>>();
  const priceIndex: CarNode[] = [];

  for (const car of cars) {
    const id = String(car.id);
    const brand = normalizeBrand(car.marca);
    const category = normalizeCategory(detectCategory(car.modelo));
    
    const node: CarNode = {
      id,
      brand,
      model: car.modelo?.toLowerCase() || '',
      year: Number(car.ano) || 2020,
      price: Number(car.preco) || 0,
      category,
      km: Number(car.km) || 0,
      color: car.cor?.toLowerCase(),
    };

    nodes.set(id, node);
    priceIndex.push(node);

    // Index by brand
    if (!brandIndex.has(brand)) {
      brandIndex.set(brand, new Set());
    }
    brandIndex.get(brand)!.add(id);

    // Index by category
    if (!categoryIndex.has(category)) {
      categoryIndex.set(category, new Set());
    }
    categoryIndex.get(category)!.add(id);
  }

  // Sort price index
  priceIndex.sort((a, b) => a.price - b.price);

  return {
    nodes,
    brandIndex,
    categoryIndex,
    priceIndex,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalize brand name
 */
function normalizeBrand(brand: string | undefined): string {
  if (!brand) return 'desconhecido';
  return brand.toLowerCase().trim()
    .replace('caoa-chery', 'caoa chery')
    .replace('caoa', 'caoa chery');
}

/**
 * Normalize category name
 */
function normalizeCategory(category: string | undefined): string {
  if (!category) return 'outros';
  const lower = category.toLowerCase().trim();
  if (lower.includes('suv')) return 'suv';
  if (lower.includes('sedan')) return 'sedan';
  if (lower.includes('hatch')) return 'hatch';
  if (lower.includes('pickup') || lower.includes('picape')) return 'pickup';
  return lower;
}

/**
 * Detect category from model name (fallback)
 */
function detectCategory(model: string | undefined): string {
  if (!model) return 'outros';
  const lower = model.toLowerCase();
  
  // Known SUVs
  if (/tracker|creta|hrv|compass|renegade|t-cross|tcross|tiggo|kicks|duster|ecosport|captur/i.test(lower)) {
    return 'suv';
  }
  
  // Known Sedans
  if (/corolla|civic|cruze|onix|virtus|voyage|sentra|jetta|fusion|accord/i.test(lower)) {
    return 'sedan';
  }
  
  // Known Hatches
  if (/gol|polo|golf|onix|hb20|up|kwid|sandero|argo|mobi|ka/i.test(lower)) {
    return 'hatch';
  }
  
  // Known Pickups
  if (/hilux|ranger|s10|saveiro|strada|toro|amarok|frontier|triton/i.test(lower)) {
    return 'pickup';
  }
  
  return 'outros';
}

// =============================================================================
// GRAPH QUERIES
// =============================================================================

/**
 * Find cars cheaper than a reference car/price
 */
export function queryCheaperThan(
  graph: CarGraph,
  reference: { model?: string; price?: number },
  options: { category?: string; limit?: number } = {}
): CarNode[] {
  const limit = options.limit || 5;
  let maxPrice: number;

  if (reference.price) {
    maxPrice = reference.price;
  } else if (reference.model) {
    // Find reference car by model
    const refCar = findCarByModel(graph, reference.model);
    if (!refCar) return [];
    maxPrice = refCar.price;
  } else {
    return [];
  }

  let results = graph.priceIndex.filter(car => car.price < maxPrice && car.price > 0);
  
  // Filter by category if specified
  if (options.category) {
    results = results.filter(car => car.category === normalizeCategory(options.category));
  }

  // Return most expensive ones below the reference (closest alternatives)
  return results.slice(-limit).reverse();
}

/**
 * Find cars more expensive than a reference
 */
export function queryMoreExpensiveThan(
  graph: CarGraph,
  reference: { model?: string; price?: number },
  options: { category?: string; limit?: number } = {}
): CarNode[] {
  const limit = options.limit || 5;
  let minPrice: number;

  if (reference.price) {
    minPrice = reference.price;
  } else if (reference.model) {
    const refCar = findCarByModel(graph, reference.model);
    if (!refCar) return [];
    minPrice = refCar.price;
  } else {
    return [];
  }

  let results = graph.priceIndex.filter(car => car.price > minPrice);
  
  if (options.category) {
    results = results.filter(car => car.category === normalizeCategory(options.category));
  }

  // Return cheapest ones above the reference
  return results.slice(0, limit);
}

/**
 * Find similar cars (same category, similar price)
 */
export function querySimilarTo(
  graph: CarGraph,
  reference: { model?: string; carId?: string },
  options: { limit?: number } = {}
): CarNode[] {
  const limit = options.limit || 5;
  
  let refCar: CarNode | undefined;
  
  if (reference.carId) {
    refCar = graph.nodes.get(reference.carId);
  } else if (reference.model) {
    refCar = findCarByModel(graph, reference.model);
  }
  
  if (!refCar) return [];

  const minPrice = refCar.price * (1 - SIMILAR_PRICE_TOLERANCE);
  const maxPrice = refCar.price * (1 + SIMILAR_PRICE_TOLERANCE);
  
  // Find cars in similar categories
  const similarCategories = [refCar.category, ...(CATEGORY_SIMILAR[refCar.category] || [])];
  
  const results: CarNode[] = [];
  
  for (const cat of similarCategories) {
    const carIds = graph.categoryIndex.get(cat);
    if (!carIds) continue;
    
    for (const id of carIds) {
      if (id === refCar.id) continue; // Exclude self
      
      const car = graph.nodes.get(id);
      if (!car) continue;
      
      // Price similarity check
      if (car.price >= minPrice && car.price <= maxPrice) {
        results.push(car);
      }
    }
  }

  // Sort by price proximity to reference
  results.sort((a, b) => 
    Math.abs(a.price - refCar!.price) - Math.abs(b.price - refCar!.price)
  );

  return results.slice(0, limit);
}

/**
 * Find cars from competitor brands
 */
export function queryCompetitorBrands(
  graph: CarGraph,
  brand: string,
  options: { category?: string; limit?: number } = {}
): CarNode[] {
  const limit = options.limit || 10;
  const normalizedBrand = normalizeBrand(brand);
  
  const competitors = BRAND_COMPETITORS[normalizedBrand] || [];
  if (competitors.length === 0) return [];

  const results: CarNode[] = [];
  
  for (const competitor of competitors) {
    const carIds = graph.brandIndex.get(competitor);
    if (!carIds) continue;
    
    for (const id of carIds) {
      const car = graph.nodes.get(id);
      if (!car) continue;
      
      if (options.category && car.category !== normalizeCategory(options.category)) {
        continue;
      }
      
      results.push(car);
    }
  }

  // Sort by price
  results.sort((a, b) => a.price - b.price);

  return results.slice(0, limit);
}

/**
 * Get cars by category
 */
export function queryByCategory(
  graph: CarGraph,
  category: string,
  options: { limit?: number; maxPrice?: number; minYear?: number } = {}
): CarNode[] {
  const limit = options.limit || 10;
  const normalizedCategory = normalizeCategory(category);
  
  const carIds = graph.categoryIndex.get(normalizedCategory);
  if (!carIds) return [];

  let results: CarNode[] = [];
  
  for (const id of carIds) {
    const car = graph.nodes.get(id);
    if (!car) continue;
    
    if (options.maxPrice && car.price > options.maxPrice) continue;
    if (options.minYear && car.year < options.minYear) continue;
    
    results.push(car);
  }

  // Sort by price
  results.sort((a, b) => a.price - b.price);

  return results.slice(0, limit);
}

/**
 * Get cars by brand
 */
export function queryByBrand(
  graph: CarGraph,
  brand: string,
  options: { limit?: number } = {}
): CarNode[] {
  const limit = options.limit || 10;
  const normalizedBrand = normalizeBrand(brand);
  
  const carIds = graph.brandIndex.get(normalizedBrand);
  if (!carIds) return [];

  const results: CarNode[] = [];
  
  for (const id of carIds) {
    const car = graph.nodes.get(id);
    if (car) results.push(car);
  }

  results.sort((a, b) => a.price - b.price);

  return results.slice(0, limit);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find a car by model name (fuzzy match)
 */
function findCarByModel(graph: CarGraph, modelQuery: string): CarNode | undefined {
  const query = modelQuery.toLowerCase().trim();
  
  // Exact match first
  for (const car of graph.nodes.values()) {
    if (car.model === query) return car;
  }
  
  // Partial match
  for (const car of graph.nodes.values()) {
    if (car.model.includes(query) || query.includes(car.model)) {
      return car;
    }
  }
  
  return undefined;
}

/**
 * Format car node for display
 */
export function formatCarNode(node: CarNode): string {
  const price = node.price > 0 
    ? `R$ ${node.price.toLocaleString('pt-BR')}` 
    : 'Consulte';
  const km = node.km > 0 
    ? `${node.km.toLocaleString('pt-BR')} km` 
    : 'N/A';
  
  return `🚗 ${node.brand.toUpperCase()} ${node.model.toUpperCase()} ${node.year}
💰 ${price}
📍 ${km}`;
}

/**
 * Get graph statistics
 */
export function getGraphStats(graph: CarGraph): {
  totalCars: number;
  brands: string[];
  categories: string[];
  priceRange: { min: number; max: number };
} {
  const prices = graph.priceIndex.filter(c => c.price > 0).map(c => c.price);
  
  return {
    totalCars: graph.nodes.size,
    brands: Array.from(graph.brandIndex.keys()),
    categories: Array.from(graph.categoryIndex.keys()),
    priceRange: {
      min: Math.min(...prices),
      max: Math.max(...prices),
    },
  };
}

// =============================================================================
// CACHE INTEGRATION
// =============================================================================

const GRAPH_CACHE_KEY = 'car-graph:v1';
const GRAPH_CACHE_TTL = 300; // 5 minutes

/**
 * Get or build car graph (with KV caching)
 */
export async function getOrBuildGraph(
  cars: CarData[],
  env: Env
): Promise<CarGraph> {
  // Try to get from cache
  if (env.NETCAR_CACHE) {
    try {
      const cached = await env.NETCAR_CACHE.get(GRAPH_CACHE_KEY, 'json') as CarGraph | null;
      if (cached && cached.nodes) {
        // Reconstruct Maps from cached data
        cached.nodes = new Map(Object.entries(cached.nodes as unknown as Record<string, CarNode>));
        cached.brandIndex = new Map(
          Object.entries(cached.brandIndex as unknown as Record<string, string[]>)
            .map(([k, v]) => [k, new Set(v)])
        );
        cached.categoryIndex = new Map(
          Object.entries(cached.categoryIndex as unknown as Record<string, string[]>)
            .map(([k, v]) => [k, new Set(v)])
        );
        
        console.log(`[GraphRAG] Using cached graph (${cached.nodes.size} cars)`);
        return cached;
      }
    } catch (e) {
      console.warn('[GraphRAG] Cache read error:', e);
    }
  }

  // Build new graph
  const graph = buildCarGraph(cars);
  console.log(`[GraphRAG] Built new graph (${graph.nodes.size} cars)`);

  // Save to cache
  if (env.NETCAR_CACHE) {
    try {
      // Convert Maps to objects for JSON serialization
      const cacheable = {
        nodes: Object.fromEntries(graph.nodes),
        brandIndex: Object.fromEntries(
          Array.from(graph.brandIndex.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        categoryIndex: Object.fromEntries(
          Array.from(graph.categoryIndex.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        priceIndex: graph.priceIndex,
        updatedAt: graph.updatedAt,
      };
      
      await env.NETCAR_CACHE.put(GRAPH_CACHE_KEY, JSON.stringify(cacheable), {
        expirationTtl: GRAPH_CACHE_TTL,
      });
    } catch (e) {
      console.warn('[GraphRAG] Cache write error:', e);
    }
  }

  return graph;
}
