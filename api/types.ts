/**
 * API Geral - Tipos
 * ==================
 * Tipagem completa da API NetCar (netcarmultimarcas.com.br/api/v1)
 * 
 * Referência: https://www.netcarmultimarcas.com.br/api/v1/docs/api-documentation.html
 */

// =============================================================================
// RESPOSTA PADRÃO
// =============================================================================

export interface APIResponse<T> {
  success: boolean;
  message: string;
  data: T;
  total_results?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  timestamp?: string;
}

// =============================================================================
// API VEÍCULOS (COMPLETA)
// =============================================================================

export interface VeiculoOpcional {
  tag: string;
  descricao: string;
}

export interface VeiculoImagens {
  thumb: string[];
  full: string[];
}

export interface Veiculo {
  id: string;
  marca: string;
  modelo: string;
  ano: number;
  
  // Preços
  valor: number;
  valor_formatado: string;
  preco_com_troca?: number;
  preco_com_troca_formatado?: string;
  tem_desconto?: number;
  valor_sem_desconto?: number | null;
  
  // Especificações
  cor: string;
  motor: string;
  combustivel: string;
  cambio: string;
  potencia?: string;
  km?: number;
  portas?: number;
  lugares?: number;
  
  // Documentação
  placa?: string;
  chassi?: string | null;
  renavam?: string | null;
  
  // Equipamentos básicos
  direcao?: string | null;
  ar_condicionado?: string | null;
  vidros_eletricos?: string | null;
  travas_eletricas?: string | null;
  airbag?: string | null;
  abs?: string | null;
  alarme?: string | null;
  som?: string | null;
  rodas?: string | null;
  pneus?: string | null;
  freios?: string | null;
  suspensao?: string | null;
  
  // Status do veículo
  motor_status?: string | null;
  cambio_status?: string | null;
  pintura_status?: string | null;
  lataria_status?: string | null;
  interior_status?: string | null;
  pneus_status?: string | null;
  documentacao?: string | null;
  
  // Observações
  observacoes?: string | null;
  
  // Links e mídia
  link?: string;
  have_galery?: number;
  imagens?: VeiculoImagens;
  
  // Opcionais completos
  opcionais?: VeiculoOpcional[];
  
  // Datas e status
  data_cadastro?: string | null;
  data_atualizacao?: string | null;
  status?: string | null;
  destaque?: number;
  promocao?: number;
}

export interface VeiculoFilters {
  montadora?: string;
  modelo?: string;
  ano_min?: number;
  ano_max?: number;
  valor_min?: number;
  valor_max?: number;
  cor?: string;
  combustivel?: string;
  cambio?: string;
  motor?: string;
  km_max?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

export interface VeiculoResponse extends APIResponse<Veiculo[]> {
  filters_applied?: VeiculoFilters;
}

// =============================================================================
// API STOCK
// =============================================================================

export type StockAction = 
  | 'enterprises'      // Lista marcas
  | 'cars_by_brand'    // Modelos por marca
  | 'years'            // Anos disponíveis
  | 'prices'           // Faixas de preço
  | 'colors'           // Cores disponíveis
  | 'engines'          // Motores disponíveis
  | 'fuels'            // Combustíveis
  | 'transmissions'    // Câmbios
  | 'optionals';       // Opcionais disponíveis

export interface StockFilters {
  action: StockAction;
  brand?: string;
  [key: string]: string | undefined;
}

export interface StockResponse extends APIResponse<string[] | StockItem[]> {
  action: StockAction;
}

export interface StockItem {
  value: string;
  label: string;
  count?: number;
}

// =============================================================================
// API DEPOIMENTOS
// =============================================================================

export interface Depoimento {
  id: number;
  nome: string;
  titulo: string;
  depoimento: string;
  data: string;
  imagem: string;
  imagem_link: string;
  avaliacao?: number;
}

export type DepoimentoAction = 'list' | 'single' | 'gallery';

export interface DepoimentoFilters {
  action: DepoimentoAction;
  id?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

export interface DepoimentoResponse extends APIResponse<Depoimento | Depoimento[]> {
  action: DepoimentoAction;
}

// =============================================================================
// API SITE
// =============================================================================

export interface SiteInfo {
  banners?: SiteBanner[];
  phone_loja1?: string;
  phone_loja2?: string;
  address_loja1?: string;
  address_loja2?: string;
  whatsapp?: string;
  schedule?: string;
  email?: string;
  instagram?: string;
  facebook?: string;
}

export interface SiteBanner {
  id: number;
  titulo: string;
  subtitulo?: string;
  imagem: string;
  link?: string;
  ordem: number;
}

export interface SiteAbout {
  titulo: string;
  texto: string;
  imagem?: string;
}

export interface SiteCounter {
  titulo: string;
  valor: number;
  icone?: string;
}

export type SiteAction = 
  | 'info'      // Informações gerais
  | 'banners'   // Banners do site
  | 'phone'     // Telefone por loja
  | 'about'     // Textos sobre a empresa
  | 'counters'; // Contadores/estatísticas

export interface SiteFilters {
  action: SiteAction;
  loja?: string;
  titulo?: string;
  local?: string;
  [key: string]: string | undefined;
}

export interface SiteResponse extends APIResponse<SiteInfo | SiteBanner[] | SiteAbout | SiteCounter[]> {
  action: SiteAction;
}

// =============================================================================
// LISTA DE OPCIONAIS CONHECIDOS (para busca)
// Referência: opcionais retornados pela API
// =============================================================================

export const OPCIONAIS_CONHECIDOS = [
  'air_bag',
  'air_bag_duplo',
  'alarme',
  'ar_condicionado',
  'ar_condicionado_digital',
  'ar_condicionado_dual_zone',
  'ar_quente',
  'bancos_com_regulagem_de_altura',
  'bancos_de_couro',
  'botao', // Botão de Partida
  'camera_de_re',
  'chave_reserva',
  'cinto_tres', // Cinto 3 pontos
  'computador_de_bordo',
  'controle_de_tracao',
  'desembacador_traseiro',
  'direcao_eletrica',
  'direcao_hidraulica',
  'farol_negro',
  'farolete',
  'freio_disco',
  'freios_abs',
  'freios_abs_com_ebd',
  'isofix',
  'lanternas_em_led',
  'limpador_traseiro',
  'manual', // Manual do Proprietário
  'monitor_pressao',
  'multimidia', // Central Multimídia
  'piloto_automatico',
  'porta_malas_eletrico',
  'reg_altura', // Regulagem Altura Faróis
  'retrovisor_eletrico',
  'rodas_de_liga_leve',
  'sensor_de_chuva',
  'sensor_de_estacionamento',
  'sensor_de_luminosidade',
  'som_no_volante', // Comandos no Volante
  'som_radio', // Bluetooth
  'som_radio_cd',
  'som_radio_com_usb',
  'teto_panoramico',
  'teto_solar',
  'travas_eletricas',
  'vidros_eletricos',
  'vidros_verdes', // Retrovisor com Pisca
  'volante_regulagem_de_altura',
] as const;

export type OpcionalTag = typeof OPCIONAIS_CONHECIDOS[number];
