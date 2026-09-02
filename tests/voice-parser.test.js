import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasBoxKeyword,
  extractCommandTokens,
  extractCommandNumbers,
  extractCommandTipoValues,
  isAddCommand,
  isRemoveCommand,
  isCorrectCommand,
  isLaunchCommand,
  isSaveCommand,
  isDiscardCommand,
  splitOversizedTipoNumbers,
  buildMaps,
  buildBrandMap,
  buildAllBrandMap,
  formatTipoCounts,
} from "../assets/js/features/voice-parser.js";

test("numero por extenso vale o mesmo que digito", () => {
  assert.deepEqual(extractCommandNumbers("dois pallets tipo quatro"), [2, 4]);
  assert.deepEqual(extractCommandNumbers("2 pallets tipo 4"), [2, 4]);
});

test("o nome do item nao entra como numero do comando", () => {
  // "BRAZIL 6" e marca; sem ignorar, o 6 da marca viraria quantidade.
  const numeros = extractCommandNumbers("amarelo brazil 6 dois pallets", ["AMARELO", "BRAZIL 6"]);
  assert.deepEqual(numeros, [2]);
});

test("tokens ignorados saem apenas na primeira ocorrencia da sequencia", () => {
  assert.deepEqual(extractCommandTokens("lula lula tres", ["LULA"]), ["LULA", "TRES"]);
});

test("tipo especial do ORANGE e lido como tipo, nao como numero", () => {
  assert.deepEqual(extractCommandTipoValues("tipo 6 a", "ORANGE"), [14]);
  assert.deepEqual(extractCommandTipoValues("tipo seis b", "ORANGE"), [15]);
  // Como numero de comando, o tipo especial e descartado de proposito.
  assert.deepEqual(extractCommandNumbers("tipo 6 a", [], "ORANGE"), []);
});

test("sem produto nao ha tipo para extrair", () => {
  assert.deepEqual(extractCommandTipoValues("tipo 4", ""), []);
});

test("intencoes do comando", () => {
  assert.equal(isAddCommand("adicionar dois pallets"), true);
  assert.equal(isAddCommand("dois pallets"), false);
  assert.equal(isRemoveCommand("desfazer"), true);
  assert.equal(isCorrectCommand("corrigir"), true);
  assert.equal(isLaunchCommand("lancar"), true);
  assert.equal(isSaveCommand("salvar"), true);
  assert.equal(isDiscardCommand("cancelar"), true);
  assert.equal(isSaveCommand("adicionar"), false);
});

test("acento e caixa nao mudam a intencao", () => {
  assert.equal(isRemoveCommand("DESFAZER"), true);
  assert.equal(isCorrectCommand("correção"), true);
  assert.equal(isLaunchCommand("lançar"), true);
});

test("caixa avulsa e reconhecida em qualquer forma", () => {
  assert.equal(hasBoxKeyword("tres caixas"), true);
  assert.equal(hasBoxKeyword("3 cxs"), true);
  assert.equal(hasBoxKeyword("tres pallets"), false);
});

test("numero grudado pelo reconhecedor volta a virar tipos validos", () => {
  // "5" + "6" saiu como "56": dois tipos de um digito.
  assert.deepEqual(splitOversizedTipoNumbers([56], "AMARELO"), [5, 6]);
  // "12" + "12": o par de dois digitos vence, porque 12 e tipo valido.
  assert.deepEqual(splitOversizedTipoNumbers([1212], "AMARELO"), [12, 12]);
});

test("tipo dentro da faixa passa intacto e digito invalido cai fora", () => {
  assert.deepEqual(splitOversizedTipoNumbers([4, 15], "AMARELO"), [4, 15]);
  // 1 e 2 estao abaixo de TIPO_MIN (3): nao viram tipo.
  assert.deepEqual(splitOversizedTipoNumbers([2], "AMARELO"), []);
  assert.deepEqual(splitOversizedTipoNumbers([21], "AMARELO"), []);
});

test("mapas do catalogo saem normalizados para o parser", () => {
  const { products, productMap } = buildMaps("CHAO");
  // Mapa normalizado: a chave e o texto sem acento e em caixa alta, o valor e
  // o nome como esta no catalogo.
  assert.equal(productMap.AMARELO, "AMARELO");
  assert.equal(buildBrandMap(products, "AMARELO").LULA, "LULA");
  assert.equal(buildAllBrandMap(products).LULA, "LULA");
});

test("setor inexistente devolve mapa vazio em vez de estourar", () => {
  const { products, productMap } = buildMaps("NAO_EXISTE");
  assert.deepEqual(products, {});
  assert.deepEqual(productMap, {});
});

test("resumo por tipo agrupa repeticao e respeita a ordem do produto", () => {
  const counts = new Map([
    [5, 1],
    [4, 3],
  ]);
  assert.equal(formatTipoCounts(counts, "AMARELO", "LULA"), "4x3, 5");
});

test("resumo por tipo usa o rotulo especial do ORANGE", () => {
  assert.equal(formatTipoCounts(new Map([[14, 2]]), "ORANGE", "SOL"), "6Ax2");
});
