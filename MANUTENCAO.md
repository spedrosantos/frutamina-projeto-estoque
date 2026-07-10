# Guia de Manutenção

Este projeto foi documentado em duas camadas:

1. comentários inline nos arquivos principais;
2. este guia, que funciona como mapa rápido de navegação.

## Estrutura do projeto

- `C:\Users\USER\Desktop\projeto-estoque\index.html`
  Página pública de estoque. Mostra a tabela detalhada e a tabela-resumo.

- `C:\Users\USER\Desktop\projeto-estoque\editar.html`
  Página de operação. Concentra login, voz, formulário manual, nova contagem e sincronização.

- `C:\Users\USER\Desktop\projeto-estoque\visao-geral.html`
  Dashboard com total de caixas, saída de caixas e comparação da última contagem.

- `C:\Users\USER\Desktop\projeto-estoque\assets\app.js`
  Arquivo central do sistema. Quase toda a regra de negócio está aqui.

- `C:\Users\USER\Desktop\projeto-estoque\styles.css`
  Estilos compartilhados entre as três páginas.

- `C:\Users\USER\Desktop\projeto-estoque\manifest.webmanifest`
  Configuração do PWA instalado no celular.

- `C:\Users\USER\Desktop\projeto-estoque\service-worker.js`
  Cache offline do shell do app.

- `C:\Users\USER\Desktop\projeto-estoque\supabase-completo.sql`
  Script principal de estrutura do banco.

- `C:\Users\USER\Desktop\projeto-estoque\supabase-caixas-avulsas.sql`
  Migração da funcionalidade de caixas avulsas.

- `C:\Users\USER\Desktop\projeto-estoque\supabase-dashboard-migracao.sql`
  Migração do campo `outflow_caixas` usado no dashboard.

## Mapa de blocos do `app.js`

### 1. Configuração e regras de negócio

- `CONFIG_GERAL`
  Define setores, produtos, marcas e a função que calcula `caixas_pallet`.

- `SPECIAL_TIPO_VARIANTS`
  Guarda tipos especiais que não aparecem como número puro.
  Hoje o caso especial é `ORANGE`, com:
  - `6A` salvo internamente como `14`
  - `6B` salvo internamente como `15`

- `NO_TIPO_PRODUCTS`
  Lista produtos que não usam tipo.
  Hoje o principal caso é `PIMENTÃO`.

### 2. Utilitários de inventário

- `normalizeInventoryMetrics`
  Função mais importante das métricas. Mantém pallets, caixas avulsas e total coerentes.

- `hydrateInventoryRow`
  Garante que qualquer linha lida do banco ou do rascunho fique normalizada.

- `applyInventoryDeltas`
  Soma pallets/caixas em um item já existente.

### 3. Desfazer e corrigir último lançamento

- `buildLaunchItem`
- `buildLaunchRecord`
- `revertLaunchRecord`
- `removeLastLaunchCommand`
- `beginVoiceCorrection`
- `handlePendingCorrection`

Essas funções sustentam os comandos de voz:
- `REMOVER`
- `CORRIGIR`

### 4. Linguagem e parser da voz

- `normalizeText`
  Normaliza a transcrição da fala.
  Exemplos:
  - `CEP` -> `CEPI`
  - `BRASIL` -> `BRAZIL`
  - `ORANAGE` -> `ORANGE`

- `extractCommandNumbers`
  Extrai números do comando ignorando setor/produto/marca já reconhecidos.

- `extractSpecialTipoSequence`
  Detecta tipos especiais como `SEIS A` e `SEIS B`.

- `processCommand`
  Coração da automação por voz. Decide:
  - travas de contexto;
  - tipo;
  - quantidade;
  - remoção/correção;
  - gravação final.

### 5. Rascunho offline

- `saveCountDraftLocally`
- `restoreCountDraftForCurrentUser`
- `clearCountDraft`
- `renderCountSyncStatus`

Essas funcoes permitem continuar a nova contagem sem internet.

### 6. Agregação, comparação e saída

- `aggregateRows`
  Agrupa itens iguais.

- `calculateOutflowCaixas`
  Soma quantas caixas saíram no total.

- `buildComparisonReport`
  Gera a lista detalhada do que saiu por item.

- `saveComparisonReport`
- `loadComparisonReport`
- `renderComparisonReport`

Essas funções alimentam o card de comparação da página `Visão geral`.

### 7. Dashboard

- `buildSnapshotSeries`
- `buildSnapshotEventSeries`
- `buildDashboardSeries`
- `renderDashboard`

Controlam os gráficos de total do CD e saída de caixas.

### 8. Supabase

- `loadPublicRecords`
- `loadUserRecords`
- `upsertRecord`
- `saveSnapshotRecord`
- `saveNewCount`

Essas funcoes fazem leitura e escrita no banco.

### 9. Formulário manual e edição

- `updateManualTipoOptions`
  Monta os tipos disponíveis conforme setor/produto/marca.
  Exemplo:
  - `ORANGE` mostra `6A` e `6B`
  - `PIMENTÃO` mostra `S/T`

- `getManualCaixasPallet`
- `addManualItem`
- `openEditModal`
- `saveEditItem`
- `removeRow`

### 10. Bootstrap

- `setupEvents`
- `handleAuthState`
- `setupAuth`
- `initSetorSelects`

São as funções que conectam o DOM com a regra de negócio.

## Fluxos principais

### Fluxo 1: estoque atual

1. `loadPublicRecords` carrega a tabela pública.
2. `loadUserRecords` carrega a contagem do usuário logado.
3. `renderPublicTable` e `renderCountTable` atualizam a tela.

### Fluxo 2: nova contagem offline

1. `setCountMode("new")` inicia a nova contagem.
2. os lançamentos entram em `state.sessionRows`.
3. `saveCountDraftLocally` protege o rascunho no aparelho.
4. `saveNewCount` sincroniza tudo de uma vez com o Supabase.

### Fluxo 3: voz

1. `setupVoice` liga a Web Speech API.
2. `processCommand` interpreta o texto final.
3. `registerInventoryChange` aplica o lançamento.
4. `upsertRecord` salva no banco quando necessário.

### Fluxo 4: comparação de saída

1. ao salvar nova contagem, o sistema separa:
   - contagem anterior
   - contagem atual
2. `buildComparisonReport` calcula item a item o que saiu.
3. `renderComparisonReport` mostra isso na `Visão geral`.

## Regras especiais atuais

- `PIMENTÃO` usa `S/T`
- marcas com `14Kg` continuam sendo marcas normais, não tipo
- `ORANGE` usa tipos especiais:
  - `6A`
  - `6B`

## Dica de manutenção

Quando precisar alterar alguma regra de negócio, siga esta ordem:

1. ajuste `CONFIG_GERAL` se a mudança for de produto/marca/caixas por pallet;
2. ajuste parser de voz em `normalizeText`, `extractCommandNumbers` ou `processCommand`;
3. ajuste formulário manual em `updateManualTipoOptions` e `addManualItem`;
4. ajuste exibição em `formatTipoLabelValue`, tabelas e resumo;
5. se houver persistência nova, revise as funções do Supabase.
