/**
 * Planner Service
 * ================
 * Sistema de interpretação de mensagens que retorna JSON estruturado.
 * O Planner NÃO responde ao cliente - apenas interpreta e decide ação.
 * 
 * Arquitetura: Planner → Executor → Responder → Validator
 */

import type { Env } from '@types';
import type { ConversationContext } from './context.service';

// =============================================================================
// TYPES
// =============================================================================

export type PlannerIntent = 
  | 'car_search'           // Quer buscar/ver carros
  | 'trade_in'             // Quer dar carro na troca
  | 'handover'             // Precisa falar com humano
  | 'info'                 // Pergunta sobre loja/horário
  | 'acknowledgment'       // Confirmação simples (ok, beleza)
  | 'postpone'             // Quer adiar/encerrar
  | 'complaint'            // Reclamação/irritação
  | 'clarification_needed' // Mensagem ambígua
  | 'continue_flow';       // Continuar fluxo anterior

export type PlannerAction = 
  | 'none'                 // Apenas responder
  | 'chamaApiCarros'       // Buscar carros
  | 'encaminhaVendedores'; // Acionar consultor

export type UserState = 
  | 'curious'              // Só olhando
  | 'deciding'             // Comparando opções
  | 'ready_to_buy'         // Pronto para fechar
  | 'irritated'            // Frustrado
  | 'confused'             // Perdido
  | 'ending';              // Encerrando

export interface PlannerEntities {
  user_car?: {
    marca?: string;
    modelo?: string;
    ano?: number;
    km?: number;      // Quilometragem do carro do cliente
    cor?: string;     // Cor do carro do cliente
  };
  interest_car?: {
    categoria?: string;
    marca?: string;
    modelo?: string;
    preco_min?: number;  // For price range queries like "entre 90 e 100mil"
    preco_max?: number;
    ano_min?: number;
    ano_max?: number;
    // Opcionais e características (teto solar, ar condicionado, etc)
    opcionais?: string[];  // Tags: teto_solar, ar_condicionado, camera_de_re, etc
    motor?: string;        // Motor spec: 1.0, 2.0, turbo, etc
    transmissao?: string;  // automatico, manual
    cor?: string;          // branco, preto, prata, etc
  };
  user_name?: string;
  time_reference?: string;
}

