/*
  Service worker do PWA.

  Objetivo:
  - manter o shell do app disponivel offline;
  - servir paginas/estilos/scripts do cache quando a rede cair;
  - atualizar o cache automaticamente quando a versao muda.
*/

const STATIC_CACHE = "frutamina-static-v36";
const RUNTIME_CACHE = "frutamina-runtime-v36";

const APP_SHELL = [
  "./",
  "./index.html",
  "./editar.html",
  "./produtos.html",
  "./visao-geral.html",
  "./manifest.webmanifest",
  "./styles.css?v=20260423-7",
  "./assets/app.js?v=20260423-12",
  "./assets/img/logo.webp",
  "./assets/img/capa.png",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Source+Sans+3:wght@400;600&display=swap"
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
    })
  );
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached =
      (await caches.match(request)) ||
      (await caches.match("./editar.html")) ||
      (await caches.match("./index.html"));

    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || fetchPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isSupabaseApiRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});






// Suporte a Notificações Push
self.addEventListener("push", (event) => {
  let data = { title: "Frutamina", body: "Estoque atualizado." };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = { title: "Frutamina", body: event.data.text() };
  }

  const options = {
    body: data.body,
    icon: "./assets/img/icon-192.png",
    badge: "./assets/img/icon-192.png",
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: "1"
    },
    actions: [
      { action: "explore", title: "Ver Estoque", icon: "./assets/img/icon-192.png" },
      { action: "close", title: "Fechar", icon: "./assets/img/icon-192.png" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "explore") {
    event.waitUntil(
      clients.openWindow("./visao-geral.html")
    );
  } else {
    event.waitUntil(
      clients.openWindow("./")
    );
  }
});
