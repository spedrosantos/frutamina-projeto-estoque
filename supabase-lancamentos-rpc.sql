-- Gravacao da contagem em UMA requisicao, dentro de uma transacao.
--
-- Antes: o app percorria a fila de pendencias item por item e cada item custava
-- um SELECT + um UPDATE/INSERT. Quarenta itens = ~100 idas ao servidor, em serie,
-- no 4G do galpao. Pior: entre o SELECT e o UPDATE cabia a gravacao de outro
-- operador, que era sobrescrita sem aviso (lost update).
--
-- Agora o app manda o array de lancamentos e o Postgres soma tudo com
-- INSERT ... ON CONFLICT DO UPDATE, atomico por linha e dentro de uma unica
-- transacao: ou grava a contagem inteira, ou nao grava nada.
--
-- Rodar DEPOIS de supabase-completo.sql (depende da constraint unique_estoque_item
-- e do trigger trigger_calcular_total_caixas, que continua sendo quem calcula
-- total_caixas e converte caixa avulsa em pallet fechado).

BEGIN;

-- 1. Tipos legados viram o valor atual.
--
-- O 6A/6B do ORANGE foi gravado como 601/602 antes de virar 14/15, e o app ainda
-- procura os dois valores ao atualizar uma linha (buildTipoSearchValues, em
-- assets/js/supabase-api.js). O ON CONFLICT abaixo casa por tipo exato, entao uma
-- linha legada geraria uma SEGUNDA linha do mesmo item em vez de somar na
-- existente. Normalizar aqui, uma vez, tira o legado do caminho de gravacao.
--
-- Se o item ja tem linha no valor novo E no legado, as duas sao somadas na nova e
-- a legada e apagada.
WITH legado AS (
  SELECT * FROM (VALUES
    ('ORANGE', 601, 14),
    ('ORANGE', 602, 15)
  ) AS t(produto, tipo_antigo, tipo_novo)
),
antigas AS (
  SELECT r.id, r.user_id, r.setor, r.produto, r.marca, r.caixas_pallet,
         r.total_caixas, l.tipo_novo
  FROM public.estoque_registros r
  JOIN legado l
    ON l.produto = r.produto
   AND l.tipo_antigo = r.tipo
),
somadas AS (
  UPDATE public.estoque_registros novo
  SET
    caixas_avulsas = novo.caixas_avulsas + antiga.total_caixas,
    updated_at = NOW()
  FROM antigas antiga
  WHERE novo.user_id = antiga.user_id
    AND novo.setor = antiga.setor
    AND novo.produto = antiga.produto
    AND novo.marca = antiga.marca
    AND novo.tipo = antiga.tipo_novo
  RETURNING antiga.id AS id_antiga
),
apagadas AS (
  DELETE FROM public.estoque_registros
  WHERE id IN (SELECT id_antiga FROM somadas)
  RETURNING id
)
UPDATE public.estoque_registros r
SET tipo = antiga.tipo_novo,
    updated_at = NOW()
FROM antigas antiga
WHERE r.id = antiga.id
  AND r.id NOT IN (SELECT id FROM apagadas);

-- 2. A funcao.
--
-- SECURITY INVOKER (o padrao) de proposito: as policies de RLS continuam valendo,
-- entao a funcao nao pode gravar na linha de outro operador. O user_id vem de
-- auth.uid(), nunca do payload - quem chama nao escolhe em nome de quem grava.
--
-- Cada elemento de ops:
--   { setor, produto, marca, tipo, caixas_pallet,
--     pallets_delta, caixas_avulsas_delta }
CREATE OR REPLACE FUNCTION public.aplicar_lancamentos(ops JSONB)
RETURNS SETOF public.estoque_registros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  op JSONB;
  novo_caixas_pallet INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sem sessao: faca login para gravar a contagem.';
  END IF;

  IF ops IS NULL OR JSONB_TYPEOF(ops) <> 'array' THEN
    RAISE EXCEPTION 'ops deve ser um array JSON de lancamentos.';
  END IF;

  FOR op IN SELECT value FROM JSONB_ARRAY_ELEMENTS(ops) AS value
  LOOP
    novo_caixas_pallet := GREATEST(COALESCE((op->>'caixas_pallet')::INTEGER, 0), 0);

    INSERT INTO public.estoque_registros AS r (
      user_id, setor, produto, marca, tipo,
      caixas_pallet, pallets, caixas_avulsas
    )
    VALUES (
      uid,
      op->>'setor',
      op->>'produto',
      op->>'marca',
      (op->>'tipo')::INTEGER,
      novo_caixas_pallet,
      -- Delta negativo em item que nem existe nao vira estoque negativo.
      GREATEST(COALESCE((op->>'pallets_delta')::INTEGER, 0), 0),
      GREATEST(COALESCE((op->>'caixas_avulsas_delta')::INTEGER, 0), 0)
    )
    ON CONFLICT (user_id, setor, produto, marca, tipo) DO UPDATE
    SET
      -- caixas_pallet vem da regra do catalogo no app; 0 significa "nao mandou",
      -- e nao "zerar" (a CHECK exige > 0).
      caixas_pallet = CASE
        WHEN novo_caixas_pallet > 0 THEN novo_caixas_pallet
        ELSE r.caixas_pallet
      END,
      pallets = GREATEST(
        r.pallets + COALESCE((op->>'pallets_delta')::INTEGER, 0),
        0
      ),
      caixas_avulsas = GREATEST(
        r.caixas_avulsas + COALESCE((op->>'caixas_avulsas_delta')::INTEGER, 0),
        0
      );
  END LOOP;

  -- Devolve o estoque do operador ja gravado: o app atualiza a tela com isso e
  -- deixa de precisar de um SELECT de recarga depois de salvar.
  RETURN QUERY
    SELECT * FROM public.estoque_registros WHERE user_id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_lancamentos(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_lancamentos(JSONB) TO authenticated;

COMMIT;
