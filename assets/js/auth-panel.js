// Tela de login, uma so para todo o app.
//
// Antes cada pagina repetia o markup do formulario (e a de produtos tinha uma
// versao mais simples, que destoava). Agora o HTML declara apenas o container
// vazio e este modulo o preenche - qualquer pagina nova ganha a mesma tela so
// colocando <section id="auth-panel" class="card auth-card" data-auth-panel>.
//
// Nao exporta nada de proposito: roda como efeito de import e precisa ser o
// PRIMEIRO import do entry point da pagina - state.js resolve os elementos
// (email, password, login-btn, auth-msg) no momento em que e avaliado, entao o
// markup ja tem que estar no DOM.

const DEFAULT_TITLE = "Acesso restrito";
const DEFAULT_SUBTITLE = "Entre com seu usuario do CD para continuar.";

function buildPanelMarkup({ title, subtitle }) {
  return `
    <div class="auth-badge"><i class="bi bi-shield-lock"></i></div>
    <div class="card-header">
      <h2>${title}</h2>
      <p>${subtitle}</p>
    </div>
    <div class="form-grid auth-form">
      <label for="email">Usuario</label>
      <div class="auth-field">
        <i class="bi bi-person" aria-hidden="true"></i>
        <input id="email" type="text" placeholder="Ex: 1234 ou JOAO" autocomplete="username" />
      </div>
      <label for="password">Senha</label>
      <div class="auth-field">
        <i class="bi bi-key" aria-hidden="true"></i>
        <input id="password" type="password" placeholder="Senha" autocomplete="current-password" />
      </div>
    </div>
    <div class="actions">
      <button id="login-btn" class="primary" type="button">
        <i class="bi bi-box-arrow-in-right"></i><span>Entrar</span>
      </button>
    </div>
    <div id="auth-msg" class="msg-area"></div>`;
}

function mountAuthPanel() {
  const panel = document.querySelector("[data-auth-panel]");
  // Sem container (ou ja preenchido por uma chamada anterior) nao ha o que fazer.
  if (!panel || panel.dataset.authMounted === "1") return panel;
  panel.dataset.authMounted = "1";
  panel.innerHTML = buildPanelMarkup({
    title: panel.dataset.authTitle || DEFAULT_TITLE,
    subtitle: panel.dataset.authSubtitle || DEFAULT_SUBTITLE,
  });
  return panel;
}

mountAuthPanel();
