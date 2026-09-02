import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInventoryMetrics,
  applyInventoryDeltas,
  aggregateRows,
  buildDbRowPayload,
  buildInventoryTotalsMap,
  getInventoryRowByIdentity,
  formatInventoryStack,
  formatInventoryMessage,
} from "../assets/js/core/inventory-core.js";

test("total_caixas = pallets * caixas_pallet + avulsas", () => {
  const m = normalizeInventoryMetrics({ caixasPallet: 66, pallets: 3, caixasAvulsas: 5 });
  assert.deepEqual(m, { caixas_pallet: 66, pallets: 3, caixas_avulsas: 5, total_caixas: 203 });
});

test("avulsas que fecham pallet viram pallet", () => {
  const m = normalizeInventoryMetrics({ caixasPallet: 66, pallets: 1, caixasAvulsas: 70 });
  assert.equal(m.pallets, 2);
  assert.equal(m.caixas_avulsas, 4);
  assert.equal(m.total_caixas, 136);
});

test("sem avulsas informadas, o total se reparte em pallets + resto", () => {
  const m = normalizeInventoryMetrics({ caixasPallet: 66, totalCaixas: 200 });
  assert.equal(m.pallets, 3);
  assert.equal(m.caixas_avulsas, 2);
  assert.equal(m.total_caixas, 200);
});

test("caixas_pallet zero: tudo e avulsa, nenhum pallet", () => {
  const m = normalizeInventoryMetrics({ caixasPallet: 0, pallets: 4, caixasAvulsas: 9 });
  assert.deepEqual(m, { caixas_pallet: 0, pallets: 0, caixas_avulsas: 9, total_caixas: 9 });
});

test("valores negativos ou lixo caem para zero", () => {
  const m = normalizeInventoryMetrics({ caixasPallet: 66, pallets: -3, caixasAvulsas: "abc" });
  assert.deepEqual(m, { caixas_pallet: 66, pallets: 0, caixas_avulsas: 0, total_caixas: 0 });
});

test("delta negativo tira caixa e o total acompanha", () => {
  const row = { caixas_pallet: 66, pallets: 2, caixas_avulsas: 10, total_caixas: 142 };
  applyInventoryDeltas(row, { palletsDelta: -1, caixasAvulsasDelta: -4 });
  assert.equal(row.pallets, 1);
  assert.equal(row.caixas_avulsas, 6);
  assert.equal(row.total_caixas, 72);
});

test("delta nao deixa o estoque negativo", () => {
  const row = { caixas_pallet: 66, pallets: 0, caixas_avulsas: 2, total_caixas: 2 };
  applyInventoryDeltas(row, { palletsDelta: -5, caixasAvulsasDelta: -10 });
  assert.equal(row.total_caixas, 0);
});

test("aggregateRows soma o mesmo item e mantem os diferentes", () => {
  const rows = aggregateRows([
    { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 1, caixas_avulsas: 0 },
    { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 2, caixas_avulsas: 3 },
    { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 5, caixas_pallet: 66, pallets: 1, caixas_avulsas: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.tipo === 4).total_caixas, 201);
  assert.equal(rows.find((r) => r.tipo === 5).total_caixas, 66);
});

test("ORANGE 601 e o mesmo item que o tipo 14", () => {
  const rows = aggregateRows([
    { setor: "CHAO", produto: "ORANGE", marca: "SOL", tipo: 601, caixas_pallet: 66, pallets: 1 },
    { setor: "CHAO", produto: "ORANGE", marca: "SOL", tipo: 14, caixas_pallet: 66, pallets: 1 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tipo, 14);
  assert.equal(rows[0].total_caixas, 132);
});

test("payload omite caixas_avulsas quando e zero e inclui quando forcado", () => {
  const row = { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 1 };
  assert.equal("caixas_avulsas" in buildDbRowPayload(row), false);
  assert.equal(buildDbRowPayload(row, false, true).caixas_avulsas, 0);
});

test("payload so leva user_id quando pedido", () => {
  const row = { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 1, user_id: "u1" };
  assert.equal("user_id" in buildDbRowPayload(row), false);
  assert.equal(buildDbRowPayload(row, true).user_id, "u1");
});

test("buildInventoryTotalsMap acumula por identidade", () => {
  const map = buildInventoryTotalsMap([
    { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 1 },
    { setor: "CHAO", produto: "AMARELO", marca: "LULA", tipo: 4, caixas_pallet: 66, pallets: 1 },
  ]);
  assert.deepEqual([...map.values()], [132]);
});

test("busca por identidade normaliza o tipo legado", () => {
  const rows = [{ setor: "CHAO", produto: "ORANGE", marca: "SOL", tipo: 14 }];
  assert.ok(getInventoryRowByIdentity(rows, { setor: "CHAO", produto: "ORANGE", marca: "SOL", tipo: 601 }));
});

test("formatacao do empilhamento", () => {
  assert.equal(formatInventoryStack(3, 5), "3 + 5cxs");
  assert.equal(formatInventoryStack(3, 0), "3");
  assert.equal(formatInventoryStack(0, 5), "5cxs");
  assert.equal(formatInventoryStack(0, 0), "");
  assert.equal(formatInventoryMessage(1, 0), "1 pallet");
  assert.equal(formatInventoryMessage(2, 3), "2 pallets + 3 cxs");
  assert.equal(formatInventoryMessage(0, 0), "0");
});
