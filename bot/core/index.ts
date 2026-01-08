/**
 * Bot Core - Exports Centralizados
 * ==================================
 * Domínio puro do bot. Não importa adapters diretamente.
 */

// Guards (validações iniciais)
export * from './guards';

// Intent Detection
export * from './intent-config';
export * from './intent-detection';

// Car Search
export * from './car-search';

// AI Response
export * from './ai-response';

// Seller Handoff
export * from './seller-handoff';

// Orchestrator
export * from './process-message';
