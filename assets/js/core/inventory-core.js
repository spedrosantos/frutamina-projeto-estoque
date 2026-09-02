// Utilitarios de inventario: normalizacao de metricas, agregacao e payload do Supabase.
import { toInt, toNonNegativeInt, normalizeStoredTipoValue } from "./utils.js";
import { state } from "./state.js";

/**
 * Regra central das metricas:
 * total_caixas = pallets * caixas_pallet + caixas_avulsas.
 * Se as caixas avulsas fecharem um pallet completo, a conversao e automatica.
 */
export function normalizeInventoryMetrics({
  caixasPallet,
  pallets = 0,
  caixasAvulsas,
  totalCaixas,
}) {
  const caixasPorPallet = toNonNegativeInt(caixasPallet, 0);
  let palletsCount = toNonNegativeInt(pallets, 0);
  const hasLooseBoxesValue =
    caixasAvulsas !== undefined && caixasAvulsas !== null && caixasAvulsas !== "";
  let looseBoxes = toNonNegativeInt(caixasAvulsas, 0);
  let totalBoxes = toNonNegativeInt(totalCaixas, 0);

  if (!caixasPorPallet) {
    if (!hasLooseBoxesValue) {
      totalBoxes = toNonNegativeInt(totalCaixas, palletsCount);
      looseBoxes = totalBoxes;
      palletsCount = 0;
    } else {
      totalBoxes = looseBoxes;
      palletsCount = 0;
    }

    return {
      caixas_pallet: caixasPorPallet,
      pallets: palletsCount,
      caixas_avulsas: looseBoxes,
      total_caixas: totalBoxes,
    };
  }

  if (hasLooseBoxesValue) {
    if (looseBoxes >= caixasPorPallet) {
      palletsCount += Math.floor(looseBoxes / caixasPorPallet);
      looseBoxes %= caixasPorPallet;
    }
    totalBoxes = palletsCount * caixasPorPallet + looseBoxes;
  } else {
    totalBoxes = toNonNegativeInt(totalCaixas, palletsCount * caixasPorPallet);
    palletsCount = Math.floor(totalBoxes / caixasPorPallet);
    looseBoxes = totalBoxes % caixasPorPallet;
  }

  return {
    caixas_pallet: caixasPorPallet,
    pallets: palletsCount,
    caixas_avulsas: looseBoxes,
    total_caixas: totalBoxes,
  };
}

export function hydrateInventoryRow(row, overrides = {}) {
  const base = { ...(row || {}), ...(overrides || {}) };
  const normalizedTipo = normalizeStoredTipoValue(base.produto, base.tipo);
  const metrics = normalizeInventoryMetrics({
    caixasPallet: base.caixas_pallet,
    pallets: base.pallets,
    caixasAvulsas: base.caixas_avulsas,
    totalCaixas: base.total_caixas,
  });
  return {
    ...base,
    tipo: normalizedTipo,
    ...metrics,
  };
}

export function applyInventoryDeltas(
  target,
  { caixas_pallet, palletsDelta = 0, caixasAvulsasDelta = 0 },
) {
  if (!target) return;
  const metrics = normalizeInventoryMetrics({
    caixasPallet: caixas_pallet ?? target.caixas_pallet,
    // toInt, nao toNonNegativeInt: delta negativo e retirada de pallet/caixa.
    pallets: toNonNegativeInt(target.pallets, 0) + toInt(palletsDelta, 0),
    caixasAvulsas: toNonNegativeInt(target.caixas_avulsas, 0) + toInt(caixasAvulsasDelta, 0),
  });
  target.caixas_pallet = metrics.caixas_pallet;
  target.pallets = metrics.pallets;
  target.caixas_avulsas = metrics.caixas_avulsas;
  target.total_caixas = metrics.total_caixas;
}

