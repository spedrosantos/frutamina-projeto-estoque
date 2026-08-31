// Entry point de visao-geral.html (dashboard: total do CD, saida de caixas, overview).
// Primeiro import de proposito: monta o shell (sidebar/topbar) antes de state.js
// resolver os elementos.
import "./app-shell.js";
import "./register-sw.js";
import { PAGE_MODE } from "./state.js";
import { applyCatalogOverridesFromCache } from "./catalog-overrides.js";
import { finishBoot } from "./boot-common.js";
import { renderDashboard } from "./dashboard.js";
import { loadSnapshotRecords } from "./supabase-api.js";

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
renderDashboard();
setupOverviewTabs();
if (PAGE_MODE === "dashboard") {
  loadSnapshotRecords();
}
finishBoot();

window.addEventListener("resize", () => {
  renderDashboard();
});
