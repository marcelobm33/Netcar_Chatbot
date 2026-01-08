/**
 * Vision Service - Vehicle Image Analysis
 * ========================================
 * Analisa imagens de veículos usando GPT-4o-mini Vision
 * para identificar marca, modelo, ano, cor e condição.
 * 
 * Custo estimado: ~$0.003/imagem
 */

import type { Env } from '@types';
import { VISION_PROMPT } from '../config/unified-prompt';

// =============================================================================
// TYPES
// =============================================================================

export interface VehicleAnalysis {
  /** Marca identificada (ex: "Chevrolet") */
  marca: string;
  /** Modelo identificado (ex: "Onix") */
  modelo: string;
  /** Faixa de ano estimada (ex: "2019-2021") */
  anoEstimado: string;
  /** Cor do veículo (ex: "Prata") */
  cor: string;
  /** Condição aparente (ex: "Bom estado", "Excelente", "Desgastado") */
  condicao: string;
  /** Tipo de veículo */
  tipo: 'sedan' | 'hatch' | 'suv' | 'pickup' | 'van' | 'moto' | 'outro';
  /** Descrição humanizada para resposta ao cliente */
  descricao: string;
  /** Nível de confiança da análise (0-100) */
  confianca: number;
  /** Se é uma imagem de veículo ou não */
  isVehicle: boolean;
  /** Se é um screenshot de anúncio (site, app) ou foto real do carro */
  isAdScreenshot: boolean;
  /** Preço se visível no anúncio (ex: "R$ 162.900,00") */
  preco?: string;
  /** Quilometragem se visível (ex: "38.000 km") */
  km?: string;
  /** Erro se houver */
  error?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const VISION_TIMEOUT_MS = 15000; // 15 segundos
const MIN_CONFIDENCE = 60; // Mínimo para considerar análise válida

// Renomear import para compatibilidade
const VEHICLE_ANALYSIS_PROMPT = VISION_PROMPT;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Analisa uma imagem de veículo usando GPT-4o-mini Vision
 * 
 * @param imageBase64 - Imagem em base64 (sem prefixo data:...)
 * @param env - Environment com OPENAI_API_KEY
 * @returns Análise do veículo ou erro
 */
export async function analyzeVehicleImage(
  imageBase64: string,
  env: Env
): Promise<VehicleAnalysis> {
  const startTime = Date.now();
  
  try {
    // Validar que temos a imagem
    if (!imageBase64 || imageBase64.length < 100) {
      return createErrorResponse('Imagem inválida ou muito pequena');
    }

    // Validar API key
    if (!env.OPENAI_API_KEY) {
      console.error('[VISION] OPENAI_API_KEY não configurada');
      return createErrorResponse('Chave de API não configurada');
    }

    // Preparar data URI se necessário
    let imageData = imageBase64;
    if (!imageBase64.startsWith('data:')) {
      imageData = `data:image/jpeg;base64,${imageBase64}`;
    }

    // Chamar GPT-4o Vision (melhor qualidade para análise de imagens)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o', // GPT-4o para Vision (melhor qualidade de análise)
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: VEHICLE_ANALYSIS_PROMPT,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageData,
                    detail: 'low', // Usar 'low' para economizar tokens
                  },
                },
              ],
            },
          ],
          max_tokens: 300,
          temperature: 0.2, // Baixa temperatura para respostas consistentes
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[VISION] API error: ${response.status} - ${errorText}`);
        return createErrorResponse(`Erro da API: ${response.status}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { total_tokens: number };
      };

      const content = data.choices?.[0]?.message?.content || '';
      const latencyMs = Date.now() - startTime;
      
      console.log(`[VISION] Response received in ${latencyMs}ms, tokens: ${data.usage?.total_tokens || 'N/A'}`);

      // Parse JSON da resposta
      const analysis = parseVisionResponse(content);
      
      // Gerar descrição humanizada
      if (analysis.isVehicle && analysis.confianca >= MIN_CONFIDENCE) {
        analysis.descricao = generateHumanDescription(analysis);
      } else if (!analysis.isVehicle) {
        analysis.descricao = 'Não consegui identificar um veículo nesta imagem.';
      } else {
        analysis.descricao = 'Não consegui identificar o veículo com clareza. Pode me enviar uma foto melhor?';
      }

      return analysis;

    } finally {
      clearTimeout(timeout);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[VISION] Error analyzing image:', error);
    
    if (errorMessage.includes('aborted')) {
      return createErrorResponse('Tempo limite excedido na análise');
    }
    
    return createErrorResponse(errorMessage);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse da resposta JSON do GPT-4o-mini
 */
function parseVisionResponse(content: string): VehicleAnalysis {
  try {
    // Tentar extrair JSON da resposta
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON não encontrado na resposta');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      marca: parsed.marca || 'Não identificado',
      modelo: parsed.modelo || 'Não identificado',
      anoEstimado: parsed.anoEstimado || 'Não estimado',
      cor: parsed.cor || 'Não identificada',
      condicao: parsed.condicao || 'Não avaliada',
      tipo: parsed.tipo || 'outro',
      descricao: '', // Será preenchido depois
      confianca: typeof parsed.confianca === 'number' ? parsed.confianca : 50,
      isVehicle: parsed.isVehicle !== false,
      isAdScreenshot: parsed.isAdScreenshot === true,
      preco: parsed.preco || undefined,
      km: parsed.km || undefined,
    };

  } catch (error) {
    console.error('[VISION] Error parsing response:', error, 'Content:', content);
    return createErrorResponse('Erro ao processar resposta da IA');
  }
}

