/**
 * Scripts Service - Respostas Determinísticas para FAQ
 * 
 * Este serviço contém respostas padrão para perguntas frequentes,
 * evitando chamadas desnecessárias à IA.
 * 
 * @version 1.0.0
 * @date 2025-12-21
 */

// ============================================================
// TIPOS
// ============================================================

export interface ScriptResponse {
  matched: boolean;
  response?: string;
  action?: 'respond' | 'handover' | 'search';
  metadata?: Record<string, unknown>;
}

// ============================================================
// PADRÕES DE DETECÇÃO
// ============================================================

const FINANCING_PATTERNS = [
  /financ/i,
  /parcela/i,
  /entrada\s*(m[ií]nima)?/i,
  /consórcio/i,
  /cdc/i,
  /crédito/i,
  /fina?n?c?e?i?r?a?/i,
  /pode\s*parcelar/i,
  /quantas\s*vezes/i,
  /juros/i,
];

const HOURS_PATTERNS = [
  /hor[aá]rio/i,
  /funciona/i,
  /abre/i,
  /fecha/i,
  /aberto/i,
  /abrimos/i,
  /atend(e|em)\s*(até|quando|que horas)/i,
  /que\s*horas/i,
  /domingo/i,
  /s[aá]bado/i,
  /feriado/i,
];

const LOCATION_PATTERNS = [
  /endere[çc]o/i,
  /onde\s*(fica|ficam|est[aá]|voc[eê]s)/i,
  /(de\s+)?onde\s+(voc[eê]s\s+)?s[aã]o/i,  // "De onde vocês são?", "de onde são"
  /localiza[çc][aã]o/i,
  /como\s*chegar/i,
  /mapa/i,
  /rua/i,
  /bairro/i,
  /cidade/i,
  /qual\s*(a\s+)?(cidade|local|lugar)/i, // "Qual cidade?", "qual local?"
];

const WARRANTY_PATTERNS = [
  /garantia/i,
  /procedência/i,
  /vistoria/i,
  /laudo/i,
  /sinistro/i,
  /historico/i,
  /ipva/i,
  /multa/i,
  /documento/i,
  /transfer[eê]ncia/i,
];

const TEST_DRIVE_PATTERNS = [
  /test\s*drive/i,
  /experimentar/i,
  /dirigir/i,
  /testar/i,
  /ver\s*(o\s*carro|pessoalmente)/i,
  /visitar/i,
  /conhecer\s*(a\s*loja|o\s*carro)/i,
];

const PAYMENT_PATTERNS = [
  /pix/i,
  /cart[aã]o/i,
  /transfer[eê]ncia/i,
  /boleto/i,
  /forma\s*de\s*pagamento/i,
  /como\s*(pagar|pago)/i,
  /aceita(m)?\s*(cart[aã]o|pix)/i,
  /d[ée]bito/i,
  /cr[ée]dito/i,
];

const TRADE_IN_EXCLUDED = [
  // Estas são tratadas pelo intents.service.ts
  /aceita/i,
  /troca/i,
  /meu\s*carro/i,
  /tenho\s*um/i,
];

// ============================================================
// RESPOSTAS PADRÃO
// ============================================================

const RESPONSES = {
  financing: `Sim, a gente trabalha com financiamento! A entrada é a partir de 20% do valor e dá pra parcelar em até 60x. A aprovação é bem rápida, em média 30 minutos. Trabalhamos com vários bancos pra conseguir a melhor taxa pra ti. Quer que um consultor faça uma simulação personalizada?`,

  // PLACEHOLDER - substituído dinamicamente (fallback seguro)
  hours: `Nosso horário é de segunda a sexta das 9h às 18h e sábado das 9h às 17h.`,

  location: `A gente fica no centro de Esteio, bem fácil de achar! Temos duas lojas: uma na Av. Presidente Vargas 740 e outra no número 1106, as duas no centro. Quer vir dar uma olhada? Posso te ajudar a agendar uma visita.`,

  warranty: `Pode ficar tranquilo que todos os nossos carros passam por vistoria completa de 150 pontos. Vem com laudo cautelar incluso, a gente verifica histórico de manutenção, sem sinistros, sem restrições. E ainda tem garantia de motor e câmbio por 3 meses. Documentação fica 100% regularizada. Ficou com alguma dúvida sobre um carro específico?`,

  testDrive: `Claro! Tu pode vir conhecer o carro de perto e fazer um test drive. Só precisa trazer a CNH válida e um documento com foto. Sugiro agendar com antecedência pra garantir que o carro que tu quer tá disponível. Quer que eu conecte com um consultor pra agendar?`,

  payment: `A gente aceita dinheiro, PIX (sem taxa), cartão de débito, transferência bancária e financiamento. Só não fazemos cartão de crédito parcelado direto, tá? Qual forma tu prefere?`,
};

