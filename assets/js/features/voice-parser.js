// Parser dos comandos de voz e texto: transforma a frase reconhecida em numeros,
// tipos e intencoes ("adicionar", "remover", "corrigir", "lancar", "salvar",
// "descartar"). Nada aqui toca a tela nem o estado global - e por isso a parte
// do fluxo de voz que da para testar sozinha (ver tests/voice-parser.test.js).
//
// Quem age sobre o que sai daqui e voice-actions.js.

import {
  ADD_KEYWORDS,
  BOX_KEYWORDS,
  CONFIG_GERAL,
  CORRECT_KEYWORDS,
  DISCARD_KEYWORDS,
  LAUNCH_KEYWORDS,
  NUMBER_WORDS,
  REMOVE_KEYWORDS,
  SAVE_KEYWORDS,
  TIPO_MAX,
  TIPO_MIN,
} from "../core/config.js";
import {
  buildNormalizedMap,
  findExactMatch,
  formatTipoLabelValue,
  isNoTipoProduct,
  getTipoSortOrder,
  isTipoValidForContext,
  matchSpecialTipoAtTokens,
  normalizeText,
  tokenizeText,
} from "../core/utils.js";

export function hasBoxKeyword(text) {
  return tokenizeText(text).some((token) => BOX_KEYWORDS.has(token));
}

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

export function extractCommandTokens(text, ignoredValues = []) {
  const tokens = tokenizeText(text);
  if (!tokens.length) return [];

  const ignoredIndexes = buildIgnoredTokenIndexes(tokens, ignoredValues);

  return tokens.filter((token, index) => !ignoredIndexes.has(index));
}

export function extractCommandNumbers(text, ignoredValues = [], produto = "") {
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

export function extractCommandTipoValues(text, produto, ignoredValues = []) {
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

export function isAddCommand(text) {
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  return tokens.some((token) => ADD_KEYWORDS.has(token));
}

export function isRemoveCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => REMOVE_KEYWORDS.has(token));
}

export function isCorrectCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => CORRECT_KEYWORDS.has(token));
}

export function isLaunchCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => LAUNCH_KEYWORDS.has(token));
}

export function isSaveCommand(text) {
  const tokens = tokenizeText(text);
  return tokens.some((token) => SAVE_KEYWORDS.has(token));
}

export function isDiscardCommand(text) {
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
export function splitOversizedTipoNumbers(values, produto) {
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

export function buildMaps(setor) {
  const products = CONFIG_GERAL[setor] || {};
  const productMap = buildNormalizedMap(Object.keys(products));
  return { products, productMap };
}

export function buildBrandMap(products, product) {
  return buildNormalizedMap(Object.keys(products?.[product] || {}));
}

export function buildAllBrandMap(products) {
  const allBrands = [];
  Object.keys(products || {}).forEach((product) => {
    allBrands.push(...Object.keys(products[product] || {}));
  });
  return buildNormalizedMap(allBrands);
}

export function formatTipoCounts(tipoCounts, produto, marca = "") {
  return Array.from(tipoCounts.entries())
    .sort((a, b) => getTipoSortOrder(produto, a[0]) - getTipoSortOrder(produto, b[0]))
    .map(([tipo, count]) => {
      const tipoLabel = formatTipoLabelValue(produto, tipo, marca);
      return count > 1 ? `${tipoLabel}x${count}` : String(tipoLabel);
    })
    .join(", ");
}

/*
  Resolve para que setor/produto/marca a frase aponta.

  Esta e a parte do comando de voz onde um erro custa dado: se o produto muda e
  a marca antiga fica de pe, a contagem vai parar na linha errada sem ninguem
  perceber. Por isso a cascata e explicita - setor novo zera produto, marca e
  tipo; produto novo zera marca e tipo; marca nova zera o tipo.

  Sem estado global e sem tela: recebe o contexto atual, devolve o proximo mais
  as mensagens que o chamador deve mostrar.
*/
export function resolveVoiceContext(tokens, contexto = {}) {
  let { setor = null, produto = null, marca = null, tipo = null } = contexto;
  const mensagens = [];

  const sectorFound = findExactMatch(tokens, buildNormalizedMap(Object.keys(CONFIG_GERAL)));
  if (sectorFound) {
    if (sectorFound !== setor) {
      produto = null;
      marca = null;
      tipo = null;
    }
    setor = sectorFound;
    mensagens.push({ level: "info", text: `Setor fixado: ${sectorFound}` });
  }

  const { products, productMap } = buildMaps(setor);
  const productFound = findExactMatch(tokens, productMap);
  if (productFound) {
    if (productFound !== produto) {
      marca = null;
      tipo = null;
    }
    produto = productFound;
    mensagens.push({ level: "info", text: `Produto fixado: ${productFound}` });
  }

  let brandFound = null;
  if (produto) {
    brandFound = findExactMatch(tokens, buildBrandMap(products, produto));
    if (brandFound) {
      if (brandFound !== marca) {
        tipo = null;
      }
      marca = brandFound;
      mensagens.push({
        level: "info",
        text:
          /\bKG\b/.test(normalizeText(brandFound)) && !isNoTipoProduct(produto)
            ? `Marca fixada: ${brandFound}. Agora diga o tipo.`
            : `Marca fixada: ${brandFound}`,
      });
    }
  } else if (findExactMatch(tokens, buildAllBrandMap(products))) {
    // A marca so existe dentro de um produto: sem produto nao da para saber qual.
    mensagens.push({ level: "warn", text: "Diga o produto antes da marca." });
  }

  return {
    setor,
    produto,
    marca,
    tipo,
    products,
    sectorFound,
    productFound,
    brandFound,
    mensagens,
  };
}
