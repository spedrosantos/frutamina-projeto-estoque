// Entry point de produtos.html (cadastro/CRUD do catalogo de produtos).
// Primeiros imports de proposito: montam o shell (sidebar/topbar) e a tela de
// login antes de state.js resolver os elementos.
import "./app-shell.js";
import "./auth-panel.js";
import "./register-sw.js";
import { applyCatalogOverridesFromCache } from "./catalog-overrides.js";
import { finishBoot } from "./boot-common.js";
import { initSetorSelects } from "./auth-ui.js";
import { buildFilterOptions, renderContext, renderPublicTable, renderCountTable } from "./tables.js";
import { initCatalogForm, setupCatalogEvents } from "./catalog-crud.js";

applyCatalogOverridesFromCache();
initSetorSelects();
initCatalogForm();
buildFilterOptions();
renderContext();
renderPublicTable();
renderCountTable();
setupCatalogEvents();
finishBoot();
