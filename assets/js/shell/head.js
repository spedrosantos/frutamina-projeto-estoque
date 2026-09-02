// Metatags, manifest e fontes: iguais nas quatro paginas.
//
// O <head> era 30 linhas identicas repetidas quatro vezes - so o <title> mudava.
// Cada pagina agora carrega charset, title, os <link> de CSS (bloqueantes, tem que ser
// tag) e este script; o resto sai daqui.
//
// Script classico e sincrono de proposito: roda durante o parse do <head>, antes
// da primeira pintura, para o theme-color valer ja na abertura. A folha de fonte
// do Google continua preguicosa (media="print" trocado no onload); os icones
// deixaram de vir de CDN - o subset local mora no fim do assets/css/base.css.
document.head.insertAdjacentHTML(
  "beforeend",
  `
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0a0d14" media="(prefers-color-scheme: dark)" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Estoque CD" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./assets/img/apple-touch-icon.png" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Source+Sans+3:wght@400;600&display=swap"
      rel="stylesheet"
      media="print"
      onload="this.media='all'"
    />
    <link
      rel="preload"
      href="./assets/fonts/bootstrap-icons-subset.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />`,
);
