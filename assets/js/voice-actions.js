// Nucleo do lancamento de estoque: desfazer/corrigir ultimo lancamento, parser de
// comando (voz e texto) e registro do item no modo atual ou na nova contagem.
// Import dinamico para saveNewCount/discardNewCount (count-mode.js): esse modulo so
// existe em editar.html, mas processCommand tambem roda em index.html (comando por
// texto). Os comandos "salvar"/"descartar" so sao alcancados quando countMode==="new",
// o que nunca acontece em index.html (nao ha modo "nova contagem" fora de editar.html).
import { state, elements, supabaseClient } from "./state.js";
// Trava para evitar que um novo comando (voz/texto) rode enquanto um
// registro/remocao/correcao anterior ainda esta salvando no servidor: sem
// isso, um comando falado logo apos outro pode agir sobre o lancamento
// errado, pois state.lastLaunch so atualiza apos o round-trip de rede
// terminar.
let isSavingLaunch = false;
import {
  CONFIG_GERAL,
  NO_TIPO_VALUE,
  NUMBER_WORDS,
  ADD_KEYWORDS,
  BOX_KEYWORDS,
  REMOVE_KEYWORDS,
  CORRECT_KEYWORDS,
  LAUNCH_KEYWORDS,
  SAVE_KEYWORDS,
  DISCARD_KEYWORDS,
  TABLE_NAME,
  SUPABASE_TIMEOUT_MS,
  TIPO_MIN,
  TIPO_MAX,
} from "./config.js";
import {
  toNonNegativeInt,
  normalizeText,
  tokenizeText,
  formatTipoLabelValue,
  isNoTipoContext,
  isNoTipoProduct,
  getTipoRuleValue,
  isTipoValidForContext,
  hasSpecialTipoVariants,
  getTipoExampleHint,
  getTipoValidationMessage,
  isSpecialTipoVariantValue,
  getTipoSortOrder,
  buildNormalizedMap,
  findExactMatch,
  matchSpecialTipoAtTokens,
  pushMessage,
  withTimeout,
  getRowKey,
} from "./utils.js";
import {
  hydrateInventoryRow,
  normalizeInventoryMetrics,
  buildDbRowPayload,
  isLooseBoxesSchemaError,
  getInventoryRowByIdentity,
  formatInventoryMessage,
} from "./inventory-core.js";
import { requireAuthenticatedUser } from "./auth-ui.js";
import { renderContext, renderCountTable, updateSessionAggregateRecord } from "./tables.js";
import { loadUserRecords, loadPublicRecords } from "./supabase-api.js";
import { queuePendingDelta, undoLastPending } from "./pending-changes.js";
import {
  registerInventoryChange,
  clearVoiceActionState,
  buildLaunchRecord,
  setLastLaunch,
} from "./launch-core.js";



// ===== Estruturas auxiliares para desfazer/remover/corrigir o ultimo lancamento =====

function getLaunchItemLabel(item) {
  if (!item) return "ultimo lancamento";
  const tipoLabel = formatTipoLabelValue(item.produto, item.tipo, item.marca);
  if (isNoTipoContext(item.produto, item.marca)) {
    return `${item.produto} ${item.marca}`;
  }
  return `${item.produto} ${item.marca} Tipo ${tipoLabel}`;
}

function describeLaunchRecord(record) {
  if (!record?.items?.length) return "ultimo lancamento";
  if (record.items.length === 1) {
    const item = record.items[0];
    return `${getLaunchItemLabel(item)} (${formatInventoryMessage(
      item.palletsDelta,
      item.caixasAvulsasDelta
    )})`;
  }
  return `${record.items.length} itens do ultimo lancamento`;
}

function getCorrectionPrompt(record) {
  if (!record) return "";
  if (record.correctionMode === "type") {
    return "Diga o tipo correto para substituir o ultimo lancamento.";
  }
  if (record.correctionMode === "quantity") {
    return record.actionKind === "boxes"
      ? "Diga a quantidade correta de caixas avulsas."
      : "Diga a quantidade correta para substituir o ultimo lancamento.";
  }
  return "Esse ultimo lancamento nao pode ser corrigido por voz. Use REMOVER e repita o comando.";
}

function buildRowFromTotal(row, totalCaixas) {
  const baseRow = hydrateInventoryRow(row);
  const nextTotal = toNonNegativeInt(totalCaixas, 0);
  if (nextTotal <= 0) return null;
  const metrics = normalizeInventoryMetrics({
    caixasPallet: baseRow.caixas_pallet,
    totalCaixas: nextTotal,
  });
  return {
    ...baseRow,
    ...metrics,
  };
}

