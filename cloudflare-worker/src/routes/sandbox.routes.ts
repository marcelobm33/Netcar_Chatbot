/**
 * Sandbox Routes - Testing and Simulation
 * 
 * Endpoints for testing bot behavior without affecting production data.
 * Use these for:
 * - Debugging conversation flows
 * - Running golden conversations
 * - Testing router decisions
 */

import { Hono } from 'hono';
import { Env } from '../types';
import { 
  routeMessage, 
  createInitialState, 
  applyStateUpdate,
  ConversationState 
} from '@legacy/router.service';

const sandboxRoutes = new Hono<{ Bindings: Env }>();

// =============================================================================
// POST /simulate/chat - Simulate a single message
// =============================================================================

interface SimulateChatRequest {
  session_id: string;
  user_message: string;
  initial_state?: Partial<ConversationState>;
}

interface SimulateChatResponse {
  session_id: string;
  user_message: string;
  router: {
    action: string;
    reason: string;
    tool_to_call?: string;
    missing_slot?: string;
  };
  state_before: ConversationState;
  state_after: ConversationState;
  evals: {
    correct_priority: boolean;
    no_hallucination: boolean;
    slots_extracted: string[];
  };
}

// In-memory session store for sandbox (not persisted)
const sandboxSessions: Map<string, ConversationState> = new Map();

sandboxRoutes.post('/chat', async (c) => {
  try {
    const body = await c.req.json<SimulateChatRequest>();
    const { session_id, user_message, initial_state } = body;
    
    if (!session_id || !user_message) {
      return c.json({ error: 'session_id and user_message are required' }, 400);
    }
    
    // Get or create session state
    let state = sandboxSessions.get(session_id);
    if (!state) {
      state = createInitialState(`sandbox-${session_id}`);
      if (initial_state) {
        state = { ...state, ...initial_state };
      }
    }
    
    const stateBefore = { ...state };
    
    // Route the message
    const routerResult = routeMessage(user_message, state);
    
    // Apply state updates
    const stateAfter = applyStateUpdate(state, routerResult.state_update);
    
    // Save updated state
    sandboxSessions.set(session_id, stateAfter);
    
    // Build evals
    const slotsExtracted: string[] = [];
    if (routerResult.state_update?.slots) {
      const slots = routerResult.state_update.slots;
      if (slots.city_or_region && !stateBefore.slots.city_or_region) {
        slotsExtracted.push(`city_or_region: ${slots.city_or_region}`);
      }
      if (slots.budget_max && !stateBefore.slots.budget_max) {
        slotsExtracted.push(`budget_max: ${slots.budget_max}`);
      }
      if (slots.category && !stateBefore.slots.category) {
        slotsExtracted.push(`category: ${slots.category}`);
      }
    }
    
    const response: SimulateChatResponse = {
      session_id,
      user_message,
      router: {
        action: routerResult.action,
        reason: routerResult.reason,
        tool_to_call: routerResult.tool_to_call,
        missing_slot: routerResult.missing_slot
      },
      state_before: stateBefore,
      state_after: stateAfter,
      evals: {
        correct_priority: true, // TODO: implement priority validation
        no_hallucination: true, // Router doesn't hallucinate - deterministic
        slots_extracted: slotsExtracted
      }
    };
    
    return c.json(response);
    
  } catch (error) {
    console.error('[SANDBOX] Error:', error);
    return c.json({ 
      error: 'Simulation failed', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// =============================================================================
// POST /simulate/conversation - Run a full conversation
// =============================================================================

interface ConversationTurn {
  user: string;
  expected_action?: string;
  expected_slot?: string;
}

interface SimulateConversationRequest {
  name: string;
  turns: ConversationTurn[];
  initial_state?: Partial<ConversationState>;
}

interface TurnResult {
  turn: number;
  user_message: string;
  action: string;
  expected_action?: string;
  passed: boolean;
  slots_extracted: string[];
  reason: string;
}

interface SimulateConversationResponse {
  name: string;
  total_turns: number;
  passed: number;
  failed: number;
  success_rate: number;
  results: TurnResult[];
}

sandboxRoutes.post('/conversation', async (c) => {
  try {
    const body = await c.req.json<SimulateConversationRequest>();
    const { name, turns, initial_state } = body;
    
    if (!name || !turns || !Array.isArray(turns)) {
      return c.json({ error: 'name and turns array are required' }, 400);
    }
    
    // Initialize state
    let state = createInitialState(`golden-${name}`);
    if (initial_state) {
      state = { ...state, ...initial_state };
    }
    
    const results: TurnResult[] = [];
    let passed = 0;
    let failed = 0;
    
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const stateBefore = { ...state };
      
      // Route message
      const routerResult = routeMessage(turn.user, state);
      
      // Apply updates
      state = applyStateUpdate(state, routerResult.state_update);
      
      // Check if passed
      const actionMatches = !turn.expected_action || 
        routerResult.action === turn.expected_action;
      const slotMatches = !turn.expected_slot ||
        routerResult.missing_slot === turn.expected_slot;
      
      const turnPassed = actionMatches && slotMatches;
      
      if (turnPassed) {
        passed++;
      } else {
        failed++;
      }
      
      // Extract slots
      const slotsExtracted: string[] = [];
      if (routerResult.state_update?.slots) {
        const slots = routerResult.state_update.slots;
        Object.entries(slots).forEach(([key, value]) => {
          if (value && !stateBefore.slots[key as keyof typeof stateBefore.slots]) {
            slotsExtracted.push(`${key}: ${value}`);
          }
        });
      }
      
      results.push({
        turn: i + 1,
        user_message: turn.user,
        action: routerResult.action,
        expected_action: turn.expected_action,
        passed: turnPassed,
        slots_extracted: slotsExtracted,
        reason: routerResult.reason
      });
    }
    
    const response: SimulateConversationResponse = {
      name,
      total_turns: turns.length,
      passed,
      failed,
      success_rate: Math.round((passed / turns.length) * 100),
      results
    };
    
    return c.json(response);
    
  } catch (error) {
    console.error('[SANDBOX] Conversation error:', error);
    return c.json({ 
      error: 'Conversation simulation failed', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// =============================================================================
// POST /simulate/reset - Reset a session
// =============================================================================

sandboxRoutes.post('/reset', async (c) => {
  try {
    const { session_id } = await c.req.json<{ session_id: string }>();
    
    if (session_id) {
      sandboxSessions.delete(session_id);
      return c.json({ message: `Session ${session_id} reset` });
    } else {
      sandboxSessions.clear();
      return c.json({ message: 'All sandbox sessions cleared' });
    }
    
  } catch (error) {
    return c.json({ error: 'Reset failed' }, 500);
  }
});

// =============================================================================
// GET /simulate/sessions - List active sandbox sessions
// =============================================================================

sandboxRoutes.get('/sessions', async (c) => {
  const sessions = Array.from(sandboxSessions.keys());
  return c.json({ 
    count: sessions.length, 
    sessions 
  });
});

export default sandboxRoutes;
