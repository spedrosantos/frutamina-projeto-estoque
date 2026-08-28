// Tabelas principais (estoque publico e contagem), resumos matriciais, contexto e "ultima atualizacao".
// Import dinamico para o formulario manual/edicao: mantem tables.js utilizavel em index.html
// sem carregar manual-form.js la (o botao de acoes so existe quando PAGE_MODE === "edit").
import { state, elements, PAGE_MODE, supabaseClient } from "./state.js";
import { CONFIG_GERAL, USER_LABELS_TABLE, SUPABASE_TIMEOUT_MS } from "./config.js";
import {
  getRowKey,
  normalizeText,
  formatTipoLabelValue,
  getTipoSortOrder,
  displayUserFromEmail,
  listProductsBySetor,
  listBrands,
  setSelectOptions,
  pushMessage,
  withTimeout,
} from "./utils.js";
import { hydrateInventoryRow, applyInventoryDeltas, formatInventoryStack } from "./inventory-core.js";
import { scheduleCountDraftPersist } from "./draft.js";

export function formatDateTime(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDate(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Grava o nome do operador no Supabase (visivel pra qualquer usuario/aparelho
// depois, via state.userLabels) e mantem o cache local antigo como fallback
// offline. Upsert nao precisa ser aguardado pelo chamador.
export async function storeUserLabel(userId, email) {
  if (!userId || !email) return;
  const label = displayUserFromEmail(email);
  if (!label) return;
  localStorage.setItem(`cd_user_label_${userId}`, label);
  state.userLabels[userId] = label;
  try {
    const { error } = await withTimeout(
      supabaseClient.from(USER_LABELS_TABLE).upsert({ user_id: userId, label }),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao salvar nome do usuario."
    );
    if (error) console.warn("Erro ao salvar nome do usuario:", error.message);
  } catch (error) {
    console.warn("Erro ao salvar nome do usuario:", error?.message || error);
  }
}

function getStoredUserLabel(userId) {
  if (!userId) return "";
  return localStorage.getItem(`cd_user_label_${userId}`) || "";
}

export function formatUserLabel(userId) {
  if (!userId) return "--";
  if (state.user?.id && userId === state.user.id) {
    return displayUserFromEmail(state.user.email);
  }
  if (state.userLabels[userId]) return state.userLabels[userId];
  const stored = getStoredUserLabel(userId);
  if (stored) return stored;
  const raw = String(userId);
  const short = raw.includes("-") ? raw.split("-")[0] : raw.slice(0, 6);
  return `usuario ${short}`;
}

function formatLastUpdateText(dateValue, userId) {
  const dateText = formatDateTime(dateValue);
  const userText = formatUserLabel(userId);
  if (dateText === "--" && userText === "--") return "--";
  if (userText === "--") return dateText;
  if (dateText === "--") return userText;
  return `${dateText} | ${userText}`;
}

function formatPublicLastUpdateText(dateValue, userId) {
  const userText = formatUserLabel(userId);
  const dateText = formatDate(dateValue);
  const timeText = formatTime(dateValue);
  if (userText === "--" && dateText === "--" && timeText === "--") return "--";
  if (userText === "--") return `-- em ${dateText} às ${timeText}`;
  return `${userText} em ${dateText} às ${timeText}`;
}

function renderLastUpdate() {
  if (elements.publicLastUpdate) {
    elements.publicLastUpdate.textContent = formatPublicLastUpdateText(
      state.lastUpdatePublicAt,
      state.lastUpdatePublicBy
    );
  }
  if (elements.countLastUpdate) {
    elements.countLastUpdate.textContent = formatLastUpdateText(
      state.lastUpdateCountAt,
      state.lastUpdateCountBy
    );
  }
}

export function updateLastUpdateFromRows(rows, target) {
  let latestRow = null;
  let latestTimestamp = null;
  (rows || []).forEach((row) => {
    const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) return;
    const ts = updatedAt.getTime();
    if (latestTimestamp === null || ts > latestTimestamp) {
      latestTimestamp = ts;
      latestRow = row;
    }
  });

  if (!latestRow || latestTimestamp === null) {
    if (target === "public") {
      state.lastUpdatePublicAt = null;
      state.lastUpdatePublicBy = null;
    } else {
      state.lastUpdateCountAt = null;
      state.lastUpdateCountBy = null;
    }
    renderLastUpdate();
    return;
  }

  if (target === "public") {
    state.lastUpdatePublicAt = new Date(latestTimestamp);
    state.lastUpdatePublicBy = latestRow?.user_id || null;
  } else {
    state.lastUpdateCountAt = new Date(latestTimestamp);
    state.lastUpdateCountBy = latestRow?.user_id || null;
  }
  renderLastUpdate();
}

export function setPublicMessage(type, text) {
  if (!elements.publicMsg) return;
  elements.publicMsg.innerHTML = "";
  if (!text) return;
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;
  msg.textContent = text;
  elements.publicMsg.appendChild(msg);
}

export function renderContext() {
  if (elements.ctxSetor) elements.ctxSetor.textContent = state.setor || "--";
  if (elements.ctxProduto) elements.ctxProduto.textContent = state.produto || "--";
  if (elements.ctxMarca) elements.ctxMarca.textContent = state.marca || "--";
  if (elements.setorSelect) elements.setorSelect.value = state.setor;
  if (elements.manualSetor && elements.manualSetor.value !== state.setor) {
    elements.manualSetor.value = state.setor || "";
    import("./manual-form.js").then((m) => m.updateManualDependencies());
  }
  renderCountSyncStatus();
  if (state.countMode === "new") {
    scheduleCountDraftPersist();
  }
}

export function renderCountSyncStatus() {
  if (!elements.countSyncBanner) return;

  if (!state.user) {
    elements.countSyncBanner.classList.add("hidden");
    return;
  }

  const online = navigator.onLine;
  const hasDraft = Boolean(
    state.sessionRows.length ||
    state.previousCountRows.length ||
    state.previousPublicRows.length
  );
  const lastSaved = formatDateTime(state.countDraftSavedAt);

  let title = "";
  let text = "";

  if (hasDraft) {
    if (online) {
      title =
        state.countMode === "new"
          ? "Nova contagem protegida neste aparelho"
          : "Rascunho da nova contagem guardado neste aparelho";
      text =
        lastSaved === "--"
          ? "Voce pode continuar contando. Ao salvar a nova contagem, o sistema sincroniza tudo de uma vez."
          : `Voce pode continuar contando. Ultimo salvamento local: ${lastSaved}. Ao salvar a nova contagem, o sistema sincroniza tudo de uma vez.`;
    } else {
      title = "Sem internet, mas a contagem continua segura";
      text =
        lastSaved === "--"
          ? "Os lancamentos desta nova contagem seguem salvos neste aparelho ate a conexao voltar."
          : `Os lancamentos desta nova contagem seguem salvos neste aparelho. Ultimo salvamento local: ${lastSaved}.`;
    }
  } else if (online) {
    title = "Sistema pronto para contagem offline";
    text =
      "Quando voce iniciar uma nova contagem, o rascunho sera salvo automaticamente neste aparelho.";
  } else {
    title = "Sem internet no momento";
    text =
      "Se a nova contagem ja foi iniciada, continue normalmente. Se ainda nao foi, inicie antes de entrar na camara para garantir o rascunho offline.";
  }

  elements.countSyncBanner.classList.remove("hidden");

  if (elements.countSyncPill) {
    elements.countSyncPill.textContent = online ? "Online" : "Offline";
    elements.countSyncPill.className = `sync-pill ${online ? "online" : "offline"}`;
  }
  if (elements.countSyncTitle) {
    elements.countSyncTitle.textContent = title;
  }
  if (elements.countSyncText) {
    elements.countSyncText.textContent = text;
  }
}

function formatSummaryValue(value, showZero = false) {
  if (value === null || value === undefined) return "";
  if (value === 0 && !showZero) return "";
  return value;
}

function buildSummaryGroups(rows) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    if (!row) return;
    const normalizedRow = hydrateInventoryRow(row);
    const setor = normalizedRow.setor || "Sem setor";
    const produto = normalizedRow.produto || "Sem produto";
    const marca = normalizedRow.marca || "Sem marca";
    const tipo = Number.parseInt(normalizedRow.tipo, 10);
    if (Number.isNaN(tipo)) return;
    const groupKey = `${setor}|||${produto}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        setor,
        produto,
        brands: new Set(),
        tipos: new Set(),
        matrix: new Map(),
        totals: new Map(),
      };
      groups.set(groupKey, group);
    }

    const pallets = normalizedRow.pallets;
    const caixasPallet = normalizedRow.caixas_pallet;
    const caixasAvulsas = normalizedRow.caixas_avulsas;
    const totalCaixas = normalizedRow.total_caixas;

    group.brands.add(marca);
    group.tipos.add(tipo);

    if (!group.matrix.has(tipo)) {
      group.matrix.set(tipo, new Map());
    }
    const brandMap = group.matrix.get(tipo);
    const cell = brandMap.get(marca) || {
      pallets: 0,
      caixas_avulsas: 0,
      total_caixas: 0,
      caixas_pallet: null,
    };
    if (Number.isFinite(caixasPallet) && caixasPallet > 0) {
      cell.caixas_pallet = caixasPallet;
    }
    applyInventoryDeltas(cell, {
      caixas_pallet: caixasPallet,
      palletsDelta: pallets,
      caixasAvulsasDelta: caixasAvulsas,
    });
    brandMap.set(marca, cell);

    const total = group.totals.get(marca) || { total_caixas: 0 };
    total.total_caixas += totalCaixas;
    group.totals.set(marca, total);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      brands: Array.from(group.brands).sort(),
      tipos: Array.from(group.tipos).sort(
        (a, b) => getTipoSortOrder(group.produto, a) - getTipoSortOrder(group.produto, b)
      ),
    }))
    .sort((a, b) => {
      const setorDiff = a.setor.localeCompare(b.setor);
      if (setorDiff !== 0) return setorDiff;
      return a.produto.localeCompare(b.produto);
    });
}

function renderSummaryTables(rows, container, options = {}) {
  if (!container) return;
  container.innerHTML = "";
  const groups = buildSummaryGroups(rows);
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "msg info";
    empty.textContent = "Sem dados para o resumo.";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "summary-grid";

  groups.forEach((group, index) => {
    const card = document.createElement("section");
    card.className = "summary-card";
    if (options.colorizeFirst && index === 0) {
      card.classList.add("summary-colorized");
    }

    const header = document.createElement("div");
    header.className = "summary-header";
    const title = document.createElement("h3");
    title.textContent = group.produto;
    header.appendChild(title);

    if (options.showSetor !== false) {
      const subtitle = document.createElement("p");
      subtitle.textContent = `Setor: ${group.setor}`;
      header.appendChild(subtitle);
    }

    const table = document.createElement("table");
    table.className = "summary-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thTipo = document.createElement("th");
    thTipo.textContent = "Tipo";
    thTipo.rowSpan = 2;
    headRow.appendChild(thTipo);
    group.brands.forEach((brand) => {
      const thBrand = document.createElement("th");
      thBrand.textContent = `M: ${brand}`;
      thBrand.colSpan = 3;
      headRow.appendChild(thBrand);
    });
    thead.appendChild(headRow);

    const headRow2 = document.createElement("tr");
    group.brands.forEach(() => {
      const thCaixas = document.createElement("th");
      thCaixas.textContent = "Cx/P";
      const thPallets = document.createElement("th");
      thPallets.textContent = "P + Av";
      const thTotal = document.createElement("th");
      thTotal.textContent = "T";
      headRow2.append(thCaixas, thPallets, thTotal);
    });
    thead.appendChild(headRow2);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    group.tipos.forEach((tipo) => {
      const row = document.createElement("tr");
      const tipoCell = document.createElement("td");
      tipoCell.textContent = formatTipoLabelValue(group.produto, tipo);
      tipoCell.className = "cell-tipo";
      row.appendChild(tipoCell);
      group.brands.forEach((brand) => {
        const cell = group.matrix.get(tipo)?.get(brand);
        const caixasPallet = cell?.caixas_pallet ?? 0;
        const pallets = cell?.pallets || 0;
        const caixasAvulsas = cell?.caixas_avulsas || 0;
        const total = cell?.total_caixas || 0;
        const caixasCell = document.createElement("td");
        caixasCell.textContent = formatSummaryValue(caixasPallet);
        caixasCell.className = "cell-caixas";
        const palletsCell = document.createElement("td");
        palletsCell.textContent = formatInventoryStack(pallets, caixasAvulsas);
        palletsCell.className = "cell-pallets";
        const totalCell = document.createElement("td");
        totalCell.textContent = formatSummaryValue(total);
        totalCell.className = "cell-total";
        row.append(caixasCell, palletsCell, totalCell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    const tfoot = document.createElement("tfoot");
    const totalRow = document.createElement("tr");
    const totalLabel = document.createElement("td");
    totalLabel.textContent = "Total";
    totalLabel.className = "cell-sum";
    totalRow.appendChild(totalLabel);
    group.brands.forEach((brand) => {
      const totals = group.totals.get(brand) || {
        pallets: 0,
        total_caixas: 0,
      };
      const caixasTotalCell = document.createElement("td");
      caixasTotalCell.textContent = "";
      const palletsTotalCell = document.createElement("td");
      palletsTotalCell.textContent = "";
      const totalCaixasCell = document.createElement("td");
      totalCaixasCell.textContent = formatSummaryValue(
        totals.total_caixas,
        true
      );
      totalCaixasCell.className = "cell-sum";
      totalRow.append(caixasTotalCell, palletsTotalCell, totalCaixasCell);
    });
    tfoot.appendChild(totalRow);
    table.appendChild(tfoot);

    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    tableWrap.appendChild(table);

    card.append(header, tableWrap);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

export function setPublicViewMode(mode) {
  state.publicViewMode = mode === "summary" ? "summary" : "detailed";
  if (elements.publicViewToggle) {
    elements.publicViewToggle.classList.toggle(
      "mode-summary",
      state.publicViewMode === "summary"
    );
  }
  if (elements.publicViewDetailedBtn) {
    elements.publicViewDetailedBtn.setAttribute(
      "aria-pressed",
      state.publicViewMode === "detailed"
    );
  }
  if (elements.publicViewSummaryBtn) {
    elements.publicViewSummaryBtn.setAttribute(
      "aria-pressed",
      state.publicViewMode === "summary"
    );
  }
  if (elements.publicTableDetailed) {
    elements.publicTableDetailed.classList.toggle(
      "hidden",
      state.publicViewMode !== "detailed"
    );
  }
  if (elements.publicTableSummary) {
    elements.publicTableSummary.classList.toggle(
      "hidden",
      state.publicViewMode !== "summary"
    );
  }
  if (state.publicViewMode === "summary") {
    renderPublicSummary();
  }
}

export function setCountViewMode(mode) {
  state.countViewMode = mode === "summary" ? "summary" : "detailed";
  if (elements.countViewToggle) {
    elements.countViewToggle.classList.toggle(
      "mode-summary",
      state.countViewMode === "summary"
    );
  }
  if (elements.countViewDetailedBtn) {
    elements.countViewDetailedBtn.setAttribute(
      "aria-pressed",
      state.countViewMode === "detailed"
    );
  }
  if (elements.countViewSummaryBtn) {
    elements.countViewSummaryBtn.setAttribute(
      "aria-pressed",
      state.countViewMode === "summary"
    );
  }
  if (elements.countTableDetailed) {
    elements.countTableDetailed.classList.toggle(
      "hidden",
      state.countViewMode !== "detailed"
    );
  }
  if (elements.countTableSummary) {
    elements.countTableSummary.classList.toggle(
      "hidden",
      state.countViewMode !== "summary"
    );
  }
  if (state.countViewMode === "summary") {
    renderCountSummary();
  }
}

function renderPublicSummary() {
  if (!elements.publicTableSummary) return;
  const rows = state.publicRows.filter(matchesPublicFilters);
  renderSummaryTables(rows, elements.publicTableSummary, {
    showSetor: true,
    colorizeFirst: true,
  });
}

function renderCountSummary() {
  if (!elements.countTableSummary) return;
  const rows = getCountRowsForSetor();
  renderSummaryTables(rows, elements.countTableSummary, {
    showSetor: false,
    colorizeFirst: true,
  });
}

export function renderPublicTable() {
  if (!elements.publicTableBody || !elements.publicTotalGeral) return;
  elements.publicTableBody.innerHTML = "";
  let total = 0;
  const rows = state.publicRows.filter(matchesPublicFilters);
  for (const row of rows) {
    const normalizedRow = hydrateInventoryRow(row);
    const tipoLabel = formatTipoLabelValue(
      normalizedRow.produto,
      normalizedRow.tipo,
      normalizedRow.marca
    );
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${normalizedRow.produto}</td>
      <td>${normalizedRow.marca}</td>
      <td>${tipoLabel}</td>
      <td>${normalizedRow.caixas_pallet}</td>
      <td>${normalizedRow.pallets}</td>
      <td>${normalizedRow.caixas_avulsas || ""}</td>
      <td>${normalizedRow.total_caixas}</td>
    `;
    elements.publicTableBody.appendChild(tr);
    total += normalizedRow.total_caixas;
  }
  elements.publicTotalGeral.textContent = total;
  renderPublicSummary();
}