function findSessionRowByKey(key) {
  return state.sessionRows.find((row) => getRowKey(row) === key);
}

function revertLaunchInSession(record) {
  if (!record?.items?.length) return false;

  for (const item of record.items) {
    const row = getInventoryRowByIdentity(state.sessionRows, item);
    if (!row) {
      pushMessage("warn", "Nao encontrei o item do ultimo lancamento para remover.");
      return false;
    }
    const nextRow = buildRowFromTotal(row, row.total_caixas - item.totalCaixasDelta);
    if (!nextRow) {
      state.sessionRows = state.sessionRows.filter(
        (current) => getRowKey(current) !== getRowKey(row)
      );
    } else {
      row.caixas_pallet = nextRow.caixas_pallet;
      row.pallets = nextRow.pallets;
      row.caixas_avulsas = nextRow.caixas_avulsas;
      row.total_caixas = nextRow.total_caixas;
    }
  }

  if (state.selectedRowKey && !findSessionRowByKey(state.selectedRowKey)) {
    state.selectedRowKey = null;
  }

  renderCountTable();
  return true;
}

async function revertLaunchInCurrentCount(record) {
  if (!record?.items?.length || !state.user) return false;

  // O lancamento ainda esta na fila: basta tira-lo de la, sem tocar no banco.
  if (undoLastPending()) {
    return true;
  }

  for (const item of record.items) {
    const currentRow = getInventoryRowByIdentity(state.userRows, item);
    if (!currentRow?.id) {
      pushMessage("warn", "Nao encontrei o item do ultimo lancamento para remover.");
      return false;
    }

    const nextRow = buildRowFromTotal(
      currentRow,
      currentRow.total_caixas - item.totalCaixasDelta
    );

    if (!nextRow) {
      const deleteResult = await withTimeout(
        supabaseClient
          .from(TABLE_NAME)
          .delete()
          .eq("id", currentRow.id)
          .eq("user_id", state.user.id),
        SUPABASE_TIMEOUT_MS,
        "Tempo limite ao remover o ultimo lancamento."
      );

      if (deleteResult?.error) {
        pushMessage(
          "error",
          `Erro ao remover o ultimo lancamento: ${deleteResult.error.message}`
        );
        return false;
      }
    } else {
      const payload = buildDbRowPayload(
        {
          ...nextRow,
          user_id: state.user.id,
        },
        false,
        currentRow.caixas_avulsas > 0 || nextRow.caixas_avulsas > 0
      );

      const updateResult = await withTimeout(
        supabaseClient
          .from(TABLE_NAME)
          .update(payload)
          .eq("id", currentRow.id)
          .eq("user_id", state.user.id),
        SUPABASE_TIMEOUT_MS,
        "Tempo limite ao atualizar o ultimo lancamento."
      );

      if (updateResult?.error) {
        const message = isLooseBoxesSchemaError(updateResult.error)
          ? "Erro ao corrigir o ultimo lancamento: rode a migracao de caixas avulsas no Supabase."
          : `Erro ao corrigir o ultimo lancamento: ${updateResult.error.message}`;
        pushMessage("error", message);
        return false;
      }
    }
  }

  await loadUserRecords();
  await loadPublicRecords();
  return true;
}

async function revertLaunchRecord(record) {
  if (!record?.items?.length) {
    pushMessage("warn", "Nao ha ultimo lancamento para remover.");
    return false;
  }

  if (record.mode !== state.countMode) {
    pushMessage(
      "warn",
      record.mode === "new"
        ? "Volte para a nova contagem para remover esse ultimo lancamento."
        : "Volte para a contagem atual para remover esse ultimo lancamento."
    );
    return false;
  }

  if (state.countMode === "new") {
    return revertLaunchInSession(record);
  }

  return revertLaunchInCurrentCount(record);
}

async function removeLastLaunchCommand() {
  if (!state.lastLaunch) {
    pushMessage("warn", "Nao ha ultimo lancamento para remover.");
    return false;
  }

  isSavingLaunch = true;
  try {
    const removed = await revertLaunchRecord(state.lastLaunch);
    if (!removed) return false;

    pushMessage("success", `Ultimo lancamento removido: ${describeLaunchRecord(state.lastLaunch)}.`);
    clearVoiceActionState();
    return true;
  } finally {
    isSavingLaunch = false;
  }
}

function hasBoxKeyword(text) {
  return tokenizeText(text).some((token) => BOX_KEYWORDS.has(token));
}


