// Aplica os overrides de catalogo de produtos sobre CONFIG_GERAL. A fonte de
// verdade e a tabela catalog_overrides no Supabase (catalogo global, visto por
// todos os usuarios/dispositivos); o localStorage so guarda uma copia de
// leitura, para a pagina nao ficar em branco se abrir offline.
// Precisa rodar no boot de TODAS as paginas: um produto cadastrado em
// produtos.html so aparece no parser de voz/manual de editar.html se isso
// rodar la tambem.
import { state, supabaseClient } from "../core/state.js";
import {
  CONFIG_GERAL,
  BASE_CONFIG_GERAL,
  NO_TIPO_PRODUCTS,
  BASE_NO_TIPO_PRODUCTS,
  NO_TIPO_VALUE,
  TIPO_MIN,
  TIPO_MAX,
  CATALOG_TABLE,
  CATALOG_ADDITIONS_KEY,
  CATALOG_REMOVALS_KEY,
  SUPABASE_TIMEOUT_MS,
  cloneConfigTree,
} from "../core/config.js";
import {
  toNonNegativeInt,
  normalizeSetorValue,
  isNoTipoContext,
  isTipoValidForContext,
  withTimeout,
  readJsonArray,
  writeLocalEntries,
} from "../core/utils.js";

const CACHE_READ_WARNING = "Nao foi possivel ler o cache local do catalogo.";

function readCatalogCacheArray(key) {
  return readJsonArray(key, CACHE_READ_WARNING);
}

export function writeCatalogCache(additions, removals) {
  writeLocalEntries(
    [
      [CATALOG_ADDITIONS_KEY, additions],
      [CATALOG_REMOVALS_KEY, removals],
    ],
    "Nao foi possivel salvar o cache local do catalogo.",
  );
}

function cleanCatalogLabel(value) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9() /-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCatalogEntryKey({ setor, produto, marca }) {
  return `${setor}|||${produto}|||${marca}`;
}

export function parseCatalogEntryKey(key) {
  const parts = String(key || "").split("|||");
  if (parts.length !== 3) return null;
  const [setor, produto, marca] = parts;
  if (!setor || !produto || !marca) return null;
  return { setor, produto, marca };
}

function normalizeCatalogRemovalEntry(entry) {
  const setor = normalizeSetorValue(cleanCatalogLabel(entry?.setor || ""));
  const produto = cleanCatalogLabel(entry?.produto || "");
  const marca = cleanCatalogLabel(entry?.marca || "");
  if (!setor || !produto || !marca) return null;
  return { setor, produto, marca };
}

export function normalizeCatalogAdditionEntry(entry) {
  const base = normalizeCatalogRemovalEntry(entry);
  if (!base) return null;
  const caixasPallet = toNonNegativeInt(entry?.caixasPallet, 0);
  if (caixasPallet <= 0) return null;
  const result = {
    ...base,
    caixasPallet,
    noTipo: Boolean(entry?.noTipo),
  };

  const hasRangeInput = [entry?.tipoMin, entry?.tipoMax, entry?.caixasPalletInRange].some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (hasRangeInput) {
    const tipoMin = toNonNegativeInt(entry?.tipoMin, 0);
    const tipoMax = toNonNegativeInt(entry?.tipoMax, 0);
    const caixasPalletInRange = toNonNegativeInt(entry?.caixasPalletInRange, 0);
    if (tipoMin < TIPO_MIN || tipoMax > TIPO_MAX || tipoMin > tipoMax || caixasPalletInRange <= 0) {
      return null;
    }
    result.tipoMin = tipoMin;
    result.tipoMax = tipoMax;
    result.caixasPalletInRange = caixasPalletInRange;
  }

  return result;
}

function dedupeCatalogEntries(entries, normalizer) {
  const map = new Map();
  (entries || []).forEach((entry) => {
    const normalized = normalizer(entry);
    if (!normalized) return;
    map.set(buildCatalogEntryKey(normalized), normalized);
  });
  return Array.from(map.values());
}

