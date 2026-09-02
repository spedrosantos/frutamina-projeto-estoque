// Contagem em andamento do modo "Estoque atual".
//
// Cada lancamento fica aqui (e no aparelho) ate o operador salvar, do mesmo jeito
// que a "Nova contagem" ja fazia com state.sessionRows. A diferenca e que aqui as
// operacoes sao *deltas* somados ao estoque que ja existe, e nao uma contagem que
// substitui tudo. A visao "Contagem" da Conferencia mostra exatamente esta fila;
// a visao "Estoque atual" mostra o que ja esta gravado no banco.
import { state, elements } from "../core/state.js";
import { pushMessage } from "../core/utils.js";
import { applyLaunchBatch, loadPublicRecords } from "./supabase-api.js";
import { PENDING_CHANGES_KEY_PREFIX } from "../core/config.js";
import { renderCountTable } from "../features/tables.js";
import { buildInventoryIdentityKey } from "../core/inventory-core.js";

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
    const count = getPendingChanges().length;
    elements.countSaveBtn.disabled = state.countMode === "new" ? false : !count;
    // Botao so de icone e desabilitado nao mostrava quantos lancamentos esperam
    // gravacao: o numero vira um badge (CSS le o data-pending).
    if (count && state.countMode !== "new") {
      elements.countSaveBtn.dataset.pending = count > 99 ? "99+" : String(count);
    } else {
      delete elements.countSaveBtn.dataset.pending;
    }
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

  const { error } = await applyLaunchBatch(ops);
  if (error) {
    pushMessage("error", `Erro ao salvar o item: ${error.message}`);
    renderPendingChanges();
    return false;
  }

  state.pendingChanges = getPendingChanges().filter((op) => !ops.includes(op));
  renderPendingChanges();
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

  // A fila inteira vai numa chamada so (aplicar_lancamentos, no Postgres). E uma
  // transacao: ou entra tudo, ou nada entra. Por isso, no erro, a fila continua
  // intacta no aparelho - nao existe mais "metade gravada" para reconciliar.
  const { error } = await applyLaunchBatch(ops);
  if (error) {
    pushMessage(
      "error",
      `Erro ao salvar a contagem: ${error.message}. O que não entrou continua neste aparelho.`
    );
    renderPendingChanges();
    return false;
  }

  clearPendingChanges();
  await loadPublicRecords();
  pushMessage("success", "Contagem salva no estoque.");
  return true;
}