function beginVoiceCorrection() {
  if (!state.lastLaunch) {
    pushMessage("warn", "Nao ha ultimo lancamento para corrigir.");
    return false;
  }

  if (state.lastLaunch.mode !== state.countMode) {
    pushMessage(
      "warn",
      state.lastLaunch.mode === "new"
        ? "Volte para a nova contagem para corrigir esse ultimo lancamento."
        : "Volte para a contagem atual para corrigir esse ultimo lancamento."
    );
    return false;
  }

  if (
    !state.lastLaunch.correctionMode ||
    state.lastLaunch.correctionMode === "batch" ||
    state.lastLaunch.items.length !== 1
  ) {
    pushMessage("warn", getCorrectionPrompt(state.lastLaunch));
    return false;
  }

  state.pendingCorrection = {
    ...JSON.parse(JSON.stringify(state.lastLaunch)),
  };
  pushMessage("info", getCorrectionPrompt(state.pendingCorrection));
  return true;
}

// ===== Parser de comando (voz e texto) =====

function buildIgnoredTokenIndexes(tokens, ignoredValues = []) {
  const ignoredIndexes = new Set();

  (ignoredValues || []).forEach((value) => {
    const sequence = tokenizeText(value);
    if (!sequence.length || sequence.length > tokens.length) return;

    for (let i = 0; i <= tokens.length - sequence.length; i += 1) {
      let match = true;
      for (let j = 0; j < sequence.length; j += 1) {
        if (tokens[i + j] !== sequence[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        for (let j = 0; j < sequence.length; j += 1) {
          ignoredIndexes.add(i + j);
        }
        break;
      }
    }
  });

  return ignoredIndexes;
}

function extractCommandTokens(text, ignoredValues = []) {
  const tokens = tokenizeText(text);
  if (!tokens.length) return [];

  const ignoredIndexes = buildIgnoredTokenIndexes(tokens, ignoredValues);

  return tokens.filter((token, index) => !ignoredIndexes.has(index));
}

function extractCommandNumbers(text, ignoredValues = [], produto = "") {
  const tokens = extractCommandTokens(text, ignoredValues);
  if (!tokens.length) return [];

  return tokens.reduce((results, token, index) => {
    const specialMatch = matchSpecialTipoAtTokens(produto, tokens, index);
    if (specialMatch) {
      return results;
    }
    if (/^\d+$/.test(token)) {
      results.push(Number.parseInt(token, 10));
      return results;
    }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) {
      results.push(NUMBER_WORDS[token]);
    }
    return results;
  }, []);
}

function extractCommandTipoValues(text, produto, ignoredValues = []) {
  if (!produto) return [];
  const tokens = extractCommandTokens(text, ignoredValues);
  if (!tokens.length) return [];

  const results = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const specialMatch = matchSpecialTipoAtTokens(produto, tokens, index);
    if (specialMatch) {
      results.push(specialMatch.value);
      index += specialMatch.length - 1;
      continue;
    }

    const token = tokens[index];
    if (/^\d+$/.test(token)) {
      results.push(Number.parseInt(token, 10));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) {
      results.push(NUMBER_WORDS[token]);
    }
  }

  return results;
}

function isAddCommand(text) {
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  return tokens.some((token) => ADD_KEYWORDS.has(token));
}

function isRemoveCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => REMOVE_KEYWORDS.has(token));
}

function isCorrectCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => CORRECT_KEYWORDS.has(token));
}

function isLaunchCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => LAUNCH_KEYWORDS.has(token));
}

function isSaveCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => SAVE_KEYWORDS.has(token));
}

function isDiscardCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => DISCARD_KEYWORDS.has(token));
}

/**
 * Quando o reconhecedor de voz une dois números falados rapidamente
 * (ex: "5" + "6" -> "56"), este utilitário decompõe o número resultante
 * de volta em tipos válidos. Tenta primeiro pares de 2 dígitos (para
 * recuperar tipos de 2 casas, ex: "12" + "12" -> "1212"), e só cai para
 * 1 dígito quando o par não forma um tipo válido para o produto.
 */
