// Cadastro de produtos (CRUD do catalogo) — so produtos.html.
import { state, elements } from "./state.js";
import { CONFIG_GERAL, BASE_CONFIG_GERAL } from "./config.js";
import { toNonNegativeInt, isNoTipoProduct, getTipoRuleValue, buildTipoOptionList, setSelectOptions, setSelectOptionsWithPlaceholder } from "./utils.js";
import { requireAuthenticatedUser, initSetorSelects } from "./auth-ui.js";
import { renderContext, renderPublicTable, renderCountTable, buildFilterOptions } from "./tables.js";
import {
  buildCatalogEntryKey,
  parseCatalogEntryKey,
  configHasCatalogEntry,
  applyCatalogOverridesFromState,
  saveCatalogAddition,
  removeCatalogEntry,
  resetAllCatalogOverrides,
  normalizeCatalogAdditionEntry,
  sanitizeContextAfterCatalogChange,
  writeCatalogCache,
} from "./catalog-overrides.js";
import { confirmAction } from "./confirm-modal.js";

function setMessageIn(target, type, text) {
  if (!target) return;
  target.innerHTML = "";
  if (!text) return;
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;
  msg.textContent = text;
  target.appendChild(msg);
}

// Mensagem dentro do modal de cadastro (validacao do formulario).
function setCatalogMessage(type, text) {
  setMessageIn(elements.catalogMsg, type, text);
}

// Mensagem no card da tabela (remover/restaurar, fora do modal).
function setCatalogListMessage(type, text) {
  setMessageIn(elements.catalogListMsg, type, text);
}

function openCatalogModal() {
  if (!requireAuthenticatedUser("Faça login para alterar o cadastro de produtos.")) {
    return;
  }
  if (!elements.catalogModal) return;
  setCatalogMessage("", "");
  elements.catalogModal.classList.remove("hidden");
}

function closeCatalogModal() {
  if (!elements.catalogModal) return;
  elements.catalogModal.classList.add("hidden");
}

function openCatalogAddedModal(message) {
  if (!elements.catalogAddedModal) return;
  if (elements.catalogAddedMessage) {
    elements.catalogAddedMessage.textContent = message;
  }
  elements.catalogAddedModal.classList.remove("hidden");
}

function closeCatalogAddedModal() {
  if (!elements.catalogAddedModal) return;
  elements.catalogAddedModal.classList.add("hidden");
}

function describeCatalogCaixas(rule, produto, marca) {
  if (typeof rule !== "function") return "--";
  if (isNoTipoProduct(produto)) {
    return String(toNonNegativeInt(rule(0), 0));
  }

  const caixasValues = buildTipoOptionList(produto).map((tipoOption) =>
    toNonNegativeInt(rule(getTipoRuleValue(produto, tipoOption.value)), 0)
  );
  if (!caixasValues.length) {
    return "--";
  }
  const uniqueValues = Array.from(new Set(caixasValues));
  if (uniqueValues.length === 1) {
    return String(uniqueValues[0]);
  }
  return `${Math.min(...uniqueValues)}-${Math.max(...uniqueValues)}`;
}

function listCatalogRows() {
  const rows = [];
  const additionsKeySet = new Set(
    state.catalogAdditions.map((entry) => buildCatalogEntryKey(entry))
  );

  Object.entries(CONFIG_GERAL).forEach(([setor, produtos]) => {
    Object.entries(produtos || {}).forEach(([produto, marcas]) => {
      Object.entries(marcas || {}).forEach(([marca, regra]) => {
        const rowKey = buildCatalogEntryKey({ setor, produto, marca });
        const baseExists = configHasCatalogEntry(BASE_CONFIG_GERAL, {
          setor,
          produto,
          marca,
        });
        const isCustom = additionsKeySet.has(rowKey);
        rows.push({
          key: rowKey,
          setor,
          produto,
          marca,
          caixasPalletLabel: describeCatalogCaixas(regra, produto, marca),
          tipoLabel: isNoTipoProduct(produto) ? "S/T" : "3 a 15",
          origemLabel: isCustom ? (baseExists ? "Personalizado" : "Adicionado") : "Padrao",
        });
      });
    });
  });

  return rows.sort((a, b) => {
    const bySetor = a.setor.localeCompare(b.setor);
    if (bySetor !== 0) return bySetor;
    const byProduto = a.produto.localeCompare(b.produto);
    if (byProduto !== 0) return byProduto;
    return a.marca.localeCompare(b.marca);
  });
}

