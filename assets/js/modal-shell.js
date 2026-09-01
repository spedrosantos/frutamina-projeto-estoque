// Casca dos modais (backdrop + cartao + cabecalho), uma vez para todo o app.
//
// Os quatro modais escreviam as mesmas dez linhas de moldura e so mudavam icone,
// titulo e o prefixo dos ids de fechar. Agora o HTML traz apenas o conteudo
// (.modal-body, .modal-actions, extras) dentro de um <div data-modal ...> e a
// moldura nasce aqui.
//
// Roda como efeito de import e precisa vir ANTES de state.js: e ele que resolve
// #<prefixo>-close, #<prefixo>-close-btn e o id do titulo.
//
// Atributos aceitos:
//   data-modal            marca o elemento
//   data-modal-icon       classe do bootstrap-icons do cabecalho
//   data-modal-title      texto do titulo
//   data-modal-title-id   id no titulo, quando o JS troca o texto
//   data-modal-close      prefixo dos ids de fechar (#<prefixo>-close no backdrop)
//   data-modal-x          presente = tem botao X (#<prefixo>-close-btn)
function mountModal(modal) {
  const { modalIcon, modalTitle, modalTitleId, modalClose } = modal.dataset;
  const title = modalTitleId ? `<span id="${modalTitleId}">${modalTitle}</span>` : modalTitle;
  const closeBtn = "modalX" in modal.dataset
    ? `
            <button id="${modalClose}-close-btn" class="ghost modal-close" type="button" title="Fechar" aria-label="Fechar">
              <i class="bi bi-x-lg"></i>
            </button>`
    : "";

  const card = document.createElement("div");
  card.className = "modal-card";
  card.innerHTML = `
          <div class="modal-header">
            <h3><i class="bi ${modalIcon}"></i>${title}</h3>${closeBtn}
          </div>`;
  card.append(...modal.childNodes);

  if (modalClose) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = `${modalClose}-close`;
    modal.append(backdrop);
  }
  modal.append(card);
}

document.querySelectorAll("[data-modal]").forEach(mountModal);
