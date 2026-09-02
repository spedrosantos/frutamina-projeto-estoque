/*
  Service worker do PWA.

  Objetivo:
  - manter o shell do app disponivel offline;
  - pintar a tela a partir do cache, sem esperar a rede;
  - atualizar o cache automaticamente quando a versao muda.
*/

/*
  A versao do app vive AQUI, num lugar so: os HTML nao carregam mais ?v= nos
  assets.

  SUBIR ESTES NUMEROS A CADA DEPLOY E OBRIGATORIO. O fetch e stale-while-
  revalidate para tudo, inclusive HTML/CSS/JS proprio: sem a troca de versao, o
  aparelho continua pintando o codigo que ja tem em cache e so pega o novo no
  carregamento seguinte. Trocar a versao apaga os caches antigos (o install
  regrava o STATIC inteiro), entao a versao nova chega junto com o novo worker.
*/
const STATIC_CACHE = "frutamina-static-v132";
const RUNTIME_CACHE = "frutamina-runtime-v132";

const APP_SHELL = [
  "./",
  "./index.html",
  "./editar.html",
  "./produtos.html",
  "./visao-geral.html",
  "./manifest.webmanifest",
  "./assets/css/base.css",
  "./assets/css/shell.css",
  "./assets/css/tabelas.css",
  "./assets/css/dashboard.css",
  "./assets/js/shell/head.js",
  "./assets/js/shell/boot-common.js",
  "./assets/js/pages/main-view.js",
  "./assets/js/pages/main-edit.js",
  "./assets/js/pages/main-dashboard.js",
  "./assets/js/pages/main-products.js",
  "./assets/img/logo.webp",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/apple-touch-icon.png",
  "./assets/fonts/bootstrap-icons-subset.woff2",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Source+Sans+3:wght@400;600&display=swap",
];

// Chamadas do Supabase devem priorizar rede; cache serve apenas como fallback.
function isSupabaseApiRequest(url) {
  return url.origin.includes("supabase.co");
}

async function cacheAppShell() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    APP_SHELL.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch (error) {
        console.warn("Falha ao adicionar asset no cache:", asset, error);
      }
    }),
  );
}

// O STATIC vem antes do RUNTIME de proposito: o STATIC e reescrito no install de
// cada versao nova, entao ele e a copia confiavel do codigo do app; o RUNTIME
// guarda o que foi baixado durante o uso e pode ser de uma versao anterior.
async function readCached(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  const fromStatic = await staticCache.match(request);
  if (fromStatic) return fromStatic;
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  return runtimeCache.match(request);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await readCached(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      // Erro (404/500) nao pode entrar no cache, e resposta redirecionada nao
      // pode ser servida do cache para uma navegacao.
      if (response.ok && !response.redirected) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(async () => {
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await readCached("./index.html");
        if (shell) return shell;
      }
      return Response.error();
    });

  return cached || fetchPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isSupabaseApiRequest(url)) return;

  // Tudo pinta do cache e revalida em segundo plano, inclusive o codigo do app.
  // Era network-first para nunca servir versao velha, mas isso fazia toda
  // abertura esperar a rede antes de desenhar - no 4G do galpao, com o app ja
  // inteiro em cache. O preco: uma alteracao publicada sem subir a versao das
  // constantes STATIC_CACHE/RUNTIME_CACHE la em cima so chega no proximo
  // carregamento. Subir a versao a cada deploy deixou de ser opcional.
  event.respondWith(staleWhileRevalidate(request));
});
