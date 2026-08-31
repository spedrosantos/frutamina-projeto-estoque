// Entry point de produtos.html (cadastro/CRUD do catalogo de produtos).
// Primeiro import de proposito: monta a tela de login antes de state.js resolver
// os elementos do formulario.
import "./auth-panel.js";
import { isRestrictedPageMode } from "./state.js";
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
import { buildFilterOptions, renderContext, renderPublicTable, renderCountTable } from "./tables.js";
import { initCatalogForm, setupCatalogEvents } from "./catalog-crud.js";
import { loadPublicRecords, loadUserLabels } from "./supabase-api.js";

applyCatalogOverridesFromCache();
initSetorSelects();
initCatalogForm();
buildFilterOptions();
renderContext();
renderPublicTable();
renderCountTable();
setupTheme();
setupShellEvents();
setupCatalogEvents();
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
