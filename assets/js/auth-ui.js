// Autenticacao e shell da interface (menu, sidebar, tema).
// Import dinamico para modulos especificos de pagina (dashboard, count-mode, catalog-crud):
// este modulo roda em TODAS as paginas, mas essas features nao existem em todas.
import { state, elements, supabaseClient, PAGE_MODE, isRestrictedPageMode } from "./state.js";
import {
  CONFIG_GERAL,
  SESSION_MAX_MS,
  THEME_PREFERENCE_KEY,
  SUPABASE_TIMEOUT_MS,
} from "./config.js";
import { pushMessage, toAuthEmail, displayUserFromEmail } from "./utils.js";
import { renderContext, renderCountTable, renderCountSyncStatus, storeUserLabel } from "./tables.js";
import { restoreCountDraftForCurrentUser } from "./draft.js";
import { restorePendingChanges, forgetPendingChangesInMemory } from "./pending-changes.js";
import { loadUserRecords } from "./supabase-api.js";

function setAuthMessage(type, text) {
  if (!elements.authMsg) return;
  elements.authMsg.innerHTML = "";
  if (!text) return;
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;
  msg.textContent = text;
  elements.authMsg.appendChild(msg);
}

function hideCountPanels() {
  if (elements.countPanel) elements.countPanel.classList.add("hidden");
  if (elements.productsPanel) elements.productsPanel.classList.add("hidden");
}

function hideAuthPanel() {
  if (elements.authPanel) elements.authPanel.classList.add("hidden");
}

export function lockRestrictedAccess(message = "") {
  if (!isRestrictedPageMode()) return;
  document.body.classList.add("auth-locked");
  hideCountPanels();
  showAuthPanel({ scroll: false });
  if (message) {
    setAuthMessage("warn", message);
  }
}

function unlockRestrictedAccess() {
  if (!isRestrictedPageMode()) return;
  document.body.classList.remove("auth-locked");
  setAuthMessage("", "");
}

export function requireAuthenticatedUser(message = "Faça login para continuar.") {
  if (state.user) return true;
  lockRestrictedAccess(message);
  return false;
}

function showAuthPanel(options = {}) {
  const { scroll = true } = options;
  if (elements.authPanel) {
    elements.authPanel.classList.remove("hidden");
    if (scroll) {
      elements.authPanel.scrollIntoView({ behavior: "smooth" });
    }
  }
  if (elements.countPanel) elements.countPanel.classList.add("hidden");
  if (elements.productsPanel) elements.productsPanel.classList.add("hidden");
}

function showCountPanel() {
  if (!requireAuthenticatedUser("Faça login para acessar a edição de estoque.")) {
    return;
  }
  if (elements.authPanel) elements.authPanel.classList.add("hidden");
  if (elements.productsPanel) elements.productsPanel.classList.add("hidden");
  if (elements.countPanel) {
    elements.countPanel.classList.remove("hidden");
    elements.countPanel.scrollIntoView({ behavior: "smooth" });
  }
  setEditSection();
}

// scroll: false no boot. Rolar ate o painel faz sentido quando o usuario clica
// em "Produtos" no menu, mas ao abrir a pagina jogava o cabecalho fora da tela.
function showProductsPanel(options = {}) {
  const { scroll = true } = options;
  if (!requireAuthenticatedUser("Faça login para acessar o cadastro de produtos.")) {
    return;
  }
  if (elements.authPanel) elements.authPanel.classList.add("hidden");
  if (elements.countPanel) elements.countPanel.classList.add("hidden");
  if (elements.productsPanel) {
    elements.productsPanel.classList.remove("hidden");
    if (scroll) elements.productsPanel.scrollIntoView({ behavior: "smooth" });
  }
}

function isSidebarMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

export function setSidebarOpen(open) {
  const shouldOpen = Boolean(open) && isSidebarMobileViewport();
  document.body.classList.toggle("sidebar-open", shouldOpen);
  if (elements.sidebarToggle) {
    elements.sidebarToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    elements.sidebarToggle.setAttribute(
      "aria-label",
      shouldOpen ? "Fechar menu" : "Abrir menu"
    );
  }
}

function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

function getStoredThemePreference() {
  try {
    const storedTheme = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }
  } catch (error) {
    // Ignora falhas de storage (ex.: navegador em modo restrito).
  }
  return "";
}

function getDefaultThemePreference() {
  return "light";
}

function updateThemeToggleButtons(theme) {
  const isDarkTheme = theme === "dark";
  const nextThemeLabel = isDarkTheme ? "Tema claro" : "Tema escuro";
  const nextThemeAriaLabel = `Ativar ${nextThemeLabel.toLowerCase()}`;

  const updateButton = (button, labelNode) => {
    if (!button) return;
    const icon = button.querySelector("i");
    if (icon) {
      icon.classList.remove("bi-sun", "bi-moon-stars");
      icon.classList.add(isDarkTheme ? "bi-sun" : "bi-moon-stars");
    }
    button.title = nextThemeLabel;
    button.setAttribute("aria-label", nextThemeAriaLabel);
    if (labelNode) {
      labelNode.textContent = nextThemeLabel;
    }
  };

  updateButton(elements.themeToggle, elements.themeToggleLabel);
  updateButton(elements.mobileThemeToggle, null);
}

