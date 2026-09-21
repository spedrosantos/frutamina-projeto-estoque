// Barra fina de progresso no topo, para o operador saber que o app esta
// falando com o banco.
//
// Toda consulta passa por withTimeout (core/utils.js), que conta as chamadas em
// voo e dispara "cd:carregando". Escutar um evento so evita espalhar
// show()/hide() pelos 22 pontos de consulta e nao esquecer nenhum.
const ATRASO_MS = 180;
const SUMICO_MS = 200;

let barra = null;
let aparecerEm = 0;

function criar() {
  if (barra) return barra;
  barra = document.createElement("div");
  barra.className = "load-bar";
  barra.setAttribute("role", "status");
  barra.setAttribute("aria-label", "Carregando");
  document.body.appendChild(barra);
  return barra;
}

function mostrar() {
  // Consulta rapida nao pisca a barra: so aparece se demorar mais que ATRASO_MS.
  if (aparecerEm) return;
  aparecerEm = setTimeout(() => criar().classList.add("is-on"), ATRASO_MS);
}

function esconder() {
  clearTimeout(aparecerEm);
  aparecerEm = 0;
  if (!barra) return;
  const alvo = barra;
  alvo.classList.remove("is-on");
  // Remove depois da transicao para nao deixar um elemento morto por pagina.
  setTimeout(() => {
    if (!alvo.classList.contains("is-on")) alvo.remove();
    if (barra === alvo) barra = null;
  }, SUMICO_MS);
}

// So as tabelas que estao sem linha nenhuma precisam ser redesenhadas quando o
// carregamento comeca ou termina: e nelas que a linha "Carregando dados..."
// aparece ou da lugar ao conteudo. Redesenhar tabela ja preenchida a cada
// consulta seria trabalho a toa no meio de uma gravacao.
function tabelaVazia(id) {
  const corpo = document.getElementById(id);
  return corpo && !corpo.querySelector("tr:not(.table-state-row)");
}

function atualizarEstadoDasTabelas() {
  if (!tabelaVazia("public-table-body") && !tabelaVazia("count-table-body")) return;
  import("../features/tables.js").then((m) => {
    m.renderPublicTable();
    m.renderCountTable();
  });
}

export function setupLoadingBar() {
  document.addEventListener("cd:carregando", (event) => {
    if (event.detail?.ativo) mostrar();
    else esconder();
    atualizarEstadoDasTabelas();
  });
}
