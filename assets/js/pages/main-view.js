// Entry point de index.html (estoque publico, somente leitura).
// Primeiro import de proposito: monta o shell (sidebar/topbar) antes de state.js
// resolver os elementos.
import "../shell/app-shell.js";
import "../shell/modal-shell.js";
import "../shell/register-sw.js";
import { state } from "../core/state.js";
import { applyCatalogOverridesFromCache } from "../data/catalog-overrides.js";
import { finishBoot } from "../shell/boot-common.js";
import {
  buildFilterOptions,
  renderPublicTable,
  setPublicViewMode,
  setupPublicTableEvents,
} from "../features/tables.js";
import { loadPublicRecords } from "../data/supabase-api.js";

applyCatalogOverridesFromCache();
buildFilterOptions();
renderPublicTable();
setPublicViewMode(state.publicViewMode);
setupPublicTableEvents({ loadPublicRecords });
finishBoot();
