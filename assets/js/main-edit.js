// Entry point de editar.html (voz, formulario manual, edicao, nova contagem offline).
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
  setupCountTableEvents,
} from "./tables.js";
import { setupCommandEvents } from "./voice-actions.js";
import { setupVoice } from "./voice-speech.js";
import { initManualForm, setupManualFormEvents } from "./manual-form.js";
import { setupCountModeEvents, updateCountModeUI } from "./count-mode.js";
import { loadPublicRecords, loadUserLabels } from "./supabase-api.js";
import { enhanceSelect } from "./select-menu.js";

applyCatalogOverridesFromCache();
initSetorSelects();
initManualForm();
buildFilterOptions();
renderContext();
renderPublicTable();
renderCountTable();
setPublicViewMode(state.publicViewMode);
setCountViewMode(state.countViewMode);
updateCountModeUI();
// Os selects do Comando Manual usam o mesmo dropdown da aba Tendencia; o
// <select> original segue como fonte da verdade, entao manual-form.js nao muda.
["manual-setor", "manual-produto", "manual-marca", "manual-tipo", "manual-pallets"].forEach(
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
