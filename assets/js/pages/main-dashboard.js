// Entry point de visao-geral.html (dashboard: total do CD, saida de caixas, overview).
// Primeiro import de proposito: monta o shell (sidebar/topbar) antes de state.js
// resolver os elementos.
import "../shell/app-shell.js";
import "../shell/register-sw.js";
import { PAGE_MODE } from "../core/state.js";
import { applyCatalogOverridesFromCache } from "../data/catalog-overrides.js";
import { finishBoot } from "../shell/boot-common.js";
import { renderDashboard } from "../features/dashboard.js";
import { loadSnapshotRecords } from "../data/supabase-api.js";

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
      document
        .getElementById(tab.dataset.tab ? `tab-${tab.dataset.tab}` : "")
        ?.classList.toggle("hidden", !active);
    });

    if (button.dataset.tab === "tendencia" && !historicoIniciado) {
      historicoIniciado = true;
      import("../features/historico-produto.js").then((m) => m.setupHistoricoProduto());
    }
  });
}

applyCatalogOverridesFromCache();
renderDashboard();
setupOverviewTabs();
if (PAGE_MODE === "dashboard") {
  loadSnapshotRecords();
}
finishBoot();

window.addEventListener("resize", () => {
  renderDashboard();
});