function buildCaixasRule(entry) {
  const fixedValue = toNonNegativeInt(entry.caixasPallet, 0);
  if (
    Number.isFinite(entry.tipoMin) &&
    Number.isFinite(entry.tipoMax) &&
    Number.isFinite(entry.caixasPalletInRange)
  ) {
    const { tipoMin, tipoMax, caixasPalletInRange } = entry;
    return (t) => (t >= tipoMin && t <= tipoMax ? caixasPalletInRange : fixedValue);
  }
  return () => fixedValue;
}

export function configHasCatalogEntry(config, { setor, produto, marca }) {
  return typeof config?.[setor]?.[produto]?.[marca] === "function";
}

function removeCatalogEntryFromConfig(config, { setor, produto, marca }) {
  if (!config?.[setor]?.[produto]?.[marca]) return;
  delete config[setor][produto][marca];
  if (!Object.keys(config[setor][produto]).length) {
    delete config[setor][produto];
  }
}

function replaceConfigFromSource(sourceConfig = {}) {
  Object.keys(CONFIG_GERAL).forEach((setor) => {
    delete CONFIG_GERAL[setor];
  });
  Object.entries(sourceConfig).forEach(([setor, produtos]) => {
    CONFIG_GERAL[setor] = {};
    Object.entries(produtos || {}).forEach(([produto, marcas]) => {
      CONFIG_GERAL[setor][produto] = { ...(marcas || {}) };
    });
  });
}

export function applyCatalogOverridesFromState() {
  const nextConfig = cloneConfigTree(BASE_CONFIG_GERAL);

  state.catalogRemovals.forEach((entry) => {
    removeCatalogEntryFromConfig(nextConfig, entry);
  });

  state.catalogAdditions.forEach((entry) => {
    if (!nextConfig[entry.setor]) {
      nextConfig[entry.setor] = {};
    }
    if (!nextConfig[entry.setor][entry.produto]) {
      nextConfig[entry.setor][entry.produto] = {};
    }
    nextConfig[entry.setor][entry.produto][entry.marca] = buildCaixasRule(entry);
  });

  replaceConfigFromSource(nextConfig);

  NO_TIPO_PRODUCTS.clear();
  BASE_NO_TIPO_PRODUCTS.forEach((produto) => NO_TIPO_PRODUCTS.add(produto));
  state.catalogAdditions.forEach((entry) => {
    if (entry.noTipo) {
      NO_TIPO_PRODUCTS.add(entry.produto);
    }
  });
}

function rowToAddition(row) {
  return normalizeCatalogAdditionEntry({
    setor: row.setor,
    produto: row.produto,
    marca: row.marca,
    caixasPallet: row.caixas_pallet,
    noTipo: row.no_tipo,
    tipoMin: row.tipo_min,
    tipoMax: row.tipo_max,
    caixasPalletInRange: row.caixas_pallet_in_range,
  });
}

function rowToRemoval(row) {
  return normalizeCatalogRemovalEntry(row);
}

// upsertCatalogRow e deleteCatalogRow sempre devolvem { error } em vez de deixar
// o timeout/falha de rede do withTimeout rejeitar — senao o await sem try/catch
// em catalog-crud.js trava o modal na mensagem "Salvando/Removendo..." pra sempre.
async function upsertCatalogRow(kind, entry, extra = {}) {
  try {
    return await withTimeout(
      supabaseClient.from(CATALOG_TABLE).upsert(
        {
          kind,
          setor: entry.setor,
          produto: entry.produto,
          marca: entry.marca,
          created_by: state.user?.id || null,
          ...extra,
        },
        { onConflict: "kind,setor,produto,marca" },
      ),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao salvar o catalogo.",
    );
  } catch (error) {
    return { error };
  }
}

async function deleteCatalogRow(kind, entry) {
  try {
    return await withTimeout(
      supabaseClient
        .from(CATALOG_TABLE)
        .delete()
        .eq("kind", kind)
        .eq("setor", entry.setor)
        .eq("produto", entry.produto)
        .eq("marca", entry.marca),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao salvar o catalogo.",
    );
  } catch (error) {
    return { error };
  }
}

