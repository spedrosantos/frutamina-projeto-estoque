// Leitura e escrita no Supabase: estoque publico, itens do usuario e snapshots do dashboard.
// Import dinamico do dashboard.js: esse modulo roda em todas as paginas (loadPublicRecords
// e chamado no bootstrap de todas elas), mas o dashboard so existe em visao-geral.html.
import { state, supabaseClient } from "./state.js";
import {
  TABLE_NAME,
  SNAPSHOT_TABLE,
  HISTORICO_DIARIO_TABLE,
  HISTORICO_DIARIO_TOTAL_VIEW,
  USER_LABELS_TABLE,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PUBLIC_CACHE_KEY,
  PUBLIC_CACHE_AT_KEY,
  SUPABASE_TIMEOUT_MS,
  SUPABASE_READ_TIMEOUT_MS,
  SNAPSHOT_FETCH_LIMIT,
} from "./config.js";
import {
  pushMessage,
  fetchWithTimeout,
  toInt,
  getSpecialTipoVariantByValue,
  withTimeout,
} from "./utils.js";
import {
  aggregateRows,
  hydrateInventoryRow,
  buildDbRowPayload,
  isLooseBoxesSchemaError,
} from "./inventory-core.js";
import { updateLastUpdateFromRows, setPublicMessage, renderPublicTable, renderCountTable, getTotalCaixas } from "./tables.js";

function renderDashboardIfLoaded() {
  import("./dashboard.js").then((m) => m.renderDashboard());
}

