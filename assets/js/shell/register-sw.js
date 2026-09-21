// Registro do service worker (PWA), antes repetido como <script> inline nas
// quatro paginas. Cada entry point so precisa importar este modulo.
//
// O worker novo entra sozinho (skipWaiting + clients.claim no service-worker.js),
// mas a tela que ja esta na frente do operador continua com os arquivos velhos
// que ela mesma pintou. Sem o recarregamento abaixo, a versao nova so aparecia
// na segunda abertura do app - e no meio do caminho dava para ficar com o CSS
// de uma versao e o JS de outra, que ja aconteceu aqui.

// Havia controlador antes? Na primeira visita de todas o controllerchange
// tambem dispara, e recarregar ali seria um refresh a toa logo na abertura.
const jaTinhaControlador =
  "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);

let recarregamentoAgendado = false;

async function temContagemEmAndamento() {
  try {
    const [{ hasPendingChanges }, { state }] = await Promise.all([
      import("../data/pending-changes.js"),
      import("../core/state.js"),
    ]);
    return hasPendingChanges() || Boolean(state.sessionRows?.length);
  } catch (error) {
    // Na duvida, trata como se houvesse contagem: perguntar e menos pior do que
    // recarregar por cima de quem esta lancando.
    console.warn("Nao foi possivel checar a contagem pendente.", error);
    return true;
  }
}

function avisarVersaoNova() {
  if (document.getElementById("sw-update-banner")) return;
  const banner = document.createElement("button");
  banner.id = "sw-update-banner";
  banner.type = "button";
  banner.textContent = "Nova versão disponível — tocar para atualizar";
  banner.addEventListener("click", () => window.location.reload());
  document.body.appendChild(banner);
}

async function aplicarVersaoNova() {
  if (recarregamentoAgendado) return;
  recarregamentoAgendado = true;
  // Recarregar por cima de uma contagem nao perde dado (o rascunho fica no
  // localStorage), mas corta quem esta ditando por voz. Nesse caso quem decide
  // a hora e o operador.
  if (await temContagemEmAndamento()) {
    avisarVersaoNova();
    return;
  }
  window.location.reload();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!jaTinhaControlador) return;
    aplicarVersaoNova();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((error) => console.warn("Falha ao registrar o service worker.", error));
  });
}
