// Registro do service worker (PWA), antes repetido como <script> inline nas
// quatro paginas. Cada entry point so precisa importar este modulo.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((error) => console.warn("Falha ao registrar o service worker.", error));
  });
}
