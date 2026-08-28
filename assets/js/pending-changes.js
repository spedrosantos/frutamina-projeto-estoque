// Fila de alteracoes do modo "Estoque atual".
//
// Antes cada lancamento ia direto para o Supabase, item por item. Agora ele fica
// aqui ate o operador salvar, do mesmo jeito que a "Nova contagem" ja fazia com
// state.sessionRows. A diferenca e que aqui as operacoes sao *deltas* sobre o
// estoque que ja existe, e nao uma contagem que substitui tudo.
import { state, elements, supabaseClient } from "./state.js";
import { pushMessage, formatTipoLabelValue } from "./utils.js";
import { upsertRecord, loadUserRecords, loadPublicRecords } from "./supabase-api.js";
import { TABLE_NAME } from "./config.js";

export function getPendingChanges() {
  if (!Array.isArray(state.pendingChanges)) state.pendingChanges = [];
  return state.pendingChanges;
}

export function hasPendingChanges() {
  return getPendingChanges().length > 0;
}

function describePending(op) {
  const tipoLabel = formatTipoLabelValue(op.produto, op.tipo, op.marca);
  const nome = [op.produto, op.marca].filter(Boolean).join(" ");
  if (op.kind === "delete") return `Remover ${nome}`;
  if (op.kind === "set") return `Editar ${nome}`;
  const partes = [];
  if (op.palletsDelta) partes.push(`${op.palletsDelta > 0 ? "+" : ""}${op.palletsDelta} pallet(s)`);
  if (op.caixasAvulsasDelta) {
    partes.push(`${op.caixasAvulsasDelta > 0 ? "+" : ""}${op.caixasAvulsasDelta} caixa(s)`);
  }
  const detalhe = partes.join(" e ") || "sem alteracao";
  return `${nome}${tipoLabel && tipoLabel !== "--" ? ` Tipo ${tipoLabel}` : ""}: ${detalhe}`;
}

export function renderPendingChanges() {
  const list = elements.pendingList;
  const card = elements.pendingCard;
  const counter = elements.pendingCount;
  const ops = getPendingChanges();

  if (counter) counter.textContent = String(ops.length);
  if (card) card.classList.toggle("hidden", ops.length === 0);
  if (elements.countSaveBtn) {
    elements.countSaveBtn.disabled = state.countMode === "new" ? false : ops.length === 0;
  }
  if (!list) return;

  list.innerHTML = "";
  ops.forEach((op, index) => {
    const item = document.createElement("div");
    item.className = "pending-item";
    const text = document.createElement("span");
    text.textContent = describePending(op);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost icon-btn";
    remove.title = "Descartar esta alteracao";
    remove.setAttribute("aria-label", "Descartar esta alteracao");
    remove.innerHTML = '<i class="bi bi-x-lg"></i>';
    remove.addEventListener("click", () => {
      ops.splice(index, 1);
      renderPendingChanges();
    });
    item.append(text, remove);
    list.appendChild(item);
  });
}

export function queuePendingDelta(entry) {
  getPendingChanges().push({ kind: "delta", ...entry });
  renderPendingChanges();
}

export function queuePendingSet(rowKey, payload, info) {
  getPendingChanges().push({ kind: "set", rowKey, payload, ...info });
  renderPendingChanges();
}

export function queuePendingDelete(rowKey, row) {
  getPendingChanges().push({
    kind: "delete",
    rowKey,
    produto: row?.produto,
    marca: row?.marca,
    tipo: row?.tipo,
  });
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

export async function applyPendingChanges() {
  const ops = getPendingChanges();
  if (!ops.length) return true;
  if (!state.user) {
    pushMessage("error", "Faça login para salvar as alterações.");
    return false;
  }

  // Em ordem: uma edicao depois de um lancamento no mesmo item precisa vencer.
  for (const op of ops) {
    if (op.kind === "delta") {
      const saved = await upsertRecord({
        setor: op.setor,
        produto: op.produto,
        marca: op.marca,
        tipo: op.tipo,
        caixas_pallet: op.caixas_pallet,
        palletsDelta: op.palletsDelta,
        caixasAvulsasDelta: op.caixasAvulsasDelta,
      });
      if (!saved) return false;
    } else if (op.kind === "set") {
      const { error } = await supabaseClient
        .from(TABLE_NAME)
        .update(op.payload)
        .eq("id", op.rowKey)
        .eq("user_id", state.user.id);
      if (error) {
        pushMessage("error", `Erro ao salvar alteração: ${error.message}`);
        return false;
      }
    } else if (op.kind === "delete") {
      const { error } = await supabaseClient
        .from(TABLE_NAME)
        .delete()
        .eq("id", op.rowKey)
        .eq("user_id", state.user.id);
      if (error) {
        pushMessage("error", `Erro ao remover item: ${error.message}`);
        return false;
      }
    }
  }

  clearPendingChanges();
  await loadUserRecords();
  await loadPublicRecords();
  pushMessage("success", "Alterações salvas no estoque.");
  return true;
}
