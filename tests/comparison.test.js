import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOutflowCaixas,
  buildPublicRowsAfterUserReplacement,
} from "../assets/js/features/comparison.js";

const item = (extra) => ({
  setor: "CHAO",
  produto: "AMARELO",
  marca: "LULA",
  tipo: 4,
  caixas_pallet: 66,
  ...extra,
});

test("saida e o que diminuiu de uma contagem para a outra", () => {
  const antes = [item({ pallets: 3 })];
  const agora = [item({ pallets: 1 })];
  assert.equal(calculateOutflowCaixas(antes, agora), 132);
});

test("entrada nao conta como saida", () => {
  assert.equal(calculateOutflowCaixas([item({ pallets: 1 })], [item({ pallets: 5 })]), 0);
});

test("item que desapareceu conta inteiro como saida", () => {
  assert.equal(calculateOutflowCaixas([item({ pallets: 2 })], []), 132);
});

test("saida soma item por item, sem deixar entrada compensar", () => {
  const antes = [item({ pallets: 2 }), item({ tipo: 5, pallets: 2 })];
  const agora = [item({ pallets: 0, caixas_avulsas: 0 }), item({ tipo: 5, pallets: 4 })];
  assert.equal(calculateOutflowCaixas(antes, agora), 132);
});

test("estoque publico apos salvar troca a contagem do operador", () => {
  const publicoAntes = [item({ pallets: 5 })];
  const doOperadorAntes = [item({ pallets: 2 })];
  const doOperadorAgora = [item({ pallets: 4 })];
  const depois = buildPublicRowsAfterUserReplacement(
    publicoAntes,
    doOperadorAntes,
    doOperadorAgora,
  );
  assert.equal(depois.length, 1);
  assert.equal(depois[0].total_caixas, 7 * 66);
});

test("item zerado pelo operador sai do estoque publico", () => {
  const depois = buildPublicRowsAfterUserReplacement(
    [item({ pallets: 2 })],
    [item({ pallets: 2 })],
    [],
  );
  assert.deepEqual(depois, []);
});
