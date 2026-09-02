// Entry point de produtos.html (cadastro/CRUD do catalogo de produtos).
// Primeiros imports de proposito: montam o shell (sidebar/topbar) e a tela de
// login antes de state.js resolver os elementos.
import "../shell/app-shell.js";
import "../shell/modal-shell.js";
import "../shell/auth-panel.js";
import "../shell/register-sw.js";
import { applyCatalogOverridesFromCache } from "../data/catalog-overrides.js";
import { finishBoot } from "../shell/boot-common.js";
import { initSetorSelects } from "../shell/auth-ui.js";
import {
  buildFilterOptions,
  renderContext,
  renderPublicTable,
  renderCountTable,
} from "../features/tables.js";
import { initCatalogForm, setupCatalogEvents } from "../features/catalog-crud.js";

applyCatalogOverridesFromCache();
initSetorSelects();
initCatalogForm();
buildFilterOptions();
renderContext();
renderPublicTable();
renderCountTable();
setupCatalogEvents();
finishBoot();