export function formatInventoryStack(pallets, caixasAvulsas) {
  const palletsCount = toNonNegativeInt(pallets, 0);
  const looseBoxes = toNonNegativeInt(caixasAvulsas, 0);
  if (palletsCount && looseBoxes) {
    return `${palletsCount} + ${looseBoxes}cxs`;
  }
  if (palletsCount) {
    return String(palletsCount);
  }
  if (looseBoxes) {
    return `${looseBoxes}cxs`;
  }
  return "";
}

export function formatInventoryMessage(pallets, caixasAvulsas) {
  const palletsCount = toNonNegativeInt(pallets, 0);
  const looseBoxes = toNonNegativeInt(caixasAvulsas, 0);
  const palletLabel = palletsCount === 1 ? "pallet" : "pallets";
  if (palletsCount && looseBoxes) {
    return `${palletsCount} ${palletLabel} + ${looseBoxes} cxs`;
  }
  if (palletsCount) {
    return `${palletsCount} ${palletLabel}`;
  }
  if (looseBoxes) {
    return `${looseBoxes} cxs`;
  }
  return "0";
}

export function buildDbRowPayload(row, includeUserId = false, forceLooseBoxes = false) {
  const normalizedRow = hydrateInventoryRow(row);
  const payload = {
    setor: normalizedRow.setor,
    produto: normalizedRow.produto,
    marca: normalizedRow.marca,
    tipo: normalizedRow.tipo,
    caixas_pallet: normalizedRow.caixas_pallet,
    pallets: normalizedRow.pallets,
    total_caixas: normalizedRow.total_caixas,
  };

  if (forceLooseBoxes || normalizedRow.caixas_avulsas > 0) {
    payload.caixas_avulsas = normalizedRow.caixas_avulsas;
  }
  if (includeUserId && normalizedRow.user_id) {
    payload.user_id = normalizedRow.user_id;
  }

  return payload;
}

export function isLooseBoxesSchemaError(error) {
  const message = error?.message || "";
  return /caixas_avulsas/i.test(message);
}

export function aggregateRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const normalizedRow = hydrateInventoryRow(row);
    const key = `${normalizedRow.setor}|||${normalizedRow.produto}|||${normalizedRow.marca}|||${normalizedRow.tipo}`;
    const current = map.get(key);
    if (current) {
      applyInventoryDeltas(current, {
        caixas_pallet: normalizedRow.caixas_pallet,
        palletsDelta: normalizedRow.pallets,
        caixasAvulsasDelta: normalizedRow.caixas_avulsas,
      });
    } else {
      map.set(key, normalizedRow);
    }
  });
  return Array.from(map.values());
}

export function cloneInventoryRows(rows) {
  return (rows || []).map((row) => hydrateInventoryRow({ ...row }));
}

export function buildInventoryIdentityKey(row) {
  const normalizedRow = hydrateInventoryRow(row);
  return [normalizedRow.setor, normalizedRow.produto, normalizedRow.marca, normalizedRow.tipo].join(
    "|||",
  );
}

export function buildInventoryTotalsMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const normalizedRow = hydrateInventoryRow(row);
    const key = buildInventoryIdentityKey(normalizedRow);
    const currentTotal = map.get(key) || 0;
    map.set(key, currentTotal + normalizedRow.total_caixas);
  });
  return map;
}

export function getInventoryRowByIdentity(rows, { setor, produto, marca, tipo }) {
  // Normaliza o tipo buscado (produto/tipo podem vir de um lancamento antigo
  // salvo com um valor legado, ex: 601 antes de virar 14) para bater com as
  // linhas em memoria, que ja sao normalizadas por hydrateInventoryRow.
  const normalizedTipo = normalizeStoredTipoValue(produto, tipo);
  return (rows || []).find(
    (row) =>
      row?.setor === setor &&
      row?.produto === produto &&
      row?.marca === marca &&
      row?.tipo === normalizedTipo,
  );
}

export function getCurrentPublicAggregateRows() {
  const sourceRows = state.rawPublicRows?.length ? state.rawPublicRows : state.publicRows;
  return aggregateRows(cloneInventoryRows(sourceRows));
}