export async function loadSnapshotRecords(options = {}) {
  const { showError = false } = options;
  // Ordena DESC + limit para aproveitar idx_snapshots_created_at e nao puxar o
  // historico inteiro; o dashboard consome em ordem crescente, dai o reverse().
  let data;
  let error;
  try {
    ({ data, error } = await withTimeout(
      supabaseClient
        .from(SNAPSHOT_TABLE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(SNAPSHOT_FETCH_LIMIT),
      SUPABASE_READ_TIMEOUT_MS,
      "Tempo limite ao carregar o historico."
    ));
  } catch (timeoutError) {
    error = timeoutError;
  }

  if (error) {
    if (showError) {
      pushMessage("error", `Erro ao carregar historico: ${error.message}`);
    } else {
      console.warn("Erro ao carregar historico:", error.message);
    }
    state.snapshotRows = [];
    return { data: null, error };
  }

  state.snapshotRows = (data || []).reverse();
  renderDashboardIfLoaded();
  return { data: state.snapshotRows, error: null };
}

// Serie diaria de um produto+marca (para o grafico de sazonalidade da Visao
// Geral) — 1 linha por dia, gravada pelo cron `capturar_historico_diario`
// no Supabase (ver supabase-historico-diario.sql).
export async function loadHistoricoDiario(produto, marca) {
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from(HISTORICO_DIARIO_TABLE)
        .select("data,total_caixas")
        .eq("produto", produto)
        .eq("marca", marca)
        .order("data", { ascending: true }),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao carregar o historico do produto."
    );
    if (error) {
      pushMessage("error", `Erro ao carregar historico do produto: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (error) {
    pushMessage("error", error?.message || "Erro ao carregar historico do produto.");
    return [];
  }
}

// Total diario do CD (soma de todos os produtos/marcas), para o grafico de
// sazonalidade sem filtro. Vem da view estoque_historico_diario_total — ver
// supabase-historico-diario-total.sql. Se a view ainda nao existe no banco,
// devolve [] em silencio: o grafico apenas mostra o estado vazio.
export async function loadHistoricoDiarioTotal() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from(HISTORICO_DIARIO_TOTAL_VIEW)
        .select("data,total_caixas")
        .order("data", { ascending: true }),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao carregar o historico do CD."
    );
    if (error) {
      console.warn("Erro ao carregar historico total:", error.message);
      return [];
    }
    return data || [];
  } catch (error) {
    console.warn("Erro ao carregar historico total:", error?.message || error);
    return [];
  }
}

// Nomes dos operadores, visiveis pra todos os usuarios/aparelhos (nao so pra
// quem ja logou localmente) — ver formatUserLabel em tables.js.
export async function loadUserLabels() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient.from(USER_LABELS_TABLE).select("user_id,label"),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao carregar nomes de usuarios."
    );
    if (error) {
      console.warn("Erro ao carregar nomes de usuarios:", error.message);
      return;
    }
    const map = {};
    (data || []).forEach((row) => {
      if (row.user_id) map[row.user_id] = row.label;
    });
    state.userLabels = map;
  } catch (error) {
    console.warn("Erro ao carregar nomes de usuarios:", error?.message || error);
  }
}

// Escritas nunca devem rejeitar: os chamadores (voz, formulario manual) fazem
// await sem try/catch e um timeout solto travaria o fluxo de lancamento.
async function runWrite(query, timeoutMessage) {
  try {
    return await withTimeout(query, SUPABASE_TIMEOUT_MS, timeoutMessage);
  } catch (error) {
    return { data: null, error };
  }
}

function isSnapshotOutflowSchemaError(error) {
  const message = error?.message || "";
  return /outflow_caixas/i.test(message);
}

export async function saveSnapshotRecord({ rows, outflowCaixas = 0, showSuccess = true }) {
  if (!state.user) {
    pushMessage("warn", "Faca login para salvar o historico.");
    return false;
  }
  const normalizedRows = aggregateRows(rows || []);
  const total = getTotalCaixas(normalizedRows);
  const payload = {
    user_id: state.user.id,
    total_caixas: total,
  };
  if (outflowCaixas > 0) {
    payload.outflow_caixas = outflowCaixas;
  }

  const { error } = await runWrite(
    supabaseClient.from(SNAPSHOT_TABLE).insert(payload),
    "Tempo limite ao salvar o historico."
  );
  if (error) {
    const message = isSnapshotOutflowSchemaError(error)
      ? "Historico salvo sem saida. Rode a migracao do dashboard no Supabase."
      : `Erro ao salvar historico: ${error.message}`;
    pushMessage("error", message);
    return false;
  }
  if (showSuccess) {
    pushMessage("success", "Historico salvo com sucesso.");
  }
  await loadSnapshotRecords();
  return true;
}

function savePublicCache(rows) {
  try {
    localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(rows || []));
    localStorage.setItem(PUBLIC_CACHE_AT_KEY, new Date().toISOString());
  } catch (error) {
    console.warn("Nao foi possivel salvar cache publico.", error);
  }
}

function loadPublicCache() {
  try {
    const raw = localStorage.getItem(PUBLIC_CACHE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Nao foi possivel ler cache publico.", error);
    return [];
  }
}

export async function loadPublicRecords() {
  let data;
  let error;
  try {
    ({ data, error } = await withTimeout(
      supabaseClient.from(TABLE_NAME).select("*"),
      SUPABASE_READ_TIMEOUT_MS,
      "Tempo limite ao carregar o estoque."
    ));
  } catch (timeoutError) {
    error = timeoutError;
  }

  if (error) {
    const cached = loadPublicCache();
    if (cached.length) {
      state.rawPublicRows = cached;
      state.publicRows = aggregateRows(cached);
      updateLastUpdateFromRows(cached, "public");
      renderPublicTable();
      renderCountTable();
      renderDashboardIfLoaded();
      setPublicMessage(
        "warn",
        "Sem acesso ao servidor. Exibindo o ultimo estoque salvo."
      );
      return;
    }
    setPublicMessage("error", `Erro ao carregar dados: ${error.message}`);
    return;
  }

  state.rawPublicRows = data || [];
  savePublicCache(state.rawPublicRows);
  state.publicRows = aggregateRows(data || []);
  updateLastUpdateFromRows(data || [], "public");
  renderPublicTable();
  renderCountTable();
  renderDashboardIfLoaded();
  setPublicMessage("", "");
}

export async function loadUserRecords(options = {}) {
  const { showError = true } = options;
  if (!state.user) {
    state.userRows = [];
    renderCountTable();
    return { data: [], error: null };
  }
  let data;
  let error;
  try {
    ({ data, error } = await withTimeout(
      supabaseClient.from(TABLE_NAME).select("*").eq("user_id", state.user.id),
      SUPABASE_READ_TIMEOUT_MS,
      "Tempo limite ao carregar itens do usuario."
    ));
  } catch (timeoutError) {
    error = timeoutError;
  }

  if (error) {
    if (showError) {
      pushMessage("error", `Erro ao carregar itens do usuario: ${error.message}`);
    }
    return { data: null, error };
  }

  state.userRows = (data || []).map((row) => hydrateInventoryRow(row));
  updateLastUpdateFromRows(state.userRows, "count");
  renderCountTable();
  return { data: state.userRows, error: null };
}

// Um mesmo tipo pode estar gravado no banco com um valor legado (ex: 601
// antes de virar 14, para o 6A do ORANGE) — busca por todos os valores
// possiveis para nao criar um registro duplicado nem falhar em achar o atual.
function buildTipoSearchValues(produto, tipo) {
  const variant = getSpecialTipoVariantByValue(produto, tipo);
  if (!variant) return [tipo];
  return [variant.value, ...(variant.legacyValues || [])];
}

export async function upsertRecord({
  setor,
  produto,
  marca,
  tipo,
  caixas_pallet,
  palletsDelta = 1,
  caixasAvulsasDelta = 0,
}) {
  if (!state.user) return false;
  const { data: existing, error: selectError } = await runWrite(
    supabaseClient
      .from(TABLE_NAME)
      .select("*")
      .eq("user_id", state.user.id)
      .eq("setor", setor)
      .eq("produto", produto)
      .eq("marca", marca)
      .in("tipo", buildTipoSearchValues(produto, tipo))
      .maybeSingle(),
    "Tempo limite ao consultar o registro."
  );

  if (selectError) {
    pushMessage("error", `Erro ao consultar registro: ${selectError.message}`);
    return false;
  }

  if (existing) {
    const current = hydrateInventoryRow(existing);
    const updated = hydrateInventoryRow(current, {
      caixas_pallet: caixas_pallet ?? current.caixas_pallet,
      pallets: current.pallets + toInt(palletsDelta, 0),
      caixas_avulsas: current.caixas_avulsas + toInt(caixasAvulsasDelta, 0),
    });
    const payload = buildDbRowPayload(
      updated,
      false,
      Object.prototype.hasOwnProperty.call(existing || {}, "caixas_avulsas") ||
      updated.caixas_avulsas > 0 ||
      toInt(caixasAvulsasDelta, 0) !== 0
    );
    const { error } = await runWrite(
      supabaseClient.from(TABLE_NAME).update(payload).eq("id", existing.id),
      "Tempo limite ao atualizar o registro."
    );

    if (error) {
      const message = isLooseBoxesSchemaError(error)
        ? "Erro ao atualizar registro: rode a migracao de caixas avulsas no Supabase."
        : `Erro ao atualizar registro: ${error.message}`;
      pushMessage("error", message);
      return false;
    }
  } else {
    const newRow = hydrateInventoryRow({
      user_id: state.user.id,
      setor,
      produto,
      marca,
      tipo,
      caixas_pallet,
      pallets: palletsDelta,
      caixas_avulsas: caixasAvulsasDelta,
    });
    const { error } = await runWrite(
      supabaseClient.from(TABLE_NAME).insert(buildDbRowPayload(newRow, true)),
      "Tempo limite ao salvar o registro."
    );

    if (error) {
      const message = isLooseBoxesSchemaError(error)
        ? "Erro ao salvar registro: rode a migracao de caixas avulsas no Supabase."
        : `Erro ao salvar registro: ${error.message}`;
      pushMessage("error", message);
      return false;
    }
  }
  return true;
}

export async function probeSupabase() {
  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
      8000
    );
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  }
}
