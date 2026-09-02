import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  toInt,
  toNonNegativeInt,
  formatNumber,
  formatPercent,
  normalizeText,
  tokenizeText,
  buildNormalizedMap,
  findExactMatch,
  matchSpecialTipoAtTokens,
  toAuthEmail,
  displayUserFromEmail,
  isNoTipoProduct,
  isNoTipoContext,
  normalizeStoredTipoValue,
  getTipoRuleValue,
  getTipoSortOrder,
  getTipoExampleHint,
  buildTipoOptionList,
  hasSpecialTipoVariants,
  isTipoValidForContext,
  formatTipoLabelValue,
  parseTipoInputValue,
  listProductsBySetor,
  listBrands,
  normalizeKey,
  getRowKey,
} from "../assets/js/core/utils.js";

test("toInt e toNonNegativeInt caem no fallback quando o valor nao serve", () => {
  assert.equal(toInt("12", 0), 12);
  assert.equal(toInt("abc", 7), 7);
  assert.equal(toInt(-5, 0), -5);
  assert.equal(toNonNegativeInt(-5, 0), 0);
  assert.equal(toNonNegativeInt("", 3), 3);
});

test("normalizeText tira acento, pontuacao e caixa", () => {
  assert.equal(normalizeText("Pimentão, verde!"), "PIMENTAO VERDE");
  assert.equal(normalizeText("  dois   pallets "), "DOIS PALLETS");
  assert.equal(normalizeText(null), "");
});

test("normalizeText separa letra de numero", () => {
  // Sem isso "6A" viria como um token unico e o parser de tipo nao acharia.
  assert.equal(normalizeText("6A"), "6 A");
  assert.equal(normalizeText("brazil6"), "BRAZIL 6");
});

test("normalizeText corrige o que o reconhecedor de voz erra", () => {
  assert.equal(normalizeText("brasil"), "BRAZIL");
  assert.equal(normalizeText("oranage"), "ORANGE");
  assert.equal(normalizeText("cep"), "CEPI");
  assert.equal(normalizeText("magaly"), "MAGALI");
  // Familia do COSA: rosa/costa/coza/kosa/koza caem no mesmo nome.
  assert.deepEqual(["rosa", "costa", "coza", "kosa", "koza"].map(normalizeText), [
    "COSA",
    "COSA",
    "COSA",
    "COSA",
    "COSA",
  ]);
  assert.equal(normalizeText("dois quilos"), "DOIS KG");
});

test("tokenizeText devolve lista vazia para texto vazio", () => {
  assert.deepEqual(tokenizeText("tres caixas"), ["TRES", "CAIXAS"]);
  assert.deepEqual(tokenizeText("   "), []);
});

test("mapa normalizado guarda o nome original sob a chave normalizada", () => {
  const map = buildNormalizedMap(["Pimentão", "Brazil Rede", ""]);
  assert.equal(map.PIMENTAO, "Pimentão");
  assert.equal(map["BRAZIL REDE"], "Brazil Rede");
  assert.equal(Object.keys(map).length, 2);
});

test("findExactMatch acha a sequencia mais longa do mapa nos tokens", () => {
  const map = buildNormalizedMap(["BRAZIL", "BRAZIL REDE"]);
  const achado = findExactMatch(["AMARELO", "BRAZIL", "REDE", "DOIS"], map);
  assert.equal(achado, "BRAZIL REDE");
});

test("matchSpecialTipoAtTokens reconhece 6A do ORANGE em digito e por extenso", () => {
  assert.equal(matchSpecialTipoAtTokens("ORANGE", ["6", "A"], 0).value, 14);
  assert.equal(matchSpecialTipoAtTokens("ORANGE", ["SEIS", "B"], 0).value, 15);
  assert.equal(matchSpecialTipoAtTokens("AMARELO", ["6", "A"], 0), null);
});

test("login por matricula ou nome vira e-mail interno", () => {
  assert.equal(toAuthEmail("1234"), "1234@cd.local");
  assert.equal(toAuthEmail(" João "), "joao@cd.local");
  assert.equal(toAuthEmail("alguem@empresa.com"), "alguem@empresa.com");
  assert.equal(toAuthEmail(""), "");
  assert.equal(displayUserFromEmail("joao@cd.local"), "joao");
  assert.equal(displayUserFromEmail(""), "--");
});

