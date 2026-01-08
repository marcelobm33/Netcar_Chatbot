/**
 * Bot - Ponto Público de Exportação
 * ===================================
 * Centraliza exports do módulo bot.
 * Reduz imports profundos e controla dependências.
 */

// Tipos e interfaces
export * from './types';

// Ports (interfaces formais para DI)
export * from './ports';

// Grounding (rastreabilidade de dados)
export * from './grounding';

// Core (domínio puro)
export * from './core';

// Adapters (implementações de infra)
export * from './adapters';

// Prompts
export * from './prompts';
