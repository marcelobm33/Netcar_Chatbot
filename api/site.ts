/**
 * API Site
 * =========
 * Informações do site: banners, contatos, endereços
 * 
 * Endpoint: GET /api/v1/site.php
 */

import { fetchAPI, ENDPOINTS } from './config';
import type { 
  SiteAction, 
  SiteFilters, 
  SiteResponse, 
  SiteInfo, 
  SiteBanner,
  SiteAbout,
  SiteCounter 
} from './types';

/**
 * Fetch genérico do site com action
 */
async function fetchSite(action: SiteAction, params: Partial<SiteFilters> = {}): Promise<SiteResponse> {
  return fetchAPI<SiteResponse>(ENDPOINTS.site, { action, ...params });
}

// =============================================================================
// INFORMAÇÕES GERAIS
// =============================================================================

/**
 * Retorna informações gerais do site
 * 
 * @example
 * const info = await getSiteInfo();
 * console.log(info.whatsapp); // "(51) 99999-9999"
 */
export async function getSiteInfo(): Promise<SiteInfo> {
  const result = await fetchSite('info');
  return result.data as SiteInfo;
}

// =============================================================================
// BANNERS
// =============================================================================

/**
 * Lista banners do site
 */
export async function getBanners(): Promise<SiteBanner[]> {
  const result = await fetchSite('banners');
  return result.data as SiteBanner[];
}

// =============================================================================
// TELEFONES
// =============================================================================

/**
 * Retorna telefone de uma loja específica
 * 
 * @example
 * const phone = await getPhone('Loja1');
 */
export async function getPhone(loja: string): Promise<string> {
  const result = await fetchSite('phone', { loja });
  const data = result.data as SiteInfo;
  return data[`phone_${loja.toLowerCase()}` as keyof SiteInfo] as string || '';
}

/**
 * Retorna todos os telefones
 */
export async function getAllPhones(): Promise<Record<string, string>> {
  const info = await getSiteInfo();
  return {
    loja1: info.phone_loja1 || '',
    loja2: info.phone_loja2 || '',
    whatsapp: info.whatsapp || '',
  };
}

/**
 * Retorna WhatsApp principal
 */
export async function getWhatsApp(): Promise<string> {
  const info = await getSiteInfo();
  return info.whatsapp || '';
}

// =============================================================================
// ENDEREÇOS
// =============================================================================

/**
 * Retorna todos os endereços
 */
export async function getAddresses(): Promise<Record<string, string>> {
  const info = await getSiteInfo();
  return {
    loja1: info.address_loja1 || '',
    loja2: info.address_loja2 || '',
  };
}

// =============================================================================
// HORÁRIOS
// =============================================================================

/**
 * Retorna horário de funcionamento
 */
export async function getSchedule(): Promise<string> {
  const info = await getSiteInfo();
  return info.schedule || '';
}

// =============================================================================
// SOBRE
// =============================================================================

/**
 * Retorna textos "Sobre" da empresa
 */
export async function getAbout(titulo?: string): Promise<SiteAbout | SiteAbout[]> {
  const result = await fetchSite('about', titulo ? { titulo } : {});
  return result.data as SiteAbout | SiteAbout[];
}

// =============================================================================
// CONTADORES
// =============================================================================

/**
 * Retorna contadores/estatísticas
 */
export async function getCounters(titulo?: string): Promise<SiteCounter[]> {
  const result = await fetchSite('counters', titulo ? { titulo } : {});
  return result.data as SiteCounter[];
}

// =============================================================================
// REDES SOCIAIS
// =============================================================================

/**
 * Retorna links de redes sociais
 */
export async function getSocialLinks(): Promise<Record<string, string>> {
  const info = await getSiteInfo();
  return {
    instagram: info.instagram || '',
    facebook: info.facebook || '',
    email: info.email || '',
  };
}
