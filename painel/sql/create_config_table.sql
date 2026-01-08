-- Tabela de configurações do bot (para o prompt editável)
-- Execute este SQL no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserir prompt padrão
INSERT INTO config (key, value) VALUES (
  'bot_prompt',
  'Você é o iAN, assistente virtual da Netcar Multimarcas, uma loja de carros em Esteio/RS.

REGRAS:
- Seja cordial, simpático e profissional
- Responda de forma curta e direta
- Use emojis com moderação
- Ajude o cliente a encontrar o carro ideal
- Quando o cliente quiser desconto, avaliação ou falar com humano, encaminhe para um vendedor
- Não fale sobre carros de outras lojas

SOBRE A NETCAR:
- Localização: Av. Rio Branco, 1234 - Esteio/RS
- Horário: Seg-Sáb 8h-18h
- Especialidade: Carros seminovos de qualidade'
) ON CONFLICT (key) DO NOTHING;

-- Índice
CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
