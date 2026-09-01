# Guia de Manutenção

Este projeto foi documentado em duas camadas:

1. comentários inline nos arquivos principais;
2. este guia, que funciona como mapa rápido de navegação.

## Estrutura do projeto

- `index.html`
  Página pública de estoque. Mostra a tabela detalhada e a tabela-resumo.

- `editar.html`
  Página de operação. Concentra login, voz, formulário manual, nova contagem e sincronização.

- `visao-geral.html`
  Dashboard com total de caixas, saída de caixas e overview por setor/marca.

- `produtos.html`
  Cadastro de produtos/marcas/caixas por pallet (catálogo global, salvo no Supabase).

- `assets/js/`
  Todo o código do sistema, dividido em módulos ES nativos (`import`/`export`, sem bundler).
  Cada página carrega um entry point próprio (`main-view.js`, `main-edit.js`,
  `main-dashboard.js`, `main-products.js`), que só importa os módulos que aquela
  página realmente usa. Ver "Mapa de módulos" abaixo.

- `styles.css`
  Estilos compartilhados entre as quatro páginas. Toda cor, raio, sombra e padding
  sai dos tokens `--app-*` do bloco `:root` (tema escuro em
  `body[data-theme="dark"]`) — não existe mais paleta por página.

  Os componentes (`.card`, `.modal-card`, `.ghost`, `.primary`, `.view-toggle`,
  `.summary-table`, `input`/`select`/`label`, `th`/`td`) são definidos **uma vez**,
  já tokenizados. Havia duas versões de cada um — a antiga com cor cravada e a
  tokenizada escopada em `body[data-page="view"]` — e as páginas divergiam.
  Ao mexer num componente, mexa na regra base: vale para as quatro páginas.
  `body[data-page=...]` sobrou só para o que é de fato exclusivo de uma tela.
  No tema escuro ficam apenas as exceções que não são cor de token (`.msg.*`,
  gradientes, `color-scheme` dos `<select>`).

- `manifest.webmanifest`
  Configuração do PWA instalado no celular.

- `service-worker.js`
  Cache offline do shell do app (HTML/CSS/módulos JS listados em `APP_SHELL`).

- `supabase-completo.sql`
  Script principal de estrutura do banco.

- `supabase-caixas-avulsas.sql`
  Migração da funcionalidade de caixas avulsas.

- `supabase-dashboard-migracao.sql`
  Migração do campo `outflow_caixas` usado no dashboard.

> Nota: a tabela `catalog_overrides` (catálogo de produtos cadastrados pelos
> usuários) ainda não tem um script `.sql` próprio nesta pasta — foi criada
> manualmente no Supabase. Ver estrutura em `assets/js/catalog-overrides.js`.

## Mapa de módulos (`assets/js/`)

### 1. Configuração e regras de negócio

- `config.js`
  - `CONFIG_GERAL`: define setores, produtos, marcas e a função que calcula `caixas_pallet`.
  - `SPECIAL_TIPO_VARIANTS`: tipos que não aparecem como número puro. Hoje o caso
    especial é `ORANGE`, com `6A` (valor interno `14`) e `6B` (valor interno `15`).
    Cada variante guarda `legacyValues` (ex.: `601`/`602`) só para reconhecer linhas
    antigas já gravadas no banco antes da migração para `14`/`15` — nada volta a
    gravar esses valores legados.
  - `NO_TIPO_PRODUCTS`: produtos que não usam tipo (hoje, `PIMENTÃO`).
  - Constantes de tabelas/chaves de `localStorage` usadas pelo resto dos módulos.

- `catalog-overrides.js`
  Carrega do Supabase (tabela `catalog_overrides`) os produtos/marcas cadastrados
  ou removidos pelos usuários e aplica isso por cima de `CONFIG_GERAL` antes de
  qualquer parsing. Roda no boot de todas as páginas — é o que faz um produto
  cadastrado em `produtos.html` aparecer no parser de voz/manual de `editar.html`.
  `localStorage` aqui é só um cache de leitura para quando o Supabase falha, não
  a fonte de verdade.

### 2. Utilitários de inventário

- `inventory-core.js`
  - `normalizeInventoryMetrics`: mantém pallets, caixas avulsas e total coerentes.
  - `hydrateInventoryRow`: normaliza qualquer linha lida do banco ou do rascunho.
  - `applyInventoryDeltas`: soma pallets/caixas em um item já existente.
  - `aggregateRows`: agrupa itens iguais.

