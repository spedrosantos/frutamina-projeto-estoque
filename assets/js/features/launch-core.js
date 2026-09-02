// Nucleo da gravacao de um lancamento de estoque.
//
// Estava dentro de voice-actions.js, junto com o parser de voz - 1451 linhas que
// editar.html carregava no boot inteiras, mesmo para o operador que so usa o
// Comando Manual (o caminho mais usado). Aqui ficam so as pecas que o formulario
// manual e a nova contagem precisam; o parser de voz virou carga sob demanda.
import { state } from "../core/state.js";
import { toNonNegativeInt, pushMessage } from "../core/utils.js";
import {
  hydrateInventoryRow,
  getInventoryRowByIdentity,
  formatInventoryMessage,
} from "../core/inventory-core.js";
import { requireAuthenticatedUser } from "../shell/auth-ui.js";
import { renderCountTable, updateSessionAggregateRecord } from "./tables.js";
import { queuePendingDelta } from "../data/pending-changes.js";

function buildLaunchItem({
  setor,
  produto,
  marca,
  tipo,
  caixasPallet,
  palletsDelta = 0,
  caixasAvulsasDelta = 0,
}) {
  const normalizedCaixasPallet = toNonNegativeInt(caixasPallet, 0);
  const normalizedPalletsDelta = toNonNegativeInt(palletsDelta, 0);
  const normalizedCaixasAvulsasDelta = toNonNegativeInt(caixasAvulsasDelta, 0);

  return {
    setor,
    produto,
    marca,
    tipo,
    caixas_pallet: normalizedCaixasPallet,
    palletsDelta: normalizedPalletsDelta,
    caixasAvulsasDelta: normalizedCaixasAvulsasDelta,
    totalCaixasDelta:
      normalizedPalletsDelta * normalizedCaixasPallet +
      normalizedCaixasAvulsasDelta,
  };
}

export function buildLaunchRecord({
  items,
  correctionMode = null,
  actionKind = "pallets",
  label = "",
}) {
  const normalizedItems = (items || [])
    .map((item) => buildLaunchItem(item))
    .filter((item) => item.totalCaixasDelta > 0);

  if (!normalizedItems.length) return null;

  return {
    id: `launch_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    mode: state.countMode,
    items: normalizedItems,
    correctionMode,
    actionKind,
    label,
    createdAt: new Date().toISOString(),
  };
}

export function clearVoiceActionState() {
  state.lastLaunch = null;
  state.pendingCorrection = null;
}

export function setLastLaunch(record) {
  state.lastLaunch = record ? JSON.parse(JSON.stringify(record)) : null;
  state.pendingCorrection = null;
}

function buildInventoryPreview({
  currentRow,
  caixasPallet,
  palletsDelta = 0,
  caixasAvulsasDelta = 0,
}) {
  const before = hydrateInventoryRow(
    currentRow || {
      caixas_pallet: caixasPallet,
      pallets: 0,
      caixas_avulsas: 0,
      total_caixas: 0,
    },
    {
      caixas_pallet: caixasPallet,
    }
  );
  const after = hydrateInventoryRow(before, {
    caixas_pallet: caixasPallet,
    pallets: before.pallets + toNonNegativeInt(palletsDelta, 0),
    caixas_avulsas: before.caixas_avulsas + toNonNegativeInt(caixasAvulsasDelta, 0),
  });

  return { before, after };
}

function buildInventoryResultMessage({
  successPrefix,
  successSubject,
  palletsDelta = 0,
  caixasAvulsasDelta = 0,
  before,
  after,
  isNewCount = false,
}) {
  const base = `${successPrefix}${isNewCount ? " (nova contagem)" : ""}: ${successSubject} ${formatInventoryMessage(
    palletsDelta,
    caixasAvulsasDelta
  )}`.trim();
  const parts = [base];

  if (after) {
    parts.push(`Total do item: ${formatInventoryMessage(after.pallets, after.caixas_avulsas)}.`);
  }

  const convertedPallets =
    toNonNegativeInt(after?.pallets, 0) -
    toNonNegativeInt(before?.pallets, 0) -
    toNonNegativeInt(palletsDelta, 0);

  if (convertedPallets > 0) {
    const convertedLabel = convertedPallets === 1 ? "pallet" : "pallets";
    parts.push(
      `${convertedPallets} ${convertedLabel} vieram das caixas avulsas acumuladas.`
    );
  }

  return parts.join(" ");
}

export async function registerInventoryChange({
  setor,
  produto,
  marca,
  tipo,
  caixasPallet,
  palletsDelta = 0,
  caixasAvulsasDelta = 0,
  successPrefix = "Registrado",
  successSubject = "",
  actionKind = "pallets",
  correctionMode = null,
}) {
  if (!requireAuthenticatedUser("Faça login para registrar itens.")) {
    return null;
  }

  const sourceRows =
    state.countMode === "new" ? state.sessionRows : state.userRows;
  const currentRow = getInventoryRowByIdentity(sourceRows, {
    setor,
    produto,
    marca,
    tipo,
  });
  const { before, after } = buildInventoryPreview({
    currentRow,
    caixasPallet,
    palletsDelta,
    caixasAvulsasDelta,
  });
  const successMessage = buildInventoryResultMessage({
    successPrefix,
    successSubject,
    palletsDelta,
    caixasAvulsasDelta,
    before,
    after,
    isNewCount: state.countMode === "new",
  });

  if (state.countMode === "new") {
    updateSessionAggregateRecord({
      setor,
      produto,
      marca,
      tipo,
      caixas_pallet: caixasPallet,
      palletsDelta,
      caixasAvulsasDelta,
    });
    renderCountTable();
    pushMessage("success", successMessage);
    const launchRecord = buildLaunchRecord({
      items: [
        {
          setor,
          produto,
          marca,
          tipo,
          caixasPallet,
          palletsDelta,
          caixasAvulsasDelta,
        },
      ],
      correctionMode,
      actionKind,
      label: successSubject,
    });
    if (launchRecord) {
      setLastLaunch(launchRecord);
    }
    return launchRecord;
  }

  // No modo "Estoque atual" o lancamento entra na fila de pendencias: o estoque
  // so muda quando o operador salva, para nao gravar de picado item por item.
  queuePendingDelta({
    setor,
    produto,
    marca,
    tipo,
    caixas_pallet: caixasPallet,
    palletsDelta,
    caixasAvulsasDelta,
  });
  pushMessage("success", successMessage);

  {
    const launchRecord = buildLaunchRecord({
      items: [
        {
          setor,
          produto,
          marca,
          tipo,
          caixasPallet,
          palletsDelta,
          caixasAvulsasDelta,
        },
      ],
      correctionMode,
      actionKind,
      label: successSubject,
    });
    if (launchRecord) {
      setLastLaunch(launchRecord);
    }
    return launchRecord;
  }
}
