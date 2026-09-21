// Registro do service worker (PWA), antes repetido como <script> inline nas
// quatro paginas. Cada entry point so precisa importar este modulo.
//
// Quem manda recarregar e o proprio worker (ver forcarRecarga em
// service-worker.js), nao esta pagina: o worker e o unico arquivo que o
// navegador sempre busca na rede, entao a ordem alcanca ate o aparelho parado
// numa versao antiga. Aqui so respondemos que assumimos a tarefa, salvamos o
// rascunho e recarregamos - quem nao responde e recarregado a forca de la.

// O recarregamento apaga tudo o que esta na memoria, entao o aviso de
// "atualizou" precisa atravessar a recarga por escrito. sessionStorage e o
// certo aqui: dura o que a aba durar e se limpa sozinho, sem sobrar aviso
// velho para a proxima abertura do app.
const CHAVE_AVISO = "cd_app_atualizado";

let recarregamentoAgendado = false;

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

function mostrarFaixa(texto, { sumirEm = 0 } = {}) {
  document.getElementById("sw-banner")?.remove();
  const faixa = document.createElement("button");
  faixa.id = "sw-banner";
  faixa.className = "sw-banner";
  faixa.type = "button";
  faixa.textContent = texto;
  faixa.addEventListener("click", () => faixa.remove());
  document.body.appendChild(faixa);
  if (sumirEm) setTimeout(() => faixa.remove(), sumirEm);
}

// O rascunho da contagem so vai para o localStorage 120ms depois da ultima
// mudanca (scheduleCountDraftPersist em data/draft.js). Gravar agora fecha a
// fresta em que a recarga levaria o ultimo lancamento junto.
async function salvarRascunho() {
  try {
    const { saveCountDraftLocally } = await import("../data/draft.js");
    saveCountDraftLocally();
  } catch (error) {
    console.warn("Nao foi possivel salvar o rascunho antes de atualizar.", error);
  }
}

function marcarAtualizacao() {
  try {
    sessionStorage.setItem(CHAVE_AVISO, "1");
  } catch (error) {
    // Sem o aviso a atualizacao acontece do mesmo jeito.
    console.warn("Nao foi possivel marcar a atualizacao.", error);
  }
}

async function aplicarVersaoNova() {
  if (recarregamentoAgendado) return;
  recarregamentoAgendado = true;
  await salvarRascunho();
  marcarAtualizacao();
  window.location.reload();
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
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.tipo !== "recarregar") return;
    // Responder ANTES de recarregar: e o que avisa ao worker que esta janela se
    // vira sozinha, para ele nao navegar por cima e causar duas recargas.
    event.ports?.[0]?.postMessage({ assumido: true });
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
