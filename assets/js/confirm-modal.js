// Modal de confirmacao no lugar do window.confirm nativo.
//
// O confirm do navegador ignora o tema do app, nao aceita rotulo proprio e, no
// celular, aparece com o nome do dominio em cima do texto. O modal e montado sob
// demanda (como o print-preview) para servir as quatro paginas sem precisar
// repetir markup em cada HTML.

let modal = null;
let resolveCurrent = null;

function close(result) {
  if (!modal) return;
  modal.classList.add("hidden");
  const resolve = resolveCurrent;
  resolveCurrent = null;
  if (resolve) resolve(result);
}

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "confirm-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-backdrop" data-confirm-cancel></div>
    <div class="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="modal-header">
        <h3 id="confirm-title"></h3>
      </div>
      <div class="modal-body">
        <p class="confirm-message"></p>
      </div>
      <div class="modal-actions">
        <button class="ghost" type="button" data-confirm-cancel></button>
        <button class="primary" type="button" data-confirm-ok></button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-confirm-cancel]")) close(false);
    if (event.target.closest("[data-confirm-ok]")) close(true);
  });
  document.addEventListener("keydown", (event) => {
    if (modal.classList.contains("hidden")) return;
    if (event.key === "Escape") close(false);
    if (event.key === "Enter") close(true);
  });
  document.body.appendChild(modal);
  return modal;
}

/**
 * Pergunta e devolve uma Promise<boolean>, no mesmo papel do window.confirm.
 * @param {object} options
 * @param {string} options.message  Texto da pergunta.
 * @param {string} [options.title]  Titulo do cartao.
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.danger] Pinta o botao de confirmar como destrutivo.
 */
export function confirmAction({
  message,
  title = "Confirmar",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
} = {}) {
  const element = ensureModal();
  // Uma pergunta por vez: se outra estiver aberta, ela vira "cancelar".
  if (resolveCurrent) close(false);
  element.querySelector("#confirm-title").textContent = title;
  element.querySelector(".confirm-message").textContent = message || "";
  const okBtn = element.querySelector("[data-confirm-ok]");
  okBtn.textContent = confirmLabel;
  okBtn.className = danger ? "danger" : "primary";
  element.querySelector(".modal-actions [data-confirm-cancel]").textContent = cancelLabel;
  element.classList.remove("hidden");
  okBtn.focus();
  return new Promise((resolve) => {
    resolveCurrent = resolve;
  });
}
