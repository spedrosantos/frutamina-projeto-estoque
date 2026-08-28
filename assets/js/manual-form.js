// Formulario manual de lancamento e modal de edicao/remocao de item — so editar.html.
import { state, elements, supabaseClient } from "./state.js";
import {
  CONFIG_GERAL,
  NO_TIPO_VALUE,
  TIPO_MIN,
  TIPO_MAX,
  TABLE_NAME,
  SUPABASE_TIMEOUT_MS,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./config.js";
import {
  toNonNegativeInt,
  isNoTipoContext,
  hasSpecialTipoVariants,
  buildTipoOptionList,
  parseTipoInputValue,
  getTipoRuleValue,
  isTipoValidForContext,
  getTipoValidationMessage,
  formatTipoLabelValue,
  normalizeKey,
  cleanLabel,
  normalizeSetorValue,
  pushMessage,
  withTimeout,
  listProductsBySetor,
  listBrands,
  setSelectOptionsWithPlaceholder,
  setNumberOptions,
  getRowKey,
} from "./utils.js";
import {
  hydrateInventoryRow,
  normalizeInventoryMetrics,
  buildDbRowPayload,
  isLooseBoxesSchemaError,
} from "./inventory-core.js";
import { requireAuthenticatedUser } from "./auth-ui.js";
import { renderContext, renderCountTable } from "./tables.js";
import { loadUserRecords, loadPublicRecords, probeSupabase } from "./supabase-api.js";
import { registerInventoryChange, clearVoiceActionState } from "./voice-actions.js";

function setEditMessage(type, text) {
  if (!elements.editMsg) return;
  elements.editMsg.innerHTML = "";
  if (!text) return;
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;
  msg.textContent = text;
  elements.editMsg.appendChild(msg);
}

function getProdutoMarcaInfo(produto, marca) {
  if (!produto || !marca) {
    return { produtoExists: false, marcaExists: false, setores: [], setoresKey: [] };
  }
  const produtoKey = normalizeKey(produto);
  const marcaKey = normalizeKey(marca);
  const setores = new Set();
  const setoresKey = new Set();
  let produtoExists = false;
  let marcaExists = false;

  Object.entries(CONFIG_GERAL).forEach(([setor, produtos]) => {
    Object.entries(produtos || {}).forEach(([produtoNome, marcas]) => {
      if (normalizeKey(produtoNome) !== produtoKey) return;
      produtoExists = true;
      Object.keys(marcas || {}).forEach((marcaNome) => {
        if (normalizeKey(marcaNome) === marcaKey) {
          marcaExists = true;
          setores.add(setor);
          setoresKey.add(normalizeKey(setor));
        }
      });
    });
  });

  return {
    produtoExists,
    marcaExists,
    setores: Array.from(setores),
    setoresKey: Array.from(setoresKey),
  };
}

function inferSetorFromProdutoMarca(produto, marca) {
  const info = getProdutoMarcaInfo(produto, marca);
  return info.setores.length === 1 ? info.setores[0] : null;
}

function findCurrentRowByKey(key) {
  const source = state.countMode === "new" ? state.sessionRows : state.userRows;
  return source.find((row) => getRowKey(row) === key);
}

function findSessionRowByKey(key) {
  return state.sessionRows.find((row) => getRowKey(row) === key);
}

export function openEditModal(row = null) {
  if (!requireAuthenticatedUser("Faça login para editar itens.")) {
    return;
  }
  if (!elements.editModal) return;
  state.editTarget = {
    rowKey: getRowKey(row),
  };
  setEditMessage("", "");

  if (elements.editTitle) {
    elements.editTitle.textContent = "Editar item";
  }

  if (elements.editSetor) {
    elements.editSetor.value = row?.setor || state.setor || "";
  }
  if (elements.editProduto) {
    elements.editProduto.value = row?.produto || "";
  }
  if (elements.editMarca) {
    elements.editMarca.value = row?.marca || "";
  }
  if (elements.editTipo) {
    elements.editTipo.value =
      row?.tipo === 0 || row?.tipo
        ? formatTipoLabelValue(row?.produto, row?.tipo, row?.marca)
        : "";
  }
  if (elements.editCaixas) {
    elements.editCaixas.value = row?.caixas_pallet ?? "";
  }
  if (elements.editPallets) {
    elements.editPallets.value = row?.pallets ?? 1;
  }
  if (elements.editLooseBoxes) {
    elements.editLooseBoxes.value = row?.caixas_avulsas ?? 0;
  }

  elements.editModal.classList.remove("hidden");
}

function closeEditModal() {
  if (!elements.editModal) return;
  elements.editModal.classList.add("hidden");
  state.editTarget = null;
}

function showDebugPanel(result) {
  if (!elements.debugPanel) return;
  if (elements.debugUrl) {
    elements.debugUrl.textContent = SUPABASE_URL || "--";
  }
  if (elements.debugKey) {
    const suffix = SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.slice(-6) : "--";
    elements.debugKey.textContent = `...${suffix}`;
  }
  if (elements.debugUser) {
    elements.debugUser.textContent = state.user?.email || "--";
  }
  if (elements.debugResult) {
    elements.debugResult.textContent =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
  }
  elements.debugPanel.classList.remove("hidden");
}

async function saveEditItem() {
  if (!requireAuthenticatedUser("Faça login para salvar alterações.")) {
    return;
  }
  if (!elements.editSetor || !elements.editProduto || !elements.editMarca) return;

  setEditMessage("info", "Salvando...");

  try {
    let slowTimer = setTimeout(() => {
      setEditMessage("info", "Servidor acordando... aguarde alguns segundos.");
    }, 10000);

    let setor = normalizeSetorValue(elements.editSetor.value);
    const produto = cleanLabel(elements.editProduto.value);
    const marca = cleanLabel(elements.editMarca.value);
    const tipo = parseTipoInputValue(elements.editTipo.value, produto);
    const caixasPallet = Number.parseInt(elements.editCaixas.value, 10);
    const pallets = Number.parseInt(elements.editPallets.value, 10);
    const caixasAvulsas = toNonNegativeInt(elements.editLooseBoxes?.value, 0);
    const noTipo = isNoTipoContext(produto, marca);

    const info = getProdutoMarcaInfo(produto, marca);
    if (!info.produtoExists) {
      setEditMessage("error", "Produto não cadastrado.");
      return;
    }
    if (!info.marcaExists) {
      setEditMessage("error", "Marca não cadastrada para este produto.");
      return;
    }

    if (elements.editSetor && elements.editSetor.value !== setor) {
      elements.editSetor.value = setor;
    }

    let setorKey = normalizeKey(setor);
    const inferredSetor = inferSetorFromProdutoMarca(produto, marca);
    if (inferredSetor && inferredSetor !== setor) {
      setor = inferredSetor;
      setorKey = normalizeKey(setor);
      if (elements.editSetor) {
        elements.editSetor.value = inferredSetor;
      }
    }

    if (info.setoresKey.length && !info.setoresKey.includes(setorKey)) {
      if (info.setores.length === 1) {
        setor = info.setores[0];
        if (elements.editSetor) {
          elements.editSetor.value = setor;
        }
      } else {
        setEditMessage(
          "error",
          `Produto e marca cadastrados nos setores: ${info.setores.join(", ")}.`
        );
        return;
      }
    }

    if (!setor || !produto || !marca) {
      setEditMessage("error", "Preencha setor, produto e marca.");
      return;
    }
    if (
      Number.isNaN(caixasPallet) ||
      Number.isNaN(pallets) ||
      (!noTipo && !Number.isFinite(tipo))
    ) {
      setEditMessage(
        "error",
        "Preencha tipo, caixas/pallet e pallets com valores validos."
      );
      return;
    }
    if (pallets < 0 || caixasAvulsas < 0) {
      setEditMessage("error", "Pallets e caixas avulsas nao podem ser negativos.");
      return;
    }
    if (pallets === 0 && caixasAvulsas === 0) {
      setEditMessage("error", "Informe pallets ou caixas avulsas.");
      return;
    }
    if (!noTipo && !isTipoValidForContext(produto, tipo)) {
      setEditMessage("error", getTipoValidationMessage(produto));
      return;
    }

    const tipoFinal = noTipo ? NO_TIPO_VALUE : tipo;
    const normalizedMetrics = normalizeInventoryMetrics({
      caixasPallet,
      pallets,
      caixasAvulsas,
    });

    if (state.countMode === "new") {
      if (!state.editTarget?.rowKey) {
        setEditMessage("error", "Selecione um item para editar.");
        return;
      }
      const row = findSessionRowByKey(state.editTarget.rowKey);
      if (!row) {
        setEditMessage("error", "Item selecionado não encontrado.");
        return;
      }
      row.setor = setor;
      row.produto = produto;
      row.marca = marca;
      row.tipo = tipoFinal;
      row.caixas_pallet = normalizedMetrics.caixas_pallet;
      row.pallets = normalizedMetrics.pallets;
      row.caixas_avulsas = normalizedMetrics.caixas_avulsas;
      row.total_caixas = normalizedMetrics.total_caixas;
      if (setor && state.setor !== setor) {
        state.setor = setor;
        if (elements.setorSelect) elements.setorSelect.value = setor;
        renderContext();
      }
      renderCountTable();
      state.selectedRowKey = null;
      clearVoiceActionState();
      closeEditModal();
      return;
    }

    if (!state.user) {
      setEditMessage("error", "Faça login para salvar alterações.");
      return;
    }

    const payload = {
      user_id: state.user.id,
      setor,
      produto,
      marca,
      tipo: tipoFinal,
      caixas_pallet: normalizedMetrics.caixas_pallet,
      pallets: normalizedMetrics.pallets,
      total_caixas: normalizedMetrics.total_caixas,
    };
    if (normalizedMetrics.caixas_avulsas > 0) {
      payload.caixas_avulsas = normalizedMetrics.caixas_avulsas;
    }

    if (!state.editTarget?.rowKey) {
      setEditMessage("error", "Selecione um item para editar.");
      return;
    }
    const originalRow = findCurrentRowByKey(state.editTarget.rowKey);
    const hasLooseBoxesColumn =
      Object.prototype.hasOwnProperty.call(originalRow || {}, "caixas_avulsas") ||
      normalizedMetrics.caixas_avulsas > 0;
    const updateResult = await withTimeout(
      supabaseClient
        .from(TABLE_NAME)
        .update({
          ...payload,
          ...(hasLooseBoxesColumn
            ? { caixas_avulsas: normalizedMetrics.caixas_avulsas }
            : {}),
        })
        .eq("id", state.editTarget.rowKey)
        .eq("user_id", state.user.id),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao atualizar item."
    );
    if (updateResult?.error) {
      const message = isLooseBoxesSchemaError(updateResult.error)
        ? "Erro ao atualizar item: rode a migracao de caixas avulsas no Supabase."
        : `Erro ao atualizar item: ${updateResult.error.message}`;
      setEditMessage("error", message);
      showDebugPanel(updateResult);
      clearTimeout(slowTimer);
      return;
    }

    const userResult = await withTimeout(
      loadUserRecords({ showError: false }),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao atualizar lista."
    );
    if (userResult?.error) {
      setEditMessage(
        "error",
        `Erro ao atualizar lista: ${userResult.error.message}`
      );
      showDebugPanel(userResult);
      clearTimeout(slowTimer);
      return;
    }
    const publicResult = await withTimeout(
      loadPublicRecords(),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao atualizar dados."
    );
    if (publicResult?.error) {
      showDebugPanel(publicResult);
    }
    clearTimeout(slowTimer);
    if (setor && state.setor !== setor) {
      state.setor = setor;
      if (elements.setorSelect) elements.setorSelect.value = setor;
      renderContext();
    }
    state.selectedRowKey = null;
    clearVoiceActionState();
    closeEditModal();
  } catch (error) {
    console.error("Erro ao salvar item:", error);
    setEditMessage(
      "error",
      `Erro inesperado ao salvar. ${error?.message || "Tente novamente."}`
    );
    const probe = await probeSupabase();
    showDebugPanel({
      error: error?.message || error,
      probe,
    });
  }
}

export async function removeRow(row) {
  if (!requireAuthenticatedUser("Faça login para remover itens.")) {
    return;
  }
  const rowKey = getRowKey(row);
  if (!rowKey) return;
  const tipoLabel = formatTipoLabelValue(row?.produto, row?.tipo, row?.marca);
  const confirmDelete = window.confirm(
    isNoTipoContext(row?.produto, row?.marca)
      ? `Remover o item ${row.produto} ${row.marca}?`
      : `Remover o item ${row.produto} ${row.marca} Tipo ${tipoLabel}?`
  );
  if (!confirmDelete) return;

  if (state.countMode === "new") {
    state.sessionRows = state.sessionRows.filter(
      (item) => getRowKey(item) !== rowKey
    );
    clearVoiceActionState();
    if (state.selectedRowKey === rowKey) {
      state.selectedRowKey = null;
    }
    renderCountTable();
    return;
  }

  if (!state.user) return;
  let error;
  try {
    ({ error } = await withTimeout(
      supabaseClient
        .from(TABLE_NAME)
        .delete()
        .eq("id", rowKey)
        .eq("user_id", state.user.id),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao remover o item."
    ));
  } catch (timeoutError) {
    error = timeoutError;
  }
  if (error) {
    pushMessage("error", `Erro ao remover item: ${error.message}`);
    return;
  }
  if (state.selectedRowKey === rowKey) {
    state.selectedRowKey = null;
  }
  clearVoiceActionState();
  await loadUserRecords();
  await loadPublicRecords();
}

function updateManualBoxesOptions() {
  if (!elements.manualBoxes) return;
  const caixasPallet = getManualCaixasPallet();
  elements.manualBoxes.min = "0";
  elements.manualBoxes.step = "1";
  elements.manualBoxes.placeholder = "0";
  elements.manualBoxes.title = caixasPallet
    ? `${caixasPallet} caixas fecham 1 pallet.`
    : "Digite a quantidade de caixas avulsas.";
  if (elements.manualBoxes.value === "") {
    elements.manualBoxes.value = "0";
  }
}

function updateManualTipoOptions() {
  if (!elements.manualTipo || !elements.manualProduto || !elements.manualMarca) return;
  const produto = elements.manualProduto.value;
  const marca = elements.manualMarca.value;
  const currentTipoValue = elements.manualTipo.value;
  if (isNoTipoContext(produto, marca)) {
    elements.manualTipo.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "S/T";
    elements.manualTipo.appendChild(option);
    elements.manualTipo.disabled = true;
    updateManualBoxesOptions();
    return;
  }
  elements.manualTipo.disabled = false;
  if (hasSpecialTipoVariants(produto)) {
    elements.manualTipo.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Selecione";
    elements.manualTipo.appendChild(empty);
    buildTipoOptionList(produto).forEach((tipoOption) => {
      const option = document.createElement("option");
      option.value = tipoOption.value;
      option.textContent = tipoOption.label;
      elements.manualTipo.appendChild(option);
    });
    if (
      currentTipoValue &&
      elements.manualTipo.querySelector(`option[value="${currentTipoValue}"]`)
    ) {
      elements.manualTipo.value = currentTipoValue;
    } else {
      elements.manualTipo.value = "";
    }
    updateManualBoxesOptions();
    return;
  }
  setNumberOptions(
    elements.manualTipo,
    TIPO_MIN,
    TIPO_MAX,
    currentTipoValue,
    "Selecione"
  );
  updateManualBoxesOptions();
}

function getManualCaixasPallet() {
  const setor = elements.manualSetor?.value;
  const produto = elements.manualProduto?.value;
  const marca = elements.manualMarca?.value;
  if (!setor || !produto || !marca) return 0;
  const regra = CONFIG_GERAL[setor]?.[produto]?.[marca];
  if (!regra) return 0;
  const noTipo = isNoTipoContext(produto, marca);
  const tipo = noTipo
    ? NO_TIPO_VALUE
    : parseTipoInputValue(elements.manualTipo?.value, produto);
  if (!noTipo && !isTipoValidForContext(produto, tipo)) return 0;
  return toNonNegativeInt(regra(getTipoRuleValue(produto, tipo)), 0);
}

export function initManualForm() {
  if (
    !elements.manualSetor ||
    !elements.manualProduto ||
    !elements.manualMarca ||
    !elements.manualTipo ||
    !elements.manualPallets ||
    !elements.manualBoxes
  ) {
    return;
  }

  const setores = Object.keys(CONFIG_GERAL).sort();
  setSelectOptionsWithPlaceholder(
    elements.manualSetor,
    setores,
    state.setor || "",
    "Selecione"
  );
  setSelectOptionsWithPlaceholder(
    elements.manualProduto,
    listProductsBySetor(elements.manualSetor.value),
    "",
    "Selecione"
  );
  setSelectOptionsWithPlaceholder(
    elements.manualMarca,
    listBrands(elements.manualSetor.value, elements.manualProduto.value),
    "",
    "Selecione"
  );
  updateManualTipoOptions();
  setNumberOptions(elements.manualPallets, 0, 50, 0);
  updateManualBoxesOptions();
}

export function updateManualDependencies() {
  if (!elements.manualSetor || !elements.manualProduto || !elements.manualMarca) {
    return;
  }
  const setor = elements.manualSetor.value;
  const produtoAtual = elements.manualProduto.value;
  const marcaAtual = elements.manualMarca.value;

  setSelectOptionsWithPlaceholder(
    elements.manualProduto,
    listProductsBySetor(setor),
    produtoAtual,
    "Selecione"
  );
  setSelectOptionsWithPlaceholder(
    elements.manualMarca,
    listBrands(setor, elements.manualProduto.value),
    marcaAtual,
    "Selecione"
  );
  updateManualTipoOptions();
  updateManualBoxesOptions();
}

async function addManualItem() {
  if (!requireAuthenticatedUser("Faça login para adicionar itens manualmente.")) {
    return;
  }

  if (
    !elements.manualSetor ||
    !elements.manualProduto ||
    !elements.manualMarca ||
    !elements.manualTipo
  ) {
    return;
  }

  const setor = elements.manualSetor.value;
  const produto = elements.manualProduto.value;
  const marca = elements.manualMarca.value;
  const tipoInput = parseTipoInputValue(elements.manualTipo.value, produto);
  const pallets = toNonNegativeInt(elements.manualPallets?.value, 0);
  const caixasAvulsas = toNonNegativeInt(elements.manualBoxes?.value, 0);
  const noTipo = isNoTipoContext(produto, marca);

  if (!setor || !produto || !marca) {
    pushMessage("warn", "Preencha setor, produto e marca.");
    return;
  }

  if (!noTipo && !Number.isFinite(tipoInput)) {
    pushMessage("warn", "Informe o tipo.");
    return;
  }
  if (!noTipo && !isTipoValidForContext(produto, tipoInput)) {
    pushMessage("warn", getTipoValidationMessage(produto));
    return;
  }

  if (pallets <= 0 && caixasAvulsas <= 0) {
    pushMessage("warn", "Informe pallets ou caixas avulsas.");
    return;
  }

  const regra = CONFIG_GERAL[setor]?.[produto]?.[marca];
  if (!regra) {
    pushMessage("error", "Combinação de setor/produto/marca inválida.");
    return;
  }

  const tipo = noTipo ? NO_TIPO_VALUE : tipoInput;
  const caixasPallet = regra(noTipo ? NO_TIPO_VALUE : getTipoRuleValue(produto, tipo));
  const palletsDelta = pallets;
  const tipoLabel = formatTipoLabelValue(produto, tipo, marca);

  state.setor = setor;
  state.produto = produto;
  state.marca = marca;
  if (elements.setorSelect) {
    elements.setorSelect.value = setor;
  }
  renderContext();

  await registerInventoryChange({
    setor,
    produto,
    marca,
    tipo,
    caixasPallet,
    palletsDelta,
    caixasAvulsasDelta: caixasAvulsas,
    successPrefix: "Registrado",
    successSubject: noTipo
      ? `${produto} ${marca}`
      : `${produto} ${marca} Tipo ${tipoLabel}`,
    actionKind: caixasAvulsas > 0 ? "boxes" : "pallets",
    correctionMode:
      caixasAvulsas > 0 || pallets > 1 || noTipo ? "quantity" : "type",
  });

  if (elements.manualPallets) {
    elements.manualPallets.value = "0";
  }
  if (elements.manualBoxes) {
    elements.manualBoxes.value = "0";
  }
}

// Liga o formulario manual e o modal de edicao (aberto pelo botao de cada linha).
export function setupManualFormEvents() {
  if (elements.editClose) {
    elements.editClose.addEventListener("click", closeEditModal);
  }

  if (elements.editCloseBtn) {
    elements.editCloseBtn.addEventListener("click", closeEditModal);
  }

  if (elements.editSave) {
    elements.editSave.addEventListener("click", saveEditItem);
  }

  if (elements.debugHide) {
    elements.debugHide.addEventListener("click", () => {
      if (elements.debugPanel) {
        elements.debugPanel.classList.add("hidden");
      }
    });
  }

  if (elements.manualSetor) {
    elements.manualSetor.addEventListener("change", () => {
      if (elements.manualSetor.value) {
        state.setor = elements.manualSetor.value;
        renderCountTable();
      }
      updateManualDependencies();
    });
  }

  if (elements.manualProduto) {
    elements.manualProduto.addEventListener("change", () => {
      updateManualDependencies();
    });
  }

  if (elements.manualMarca) {
    elements.manualMarca.addEventListener("change", () => {
      updateManualBoxesOptions();
    });
  }

  if (elements.manualTipo) {
    elements.manualTipo.addEventListener("change", () => {
      updateManualBoxesOptions();
    });
  }

  if (elements.manualAdd) {
    elements.manualAdd.addEventListener("click", () => {
      addManualItem();
    });
  }
}
