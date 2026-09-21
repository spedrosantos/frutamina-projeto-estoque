// Fim de boot compartilhado pelas quatro paginas.
//
// Os quatro entry points terminavam com o mesmo bloco de 8 chamadas (tema, shell,
// bloqueio de acesso, sessao, catalogo global). Repetir isso ja tinha custado
// paginas com um passo a menos que as outras; agora o bloco vive aqui e cada
// entry point cuida so do que e proprio dela.
import { PAGE_MODE, isRestrictedPageMode } from "../core/state.js";
import { refreshCatalogOverrides } from "../data/catalog-overrides.js";
import {
  setupTheme,
  setupShellEvents,
  setupAuth,
  enforceSessionLimit,
  lockRestrictedAccess,
  setSidebarOpen,
} from "./auth-ui.js";
import { loadPublicRecords, loadUserLabels } from "../data/supabase-api.js";
import { setupLoadingBar } from "./loading-bar.js";

const SESSION_CHECK_MS = 60 * 1000;

/**
 * Roda depois dos renders e dos eventos proprios da pagina.
 */
export function finishBoot() {
  setupLoadingBar();
  setupTheme();
  setupShellEvents();
  if (isRestrictedPageMode()) {
    lockRestrictedAccess();
  }
  setSidebarOpen(false);
  setupAuth();
  // A tela de Produtos mexe so no catalogo: nao le state.publicRows em lugar
  // nenhum e nao tem tabela para renderizar. Puxar a tabela de estoque inteira
  // no boot dela era uma consulta jogada fora a cada abertura.
  if (PAGE_MODE !== "products") loadPublicRecords();

  // Os nomes dos operadores chegam depois do primeiro render. Sem re-renderizar
  // aqui, quem abriu a tela antes da resposta fica vendo "usuario 02d6871d" ate
  // o proximo render. Cada render abaixo so age na pagina que e dele.
  loadUserLabels().then((changed) => {
    if (!changed) return;
    if (PAGE_MODE === "dashboard") {
      import("../features/dashboard.js").then((m) => m.renderDashboard());
      return;
    }
    import("../features/tables.js").then((m) => {
      m.renderPublicTable();
      m.renderCountTable();
    });
  });
  setInterval(enforceSessionLimit, SESSION_CHECK_MS);

  // Catalogo global vem do Supabase, mas nao pode bloquear o boot: a UI ja subiu
  // com o cache local e so re-renderiza se a rede trouxer algo diferente.
  refreshCatalogOverrides().then((changed) => {
    if (changed) {
      import("../features/catalog-crud.js").then((m) => m.refreshCatalogDependentUI());
    }
  });
}