/**
 * Gera uma descrição humanizada para responder ao cliente
 */
function generateHumanDescription(analysis: VehicleAnalysis): string {
  const { marca, modelo, anoEstimado, cor, preco, km, isAdScreenshot } = analysis;
  
  // Se é um screenshot de anúncio (cliente interessado em comprar)
  if (isAdScreenshot) {
    const adIntros = [
      `Vi que você encontrou esse **${marca} ${modelo}**`,
      `Interessado no **${marca} ${modelo}**?`,
      `Achei esse **${marca} ${modelo}**`,
    ];
    
    const intro = adIntros[Math.floor(Math.random() * adIntros.length)];
    const parts = [intro];
    
    if (anoEstimado && anoEstimado !== 'Não estimado') {
      parts.push(`${anoEstimado}`);
    }
    
    if (preco) {
      parts.push(`por ${preco}`);
    }
    
    if (km) {
      parts.push(`com ${km}`);
    }
    
    // Pergunta sobre mais informações (não troca/compra)
    return parts.join(' ') + '! Quer que eu te passe mais detalhes sobre esse veículo ou agende uma visita? 🚗';
  }
  
  // Se é uma foto real do carro (possível troca ou venda)
  const intros = [
    `Vi que é um **${marca} ${modelo}**`,
    `Identifiquei como um **${marca} ${modelo}**`,
    `Parece ser um **${marca} ${modelo}**`,
    `Reconheci! É um **${marca} ${modelo}**`,
  ];
  
  const intro = intros[Math.floor(Math.random() * intros.length)];
  
  const parts = [intro];
  
  if (anoEstimado && anoEstimado !== 'Não estimado') {
    parts.push(`(aproximadamente ${anoEstimado})`);
  }
  
  if (cor && cor !== 'Não identificada') {
    parts.push(`cor ${cor.toLowerCase()}`);
  }
  
  // Pergunta sobre troca ou compra
  return parts.join(', ') + '. É para **troca** ou você está pensando em **comprar** um veículo?';
}

/**
 * Cria uma resposta de erro padronizada
 */
function createErrorResponse(errorMessage: string): VehicleAnalysis {
  return {
    marca: 'Não identificado',
    modelo: 'Não identificado',
    anoEstimado: 'Não estimado',
    cor: 'Não identificada',
    condicao: 'Não avaliada',
    tipo: 'outro',
    descricao: 'Não consegui analisar a imagem neste momento.',
    confianca: 0,
    isVehicle: false,
    isAdScreenshot: false,
    error: errorMessage,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { MIN_CONFIDENCE };