// Grava um produto/marca cadastrado (desfaz uma remocao anterior da mesma
// combinacao, se existir) — usada por addCatalogEntryFromForm.
export async function saveCatalogAddition(addition) {
  const deleteResult = await deleteCatalogRow("removal", addition);
  if (deleteResult?.error) return { error: deleteResult.error };
  const upsertResult = await upsertCatalogRow("addition", addition, {
    caixas_pallet: addition.caixasPallet,
    no_tipo: addition.noTipo,
    tipo_min: addition.tipoMin ?? null,
    tipo_max: addition.tipoMax ?? null,
    caixas_pallet_in_range: addition.caixasPalletInRange ?? null,
  });
  return { error: upsertResult?.error || null };
}

// Remove um produto/marca do catalogo. Se ele existia no catalogo original
// (BASE_CONFIG_GERAL), grava tambem uma remocao para suprimi-lo — usada por
// removeCatalogEntryByKey.
export async function removeCatalogEntry(entry, { markRemoved }) {
  const deleteResult = await deleteCatalogRow("addition", entry);
  if (deleteResult?.error) return { error: deleteResult.error };
  if (!markRemoved) return { error: null };
  const upsertResult = await upsertCatalogRow("removal", entry);
  return { error: upsertResult?.error || null };
}

function commitCatalogOverrides(additions, removals) {
  const additionKeys = new Set(additions.map((entry) => buildCatalogEntryKey(entry)));
  state.catalogAdditions = additions;
  state.catalogRemovals = removals.filter(
    (entry) => !additionKeys.has(buildCatalogEntryKey(entry)),
  );
  applyCatalogOverridesFromState();
}

function catalogStateFingerprint() {
  return JSON.stringify([state.catalogAdditions, state.catalogRemovals]);
}

// Aplica o catalogo a partir do cache local, de forma sincrona. Roda no boot de
// todas as paginas para a UI ja montar com o catalogo correto sem esperar rede.
export function applyCatalogOverridesFromCache() {
  commitCatalogOverrides(
    dedupeCatalogEntries(
      readCatalogCacheArray(CATALOG_ADDITIONS_KEY),
      normalizeCatalogAdditionEntry,
    ),
    dedupeCatalogEntries(readCatalogCacheArray(CATALOG_REMOVALS_KEY), normalizeCatalogRemovalEntry),
  );
}

// Busca o catalogo global no Supabase em background e reaplica se mudou.
// Devolve true quando o resultado difere do que ja estava aplicado, para o
// chamador re-renderizar a UI dependente de catalogo apenas nesse caso.
export async function refreshCatalogOverrides() {
  const before = catalogStateFingerprint();
  try {
    const { data, error } = await withTimeout(
      supabaseClient.from(CATALOG_TABLE).select("*"),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao carregar o catalogo.",
    );
    if (error) throw error;
    const additions = dedupeCatalogEntries(
      (data || []).filter((row) => row.kind === "addition"),
      rowToAddition,
    );
    const removals = dedupeCatalogEntries(
      (data || []).filter((row) => row.kind === "removal"),
      rowToRemoval,
    );
    writeCatalogCache(additions, removals);
    commitCatalogOverrides(additions, removals);
  } catch (error) {
    console.warn("Nao foi possivel carregar o catalogo do Supabase, mantendo cache local.", error);
    return false;
  }
  return catalogStateFingerprint() !== before;
}

export function sanitizeContextAfterCatalogChange() {
  const setores = Object.keys(CONFIG_GERAL);
  if (!setores.length) {
    state.setor = "";
    state.produto = null;
    state.marca = null;
    state.tipo = null;
    return;
  }

  if (!CONFIG_GERAL[state.setor]) {
    state.setor = setores[0];
  }

  if (state.produto && !CONFIG_GERAL[state.setor]?.[state.produto]) {
    state.produto = null;
    state.marca = null;
    state.tipo = null;
    return;
  }

  if (state.marca && !CONFIG_GERAL[state.setor]?.[state.produto]?.[state.marca]) {
    state.marca = null;
    state.tipo = null;
  }

  if (state.produto && state.marca && state.tipo !== null && state.tipo !== undefined) {
    const noTipo = isNoTipoContext(state.produto, state.marca);
    if (noTipo) {
      state.tipo = NO_TIPO_VALUE;
    } else if (!isTipoValidForContext(state.produto, state.tipo)) {
      state.tipo = null;
    }
  }
}
