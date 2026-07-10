-- Migração pequena do dashboard:
-- adiciona o campo que guarda quantas caixas sairam em cada snapshot salvo.

ALTER TABLE IF EXISTS public.estoque_snapshots
ADD COLUMN IF NOT EXISTS outflow_caixas INTEGER NOT NULL DEFAULT 0;

UPDATE public.estoque_snapshots
SET outflow_caixas = COALESCE(outflow_caixas, 0);
