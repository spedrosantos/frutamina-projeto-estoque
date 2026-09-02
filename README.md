# Projeto Estoque CD (Frutamina)

Aplicação web (PWA) para contagem e acompanhamento de estoque do CD, com:

- consulta pública do estoque;
- edição por usuário autenticado (voz ou formulário manual);
- modo **estoque atual** (fila de lançamentos) e modo **nova contagem** (rascunho offline);
- cadastro de produtos/marcas compartilhado entre todos os usuários;
- dashboard com total de caixas, saída entre contagens e histórico diário (sazonalidade);
- exportação CSV, impressão/PDF e envio da tabela por WhatsApp.

## Visão Geral

O sistema é 100% frontend (HTML/CSS/JavaScript vanilla, sem bundler) e usa o Supabase como backend (Auth + Postgres + RLS).

Fluxo principal:

1. Usuário faz login (a mesma tela de login vale para qualquer página).
2. Em `editar.html`, lança itens no estoque atual ou inicia uma nova contagem.
3. Nos dois modos o lançamento fica primeiro no aparelho; o envio ao Supabase acontece quando o operador salva.
4. Ao salvar a nova contagem, o sistema substitui a contagem antiga do setor e grava um snapshot para o dashboard.

## Páginas

- **Estoque público (`index.html`)**
  - tabela detalhada e tabela-resumo;
  - busca por texto e filtros por setor/produto/marca/tipo;
  - exportação CSV e impressão/PDF.

- **Edição (`editar.html`)** — duas abas:
  - `Contagem`: comando por voz (Web Speech API) e formulário manual com selects dependentes;
  - `Conferência`: fila de lançamentos ainda não gravados, edição/remoção de itens, impressão e envio por WhatsApp;
  - alternância entre `Estoque atual` e `Nova contagem`.

- **Visão Geral (`visao-geral.html`)** — três abas:
  - `Agora`: total de caixas e pallets, produtos/marcas distintos, distribuição por setor e marca, top produtos, alertas de estoque baixo;
  - `Movimento`: histórico de contagens com o operador e a saída de caixas de cada uma;
  - `Tendência`: histórico diário por produto+marca (ou total do CD), para ver sazonalidade.

- **Produtos (`produtos.html`)**
  - cadastro de combinações setor/produto/marca e de caixas por pallet (com faixa por tipo);
  - remoção de itens do catálogo e "restaurar catálogo original";
  - tudo salvo na tabela `catalog_overrides`, visível para todos os usuários.

- **PWA**
  - manifesto (`manifest.webmanifest`);
  - service worker com cache do app shell e fallback offline;
  - tema claro/escuro, sidebar e topbar mobile compartilhados pelas quatro páginas.

## Stack Técnica

- HTML + CSS + JavaScript vanilla, módulos ES nativos (`import`/`export`), sem build.
- [Supabase JS v2](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) via CDN.
- Bootstrap Icons via CDN.
- Web Speech API para reconhecimento de voz.
- jsPDF (carregado sob demanda) para o PDF do WhatsApp.
- `localStorage` para cache público, fila de lançamentos e rascunho offline.

## Estrutura do Projeto

