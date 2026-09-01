// Utilitarios transversais: numeros, texto/voz, tipos especiais e mensagens de UI.
import {
  NO_TIPO_PRODUCTS,
  TIPO_MIN,
  TIPO_MAX,
  SPECIAL_TIPO_VARIANTS,
  CONFIG_GERAL,
} from "./config.js";
import { elements } from "./state.js";

export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNonNegativeInt(value, fallback = 0) {
  return Math.max(0, toInt(value, fallback));
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("pt-BR").format(Math.round(value));
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function normalizeText(text) {
  const base = (text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "";

  const spaced = base
    .replace(/([A-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Z])/g, "$1 $2");

  const tokens = spaced.split(" ").filter(Boolean);
  if (!tokens.length) return "";

  const tokenMap = {
    QUILO: "KG",
    QUILOS: "KG",
    KILO: "KG",
    KILOS: "KG",
    QUILOGRAMA: "KG",
    QUILOGRAMAS: "KG",
    CEP: "CEPI",
    BRASIL: "BRAZIL",
    ORANAGE: "ORANGE",
    ROSA: "COSA",
    COSTA: "COSA",
    COZA: "COSA",
    KOSA: "COSA",
    KOZA: "COSA",
    MAGALY: "MAGALI",
  };

  return tokens.map((token) => tokenMap[token] || token).join(" ").trim();
}

export function tokenizeText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export function buildNormalizedMap(values) {
  const map = {};
  (values || []).forEach((value) => {
    const key = normalizeText(value);
    if (!key) return;
    map[key] = value;
  });
  return map;
}

function containsTokenSequence(tokens, sequence) {
  if (!sequence.length || tokens.length < sequence.length) return false;
  for (let i = 0; i <= tokens.length - sequence.length; i += 1) {
    let match = true;
    for (let j = 0; j < sequence.length; j += 1) {
      if (tokens[i + j] !== sequence[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export function matchSpecialTipoAtTokens(produto, tokens, index) {
  const variants = getSpecialTipoVariants(produto);
  if (!variants.length) return null;
  for (const variant of variants) {
    const sequence = variant.matchSequences.find((candidate) =>
      candidate.every((token, offset) => tokens[index + offset] === token)
    );
    if (sequence) {
      return { value: variant.value, length: sequence.length };
    }
  }
  return null;
}

export function findExactMatch(tokens, map) {
  const entries = Object.entries(map || {}).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    if (!key) continue;
    const seq = key.split(" ").filter(Boolean);
    if (!seq.length) continue;
    if (containsTokenSequence(tokens, seq)) {
      return value;
    }
  }
  return null;
}

export function toAuthEmail(value) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const normalized = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const sanitized = normalized
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
  if (!sanitized) return "";
  return `${sanitized}@cd.local`;
}

export function displayUserFromEmail(email) {
  if (!email) return "--";
  return email.split("@")[0] || email;
}

export function isNoTipoProduct(produto) {
  if (!produto) return false;
  return NO_TIPO_PRODUCTS.has(normalizeText(produto));
}

export function isNoTipoContext(produto, marca) {
  return isNoTipoProduct(produto);
}

function isTipoValid(tipo) {
  return Number.isFinite(tipo) && tipo >= TIPO_MIN && tipo <= TIPO_MAX;
}

function getSpecialTipoVariants(produto) {
  if (!produto) return [];
  return SPECIAL_TIPO_VARIANTS[normalizeText(produto)] || [];
}

export function getSpecialTipoVariantByValue(produto, tipo) {
  const numericTipo = Number.parseInt(tipo, 10);
  if (!Number.isFinite(numericTipo)) return null;
  return (
    getSpecialTipoVariants(produto).find(
      (variant) =>
        variant.value === numericTipo ||
        (variant.legacyValues || []).includes(numericTipo)
    ) ||
    null
  );
}

export function normalizeStoredTipoValue(produto, tipo) {
  const specialVariant = getSpecialTipoVariantByValue(produto, tipo);
  if (specialVariant) {
    return specialVariant.value;
  }
  const numericTipo = Number.parseInt(tipo, 10);
  return Number.isFinite(numericTipo) ? numericTipo : tipo;
}

export function isSpecialTipoVariantValue(produto, tipo) {
  return Boolean(getSpecialTipoVariantByValue(produto, tipo));
}

function isSplitTipoBase(produto, tipo) {
  const numericTipo = Number.parseInt(tipo, 10);
  if (!Number.isFinite(numericTipo)) return false;
  return getSpecialTipoVariants(produto).some(
    (variant) => variant.baseValue === numericTipo
  );
}

export function getTipoRuleValue(produto, tipo) {
  const specialVariant = getSpecialTipoVariantByValue(produto, tipo);
  if (specialVariant) {
    return specialVariant.baseValue;
  }
  const numericTipo = Number.parseInt(tipo, 10);
  return Number.isFinite(numericTipo) ? numericTipo : tipo;
}

export function getTipoSortOrder(produto, tipo) {
  const specialVariant = getSpecialTipoVariantByValue(produto, tipo);
  if (specialVariant) {
    return specialVariant.sortOrder;
  }
  const numericTipo = Number.parseInt(tipo, 10);
  return Number.isFinite(numericTipo) ? numericTipo * 10 : 0;
}

export function getTipoExampleHint(produto) {
  if (hasSpecialTipoVariants(produto)) {
    return "5, 6A ou 6B";
  }
  return "4";
}

export function buildTipoOptionList(produto) {
  const options = [];
  const reservedValues = new Set(
    getSpecialTipoVariants(produto).map((variant) => Number.parseInt(variant.value, 10))
  );
  for (let tipo = TIPO_MIN; tipo <= TIPO_MAX; tipo += 1) {
    const variants = getSpecialTipoVariants(produto).filter(
      (variant) => variant.baseValue === tipo
    );
    if (variants.length) {
      variants.forEach((variant) => {
        options.push({ value: String(variant.value), label: variant.label });
      });
      continue;
    }
    if (reservedValues.has(tipo)) {
      continue;
    }
    options.push({ value: String(tipo), label: String(tipo) });
  }
  return options;
}

function getSpecialTipoLabel(produto, tipo) {
  return getSpecialTipoVariantByValue(produto, tipo)?.label || null;
}

export function hasSpecialTipoVariants(produto) {
  return getSpecialTipoVariants(produto).length > 0;
}

export function isTipoValidForContext(produto, tipo) {
  if (isSpecialTipoVariantValue(produto, tipo)) {
    return true;
  }
  const numericTipo = Number.parseInt(tipo, 10);
  if (!Number.isFinite(numericTipo)) return false;
  if (!isTipoValid(numericTipo)) return false;
  if (isSplitTipoBase(produto, numericTipo)) return false;
  return true;
}

export function getTipoValidationMessage(produto) {
  if (hasSpecialTipoVariants(produto)) {
    return "Para ORANGE, use os tipos de 3 a 15. No tipo 6, informe 6A ou 6B.";
  }
  return "Tipo deve estar entre 3 e 15.";
}

export function formatTipoLabelValue(produto, tipo, marca = "") {
  if (isNoTipoContext(produto, marca)) {
    return "S/T";
  }
  return getSpecialTipoLabel(produto, tipo) || tipo;
}

export function parseTipoInputValue(value, produto) {
  // normalizeText descarta o "-", entao um sinal negativo e detectado antes
  // de normalizar para que "-5" seja rejeitado na validacao (< TIPO_MIN) em
  // vez de virar silenciosamente "5".
  const isNegative = /^-/.test(String(value || "").trim());
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;

  const specialMatch = getSpecialTipoVariants(produto).find((variant) =>
    variant.label === normalizedValue ||
    variant.matchSequences.some((sequence) => sequence.join(" ") === normalizedValue)
  );
  if (specialMatch) {
    return specialMatch.value;
  }

  const numericTipo = Number.parseInt(normalizedValue, 10);
  if (!Number.isFinite(numericTipo)) return null;
  return isNegative ? -numericTipo : numericTipo;
}

export function listProductsBySetor(setor) {
  const products = new Set();
  if (setor) {
    Object.keys(CONFIG_GERAL[setor] || {}).forEach((p) => products.add(p));
  } else {
    Object.keys(CONFIG_GERAL).forEach((s) => {
      Object.keys(CONFIG_GERAL[s]).forEach((p) => products.add(p));
    });
  }
  return Array.from(products).sort();
}

export function listBrands(setor, produto) {
  const brands = new Set();
  const setores = setor ? [setor] : Object.keys(CONFIG_GERAL);
  setores.forEach((s) => {
    const produtos = CONFIG_GERAL[s] || {};
    if (produto) {
      Object.keys(produtos[produto] || {}).forEach((b) => brands.add(b));
    } else {
      Object.keys(produtos).forEach((p) => {
        Object.keys(produtos[p] || {}).forEach((b) => brands.add(b));
      });
    }
  });
  return Array.from(brands).sort();
}

export function setSelectOptions(select, options, currentValue) {
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Todos";
  select.appendChild(empty);
  options.forEach((optionValue) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    select.appendChild(option);
  });
  select.value = currentValue || "";
}

export function setSelectOptionsWithPlaceholder(
  select,
  options,
  currentValue,
  placeholder
) {
  if (!select) return;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder || "Selecione";
  select.appendChild(empty);
  options.forEach((optionValue) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    select.appendChild(option);
  });
  select.value = currentValue || "";
}

export function setNumberOptions(select, min, max, currentValue, placeholder) {
  if (!select) return;
  select.innerHTML = "";
  if (placeholder) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
  }
  for (let value = min; value <= max; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }
  if (currentValue !== undefined && currentValue !== null && currentValue !== "") {
    select.value = String(currentValue);
  } else if (placeholder) {
    select.value = "";
  }
}

export function pushMessage(type, text) {
  if (!elements.messages) return;
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;
  msg.textContent = text;
  elements.messages.prepend(msg);
  while (elements.messages.children.length > 5) {
    elements.messages.removeChild(elements.messages.lastChild);
  }
}

export function cleanLabel(value) {
  return normalizeText(value);
}

export function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

export function normalizeSetorValue(rawSetor) {
  if (!rawSetor) return rawSetor;
  const targetKey = normalizeKey(rawSetor);
  const match = Object.keys(CONFIG_GERAL).find(
    (setor) => normalizeKey(setor) === targetKey
  );
  return match || rawSetor;
}

export function getRowKey(row) {
  return row?.id ?? row?._localId ?? null;
}

export async function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message || "Tempo limite excedido."));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/*
  localStorage sempre no mesmo formato: JSON dentro de try/catch com um aviso no
  console. O par abaixo existia solto em catalog-overrides.js e supabase-api.js,
  com a mesma logica escrita duas vezes.

  Todo acesso pode falhar (aba privada, cota cheia, site data bloqueado), por isso
  a leitura devolve [] em vez de estourar e a escrita apenas avisa.
*/
export function readJsonArray(key, warning) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(warning, error);
    return [];
  }
}

/**
 * @param {[string, unknown][]} entries pares chave/valor; valor vai como JSON,
 *   exceto string, que e gravada crua (datas ISO, ids).
 */
export function writeLocalEntries(entries, warning) {
  try {
    for (const [key, value] of entries) {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    return true;
  } catch (error) {
    console.warn(warning, error);
    return false;
  }
}
