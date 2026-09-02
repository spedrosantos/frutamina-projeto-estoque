// Comparacao de saida entre a contagem anterior e a atual.
// Usado para calcular o outflow_caixas mostrado no historico da Visao Geral.
import { toNonNegativeInt } from "../core/utils.js";
import {
  aggregateRows,
  hydrateInventoryRow,
  buildInventoryIdentityKey,
  buildInventoryTotalsMap,
} from "../core/inventory-core.js";

export function calculateOutflowCaixas(previousRows, currentRows) {
  const previousMap = buildInventoryTotalsMap(previousRows);
  const currentMap = buildInventoryTotalsMap(currentRows);
  let total = 0;
  previousMap.forEach((previousTotal, key) => {
    const currentTotal = currentMap.get(key) || 0;
    total += Math.max(0, previousTotal - currentTotal);
  });
  return total;
}

/**
 * Reconéri o estoque público "após salvar" sem depender de uma nova leitura do servidor.
 * Isso evita perder a comparação caso o usuário troque de página logo depois de salvar.
 */
export function buildPublicRowsAfterUserReplacement(
  previousPublicRows,
  previousUserRows,
  currentUserRows
) {
  const totalsMap = new Map();

  const applyRows = (rows, direction = 1) => {
    aggregateRows(rows).forEach((row) => {
      const normalizedRow = hydrateInventoryRow(row);
      const key = buildInventoryIdentityKey(normalizedRow);
      const current = totalsMap.get(key);
      const currentTotal = current ? toNonNegativeInt(current.total_caixas, 0) : 0;
      const nextTotal = Math.max(
        0,
        currentTotal + direction * toNonNegativeInt(normalizedRow.total_caixas, 0)
      );

      if (!nextTotal) {
        totalsMap.delete(key);
        return;
      }

      totalsMap.set(key, {
        ...(current || {}),
        setor: normalizedRow.setor,
        produto: normalizedRow.produto,
        marca: normalizedRow.marca,
        tipo: normalizedRow.tipo,
        caixas_pallet:
          normalizedRow.caixas_pallet || current?.caixas_pallet || 0,
        total_caixas: nextTotal,
      });
    });
  };

  applyRows(previousPublicRows, 1);
  applyRows(previousUserRows, -1);
  applyRows(currentUserRows, 1);

  return Array.from(totalsMap.values()).map((row) => hydrateInventoryRow(row));
}

