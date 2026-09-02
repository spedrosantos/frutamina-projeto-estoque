// Tabelas principais (estoque publico e contagem), resumos matriciais, contexto e "ultima atualizacao".
// Import dinamico para o formulario manual/edicao: mantem tables.js utilizavel em index.html
// sem carregar manual-form.js la (o botao de acoes so existe quando PAGE_MODE === "edit").
import { state, elements, PAGE_MODE, supabaseClient } from "../core/state.js";
import { CONFIG_GERAL, USER_LABELS_TABLE, SUPABASE_TIMEOUT_MS } from "../core/config.js";
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
} from "../core/utils.js";
import {
  hydrateInventoryRow,
  applyInventoryDeltas,
  formatInventoryStack,
  buildInventoryIdentityKey,
  getCurrentPublicAggregateRows,
  getInventoryRowByIdentity,
} from "../core/inventory-core.js";
import { scheduleCountDraftPersist } from "../data/draft.js";
// Ciclo proposital com pending-changes.js: sao funcoes declaradas, chamadas so
// em runtime, entao os dois modulos se resolvem sem problema.
import {
  applyPendingRow,
  getPendingChanges,
  replacePendingDelta,
} from "../data/pending-changes.js";
import { confirmAction } from "../shell/confirm-modal.js";

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
      "Tempo limite ao salvar nome do usuario.",
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
      state.lastUpdatePublicBy,
    );
  }
  if (elements.countLastUpdate) {
    elements.countLastUpdate.textContent = formatLastUpdateText(
      state.lastUpdateCountAt,
      state.lastUpdateCountBy,
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
    state.sessionRows.length || state.previousCountRows.length || state.previousPublicRows.length,
  );
  const lastSaved = formatDateTime(state.countDraftSavedAt);
  const pendingCount = state.countMode === "new" ? 0 : getPendingChanges().length;

  let title = "";
  let text = "";

  // A fila pendente vem primeiro: e o aviso mais urgente da tela, e o rascunho
  // da nova contagem pode continuar guardado mesmo no modo "Ajustar estoque".
  if (pendingCount) {
    title = `${pendingCount} lançamento(s) não salvos`;
    text = online ? "Guardados neste aparelho." : "Guardados neste aparelho. Sem internet.";
  } else if (hasDraft) {
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
        (a, b) => getTipoSortOrder(group.produto, a) - getTipoSortOrder(group.produto, b),
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
      totalCaixasCell.textContent = formatSummaryValue(totals.total_caixas, true);
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

// Os dois seletores de visualizacao (estoque publico e itens contados) tinham a
// mesma funcao escrita duas vezes, trocando so o prefixo dos elementos. Quando um
// ganhava um ajuste, o outro ficava atras.
function applyViewMode(mode, ui, renderSummary) {
  const next = mode === "summary" ? "summary" : "detailed";
  ui.toggle?.classList.toggle("mode-summary", next === "summary");
  ui.detailedBtn?.setAttribute("aria-pressed", next === "detailed");
  ui.summaryBtn?.setAttribute("aria-pressed", next === "summary");
  ui.detailed?.classList.toggle("hidden", next !== "detailed");
  ui.summary?.classList.toggle("hidden", next !== "summary");
  if (next === "summary") renderSummary();
  return next;
}

export function setPublicViewMode(mode) {
  state.publicViewMode = applyViewMode(
    mode,
    {
      toggle: elements.publicViewToggle,
      detailedBtn: elements.publicViewDetailedBtn,
      summaryBtn: elements.publicViewSummaryBtn,
      detailed: elements.publicTableDetailed,
      summary: elements.publicTableSummary,
    },
    renderPublicSummary,
  );
}

export function setCountViewMode(mode) {
  state.countViewMode = applyViewMode(
    mode,
    {
      toggle: elements.countViewToggle,
      detailedBtn: elements.countViewDetailedBtn,
      summaryBtn: elements.countViewSummaryBtn,
      detailed: elements.countTableDetailed,
      summary: elements.countTableSummary,
    },
    renderCountSummary,
  );
}

// Mesmo resumo, fontes de linha diferentes. getRows so roda se o container
// existe: nas paginas sem a tabela nao ha nada para montar.
function renderSummaryFor(container, getRows) {
  if (!container) return;
  renderSummaryTables(getRows(), container, { showSetor: true, colorizeFirst: true });
}

function renderPublicSummary() {
  renderSummaryFor(elements.publicTableSummary, () =>
    state.publicRows.filter(matchesPublicFilters),
  );
}

function renderCountSummary() {
  renderSummaryFor(elements.countTableSummary, getCountRows);
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
      normalizedRow.marca,
    );
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${normalizedRow.setor || "--"}</td>
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
      `${row.setor} ${row.produto} ${row.marca} ${row.tipo} ${tipoText}`,
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function renderCountTable() {
  if (!elements.countTableBody || !elements.countTotalGeral) return;
  syncCountSourceAvailability();
  elements.countTableBody.innerHTML = "";
  let total = 0;
  const showActions = PAGE_MODE === "edit";
  const rows = getCountRows();
  for (const row of rows) {
    const normalizedRow = hydrateInventoryRow(row);
    const tipoLabel = formatTipoLabelValue(
      normalizedRow.produto,
      normalizedRow.tipo,
      normalizedRow.marca,
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
      <td>${normalizedRow.setor || "--"}</td>
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
      const isPendingRow = state.countSource !== "estoque" && state.countMode !== "new";
      let rowSaveBtn = null;
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "danger icon-btn";
      deleteBtn.type = "button";
      deleteBtn.title = isPendingRow ? "Descartar este lancamento" : "Remover do estoque";
      deleteBtn.setAttribute("aria-label", deleteBtn.title);
      deleteBtn.innerHTML = '<i class="bi bi-trash3"></i>';
      if (isPendingRow) {
        // Na visao Contagem a linha e um lancamento local: editar e remover
        // mexem so no que ele contou, sem tocar no estoque gravado, e o disquete
        // grava apenas aquele item.
        deleteBtn.addEventListener("click", () => removePendingCountRow(row));
        const saveBtn = document.createElement("button");
        saveBtn.className = "primary icon-btn";
        saveBtn.type = "button";
        saveBtn.title = "Salvar so este item no estoque";
        saveBtn.setAttribute("aria-label", saveBtn.title);
        saveBtn.innerHTML = '<i class="bi bi-floppy-fill"></i>';
        saveBtn.addEventListener("click", () => {
          saveBtn.disabled = true;
          applyPendingRow(buildInventoryIdentityKey(row)).finally(() => {
            saveBtn.disabled = false;
          });
        });
        rowSaveBtn = saveBtn;
      } else {
        deleteBtn.addEventListener("click", () => {
          import("./manual-form.js").then((m) => m.removeRow(row));
        });
      }
      const editBtn = document.createElement("button");
      editBtn.className = "ghost icon-btn";
      editBtn.type = "button";
      editBtn.title = "Editar item";
      editBtn.setAttribute("aria-label", "Editar item");
      editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
      editBtn.addEventListener("click", () => {
        import("./manual-form.js").then((m) => m.openEditModal(row));
      });
      actionsTd.append(editBtn, deleteBtn);
      if (rowSaveBtn) actionsTd.append(rowSaveBtn);
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

// Linhas da visao "Contagem" no modo Estoque atual: o que o operador lancou
// agora e ainda esta so no aparelho, agregado por item. Nao mistura com o
// estoque do banco - ele tem a propria visao.
function buildPendingCountRows() {
  const rows = [];
  for (const op of getPendingChanges()) {
    if (op.kind !== "delta") continue;
    const found = getInventoryRowByIdentity(rows, op);
    if (found) {
      applyInventoryDeltas(found, op);
      continue;
    }
    rows.push(
      hydrateInventoryRow({
        _localId: `pending_${buildInventoryIdentityKey(op)}`,
        setor: op.setor,
        produto: op.produto,
        marca: op.marca,
        tipo: op.tipo,
        caixas_pallet: op.caixas_pallet,
        pallets: op.palletsDelta,
        caixas_avulsas: op.caixasAvulsasDelta,
      }),
    );
  }
  return rows;
}

// Descarta os lancamentos de um item da contagem em andamento (visao Contagem).
// Toda exclusao pede confirmacao: o lancamento so existe no aparelho, entao
// nao ha como recuperar depois de descartado.
async function removePendingCountRow(row) {
  const tipoLabel = formatTipoLabelValue(row?.produto, row?.tipo, row?.marca);
  const nome = [row?.produto, row?.marca].filter(Boolean).join(" ");
  const confirmed = await confirmAction({
    title: "Descartar lançamento",
    message:
      tipoLabel && tipoLabel !== "--"
        ? `Descartar o que você contou de ${nome} Tipo ${tipoLabel}?`
        : `Descartar o que você contou de ${nome}?`,
    confirmLabel: "Descartar",
    danger: true,
  });
  if (!confirmed) return;
  replacePendingDelta(buildInventoryIdentityKey(row));
}

// Aplica a visao escolhida na UI, sem redesenhar a tabela: quem chama decide
// quando renderizar (renderCountTable ja passa por aqui no proprio ciclo).
function applyCountSourceUI() {
  if (elements.countSourceSelect) {
    elements.countSourceSelect.value = state.countSource;
    elements.countSourceSelect.dispatchEvent(new Event("select-menu:sync"));
  }
  // Salvar e limpar sao acoes da contagem em andamento: no estoque gravado nao
  // existe o que salvar nem o que limpar (item errado se apaga linha a linha).
  const editingStock = state.countSource === "estoque";
  elements.countSaveBtn?.classList.toggle("hidden", editingStock);
  elements.countClearBtn?.classList.toggle("hidden", editingStock);
  if (elements.countItemsHint) {
    elements.countItemsHint.textContent = editingStock
      ? "Já gravado · todos os setores"
      : "Não gravado · todos os setores";
  }
}

// "Contagem" so faz sentido quando existe contagem: sem nada lancado a opcao
// fica travada e a tela cai no estoque gravado.
function syncCountSourceAvailability() {
  const counting =
    state.countMode === "new" ? state.sessionRows.length > 0 : getPendingChanges().length > 0;
  const option = elements.countSourceSelect?.querySelector('option[value="contagem"]');
  if (option) option.disabled = !counting;
  if (!counting && state.countSource !== "estoque") state.countSource = "estoque";
  applyCountSourceUI();
}

export function setCountSource(source) {
  state.countSource = source === "estoque" ? "estoque" : "contagem";
  applyCountSourceUI();
  renderCountTable();
}

// Visao "Estoque atual": o mesmo estoque do index/visao geral - de todos os
// operadores, agregado por item. Editar/remover pede o id de UMA linha do banco,
// entao so aparece quando o item vem de um unico registro do proprio usuario.
function buildStockRows() {
  const origins = state.rawPublicRows?.length ? state.rawPublicRows : state.publicRows;
  return getCurrentPublicAggregateRows().map((row) => {
    const key = buildInventoryIdentityKey(row);
    const sources = (origins || []).filter((item) => buildInventoryIdentityKey(item) === key);
    // Editar precisa de UMA linha do proprio usuario (a policy de update exige
    // auth.uid() = user_id). Remover vale para todas as linhas do item, porque a
    // policy de delete e aberta a qualquer autenticado.
    const editable =
      sources.length === 1 && sources[0]?.user_id && sources[0].user_id === state.user?.id;
    return {
      ...row,
      id: editable ? sources[0].id : undefined,
      _localId: `estoque_${key}`,
      _sourceIds: sources.map((item) => item.id).filter(Boolean),
    };
  });
}

// A Conferencia mostra sempre todos os setores: o contexto travado serve para
// lancar, nao para esconder o que ja foi contado em outro setor.
function getCountRows() {
  if (state.countSource === "estoque") return buildStockRows();
  return state.countMode === "new" ? state.sessionRows : buildPendingCountRows();
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
  setSelectOptions(elements.filterMarca, listBrands(setor, elements.filterProduto.value), marca);

  elements.filterTipo.value = state.publicFilters.tipo || "";
}

function updateFilterDependencies() {
  if (!elements.filterSetor || !elements.filterProduto || !elements.filterMarca) {
    return;
  }
  const setor = elements.filterSetor.value;
  const produto = elements.filterProduto.value;
  setSelectOptions(elements.filterProduto, listProductsBySetor(setor), produto);
  setSelectOptions(
    elements.filterMarca,
    listBrands(setor, elements.filterProduto.value),
    elements.filterMarca.value,
  );
}

function getPrintRows(scope) {
  if (scope === "public") {
    return state.publicRows.filter(matchesPublicFilters);
  }
  return getCountRows();
}

function getPrintNode(scope) {
  if (scope === "public") {
    return state.publicViewMode === "summary"
      ? elements.publicTableSummary
      : elements.publicTableDetailed;
  }
  return state.countViewMode === "summary"
    ? elements.countTableSummary
    : elements.countTableDetailed;
}

// Impressao: monta a folha em #print-area (fora da tela) e chama o dialogo do
// navegador. O @media print de assets/css/base.css imprime apenas esse bloco, e de la o
// proprio navegador salva em PDF se o operador quiser - por isso nao existe mais
// pre-visualizacao propria nem exportacao em CSV/PDF.
function ensurePrintArea() {
  const existing = document.getElementById("print-area");
  if (existing) return existing;
  const area = document.createElement("div");
  area.id = "print-area";
  area.className = "print-sheet print-offscreen";
  area.innerHTML = `
    <h1></h1>
    <p class="print-meta"></p>
    <div class="print-sheet-body"></div>`;
  document.body.appendChild(area);
  return area;
}

function printContent(title, contentNode, meta) {
  if (!contentNode) return;
  const clone = contentNode.cloneNode(true);
  clone
    .querySelectorAll(".actions, .table-modes, .view-toggle, .table-footer")
    .forEach((node) => node.remove());
  // Evita ids duplicados no documento (o clone e apenas visual).
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  clone.classList.remove("hidden");

  const area = ensurePrintArea();
  area.querySelector("h1").textContent = title;
  area.querySelector(".print-meta").textContent = meta;
  const body = area.querySelector(".print-sheet-body");
  body.textContent = "";
  body.appendChild(clone);
  // Um frame antes de imprimir: garante que o navegador ja calculou o layout da
  // folha (ela so entra no layout no proprio @media print).
  requestAnimationFrame(() => window.print());
}

// Titulo e contexto usados tanto na impressao quanto no PDF do WhatsApp.
function buildPrintHeading(scope, rows) {
  const title =
    scope === "public"
      ? "Estoque - Visao Geral"
      : state.countSource === "estoque"
        ? "Estoque atual"
        : "Contagem em andamento";
  const totalCaixas = rows.reduce(
    (sum, row) => sum + (hydrateInventoryRow(row).total_caixas || 0),
    0,
  );
  const meta = `${rows.length} ${rows.length === 1 ? "item" : "itens"} | Total ${totalCaixas} caixas | ${formatDateTime(new Date())}`;
  return { title, meta };
}

// Manda a tabela atual por WhatsApp em PDF (o wa.me nao leva anexo, entao quem
// entrega o arquivo e o Web Share do aparelho - ver share-pdf.js).
function handleWhatsApp(scope) {
  const rows = getPrintRows(scope);
  if (!rows.length) {
    pushMessage("warn", "Nenhum item para enviar.");
    return;
  }
  const { title, meta } = buildPrintHeading(scope, rows);
  import("./share-pdf.js").then((m) =>
    m.shareRowsAsPdf({
      title,
      meta,
      rows,
      filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
    }),
  );
}

function handlePrint(scope) {
  const rows = getPrintRows(scope);
  if (!rows.length) {
    pushMessage("warn", "Nenhum item para imprimir.");
    return;
  }
  const node = getPrintNode(scope);
  if (!node) return;
  const { title, meta } = buildPrintHeading(scope, rows);
  printContent(title, node, meta);
}

// Liga os eventos da tabela publica (busca, filtro, impressao, atualizar).
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
        elements.filterMarca.value,
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

  if (elements.publicPrintBtn) {
    elements.publicPrintBtn.addEventListener("click", () => handlePrint("public"));
  }
}

// Liga os eventos da tabela de contagem (view toggle, impressao).
function setupCountSourceEvents() {
  elements.countSourceSelect?.addEventListener("change", () => {
    setCountSource(elements.countSourceSelect.value);
  });
}

export function setupCountTableEvents() {
  setupCountSourceEvents();
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

  if (elements.countPrintBtn) {
    elements.countPrintBtn.addEventListener("click", () => handlePrint("count"));
  }

  if (elements.countWhatsAppBtn) {
    elements.countWhatsAppBtn.addEventListener("click", () => handleWhatsApp("count"));
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
      row.setor === setor && row.produto === produto && row.marca === marca && row.tipo === tipo,
  );
  if (found) {
    applyInventoryDeltas(found, {
      caixas_pallet,
      palletsDelta,
      caixasAvulsasDelta,
    });
  } else {
    state.sessionRows.push(
      hydrateInventoryRow({
        _localId: `local_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        setor,
        produto,
        marca,
        tipo,
        caixas_pallet,
        pallets: palletsDelta,
        caixas_avulsas: caixasAvulsasDelta,
      }),
    );
  }
}

export function getTotalCaixas(rows) {
  return (rows || []).reduce((sum, row) => {
    const normalizedRow = hydrateInventoryRow(row);
    return sum + normalizedRow.total_caixas;
  }, 0);
}
