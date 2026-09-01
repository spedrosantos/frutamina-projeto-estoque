// Entry point de index.html (estoque publico, somente leitura).
// Primeiro import de proposito: monta o shell (sidebar/topbar) antes de state.js
// resolver os elementos.
import "./app-shell.js";
import "./modal-shell.js";
import "./register-sw.js";
import { state } from "./state.js";
import { applyCatalogOverridesFromCache } from "./catalog-overrides.js";
import { finishBoot } from "./boot-common.js";
import {
  buildFilterOptions,
  renderPublicTable,
  setPublicViewMode,
  setupPublicTableEvents,
} from "./tables.js";
import { loadPublicRecords } from "./supabase-api.js";

applyCatalogOverridesFromCache();
buildFilterOptions();
renderPublicTable();
setPublicViewMode(state.publicViewMode);
setupPublicTableEvents({ loadPublicRecords });
finishBoot();
