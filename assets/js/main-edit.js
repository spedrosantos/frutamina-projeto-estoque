// Entry point de editar.html (voz, formulario manual, edicao, nova contagem offline).
// Primeiro import de proposito: monta a tela de login antes de state.js resolver
// os elementos do formulario.
import "./auth-panel.js";
import { state, isRestrictedPageMode } from "./state.js";
import {
  applyCatalogOverridesFromCache,
  refreshCatalogOverrides,
} from "./catalog-overrides.js";
import {
  initSetorSelects,
  setupTheme,
  setupShellEvents,
  setupAuth,
  enforceSessionLimit,
  lockRestrictedAccess,
  setSidebarOpen,
  showNotificationInvite,
} from "./auth-ui.js";
import {
  buildFilterOptions,
  renderContext,
  renderPublicTable,
  renderCountTable,
  setPublicViewMode,
  setCountViewMode,
  setCountSource,
  setupCountTableEvents,
} from "./tables.js";
import { setupCommandEvents } from "./voice-actions.js";
import { setupVoice } from "./voice-speech.js";
import { initManualForm, setupManualFormEvents } from "./manual-form.js";
import { setupCountModeEvents, updateCountModeUI, saveNewCount } from "./count-mode.js";
import { loadPublicRecords, loadUserLabels } from "./supabase-api.js";
import { enhanceSelect } from "./select-menu.js";
import { confirmAction } from "./confirm-modal.js";
import {
  applyPendingChanges,
  hasPendingChanges,
  renderPendingChanges,
} from "./pending-changes.js";

// Abas da area de contagem: "Contagem" (voz + comando manual) e "Conferencia"
// (tabela dos itens lancados). O toggle Estoque atual / Nova contagem fica acima
// porque diz *qual dado* esta sendo editado, nao o que se esta fazendo.
function setupEditTabs() {
  const tabs = document.getElementById("count-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".edit-tab");
    if (!button) return;
    tabs.querySelectorAll(".edit-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.toggle("hidden", !active);
    });
  });
}

// Salvar o que foi lancado no modo "Estoque atual". No modo "Nova contagem"
// quem grava continua sendo o botao da propria aba Contagem.
function setupPendingActions() {
  document.getElementById("count-save-btn")?.addEventListener("click", async () => {
    if (state.countMode === "new") {
      saveNewCount();
      return;
    }
    if (!hasPendingChanges()) return;
    const confirmed = await confirmAction({
      title: "Salvar contagem",
      message: "Os lançamentos desta contagem entram no estoque agora.",
      confirmLabel: "Salvar",
    });
    if (confirmed) applyPendingChanges();
  });

  // Rede de seguranca: a contagem fica no aparelho, mas o aviso evita que
  // alguem feche a aba achando que ja gravou.
  window.addEventListener("beforeunload", (event) => {
    if (!hasPendingChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

applyCatalogOverridesFromCache();
initSetorSelects();
initManualForm();
buildFilterOptions();
renderContext();
renderPublicTable();
renderCountTable();
setPublicViewMode(state.publicViewMode);
setCountViewMode(state.countViewMode);
setCountSource(state.countSource);
updateCountModeUI();
setupEditTabs();
setupPendingActions();
renderPendingChanges();
// Os selects do Comando Manual usam o mesmo dropdown da aba Tendencia; o
// <select> original segue como fonte da verdade, entao manual-form.js nao muda.
["count-mode-select", "count-source-select", "manual-setor", "manual-produto", "manual-marca", "manual-tipo", "manual-pallets"].forEach(
  (id) => enhanceSelect(document.getElementById(id))
);
setupTheme();
setupVoice();
setupShellEvents();
setupCountTableEvents();
setupCommandEvents();
setupManualFormEvents();
setupCountModeEvents();
if (isRestrictedPageMode()) {
  lockRestrictedAccess();
}
setSidebarOpen(false);
setupAuth();
loadPublicRecords();
loadUserLabels();
setInterval(enforceSessionLimit, 60 * 1000);

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
