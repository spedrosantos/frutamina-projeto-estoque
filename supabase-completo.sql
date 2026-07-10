BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.estoque_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor TEXT NOT NULL,
  produto TEXT NOT NULL,
  marca TEXT NOT NULL,
  tipo INTEGER NOT NULL,
  caixas_pallet INTEGER NOT NULL,
  pallets INTEGER NOT NULL DEFAULT 0,
  caixas_avulsas INTEGER NOT NULL DEFAULT 0,
  total_caixas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.estoque_registros
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS pallets INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caixas_avulsas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_caixas INTEGER NOT NULL DEFAULT 0;

UPDATE public.estoque_registros
SET
  setor = CASE
    WHEN UPPER(setor) IN ('CHÃO', 'CHAO') THEN 'CHAO'
    WHEN UPPER(setor) = 'GELADEIRA' THEN 'GELADEIRA'
    WHEN UPPER(setor) = 'ITAUEIRA' THEN 'ITAUEIRA'
    ELSE setor
  END,
  pallets = GREATEST(COALESCE(pallets, 0), 0),
  caixas_avulsas = GREATEST(COALESCE(caixas_avulsas, 0), 0),
  total_caixas = GREATEST(
    COALESCE(total_caixas, (COALESCE(caixas_pallet, 0) * COALESCE(pallets, 0)) + COALESCE(caixas_avulsas, 0)),
    0
  ),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW());

CREATE TABLE IF NOT EXISTS public.estoque_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  total_caixas INTEGER NOT NULL DEFAULT 0,
  outflow_caixas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.estoque_snapshots
  ADD COLUMN IF NOT EXISTS outflow_caixas INTEGER NOT NULL DEFAULT 0;

UPDATE public.estoque_snapshots
SET outflow_caixas = COALESCE(outflow_caixas, 0);

CREATE OR REPLACE FUNCTION public.calcular_total_caixas()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.caixas_pallet := GREATEST(COALESCE(NEW.caixas_pallet, 0), 0);
  NEW.pallets := GREATEST(COALESCE(NEW.pallets, 0), 0);
  NEW.caixas_avulsas := GREATEST(COALESCE(NEW.caixas_avulsas, 0), 0);

  IF NEW.caixas_pallet > 0 AND NEW.caixas_avulsas >= NEW.caixas_pallet THEN
    NEW.pallets := NEW.pallets + FLOOR(NEW.caixas_avulsas::NUMERIC / NEW.caixas_pallet::NUMERIC)::INTEGER;
    NEW.caixas_avulsas := MOD(NEW.caixas_avulsas, NEW.caixas_pallet);
  END IF;

  NEW.total_caixas := (NEW.caixas_pallet * NEW.pallets) + NEW.caixas_avulsas;
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_calcular_total_caixas ON public.estoque_registros;

CREATE TRIGGER trigger_calcular_total_caixas
BEFORE INSERT OR UPDATE ON public.estoque_registros
FOR EACH ROW
EXECUTE FUNCTION public.calcular_total_caixas();

WITH normalizados AS (
  SELECT
    (ARRAY_AGG(id ORDER BY created_at NULLS FIRST, id))[1] AS keep_id,
    user_id,
    setor,
    produto,
    marca,
    tipo,
    MAX(COALESCE(caixas_pallet, 0)) AS caixas_pallet,
    SUM(
      COALESCE(
        total_caixas,
        (COALESCE(caixas_pallet, 0) * COALESCE(pallets, 0)) + COALESCE(caixas_avulsas, 0)
      )
    )::INTEGER AS total_caixas
  FROM public.estoque_registros
  GROUP BY user_id, setor, produto, marca, tipo
),
atualizados AS (
  UPDATE public.estoque_registros t
  SET
    caixas_pallet = n.caixas_pallet,
    pallets = CASE
      WHEN n.caixas_pallet > 0 THEN FLOOR(n.total_caixas::NUMERIC / n.caixas_pallet::NUMERIC)::INTEGER
      ELSE 0
    END,
    caixas_avulsas = CASE
      WHEN n.caixas_pallet > 0 THEN MOD(n.total_caixas, n.caixas_pallet)
      ELSE n.total_caixas
    END,
    total_caixas = n.total_caixas,
    updated_at = NOW()
  FROM normalizados n
  WHERE t.id = n.keep_id
  RETURNING t.id
)
DELETE FROM public.estoque_registros t
USING normalizados n
WHERE t.user_id = n.user_id
  AND t.setor = n.setor
  AND t.produto = n.produto
  AND t.marca = n.marca
  AND t.tipo = n.tipo
  AND t.id <> n.keep_id;