export interface PlannerResult {
  intent: PlannerIntent;
  confidence: number;
  entities: PlannerEntities;
  next_action: PlannerAction;
  user_state: UserState;
  context_summary: string;
  reply_instructions: string;
  passive_mode: boolean;
  variation_required: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_INTENTS: PlannerIntent[] = [
  'car_search', 'trade_in', 'handover', 'info', 
  'acknowledgment', 'postpone', 'complaint', 
  'clarification_needed', 'continue_flow'
];

const VALID_ACTIONS: PlannerAction[] = ['none', 'chamaApiCarros', 'encaminhaVendedores'];

const VALID_STATES: UserState[] = [
  'curious', 'deciding', 'ready_to_buy', 'irritated', 'confused', 'ending'
];

// =============================================================================
// PLANNER PROMPT
// =============================================================================

const PLANNER_PROMPT = `Você é um sistema de análise de conversas de uma loja de carros seminovos.
Sua tarefa é INTERPRETAR a mensagem do cliente e retornar um JSON estruturado.
Você NUNCA responde ao cliente diretamente.

## REGRAS CRÍTICAS
1. Analise a mensagem no CONTEXTO do histórico
2. Identifique a INTENÇÃO REAL (não apenas palavras-chave)
3. Detecte ENTIDADES mencionadas (carros, valores, datas)
4. Decida a PRÓXIMA AÇÃO apropriada
5. Se o cliente disse "Não" após uma pergunta, ele está NEGANDO a pergunta, não pedindo busca
6. Se o cliente disse "Sim" após uma pergunta, ele está CONFIRMANDO, avance o fluxo
7. Se o handoff já foi feito, entre em modo passivo EXCETO para buscas

## ⚠️ REGRA ESPECIAL DE BUSCA PÓS-HANDOFF
MESMO após o handoff ter sido feito:
- Se cliente perguntar "tem Taos?", "tem Kicks?" ou qualquer modelo → SEMPRE buscar com chamaApiCarros
- Se cliente pedir opções, SUV, hatch, etc → SEMPRE buscar com chamaApiCarros
- O modo passivo se aplica APENAS para conversas genéricas, NÃO para buscas de carros
- Cliente pode querer ver mais opções mesmo após já ter um vendedor atribuído

## 📘 API DE VEÍCULOS (MANUAL)
Quando o cliente quer buscar carros, extraia os filtros usando estes parâmetros:

| Parâmetro | Descrição | Exemplo |
|-----------|-----------|---------|
| montadora | Marca do veículo | FORD, VOLKSWAGEN, FIAT, HYUNDAI |
| modelo | Nome do modelo | Ka, HB20, Onix, Tracker |
| valor_min | Preço mínimo em reais (número inteiro) | 20000, 50000, 80000 |
| valor_max | Preço máximo em reais (número inteiro) | 40000, 100000, 150000 |
| ano_min | Ano mínimo do veículo | 2018, 2020 |
| ano_max | Ano máximo do veículo | 2023, 2024 |

### Conversão de valores mencionados:
- "20 mil" ou "20k" = 20000
- "50 mil" = 50000
- "100 mil" ou "100k" = 100000
- "entre X e Y" = valor_min: X, valor_max: Y
- "até X" = valor_max: X
- "a partir de X" = valor_min: X

## INTENTS
- car_search: quer buscar/ver carros, pede opções
- trade_in: quer dar carro na troca, menciona "meu carro", "na troca"
- handover: precisa falar com humano (negociação, financiamento, agendamento)
- info: pergunta sobre loja/horário/funcionamento
- acknowledgment: confirmação simples (ok, beleza, obrigado)
- postpone: quer adiar/encerrar (amanhã, vou dormir)
- complaint: reclamação/irritação
- clarification_needed: mensagem ambígua
- continue_flow: continuar de onde parou

## AÇÕES
- none: apenas responder, sem ferramenta
- chamaApiCarros: buscar carros no estoque
- encaminhaVendedores: acionar consultor humano
- consultaFipe: consultar tabela FIPE para avaliar carro do cliente

## FLUXO DE TRADE-IN (CRÍTICO!)
Quando cliente menciona que TEM um carro para troca:
1. PRIMEIRO: Perguntar ANO e KM do carro dele (para avaliar)
2. SEGUNDO: Após ter ano, usar consultaFipe para dar estimativa
3. TERCEIRO: Perguntar qual carro ele QUER comprar
4. QUARTO: Buscar carros de interesse

## ESTADOS DO USUÁRIO
- curious: só olhando
- deciding: comparando opções
- ready_to_buy: pronto para fechar
- irritated: frustrado/irritado
- confused: perdido/confuso

## REGRAS DE INFERÊNCIA (CRÍTICO!)
Quando o cliente descreve uma NECESSIDADE, você DEVE inferir os critérios de busca:

| Frase do Cliente | Inferir | Ação |
|------------------|---------|------|
| "família grande", "3+ filhos", "muitas pessoas" | Carro 7 lugares (Spin, Tracker, Captur, S10) | chamaApiCarros |
| "família pequena", "casal", "2 pessoas" | SUV compacto ou hatch | chamaApiCarros |
| "econômico", "gasta pouco", "pra uber" | Motor 1.0, híbrido | chamaApiCarros |
| "espaço", "bagagem", "viagem" | SUV, crossover | chamaApiCarros |
| "cidade", "trânsito", "estacionar fácil" | Hatch compacto | chamaApiCarros |
| "potente", "acelera", "desempenho" | Motor 2.0+, turbo | chamaApiCarros |

IMPORTANTE: Se o cliente mencionar uma necessidade, SEMPRE defina next_action como "chamaApiCarros" mesmo sem mencionar modelo específico!

## COMPORTAMENTO PROATIVO
1. NUNCA responda apenas "Beleza! Qualquer coisa, tô por aqui!" - isso mata a venda
2. Se não há ação clara, faça uma PERGUNTA de follow-up
3. Sempre ofereça opções ou pergunte sobre preferências
4. Se o cliente tem carro para troca, pergunte detalhes (modelo, ano, km)

## EXEMPLOS

### Exemplo 1: "Opções que possuem"
{
  "intent": "car_search",
  "confidence": 0.95,
  "next_action": "chamaApiCarros",
  "user_state": "curious",
  "context_summary": "Cliente quer ver opções de carros",
  "reply_instructions": "Buscar carros e apresentar opções"
}

### Exemplo 2: "Não" (após pergunta de valor)
{
  "intent": "continue_flow",
  "confidence": 0.9,
  "next_action": "none",
  "user_state": "curious",
  "context_summary": "Cliente negou a pergunta anterior",
  "reply_instructions": "Mudar abordagem, perguntar de outra forma"
}

### Exemplo 3: "Tenho uma Compass pra trocar" (SEM ano)
{
  "intent": "trade_in",
  "confidence": 0.95,
  "next_action": "none",
  "user_state": "deciding",
  "entities": {
    "user_car": { "marca": "jeep", "modelo": "compass" }
  },
  "context_summary": "Cliente quer dar Compass na troca mas não informou ano/km",
  "reply_instructions": "Confirmar que aceitamos na troca e PERGUNTAR: Qual o ano e km da tua Compass? Assim consigo te dar uma estimativa de avaliação."
}

### Exemplo 3B: "Tenho uma Compass 2021 com 45 mil km" (COM ano)
{
  "intent": "trade_in",
  "confidence": 0.95,
  "next_action": "consultaFipe",
  "user_state": "deciding",
  "entities": {
    "user_car": { "marca": "jeep", "modelo": "compass", "ano": 2021, "km": 45000 }
  },
  "context_summary": "Cliente tem Compass 2021/45mil km para troca - consultar FIPE",
  "reply_instructions": "Consultar FIPE para Jeep Compass 2021 e informar estimativa ao cliente. Depois perguntar qual carro ele quer."
}

### Exemplo 3C: "Tenho uma Compass, quero trocar por uma Tracker" (trade-in + interesse)
{
  "intent": "trade_in",
  "confidence": 0.95,
  "next_action": "none",
  "user_state": "deciding",
  "entities": {
    "user_car": { "marca": "jeep", "modelo": "compass" },
    "interest_car": { "marca": "chevrolet", "modelo": "tracker" }
  },
  "context_summary": "Cliente quer trocar Compass por Tracker - precisa saber ano/km da Compass primeiro",
  "reply_instructions": "Confirmar interesse na troca. PERGUNTAR: Qual o ano e km da tua Compass? Depois vou te mostrar as Trackers disponíveis."
}

### Exemplo 4: "Ok" (após handover)
{
  "intent": "acknowledgment",
  "confidence": 0.95,
  "next_action": "none",
  "user_state": "ending",
  "passive_mode": true,
  "context_summary": "Cliente confirmou após handover",
  "reply_instructions": "Apenas confirmar e ficar à disposição"
}

## ENTIDADES (campo "entities" no JSON)

Extraia entidades mencionadas pelo cliente. Use os parâmetros da API de veículos:

### interest_car (carro que o cliente QUER comprar)
- marca: string (FORD, VOLKSWAGEN, FIAT, etc)
- modelo: string (Ka, HB20, Onix, etc)
- preco_min: number (valor MÍNIMO em reais, ex: "a partir de 50 mil" = 50000)
- preco_max: number (valor MÁXIMO em reais, ex: "até 100 mil" = 100000)
- ano_min: number (ano mínimo)
- ano_max: number (ano máximo)
- categoria: string (SUV, HATCH, SEDAN, PICKUP)
- opcionais: string[] (lista de tags de opcionais desejados)
- motor: string (1.0, 1.3, 2.0, turbo, etc)
- transmissao: string (automatico, manual)
- cor: string (branco, preto, prata, vermelho, etc)

### OPCIONAIS DISPONÍVEIS (use estas tags exatas)
| Quando cliente mencionar | Use a tag |
|--------------------------|-----------|
| ar condicionado, ar, ar digital | ar_condicionado |
| teto solar, teto | teto_solar |
| teto panorâmico | teto_panoramico |
| câmera de ré, câmera | camera_de_re |
| sensor de estacionamento, sensor | sensor_de_estacionamento |
| motor turbo, turbo | motor_turbo |
| piloto automático, piloto | piloto_automatico |
| Android Auto, android | android |
| Apple CarPlay, carplay | apple |
| multimídia, central, tela | multimidia |
| freio ABS, abs | freios_abs |
| rodas de liga, liga leve | rodas_de_liga_leve |
| bancos de couro, couro | bancos_de_couro |
| direção elétrica | direcao_eletrica |
| air bag, airbag | air_bag |
| paddle shift | paddle_shift |

### user_car (carro que o cliente TEM para troca)
- marca: string
- modelo: string  
- ano: number

### EXEMPLOS DE EXTRAÇÃO DE PREÇO
- "entre 20 e 40 mil" → preco_min: 20000, preco_max: 40000
- "até 50 mil" → preco_max: 50000
- "a partir de 30 mil" → preco_min: 30000
- "de 80 a 100mil" → preco_min: 80000, preco_max: 100000
- "até uns 60" → preco_max: 60000

### Exemplo 5: "Quero um carro entre 20 e 40 mil"
{
  "intent": "car_search",
  "confidence": 0.95,
  "next_action": "chamaApiCarros",
  "user_state": "curious",
  "entities": {
    "interest_car": {
      "preco_min": 20000,
      "preco_max": 40000
    }
  },
  "context_summary": "Cliente quer carros na faixa de 20-40 mil",
  "reply_instructions": "Buscar carros com valor_min=20000 e valor_max=40000"
}

### Exemplo 6: "SUV até 80 mil"
{
  "intent": "car_search",
  "confidence": 0.95,
  "next_action": "chamaApiCarros",
  "user_state": "curious",
  "entities": {
    "interest_car": {
      "categoria": "SUV",
      "preco_max": 80000
    }
  },
  "context_summary": "Cliente quer SUV até R$ 80.000",
  "reply_instructions": "Buscar SUVs com valor_max=80000"
}

Retorne APENAS o JSON válido, sem explicações.`;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Chama o Planner para interpretar a mensagem e decidir próxima ação.
 * Retorna JSON estruturado com intent, entities, action, etc.
 */
export async function callPlanner(
  message: string,
  ctx: ConversationContext,
  history: Array<{ role: string; content: string }>,
  env: Env
): Promise<PlannerResult> {
  const input = buildPlannerInput(message, ctx, history);
  
  try {
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/11edc212d8f0ae41b9594f87b2724ea4/netcar-ian/openai/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 500,
          messages: [
            { role: 'system', content: PLANNER_PROMPT },
            { role: 'user', content: input },
          ],
        }),
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PLANNER] API error:', response.status, errorText.substring(0, 500));
      return getDefaultPlannerResult(message);
    }
    
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '{}';
    
    console.log('[PLANNER] Raw response:', content.substring(0, 200));
    
    const parsed = JSON.parse(content);
    return validatePlannerResult(parsed, ctx);
    
  } catch (error) {
    console.error('[PLANNER] Error:', error);
    return getDefaultPlannerResult(message);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function buildPlannerInput(
  message: string,
  ctx: ConversationContext,
  history: Array<{ role: string; content: string }>
): string {
  const parts: string[] = [];
  
  parts.push('## CONTEXTO DA CONVERSA\n');
  
  if (ctx.userName) {
    parts.push(`Cliente: ${ctx.userName}`);
  }
  
  if (ctx.qualification) {
    const q = ctx.qualification;
    if (q.make || q.model) {
      parts.push(`Interesse: ${q.make || ''} ${q.model || ''}`);
    }
    if (q.budgetMax) {
      parts.push(`Orçamento: até R$ ${q.budgetMax}`);
    }
  }
  
  // CRITICAL: Include trade-in information if available
  // This ensures Planner remembers user's car for trade across messages
  if (ctx.entities?.user_car?.modelo || ctx.qualification?.hasTradeIn) {
    const userCar = ctx.entities?.user_car;
    const tradeModel = ctx.qualification?.tradeInModel;
    
    if (userCar?.modelo) {
      const parts_car: string[] = [];
      if (userCar.marca) parts_car.push(userCar.marca);
      if (userCar.modelo) parts_car.push(userCar.modelo);
      if (userCar.ano) parts_car.push(String(userCar.ano));
      if (userCar.km) parts_car.push(`${(userCar.km / 1000).toFixed(0)}mil km`);
      parts.push(`\n⚠️ CLIENTE TEM CARRO PARA TROCA: ${parts_car.join(' ')}`);
    } else if (tradeModel) {
      parts.push(`\n⚠️ CLIENTE TEM CARRO PARA TROCA: ${tradeModel}`);
    } else {
      parts.push(`\n⚠️ CLIENTE QUER DAR CARRO NA TROCA (modelo ainda não identificado)`);
    }
  }
  
  if (ctx.sellerHandoff?.done) {
    parts.push(`\n⚠️ HANDOFF JÁ FEITO em ${ctx.sellerHandoff.at}`);
    parts.push('O consultor já foi acionado. Entrar em modo passivo.');
  }
  
  if (ctx.carsShown && ctx.carsShown.length > 0) {
    const carNames = ctx.carsShown.slice(0, 5).map(c => c.modelo || c.id).join(', ');
    parts.push(`Carros já mostrados: ${carNames}`);
  }
  
  if (ctx.lastBotMessage?.text) {
    parts.push(`\nÚltima mensagem do bot: "${ctx.lastBotMessage.text.substring(0, 100)}..."`);
  }
  
  if (ctx.lastBotQuestion) {
    parts.push(`Pergunta pendente: "${ctx.lastBotQuestion}"`);
  }
  
  // Pending action from vision handler (car identified from photo)
  const pendingSearch = ctx.pendingActions?.find(a => a.type === 'search' && !a.consumed);
  if (pendingSearch?.params) {
    const params = pendingSearch.params;
    parts.push(`\n⚠️ AÇÃO PENDENTE: Cliente pediu para ver carro identificado por foto`);
    if (params.marca) parts.push(`Marca: ${params.marca}`);
    if (params.modelo) parts.push(`Modelo: ${params.modelo}`);
    parts.push(`Use estes parâmetros na busca!`);
  }
  
  // Histórico recente
  if (history.length > 0) {
    parts.push('\n## HISTÓRICO RECENTE');
    const recentHistory = history.slice(-5);
    for (const msg of recentHistory) {
      const role = msg.role === 'assistant' ? 'Bot' : 'Cliente';
      const content = msg.content.substring(0, 150);
      parts.push(`${role}: ${content}`);
    }
  }
  
  parts.push(`\n## MENSAGEM ATUAL DO CLIENTE\n${message}`);
  parts.push('\nAnalise e retorne o JSON.');
  
  return parts.join('\n');
}

function validatePlannerResult(raw: Record<string, unknown>, ctx: ConversationContext): PlannerResult {
  const intent = VALID_INTENTS.includes(raw.intent as PlannerIntent) 
    ? (raw.intent as PlannerIntent) 
    : 'clarification_needed';
    
  const next_action = VALID_ACTIONS.includes(raw.next_action as PlannerAction)
    ? (raw.next_action as PlannerAction)
    : 'none';
    
  const user_state = VALID_STATES.includes(raw.user_state as UserState)
    ? (raw.user_state as UserState)
    : 'curious';
  
  // Se handoff já foi feito, forçar modo passivo
  const passive_mode = ctx.sellerHandoff?.done 
    ? true 
    : (raw.passive_mode === true);
  
  // Se resposta anterior foi similar, forçar variação
  const variation_required = raw.variation_required === true;
  
  return {
    intent,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    entities: validateEntities(raw.entities as Record<string, unknown> | undefined),
    next_action,
    user_state,
    context_summary: typeof raw.context_summary === 'string' ? raw.context_summary : '',
    reply_instructions: typeof raw.reply_instructions === 'string' ? raw.reply_instructions : '',
    passive_mode,
    variation_required,
  };
}

function validateEntities(raw: Record<string, unknown> | undefined): PlannerEntities {
  if (!raw) return {};
  
  const entities: PlannerEntities = {};
  
  if (raw.user_car && typeof raw.user_car === 'object') {
    const uc = raw.user_car as Record<string, unknown>;
    entities.user_car = {
      marca: typeof uc.marca === 'string' ? uc.marca : undefined,
      modelo: typeof uc.modelo === 'string' ? uc.modelo : undefined,
      ano: typeof uc.ano === 'number' ? uc.ano : undefined,
    };
  }
  
  if (raw.interest_car && typeof raw.interest_car === 'object') {
    const ic = raw.interest_car as Record<string, unknown>;
    entities.interest_car = {
      categoria: typeof ic.categoria === 'string' ? ic.categoria : undefined,
      marca: typeof ic.marca === 'string' ? ic.marca : undefined,
      modelo: typeof ic.modelo === 'string' ? ic.modelo : undefined,
      preco_min: typeof ic.preco_min === 'number' ? ic.preco_min : undefined,
      preco_max: typeof ic.preco_max === 'number' ? ic.preco_max : undefined,
    };
  }
  
  if (typeof raw.user_name === 'string') {
    entities.user_name = raw.user_name;
  }
  
  if (typeof raw.time_reference === 'string') {
    entities.time_reference = raw.time_reference;
  }
  
  return entities;
}

function getDefaultPlannerResult(message: string): PlannerResult {
  // Fallback simples baseado em padrões
  const lowerMsg = message.toLowerCase();
  
  let intent: PlannerIntent = 'clarification_needed';
  let next_action: PlannerAction = 'none';
  
  // CATEGORIA de veículos → buscar API IMEDIATAMENTE (sem perguntar preferências)
  // SUV, sedan, hatch, pickup, etc.
  if (/\b(suv|sedan|hatch|pick\s*up|picape|esportivo|compacto|crossover|minivan)\b/i.test(lowerMsg)) {
    intent = 'car_search';
    next_action = 'chamaApiCarros';
  } else if (/opç[õo]es|ver\s*carros|mostrar/i.test(lowerMsg)) {
    intent = 'car_search';
    next_action = 'chamaApiCarros';
  } else if (/troca|meu\s*carro/i.test(lowerMsg)) {
    intent = 'trade_in';
  } else if (/ok|beleza|obrigad/i.test(lowerMsg)) {
    intent = 'acknowledgment';
  }
  
  return {
    intent,
    confidence: 0.5,
    entities: {},
    next_action,
    user_state: 'curious',
    context_summary: 'Fallback - Planner não conseguiu processar',
    reply_instructions: 'Responder naturalmente',
    passive_mode: false,
    variation_required: false,
  };
}

/**
 * Verifica se deve usar o Planner ou responder direto.
 * Mensagens muito simples podem ser tratadas sem Planner.
 * 
 * Regras de gating (spec v2.0):
 * - Mensagens triviais SEM pergunta pendente: pular Planner
 * - Imagens: fluxo Vision separado
 * - Mensagens > 50 chars ou com keywords complexos: sempre Planner
 */
export function shouldUsePlanner(
  message: string,
  ctx: ConversationContext,
  imageUrl?: string
): boolean {
  // Imagens: fluxo separado (Vision)
  if (imageUrl) return false;
  
  const normalized = message.toLowerCase().trim();
  
  // Padrões triviais que não precisam de Planner
  const trivialPatterns = [
    /^(ok|oi|ol[áa]|bom\s*dia|boa\s*(tarde|noite))[\.!]?$/i,
    /^(obrigad[oa]?|valeu|blz|beleza|certo|entendi)[\.!]?$/i,
    /^(legal|show|massa|perfeito|tranquilo)[\.!]?$/i,
  ];
  
  // Padrões de SMALLTALK que devem ir direto para a IA (REGRA -1 do prompt)
  // Não precisam do Planner, pois não são sobre carros
  const smalltalkPatterns = [
    /quanto\s*[eé]\s*\d+\s*[\+\-\*\/x]\s*\d+/i,  // "quanto é 2+2", "quanto é 5x3"
    /\d+\s*[\+\-\*\/x]\s*\d+/,                    // "2+2", "5*3"
    /^(kkk+|haha+|rsrs+|kk|hehe)$/i,              // Risadas
    /^(tudo bem|como vai|como você está)\??$/i,   // Saudações estendidas
    /^que (dia|horas?|data)\s*(é|são)\s*(hoje)?\??$/i, // Perguntas de tempo
    /^você é (robô|humano|bot|ia|real)\??$/i,     // Perguntas sobre identidade
  ];
  
  // Smalltalk vai direto pra IA com REGRA -1 de humanização
  if (smalltalkPatterns.some(p => p.test(normalized))) {
    return false; // Pular Planner, IA responde naturalmente
  }
  
  // SE mensagem é trivial E não há pergunta pendente, pode pular
  if (trivialPatterns.some(p => p.test(normalized)) && !ctx.lastBotQuestion) {
    return false;
  }
  
  // ATENÇÃO: "sim" e "não" PRECISAM de Planner se houver pergunta pendente
  // Pois podem ser respostas a perguntas de qualificação
  const yesNoPatterns = /^(sim|n[aã]o|s|n)[\.!]?$/i;
  if (yesNoPatterns.test(normalized) && ctx.lastBotQuestion) {
    return true; // Precisa interpretar contexto da pergunta
  }
  
  // Mensagens longas (> 50 chars) sempre usam Planner
  if (message.length > 50) return true;
  
  // Keywords que exigem interpretação complexa
  const complexKeywords = [
    /troc[ao]|avalia|meu\s*carro/i,      // Trade-in
    /financi|parcel|entrada|presta/i,    // Negociação
    /amanh[aã]|ontem|semana|hor[aá]rio/i, // Referências temporais
    /consultor|vendedor|humano|atendente/i, // Handover
  ];
  
  if (complexKeywords.some(p => p.test(message))) {
    return true;
  }
  
  // Padrão: usar Planner para garantir qualidade
  return true;
}