// ============================================================
// HORÁRIOS DINÂMICOS
// ============================================================

interface StoreHoursConfig {
  weekday_start: string;
  weekday_end: string;
  saturday_start: string;
  saturday_end: string;
  sunday_closed: boolean;
  special_rules?: Array<{
    label: string;
    description: string;
    active: boolean;
  }>;
}

/**
 * Formata horário de HH:MM ou número simples para exibição legível
 * Ex: "09:30" -> "9h30", "18:00" -> "18h", "9" -> "9h"
 */
function formatTimeDisplay(time: string): string {
  if (!time) return '';
  
  // Se já é só um número (formato antigo), retorna como está
  if (/^\d{1,2}$/.test(time)) {
    return `${parseInt(time, 10)}h`;
  }
  
  // Se é formato HH:MM
  if (time.includes(':')) {
    const [h, m] = time.split(':');
    const hour = parseInt(h, 10);
    const min = parseInt(m, 10) || 0;
    return min > 0 ? `${hour}h${m}` : `${hour}h`;
  }
  
  return time;
}

/**
 * Gera a resposta de horários de forma CONVERSACIONAL (não em bloco)
 * @param hours - Configuração de horários da loja
 * @param userMessage - Mensagem do usuário para detectar perguntas sobre dias específicos
 */
export function buildDynamicHoursResponse(hours: StoreHoursConfig, userMessage?: string): string {
  const weekdayStart = formatTimeDisplay(hours.weekday_start);
  const weekdayEnd = formatTimeDisplay(hours.weekday_end);
  const satStart = formatTimeDisplay(hours.saturday_start);
  const satEnd = formatTimeDisplay(hours.saturday_end);
  
  // Verifica se é hoje (para contexto)
  const now = new Date();
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dayOfWeek = brazilTime.getDay();
  const currentHour = brazilTime.getHours();
  
  let response = '';
  
  // Detecta se usuário pergunta sobre dia específico
  const lowerMsg = (userMessage || '').toLowerCase();
  const askingAboutSaturday = /s[aá]bado|sabado/i.test(lowerMsg);
  const askingAboutSunday = /domingo/i.test(lowerMsg);
  const askingAboutTomorrow = /amanh[aã]/i.test(lowerMsg);
  const askingAboutWeekday = /segunda|ter[cç]a|quarta|quinta|sexta|semana/i.test(lowerMsg);
  
  // Resposta específica para pergunta sobre SÁBADO
  if (askingAboutSaturday) {
    return `No sábado a gente funciona das ${satStart} às ${satEnd}. Quer agendar uma visita?`;
  }
  
  // Resposta específica para pergunta sobre DOMINGO
  if (askingAboutSunday) {
    return `No domingo a loja fica fechada. Mas de segunda a sexta a gente abre das ${weekdayStart} às ${weekdayEnd}, e sábado das ${satStart} às ${satEnd}.`;
  }
  
  // Resposta específica para pergunta sobre DIAS DE SEMANA
  if (askingAboutWeekday) {
    return `De segunda a sexta a gente abre das ${weekdayStart} às ${weekdayEnd}. No sábado das ${satStart} às ${satEnd}, e domingo fechado.`;
  }
  
  // Resposta específica para AMANHÃ
  if (askingAboutTomorrow) {
    const tomorrowDay = (dayOfWeek + 1) % 7;
    if (tomorrowDay === 0) {
      return `Amanhã é domingo, então a loja vai estar fechada. Mas segunda a gente abre às ${weekdayStart}!`;
    } else if (tomorrowDay === 6) {
      return `Amanhã, sábado, a loja abre das ${satStart} às ${satEnd}. Quer vir dar uma olhada?`;
    } else {
      return `Amanhã a gente abre das ${weekdayStart} às ${weekdayEnd}. Quer agendar uma visita?`;
    }
  }
  
  // Resposta baseada no dia atual (comportamento padrão)
  if (dayOfWeek === 0) {
    // Domingo
    response = `Hoje é domingo, então a loja tá fechada. Mas de segunda a sexta a gente abre das ${weekdayStart} às ${weekdayEnd}, e sábado das ${satStart} às ${satEnd}.`;
  } else if (dayOfWeek === 6) {
    // Sábado
    if (currentHour < parseInt(hours.saturday_start, 10)) {
      response = `Hoje a loja abre às ${satStart} e vai até ${satEnd}. Já tá quase abrindo!`;
    } else if (currentHour >= parseInt(hours.saturday_end.split(':', 10)[0] || hours.saturday_end)) {
      response = `Hoje a gente já fechou, mas segunda a gente abre de novo às ${weekdayStart}. Quer deixar agendado?`;
    } else {
      response = `A loja tá aberta agora! Hoje a gente fica até às ${satEnd}. Pode vir dar uma olhada.`;
    }
  } else {
    // Segunda a Sexta
    if (currentHour < parseInt(hours.weekday_start, 10)) {
      response = `A loja abre hoje às ${weekdayStart} e vai até ${weekdayEnd}. Já já a gente tá por aqui!`;
    } else if (currentHour >= parseInt(hours.weekday_end.split(':', 10)[0] || hours.weekday_end)) {
      response = `Hoje a gente já fechou, mas amanhã abrimos às ${weekdayStart} de novo. Quer que eu anote algo pra quando abrir?`;
    } else {
      response = `Tô por aqui sim! A loja tá aberta até às ${weekdayEnd} hoje. No sábado a gente funciona das ${satStart} às ${satEnd}, e domingo fechado.`;
    }
  }
  
  // Add active special rules de forma conversacional
  const activeRules = (hours.special_rules || []).filter(r => r.active);
  if (activeRules.length > 0) {
    const ruleTexts = activeRules.map(r => `${r.label}: ${r.description}`).join(', ');
    response += ` Ah, e só um detalhe: ${ruleTexts}.`;
  }
  
  return response;
}