function splitOversizedTipoNumbers(values, produto) {
  const result = [];
  for (const value of values) {
    if (value >= TIPO_MIN && value <= TIPO_MAX) {
      result.push(value);
      continue;
    }
    if (value <= TIPO_MAX) continue;
    const digits = String(value).split("").map(Number);
    let i = 0;
    while (i < digits.length) {
      const twoDigit = digits[i] * 10 + digits[i + 1];
      if (
        i + 1 < digits.length &&
        twoDigit >= TIPO_MIN &&
        twoDigit <= TIPO_MAX &&
        isTipoValidForContext(produto, twoDigit)
      ) {
        result.push(twoDigit);
        i += 2;
        continue;
      }
      if (digits[i] >= TIPO_MIN && digits[i] <= TIPO_MAX) {
        result.push(digits[i]);
      }
      i += 1;
    }
  }
  return result;
}

function buildMaps(setor) {
  const products = CONFIG_GERAL[setor] || {};
  const productMap = buildNormalizedMap(Object.keys(products));
  return { products, productMap };
}

function buildBrandMap(products, product) {
  return buildNormalizedMap(Object.keys(products?.[product] || {}));
}

function buildAllBrandMap(products) {
  const allBrands = [];
  Object.keys(products || {}).forEach((product) => {
    allBrands.push(...Object.keys(products[product] || {}));
  });
  return buildNormalizedMap(allBrands);
}

function formatTipoCounts(tipoCounts, produto, marca = "") {
  return Array.from(tipoCounts.entries())
    .sort(
      (a, b) => getTipoSortOrder(produto, a[0]) - getTipoSortOrder(produto, b[0])
    )
    .map(([tipo, count]) => {
      const tipoLabel = formatTipoLabelValue(produto, tipo, marca);
      return count > 1 ? `${tipoLabel}x${count}` : String(tipoLabel);
    })
    .join(", ");
}

async function handlePendingCorrection(rawText) {
  const correction = state.pendingCorrection;
  if (!correction?.items?.length) return false;

  const item = correction.items[0];
  const numericValues = extractCommandNumbers(rawText, [
    item.setor,
    item.produto,
    item.marca,
  ], item.produto)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const tipoValues = extractCommandTipoValues(
    rawText,
    item.produto,
    [item.setor, item.produto, item.marca]
  ).filter((value) => Number.isFinite(value) && value > 0);
  const setor = item.setor;
  const produto = item.produto;
  const marca = item.marca;
  const noTipo = isNoTipoContext(produto, marca);
  const regra = CONFIG_GERAL[setor]?.[produto]?.[marca];

  if (!regra) {
    pushMessage("error", "Nao encontrei a regra do ultimo lancamento para corrigir.");
    state.pendingCorrection = null;
    return true;
  }

  let nextParams = null;

  if (correction.correctionMode === "type") {
    const tipoCorrigido = tipoValues.find((value) =>
      isTipoValidForContext(produto, value)
    );
    if (!Number.isFinite(tipoCorrigido)) {
      pushMessage(
        "warn",
        hasSpecialTipoVariants(produto)
          ? `Diga o tipo correto para corrigir o ultimo lancamento (ex: ${getTipoExampleHint(produto)}).`
          : "Diga o tipo correto para corrigir o ultimo lancamento."
      );
      return true;
    }

    const tipoLabel = formatTipoLabelValue(produto, tipoCorrigido, marca);
    nextParams = {
      setor,
      produto,
      marca,
      tipo: tipoCorrigido,
      caixasPallet: regra(getTipoRuleValue(produto, tipoCorrigido)),
      palletsDelta: item.palletsDelta || 1,
      caixasAvulsasDelta: item.caixasAvulsasDelta || 0,
      successPrefix: "Corrigido",
      successSubject: `${produto} ${marca} Tipo ${tipoLabel}`,
      actionKind:
        item.caixasAvulsasDelta > 0
          ? "boxes"
          : item.palletsDelta > 1
            ? "pallets"
            : "pallets",
      correctionMode:
        item.caixasAvulsasDelta > 0 || item.palletsDelta > 1
          ? "quantity"
          : "type",
    };
  } else if (correction.correctionMode === "quantity") {
    if (!numericValues.length) {
      pushMessage(
        "warn",
        correction.actionKind === "boxes"
          ? "Diga a quantidade correta de caixas avulsas."
          : "Diga a quantidade correta para substituir o ultimo lancamento."
      );
      return true;
    }

    const quantidade = numericValues[numericValues.length - 1];
    if (correction.actionKind === "boxes") {
      const tipoLabel = formatTipoLabelValue(produto, item.tipo, marca);
      nextParams = {
        setor,
        produto,
        marca,
        tipo: noTipo ? NO_TIPO_VALUE : item.tipo,
        caixasPallet: regra(
          noTipo ? NO_TIPO_VALUE : getTipoRuleValue(produto, item.tipo)
        ),
        palletsDelta: 0,
        caixasAvulsasDelta: quantidade,
        successPrefix: "Corrigido",
        successSubject: noTipo
          ? `${produto} ${marca}`
          : `${produto} ${marca} Tipo ${tipoLabel}`,
        actionKind: "boxes",
        correctionMode: "quantity",
      };
    } else {
      const tipoLabel = formatTipoLabelValue(produto, item.tipo, marca);
      nextParams = {
        setor,
        produto,
        marca,
        tipo: noTipo ? NO_TIPO_VALUE : item.tipo,
        caixasPallet: regra(
          noTipo ? NO_TIPO_VALUE : getTipoRuleValue(produto, item.tipo)
        ),
        palletsDelta: quantidade,
        caixasAvulsasDelta: 0,
        successPrefix: "Corrigido",
        successSubject: noTipo
          ? `${produto} ${marca}`
          : `${produto} ${marca} Tipo ${tipoLabel}`,
        actionKind: "pallets",
        correctionMode: quantidade > 1 || noTipo ? "quantity" : "type",
      };
    }
  }

  if (!nextParams) {
    pushMessage("warn", "Nao consegui entender a correcao do ultimo lancamento.");
    return true;
  }

  isSavingLaunch = true;
  try {
    const reverted = await revertLaunchRecord(correction);
    if (!reverted) return true;

    state.pendingCorrection = null;
    state.setor = setor;
    state.produto = produto;
    state.marca = marca;
    state.tipo = nextParams.tipo;
    if (elements.setorSelect) {
      elements.setorSelect.value = setor;
    }
    renderContext();

    const corrected = await registerInventoryChange(nextParams);
    if (!corrected) {
      pushMessage(
        "warn",
        "O ultimo lancamento foi removido, mas a correcao nao foi aplicada. Repita o comando."
      );
    }
    return true;
  } finally {
    isSavingLaunch = false;
  }
}