function applyTheme(theme, options = {}) {
  const { persist = true } = options;
  const normalizedTheme = normalizeTheme(theme);
  state.theme = normalizedTheme;
  document.body.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;

  if (elements.themeColorMeta) {
    elements.themeColorMeta.setAttribute(
      "content",
      normalizedTheme === "dark" ? "#020617" : "#f1f5ff"
    );
  }

  updateThemeToggleButtons(normalizedTheme);

  if (persist) {
    try {
      localStorage.setItem(THEME_PREFERENCE_KEY, normalizedTheme);
    } catch (error) {
      // Ignora falhas de storage para nao quebrar a navegacao.
    }
  }
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  if (PAGE_MODE === "dashboard") {
    import("./dashboard.js").then((m) => m.renderDashboard(true));
  }
}

export function setupTheme() {
  const storedTheme = getStoredThemePreference();
  const initialTheme = storedTheme || getDefaultThemePreference();
  applyTheme(initialTheme, { persist: false });

  if (elements.themeToggle) {
    elements.themeToggle.addEventListener("click", toggleTheme);
  }

  if (elements.mobileThemeToggle) {
    elements.mobileThemeToggle.addEventListener("click", toggleTheme);
  }
}

function setEditSection() {
  if (!state.user && isRestrictedPageMode()) {
    lockRestrictedAccess("Faça login para acessar esta área.");
    return;
  }
  renderCountSyncStatus();
}

function getLoginTimestamp() {
  const raw = localStorage.getItem("cd_login_at");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function setLoginTimestamp() {
  localStorage.setItem("cd_login_at", String(Date.now()));
}

function clearLoginTimestamp() {
  localStorage.removeItem("cd_login_at");
}

function isSessionExpired() {
  const timestamp = getLoginTimestamp();
  if (!timestamp) return false;
  return Date.now() - timestamp > SESSION_MAX_MS;
}

export async function enforceSessionLimit() {
  if (isSessionExpired()) {
    await supabaseClient.auth.signOut();
    clearLoginTimestamp();
    setAuthMessage("info", "Sessão expirada. Faça login novamente.");
  }
}

// Sincroniza estado de login da interface com a sessao atual do Supabase.
async function handleAuthState(event, session) {
  state.user = session?.user ?? null;
  if (state.user) {
    if (event === "SIGNED_IN") {
      setLoginTimestamp();
    } else if (!getLoginTimestamp()) {
      setLoginTimestamp();
    }
    storeUserLabel(state.user.id, state.user.email);
    if (isSessionExpired()) {
      await supabaseClient.auth.signOut();
      clearLoginTimestamp();
      setAuthMessage("info", "Sessão expirada. Faça login novamente.");
      return;
    }
    unlockRestrictedAccess();
    if (elements.menuUserEmail) {
      elements.menuUserEmail.textContent = displayUserFromEmail(
        state.user.email
      );
    }
    if (elements.menuUser) elements.menuUser.classList.remove("hidden");
    if (elements.menuLogout) elements.menuLogout.classList.remove("hidden");
    if (PAGE_MODE === "edit") {
      hideAuthPanel();
      if (elements.countPanel) elements.countPanel.classList.remove("hidden");
      renderContext();
      renderCountTable();
      const { updateCountModeUI } = await import("./count-mode.js");
      updateCountModeUI();
      await loadUserRecords();
      await restoreCountDraftForCurrentUser();
      restorePendingChanges();
      setEditSection();
    } else if (PAGE_MODE === "products") {
      hideAuthPanel();
      showProductsPanel({ scroll: false });
      const { renderCatalogTable } = await import("./catalog-crud.js");
      renderCatalogTable();
    } else {
      hideAuthPanel();
      hideCountPanels();
    }
  } else {
    state.previousCountRows = [];
    state.previousPublicRows = [];
    state.lastLaunch = null;
    state.pendingCorrection = null;
    if (event === "SIGNED_OUT") {
      clearLoginTimestamp();
    }
    if (elements.menuUser) elements.menuUser.classList.add("hidden");
    if (elements.menuLogout) elements.menuLogout.classList.add("hidden");
    if (PAGE_MODE === "edit") {
      lockRestrictedAccess("Faça login para acessar a edição de estoque.");
      state.userRows = [];
      state.sessionRows = [];
      forgetPendingChangesInMemory();
      state.countMode = "current";
      state.countDraftSavedAt = null;
      state.countDraftHash = "";
      renderCountTable();
      renderCountSyncStatus();
    } else if (PAGE_MODE === "products") {
      lockRestrictedAccess("Faça login para acessar o cadastro de produtos.");
    } else {
      hideAuthPanel();
      hideCountPanels();
    }
  }
}

// Ponto de entrada da autenticacao: observa mudancas de sessao e carrega a sessao atual.
export function setupAuth() {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    handleAuthState(event, session);
  });
  supabaseClient.auth.getSession().then(({ data }) => {
    handleAuthState("INITIAL_SESSION", data?.session ?? null);
  });
}

