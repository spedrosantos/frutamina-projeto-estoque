// Modo de contagem: alterna "estoque atual" e "nova contagem" com rascunho offline.
import { state, elements, supabaseClient } from "./state.js";
import { TABLE_NAME, SUPABASE_TIMEOUT_MS } from "./config.js";
import { pushMessage, withTimeout, displayUserFromEmail } from "./utils.js";
import {
  cloneInventoryRows,
  getCurrentPublicAggregateRows,
  buildDbRowPayload,
  isLooseBoxesSchemaError,
  aggregateRows,
} from "./inventory-core.js";
import { requireAuthenticatedUser } from "./auth-ui.js";
import { renderContext, renderCountTable } from "./tables.js";
import {
  hasCountDraftData,
  saveCountDraftLocally,
  clearCountDraft,
} from "./draft.js";
import { buildPublicRowsAfterUserReplacement, calculateOutflowCaixas } from "./comparison.js";
import { saveSnapshotRecord, loadUserRecords, loadPublicRecords } from "./supabase-api.js";
import { clearVoiceActionState } from "./voice-actions.js";

export function updateCountModeUI() {
  if (elements.countModeSelect) {
    elements.countModeSelect.value = state.countMode === "new" ? "new" : "current";
    // Valor trocado por codigo nao dispara "change": avisa o dropdown customizado
    // para ele redesenhar o rotulo (inclusive quando a troca e cancelada).
    elements.countModeSelect.dispatchEvent(new Event("select-menu:sync"));
  }

  if (elements.newCountActions) {
    elements.newCountActions.classList.toggle(
      "hidden",
      state.countMode !== "new"
    );
  }
}

function setCountMode(mode) {
  if (!requireAuthenticatedUser("Faça login para alternar o modo de contagem.")) {
    return;
  }
  if (mode === state.countMode) return;
  state.selectedRowKey = null;
  clearVoiceActionState();
  if (mode === "new") {
    if (hasCountDraftData()) {
      state.countMode = "new";
      pushMessage("info", "Rascunho da nova contagem retomado.");
    } else {
      const confirmed = window.confirm(
        "Iniciar nova contagem? A contagem atual so sera substituida quando voce salvar."
      );
      if (!confirmed) return;
      state.countMode = "new";
      state.sessionRows = [];
      state.previousCountRows = cloneInventoryRows(state.userRows);
      state.previousPublicRows = getCurrentPublicAggregateRows();
      pushMessage(
        "info",
        "Nova contagem iniciada. O estoque anterior ficou guardado temporariamente para comparacao no final."
      );
    }
  } else {
    if (hasCountDraftData()) {
      const confirmed = window.confirm(
        "Voltar para o estoque atual? O rascunho da nova contagem ficara salvo neste aparelho para voce retomar depois."
      );
      if (!confirmed) return;
      saveCountDraftLocally();
      pushMessage("info", "Rascunho da nova contagem mantido neste aparelho.");
    }
    state.countMode = "current";
  }
  updateCountModeUI();
  renderContext();
  renderCountTable();
}

// Trava contra clique duplo/comando "salvar" repetido: sem isso, duas
// chamadas concorrentes de saveNewCount inserem a mesma contagem 2x antes de
// qualquer uma delas apagar os registros antigos, duplicando o estoque.
let isSavingCount = false;

/**
 * Finaliza a nova contagem:
 * - substitui os registros antigos do usuário;
 * - salva snapshot do dashboard;
 * - registra a comparação detalhada da última contagem.
 */
