/*
  Guarda de deploy: se um arquivo do APP_SHELL mudou, a versao do cache do
  service worker TEM que mudar junto.

  Sem isso o aparelho continua pintando o codigo velho que ja tem em cache (o
  fetch e stale-while-revalidate).

  Quem rodou "git config core.hooksPath .githooks" ja tem o bump automatico no
  pre-commit e nunca vai ver esta checagem falhar. Ela existe para o clone que
  nao ligou o hook: e opt-in por copia do repo, entao nao da para contar com ele.

  Uso: node scripts/verificar-versao-cache.mjs <sha-base>
  Sem sha base (ou com base desconhecida) a checagem e pulada.
*/

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SW = "service-worker.js";
const base = process.argv[2];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

if (!base || /^0+$/.test(base)) {
  console.log("Sem commit base para comparar; checagem pulada.");
  process.exit(0);
}

try {
  git("cat-file", "-e", `${base}^{commit}`);
} catch {
  console.log(`Commit base ${base} nao esta no clone; checagem pulada.`);
  process.exit(0);
}

// Os caminhos locais do APP_SHELL, lidos do proprio service worker para a lista
// nunca sair de sincronia com o codigo.
const sw = readFileSync(SW, "utf8");
const appShellBlock = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!appShellBlock) {
  console.error(`Nao achei o APP_SHELL em ${SW}.`);
  process.exit(1);
}

const versionados = new Set(
  [...appShellBlock[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]).filter(Boolean),
);
versionados.add(SW);

const alterados = git("diff", "--name-only", base, "HEAD")
  .split("\n")
  .map((linha) => linha.trim())
  .filter(Boolean);

const shellAlterado = alterados.filter((arquivo) => versionados.has(arquivo) && arquivo !== SW);
if (!shellAlterado.length) {
  console.log("Nenhum arquivo do APP_SHELL mudou; nada a verificar.");
  process.exit(0);
}

const diffSw = git("diff", "-U0", base, "HEAD", "--", SW);
const versaoMudou = /^\+const (STATIC|RUNTIME)_CACHE = /m.test(diffSw);

if (!versaoMudou) {
  console.error("Arquivos do APP_SHELL mudaram, mas a versao do cache continua a mesma:");
  shellAlterado.forEach((arquivo) => console.error(`  - ${arquivo}`));
  console.error(`\nSuba STATIC_CACHE e RUNTIME_CACHE em ${SW} antes do deploy.`);
  process.exit(1);
}

console.log(
  `Versao do cache atualizada junto com ${shellAlterado.length} arquivo(s) do APP_SHELL.`,
);