/**
 * Fallback para horários padrão se não conseguir buscar da config
 */
export const DEFAULT_HOURS_CONFIG: StoreHoursConfig = {
  weekday_start: '9',
  weekday_end: '18',
  saturday_start: '9',
  saturday_end: '17',
  sunday_closed: true,
  special_rules: []
};

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================

/**
 * Verifica se a mensagem corresponde a uma FAQ e retorna resposta determinística
 */
export function checkFAQScript(message: string): ScriptResponse {
  const lowerMsg = message.toLowerCase().trim();

  // Evitar conflito com trade-in (já tratado pelo intents.service)
  for (const pattern of TRADE_IN_EXCLUDED) {
    if (pattern.test(lowerMsg)) {
      return { matched: false };
    }
  }

  // FINANCIAMENTO
  for (const pattern of FINANCING_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: financing');
      return {
        matched: true,
        response: RESPONSES.financing,
        action: 'respond',
        metadata: { category: 'financing' },
      };
    }
  }

  // HORÁRIO
  for (const pattern of HOURS_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: hours');
      return {
        matched: true,
        response: RESPONSES.hours,
        action: 'respond',
        metadata: { category: 'hours' },
      };
    }
  }

  // LOCALIZAÇÃO
  for (const pattern of LOCATION_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: location');
      return {
        matched: true,
        response: RESPONSES.location,
        action: 'respond',
        metadata: { category: 'location' },
      };
    }
  }

  // GARANTIA
  for (const pattern of WARRANTY_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: warranty');
      return {
        matched: true,
        response: RESPONSES.warranty,
        action: 'respond',
        metadata: { category: 'warranty' },
      };
    }
  }

  // TEST DRIVE
  for (const pattern of TEST_DRIVE_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: test_drive');
      return {
        matched: true,
        response: RESPONSES.testDrive,
        action: 'respond',
        metadata: { category: 'test_drive' },
      };
    }
  }

  // PAGAMENTO
  for (const pattern of PAYMENT_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: payment');
      return {
        matched: true,
        response: RESPONSES.payment,
        action: 'respond',
        metadata: { category: 'payment' },
      };
    }
  }

  // Não encontrou match - vai para IA
  return { matched: false };
}

/**
 * Versão ASYNC do checkFAQScript que busca horários dinamicamente
 * Usada quando precisamos de horários atualizados do banco de dados
 */
