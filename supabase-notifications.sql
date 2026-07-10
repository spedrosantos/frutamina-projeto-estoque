
-- Tabela para armazenar as assinaturas de push dos dispositivos dos usuários
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, subscription)
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Política para usuários inserirem suas próprias assinaturas
CREATE POLICY "Usuários podem inserir suas próprias assinaturas" 
ON push_subscriptions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Política para usuários verem suas próprias assinaturas
CREATE POLICY "Usuários podem ver suas próprias assinaturas" 
ON push_subscriptions FOR SELECT 
USING (auth.uid() = user_id);

-- Política para usuários deletarem suas próprias assinaturas
CREATE POLICY "Usuários podem deletar suas próprias assinaturas" 
ON push_subscriptions FOR DELETE 
USING (auth.uid() = user_id);
