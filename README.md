# Projeto Estoque CD (Frutamina)

Aplicação web (PWA) para contagem e acompanhamento de estoque do CD, com:

- consulta pública do estoque;
- edição por usuário autenticado;
- lançamento por voz e manual;
- modo de **nova contagem** com rascunho offline;
- dashboard histórico com total de caixas e saída entre contagens;
- exportação para CSV e impressão/PDF.

## Visão Geral

O sistema é 100% frontend (HTML/CSS/JavaScript) e usa o Supabase como backend (Auth + Postgres + RLS).

Fluxo principal:

1. Usuário faz login em `editar.html`.
2. Lança itens no estoque atual ou inicia uma nova contagem.
3. O sistema salva no Supabase (modo atual) ou localmente até sincronizar (modo nova contagem).
4. Ao salvar a nova contagem, o sistema substitui a contagem antiga e grava snapshot para o dashboard.

## Funcionalidades

- **Estoque público (`index.html`)**
  - tabela detalhada e tabela-resumo;
  - busca por texto;
  - filtros por setor/produto/marca/tipo;
  - exportação CSV;
  - impressão/PDF (via janela de impressão).

- **Edição (`editar.html`)**
  - login por usuário/senha;
  - comando por voz (Web Speech API);
  - lançamento manual com selects dependentes;
  - edição e remoção de itens;
  - alternância entre:
    - `Estoque atual` (grava direto no Supabase);
    - `Nova contagem` (rascunho local com sincronização posterior).

- **Visão Geral (`visao-geral.html`)**
  - gráfico de total de caixas;
  - gráfico de caixas que saíram;
  - filtros de período: `1D`, `5D`, `1M`, `6M`, `1Y`, `5Y`, `MAX`;
  - relatório detalhado da última comparação salva.

- **PWA**
  - manifesto (`manifest.webmanifest`);
  - service worker com cache do app shell e fallback offline.

## Stack Tecnica

- HTML + CSS + JavaScript vanilla.
- [Supabase JS v2](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) via CDN.
- Bootstrap Icons via CDN.
- Web Speech API para reconhecimento de voz.
- `localStorage` para cache publico e rascunho offline.

## Estrutura do Projeto

