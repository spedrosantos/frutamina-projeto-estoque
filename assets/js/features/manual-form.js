// Formulario manual de lancamento e modal de edicao/remocao de item — so editar.html.
import { state, elements, supabaseClient } from "../core/state.js";
import {
  CONFIG_GERAL,
  NO_TIPO_VALUE,
  TIPO_MIN,
  TIPO_MAX,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TABLE_NAME,
} from "../core/config.js";
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
  listProductsBySetor,
  listBrands,
  setSelectOptionsWithPlaceholder,
  setNumberOptions,
  getRowKey,
} from "../core/utils.js";
import { normalizeInventoryMetrics, buildInventoryIdentityKey } from "../core/inventory-core.js";
import { requireAuthenticatedUser } from "../shell/auth-ui.js";
import { renderContext, renderCountTable } from "./tables.js";
import { probeSupabase, loadUserRecords, loadPublicRecords } from "../data/supabase-api.js";
import { replacePendingDelta } from "../data/pending-changes.js";
import { confirmAction } from "../shell/confirm-modal.js";
import { registerInventoryChange, clearVoiceActionState } from "./launch-core.js";

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
  // Na visao Estoque atual a linha exibida e o agregado publico, entao o registro
  // original com as colunas do banco vem de rawPublicRows.
  const source =
    state.countMode === "new"
      ? state.sessionRows
      : [...state.userRows, ...(state.rawPublicRows || [])];
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
    // Linha da visao Contagem: identidade do lancamento local que sera trocado.
    pendingKey: row ? buildInventoryIdentityKey(row) : "",
    // Linha agregada da visao Estoque atual: guarda os registros que a compoem
    // para a edicao consolidar todos num unico lancamento.
    sourceIds: Array.isArray(row?._sourceIds) ? row._sourceIds : [],
    ownId: row?.id || null,
  };
  setEditMessage("", "");

  if (elements.editTitle) {
    // So o texto: o icone do cabecalho vem do data-modal-icon e fica fora deste
    // span (ver modal-shell.js). Escrever a tag aqui duplicava o lapis.
    elements.editTitle.textContent = "Editar item";
  }

  if (elements.editSetor) {
    elements.editSetor.value = row?.setor || state.setor || "";
  }
  // As opcoes sao montadas a partir do setor e ja recebem os valores da linha:
  // produto, marca e tipo sao selects, entao so aceitam o que existe no
  // catalogo.
  updateEditDependencies({
    produto: row?.produto || "",
    marca: row?.marca || "",
    tipo: row?.tipo === 0 || row?.tipo ? row.tipo : "",
  });
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
          `Produto e marca cadastrados nos setores: ${info.setores.join(", ")}.`,
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
      setEditMessage("error", "Preencha tipo, caixas/pallet e pallets com valores validos.");
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
        renderContext();
      }
      renderCountTable();
      state.selectedRowKey = null;
      clearVoiceActionState();
      closeEditModal();
      return;
    }

    // Visao Contagem: a linha e um lancamento que ainda esta no aparelho, entao
    // editar so troca a fila - o estoque gravado nao entra nessa conta.
    if (state.countSource !== "estoque") {
      replacePendingDelta(state.editTarget.pendingKey, {
        setor,
        produto,
        marca,
        tipo: tipoFinal,
        caixas_pallet: normalizedMetrics.caixas_pallet,
        palletsDelta: normalizedMetrics.pallets,
        caixasAvulsasDelta: normalizedMetrics.caixas_avulsas,
      });
      clearTimeout(slowTimer);
      if (setor && state.setor !== setor) {
        state.setor = setor;
        renderContext();
      }
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

    // Visao "Estoque atual": a edicao vai direto para o banco. A contagem em
    // andamento nao passa por aqui - ela se corrige na propria visao Contagem.
    const finalPayload = {
      ...payload,
      ...(hasLooseBoxesColumn ? { caixas_avulsas: normalizedMetrics.caixas_avulsas } : {}),
    };
    const ownId = state.editTarget.ownId;
    const sourceIds = (state.editTarget.sourceIds || []).filter((id) => id !== ownId);
    // O item pode somar lancamentos de varios operadores, e a policy de update
    // do Supabase so deixa alterar as proprias linhas. Nesse caso o valor
    // corrigido vira UM lancamento seu e os antigos sao apagados (a policy de
    // delete e aberta a qualquer autenticado).
    if (sourceIds.length) {
      const consolidate = await confirmAction({
        title: "Consolidar item",
        message: `Este item soma ${sourceIds.length + (ownId ? 1 : 0)} lançamentos de operadores diferentes. Salvar vai substituir todos por um único lançamento seu.`,
        confirmLabel: "Substituir",
        danger: true,
      });
      if (!consolidate) return;
      const { error: deleteError } = await supabaseClient
        .from(TABLE_NAME)
        .delete()
        .in("id", sourceIds);
      if (deleteError) {
        setEditMessage("error", `Erro ao consolidar o item: ${deleteError.message}`);
        return;
      }
    }
    const { error: saveError } = ownId
      ? await supabaseClient
          .from(TABLE_NAME)
          .update(finalPayload)
          .eq("id", ownId)
          .eq("user_id", state.user.id)
      : await supabaseClient
          .from(TABLE_NAME)
          .upsert(finalPayload, { onConflict: "user_id,setor,produto,marca,tipo" });
    if (saveError) {
      setEditMessage("error", `Erro ao salvar alteração: ${saveError.message}`);
      return;
    }
    await loadUserRecords();
    await loadPublicRecords();
    pushMessage("success", "Item atualizado no estoque.");
    clearTimeout(slowTimer);
    if (setor && state.setor !== setor) {
      state.setor = setor;
      renderContext();
    }
    state.selectedRowKey = null;
    clearVoiceActionState();
    closeEditModal();
    return;
  } catch (error) {
    console.error("Erro ao salvar item:", error);
    setEditMessage("error", `Erro inesperado ao salvar. ${error?.message || "Tente novamente."}`);
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
  // Na visao Estoque atual a linha e o agregado do item: remover apaga TODOS os
  // registros que a compoem, inclusive de outros operadores (a policy de delete
  // do Supabase permite). Por isso o aviso extra quando ha mais de um.
  const sourceIds =
    Array.isArray(row?._sourceIds) && row._sourceIds.length ? row._sourceIds : [rowKey];
  const nome = isNoTipoContext(row?.produto, row?.marca)
    ? `${row.produto} ${row.marca}`
    : `${row.produto} ${row.marca} Tipo ${tipoLabel}`;
  const confirmDelete = await confirmAction({
    title: "Remover item",
    message:
      sourceIds.length > 1
        ? `Remover ${nome}? Ele soma ${sourceIds.length} lançamentos (de operadores diferentes) e todos serão apagados.`
        : `Remover ${nome} do estoque?`,
    confirmLabel: "Remover",
    danger: true,
  });
  if (!confirmDelete) return;

  if (state.countMode === "new") {
    state.sessionRows = state.sessionRows.filter((item) => getRowKey(item) !== rowKey);
    clearVoiceActionState();
    if (state.selectedRowKey === rowKey) {
      state.selectedRowKey = null;
    }
    renderCountTable();
    return;
  }

  if (!state.user) return;

  // Visao "Estoque atual": remove do banco na hora.
  const { error } = await supabaseClient.from(TABLE_NAME).delete().in("id", sourceIds);
  if (error) {
    pushMessage("error", `Erro ao remover item: ${error.message}`);
    return;
  }
  clearVoiceActionState();
  if (state.selectedRowKey === rowKey) {
    state.selectedRowKey = null;
  }
  await loadUserRecords();
  await loadPublicRecords();
  pushMessage("success", "Item removido do estoque.");
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

// Os dois formularios com contexto - o lancamento manual e o modal de edicao -
// tem os mesmos quatro campos em cascata. A logica vive aqui uma vez so,
// recebendo o conjunto de elementos. Antes existia so no manual, e por isso o
// modal de edicao era texto livre: dava para digitar marca que nao existe.
const uiManual = () => ({
  setor: elements.manualSetor,
  produto: elements.manualProduto,
  marca: elements.manualMarca,
  tipo: elements.manualTipo,
});

const uiEdit = () => ({
  setor: elements.editSetor,
  produto: elements.editProduto,
  marca: elements.editMarca,
  tipo: elements.editTipo,
});

function preencherTipoSelect(ui, tipoDesejado) {
  if (!ui.tipo || !ui.produto || !ui.marca) return;
  const produto = ui.produto.value;
  const marca = ui.marca.value;
  const atual =
    tipoDesejado === undefined || tipoDesejado === null ? ui.tipo.value : String(tipoDesejado);

  if (isNoTipoContext(produto, marca)) {
    ui.tipo.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "S/T";
    ui.tipo.appendChild(option);
    ui.tipo.disabled = true;
    return;
  }

  ui.tipo.disabled = false;
  if (hasSpecialTipoVariants(produto)) {
    ui.tipo.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Selecione";
    ui.tipo.appendChild(empty);
    buildTipoOptionList(produto).forEach((tipoOption) => {
      const option = document.createElement("option");
      option.value = tipoOption.value;
      option.textContent = tipoOption.label;
      ui.tipo.appendChild(option);
    });
    ui.tipo.value = atual && ui.tipo.querySelector(`option[value="${atual}"]`) ? atual : "";
    return;
  }

  setNumberOptions(ui.tipo, TIPO_MIN, TIPO_MAX, atual, "Selecione");
}

// Refaz produto, marca e tipo a partir do setor. Sem valores informados mantem
// o que ja estava escolhido, quando a opcao continua existindo.
function preencherCascata(ui, valores = {}) {
  if (!ui.setor || !ui.produto || !ui.marca) return;
  const setor = ui.setor.value;
  setSelectOptionsWithPlaceholder(
    ui.produto,
    listProductsBySetor(setor),
    valores.produto ?? ui.produto.value,
    "Selecione",
  );
  setSelectOptionsWithPlaceholder(
    ui.marca,
    listBrands(setor, ui.produto.value),
    valores.marca ?? ui.marca.value,
    "Selecione",
  );
  preencherTipoSelect(ui, valores.tipo);
}

function calcularCaixasPallet(ui) {
  const setor = ui.setor?.value;
  const produto = ui.produto?.value;
  const marca = ui.marca?.value;
  if (!setor || !produto || !marca) return 0;
  const regra = CONFIG_GERAL[setor]?.[produto]?.[marca];
  if (!regra) return 0;
  const noTipo = isNoTipoContext(produto, marca);
  const tipo = noTipo ? NO_TIPO_VALUE : parseTipoInputValue(ui.tipo?.value, produto);
  if (!noTipo && !isTipoValidForContext(produto, tipo)) return 0;
  return toNonNegativeInt(regra(getTipoRuleValue(produto, tipo)), 0);
}

function updateManualTipoOptions() {
  preencherTipoSelect(uiManual());
  updateManualBoxesOptions();
}

function getManualCaixasPallet() {
  return calcularCaixasPallet(uiManual());
}

// Trocar de marca ou tipo muda quantas caixas cabem no pallet; sem isto o campo
// ficaria com o numero da combinacao anterior e salvaria a conta errada.
export function updateEditDependencies(valores) {
  preencherCascata(uiEdit(), valores);
  if (!elements.editCaixas) return;
  const caixas = calcularCaixasPallet(uiEdit());
  if (caixas > 0) {
    elements.editCaixas.value = caixas;
  }
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
  setSelectOptionsWithPlaceholder(elements.manualSetor, setores, state.setor || "", "Selecione");
  setSelectOptionsWithPlaceholder(
    elements.manualProduto,
    listProductsBySetor(elements.manualSetor.value),
    "",
    "Selecione",
  );
  setSelectOptionsWithPlaceholder(
    elements.manualMarca,
    listBrands(elements.manualSetor.value, elements.manualProduto.value),
    "",
    "Selecione",
  );
  updateManualTipoOptions();
  setNumberOptions(elements.manualPallets, 0, 50, 0);
  updateManualBoxesOptions();
}

export function updateManualDependencies() {
  preencherCascata(uiManual());
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
    successSubject: noTipo ? `${produto} ${marca}` : `${produto} ${marca} Tipo ${tipoLabel}`,
    actionKind: caixasAvulsas > 0 ? "boxes" : "pallets",
    correctionMode: caixasAvulsas > 0 || pallets > 1 || noTipo ? "quantity" : "type",
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

  [elements.editSetor, elements.editProduto, elements.editMarca].forEach((campo) => {
    if (!campo) return;
    campo.addEventListener("change", () => updateEditDependencies());
  });

  if (elements.editTipo) {
    elements.editTipo.addEventListener("change", () => updateEditDependencies());
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
