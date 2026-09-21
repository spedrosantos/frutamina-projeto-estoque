// Cadastro de produtos (CRUD do catalogo) — so produtos.html.
import { state, elements } from "../core/state.js";
import { CONFIG_GERAL, BASE_CONFIG_GERAL, TIPO_MIN, TIPO_MAX } from "../core/config.js";
import {
  toNonNegativeInt,
  isNoTipoProduct,
  getTipoRuleValue,
  buildTipoOptionList,
  normalizeKey,
  setSelectOptions,
  setSelectOptionsWithPlaceholder,
} from "../core/utils.js";
import { requireAuthenticatedUser, initSetorSelects } from "../shell/auth-ui.js";
import { confirmAction } from "../shell/confirm-modal.js";
import {
  renderContext,
  renderPublicTable,
  renderCountTable,
  buildFilterOptions,
} from "./tables.js";
import {
  buildCatalogEntryKey,
  parseCatalogEntryKey,
  configHasCatalogEntry,
  applyCatalogOverridesFromState,
  saveCatalogAddition,
  removeCatalogEntry,
  normalizeCatalogAdditionEntry,
  sanitizeContextAfterCatalogChange,
  writeCatalogCache,
} from "../data/catalog-overrides.js";

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

// Le a regra de caixas de um item ja cadastrado. Para os itens do catalogo
// padrao nao existe registro com os numeros, so a funcao regra: avaliando ela em
// todos os tipos da para descobrir o valor comum e a faixa que foge dele.
function readCatalogRule(setor, produto, marca) {
  const rule = CONFIG_GERAL?.[setor]?.[produto]?.[marca];
  if (typeof rule !== "function") return null;
  if (isNoTipoProduct(produto)) {
    return { caixasPallet: toNonNegativeInt(rule(0), 0) };
  }

  const byTipo = [];
  for (let tipo = TIPO_MIN; tipo <= TIPO_MAX; tipo += 1) {
    byTipo.push({ tipo, caixas: toNonNegativeInt(rule(tipo), 0) });
  }
  const counts = new Map();
  byTipo.forEach(({ caixas }) => counts.set(caixas, (counts.get(caixas) || 0) + 1));
  const fora = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const excecao = byTipo.filter(({ caixas }) => caixas !== fora);
  if (!excecao.length) return { caixasPallet: fora };
  return {
    caixasPallet: fora,
    tipoMin: excecao[0].tipo,
    tipoMax: excecao[excecao.length - 1].tipo,
    caixasPalletInRange: excecao[0].caixas,
  };
}

function fillCatalogForm(entry) {
  if (elements.catalogSetor) elements.catalogSetor.value = entry?.setor || state.setor || "";
  if (elements.catalogProduto) elements.catalogProduto.value = entry?.produto || "";
  if (elements.catalogMarca) elements.catalogMarca.value = entry?.marca || "";
  if (elements.catalogCaixas) {
    elements.catalogCaixas.value = entry?.caixasPallet ? String(entry.caixasPallet) : "";
  }
  if (elements.catalogNoTipo) {
    elements.catalogNoTipo.checked = Boolean(entry?.produto && isNoTipoProduct(entry.produto));
  }
  const hasRange = Boolean(entry?.tipoMin && entry?.tipoMax && entry?.caixasPalletInRange);
  if (elements.catalogRangeToggle) elements.catalogRangeToggle.checked = hasRange;
  if (elements.catalogTipoMin) {
    elements.catalogTipoMin.value = String(hasRange ? entry.tipoMin : TIPO_MIN + 1);
  }
  if (elements.catalogTipoMax) {
    elements.catalogTipoMax.value = String(hasRange ? entry.tipoMax : TIPO_MIN + 3);
  }
  if (elements.catalogCaixasInRange) {
    elements.catalogCaixasInRange.value = hasRange ? String(entry.caixasPalletInRange) : "";
  }
  syncCatalogFormMode();
}