### 3. Desfazer e corrigir último lançamento

- `voice-actions.js`
  - `registerInventoryChange`, `buildLaunchItem`, `buildLaunchRecord`
  - `revertLaunchRecord`, `removeLastLaunchCommand`
  - `beginVoiceCorrection`, `handlePendingCorrection`

  Essas funções sustentam os comandos de voz `REMOVER` e `CORRIGIR`.

### 4. Linguagem e parser da voz

- `utils.js`: `normalizeText`/`tokenizeText` normalizam a transcrição da fala
  (ex.: `CEP` -> `CEPI`, `BRASIL` -> `BRAZIL`, `ORANAGE` -> `ORANGE`).
- `voice-actions.js`: `processCommand` é o coração da automação por voz/texto —
  decide travas de contexto, tipo, quantidade, remoção/correção e gravação final.
  `extractCommandNumbers`/`extractCommandTipoValues` extraem números e tipos do
  comando ignorando setor/produto/marca já reconhecidos.
- `voice-speech.js`: `setupVoice`, integração real com a Web Speech API (só usado
  em `editar.html`).

### 5. Rascunho offline

- `draft.js`: `saveCountDraftLocally`, `restoreCountDraftForCurrentUser`, `clearCountDraft`.
- `tables.js`: `renderCountSyncStatus` (mostra o status de sincronização na tela).

Essas funções permitem continuar a nova contagem sem internet.

### 6. Saída entre contagens

- `comparison.js`
  - `calculateOutflowCaixas`: soma quantas caixas saíram no total.
  - `buildPublicRowsAfterUserReplacement`: reconstrói o estoque público "após
    salvar" sem depender de uma nova leitura do servidor.

  Alimentam o `outflow_caixas` salvo no snapshot (`count-mode.js`), que aparece
  no histórico da `Visão geral`. Não existe mais uma tela de comparação item a
  item — essa parte (`buildComparisonReport`/`renderComparisonReport`) foi
  removida por não ter nenhum elemento de UI conectado.

### 7. Dashboard

- `dashboard.js`
  - `buildDashboardOverviewData`, `renderDashboardOverview`: overview atual da
    `Visão geral` (total de caixas/pallets, top produtos, alertas de estoque
    baixo, histórico, gráfico de marcas).
  - `buildSnapshotSeries`, `buildDashboardSeries`, `renderDashboard`: gráfico de
    linha mais antigo (total/saída por período). Só roda se a página tiver os
    elementos `#chart-total`/`#chart-outflow` — hoje nenhuma tem, então esse
    caminho fica inativo. Mantido de propósito para uma eventual reativação
    (não mexer sem confirmar antes).

### 8. Supabase

- `supabase-api.js`: `loadPublicRecords`, `loadUserRecords`, `upsertRecord`, `saveSnapshotRecord`.
- `count-mode.js`: `saveNewCount` (sincroniza a nova contagem inteira de uma vez).

### 9. Formulário manual e edição

- `manual-form.js`
  - `updateManualTipoOptions`: monta os tipos disponíveis conforme setor/produto/marca
    (ex.: `ORANGE` mostra `6A`/`6B`, `PIMENTÃO` mostra `S/T`).
  - `getManualCaixasPallet`, `addManualItem`, `openEditModal`, `saveEditItem`, `removeRow`.

### 10. Catálogo de produtos

- `catalog-crud.js`: CRUD do cadastro de produtos em `produtos.html` — modal de
  cadastro, modal de confirmação, remoção e "restaurar catálogo original". Toda
  gravação/remoção vai para a tabela `catalog_overrides` no Supabase (visível
  para todos os usuários, não só quem cadastrou).
- `catalog-overrides.js`: ver seção 1.

### 11. Bootstrap

- `head.js`: metatags, manifest e fontes do `<head>`. Cada HTML traz só charset,
  `<title>`, `styles.css` e este script — o resto era idêntico nas quatro páginas.
  Script clássico e síncrono de propósito (o `theme-color` precisa valer antes da
  primeira pintura).
- `app-shell.js`: sidebar, topbar mobile e o conteúdo do `<header class="page-head">`
  (`PAGE_HEADS`, escolhido pelo `data-page` do `<body>`). Tem que ser um dos
  primeiros imports do entry point, antes de `state.js`.