function renderCatalogTable() {
  if (!elements.catalogTableBody) return;
  const rows = listCatalogRows();
  if (!rows.length) {
    elements.catalogTableBody.innerHTML =
      '<tr><td colspan="7" class="catalog-empty">Nenhum produto cadastrado.</td></tr>';
    return;
  }

  elements.catalogTableBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.setor}</td>
        <td>${row.produto}</td>
        <td>${row.marca}</td>
        <td>${row.caixasPalletLabel}</td>
        <td>${row.tipoLabel}</td>
        <td>${row.origemLabel}</td>
        <td>
          <div class="row-actions">
            <button
              class="danger catalog-remove-btn"
              type="button"
              data-catalog-key="${row.key}"
            >
              Remover
            </button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

export function refreshCatalogDependentUI() {
  const previousManualSetor = elements.manualSetor?.value || "";
  const previousCatalogSetor = elements.catalogSetor?.value || "";
  sanitizeContextAfterCatalogChange();
  initSetorSelects();

  if (elements.manualSetor) {
    setSelectOptionsWithPlaceholder(
      elements.manualSetor,
      Object.keys(CONFIG_GERAL).sort(),
      previousManualSetor || state.setor,
      "Selecione"
    );
  }

  if (elements.manualProduto && elements.manualMarca) {
    import("./manual-form.js").then((m) => m.updateManualDependencies());
  }

  if (elements.catalogSetor) {
    setSelectOptions(
      elements.catalogSetor,
      Object.keys(CONFIG_GERAL).sort(),
      previousCatalogSetor || state.setor
    );
  }

  buildFilterOptions();
  renderContext();
  renderPublicTable();
  renderCountTable();
  renderCatalogTable();
}

async function removeCatalogEntryByKey(entryKey) {
  if (!requireAuthenticatedUser("Faça login para alterar o cadastro de produtos.")) {
    return;
  }

  const parsed = parseCatalogEntryKey(entryKey);
  if (!parsed) {
    setCatalogListMessage("error", "Produto invalido para remocao.");
    return;
  }

  const key = buildCatalogEntryKey(parsed);
  const existedInBase = configHasCatalogEntry(BASE_CONFIG_GERAL, parsed);

  setCatalogListMessage("info", "Removendo...");
  const { error } = await removeCatalogEntry(parsed, { markRemoved: existedInBase });
  if (error) {
    setCatalogListMessage("error", `Erro ao remover produto: ${error.message}`);
    return;
  }

  state.catalogAdditions = state.catalogAdditions.filter(
    (entry) => buildCatalogEntryKey(entry) !== key
  );
  state.catalogRemovals = state.catalogRemovals.filter(
    (entry) => buildCatalogEntryKey(entry) !== key
  );

  if (existedInBase) {
    state.catalogRemovals.push(parsed);
  }

  applyCatalogOverridesFromState();
  writeCatalogCache(state.catalogAdditions, state.catalogRemovals);
  refreshCatalogDependentUI();
  setCatalogListMessage("success", `${parsed.produto} ${parsed.marca} removido do catalogo para todos os usuarios.`);
}

async function addCatalogEntryFromForm() {
  if (!requireAuthenticatedUser("Faça login para alterar o cadastro de produtos.")) {
    return;
  }

  if (
    !elements.catalogSetor ||
    !elements.catalogProduto ||
    !elements.catalogMarca ||
    !elements.catalogCaixas ||
    !elements.catalogNoTipo
  ) {
    return;
  }

  const hasRange = Boolean(elements.catalogRangeToggle?.checked);
  const addition = normalizeCatalogAdditionEntry({
    setor: elements.catalogSetor.value,
    produto: elements.catalogProduto.value,
    marca: elements.catalogMarca.value,
    caixasPallet: elements.catalogCaixas.value,
    noTipo: elements.catalogNoTipo.checked,
    tipoMin: hasRange ? elements.catalogTipoMin?.value : undefined,
    tipoMax: hasRange ? elements.catalogTipoMax?.value : undefined,
    caixasPalletInRange: hasRange ? elements.catalogCaixasInRange?.value : undefined,
  });

  if (!addition) {
    setCatalogMessage(
      "warn",
      hasRange
        ? "Preencha setor, produto, marca, caixas por pallet e a faixa de tipo com valores validos."
        : "Preencha setor, produto, marca e caixas por pallet com valor valido."
    );
    return;
  }

  setCatalogMessage("info", "Salvando...");
  const { error } = await saveCatalogAddition(addition);
  if (error) {
    setCatalogMessage("error", `Erro ao salvar produto: ${error.message}`);
    return;
  }

  const key = buildCatalogEntryKey(addition);
  state.catalogRemovals = state.catalogRemovals.filter(
    (entry) => buildCatalogEntryKey(entry) !== key
  );
  state.catalogAdditions = state.catalogAdditions.filter(
    (entry) => buildCatalogEntryKey(entry) !== key
  );
  state.catalogAdditions.push(addition);

  applyCatalogOverridesFromState();
  writeCatalogCache(state.catalogAdditions, state.catalogRemovals);
  refreshCatalogDependentUI();

  elements.catalogProduto.value = "";
  elements.catalogMarca.value = "";
  elements.catalogCaixas.value = "";
  elements.catalogNoTipo.checked = false;
  if (elements.catalogRangeToggle) elements.catalogRangeToggle.checked = false;
  if (elements.catalogRangeFields) elements.catalogRangeFields.classList.add("hidden");
  if (elements.catalogTipoMin) elements.catalogTipoMin.value = "";
  if (elements.catalogTipoMax) elements.catalogTipoMax.value = "";
  if (elements.catalogCaixasInRange) elements.catalogCaixasInRange.value = "";
  setCatalogMessage("", "");

  closeCatalogModal();
  openCatalogAddedModal(
    `${addition.produto} ${addition.marca} salvo no catalogo (${addition.setor}) para todos os usuarios.`
  );
}

