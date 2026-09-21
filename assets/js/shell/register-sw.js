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

// O recarregamento apaga tudo o que esta na memoria, entao o aviso de "atualizou"
// precisa atravessar a recarga por escrito. sessionStorage e o certo aqui: dura
// o que a aba durar e se limpa sozinho, sem sobrar aviso velho para a proxima
// abertura do app.
const CHAVE_AVISO = "cd_app_atualizado";

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

// A versao mora num lugar so - a constante STATIC_CACHE do service-worker.js,
// que o hook de pre-commit sobe a cada deploy. Ler do nome do cache evita uma
// segunda copia do numero em algum arquivo, que envelheceria sozinha.
async function versaoDoCache() {
  if (!("caches" in window)) return "";
  try {
    const versoes = (await caches.keys())
      .map((nome) => /^frutamina-static-v(\d+)$/.exec(nome)?.[1])
      .filter(Boolean)
      .map(Number);
    return versoes.length ? `v${Math.max(...versoes)}` : "";
  } catch (error) {
    // Sem versao na tela o app funciona igual; nao vale derrubar o boot.
    console.warn("Nao foi possivel ler a versao do cache.", error);
    return "";
  }
}

async function mostrarVersao() {
  const alvo = document.getElementById("app-version");
  if (!alvo) return;
  const versao = await versaoDoCache();
  if (versao) alvo.textContent = versao;
}

// Faixa unica para os dois recados. Com acao vira botao e fica na tela ate o
// operador tocar; sem acao ela some sozinha, porque so informa.
function mostrarFaixa(texto, { acao, sumirEm = 0 } = {}) {
  document.getElementById("sw-banner")?.remove();
  const faixa = document.createElement("button");
  faixa.id = "sw-banner";
  faixa.className = acao ? "sw-banner" : "sw-banner is-info";
  faixa.type = "button";
  faixa.textContent = texto;
  faixa.addEventListener("click", () => (acao ? acao() : faixa.remove()));
  document.body.appendChild(faixa);
  if (sumirEm) setTimeout(() => faixa.remove(), sumirEm);
}

async function aplicarVersaoNova() {
  if (recarregamentoAgendado) return;
  recarregamentoAgendado = true;
  // Recarregar por cima de uma contagem nao perde dado (o rascunho fica no
  // localStorage), mas corta quem esta ditando por voz. Nesse caso quem decide
  // a hora e o operador.
  if (await temContagemEmAndamento()) {
    mostrarFaixa("Nova versão disponível — tocar para atualizar", {
      acao: () => {
        marcarAtualizacao();
        window.location.reload();
      },
    });
    return;
  }
  marcarAtualizacao();
  window.location.reload();
}

function marcarAtualizacao() {
  try {
    sessionStorage.setItem(CHAVE_AVISO, "1");
  } catch (error) {
    // Sem o aviso a atualizacao acontece do mesmo jeito.
    console.warn("Nao foi possivel marcar a atualizacao.", error);
  }
}

// Depois da recarga: conta ao operador por que a tela piscou.
async function avisarSeAtualizou() {
  let atualizou = false;
  try {
    atualizou = sessionStorage.getItem(CHAVE_AVISO) === "1";
    if (atualizou) sessionStorage.removeItem(CHAVE_AVISO);
  } catch (error) {
    console.warn("Nao foi possivel ler a marca de atualizacao.", error);
  }
  if (!atualizou) return;
  const versao = await versaoDoCache();
  mostrarFaixa(versao ? `App atualizado para ${versao}` : "App atualizado", {
    sumirEm: 6000,
  });
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
    // Depois do ready: no primeiro acesso o cache ainda nem existe na hora do
    // register.
    navigator.serviceWorker.ready
      .then(() => Promise.all([mostrarVersao(), avisarSeAtualizou()]))
      .catch(() => {});
  });
}