```text
projeto-estoque/
|- assets/
|  |- js/
|  |  |- core/      (state, config, utils, inventory-core)
|  |  |- shell/     (head, sidebar/topbar, modais, login, tema, boot)
|  |  |- data/      (Supabase, rascunho offline, fila, catalogo)
|  |  |- features/  (tabelas, voz, formulario, dashboard, catalogo)
|  |  `- pages/     (um entry point por pagina)
|  |- fonts/
|  `- img/
|- index.html
|- editar.html
|- visao-geral.html
|- produtos.html
|  `- css/
|     |- base.css      (tokens, botoes, cards, tabelas, icones)
|     |- shell.css     (sidebar, topbar, modais, abas, login)
|     |- tabelas.css   (index, editar, produtos)
|     `- dashboard.css (visao-geral)
|- service-worker.js
|- manifest.webmanifest
`- MANUTENCAO.md
```

Cada página carrega um entry point próprio (`main-view.js`, `main-edit.js`, `main-dashboard.js`, `main-products.js`) que importa só o que aquela tela usa. O `<head>` das quatro páginas tem apenas charset, `<title>`, os `<link>` de CSS e `assets/js/shell/head.js` — o resto das metatags é injetado por esse script.

## Banco de Dados (Supabase)

### Onde fica o schema

O repo não guarda scripts `.sql`. Tabelas, triggers, views, funções, job do
`pg_cron`, políticas RLS e grants vivem direto no projeto do Supabase — é lá que
se consulta ou altera a estrutura (SQL Editor / Table Editor). O resumo abaixo
serve para entender o app; não substitui o que está no banco.

Objetos usados pelo app: `estoque_registros`, `estoque_snapshots`,
`estoque_historico_diario` (+ view `estoque_historico_diario_total`),
`catalog_overrides`, `usuarios_label`, o trigger `calcular_total_caixas` e a
função `aplicar_lancamentos`.

### Modelo de dados (resumo)

- `estoque_registros`
  - unicidade por `user_id + setor + produto + marca + tipo`;
  - métrica central: `total_caixas = pallets * caixas_pallet + caixas_avulsas` (calculada por trigger).
- `estoque_snapshots`
  - total consolidado da contagem e `outflow_caixas` para o dashboard.
- `estoque_historico_diario`
  - uma linha por dia/produto/marca, alimentada pelo cron.
- `catalog_overrides`
  - produtos/marcas adicionados ou removidos por cima de `CONFIG_GERAL`.
- `usuarios_label`
  - nome legível do operador por `user_id`.

### Políticas RLS (resumo)

- Leitura de `estoque_registros`: pública (`anon`, `authenticated`).
- Escrita de `estoque_registros`: somente o dono (`auth.uid() = user_id`).
- Exclusão de `estoque_registros`: qualquer usuário autenticado.
- Leitura de `estoque_snapshots`: pública. Inserção: usuário autenticado dono do registro.

## Autenticação

No login, o campo "usuário" é convertido para e-mail automaticamente:

- `1234` -> `1234@cd.local`;
- e-mail completo é usado como está.

Os usuários devem existir no Supabase Auth com esse padrão de e-mail e senha válida. A sessão local expira em 1 hora (`SESSION_MAX_MS`).

## Regras de Negócio Importantes

- Setores principais: `CHAO`, `GELADEIRA`, `ITAUEIRA`.
- Regras fixas de produto/marca/caixas por pallet ficam em `CONFIG_GERAL` (`assets/js/core/config.js`); o que os usuários cadastram em `produtos.html` vai para `catalog_overrides` e é aplicado por cima.
- Tipos válidos padrão: `3` a `15`.
- `PIMENTÃO` não usa tipo: valor interno `0`, exibição `S/T`.
- `ORANGE` divide o tipo 6 em `6A` (interno `14`) e `6B` (interno `15`).
- Caixas avulsas que fecham um pallet são convertidas automaticamente.
- O catálogo permite caixas/pallet diferente por faixa de tipo (`tipo_min`/`tipo_max`).

## Comandos de Voz (resumo prático)

- Fixar contexto: `CHAO`, `AMARELO`, `ANGEL`
- Lançar pallets por tipo: `4`, ou `4 4 5` para vários
- Adicionar quantidade: `ADICIONAR 2`
- Caixas avulsas: `8 CAIXAS`, `ADICIONAR 8 CAIXAS`
- Especiais: `REMOVER` (desfaz o último lançamento ainda não gravado), `CORRIGIR` (fluxo guiado)

Observações:

- reconhecimento de voz foi pensado para Chrome/Edge;
- o parser normaliza variações de fala (ex.: `BRASIL` -> `BRAZIL`, `CEP` -> `CEPI`).

## Modo "Estoque Atual" vs "Nova Contagem"

- **Estoque Atual**
  - cada lançamento entra numa fila de *deltas* no aparelho (`pending-changes.js`), visível na aba `Conferência`;
  - ao salvar, a fila inteira vai numa única chamada (`aplicar_lancamentos`) e é aplicada numa transação: ou grava tudo, ou nada — no erro a fila continua intacta no aparelho;
  - se o banco ainda não tiver a função, o app volta sozinho ao caminho antigo (um `SELECT` + `UPDATE` por item, em série) e não avisa nada — só fica mais lento;
  - a fila sobrevive ao logout e ao fechamento do app.

- **Nova Contagem**
  - as alterações ficam em rascunho local (`localStorage`);
  - ao salvar: insere a nova contagem, **depois** apaga as linhas antigas dos setores contados (de qualquer operador), calcula a saída e grava o snapshot;
  - a ordem é inserir-antes-de-apagar de propósito: uma falha no meio deixa duplicata (recuperável), nunca estoque zerado.

Offline, nos dois modos o que foi lançado fica no aparelho até haver internet.

## Comportamento Offline e Cache

- Cache público: `cd_public_cache` guarda o último estoque carregado e serve de fallback.
- Fila do estoque atual: `cd_pending_changes_v1`.
- Rascunho da nova contagem: `cd_count_draft_v1`.
- Preferência de tema: `cd_theme_preference_v1`.
- Sessão: `cd_login_at`, limite de 1 hora.
- Leituras de boot usam timeout curto (`SUPABASE_READ_TIMEOUT_MS`, 12s): passado isso, o cache local é servido em vez de deixar a tela esperando.
- Service worker: tudo (inclusive HTML/CSS/JS do app) é servido do cache e revalidado em segundo plano — a tela pinta sem esperar a rede. Em troca, **subir a versão do cache a cada deploy deixou de ser opcional**: sem isso a mudança só aparece no carregamento seguinte.
- Ícones não vêm mais de CDN: `assets/fonts/bootstrap-icons-subset.woff2` (4KB) tem só os 38 ícones usados, e as classes `.bi-*` ficam no fim do `assets/css/base.css`.

## Exportação e Compartilhamento

- **CSV**: exporta os dados filtrados (público) ou o setor atual (edição).
- **Impressão/PDF**: abre a janela de impressão; "PDF" depende do "Salvar como PDF" do navegador/SO.
- **WhatsApp**: gera o PDF no navegador e entrega pelo Web Share do aparelho (no celular o WhatsApp aparece na lista). No desktop, onde o Share não aceita arquivo, o PDF é baixado e o WhatsApp abre com o texto pedindo para anexar.

## Executando Localmente

### 1) Pré-requisitos

- projeto Supabase criado, scripts SQL aplicados, usuários criados no Auth;
- navegador moderno (Chrome/Edge para voz).

### 2) Credenciais Supabase

Em `assets/js/core/config.js`, revise `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

