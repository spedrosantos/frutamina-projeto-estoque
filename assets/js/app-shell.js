// Sidebar e topbar mobile, uma vez para todo o app.
//
// O markup era repetido nas quatro paginas e so mudava em duas coisas: qual item
// da navegacao estava ativo e o data-href correspondente. Isso ja tinha custado
// acentos quebrados no index e um item ativo errado; agora o menu vive aqui e o
// item ativo sai do data-page do <body>.
//
// Nao exporta nada de proposito: roda como efeito de import e precisa ser um dos
// PRIMEIROS imports do entry point da pagina - state.js resolve os elementos do
// shell (sidebar, toggles, botoes do menu) no momento em que e avaliado.

const NAV_ITEMS = [
  { id: "menu-view", page: "view", href: "index.html", icon: "bi-box-seam", label: "Estoque" },
  {
    id: "menu-dashboard",
    page: "dashboard",
    href: "visao-geral.html",
    icon: "bi-bar-chart-line",
    label: "Visão geral",
  },
  {
    id: "menu-count",
    page: "edit",
    href: "editar.html",
    icon: "bi-pencil-square",
    label: "Editar estoque",
  },
  { id: "menu-products", page: "products", href: "produtos.html", icon: "bi-boxes", label: "Produtos" },
];

function buildNav(currentPage) {
  return NAV_ITEMS.map((item) => {
    const isCurrent = item.page === currentPage;
    // A pagina atual nao leva data-href: o clique nela nao deve recarregar.
    return `
        <button
          id="${item.id}"
          class="${isCurrent ? "primary" : "ghost"}"
          type="button"
          ${isCurrent ? 'aria-current="page"' : `data-href="${item.href}"`}
        >
          <i class="bi ${item.icon}"></i>
          <span class="sidebar-label">${item.label}</span>
        </button>`;
  }).join("");
}

function buildSidebar(currentPage) {
  const sidebar = document.createElement("aside");
  sidebar.id = "app-sidebar";
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Navegação principal");
  sidebar.innerHTML = `
      <div class="sidebar-top">
        <img src="assets/img/logo.webp" alt="Frutamina" class="sidebar-logo" />
      </div>
      <nav class="sidebar-nav">${buildNav(currentPage)}
      </nav>
      <div class="sidebar-footer">
        <button
          id="theme-toggle"
          class="ghost theme-toggle"
          type="button"
          aria-label="Ativar tema escuro"
          title="Tema escuro"
        >
          <i class="bi bi-moon-stars"></i>
          <span id="theme-toggle-label" class="sidebar-label">Tema escuro</span>
        </button>
        <div id="menu-user" class="user-chip hidden">
          <span>Usuario</span>
          <strong id="menu-user-email">--</strong>
        </div>
        <button id="menu-logout" class="ghost hidden" type="button">
          <i class="bi bi-box-arrow-right"></i>
          <span class="sidebar-label">Sair</span>
        </button>
      </div>`;

  const overlay = document.createElement("div");
  overlay.id = "sidebar-overlay";
  overlay.className = "sidebar-overlay";
  overlay.setAttribute("aria-hidden", "true");

  return [sidebar, overlay];
}

function buildTopbar() {
  const topbar = document.createElement("header");
  topbar.className = "mobile-topbar";
  topbar.innerHTML = `
        <img src="assets/img/logo.webp" alt="Frutamina" class="mobile-topbar-logo" />
        <div class="mobile-topbar-actions">
          <button
            id="mobile-theme-toggle"
            class="sidebar-toggle"
            type="button"
            aria-label="Ativar tema escuro"
            title="Tema escuro"
          >
            <i class="bi bi-moon-stars"></i>
          </button>
          <button
            id="sidebar-toggle"
            class="sidebar-toggle"
            type="button"
            aria-label="Abrir menu"
            aria-expanded="false"
          >
            <i class="bi bi-list"></i>
          </button>
        </div>`;
  return topbar;
}

function mountAppShell() {
  if (document.getElementById("app-sidebar")) return;
  const app = document.querySelector(".app");
  if (!app) return;
  const currentPage = document.body.dataset.page || "";
  document.body.prepend(...buildSidebar(currentPage));
  app.prepend(buildTopbar());
}

mountAppShell();