function openCatalogModal(entryKey = "") {
  if (!requireAuthenticatedUser("Faça login para alterar o cadastro de produtos.")) {
    return;
  }
  if (!elements.catalogModal) return;
  setCatalogMessage("", "");

  // Editar reusa o mesmo formulario: a chave original fica guardada porque o
  // operador pode mudar setor/produto/marca, e nesse caso o item antigo sai.
  const parsed = entryKey ? parseCatalogEntryKey(entryKey) : null;
  state.catalogEditKey = parsed ? buildCatalogEntryKey(parsed) : "";
  fillCatalogForm(
    parsed
      ? { ...parsed, ...(readCatalogRule(parsed.setor, parsed.produto, parsed.marca) || {}) }
      : null,
  );
  if (elements.catalogModalTitle) {
    elements.catalogModalTitle.textContent = parsed ? "Editar produto" : "Novo produto";
  }
  if (elements.catalogAddBtnLabel) {
    elements.catalogAddBtnLabel.textContent = parsed ? "Salvar alteracoes" : "Cadastrar produto";
  }
  elements.catalogModal.classList.remove("hidden");
}

function closeCatalogModal() {
  // Fechar sem salvar tambem encerra a edicao: o proximo "+" abre em branco.
  state.catalogEditKey = "";
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
    toNonNegativeInt(rule(getTipoRuleValue(produto, tipoOption.value)), 0),
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
    state.catalogAdditions.map((entry) => buildCatalogEntryKey(entry)),
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

function matchesCatalogSearch(row, query) {
  if (!query) return true;
  return normalizeKey(`${row.setor} ${row.produto} ${row.marca}`).includes(query);
}

function renderCatalogTable() {
  if (!elements.catalogTableBody) return;
  const all = listCatalogRows();
  const query = normalizeKey(elements.catalogSearch?.value || "");
  const rows = all.filter((row) => matchesCatalogSearch(row, query));

  if (elements.catalogCount) {
    elements.catalogCount.textContent = query
      ? `${rows.length} de ${all.length}`
      : String(all.length);
  }

  if (!rows.length) {
    // Catalogo vazio com consulta em voo e "ainda buscando", nao "nao existe".
    const carregando = state.carregando && !all.length;
    const texto = carregando
      ? "Carregando dados..."
      : all.length
        ? "Nenhum produto para esta busca."
        : "Nenhum produto cadastrado.";
    elements.catalogTableBody.innerHTML = `<tr><td colspan="7" class="catalog-empty${
      carregando ? " table-state is-loading" : ""
    }">${texto}</td></tr>`;
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
        <td>
          <span class="catalog-origin${row.origemLabel === "Padrao" ? "" : " is-custom"}">
            ${row.origemLabel}
          </span>
        </td>
        <td class="row-actions">
          <button
            class="ghost icon-btn catalog-edit-btn"
            type="button"
            title="Editar produto"
            aria-label="Editar produto"
            data-catalog-edit="${row.key}"
          >
            <i class="bi bi-pencil"></i>
          </button>
          <button
            class="danger icon-btn catalog-remove-btn"
            type="button"
            title="Remover do catalogo"
            aria-label="Remover do catalogo"
            data-catalog-key="${row.key}"
          >
            <i class="bi bi-trash3"></i>
          </button>
        </td>
      </tr>
    `,
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
      "Selecione",
    );
  }

  if (elements.manualProduto && elements.manualMarca) {
    import("./manual-form.js").then((m) => m.updateManualDependencies());
  }

  if (elements.catalogSetor) {
    setSelectOptions(
      elements.catalogSetor,
      Object.keys(CONFIG_GERAL).sort(),
      previousCatalogSetor || state.setor,
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

  // Toda exclusao passa por confirmacao: isso sai do catalogo de todos os
  // operadores, e o produto deixa de aparecer na contagem.
  const confirmed = await confirmAction({
    title: "Remover do catalogo",
    message: `Remover ${parsed.produto} ${parsed.marca} (${parsed.setor}) do catalogo? Ele deixa de aparecer na contagem para todos.`,
    confirmLabel: "Remover",
    danger: true,
  });
  if (!confirmed) return;

  setCatalogListMessage("info", "Removendo...");
  const { error } = await removeCatalogEntry(parsed, { markRemoved: existedInBase });
  if (error) {
    setCatalogListMessage("error", `Erro ao remover produto: ${error.message}`);
    return;
  }

  state.catalogAdditions = state.catalogAdditions.filter(
    (entry) => buildCatalogEntryKey(entry) !== key,
  );
  state.catalogRemovals = state.catalogRemovals.filter(
    (entry) => buildCatalogEntryKey(entry) !== key,
  );

  if (existedInBase) {
    state.catalogRemovals.push(parsed);
  }

  applyCatalogOverridesFromState();
  writeCatalogCache(state.catalogAdditions, state.catalogRemovals);
  refreshCatalogDependentUI();
  setCatalogListMessage(
    "success",
    `${parsed.produto} ${parsed.marca} removido do catalogo para todos os usuarios.`,
  );
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
        : "Preencha setor, produto, marca e caixas por pallet com valor valido.",
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
  // Edicao que troca setor/produto/marca cria outro item: o antigo tem que sair,
  // senao o catalogo fica com os dois.
  const editKey = state.catalogEditKey;
  if (editKey && editKey !== key) {
    const previous = parseCatalogEntryKey(editKey);
    if (previous) {
      const previousInBase = configHasCatalogEntry(BASE_CONFIG_GERAL, previous);
      await removeCatalogEntry(previous, { markRemoved: previousInBase });
      state.catalogAdditions = state.catalogAdditions.filter(
        (entry) => buildCatalogEntryKey(entry) !== editKey,
      );
      if (previousInBase) state.catalogRemovals.push(previous);
    }
  }
  state.catalogRemovals = state.catalogRemovals.filter(
    (entry) => buildCatalogEntryKey(entry) !== key,
  );
  state.catalogAdditions = state.catalogAdditions.filter(
    (entry) => buildCatalogEntryKey(entry) !== key,
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
  if (elements.catalogTipoMin) elements.catalogTipoMin.value = String(TIPO_MIN + 1);
  if (elements.catalogTipoMax) elements.catalogTipoMax.value = String(TIPO_MIN + 3);
  if (elements.catalogCaixasInRange) elements.catalogCaixasInRange.value = "";
  syncCatalogFormMode();
  setCatalogMessage("", "");

  const wasEditing = Boolean(state.catalogEditKey);
  state.catalogEditKey = "";
  closeCatalogModal();
  if (wasEditing) {
    setCatalogListMessage(
      "success",
      `${addition.produto} ${addition.marca} atualizado no catalogo (${addition.setor}).`,
    );
    return;
  }
  openCatalogAddedModal(
    `${addition.produto} ${addition.marca} salvo no catalogo (${addition.setor}) para todos os usuarios.`,
  );
}

// A excecao por tipo e escrita como frase ("do tipo 4 ao 6 tem 66 caixas"), e
// os limites viram <select> de TIPO_MIN a TIPO_MAX: digitando numero solto dava
// para pedir tipo 99 e a unica resposta era o formulario recusar no fim.
function fillTipoSelect(select, selected) {
  if (!select) return;
  const tipos = [];
  for (let tipo = TIPO_MIN; tipo <= TIPO_MAX; tipo += 1) tipos.push(String(tipo));
  setSelectOptions(select, tipos, String(selected));
}

// Traduz o que esta preenchido para as duas faixas resultantes, para o operador
// ver a regra inteira antes de salvar.
function renderCatalogRulePreview() {
  const preview = elements.catalogRulePreview;
  if (!preview) return;
  const fora = toNonNegativeInt(elements.catalogCaixas?.value, 0);
  const min = toNonNegativeInt(elements.catalogTipoMin?.value, 0);
  const max = toNonNegativeInt(elements.catalogTipoMax?.value, 0);
  const dentro = toNonNegativeInt(elements.catalogCaixasInRange?.value, 0);
  if (!fora || !dentro || !min || !max) {
    preview.textContent = "Preencha as caixas por pallet e a faixa para ver a regra.";
    return;
  }
  const restantes = [];
  if (min > TIPO_MIN)
    restantes.push(min - 1 === TIPO_MIN ? `${TIPO_MIN}` : `${TIPO_MIN} a ${min - 1}`);
  if (max < TIPO_MAX)
    restantes.push(max + 1 === TIPO_MAX ? `${TIPO_MAX}` : `${max + 1} a ${TIPO_MAX}`);
  const faixa = min === max ? `Tipo ${min}` : `Tipos ${min} a ${max}`;
  const resto = restantes.length ? `Tipos ${restantes.join(" e ")}: ${fora} caixas` : "";
  preview.textContent = [`${faixa}: ${dentro} caixas`, resto].filter(Boolean).join("  |  ");
}

// Produto sem tipo nao tem faixa: a excecao sai da tela para nao oferecer uma
// combinacao que o cadastro nao usa.
function syncCatalogFormMode() {
  const noTipo = Boolean(elements.catalogNoTipo?.checked);
  if (elements.catalogRangeOption) {
    elements.catalogRangeOption.classList.toggle("hidden", noTipo);
  }
  if (noTipo && elements.catalogRangeToggle?.checked) {
    elements.catalogRangeToggle.checked = false;
  }
  const showRange = !noTipo && Boolean(elements.catalogRangeToggle?.checked);
  elements.catalogRangeFields?.classList.toggle("hidden", !showRange);
  if (elements.catalogCaixasHint) {
    elements.catalogCaixasHint.textContent = noTipo
      ? "Quantas caixas fecham um pallet deste produto."
      : showRange
        ? `Valor usado nos tipos fora da faixa abaixo.`
        : `Quantas caixas fecham um pallet. Vale para todos os tipos (${TIPO_MIN} a ${TIPO_MAX}).`;
  }
  if (showRange) renderCatalogRulePreview();
}

export function initCatalogForm() {
  if (!elements.catalogSetor) return;
  setSelectOptions(elements.catalogSetor, Object.keys(CONFIG_GERAL).sort(), state.setor);
  fillTipoSelect(elements.catalogTipoMin, TIPO_MIN + 1);
  fillTipoSelect(elements.catalogTipoMax, TIPO_MIN + 3);
  syncCatalogFormMode();
  renderCatalogTable();
}

// Liga os botoes de adicionar/remover/restaurar do catalogo.
export function setupCatalogEvents() {
  if (elements.catalogAddBtn) {
    elements.catalogAddBtn.addEventListener("click", () => {
      addCatalogEntryFromForm();
    });
  }

  if (elements.catalogSearch) {
    elements.catalogSearch.addEventListener("input", renderCatalogTable);
  }

  if (elements.catalogTableBody) {
    elements.catalogTableBody.addEventListener("click", (event) => {
      const editBtn = event.target.closest("button[data-catalog-edit]");
      if (editBtn) {
        openCatalogModal(editBtn.dataset.catalogEdit);
        return;
      }
      const button = event.target.closest("button[data-catalog-key]");
      if (!button) return;
      removeCatalogEntryByKey(button.dataset.catalogKey);
    });
  }

  elements.catalogRangeToggle?.addEventListener("change", syncCatalogFormMode);
  elements.catalogNoTipo?.addEventListener("change", syncCatalogFormMode);

  // Tipo maximo nunca pode ficar antes do minimo.
  elements.catalogTipoMin?.addEventListener("change", () => {
    if (
      toNonNegativeInt(elements.catalogTipoMax?.value, 0) <
      toNonNegativeInt(elements.catalogTipoMin.value, 0)
    ) {
      elements.catalogTipoMax.value = elements.catalogTipoMin.value;
    }
    renderCatalogRulePreview();
  });

  elements.catalogTipoMax?.addEventListener("change", () => {
    if (
      toNonNegativeInt(elements.catalogTipoMax.value, 0) <
      toNonNegativeInt(elements.catalogTipoMin?.value, 0)
    ) {
      elements.catalogTipoMin.value = elements.catalogTipoMax.value;
    }
    renderCatalogRulePreview();
  });

  elements.catalogCaixas?.addEventListener("input", renderCatalogRulePreview);
  elements.catalogCaixasInRange?.addEventListener("input", renderCatalogRulePreview);

  if (elements.catalogOpenModalBtn) {
    elements.catalogOpenModalBtn.addEventListener("click", () => {
      openCatalogModal("");
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
      openCatalogModal("");
    });
  }
}

export { renderCatalogTable };