- `modal-shell.js`: moldura dos modais (backdrop, `.modal-card`, `.modal-header`).
  O HTML declara só o conteúdo dentro de um `<div data-modal ...>`; ver os
  atributos aceitos no topo do arquivo. Também antes de `state.js`.
- `boot-common.js`: `finishBoot`, o fim de boot igual nas quatro páginas.
- `auth-ui.js`: `setupAuth`, `handleAuthState`, `setupShellEvents`, `setupTheme`,
  `initSetorSelects`. Roda em todas as páginas.
- `main-view.js` / `main-edit.js` / `main-dashboard.js` / `main-products.js`:
  um entry point por página — cada um só importa e inicializa os módulos que
  aquela página usa.

## Fluxos principais

### Fluxo 1: estoque atual

1. `loadPublicRecords` carrega a tabela pública.
2. `loadUserRecords` carrega a contagem do usuário logado.
3. `renderPublicTable` e `renderCountTable` (`tables.js`) atualizam a tela.

### Fluxo 2: nova contagem offline

1. `setCountMode("new")` (`count-mode.js`) inicia a nova contagem.
2. os lançamentos entram em `state.sessionRows`.
3. `saveCountDraftLocally` (`draft.js`) protege o rascunho no aparelho.
4. `saveNewCount` (`count-mode.js`) sincroniza tudo de uma vez com o Supabase.

### Fluxo 3: voz

1. `setupVoice` (`voice-speech.js`) liga a Web Speech API.
2. `processCommand` (`voice-actions.js`) interpreta o texto final.
3. `registerInventoryChange` aplica o lançamento.
4. `upsertRecord` (`supabase-api.js`) salva no banco quando necessário.

### Fluxo 4: saída entre contagens

1. ao salvar nova contagem (`saveNewCount`), o sistema separa contagem anterior e atual.
2. `calculateOutflowCaixas` (`comparison.js`) soma o total que saiu.
3. `saveSnapshotRecord` (`supabase-api.js`) grava o snapshot com `outflow_caixas`.
4. `renderDashboardOverview` (`dashboard.js`) mostra isso no histórico da `Visão geral`.

### Fluxo 5: cadastro de produto (catálogo global)

1. usuário cadastra/remove um produto em `produtos.html` (`catalog-crud.js`).
2. a gravação vai direto para a tabela `catalog_overrides` no Supabase.
3. `catalog-overrides.js` recarrega os overrides e reaplica sobre `CONFIG_GERAL`
   em qualquer página, para qualquer usuário logado.

## Regras especiais atuais

- `PIMENTÃO` usa `S/T`.
- marcas com `14Kg` continuam sendo marcas normais, não tipo.
- `ORANGE` usa tipos especiais: `6A` (interno `14`) e `6B` (interno `15`).
- catálogo de produtos pode ter caixas/pallet variando por faixa de tipo
  (ex.: tipo ≤ 6 usa um valor, tipo > 6 usa outro) — configurado no cadastro
  em `produtos.html`, colunas `tipo_min`/`tipo_max`/`caixas_pallet_in_range`.

## Dica de manutenção

Quando precisar alterar alguma regra de negócio, siga esta ordem:

1. ajuste `CONFIG_GERAL` (`config.js`) se a mudança for de produto/marca/caixas
   por pallet fixo, ou use o cadastro em `produtos.html` se for algo que os
   usuários devem poder gerenciar sozinhos;
2. ajuste parser de voz em `normalizeText` (`utils.js`), `extractCommandNumbers`
   ou `processCommand` (`voice-actions.js`);
3. ajuste formulário manual em `updateManualTipoOptions` e `addManualItem`
   (`manual-form.js`);
4. ajuste exibição em `formatTipoLabelValue` (`utils.js`), tabelas (`tables.js`)
   e dashboard (`dashboard.js`);
5. se houver persistência nova, revise as funções do Supabase (`supabase-api.js`,
   `catalog-overrides.js`).

Depois de qualquer mudança em `assets/js/*.js` ou `styles.css`, incremente os
query params `?v=...` nos `<link>`/`<script>` das 4 páginas HTML (cache-busting
do GitHub Pages) e, se algum arquivo do `APP_SHELL` mudou, também as versões de
cache em `service-worker.js`.
