// Node nao tem DOM, e state.js resolve os elementos e o cliente do Supabase no
// momento em que e avaliado. Este modulo entra ANTES dos imports do app em cada
// teste (imports ESM sao avaliados na ordem em que aparecem) e planta o minimo
// para aquele modulo carregar. Nenhum teste toca a tela: o que se testa aqui e
// so a matematica do estoque.
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { dataset: {} },
};
globalThis.window = {
  supabase: { createClient: () => ({ auth: {}, from: () => ({}) }) },
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
