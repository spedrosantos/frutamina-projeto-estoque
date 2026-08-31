// Contagem em andamento do modo "Estoque atual".
//
// Cada lancamento fica aqui (e no aparelho) ate o operador salvar, do mesmo jeito
// que a "Nova contagem" ja fazia com state.sessionRows. A diferenca e que aqui as
// operacoes sao *deltas* somados ao estoque que ja existe, e nao uma contagem que
// substitui tudo. A visao "Contagem" da Conferencia mostra exatamente esta fila;
// a visao "Estoque atual" mostra o que ja esta gravado no banco.
import { state, elements } from "./state.js";
import { pushMessage } from "./utils.js";
import { upsertRecord, loadUserRecords, loadPublicRecords } from "./supabase-api.js";
import { PENDING_CHANGES_KEY_PREFIX } from "./config.js";
import { renderCountTable } from "./tables.js";
import { buildInventoryIdentityKey } from "./inventory-core.js";

// A fila fica no aparelho: fechar o app (ou ficar sem bateria) no meio de uma
// contagem nao pode custar os lancamentos que ainda nao foram gravados.
function getStorageKey(userId = state.user?.id) {
  return userId ? `${PENDING_CHANGES_KEY_PREFIX}_${userId}` : "";
}

function persistPendingChanges() {
  const key = getStorageKey();
  if (!key) return;
  try {
    const ops = getPendingChanges();
    if (!ops.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ version: 1, ops }));
  } catch (error) {
    console.warn("Nao foi possivel salvar as alteracoes pendentes no aparelho.", error);
  }
}

export function restorePendingChanges() {
  const key = getStorageKey();
  if (!key) return false;
  let ops = [];
  try {
    ops = JSON.parse(localStorage.getItem(key) || "{}")?.ops || [];
  } catch (error) {
    console.warn("Rascunho de alteracoes pendentes invalido.", error);
  }
  state.pendingChanges = Array.isArray(ops) ? ops : [];
  renderPendingChanges();
  if (state.pendingChanges.length) {
    pushMessage(
      "info",
      `${state.pendingChanges.length} lancamento(s) do estoque atual foram recuperados neste aparelho. Salve para grava-los.`
    );
  }
  return state.pendingChanges.length > 0;
}

export function getPendingChanges() {
  if (!Array.isArray(state.pendingChanges)) state.pendingChanges = [];
  return state.pendingChanges;
}

export function hasPendingChanges() {
  return getPendingChanges().length > 0;
}

// O que esta na fila aparece direto na tabela "Itens Contados" (tables.js), entao
// aqui so resta persistir e ligar/desligar o botao Salvar.
export function renderPendingChanges({ persist = true } = {}) {
  if (persist) persistPendingChanges();
  if (elements.countSaveBtn) {
    elements.countSaveBtn.disabled =
      state.countMode === "new" ? false : !getPendingChanges().length;
  }
  renderCountTable();
}

// Editar/remover um item da contagem em andamento: as ops daquele item saem da
// fila e, quando ha valor novo, entram como um unico lancamento.
export function replacePendingDelta(identityKey, entry = null) {
  state.pendingChanges = getPendingChanges().filter(
    (op) => buildInventoryIdentityKey(op) !== identityKey
  );
  if (entry) getPendingChanges().push({ kind: "delta", ...entry });
  renderPendingChanges();
}

// Salvar so um item da contagem: grava os lancamentos daquele item e tira
// apenas eles da fila; o resto continua esperando o Salvar geral.
export async function applyPendingRow(identityKey) {
  if (!state.user) {
    pushMessage("error", "Faça login para salvar as alterações.");
    return false;
  }
  const ops = getPendingChanges().filter(
    (op) => buildInventoryIdentityKey(op) === identityKey
  );
  if (!ops.length) return true;
  for (const op of ops) {
    const saved = await upsertRecord({
      setor: op.setor,
      produto: op.produto,
      marca: op.marca,
      tipo: op.tipo,
      caixas_pallet: op.caixas_pallet,
      palletsDelta: op.palletsDelta,
      caixasAvulsasDelta: op.caixasAvulsasDelta,
    });
    if (!saved) {
      renderPendingChanges();
      await loadUserRecords();
      return false;
    }
    state.pendingChanges = getPendingChanges().filter((item) => item !== op);
    renderPendingChanges();
  }
  await loadUserRecords();
  await loadPublicRecords();
  pushMessage("success", "Item salvo no estoque.");
  return true;
}

export function queuePendingDelta(entry) {
  getPendingChanges().push({ kind: "delta", ...entry });
  renderPendingChanges();
}

// Usado pelo "desfazer" por voz: so remove o que ainda nao foi gravado.
export function undoLastPending() {
  const ops = getPendingChanges();
  if (!ops.length) return false;
  ops.pop();
  renderPendingChanges();
  return true;
}

export function clearPendingChanges() {
  state.pendingChanges = [];
  renderPendingChanges();
}

// No logout a fila sai da tela, mas continua guardada no aparelho para quando o
// mesmo usuario voltar - descartar aqui apagaria contagem que ninguem mandou apagar.
export function forgetPendingChangesInMemory() {
  state.pendingChanges = [];
  renderPendingChanges({ persist: false });
}

export async function applyPendingChanges() {
  const ops = getPendingChanges();
  if (!ops.length) return true;
  if (!state.user) {
    pushMessage("error", "Faça login para salvar as alterações.");
    return false;
  }

  // Grava e tira da fila um por um: se a rede cair no meio, o que ja foi
  // gravado nao volta a ser gravado numa segunda tentativa.
  while (ops.length) {
    const op = ops[0];
    const saved = await upsertRecord({
      setor: op.setor,
      produto: op.produto,
      marca: op.marca,
      tipo: op.tipo,
      caixas_pallet: op.caixas_pallet,
      palletsDelta: op.palletsDelta,
      caixasAvulsasDelta: op.caixasAvulsasDelta,
    });
    if (!saved) {
      renderPendingChanges();
      await loadUserRecords();
      return false;
    }
    ops.shift();
    renderPendingChanges();
  }

  clearPendingChanges();
  await loadUserRecords();
  await loadPublicRecords();
  pushMessage("success", "Contagem salva no estoque.");
  return true;
}