test("PIMENTAO nao tem tipo", () => {
  assert.equal(isNoTipoProduct("PIMENTÃO"), true);
  assert.equal(isNoTipoProduct("AMARELO"), false);
  assert.equal(isNoTipoContext("PIMENTAO", "QUALQUER"), true);
  assert.equal(formatTipoLabelValue("PIMENTAO", 4, "QUALQUER"), "S/T");
});

test("tipo legado do ORANGE vira o valor atual", () => {
  assert.equal(normalizeStoredTipoValue("ORANGE", 601), 14);
  assert.equal(normalizeStoredTipoValue("ORANGE", 602), 15);
  assert.equal(normalizeStoredTipoValue("AMARELO", "4"), 4);
  assert.equal(normalizeStoredTipoValue("AMARELO", "S/T"), "S/T");
});

test("6A e 6B usam a regra de caixas do tipo 6", () => {
  assert.equal(getTipoRuleValue("ORANGE", 14), 6);
  assert.equal(getTipoRuleValue("ORANGE", 15), 6);
  assert.equal(getTipoRuleValue("AMARELO", 5), 5);
});

test("6A e 6B ordenam entre o 6 e o 7", () => {
  const seis = getTipoSortOrder("ORANGE", 14);
  const seisB = getTipoSortOrder("ORANGE", 15);
  assert.ok(getTipoSortOrder("ORANGE", 5) < seis);
  assert.ok(seis < seisB);
  assert.ok(seisB < getTipoSortOrder("ORANGE", 7));
});

test("lista de tipos troca o 6 do ORANGE por 6A e 6B", () => {
  const orange = buildTipoOptionList("ORANGE").map((o) => o.label);
  assert.ok(orange.includes("6A"));
  assert.ok(orange.includes("6B"));
  assert.equal(orange.includes("6"), false);

  const amarelo = buildTipoOptionList("AMARELO").map((o) => o.label);
  assert.equal(amarelo[0], "3");
  assert.equal(amarelo.at(-1), "15");
  assert.equal(amarelo.length, 13);
});

test("validacao de tipo respeita faixa e variante especial", () => {
  assert.equal(isTipoValidForContext("AMARELO", 3), true);
  assert.equal(isTipoValidForContext("AMARELO", 15), true);
  assert.equal(isTipoValidForContext("AMARELO", 2), false);
  assert.equal(isTipoValidForContext("AMARELO", 16), false);
  assert.equal(isTipoValidForContext("AMARELO", "abc"), false);
  // No ORANGE o 6 puro nao vale: tem que ser 6A ou 6B.
  assert.equal(isTipoValidForContext("ORANGE", 6), false);
  assert.equal(isTipoValidForContext("ORANGE", 14), true);
  assert.equal(hasSpecialTipoVariants("ORANGE"), true);
  assert.equal(getTipoExampleHint("ORANGE"), "5, 6A ou 6B");
  assert.equal(getTipoExampleHint("AMARELO"), "4");
});

test("tipo digitado a mao aceita 6a e rejeita negativo", () => {
  assert.equal(parseTipoInputValue("6a", "ORANGE"), 14);
  assert.equal(parseTipoInputValue("6 B", "ORANGE"), 15);
  assert.equal(parseTipoInputValue("4", "AMARELO"), 4);
  // Fica negativo de proposito, para a validacao recusar em vez de virar 5.
  assert.equal(parseTipoInputValue("-5", "AMARELO"), -5);
  assert.equal(parseTipoInputValue("", "AMARELO"), null);
  assert.equal(parseTipoInputValue("xyz", "AMARELO"), null);
});

test("catalogo por setor sai em lista", () => {
  const produtos = listProductsBySetor("CHAO");
  assert.ok(produtos.includes("AMARELO"));
  assert.deepEqual(listProductsBySetor("NAO_EXISTE"), []);
  assert.ok(listBrands("CHAO", "AMARELO").includes("LULA"));
});

test("getRowKey usa o id do banco e cai para o id local do rascunho", () => {
  assert.equal(getRowKey({ id: 10, _localId: "tmp-1" }), 10);
  assert.equal(getRowKey({ _localId: "tmp-1" }), "tmp-1");
  // Linha ainda sem id nenhum (agregado em memoria) nao tem chave.
  assert.equal(getRowKey({ setor: "CHAO", produto: "AMARELO" }), null);
  assert.equal(getRowKey(null), null);
});

test("formatacao de numero e porcentagem", () => {
  assert.equal(formatNumber(1234).includes("1"), true);
  assert.equal(normalizeKey("Brazil Rede"), "BRAZILREDE");
  assert.equal(typeof formatPercent(0.5), "string");
});