function matchesPublicFilters(row) {
  const { setor, produto, marca, tipo } = state.publicFilters;
  if (setor && row.setor !== setor) return false;
  if (produto && row.produto !== produto) return false;
  if (marca && row.marca !== marca) return false;
  if (tipo) {
    const tipoNum = Number.parseInt(tipo, 10);
    if (!Number.isNaN(tipoNum) && row.tipo !== tipoNum) return false;
  }
  const query = normalizeText(state.publicQuery);
  if (query) {
    const tipoText = formatTipoLabelValue(row.produto, row.tipo, row.marca);
    const haystack = normalizeText(
      `${row.setor} ${row.produto} ${row.marca} ${row.tipo} ${tipoText}`
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function renderCountTable() {
  if (!elements.countTableBody || !elements.countTotalGeral) return;
  elements.countTableBody.innerHTML = "";
  let total = 0;
  const showActions = PAGE_MODE === "edit";
  const rows = getCountRowsForSetor();
  for (const row of rows) {
    const normalizedRow = hydrateInventoryRow(row);
    const tipoLabel = formatTipoLabelValue(
      normalizedRow.produto,
      normalizedRow.tipo,
      normalizedRow.marca
    );
    const tr = document.createElement("tr");
    const rowKey = getRowKey(normalizedRow);
    if (rowKey) {
      tr.dataset.rowKey = rowKey;
      if (state.selectedRowKey === rowKey) {
        tr.classList.add("row-selected");
      }
      tr.addEventListener("click", (event) => {
        if (event.target.closest(".row-actions")) return;
        state.selectedRowKey = rowKey;
        renderCountTable();
      });
    }
    const totalCaixas = normalizedRow.total_caixas;
    tr.innerHTML = `
      <td>${normalizedRow.produto}</td>
      <td>${normalizedRow.marca}</td>
      <td>${tipoLabel}</td>
      <td>${normalizedRow.caixas_pallet}</td>
      <td>${normalizedRow.pallets}</td>
      <td>${normalizedRow.caixas_avulsas || ""}</td>
      <td>${totalCaixas}</td>
    `;
    if (showActions) {
      const actionsTd = document.createElement("td");
      actionsTd.className = "row-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "ghost";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", () => {
        import("./manual-form.js").then((m) => m.openEditModal(row));
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "danger";
      deleteBtn.textContent = "Remover";
      deleteBtn.addEventListener("click", () => {
        import("./manual-form.js").then((m) => m.removeRow(row));
      });
      actionsTd.append(editBtn, deleteBtn);
      tr.appendChild(actionsTd);
    }
    elements.countTableBody.appendChild(tr);
    total += totalCaixas;
  }
  elements.countTotalGeral.textContent = total;
  renderCountSummary();
  renderCountSyncStatus();
  if (state.countMode === "new") {
    scheduleCountDraftPersist();
  }
}

function getCountRowsForSetor() {
  const source =
    state.countMode === "new" ? state.sessionRows : state.userRows;
  if (!state.setor) return source;
  return source.filter((row) => row.setor === state.setor);
}

export function updateAggregateRecord({
  setor,
  produto,
  marca,
  tipo,
  caixas_pallet,
  palletsDelta = 1,
  caixasAvulsasDelta = 0,
}) {
  const found = state.publicRows.find(
    (row) =>
      row.setor === setor &&
      row.produto === produto &&
      row.marca === marca &&
      row.tipo === tipo
  );
  if (found) {
    applyInventoryDeltas(found, {
      caixas_pallet,
      palletsDelta,
      caixasAvulsasDelta,
    });
  } else {
    state.publicRows.push(hydrateInventoryRow({
      setor,
      produto,
      marca,
      tipo,
      caixas_pallet,
      pallets: palletsDelta,
      caixas_avulsas: caixasAvulsasDelta,
    }));
  }
}

function openFilterModal() {
  if (!elements.filterModal) return;
  buildFilterOptions();
  elements.filterModal.classList.remove("hidden");
}

function closeFilterModal() {
  if (!elements.filterModal) return;
  elements.filterModal.classList.add("hidden");
}

export function buildFilterOptions() {
  if (
    !elements.filterSetor ||
    !elements.filterProduto ||
    !elements.filterMarca ||
    !elements.filterTipo
  ) {
    return;
  }
  const setor = state.publicFilters.setor;
  const produto = state.publicFilters.produto;
  const marca = state.publicFilters.marca;

  setSelectOptions(elements.filterSetor, Object.keys(CONFIG_GERAL).sort(), setor);
  setSelectOptions(elements.filterProduto, listProductsBySetor(setor), produto);
  setSelectOptions(
    elements.filterMarca,
    listBrands(setor, elements.filterProduto.value),
    marca
  );

  elements.filterTipo.value = state.publicFilters.tipo || "";
}

function updateFilterDependencies() {
  if (!elements.filterSetor || !elements.filterProduto || !elements.filterMarca) {
    return;
  }
  const setor = elements.filterSetor.value;
  const produto = elements.filterProduto.value;
  setSelectOptions(elements.filterProduto, listProductsBySetor(setor), produto);
  setSelectOptions(elements.filterMarca, listBrands(setor, elements.filterProduto.value), elements.filterMarca.value);
}

function exportRows(rows, filename) {
  if (!rows.length) {
    pushMessage("warn", "Nenhum item para exportar.");
    return;
  }
  const header = [
    "Setor",
    "Produto",
    "Marca",
    "Tipo",
    "Caixas/Pallet",
    "Pallets",
    "Caixas Avulsas",
    "Total Caixas",
  ];
  const csv = [
    header.join(";"),
    ...rows.map((row) => {
      const normalizedRow = hydrateInventoryRow(row);
      const tipoLabel = formatTipoLabelValue(
        normalizedRow.produto,
        normalizedRow.tipo,
        normalizedRow.marca
      );
      return [
        normalizedRow.setor,
        normalizedRow.produto,
        normalizedRow.marca,
        tipoLabel,
        normalizedRow.caixas_pallet,
        normalizedRow.pallets,
        normalizedRow.caixas_avulsas,
        normalizedRow.total_caixas,
      ].join(";");
    }),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getExportRows(scope) {
  if (scope === "public") {
    return state.publicRows.filter(matchesPublicFilters);
  }
  return getCountRowsForSetor();
}

function getExportNode(scope) {
  if (scope === "public") {
    return state.publicViewMode === "summary"
      ? elements.publicTableSummary
      : elements.publicTableDetailed;
  }
  return state.countViewMode === "summary"
    ? elements.countTableSummary
    : elements.countTableDetailed;
}

// Modal de pre-visualizacao de impressao: mostra o conteudo em uma folha A4
// dentro da propria pagina (sem popup) e usa o @media print de styles.css,
// que imprime apenas #print-area.
function closePrintPreview() {
  const modal = document.getElementById("print-preview");
  if (modal) modal.classList.add("hidden");
  document.body.classList.remove("print-preview-open");
}

function ensurePrintPreview() {
  const existing = document.getElementById("print-preview");
  if (existing) return existing;

  const modal = document.createElement("div");
  modal.id = "print-preview";
  modal.className = "print-preview hidden";
  modal.innerHTML = `
    <div class="print-preview-backdrop" data-print-close></div>
    <div class="print-preview-panel">
      <header class="print-preview-bar">
        <div class="print-preview-heading">
          <strong>Pre-visualizacao de impressao</strong>
          <span class="print-preview-subtitle"></span>
        </div>
        <div class="print-preview-actions">
          <button class="ghost" type="button" data-print-close>Fechar</button>
          <button class="primary" type="button" data-print-now>
            <i class="bi bi-printer"></i>
            Imprimir
          </button>
        </div>
      </header>
      <div class="print-preview-scroll">
        <div id="print-area" class="print-sheet">
          <h1></h1>
          <p class="print-meta"></p>
          <div class="print-sheet-body"></div>
        </div>
      </div>
    </div>`;

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-print-close]")) closePrintPreview();
    if (event.target.closest("[data-print-now]")) window.print();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePrintPreview();
  });
  document.body.appendChild(modal);
  return modal;
}

function openPrintPreview(title, contentNode, meta) {
  if (!contentNode) return;
  const clone = contentNode.cloneNode(true);
  clone
    .querySelectorAll(".actions, .table-modes, .view-toggle, .table-footer")
    .forEach((node) => node.remove());
  // Evita ids duplicados no documento (o clone e apenas visual).
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  clone.classList.remove("hidden");

  const modal = ensurePrintPreview();
  modal.querySelector(".print-preview-subtitle").textContent = title;
  modal.querySelector("#print-area h1").textContent = title;
  modal.querySelector(".print-meta").textContent = meta;
  const body = modal.querySelector(".print-sheet-body");
  body.textContent = "";
  body.appendChild(clone);

  modal.classList.remove("hidden");
  document.body.classList.add("print-preview-open");
}

function handleExport(scope, format) {
  const rows = getExportRows(scope);
  if (!rows.length) {
    pushMessage("warn", "Nenhum item para exportar.");
    return;
  }
  if (format === "csv") {
    const filename =
      scope === "public"
        ? "estoque_filtro.csv"
        : `estoque_${state.setor}.csv`;
    exportRows(rows, filename);
    return;
  }

  const node = getExportNode(scope);
  if (!node) return;
  const title =
    scope === "public"
      ? "Estoque - Visao Geral"
      : `Estoque - ${state.setor}`;
  const totalCaixas = rows.reduce(
    (sum, row) => sum + (hydrateInventoryRow(row).total_caixas || 0),
    0
  );
  const meta = `${rows.length} ${rows.length === 1 ? "item" : "itens"} | Total ${totalCaixas} caixas | ${formatDateTime(new Date())}`;
  openPrintPreview(title, node, meta);
}

function openExportSheet(scope) {
  const sheet = scope === "public" ? elements.publicExportSheet : elements.countExportSheet;
  if (sheet) sheet.classList.remove("hidden");
}

export function closeExportSheet(scope) {
  const sheet = scope === "public" ? elements.publicExportSheet : elements.countExportSheet;
  if (sheet) sheet.classList.add("hidden");
}

// Liga os eventos da tabela publica (busca, filtro, exportacao, atualizar).
// Usado por index.html e editar.html (a tabela publica so existe em index.html,
// mas a funcao e segura de chamar em ambas por causa dos guards de elemento).
export function setupPublicTableEvents({ loadPublicRecords }) {
  if (elements.publicSearch) {
    elements.publicSearch.addEventListener("input", (event) => {
      state.publicQuery = event.target.value;
      renderPublicTable();
    });
  }

  if (elements.publicSearchForm) {
    elements.publicSearchForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (elements.publicFilterBtn) {
    elements.publicFilterBtn.addEventListener("click", () => {
      openFilterModal();
    });
  }

  if (elements.filterClose) {
    elements.filterClose.addEventListener("click", closeFilterModal);
  }
  if (elements.filterCloseBtn) {
    elements.filterCloseBtn.addEventListener("click", closeFilterModal);
  }

  if (elements.filterSetor) {
    elements.filterSetor.addEventListener("change", () => {
      updateFilterDependencies();
    });
  }

  if (elements.filterProduto) {
    elements.filterProduto.addEventListener("change", () => {
      setSelectOptions(
        elements.filterMarca,
        listBrands(elements.filterSetor.value, elements.filterProduto.value),
        elements.filterMarca.value
      );
    });
  }

  if (elements.filterApply) {
    elements.filterApply.addEventListener("click", () => {
      state.publicFilters = {
        setor: elements.filterSetor.value,
        produto: elements.filterProduto.value,
        marca: elements.filterMarca.value,
        tipo: elements.filterTipo.value.trim(),
      };
      renderPublicTable();
      closeFilterModal();
    });
  }

  if (elements.filterClear) {
    elements.filterClear.addEventListener("click", () => {
      state.publicFilters = { setor: "", produto: "", marca: "", tipo: "" };
      buildFilterOptions();
      renderPublicTable();
    });
  }

  if (elements.publicRefresh) {
    elements.publicRefresh.addEventListener("click", async () => {
      const button = elements.publicRefresh;
      if (button.disabled) return;
      button.disabled = true;
      button.classList.add("is-loading");
      try {
        await loadPublicRecords();
      } finally {
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    });
  }

  if (elements.publicViewDetailedBtn) {
    elements.publicViewDetailedBtn.addEventListener("click", () => {
      setPublicViewMode("detailed");
    });
  }

  if (elements.publicViewSummaryBtn) {
    elements.publicViewSummaryBtn.addEventListener("click", () => {
      setPublicViewMode("summary");
    });
  }

  if (elements.publicExportToggle) {
    elements.publicExportToggle.addEventListener("click", () => {
      openExportSheet("public");
    });
  }

  if (elements.publicExportClose) {
    elements.publicExportClose.addEventListener("click", () => {
      closeExportSheet("public");
    });
  }

  if (elements.publicExportSheet) {
    elements.publicExportSheet.addEventListener("click", (event) => {
      if (event.target.classList.contains("share-backdrop")) {
        closeExportSheet("public");
      }
    });
  }

  if (elements.publicExportCsv) {
    elements.publicExportCsv.addEventListener("click", () => {
      handleExport("public", "csv");
      closeExportSheet("public");
    });
  }

  if (elements.publicExportPdf) {
    elements.publicExportPdf.addEventListener("click", () => {
      handleExport("public", "pdf");
      closeExportSheet("public");
    });
  }

  if (elements.publicExportPrint) {
    elements.publicExportPrint.addEventListener("click", () => {
      handleExport("public", "print");
      closeExportSheet("public");
    });
  }
}

// Liga os eventos da tabela de contagem (view toggle, exportacao).
export function setupCountTableEvents() {
  if (elements.countViewDetailedBtn) {
    elements.countViewDetailedBtn.addEventListener("click", () => {
      setCountViewMode("detailed");
    });
  }

  if (elements.countViewSummaryBtn) {
    elements.countViewSummaryBtn.addEventListener("click", () => {
      setCountViewMode("summary");
    });
  }

  if (elements.countExportToggle) {
    elements.countExportToggle.addEventListener("click", () => {
      openExportSheet("count");
    });
  }

  if (elements.countExportClose) {
    elements.countExportClose.addEventListener("click", () => {
      closeExportSheet("count");
    });
  }

  if (elements.countExportSheet) {
    elements.countExportSheet.addEventListener("click", (event) => {
      if (event.target.classList.contains("share-backdrop")) {
        closeExportSheet("count");
      }
    });
  }

  if (elements.countExportCsv) {
    elements.countExportCsv.addEventListener("click", () => {
      handleExport("count", "csv");
      closeExportSheet("count");
    });
  }

  if (elements.countExportPdf) {
    elements.countExportPdf.addEventListener("click", () => {
      handleExport("count", "pdf");
      closeExportSheet("count");
    });
  }

  if (elements.countExportPrint) {
    elements.countExportPrint.addEventListener("click", () => {
      handleExport("count", "print");
      closeExportSheet("count");
    });
  }
}

export function updateSessionAggregateRecord({
  setor,
  produto,
  marca,
  tipo,
  caixas_pallet,
  palletsDelta = 1,
  caixasAvulsasDelta = 0,
}) {
  const found = state.sessionRows.find(
    (row) =>
      row.setor === setor &&
      row.produto === produto &&
      row.marca === marca &&
      row.tipo === tipo
  );
  if (found) {
    applyInventoryDeltas(found, {
      caixas_pallet,
      palletsDelta,
      caixasAvulsasDelta,
    });
  } else {
    state.sessionRows.push(hydrateInventoryRow({
      _localId: `local_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      setor,
      produto,
      marca,
      tipo,
      caixas_pallet,
      pallets: palletsDelta,
      caixas_avulsas: caixasAvulsasDelta,
    }));
  }
}

export function getTotalCaixas(rows) {
  return (rows || []).reduce((sum, row) => {
    const normalizedRow = hydrateInventoryRow(row);
    return sum + normalizedRow.total_caixas;
  }, 0);
}