```text
projeto-estoque/
|- assets/
|  |- app.js
|  `- img/
|- index.html
|- editar.html
|- visao-geral.html
|- styles.css
|- service-worker.js
|- manifest.webmanifest
|- supabase-completo.sql
|- supabase-caixas-avulsas.sql
|- supabase-dashboard-migracao.sql
```

## Banco de Dados (Supabase)

### Script principal

Para ambiente novo, execute:

- `supabase-completo.sql`

Ele cria/ajusta:

- tabela `public.estoque_registros`;
- tabela `public.estoque_snapshots`;
- funcao/trigger `calcular_total_caixas`;
- indices;
- politicas RLS;
- grants.

### Scripts de migracao adicionais

Use apenas se estiver atualizando ambiente antigo:

- `supabase-caixas-avulsas.sql`:
  - adiciona `caixas_avulsas`;
  - recalcula totais;
  - recria trigger de normalizacao.
- `supabase-dashboard-migracao.sql`:
  - adiciona `outflow_caixas` em snapshots.

### Modelo de dados (resumo)

- `estoque_registros`
  - chave de unicidade por: `user_id + setor + produto + marca + tipo`.
  - metrica central: `total_caixas = pallets * caixas_pallet + caixas_avulsas`.
- `estoque_snapshots`
  - guarda total consolidado da contagem;
  - guarda `outflow_caixas` para dashboard.

### Politicas RLS (resumo)

- Leitura de `estoque_registros`: publica (`anon`, `authenticated`).
- Escrita de `estoque_registros`: somente dono (`auth.uid() = user_id`).
- Leitura de `estoque_snapshots`: publica.
- Insercao em `estoque_snapshots`: usuario autenticado dono do registro.

## Autenticacao

No login, o campo "usuario" e convertido para e-mail automaticamente:

- se digitar `1234` -> `1234@cd.local`;
- se digitar e-mail completo, ele e usado como esta.

Entao, no Supabase Auth, os usuarios devem existir com esse padrao de e-mail (ou e-mail completo equivalente) e senha valida.

## Regras de Negocio Importantes

- Setores principais: `CHAO`, `GELADEIRA`, `ITAUEIRA`.
- Configuracao de produto/marca/caixas por pallet fica em `CONFIG_GERAL` (`assets/app.js`).
- Tipos validos padrao: de `3` a `15`.
- Produto sem tipo:
  - `PIMENTAO` usa tipo interno `0` e exibicao `S/T`.
- Tipo especial:
  - `ORANGE` divide tipo 6 em:
    - `6A` (valor interno 14)
    - `6B` (valor interno 15)
- Caixas avulsas:
  - se caixas avulsas fecharem pallet, ocorre conversao automatica.

## Comandos de Voz (resumo pratico)

Exemplos de uso no modo edicao:

- Fixar contexto:
  - `CHAO`
  - `AMARELO`
  - `ANGEL`
- Lancar pallets por tipo:
  - `4` (registra tipo 4 no contexto atual)
  - `4 4 5` (registra multiplos tipos)
- Adicionar quantidade:
  - `ADICIONAR 2`
- Lancar caixas avulsas:
  - `8 CAIXAS`
  - `ADICIONAR 8 CAIXAS`
- Comandos especiais:
  - `REMOVER` (desfaz ultimo lancamento)
  - `CORRIGIR` (inicia fluxo guiado de correcao)

Observacoes:

- Reconhecimento de voz foi pensado para Chrome/Edge.
- O parser normaliza variacoes de fala (ex.: `BRASIL` -> `BRAZIL`, `CEP` -> `CEPI`).

## Modo "Estoque Atual" vs "Nova Contagem"

- **Estoque Atual**
  - cada lancamento grava imediatamente no Supabase.
- **Nova Contagem**
  - alteracoes ficam em rascunho local (`localStorage`);
  - ao salvar:
    1. remove contagem antiga do usuario;
    2. insere nova contagem;
    3. calcula comparacao de saida;
    4. salva snapshot para dashboard.

Se estiver offline no modo nova contagem, o rascunho e preservado e sincronizado quando houver internet.

## Comportamento Offline e Cache

- Cache publico:
  - chave `cd_public_cache` para ultimo estoque carregado;
  - fallback em falha de leitura do servidor.
- Rascunho nova contagem:
  - chave prefixada `cd_count_draft_v1`.
- Comparacao mais recente:
  - chave `cd_last_comparison_v1`.
- Sessao local:
  - timestamp `cd_login_at` com limite de 1 hora (`SESSION_MAX_MS`).

## Exportacao

- **CSV**: exporta dados filtrados (publico) ou setor atual (edicao).
- **PDF/Impressao**:
  - abre uma janela de impressao;
  - "PDF" depende do recurso "Salvar como PDF" do navegador/SO.

## Dashboard

Origem dos dados:

- se existem snapshots: usa `estoque_snapshots`;
- senao: calcula serie temporal com dados vivos (`estoque_registros`).

Indicadores:

- total de caixas no periodo;
- variacao percentual no periodo;
- soma e pico de saida de caixas.

## Executando Localmente

### 1) Pre-requisitos

- Projeto Supabase criado.
- Scripts SQL aplicados.
- Usuarios criados no Supabase Auth.
- Navegador moderno (Chrome/Edge recomendado para voz).

### 2) Ajustar credenciais Supabase (se necessario)

No arquivo `assets/app.js`, revise:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### 3) Subir servidor estatico

Exemplo com Python:

```bash
python -m http.server 5500
```

Depois acesse:

- `http://localhost:5500/index.html`

## Deploy

Como e frontend estatico, pode ser publicado em:

- Vercel;
- Netlify;
- GitHub Pages;
- qualquer servidor HTTP estatico.

Para microfone e PWA em producao, use HTTPS.

## Manutencao

### Alterar regras de produto/marca/tipo

Editar principalmente:

- `CONFIG_GERAL` em `assets/app.js`.

Depois validar:

- parser de voz (`normalizeText`, `processCommand`);
- formulario manual (`updateManualTipoOptions`, `addManualItem`);
- renderizacao de tabelas/resumo.

### Atualizar versao de cache PWA

Ao publicar mudancas de assets:

- incremente `STATIC_CACHE` e `RUNTIME_CACHE` em `service-worker.js`;
- atualize versoes de arquivos no `APP_SHELL`;
- mantenha os query params (`?v=...`) coerentes entre HTML e service worker.

## Troubleshooting

- **Erro mencionando `caixas_avulsas`**
  - aplique `supabase-caixas-avulsas.sql`.

- **Erro mencionando `outflow_caixas`**
  - aplique `supabase-dashboard-migracao.sql`.

- **Sem internet**
  - consulta publica usa ultimo cache disponivel;
  - nova contagem mantem rascunho local ate sincronizar.

- **Microfone nao funciona**
  - use Chrome/Edge;
  - confirme permissao do microfone;
  - valide HTTPS em producao.

## Observacoes de Seguranca

- A chave usada no frontend e publishable (`anon`), o que e esperado para apps web.
- A protecao real de escrita depende das politicas RLS, que ja estao previstas nos scripts SQL.
- Nao desabilite RLS nas tabelas de producao.

## Documentacao Complementar

- `MANUTENCAO.md`: mapa tecnico rapido das funcoes e fluxos internos.

