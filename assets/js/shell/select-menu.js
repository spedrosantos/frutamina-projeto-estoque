// Dropdown customizado para os selects da aba Tendencia.
// O <select> nativo continua sendo a fonte da verdade (valor + evento change),
// entao historico-produto.js nao precisa saber que existe uma UI por cima:
// o browser nao deixa estilizar a lista de <option>, por isso a lista e redesenhada
// aqui e o select fica escondido, mas vivo.
let openMenu = null;

function closeOpenMenu() {
  if (!openMenu) return;
  openMenu.root.classList.remove("open");
  openMenu.trigger.setAttribute("aria-expanded", "false");
  openMenu = null;
}

document.addEventListener("click", (event) => {
  if (openMenu && !openMenu.root.contains(event.target)) closeOpenMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openMenu) {
    openMenu.trigger.focus();
    closeOpenMenu();
  }
});

export function enhanceSelect(select) {
  if (!select || select.dataset.enhanced === "1") return;
  select.dataset.enhanced = "1";

  const root = document.createElement("div");
  root.className = "select-menu";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-menu-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = document.createElement("span");
  label.className = "select-menu-value";
  trigger.append(
    label,
    Object.assign(document.createElement("i"), { className: "bi bi-chevron-down" }),
  );
  const list = document.createElement("div");
  list.className = "select-menu-list";
  list.setAttribute("role", "listbox");
  root.append(trigger, list);
  select.parentNode.insertBefore(root, select);
  root.appendChild(select);

  const sync = () => {
    const selected = select.options[select.selectedIndex];
    label.textContent = selected ? selected.textContent : "";
    label.classList.toggle("is-placeholder", !select.value);
    trigger.disabled = select.disabled;
    list.innerHTML = "";
    Array.from(select.options).forEach((option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "select-menu-item";
      item.setAttribute("role", "option");
      item.dataset.value = option.value;
      item.textContent = option.textContent;
      // Opcao desabilitada no <select> tambem fica inerte no menu customizado.
      item.disabled = option.disabled;
      item.classList.toggle("is-disabled", option.disabled);
      const active = option.value === select.value;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      list.appendChild(item);
    });
  };

  trigger.addEventListener("click", () => {
    const wasOpen = openMenu?.root === root;
    closeOpenMenu();
    if (wasOpen) return;
    root.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { root, trigger };
    list.querySelector(".select-menu-item.active")?.scrollIntoView({ block: "nearest" });
  });

  list.addEventListener("click", (event) => {
    const item = event.target.closest(".select-menu-item");
    if (!item) return;
    closeOpenMenu();
    trigger.focus();
    if (item.dataset.value === select.value) return;
    select.value = item.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  });

  // As opcoes sao reescritas por setSelectOptionsWithPlaceholder e o campo Marca
  // liga/desliga conforme o produto escolhido: observar mantem a UI em dia.
  new MutationObserver(sync).observe(select, {
    childList: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  select.addEventListener("change", sync);
  // Quem troca o valor por codigo dispara este evento para reconciliar o rotulo.
  select.addEventListener("select-menu:sync", sync);
  sync();
}