### 3) Servidor estático

```bash
python -m http.server 5500
```

Depois acesse `http://localhost:5500/index.html`. Precisa ser servidor HTTP: os módulos ES não carregam por `file://`.

## Deploy

Frontend estático — Vercel, Netlify, GitHub Pages ou qualquer servidor HTTP. Use HTTPS em produção (exigido por microfone, PWA e Web Share).

## Manutenção

### Alterar regras de produto/marca/tipo

Editar `CONFIG_GERAL` em `assets/js/core/config.js` (regras fixas) ou usar o cadastro em `produtos.html` (o que os usuários devem gerenciar sozinhos). Depois validar parser de voz (`normalizeText`, `processCommand`), formulário manual (`updateManualTipoOptions`, `addManualItem`) e renderização das tabelas/resumo.

### Alterar estilos

Toda cor, raio, sombra e padding sai dos tokens `--app-*` do `:root` em `assets/css/base.css` (tema escuro em `body[data-theme="dark"]`). Componentes como `.card`, `.ghost`, `.primary` e `.summary-table` são definidos uma única vez e valem para as quatro páginas.

### Atualizar versão de cache PWA

Ao publicar **qualquer** mudança de código ou asset:

- incremente `STATIC_CACHE` e `RUNTIME_CACHE` em `service-worker.js` — obrigatório, o fetch é stale-while-revalidate e sem a troca de versão o aparelho continua servindo o que já tem;
- confira se todo arquivo novo está listado em `APP_SHELL`.

## Troubleshooting

- **Erro mencionando uma coluna** (`caixas_avulsas`, `outflow_caixas`) — a coluna não existe no banco; crie no Supabase.
- **Estoque duplicando depois de uma nova contagem** — falta a policy de DELETE em `estoque_registros`: sem ela o RLS bloqueia em silêncio e as linhas do setor não são substituídas.
- **Histórico mostrando "usuário &lt;id curto&gt;"** — falta a tabela `usuarios_label`.
- **Salvar a contagem está lento (dezenas de segundos)** — o banco não tem a função `aplicar_lancamentos`. O app funciona sem ela, mas gasta 2 a 3 requisições por item.
- **Aba Tendência vazia** — confira `estoque_historico_diario`, a view `estoque_historico_diario_total` e se o job `pg_cron` está ativo (o gráfico só tem dados a partir do primeiro dia capturado).
- **Sem internet** — a consulta pública usa o último cache; a fila e o rascunho ficam no aparelho até sincronizar.
- **Microfone não funciona** — use Chrome/Edge, confirme a permissão e valide HTTPS em produção.
- **Mudança publicada não aparece** — é o service worker servindo cache: incremente a versão em `service-worker.js`.

## Observações de Segurança

- A chave do frontend é publishable (`anon`), o que é esperado para apps web.
- A proteção real de escrita depende das políticas RLS configuradas no Supabase.
- Não desabilite RLS nas tabelas de produção.
- A exclusão em `estoque_registros` é liberada para qualquer usuário autenticado, por necessidade do fluxo de nova contagem. Quem tem login pode apagar linha de outro operador.

## Documentação Complementar

- `MANUTENCAO.md`: mapa técnico dos módulos, funções e fluxos internos.
