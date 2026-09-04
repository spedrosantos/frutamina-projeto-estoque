// Cobre as funcoes de tables.js que nao dependem de tela: soma de caixas,
// agregacao da contagem em memoria e a leitura do "ultima atualizacao".
import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDateTime,
  getTotalCaixas,
  updateLastUpdateFromRows,
  updateSessionAggregateRecord,
} from "../assets/js/features/tables.js";
import { state } from "../assets/js/core/state.js";

test("formatDateTime devolve -- para valor vazio ou invalido", () => {
  assert.equal(formatDateTime(null), "--");
  assert.equal(formatDateTime(""), "--");
  assert.equal(formatDateTime("nao e data"), "--");
});

test("formatDateTime aceita Date e string ISO", () => {
  const iso = "2026-03-04T15:30:00.000Z";
  assert.equal(formatDateTime(iso), formatDateTime(new Date(iso)));
  assert.notEqual(formatDateTime(iso), "--");
});

test("getTotalCaixas soma pallets vezes caixas mais avulsas", () => {
  const rows = [
    { caixas_pallet: 10, pallets: 3, caixas_avulsas: 4 },
    { caixas_pallet: 5, pallets: 2, caixas_avulsas: 0 },
  ];
  assert.equal(getTotalCaixas(rows), 10 * 3 + 4 + 5 * 2);
});

test("getTotalCaixas aguenta lista vazia ou ausente", () => {
  assert.equal(getTotalCaixas([]), 0);
  assert.equal(getTotalCaixas(null), 0);
  assert.equal(getTotalCaixas(undefined), 0);
});

test("updateSessionAggregateRecord cria a linha quando ela nao existe", () => {
  state.sessionRows = [];
  updateSessionAggregateRecord({
    setor: "CHAO",
    produto: "AMARELO",
    marca: "ANGEL",
    tipo: 6,
    caixas_pallet: 72,
    palletsDelta: 1,
    caixasAvulsasDelta: 3,
  });
  assert.equal(state.sessionRows.length, 1);
  assert.equal(state.sessionRows[0].pallets, 1);
  assert.equal(state.sessionRows[0].caixas_avulsas, 3);
  assert.equal(state.sessionRows[0].total_caixas, 75);
});

test("updateSessionAggregateRecord soma na linha existente em vez de duplicar", () => {
  state.sessionRows = [];
  const base = {
    setor: "CHAO",
    produto: "AMARELO",
    marca: "ANGEL",
    tipo: 6,
    caixas_pallet: 72,
  };
  updateSessionAggregateRecord({ ...base, palletsDelta: 1, caixasAvulsasDelta: 3 });
  updateSessionAggregateRecord({ ...base, palletsDelta: 2, caixasAvulsasDelta: 5 });
  assert.equal(state.sessionRows.length, 1);
  assert.equal(state.sessionRows[0].pallets, 3);
  assert.equal(state.sessionRows[0].caixas_avulsas, 8);
});

test("updateSessionAggregateRecord separa linhas por tipo", () => {
  state.sessionRows = [];
  const base = { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", caixas_pallet: 72 };
  updateSessionAggregateRecord({ ...base, tipo: 6, palletsDelta: 1 });
  updateSessionAggregateRecord({ ...base, tipo: 7, palletsDelta: 1 });
  assert.equal(state.sessionRows.length, 2);
});

test("updateLastUpdateFromRows pega a linha mais recente, nao a ultima da lista", () => {
  updateLastUpdateFromRows(
    [
      { updated_at: "2026-03-04T10:00:00.000Z", user_id: "antigo" },
      { updated_at: "2026-03-04T18:00:00.000Z", user_id: "recente" },
      { updated_at: "2026-03-04T12:00:00.000Z", user_id: "meio" },
    ],
    "public",
  );
  assert.equal(state.lastUpdatePublicBy, "recente");
  assert.equal(state.lastUpdatePublicAt.toISOString(), "2026-03-04T18:00:00.000Z");
});

test("updateLastUpdateFromRows ignora datas invalidas", () => {
  updateLastUpdateFromRows(
    [
      { updated_at: "nao e data", user_id: "lixo" },
      { updated_at: null, user_id: "vazio" },
      { updated_at: "2026-03-04T09:00:00.000Z", user_id: "valido" },
    ],
    "count",
  );
  assert.equal(state.lastUpdateCountBy, "valido");
});

test("updateLastUpdateFromRows limpa o estado quando nao ha data utilizavel", () => {
  updateLastUpdateFromRows([{ updated_at: "2026-03-04T09:00:00.000Z", user_id: "x" }], "count");
  updateLastUpdateFromRows([{ updated_at: null }], "count");
  assert.equal(state.lastUpdateCountAt, null);
  assert.equal(state.lastUpdateCountBy, null);
});
