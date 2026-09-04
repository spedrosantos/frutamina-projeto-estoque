/*
  Aplica o tema salvo ANTES da primeira pintura.

  O tema mora em body[data-theme] e so era aplicado no fim do boot, por
  setupTheme(). Como o padrao do CSS e o claro, quem tinha "dark" salvo via um
  clarao branco em toda abertura de aba ate os modulos carregarem.

  Precisa ser script classico e sincrono, e precisa estar DENTRO do <body>: em
  head.js o document.body ainda nao existe. Um <script type="module"> tambem nao
  serve - modulo e sempre adiado, ou seja, roda depois da pintura.

  A chave e a mesma de THEME_PREFERENCE_KEY em core/config.js. Esta duplicada de
  proposito: importar traria o adiamento que este arquivo existe para evitar.
  Mudou la, muda aqui.
*/
try {
  var temaSalvo = localStorage.getItem("cd_theme_preference_v1");
  if (temaSalvo === "dark" || temaSalvo === "light") {
    document.body.dataset.theme = temaSalvo;
    document.documentElement.style.colorScheme = temaSalvo;
  }
} catch (error) {
  // Storage bloqueado (navegador restrito): o boot aplica o tema depois.
}
