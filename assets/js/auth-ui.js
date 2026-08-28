// Autenticacao, shell da interface (menu/sidebar/tema) e notificacoes push.
// Import dinamico para modulos especificos de pagina (dashboard, count-mode, catalog-crud):
// este modulo roda em TODAS as paginas, mas essas features nao existem em todas.
import { state, elements, supabaseClient, PAGE_MODE, isRestrictedPageMode } from "./state.js";
import {
  CONFIG_GERAL,
  SESSION_MAX_MS,
  THEME_PREFERENCE_KEY,
  SUPABASE_TIMEOUT_MS,
  NOTIFICATION_INVITE_DISMISSED_AT_KEY,
  NOTIFICATION_INVITE_SNOOZE_MS,
} from "./config.js";
import { pushMessage, toAuthEmail, displayUserFromEmail, withTimeout } from "./utils.js";
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

function showProductsPanel() {
  if (!requireAuthenticatedUser("Faça login para acessar o cadastro de produtos.")) {
    return;
  }
  if (elements.authPanel) elements.authPanel.classList.add("hidden");
  if (elements.countPanel) elements.countPanel.classList.add("hidden");
  if (elements.productsPanel) {
    elements.productsPanel.classList.remove("hidden");
    elements.productsPanel.scrollIntoView({ behavior: "smooth" });
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
      showProductsPanel();
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
      import("./tables.js").then((m) => {
        m.closeExportSheet("public");
        m.closeExportSheet("count");
      });
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

// ===== Notificacoes push =====

async function savePushSubscription(subscription) {
  if (!state.user) return;

  try {
    const { error } = await withTimeout(
      supabaseClient
        .from("push_subscriptions")
        .upsert({
          user_id: state.user.id,
          subscription: subscription,
        }, { onConflict: "user_id,subscription" }),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao salvar assinatura de push."
    );

    if (error) throw error;
    console.log("Assinatura de push salva no Supabase.");
  } catch (error) {
    console.error("Erro ao salvar assinatura de push:", error);
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    console.warn("Este navegador não suporta notificações push.");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const registration = await navigator.serviceWorker.ready;

      const VAPID_PUBLIC_KEY = "BAjzR0T971QRQTTcQxMMt4QmJcpBPZpRLWMRDiqAPgD2Jvs2dvfEkrz217PgqfLK2dOVmea-718DAv95d-7_MS0";

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY,
      });

      await savePushSubscription(subscription);

      pushMessage("success", "Notificações ativadas com sucesso!");
    }
  } catch (error) {
    console.error("Erro ao solicitar permissão de notificação:", error);
  }
}

/**
 * Cria e exibe um convite amigável para ativar notificações,
 * garantindo a interação do usuário exigida pelos navegadores.
 */
function isNotificationInviteSnoozed() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_INVITE_DISMISSED_AT_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < NOTIFICATION_INVITE_SNOOZE_MS;
  } catch (error) {
    console.warn("Nao foi possivel ler a dispensa do convite de notificacoes.", error);
    return false;
  }
}

function snoozeNotificationInvite() {
  try {
    localStorage.setItem(NOTIFICATION_INVITE_DISMISSED_AT_KEY, String(Date.now()));
  } catch (error) {
    console.warn("Nao foi possivel salvar a dispensa do convite de notificacoes.", error);
  }
}

export function showNotificationInvite() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }
  if (isNotificationInviteSnoozed()) return;
  if (document.getElementById("notification-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "notification-overlay";
  overlay.style = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const invite = document.createElement("div");
  invite.id = "notification-invite";
  invite.style = `
    background: var(--card-bg, #fff);
    color: var(--text-main, #333);
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.3);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 16px;
    width: 90%;
    max-width: 350px;
    border: 1px solid var(--border-color, #eee);
    animation: modalPop 0.3s ease-out;
  `;

  const styleSheet = document.createElement("style");
  styleSheet.innerText = `
    @keyframes modalPop {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(styleSheet);

  invite.innerHTML = `
    <div style="background: var(--primary-color, #007bff); color: #fff; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 8px;">
      <i class="bi bi-bell-fill"></i>
    </div>
    <div>
      <strong style="display: block; font-size: 20px; margin-bottom: 8px;">Ativar Notificações?</strong>
      <p style="font-size: 15px; opacity: 0.9; line-height: 1.4; margin: 0;">
        Fique por dentro! Receba avisos em tempo real toda vez que o estoque do CD for atualizado.
      </p>
    </div>
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 8px;">
      <button id="notif-allow" style="background: var(--primary-color, #007bff); color: #fff; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600; width: 100%;">Sim, quero ativar</button>
      <button id="notif-test" style="background: #28a745; color: #fff; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; width: 100%;">Enviar Teste Agora</button>
      <button id="notif-ignore" style="background: none; border: none; padding: 8px; cursor: pointer; font-size: 14px; color: var(--text-muted, #666); width: 100%;">Agora não</button>
    </div>
  `;

  overlay.appendChild(invite);
  document.body.appendChild(overlay);

  const closeAll = () => {
    overlay.remove();
    styleSheet.remove();
    snoozeNotificationInvite();
  };

  document.getElementById("notif-ignore").onclick = closeAll;
  document.getElementById("notif-allow").onclick = async () => {
    closeAll();
    await requestNotificationPermission();
  };

  document.getElementById("notif-test").onclick = async () => {
    if (Notification.permission !== "granted") {
      await requestNotificationPermission();
    }
    if (Notification.permission === "granted") {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification("Teste de Conexão", {
        body: "Se você está vendo isso, as notificações locais estão funcionando!",
        icon: "./assets/img/icon-192.png",
        vibrate: [200, 100, 200],
      });
      pushMessage("success", "Notificação de teste enviada!");
    } else {
      pushMessage("error", "Permissão de notificação negada pelo navegador.");
    }
  };
}