ALTER TABLE public.estoque_registros
  DROP CONSTRAINT IF EXISTS unique_estoque_item,
  DROP CONSTRAINT IF EXISTS estoque_registros_setor_check,
  DROP CONSTRAINT IF EXISTS estoque_registros_tipo_check,
  DROP CONSTRAINT IF EXISTS estoque_registros_caixas_pallet_check,
  DROP CONSTRAINT IF EXISTS estoque_registros_pallets_check,
  DROP CONSTRAINT IF EXISTS estoque_registros_caixas_avulsas_check,
  DROP CONSTRAINT IF EXISTS estoque_registros_total_caixas_check;

ALTER TABLE public.estoque_registros
  ADD CONSTRAINT estoque_registros_setor_check
    CHECK (setor IN ('GELADEIRA', 'CHAO', 'ITAUEIRA')),
  ADD CONSTRAINT estoque_registros_tipo_check
    CHECK (tipo = 0 OR (tipo BETWEEN 3 AND 15)),
  ADD CONSTRAINT estoque_registros_caixas_pallet_check
    CHECK (caixas_pallet > 0),
  ADD CONSTRAINT estoque_registros_pallets_check
    CHECK (pallets >= 0),
  ADD CONSTRAINT estoque_registros_caixas_avulsas_check
    CHECK (caixas_avulsas >= 0),
  ADD CONSTRAINT estoque_registros_total_caixas_check
    CHECK (total_caixas >= 0),
  ADD CONSTRAINT unique_estoque_item
    UNIQUE (user_id, setor, produto, marca, tipo);

CREATE INDEX IF NOT EXISTS idx_estoque_user_id
  ON public.estoque_registros (user_id);

CREATE INDEX IF NOT EXISTS idx_estoque_lookup
  ON public.estoque_registros (user_id, setor, produto, marca, tipo);

CREATE INDEX IF NOT EXISTS idx_estoque_public_lookup
  ON public.estoque_registros (setor, produto, marca, tipo);

CREATE INDEX IF NOT EXISTS idx_estoque_updated_at
  ON public.estoque_registros (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
  ON public.estoque_snapshots (created_at DESC);

ALTER TABLE public.estoque_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_public_read ON public.estoque_registros;
DROP POLICY IF EXISTS estoque_user_insert ON public.estoque_registros;
DROP POLICY IF EXISTS estoque_user_update ON public.estoque_registros;
DROP POLICY IF EXISTS estoque_user_delete ON public.estoque_registros;

CREATE POLICY estoque_public_read
ON public.estoque_registros
FOR SELECT
TO anon, authenticated
USING (TRUE);

CREATE POLICY estoque_user_insert
ON public.estoque_registros
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY estoque_user_update
ON public.estoque_registros
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY estoque_user_delete
ON public.estoque_registros
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS snapshots_public_read ON public.estoque_snapshots;
DROP POLICY IF EXISTS snapshots_user_insert ON public.estoque_snapshots;

CREATE POLICY snapshots_public_read
ON public.estoque_snapshots
FOR SELECT
TO anon, authenticated
USING (TRUE);

CREATE POLICY snapshots_user_insert
ON public.estoque_snapshots
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.estoque_registros TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.estoque_registros TO authenticated;

GRANT SELECT ON public.estoque_snapshots TO anon, authenticated;
GRANT INSERT ON public.estoque_snapshots TO authenticated;

COMMIT;
