-- Atualizar tabela blacklist para incluir expiração
-- Execute no Supabase SQL Editor

-- Primeiro, remover a tabela antiga se existir
DROP TABLE IF EXISTS blacklist;

-- Criar nova tabela com expiração
CREATE TABLE blacklist (
  id SERIAL PRIMARY KEY,
  telefone VARCHAR(20) NOT NULL UNIQUE,
  motivo TEXT DEFAULT 'Pausa automática - atendimento humano',
  pausado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expira_em TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para busca rápida
CREATE INDEX idx_blacklist_telefone ON blacklist(telefone);
CREATE INDEX idx_blacklist_expira ON blacklist(expira_em);
