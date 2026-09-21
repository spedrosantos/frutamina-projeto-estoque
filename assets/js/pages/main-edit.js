// Entry point de editar.html (voz, formulario manual, edicao, nova contagem offline).
// Primeiros imports de proposito: montam o shell (sidebar/topbar) e a tela de
// login antes de state.js resolver os elementos.
import "../shell/app-shell.js";
import "../shell/modal-shell.js";
import "../shell/auth-panel.js";
import "../shell/register-sw.js";
import { state } from "../core/state.js";
import { comCarregando } from "../core/utils.js";
import { applyCatalogOverridesFromCache } from "../data/catalog-overrides.js";
import { finishBoot } from "../shell/boot-common.js";
import { initSetorSelects } from "../shell/auth-ui.js";
import {
  buildFilterOptions,
  renderContext,
  renderPublicTable,
  renderCountTable,
  setPublicViewMode,
  setCountViewMode,
  setCountSource,
  setupCountTableEvents,
} from "../features/tables.js";
import { setupVoice } from "../features/voice-speech.js";
import { initManualForm, setupManualFormEvents } from "../features/manual-form.js";
import { setupCountModeEvents, updateCountModeUI, saveNewCount } from "../features/count-mode.js";
import { enhanceSelect } from "../shell/select-menu.js";
import { confirmAction } from "../shell/confirm-modal.js";
import {
  applyPendingChanges,
  hasPendingChanges,
  renderPendingChanges,
} from "../data/pending-changes.js";

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

    // Quem sai da Contagem com lancamento pendente vai para "Revisar e salvar"
    // justamente para ver o que acabou de contar: a tabela abre em "Meus
    // lancamentos", nao no que ja estava gravado.
    if (button.dataset.tab === "conferencia" && hasPendingChanges()) {
      setCountSource("contagem");
    }
  });
}

// Salvar o que foi lancado no modo "Estoque atual". No modo "Nova contagem"
// quem grava continua sendo o botao da propria aba Contagem.
function setupPendingActions() {
  const botaoSalvar = document.getElementById("count-save-btn");
  botaoSalvar?.addEventListener("click", async () => {
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
    if (confirmed) await comCarregando(botaoSalvar, () => applyPendingChanges());
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
[
  "count-mode-select",
  "count-source-select",
  "manual-setor",
  "manual-produto",
  "manual-marca",
  "manual-tipo",
  "manual-pallets",
].forEach((id) => enhanceSelect(document.getElementById(id)));
setupVoice();
setupCountTableEvents();
setupManualFormEvents();
setupCountModeEvents();
finishBoot();
