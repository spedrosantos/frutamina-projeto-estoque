-- Migração de caixas avulsas:
-- adiciona a coluna, recalcula totais antigos e recria a trigger de normalização.

ALTER TABLE IF EXISTS public.estoque_registros
ADD COLUMN IF NOT EXISTS caixas_avulsas INTEGER NOT NULL DEFAULT 0
CHECK (caixas_avulsas >= 0);

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_calcular_total_caixas ON public.estoque_registros;

CREATE TRIGGER trigger_calcular_total_caixas
BEFORE INSERT OR UPDATE ON public.estoque_registros
FOR EACH ROW
EXECUTE FUNCTION public.calcular_total_caixas();

UPDATE public.estoque_registros
SET
  caixas_avulsas = GREATEST(
    COALESCE(total_caixas, 0) - (COALESCE(caixas_pallet, 0) * COALESCE(pallets, 0)),
    0
  ),
  total_caixas = (COALESCE(caixas_pallet, 0) * COALESCE(pallets, 0)) + GREATEST(
    COALESCE(total_caixas, 0) - (COALESCE(caixas_pallet, 0) * COALESCE(pallets, 0)),
    0
  );
