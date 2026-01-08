/**
 * Summary Service - Turn Summary para Memória Contratual
 * ======================================================
 * Implementa resumo de turnos para evitar "amnésia" e loops
 */
import { Env } from '@types';
import { getFromKV, setInKV } from './cache.service';

// TTL: 7 dias para manter contexto entre sessões
const SUMMARY_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Interface para resumo de turno
 */
export interface TurnSummary {
  /** Intent atual do usuário */
  intent: 'browse' | 'compare' | 'negotiate' | 'visit' | 'idle';
  
  /** Stage do funil de vendas */
  stage: 'curioso' | 'comparando' | 'objecao' | 'pronto';
  
  /** Slots já coletados (lista de nomes) */
  slots_filled: string[];
  
  /** Última ação tomada pelo bot */
  last_action: 'cars' | 'seller' | 'ask' | 'info' | 'greeting' | 'none';
  
  /** Contexto resumido em texto (max 200 chars) */
  context_summary: string;
  
  /** Slots que já foram perguntados (anti-repetição) */
  asked_slots: string[];
  
  /** Timestamp da última atualização */
  updated_at: string;
  
  /** Contador de turnos */
  turn_count: number;
}

/**
 * Recupera o resumo de turno para um usuário
 */
export async function getTurnSummary(phone: string, env: Env): Promise<TurnSummary | null> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  const key = `summary:${phoneClean}`;
  return await getFromKV<TurnSummary>(env, key);
}

/**
 * Salva o resumo de turno para um usuário
 */
export async function setTurnSummary(
  phone: string, 
  summary: Partial<TurnSummary>, 
  env: Env
): Promise<void> {
  const phoneClean = phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  const key = `summary:${phoneClean}`;
  
  // Merge com existente
  const existing = await getTurnSummary(phone, env) || createEmptySummary();
  
  const newSummary: TurnSummary = {
    ...existing,
    ...summary,
    updated_at: new Date().toISOString(),
    turn_count: existing.turn_count + 1,
  };
  
  await setInKV(env, key, newSummary, SUMMARY_TTL_SECONDS);
  console.log(`[SUMMARY] Updated for ${phoneClean}: turn ${newSummary.turn_count}`);
}

/**
 * Adiciona um slot à lista de slots perguntados (anti-repetição)
 */
export async function markSlotAsAsked(
  phone: string, 
  slotName: string, 
  env: Env
): Promise<void> {
  const existing = await getTurnSummary(phone, env) || createEmptySummary();
  
  if (!existing.asked_slots.includes(slotName)) {
    existing.asked_slots.push(slotName);
    await setTurnSummary(phone, existing, env);
    console.log(`[ANTI-REP] Marked slot as asked: ${slotName}`);
  }
}

/**
 * Verifica se um slot já foi perguntado (anti-repetição)
 */
export async function wasSlotAsked(
  phone: string, 
  slotName: string, 
  env: Env
): Promise<boolean> {
  const summary = await getTurnSummary(phone, env);
  if (!summary) return false;
  return summary.asked_slots.includes(slotName);
}

/**
 * Retorna lista de slots já perguntados
 */
export async function getAskedSlots(phone: string, env: Env): Promise<string[]> {
  const summary = await getTurnSummary(phone, env);
  return summary?.asked_slots || [];
}

/**
 * Limpa slots perguntados (quando usuário muda critérios)
 */
export async function clearAskedSlots(phone: string, env: Env): Promise<void> {
  const existing = await getTurnSummary(phone, env);
  if (existing) {
    existing.asked_slots = [];
    await setTurnSummary(phone, existing, env);
    console.log(`[ANTI-REP] Cleared asked slots for ${phone}`);
  }
}

/**
 * Atualiza o resumo com base na ação tomada
 */
export async function updateSummaryAfterAction(
  phone: string,
  action: string,
  slots: Record<string, unknown>,
  env: Env
): Promise<void> {
  const filledSlots = Object.entries(slots)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, _]) => k);
  
  let lastAction: TurnSummary['last_action'] = 'none';
  if (action === 'CALL_STOCK_API') lastAction = 'cars';
  else if (action === 'HANDOFF_SELLER') lastAction = 'seller';
  else if (action === 'ASK_ONE_QUESTION') lastAction = 'ask';
  else if (action === 'INFO_STORE') lastAction = 'info';
  else if (action === 'SMALLTALK') lastAction = 'greeting';
  
  await setTurnSummary(phone, {
    slots_filled: filledSlots,
    last_action: lastAction,
  }, env);
}

/**
 * Gera contexto contratual para o prompt
 */
export async function buildContractualContext(phone: string, env: Env): Promise<string> {
  const summary = await getTurnSummary(phone, env);
  
  if (!summary || summary.turn_count === 0) {
    return ''; // Nova conversa, sem contexto
  }
  
  const parts: string[] = [];
  
  // Resumo de slots preenchidos
  if (summary.slots_filled.length > 0) {
    parts.push(`SLOTS COLETADOS: ${summary.slots_filled.join(', ')}`);
  }
  
  // Última ação
  if (summary.last_action !== 'none') {
    const actionLabels: Record<string, string> = {
      cars: 'Mostrei veículos',
      seller: 'Encaminhei para vendedor',
      ask: 'Fiz uma pergunta',
      info: 'Dei informação da loja',
      greeting: 'Cumprimentei o cliente',
    };
    parts.push(`ÚLTIMA AÇÃO: ${actionLabels[summary.last_action]}`);
  }
  
  // Slots perguntados (anti-repetição)
  if (summary.asked_slots.length > 0) {
    parts.push(`SLOTS JÁ PERGUNTADOS (NÃO REPETIR): ${summary.asked_slots.join(', ')}`);
  }
  
  // Turno atual
  parts.push(`TURNO: ${summary.turn_count}`);
  
  if (parts.length === 0) return '';
  
  return `\n\n📋 CONTEXTO DA CONVERSA:\n${parts.join('\n')}`;
}

/**
 * Cria um resumo vazio para nova conversa
 */
function createEmptySummary(): TurnSummary {
  return {
    intent: 'idle',
    stage: 'curioso',
    slots_filled: [],
    last_action: 'none',
    context_summary: '',
    asked_slots: [],
    updated_at: new Date().toISOString(),
    turn_count: 0,
  };
}
