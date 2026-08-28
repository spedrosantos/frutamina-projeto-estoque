// Entry point de index.html (estoque publico, somente leitura).
import { state, isRestrictedPageMode } from "./state.js";
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
import {
  buildFilterOptions,
  renderPublicTable,
  setPublicViewMode,
  setupPublicTableEvents,
} from "./tables.js";
import { loadPublicRecords, loadUserLabels } from "./supabase-api.js";

applyCatalogOverridesFromCache();
buildFilterOptions();
renderPublicTable();
setPublicViewMode(state.publicViewMode);
setupTheme();
setupShellEvents();
setupPublicTableEvents({ loadPublicRecords });
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
