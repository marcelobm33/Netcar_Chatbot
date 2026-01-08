/**
 * Pending Actions Service
 * 
 * Manages bot promises (tasks) that need to be fulfilled.
 * If the bot says "I'll connect you with a consultant", 
 * this becomes a pending action that MUST be completed.
 * 
 * Based on full_bot_prompt_v4.md Section 3.2
 */

import type { Env } from '@types';

// =============================================================================
// TYPES
// =============================================================================

export type ActionType = 
  | 'SEND_OPTIONS'
  | 'SEND_SIMULATION'
  | 'SCHEDULE_VISIT'
  | 'HANDOFF'
  | 'FOLLOWUP';

export type ActionStatus = 'OPEN' | 'DONE' | 'CANCELLED';

export interface PendingAction {
  id: string;
  type: ActionType;
  status: ActionStatus;
  created_at: string;
  due_at?: string;
  completed_at?: string;
  meta?: Record<string, any>;
}

// =============================================================================
// ACTION MANAGEMENT
// =============================================================================

/**
 * Create a new pending action
 */
export function createAction(
  type: ActionType,
  meta?: Record<string, any>,
  due_at?: string
): PendingAction {
  return {
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    status: 'OPEN',
    created_at: new Date().toISOString(),
    due_at,
    meta
  };
}

/**
 * Complete a pending action
 */
export function completeAction(action: PendingAction): PendingAction {
  return {
    ...action,
    status: 'DONE',
    completed_at: new Date().toISOString()
  };
}

/**
 * Cancel a pending action
 */
export function cancelAction(action: PendingAction, reason?: string): PendingAction {
  return {
    ...action,
    status: 'CANCELLED',
    completed_at: new Date().toISOString(),
    meta: { ...action.meta, cancel_reason: reason }
  };
}

/**
 * Get open actions from list
 */
export function getOpenActions(actions: PendingAction[]): PendingAction[] {
  return actions.filter(a => a.status === 'OPEN');
}

/**
 * Get overdue actions
 */
export function getOverdueActions(actions: PendingAction[]): PendingAction[] {
  const now = new Date();
  return actions.filter(a => 
    a.status === 'OPEN' && 
    a.due_at && 
    new Date(a.due_at) < now
  );
}

/**
 * Check if there's an open action of a specific type
 */
export function hasOpenAction(actions: PendingAction[], type: ActionType): boolean {
  return actions.some(a => a.type === type && a.status === 'OPEN');
}

/**
 * Find action by type
 */
export function findActionByType(actions: PendingAction[], type: ActionType): PendingAction | undefined {
  return actions.find(a => a.type === type && a.status === 'OPEN');
}

// =============================================================================
// PROMISE DETECTION FROM TEXT
// =============================================================================

const PROMISE_PATTERNS: Array<{ type: ActionType; patterns: RegExp[] }> = [
  {
    type: 'HANDOFF',
    patterns: [
      /vou (te |)passar (pro|para|pra) (consultor|vendedor|atendente)/i,
      /vou (te |)conectar (com|c\/)/i,
      /vou acionar (um |o |)(consultor|vendedor)/i,
      /deixa eu chamar (um |o |)(consultor|vendedor)/i,
      /posso acionar/i,
      /vou te colocar (direto |)(com|c\/)/i,
    ]
  },
  {
    type: 'SEND_OPTIONS',
    patterns: [
      /vou (te |)mostrar/i,
      /deixa eu buscar/i,
      /vou puxar (as |)(opç|opc)/i,
      /já te trago/i,
      /vou trazer/i,
    ]
  },
  {
    type: 'SEND_SIMULATION',
    patterns: [
      /vou simular/i,
      /vou fazer (a |uma |)simulação/i,
      /deixa eu calcular/i,
    ]
  },
  {
    type: 'SCHEDULE_VISIT',
    patterns: [
      /vou agendar/i,
      /vou marcar/i,
      /vou reservar/i,
    ]
  },
  {
    type: 'FOLLOWUP',
    patterns: [
      /vou te avisar/i,
      /te retorno/i,
      /entro em contato/i,
    ]
  }
];

/**
 * Detect promises in bot response text
 */
export function detectPromisesInText(text: string): ActionType[] {
  const detected: ActionType[] = [];
  
  for (const { type, patterns } of PROMISE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        if (!detected.includes(type)) {
          detected.push(type);
        }
        break;
      }
    }
  }
  
  return detected;
}

/**
 * Create actions from detected promises
 */
export function createActionsFromPromises(text: string): PendingAction[] {
  const types = detectPromisesInText(text);
  return types.map(type => createAction(type));
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that a promised action was actually executed
 * Returns list of unfulfilled promises
 */
export function validateActionsFulfilled(
  actionsBeforeResponse: PendingAction[],
  toolsCalled: string[]
): { fulfilled: boolean; unfulfilled: ActionType[] } {
  const unfulfilled: ActionType[] = [];
  
  const openActions = getOpenActions(actionsBeforeResponse);
  
  for (const action of openActions) {
    let wasFulfilled = false;
    
    switch (action.type) {
      case 'HANDOFF':
        wasFulfilled = toolsCalled.includes('encaminhaVendedores');
        break;
      case 'SEND_OPTIONS':
        wasFulfilled = toolsCalled.includes('chamaApiCarros');
        break;
      case 'FOLLOWUP':
        wasFulfilled = toolsCalled.includes('scheduleFollowUp');
        break;
      // SEND_SIMULATION and SCHEDULE_VISIT would map to their respective tools
      default:
        wasFulfilled = true; // No specific tool required
    }
    
    if (!wasFulfilled) {
      unfulfilled.push(action.type);
    }
  }
  
  return {
    fulfilled: unfulfilled.length === 0,
    unfulfilled
  };
}

// =============================================================================
// LOGGING
// =============================================================================

export function logPendingActions(actions: PendingAction[]): void {
  const open = getOpenActions(actions);
  const overdue = getOverdueActions(actions);
  
  console.log(`[ACTIONS] Total: ${actions.length}, Open: ${open.length}, Overdue: ${overdue.length}`, {
    open: open.map(a => a.type),
    overdue: overdue.map(a => ({ type: a.type, due: a.due_at }))
  });
}