/**
 * Interpreta o comando final (voz ou texto).
 * Ordem da leitura:
 * - comandos especiais (remover/corrigir/salvar/descartar);
 * - travas de contexto (setor/produto/marca);
 * - tipo e quantidade;
 * - gravacao do item no modo atual ou na nova contagem.
 */
export async function processCommand(rawText) {
  if (!requireAuthenticatedUser("Faça login para usar comandos de voz.")) {
    return;
  }
  if (isSavingLaunch) {
    pushMessage("warn", "Aguarde, salvando o registro anterior...");
    return;
  }

  const tokens = tokenizeText(rawText);
  if (!tokens.length) return;

  if (isRemoveCommand(rawText)) {
    state.pendingCorrection = null;
    await removeLastLaunchCommand();
    renderContext();
    return;
  }

  if (isCorrectCommand(rawText)) {
    beginVoiceCorrection();
    renderContext();
    return;
  }

  if (isLaunchCommand(rawText) || isSaveCommand(rawText)) {
    if (state.countMode !== "new") {
      pushMessage("warn", "Voce nao esta em modo de nova contagem. Mude para nova contagem primeiro.");
      renderContext();
      return;
    }
    if (!state.sessionRows.length) {
      pushMessage("warn", "Nenhum item na nova contagem para salvar.");
      renderContext();
      return;
    }
    pushMessage("info", "Salvando estoque...");
    const { saveNewCount } = await import("./count-mode.js");
    await saveNewCount();
    return;
  }

  if (isDiscardCommand(rawText)) {
    if (state.countMode !== "new") {
      pushMessage("warn", "Voce nao esta em modo de nova contagem.");
      renderContext();
      return;
    }
    if (!state.sessionRows.length) {
      pushMessage("warn", "Nenhum item na nova contagem para descartar.");
      renderContext();
      return;
    }
    pushMessage("info", "Descartando rascunho...");
    const { discardNewCount } = await import("./count-mode.js");
    await discardNewCount();
    return;
  }

  if (state.pendingCorrection) {
    const handled = await handlePendingCorrection(rawText);
    if (handled) {
      renderContext();
      return;
    }
  }

  const sectorMap = buildNormalizedMap(Object.keys(CONFIG_GERAL));
  const sectorFound = findExactMatch(tokens, sectorMap);
  if (sectorFound) {
    const changed = sectorFound !== state.setor;
    state.setor = sectorFound;
    if (changed) {
      state.produto = null;
      state.marca = null;
      state.tipo = null;
    }
    pushMessage("info", `Setor fixado: ${sectorFound}`);
  }

  const { products, productMap } = buildMaps(state.setor);
  const productFound = findExactMatch(tokens, productMap);
  if (productFound) {
    const changed = productFound !== state.produto;
    state.produto = productFound;
    if (changed) {
      state.marca = null;
      state.tipo = null;
    }
    pushMessage("info", `Produto fixado: ${productFound}`);
  }

  let brandFound = null;
  if (state.produto) {
    const brandMap = buildBrandMap(products, state.produto);
    brandFound = findExactMatch(tokens, brandMap);
    if (brandFound) {
      const changed = brandFound !== state.marca;
      state.marca = brandFound;
      if (changed) {
        state.tipo = null;
      }
      pushMessage(
        "info",
        /\bKG\b/.test(normalizeText(brandFound)) && !isNoTipoProduct(state.produto)
          ? `Marca fixada: ${brandFound}. Agora diga o tipo.`
          : `Marca fixada: ${brandFound}`
      );
    }
  } else {
    const anyBrand = findExactMatch(tokens, buildAllBrandMap(products));
    if (anyBrand) {
      pushMessage("warn", "Diga o produto antes da marca.");
    }
  }

  const ignoredValues = [
    sectorFound,
    productFound,
    brandFound,
    state.setor,
    state.produto,
    state.marca,
  ];
  const numericValues = extractCommandNumbers(rawText, ignoredValues, state.produto)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const noTipo = isNoTipoContext(state.produto, state.marca);
  const addCommand = isAddCommand(rawText);
  const boxCommand = hasBoxKeyword(rawText);
  const rawTipoValues = extractCommandTipoValues(
    rawText,
    state.produto,
    ignoredValues
  ).filter((value) => Number.isFinite(value) && value > 0);
  const tipoValues = (!addCommand && !boxCommand)
    ? splitOversizedTipoNumbers(rawTipoValues, state.produto)
    : rawTipoValues;
  const specialTipos = tipoValues.filter((value) =>
    isSpecialTipoVariantValue(state.produto, value)
  );

  if (boxCommand && !numericValues.length) {
    pushMessage("warn", "Diga a quantidade de caixas.");
    renderContext();
    return;
  }

  if (boxCommand) {
    if (!state.produto || !state.marca) {
      pushMessage(
        "warn",
        "Diga primeiro o produto e a marca antes de adicionar caixas."
      );
      renderContext();
      return;
    }

    const regra = products[state.produto]?.[state.marca];
    if (!regra) {
      pushMessage(
        "error",
        `Essa marca '${state.marca}' nao tem regra para o produto '${state.produto}'.`
      );
      renderContext();
      return;
    }

    let tipoParaAdicionar = noTipo ? NO_TIPO_VALUE : state.tipo;

    if (!noTipo && specialTipos.length) {
      tipoParaAdicionar = specialTipos[specialTipos.length - 1];
      state.tipo = tipoParaAdicionar;
    } else if (!noTipo && numericValues.length >= 2) {
      const candidateTipo = numericValues[0];
      if (isTipoValidForContext(state.produto, candidateTipo)) {
        tipoParaAdicionar = candidateTipo;
        state.tipo = candidateTipo;
      }
    }

    if (!noTipo && !Number.isFinite(tipoParaAdicionar)) {
      pushMessage(
        "warn",
        hasSpecialTipoVariants(state.produto)
          ? `Diga o tipo primeiro (ex: ${getTipoExampleHint(state.produto)}) para somar caixas avulsas.`
          : "Diga o tipo primeiro (ex: REI 4) para somar caixas avulsas."
      );
      renderContext();
      return;
    }
    if (!noTipo && !isTipoValidForContext(state.produto, tipoParaAdicionar)) {
      pushMessage("warn", getTipoValidationMessage(state.produto));
      renderContext();
      return;
    }

    const caixasAvulsasDelta = numericValues[numericValues.length - 1];
    const caixasPallet = regra(getTipoRuleValue(state.produto, tipoParaAdicionar));
    const tipoLabel = formatTipoLabelValue(
      state.produto,
      tipoParaAdicionar,
      state.marca
    );

    await registerInventoryChange({
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo: tipoParaAdicionar,
      caixasPallet,
      caixasAvulsasDelta,
      successPrefix: "Registrado",
      successSubject: noTipo
        ? `${state.produto} ${state.marca}`
        : `${state.produto} ${state.marca} Tipo ${tipoLabel}`,
      actionKind: "boxes",
      correctionMode: "quantity",
    });

    renderContext();
    return;
  }

  if (addCommand && !numericValues.length) {
    pushMessage("warn", "Diga a quantidade para adicionar.");
    renderContext();
    return;
  }

  if (addCommand && numericValues.length) {
    if (!state.produto || !state.marca) {
      pushMessage(
        "warn",
        "Diga primeiro o produto e a marca antes de adicionar quantidade."
      );
      renderContext();
      return;
    }

    const regra = products[state.produto]?.[state.marca];
    if (!regra) {
      pushMessage(
        "error",
        `Essa marca '${state.marca}' nao tem regra para o produto '${state.produto}'.`
      );
      renderContext();
      return;
    }

    const quantity = numericValues[numericValues.length - 1];
    let tipoParaAdicionar = noTipo ? NO_TIPO_VALUE : state.tipo;

    if (!noTipo && specialTipos.length) {
      tipoParaAdicionar = specialTipos[specialTipos.length - 1];
      state.tipo = tipoParaAdicionar;
    } else if (!noTipo && numericValues.length >= 2) {
      const candidateTipo = numericValues[0];
      if (isTipoValidForContext(state.produto, candidateTipo)) {
        tipoParaAdicionar = candidateTipo;
        state.tipo = candidateTipo;
      }
    }

    if (!noTipo && !Number.isFinite(tipoParaAdicionar)) {
      pushMessage(
        "warn",
        hasSpecialTipoVariants(state.produto)
          ? `Diga o tipo primeiro (ex: ${getTipoExampleHint(state.produto)}) para usar 'adicionar'.`
          : "Diga o tipo primeiro (ex: REI 4) para usar 'adicionar'."
      );
      renderContext();
      return;
    }
    if (!noTipo && !isTipoValidForContext(state.produto, tipoParaAdicionar)) {
      pushMessage("warn", getTipoValidationMessage(state.produto));
      renderContext();
      return;
    }

    const caixasPallet = regra(getTipoRuleValue(state.produto, tipoParaAdicionar));
    const palletsDelta = quantity;
    const tipoLabel = formatTipoLabelValue(
      state.produto,
      tipoParaAdicionar,
      state.marca
    );

    await registerInventoryChange({
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo: tipoParaAdicionar,
      caixasPallet,
      palletsDelta,
      successPrefix: "Adicionado",
      successSubject: noTipo
        ? `${state.produto} ${state.marca}`
        : `${state.produto} ${state.marca} Tipo ${tipoLabel}`,
      actionKind: "pallets",
      correctionMode: "quantity",
    });

    renderContext();
    return;
  }

  if (noTipo && brandFound && !numericValues.length) {
    const regra = products[state.produto]?.[state.marca];
    if (!regra) {
      pushMessage(
        "error",
        `Essa marca '${state.marca}' nao tem regra para o produto '${state.produto}'.`
      );
      renderContext();
      return;
    }

    const caixasPallet = regra(NO_TIPO_VALUE);
    state.tipo = NO_TIPO_VALUE;

    await registerInventoryChange({
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo: NO_TIPO_VALUE,
      caixasPallet,
      palletsDelta: 1,
      successPrefix: "Registrado",
      successSubject: `${state.produto} ${state.marca}`,
      actionKind: "pallets",
      correctionMode: "quantity",
    });

    renderContext();
    return;
  }

  // Dizer so o tipo especial (ex: "6A"/"6B") sem nenhum numero solto: os
  // tokens do tipo especial sao excluidos de numericValues de proposito (pra
  // nao contaminar as outras branches com o "6" cru), entao sem este bloco a
  // fala nao registra nada — diferente de um tipo comum (ex: so "4"), que ja
  // conta como 1 pallet por aparecer tambem em numericValues.
  if (!noTipo && specialTipos.length && !numericValues.length) {
    if (!state.produto || !state.marca) {
      pushMessage(
        "warn",
        "Diga primeiro o produto e a marca antes de informar o tipo."
      );
      renderContext();
      return;
    }

    const regra = products[state.produto]?.[state.marca];
    if (!regra) {
      pushMessage(
        "error",
        `Essa marca '${state.marca}' nao tem regra para o produto '${state.produto}'.`
      );
      renderContext();
      return;
    }

    const tipoParaAdicionar = specialTipos[specialTipos.length - 1];
    state.tipo = tipoParaAdicionar;
    const caixasPallet = regra(getTipoRuleValue(state.produto, tipoParaAdicionar));
    const tipoLabel = formatTipoLabelValue(state.produto, tipoParaAdicionar, state.marca);

    await registerInventoryChange({
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo: tipoParaAdicionar,
      caixasPallet,
      palletsDelta: 1,
      successPrefix: "Registrado",
      successSubject: `${state.produto} ${state.marca} Tipo ${tipoLabel}`,
      actionKind: "pallets",
      correctionMode: "quantity",
    });

    renderContext();
    return;
  }

  if (numericValues.length) {
    if (!state.produto || !state.marca) {
      pushMessage(
        "warn",
        "Diga primeiro o produto e a marca antes de informar o numero."
      );
      renderContext();
      return;
    }

    const regra = products[state.produto]?.[state.marca];
    if (!regra) {
      pushMessage(
        "error",
        `Essa marca '${state.marca}' nao tem regra para o produto '${state.produto}'.`
      );
      renderContext();
      return;
    }

    if (noTipo) {
      const palletsTotal = numericValues.reduce((acc, value) => acc + value, 0);

      if (!palletsTotal) {
        renderContext();
        return;
      }

      const caixasPallet = regra(NO_TIPO_VALUE);
      state.tipo = NO_TIPO_VALUE;

      await registerInventoryChange({
        setor: state.setor,
        produto: state.produto,
        marca: state.marca,
        tipo: NO_TIPO_VALUE,
        caixasPallet,
        palletsDelta: palletsTotal,
        successPrefix: "Registrado",
        successSubject: `${state.produto} ${state.marca}`,
        actionKind: "pallets",
        correctionMode: "quantity",
      });

      renderContext();
      return;
    }

    const tiposValid = tipoValues.filter((value) =>
      isTipoValidForContext(state.produto, value)
    );

    if (!tiposValid.length) {
      pushMessage("warn", getTipoValidationMessage(state.produto));
      renderContext();
      return;
    }

    const tipoCounts = new Map();
    tiposValid.forEach((tipo) => {
      tipoCounts.set(tipo, (tipoCounts.get(tipo) || 0) + 1);
    });

    if (!tipoCounts.size) {
      renderContext();
      return;
    }

    for (let i = tiposValid.length - 1; i >= 0; i -= 1) {
      const lastTipo = tiposValid[i];
      if (Number.isFinite(lastTipo)) {
        state.tipo = lastTipo;
        break;
      }
    }

    const tipoLabel = formatTipoCounts(
      tipoCounts,
      state.produto,
      state.marca
    );
    const launchItems = Array.from(tipoCounts.entries()).map(([tipo, count]) => ({
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo,
      caixasPallet: regra(getTipoRuleValue(state.produto, tipo)),
      palletsDelta: count,
    }));
    if (state.countMode === "new") {
      tipoCounts.forEach((count, tipo) => {
        const caixasPallet = regra(getTipoRuleValue(state.produto, tipo));
        updateSessionAggregateRecord({
          setor: state.setor,
          produto: state.produto,
          marca: state.marca,
          tipo,
          caixas_pallet: caixasPallet,
          palletsDelta: count,
        });
      });
      renderCountTable();
      pushMessage(
        "success",
        `Registrado (nova contagem): ${state.produto} ${state.marca} Tipos ${tipoLabel}`
      );
      const launchRecord = buildLaunchRecord({
        items: launchItems,
        correctionMode: launchItems.length === 1 && launchItems[0].palletsDelta === 1
          ? "type"
          : "batch",
        actionKind: launchItems.length === 1 ? "pallets" : "batch",
        label: `${state.produto} ${state.marca} Tipos ${tipoLabel}`,
      });
      if (launchRecord) {
        setLastLaunch(launchRecord);
      }
    } else {
      tipoCounts.forEach((count, tipo) => {
        const caixasPallet = regra(getTipoRuleValue(state.produto, tipo));
        queuePendingDelta({
          setor: state.setor,
          produto: state.produto,
          marca: state.marca,
          tipo,
          caixas_pallet: caixasPallet,
          palletsDelta: count,
          caixasAvulsasDelta: 0,
        });
      });
      pushMessage(
        "success",
        `Registrado: ${state.produto} ${state.marca} Tipos ${tipoLabel}`
      );

      const launchRecord = buildLaunchRecord({
        items: launchItems,
        correctionMode: launchItems.length === 1 && launchItems[0].palletsDelta === 1
          ? "type"
          : "batch",
        actionKind: launchItems.length === 1 ? "pallets" : "batch",
        label: `${state.produto} ${state.marca} Tipos ${tipoLabel}`,
      });
      if (launchRecord) {
        setLastLaunch(launchRecord);
      }
    }
  }

  renderContext();
}
