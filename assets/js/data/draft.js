// Rascunho offline da nova contagem: protege os lancamentos no localStorage do aparelho.
import { state } from "../core/state.js";
import { COUNT_DRAFT_KEY_PREFIX } from "../core/config.js";
import { pushMessage, normalizeSetorValue } from "../core/utils.js";
import {
  aggregateRows,
  hydrateInventoryRow,
  cloneInventoryRows,
  getCurrentPublicAggregateRows,
} from "../core/inventory-core.js";

let countDraftPersistTimer = null;

function getCountDraftStorageKey(userId = state.user?.id) {
  if (!userId) return "";
  return `${COUNT_DRAFT_KEY_PREFIX}_${userId}`;
}

function normalizeDraftRows(rows, prefix = "draft") {
  return aggregateRows(
    (rows || []).map((row, index) =>
      hydrateInventoryRow({
        ...(row || {}),
        _localId:
          row?._localId || row?.id || `${prefix}_${index}_${Math.random().toString(16).slice(2)}`,
      }),
    ),
  );
}

export function hasCountDraftData() {
  return Boolean(
    state.sessionRows.length || state.previousCountRows.length || state.previousPublicRows.length,
  );
}

export function saveCountDraftLocally() {
  if (!state.user) return false;

  const storageKey = getCountDraftStorageKey();
  if (!storageKey) return false;

  if (!hasCountDraftData()) {
    localStorage.removeItem(storageKey);
    state.countDraftSavedAt = null;
    state.countDraftHash = "";
    import("../features/tables.js").then((m) => m.renderCountSyncStatus());
    return false;
  }

  const payload = {
    version: 1,
    user_id: state.user.id,
    setor: state.setor,
    produto: state.produto,
    marca: state.marca,
    tipo: state.tipo,
    count_mode: state.countMode,
    session_rows: cloneInventoryRows(state.sessionRows),
    previous_count_rows: cloneInventoryRows(state.previousCountRows),
    previous_public_rows: cloneInventoryRows(state.previousPublicRows),
    last_launch: state.lastLaunch,
  };
  const payloadHash = JSON.stringify(payload);

  if (payloadHash === state.countDraftHash) {
    import("../features/tables.js").then((m) => m.renderCountSyncStatus());
    return true;
  }

  payload.saved_at = new Date().toISOString();

  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
    state.countDraftSavedAt = payload.saved_at;
    state.countDraftHash = payloadHash;
    import("../features/tables.js").then((m) => m.renderCountSyncStatus());
    return true;
  } catch (error) {
    console.warn("Nao foi possivel salvar rascunho local da contagem.", error);
    pushMessage("warn", "Nao foi possivel salvar o rascunho offline neste aparelho.");
    import("../features/tables.js").then((m) => m.renderCountSyncStatus());
    return false;
  }
}

export function scheduleCountDraftPersist() {
  import("../features/tables.js").then((m) => m.renderCountSyncStatus());
  if (!state.user || state.countMode !== "new") return;
  clearTimeout(countDraftPersistTimer);
  countDraftPersistTimer = setTimeout(() => {
    saveCountDraftLocally();
  }, 120);
}

export function clearCountDraft(options = {}) {
  const { userId = state.user?.id, keepSavedAt = false } = options;
  clearTimeout(countDraftPersistTimer);
  const storageKey = getCountDraftStorageKey(userId);
  if (storageKey) {
    localStorage.removeItem(storageKey);
  }
  if (!keepSavedAt) {
    state.countDraftSavedAt = null;
  }
  state.countDraftHash = "";
  import("../features/tables.js").then((m) => m.renderCountSyncStatus());
}

export async function restoreCountDraftForCurrentUser() {
  if (!state.user) return false;

  const storageKey = getCountDraftStorageKey();
  if (!storageKey) return false;

  const { renderContext, renderCountTable, renderCountSyncStatus } =
    await import("../features/tables.js");
  const { updateCountModeUI } = await import("../features/count-mode.js");

  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    state.countDraftSavedAt = null;
    state.countDraftHash = "";
    state.sessionRows = [];
    state.previousCountRows = [];
    state.previousPublicRows = [];
    state.lastLaunch = null;
    state.pendingCorrection = null;
    state.countMode = "current";
    renderCountSyncStatus();
    return false;
  }

  try {
    const payload = JSON.parse(raw);
    const sessionRows = normalizeDraftRows(payload?.session_rows, "session");
    const previousCountRows = normalizeDraftRows(payload?.previous_count_rows, "previous_count");
    const previousPublicRows = normalizeDraftRows(payload?.previous_public_rows, "previous_public");
    const hasDraft = sessionRows.length || previousCountRows.length || previousPublicRows.length;

    if (!hasDraft) {
      clearCountDraft();
      state.sessionRows = [];
      state.previousCountRows = [];
      state.previousPublicRows = [];
      state.lastLaunch = null;
      state.pendingCorrection = null;
      state.countMode = "current";
      return false;
    }

    state.sessionRows = sessionRows;
    state.previousCountRows = previousCountRows.length
      ? previousCountRows
      : cloneInventoryRows(state.userRows);
    state.previousPublicRows = previousPublicRows.length
      ? previousPublicRows
      : getCurrentPublicAggregateRows();
    state.lastLaunch = payload?.last_launch || null;
    state.pendingCorrection = null;
    state.countMode = "new";
    state.selectedRowKey = null;
    state.setor = normalizeSetorValue(payload?.setor) || state.setor;
    state.produto = payload?.produto || null;
    state.marca = payload?.marca || null;
    state.tipo = payload?.tipo === 0 || Number.isFinite(payload?.tipo) ? payload.tipo : null;
    state.countDraftSavedAt = payload?.saved_at || null;
    const restoredHash = JSON.stringify({
      version: payload?.version ?? 1,
      user_id: state.user.id,
      setor: state.setor,
      produto: state.produto,
      marca: state.marca,
      tipo: state.tipo,
      count_mode: payload?.count_mode || "new",
      session_rows: cloneInventoryRows(state.sessionRows),
      previous_count_rows: cloneInventoryRows(state.previousCountRows),
      previous_public_rows: cloneInventoryRows(state.previousPublicRows),
      last_launch: state.lastLaunch,
    });
    const shouldAnnounceRestore =
      restoredHash !== state.countDraftHash || state.countMode !== "new";
    state.countDraftHash = restoredHash;

    renderContext();
    updateCountModeUI();
    renderCountTable();
    if (shouldAnnounceRestore) {
      pushMessage("info", "Rascunho local da nova contagem recuperado neste aparelho.");
    }
    renderCountSyncStatus();
    return true;
  } catch (error) {
    console.warn("Nao foi possivel restaurar rascunho local da contagem.", error);
    clearCountDraft();
    state.sessionRows = [];
    state.previousCountRows = [];
    state.previousPublicRows = [];
    state.lastLaunch = null;
    state.pendingCorrection = null;
    state.countMode = "current";
    state.countDraftHash = "";
    renderCountSyncStatus();
    return false;
  }
}
