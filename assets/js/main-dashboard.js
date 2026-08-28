// Entry point de visao-geral.html (dashboard: total do CD, saida de caixas, overview).
import { PAGE_MODE, isRestrictedPageMode } from "./state.js";
import {
  applyCatalogOverridesFromCache,
  refreshCatalogOverrides,
} from "./catalog-overrides.js";
import {
  setupTheme,
  setupShellEvents,
  setupAuth,
  enforceSessionLimit,
  lockRestrictedAccess,
  setSidebarOpen,
  showNotificationInvite,
} from "./auth-ui.js";
import { renderDashboard } from "./dashboard.js";
import { loadPublicRecords, loadSnapshotRecords, loadUserLabels } from "./supabase-api.js";

// Abas da Visao Geral: "Agora" (foto do estoque), "Movimento" (contagens) e
// "Tendencia" (sazonalidade). O grafico so e montado quando a aba abre, porque
// canvas escondido nao tem largura para medir e o boot fica mais leve.
let historicoIniciado = false;

function setupOverviewTabs() {
  const tabs = document.getElementById("overview-tabs");
  if (!tabs) return;

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".overview-tab");
    if (!button) return;

    tabs.querySelectorAll(".overview-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      document.getElementById(tab.dataset.tab ? `tab-${tab.dataset.tab}` : "")?.classList.toggle("hidden", !active);
    });

    if (button.dataset.tab === "tendencia" && !historicoIniciado) {
      historicoIniciado = true;
      import("./historico-produto.js").then((m) => m.setupHistoricoProduto());
    }
  });
}

applyCatalogOverridesFromCache();
setupTheme();
setupShellEvents();
if (isRestrictedPageMode()) {
  lockRestrictedAccess();
}
setSidebarOpen(false);
renderDashboard();
setupOverviewTabs();
setupAuth();
loadPublicRecords();
loadUserLabels();
if (PAGE_MODE === "dashboard") {
  loadSnapshotRecords();
}
setInterval(enforceSessionLimit, 60 * 1000);

window.addEventListener("resize", () => {
  renderDashboard();
});

window.addEventListener("load", () => {
  setTimeout(showNotificationInvite, 2000);
});

// Catalogo global vem do Supabase, mas nao pode bloquear o boot: a UI ja subiu
// com o cache local acima e so re-renderiza se a rede trouxer algo diferente.
refreshCatalogOverrides().then((changed) => {
  if (changed) {
    import("./catalog-crud.js").then((m) => m.refreshCatalogDependentUI());
  }
});
