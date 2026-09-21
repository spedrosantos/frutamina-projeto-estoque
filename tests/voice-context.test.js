// A cascata de contexto do comando de voz: quem muda zera o que vem abaixo.
// Errar aqui nao da erro na tela - grava a contagem na linha errada.
import "./dom-stub.js";
import test from "node:test";
import assert from "node:assert/strict";
import { resolveVoiceContext } from "../assets/js/features/voice-parser.js";
import { tokenizeText } from "../assets/js/core/utils.js";

function resolver(frase, contexto = {}) {
  return resolveVoiceContext(tokenizeText(frase), contexto);
}

test("frase sem nada conhecido nao mexe no contexto", () => {
  const antes = { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 };
  const depois = resolver("bom dia pessoal", antes);
  assert.equal(depois.setor, "CHAO");
  assert.equal(depois.produto, "AMARELO");
  assert.equal(depois.marca, "ANGEL");
  assert.equal(depois.tipo, 6);
  assert.deepEqual(depois.mensagens, []);
});

test("setor novo zera produto, marca e tipo", () => {
  const depois = resolver("itaueira", {
    setor: "CHAO",
    produto: "AMARELO",
    marca: "ANGEL",
    tipo: 6,
  });
  assert.equal(depois.setor, "ITAUEIRA");
  assert.equal(depois.produto, null);
  assert.equal(depois.marca, null);
  assert.equal(depois.tipo, null);
});

test("repetir o setor atual nao zera o resto", () => {
  const depois = resolver("chao", { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
  assert.equal(depois.produto, "AMARELO");
  assert.equal(depois.marca, "ANGEL");
  assert.equal(depois.tipo, 6);
});

test("produto novo zera marca e tipo mas mantem o setor", () => {
  const depois = resolver("sapo", { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
  assert.equal(depois.setor, "CHAO");
  assert.equal(depois.produto, "SAPO");
  assert.equal(depois.marca, null);
  assert.equal(depois.tipo, null);
});

test("marca nova zera so o tipo", () => {
  const depois = resolver("lula", { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
  assert.equal(depois.produto, "AMARELO");
  assert.equal(depois.marca, "LULA");
  assert.equal(depois.tipo, null);
});

test("repetir a marca atual preserva o tipo", () => {
  const depois = resolver("angel", { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
  assert.equal(depois.marca, "ANGEL");
  assert.equal(depois.tipo, 6);
});

test("setor, produto e marca na mesma frase resolvem em cascata", () => {
  const depois = resolver("chao amarelo angel", {});
  assert.equal(depois.setor, "CHAO");
  assert.equal(depois.produto, "AMARELO");
  assert.equal(depois.marca, "ANGEL");
});

test("marca sem produto vira aviso, nao contexto", () => {
  const depois = resolver("angel", { setor: "CHAO" });
  assert.equal(depois.marca, null);
  assert.deepEqual(depois.mensagens, [{ level: "warn", text: "Diga o produto antes da marca." }]);
});

test("marca de outro produto nao entra no produto atual", () => {
  // LULA existe em SAPO, nao em AMARELO.
  const depois = resolver("lula", { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
  assert.equal(depois.marca, "LULA");

  const outro = resolver("angela", { setor: "CHAO", produto: "SAPO", marca: "LOLA", tipo: 6 });
  assert.equal(outro.marca, "LOLA", "ANGELA nao e marca de SAPO");
  assert.equal(outro.tipo, 6);
});

test("marca em Kg pede o tipo na mensagem", () => {
  const depois = resolver("rei 14kg", { setor: "ITAUEIRA", produto: "AMARELO" });
  assert.equal(depois.marca, "REI 14Kg");
  assert.equal(depois.mensagens.at(-1).text, "Marca fixada: REI 14Kg. Agora diga o tipo.");
});

test("produto sem tipo nao pede tipo mesmo com Kg na marca", () => {
  const depois = resolver("cepi 14kg", { setor: "ITAUEIRA", produto: "PIMENTAO" });
  // PIMENTAO nao tem essa marca: contexto intacto, nenhuma mensagem de marca.
  assert.equal(depois.marca, null);
});

test("nao muta o contexto recebido", () => {
  const antes = { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 };
  resolver("itaueira", antes);
  assert.deepEqual(antes, { setor: "CHAO", produto: "AMARELO", marca: "ANGEL", tipo: 6 });
});
