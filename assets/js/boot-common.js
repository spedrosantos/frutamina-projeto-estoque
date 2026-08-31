// Fim de boot compartilhado pelas quatro paginas.
//
// Os quatro entry points terminavam com o mesmo bloco de 8 chamadas (tema, shell,
// bloqueio de acesso, sessao, catalogo global). Repetir isso ja tinha custado
// paginas com um passo a menos que as outras; agora o bloco vive aqui e cada
// entry point cuida so do que e proprio dela.
import { isRestrictedPageMode } from "./state.js";
import { refreshCatalogOverrides } from "./catalog-overrides.js";
import {
  setupTheme,
  setupShellEvents,
  setupAuth,
  enforceSessionLimit,
  lockRestrictedAccess,
  setSidebarOpen,
  showNotificationInvite,
} from "./auth-ui.js";
import { loadPublicRecords, loadUserLabels } from "./supabase-api.js";

const SESSION_CHECK_MS = 60 * 1000;
const NOTIFICATION_INVITE_MS = 2000;

/**
 * Roda depois dos renders e dos eventos proprios da pagina.
 */
export function finishBoot() {
  setupTheme();
  setupShellEvents();
  if (isRestrictedPageMode()) {
    lockRestrictedAccess();
  }
  setSidebarOpen(false);
  setupAuth();
  loadPublicRecords();
  loadUserLabels();
  setInterval(enforceSessionLimit, SESSION_CHECK_MS);

  window.addEventListener("load", () => {
    setTimeout(showNotificationInvite, NOTIFICATION_INVITE_MS);
  });

  // Catalogo global vem do Supabase, mas nao pode bloquear o boot: a UI ja subiu
  // com o cache local e so re-renderiza se a rede trouxer algo diferente.
  refreshCatalogOverrides().then((changed) => {
    if (changed) {
      import("./catalog-crud.js").then((m) => m.refreshCatalogDependentUI());
    }
  });
}