export async function checkFAQScriptAsync(message: string, env: any): Promise<ScriptResponse> {
  const lowerMsg = message.toLowerCase().trim();

  // Evitar conflito com trade-in
  for (const pattern of TRADE_IN_EXCLUDED) {
    if (pattern.test(lowerMsg)) {
      return { matched: false };
    }
  }

  // HORÁRIO - Resposta contextualizada baseada no dia/hora atual
  for (const pattern of HOURS_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      console.log('[SCRIPT] FAQ matched: hours (dynamic)');
      
      // Busca horários estruturados do D1
      const { DBService } = await import('./db.service');
      const db = new DBService(env.DB);
      
      let hoursConfig = DEFAULT_HOURS_CONFIG;
      try {
        const hoursJson = await db.getConfig('store_hours');
        if (hoursJson) {
          hoursConfig = JSON.parse(hoursJson);
          console.log('[SCRIPT] Loaded hours from D1 config');
        }
      } catch (e) {
        console.error('[SCRIPT] Failed to fetch store_hours from D1, using defaults:', e);
      }
      
      // Gera resposta contextualizada (sabe dia/hora atual + detecta pergunta sobre dia específico)
      const contextualResponse = buildDynamicHoursResponse(hoursConfig, message);
      
      return {
        matched: true,
        response: contextualResponse,
        action: 'respond',
        metadata: { category: 'hours', source: 'dynamic' },
      };
    }
  }

  // Para outras categorias, usa a versão sync
  const syncResult = checkFAQScript(message);

  // GLOBAL SAFETY CHECK: Ensure {{DYNAMIC_HOURS}} never leaks
  if (syncResult.response?.includes('{{DYNAMIC_HOURS}}')) {
    syncResult.response = syncResult.response.replace('{{DYNAMIC_HOURS}}', 
      "Nosso horário é de segunda a sexta das 9h às 18h e sábado das 9h às 17h."
    );
  }

  return syncResult;
}


/**
 * Verifica se a mensagem é uma saudação simples
 */
export function isSimpleGreeting(message: string): boolean {
  const greetings = [
    /^(oi|olá|ola|oie|eai|e ai|fala|salve|bom dia|boa tarde|boa noite|hey|hello|hi)[\s!?.]*$/i,
  ];
  
  const lowerMsg = message.toLowerCase().trim();
  return greetings.some(pattern => pattern.test(lowerMsg));
}

/**
 * Verifica se a mensagem é uma confirmação simples (ok, sim, etc)
 */
export function isSimpleConfirmation(message: string): boolean {
  const confirmations = [
    /^(ok|okay|sim|beleza|blz|certo|entendi|ta|tá|fechou|combinado|pode ser|vamos|bora)[\s!?.]*$/i,
  ];
  
  const lowerMsg = message.toLowerCase().trim();
  return confirmations.some(pattern => pattern.test(lowerMsg));
}

/**
 * Verifica se a mensagem é uma negação simples
 */
export function isSimpleNegation(message: string): boolean {
  const negations = [
    /^(não|nao|n|nope|agora não|depois|outra hora|talvez|vou pensar)[\s!?.]*$/i,
  ];
  
  const lowerMsg = message.toLowerCase().trim();
  return negations.some(pattern => pattern.test(lowerMsg));
}

/**
 * Busca a configuração de horários do banco de dados
 * Usado pela IA para injetar horários no contexto
 */
export async function getStoreHoursConfig(env: any): Promise<{
  weekday: string;
  saturday: string;
  sunday: string;
  special_rules: Array<{ label: string; description: string }>;
}> {
  const { DBService } = await import('./db.service');
  const db = new DBService(env.DB);
  
  try {
    const hoursJson = await db.getConfig('store_hours');
    if (hoursJson) {
      const hours = JSON.parse(hoursJson);
      
      // Format for AI consumption
      const activeRules = (hours.special_rules || [])
        .filter((r: { active?: boolean }) => r.active)
        .map((r: { label: string; description: string }) => ({
          label: r.label,
          description: r.description
        }));
      
      return {
        weekday: `${formatTimeDisplay(hours.weekday_start)} às ${formatTimeDisplay(hours.weekday_end)}`,
        saturday: `${formatTimeDisplay(hours.saturday_start)} às ${formatTimeDisplay(hours.saturday_end)}`,
        sunday: hours.sunday_closed ? 'Fechado' : 'Aberto',
        special_rules: activeRules
      };
    }
  } catch (e) {
    console.error('[SCRIPT] Failed to fetch store_hours:', e);
  }
  
  // Fallback
  return {
    weekday: '9h às 18h',
    saturday: '9h às 17h',
    sunday: 'Fechado',
    special_rules: []
  };
}