export async function saveNewCount() {
  if (!requireAuthenticatedUser("Faça login para salvar a nova contagem.")) {
    return;
  }
  if (isSavingCount) {
    pushMessage("warn", "Aguarde, a nova contagem ja esta sendo salva...");
    return;
  }
  if (!state.sessionRows.length) {
    pushMessage("warn", "Nenhum item na nova contagem para salvar.");
    return;
  }
  if (!navigator.onLine) {
    saveCountDraftLocally();
    pushMessage(
      "warn",
      "Sem internet. A nova contagem continua salva neste aparelho. Conecte-se e tente sincronizar novamente."
    );
    return;
  }
  const previousRows = state.previousCountRows.length
    ? cloneInventoryRows(state.previousCountRows)
    : cloneInventoryRows(state.userRows);
  const currentRows = cloneInventoryRows(state.sessionRows);
  const previousPublicRows = state.previousPublicRows.length
    ? cloneInventoryRows(state.previousPublicRows)
    : getCurrentPublicAggregateRows();
  const comparisonPreviousRows = previousPublicRows.length
    ? previousPublicRows
    : previousRows;
  const confirmed = window.confirm(
    "Salvar nova contagem? Isso vai apagar a contagem antiga e substituir pela nova."
  );
  if (!confirmed) return;

  isSavingCount = true;
  if (elements.saveNewCountBtn) elements.saveNewCountBtn.disabled = true;
  try {
    // Le os ids atuais de TODOS os usuarios para os setores desta contagem
    // (nao so os do usuario atual) ANTES de inserir a nova contagem, para so
    // apagar exatamente esses depois. Uma nova contagem de um setor e a
    // contagem oficial e completa daquele setor, nao importa quem contou
    // antes — senao a contagem de um operador diferente do mesmo setor fica
    // apenas somada por cima da anterior, duplicando o estoque.
    // Inserir primeiro e apagar por ultimo evita que uma sessao expirando ou
    // uma falha de rede no meio do caminho deixe o estoque do usuario
    // zerado no servidor: na pior das hipoteses sobra duplicata (recuperavel).
    const setoresContados = Array.from(
      new Set(currentRows.map((row) => row.setor).filter(Boolean))
    );
    const { data: existingRows, error: selectError } = await withTimeout(
      supabaseClient.from(TABLE_NAME).select("id").in("setor", setoresContados),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao verificar a contagem atual."
    );
    if (selectError) {
      pushMessage(
        "error",
        `Erro ao verificar contagem atual: ${selectError.message}. O rascunho offline foi mantido neste aparelho.`
      );
      saveCountDraftLocally();
      return;
    }
    const oldIds = (existingRows || []).map((row) => row.id).filter(Boolean);

    // caixas_avulsas SEMPRE no payload: no upsert, coluna ausente nao entra no
    // UPDATE, entao o valor antigo da linha sobreviveria e o trigger somaria
    // ele no total_caixas novo. Tambem evita payload com chaves diferentes
    // entre linhas, que o PostgREST preenche com NULL (coluna e NOT NULL).
    const payload = aggregateRows(currentRows).map((row) =>
      buildDbRowPayload(
        {
          ...row,
          user_id: state.user.id,
        },
        true,
        true
      )
    );

    // Upsert (nao insert) porque a unique (user_id, setor, produto, marca,
    // tipo) colide com as proprias linhas antigas do usuario, que so sao
    // apagadas depois. O upsert reaproveita o id da linha existente, entao
    // esses ids saem da lista de exclusao mais abaixo.
    const insertResult = await withTimeout(
      supabaseClient
        .from(TABLE_NAME)
        .upsert(payload, { onConflict: "user_id,setor,produto,marca,tipo" })
        .select("id"),
      SUPABASE_TIMEOUT_MS,
      "Tempo limite ao enviar a nova contagem."
    );
    const insertError = insertResult?.error;
    if (insertError) {
      const message = isLooseBoxesSchemaError(insertError)
        ? "Erro ao salvar nova contagem: rode a migracao de caixas avulsas no Supabase. O rascunho offline foi mantido neste aparelho."
        : `Erro ao salvar nova contagem: ${insertError.message}. O rascunho offline foi mantido neste aparelho.`;
      pushMessage("error", message);
      saveCountDraftLocally();
      return;
    }

    const keptIds = new Set((insertResult?.data || []).map((row) => row.id));
    const idsToDelete = oldIds.filter((id) => !keptIds.has(id));

    let duplicatesWarning = "";
    if (idsToDelete.length) {
      const deleteResult = await withTimeout(
        supabaseClient.from(TABLE_NAME).delete().in("id", idsToDelete),
        SUPABASE_TIMEOUT_MS,
        "Tempo limite ao remover a contagem antiga."
      );
      if (deleteResult?.error) {
        duplicatesWarning = ` Atencao: nao foi possivel remover os registros antigos (${deleteResult.error.message}) — pode haver itens duplicados ate a proxima sincronizacao.`;
      }
    }

    const currentPublicRows = buildPublicRowsAfterUserReplacement(
      comparisonPreviousRows,
      previousRows,
      currentRows
    );
    const outflowCaixas = calculateOutflowCaixas(
      comparisonPreviousRows,
      currentPublicRows.length ? currentPublicRows : currentRows
    );
    const snapshotSaved = await saveSnapshotRecord({
      rows: currentPublicRows.length ? currentPublicRows : currentRows,
      outflowCaixas,
      showSuccess: false,
    });

    state.sessionRows = [];
    state.previousCountRows = [];
    state.previousPublicRows = [];
    state.countMode = "current";
    clearVoiceActionState();
    clearCountDraft();
    updateCountModeUI();
    renderContext();
    await loadUserRecords();
    await loadPublicRecords();
    const successMsg = snapshotSaved
      ? "Nova contagem salva. Visao geral atualizada com total e saida."
      : "Nova contagem salva, mas o historico da visao geral nao foi atualizado.";

    pushMessage(
      duplicatesWarning ? "warn" : snapshotSaved ? "success" : "warn",
      `${successMsg}${duplicatesWarning}`
    );

    if (Notification.permission === "granted") {
      const userLabel = displayUserFromEmail(state.user.email);
      new Notification("Estoque Atualizado", {
        body: `O estoque do CD foi atualizado por ${userLabel}`,
        icon: "./assets/img/icon-192.png",
      });
    }
  } catch (error) {
    pushMessage(
      "error",
      `${error?.message || "Erro ao sincronizar a nova contagem."} O rascunho offline foi mantido neste aparelho.`
    );
    saveCountDraftLocally();
  } finally {
    isSavingCount = false;
    if (elements.saveNewCountBtn) elements.saveNewCountBtn.disabled = false;
  }
}