// Inicializa os selects base de setor usados no contexto e no modal de edicao.
export function initSetorSelects() {
  const setores = Object.keys(CONFIG_GERAL);
  if (elements.setorSelect) {
    elements.setorSelect.innerHTML = "";
    setores.forEach((setor) => {
      const option = document.createElement("option");
      option.value = setor;
      option.textContent = setor;
      elements.setorSelect.appendChild(option);
    });
    elements.setorSelect.value = state.setor;
  }

  if (elements.editSetor) {
    elements.editSetor.innerHTML = "";
    setores.forEach((setor) => {
      const option = document.createElement("option");
      option.value = setor;
      option.textContent = setor;
      elements.editSetor.appendChild(option);
    });
    elements.editSetor.value = state.setor;
  }

  if (elements.catalogSetor) {
    elements.catalogSetor.innerHTML = "";
    setores
      .slice()
      .sort()
      .forEach((setor) => {
        const option = document.createElement("option");
        option.value = setor;
        option.textContent = setor;
        elements.catalogSetor.appendChild(option);
      });
    elements.catalogSetor.value = state.setor;
  }
}

// Liga os elementos do shell (menu, sidebar, tema ja e feito por setupTheme, login/logout).
export function setupShellEvents() {
  if (elements.menuView) {
    if (elements.menuView.dataset.href) {
      elements.menuView.addEventListener("click", () => {
        window.location.href = elements.menuView.dataset.href;
      });
    } else if (elements.publicPanel) {
      elements.menuView.addEventListener("click", () => {
        elements.publicPanel.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  if (elements.menuDashboard) {
    if (elements.menuDashboard.dataset.href) {
      elements.menuDashboard.addEventListener("click", () => {
        window.location.href = elements.menuDashboard.dataset.href;
      });
    } else if (elements.dashboardPanel) {
      elements.menuDashboard.addEventListener("click", () => {
        elements.dashboardPanel.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  if (elements.menuCount) {
    if (elements.menuCount.dataset.href) {
      elements.menuCount.addEventListener("click", () => {
        window.location.href = elements.menuCount.dataset.href;
      });
    } else {
      elements.menuCount.addEventListener("click", () => {
        if (state.user) {
          showCountPanel();
        } else {
          showAuthPanel();
        }
      });
    }
  }

  if (elements.menuProducts) {
    if (elements.menuProducts.dataset.href) {
      elements.menuProducts.addEventListener("click", () => {
        window.location.href = elements.menuProducts.dataset.href;
      });
    } else {
      elements.menuProducts.addEventListener("click", () => {
        if (state.user) {
          showProductsPanel();
        } else {
          showAuthPanel();
        }
      });
    }
  }

  if (elements.sidebarToggle) {
    elements.sidebarToggle.addEventListener("click", () => {
      setSidebarOpen(!document.body.classList.contains("sidebar-open"));
    });
  }

  if (elements.sidebarOverlay) {
    elements.sidebarOverlay.addEventListener("click", () => {
      setSidebarOpen(false);
    });
  }

  const closeSidebarAfterNavigation = () => {
    if (isSidebarMobileViewport()) {
      setSidebarOpen(false);
    }
  };
  [
    elements.menuView,
    elements.menuDashboard,
    elements.menuCount,
    elements.menuProducts,
    elements.menuLogout,
  ].forEach((button) => {
    if (!button) return;
    button.addEventListener("click", closeSidebarAfterNavigation);
  });
  window.addEventListener("resize", () => {
    if (!isSidebarMobileViewport()) {
      setSidebarOpen(false);
    }
  });

  if (elements.menuLogout) {
    elements.menuLogout.addEventListener("click", async () => {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        setAuthMessage("error", `Erro ao sair: ${error.message}`);
      }
      await handleAuthState("SIGNED_OUT", null);
    });
  }

  if (elements.loginBtn) {
    elements.loginBtn.addEventListener("click", async () => {
      const loginId = elements.email.value.trim();
      const email = toAuthEmail(loginId);
      if (!email) {
        elements.authMsg.textContent = "Informe um usuario ou numero valido.";
        elements.authMsg.className = "msg error";
        return;
      }
      const password = elements.password.value;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        elements.authMsg.textContent = error.message;
        elements.authMsg.className = "msg error";
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setSidebarOpen(false);
    }
  });

  window.addEventListener("online", () => {
    renderCountSyncStatus();
  });

  window.addEventListener("offline", () => {
    renderCountSyncStatus();
  });
}
