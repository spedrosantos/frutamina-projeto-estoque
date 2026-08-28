-- Total diario de caixas do CD (soma de todos os produtos/marcas por dia).
--
-- Serve o grafico de sazonalidade da Visao Geral quando nenhum produto/marca
-- esta selecionado. Precisa ser uma view: sao ~45 pares produto+marca, entao
-- somar no cliente exigiria baixar 45 linhas por dia (1350 em 30 dias, acima
-- do teto padrao de 1000 linhas do Supabase, que truncaria sem avisar).
--
-- security_invoker = true faz a view respeitar a RLS de
-- estoque_historico_diario, ou seja, a policy historico_diario_public_read
-- que ja existe (leitura para anon e authenticated).

CREATE OR REPLACE VIEW public.estoque_historico_diario_total
WITH (security_invoker = true) AS
SELECT
  data,
  SUM(total_caixas)::INTEGER AS total_caixas
FROM public.estoque_historico_diario
GROUP BY data
ORDER BY data;

GRANT SELECT ON public.estoque_historico_diario_total TO anon, authenticated;