async function resetCatalogOverridesToDefault() {
  if (!requireAuthenticatedUser("Faça login para alterar o cadastro de produtos.")) {
    return;
  }

  if (!state.catalogAdditions.length && !state.catalogRemovals.length) {
    setCatalogListMessage("info", "Catalogo ja esta no padrao original.");
    return;
  }

  const confirmed = await confirmAction({
    title: "Restaurar catalogo",
    message:
      "Restaurar o catalogo original para TODOS os usuarios? Isso remove todas as personalizacoes cadastradas.",
    confirmLabel: "Restaurar",
    danger: true,
  });
  if (!confirmed) return;

  setCatalogListMessage("info", "Restaurando...");
  const { error } = await resetAllCatalogOverrides();
  if (error) {
    setCatalogListMessage("error", `Erro ao restaurar catalogo: ${error.message}`);
    return;
  }

  state.catalogAdditions = [];
  state.catalogRemovals = [];
  applyCatalogOverridesFromState();
  writeCatalogCache(state.catalogAdditions, state.catalogRemovals);
  refreshCatalogDependentUI();
  setCatalogListMessage("success", "Catalogo original restaurado para todos os usuarios.");
}

export function initCatalogForm() {
  if (!elements.catalogSetor) return;
  setSelectOptions(elements.catalogSetor, Object.keys(CONFIG_GERAL).sort(), state.setor);
  renderCatalogTable();
}

// Liga os botoes de adicionar/remover/restaurar do catalogo.
export function setupCatalogEvents() {
  if (elements.catalogAddBtn) {
    elements.catalogAddBtn.addEventListener("click", () => {
      addCatalogEntryFromForm();
    });
  }

  if (elements.catalogResetBtn) {
    elements.catalogResetBtn.addEventListener("click", () => {
      resetCatalogOverridesToDefault();
    });
  }

  if (elements.catalogTableBody) {
    elements.catalogTableBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-catalog-key]");
      if (!button) return;
      removeCatalogEntryByKey(button.dataset.catalogKey);
    });
  }

  if (elements.catalogRangeToggle && elements.catalogRangeFields) {
    elements.catalogRangeToggle.addEventListener("change", () => {
      elements.catalogRangeFields.classList.toggle(
        "hidden",
        !elements.catalogRangeToggle.checked
      );
    });
  }

  if (elements.catalogOpenModalBtn) {
    elements.catalogOpenModalBtn.addEventListener("click", () => {
      openCatalogModal();
    });
  }

  if (elements.catalogModalClose) {
    elements.catalogModalClose.addEventListener("click", () => closeCatalogModal());
  }
  if (elements.catalogModalCloseBtn) {
    elements.catalogModalCloseBtn.addEventListener("click", () => closeCatalogModal());
  }

  if (elements.catalogAddedModalClose) {
    elements.catalogAddedModalClose.addEventListener("click", () => closeCatalogAddedModal());
  }
  if (elements.catalogAddedDoneBtn) {
    elements.catalogAddedDoneBtn.addEventListener("click", () => closeCatalogAddedModal());
  }
  if (elements.catalogAddAnotherBtn) {
    elements.catalogAddAnotherBtn.addEventListener("click", () => {
      closeCatalogAddedModal();
      openCatalogModal();
    });
  }
}

export { renderCatalogTable };