export function discardNewCount() {
  if (!requireAuthenticatedUser("Faça login para gerenciar a nova contagem.")) {
    return;
  }

  const confirmed = window.confirm(
    "Descartar a nova contagem? Os dados não salvos serão perdidos."
  );
  if (!confirmed) return;
  state.sessionRows = [];
  state.previousCountRows = [];
  state.previousPublicRows = [];
  state.countMode = "current";
  clearVoiceActionState();
  clearCountDraft();
  updateCountModeUI();
  renderContext();
  renderCountTable();
  pushMessage("info", "Nova contagem descartada.");
}

// Liga o seletor de modo de contagem e o auto-save do rascunho (pagehide/visibilitychange).
export function setupCountModeEvents() {
  if (elements.countModeSelect) {
    elements.countModeSelect.addEventListener("change", () => {
      setCountMode(elements.countModeSelect.value);
      // setCountMode desiste em silencio se o login faltar ou o usuario cancelar
      // o confirm, entao o seletor volta para o modo que continua valendo.
      updateCountModeUI();
    });
  }

  if (elements.saveNewCountBtn) {
    elements.saveNewCountBtn.addEventListener("click", saveNewCount);
  }

  if (elements.discardNewCountBtn) {
    elements.discardNewCountBtn.addEventListener("click", discardNewCount);
  }

  window.addEventListener("pagehide", () => {
    if (state.countMode === "new") {
      saveCountDraftLocally();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.countMode === "new") {
      saveCountDraftLocally();
    }
  });

  if (elements.countClearBtn) {
    elements.countClearBtn.addEventListener("click", async () => {
      if (state.countMode === "new") {
        const confirmClear = window.confirm(
          "Deseja limpar a nova contagem inteira? Isso vai zerar todos os setores que você já contou."
        );
        if (!confirmClear) return;
        state.sessionRows = [];
        state.selectedRowKey = null;
        clearVoiceActionState();
        saveCountDraftLocally();
        renderCountTable();
        pushMessage("success", "Nova contagem limpa em todos os setores.");
        return;
      }

      if (!state.user) return;
      const confirmClear = window.confirm(
        "Deseja iniciar uma nova contagem do zero para todos os setores?"
      );
      if (!confirmClear) return;

      const shouldSave = window.confirm(
        "Salvar o total atual no histórico antes de iniciar a nova contagem?\nOK = salvar e iniciar\nCancelar = iniciar sem salvar"
      );
      if (shouldSave) {
        const saved = await saveSnapshotRecord({
          rows: aggregateRows(
            cloneInventoryRows(state.rawPublicRows?.length ? state.rawPublicRows : state.userRows)
          ),
          outflowCaixas: 0,
          showSuccess: false,
        });
        if (!saved) {
          const proceed = window.confirm(
            "Falha ao salvar o histórico. Deseja iniciar a nova contagem mesmo assim?"
          );
          if (!proceed) return;
        }
      }
      state.previousCountRows = cloneInventoryRows(state.userRows);
      state.previousPublicRows = getCurrentPublicAggregateRows();
      state.sessionRows = [];
      state.selectedRowKey = null;
      state.countMode = "new";
      clearVoiceActionState();
      saveCountDraftLocally();
      updateCountModeUI();
      renderContext();
      renderCountTable();
      pushMessage(
        "success",
        shouldSave
          ? "Nova contagem iniciada do zero. Estoque anterior salvo e guardado temporariamente para comparação."
          : "Nova contagem iniciada do zero. Estoque anterior guardado temporariamente para comparação."
      );
    });
  }
}
