-- Remove a infraestrutura de notificacoes push.
--
-- A feature saiu do app: nada mais grava nem le esta tabela. Rodar isto apaga
-- as assinaturas que os dispositivos ja tinham registrado -- nao ha como
-- recuperar depois, e nem faz falta: uma assinatura nova e criada do zero se a
-- feature um dia voltar.
--
-- As politicas de RLS caem junto com a tabela (DROP TABLE leva as policies).

DROP TABLE IF EXISTS push_subscriptions;
