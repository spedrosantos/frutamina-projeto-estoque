// Constantes de configuracao e regras de negocio do sistema.

export const SUPABASE_URL = "https://ldkazwnzfppcsoolydkp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_14RDXtWzeDV-nzAHfGrNCw_lB4XsUSn";
export const TABLE_NAME = "estoque_registros";
export const SNAPSHOT_TABLE = "estoque_snapshots";
export const CATALOG_TABLE = "catalog_overrides";
export const HISTORICO_DIARIO_TABLE = "estoque_historico_diario";
export const HISTORICO_DIARIO_TOTAL_VIEW = "estoque_historico_diario_total";
export const USER_LABELS_TABLE = "usuarios_label";
export const SESSION_MAX_MS = 60 * 60 * 1000;
export const SUPABASE_TIMEOUT_MS = 45000;
// Leituras do boot usam um limite curto: passado isso vale mais servir o cache
// local do que deixar a tela esperando.
export const SUPABASE_READ_TIMEOUT_MS = 12000;
// Teto de snapshots carregados (mais recentes primeiro). Sem isso a Visao Geral
// fica mais lenta a cada contagem salva, para sempre.
export const SNAPSHOT_FETCH_LIMIT = 5000;
export const PUBLIC_CACHE_KEY = "cd_public_cache";
export const PUBLIC_CACHE_AT_KEY = "cd_public_cache_at";
export const COUNT_DRAFT_KEY_PREFIX = "cd_count_draft_v1";
export const CATALOG_ADDITIONS_KEY = "cd_catalog_additions_v1";
export const CATALOG_REMOVALS_KEY = "cd_catalog_removals_v1";
export const THEME_PREFERENCE_KEY = "cd_theme_preference_v1";
// Quando o usuario dispensou o convite de notificacoes, e por quanto tempo o
// convite fica suprimido. Sem isso o convite reabre em cada troca de tela,
// porque cada pagina e uma navegacao nova e a permissao segue "default".
export const NOTIFICATION_INVITE_DISMISSED_AT_KEY = "cd_notification_invite_dismissed_at_v1";
export const NOTIFICATION_INVITE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const CONFIG_GERAL = {
  
  CHAO: {
    AMARELO: {
      ANGEL: (t) => (t >= 4 && t <= 9 ? 72 : 65),
      LULA: (t) => 66,
      ANGELA: (t) => 66,
      SAMBA: (t) => (t >= 4 && t <= 6 ? 66 : 65),
      BRAZIL: (t) => (t >= 4 && t <= 6 ? 66 : 65),
      "BRAZIL REDE": (t) => (t >= 4 && t <= 7 ? 66 : 65),
      MOSSORO: (t) => (t >= 4 && t <= 6 ? 72 : 70),
      "MOSSORO REDE": (t) => (t >= 4 && t <= 6 ? 72 : 70),
      SOL: (t) => 72,
    },
    SAPO: {
      ANGEL: (t) => (t >= 4 && t <= 9 ? 72 : 65),
      SAMBA: (t) => (t >= 4 && t <= 6 ? 66 : 65),
      "SAMBA REDE": (t) => 77,
      LOLA: (t) => 66,
      BAHIA: (t) => 66,
      COSA: (t) => 66,

    },
    "MELANCIA (CHAO)": {
      SAMBA: (t) => (t >= 4 && t <= 7 ? 66 : 65),
      MOSSORO: (t) => 60,

      BRAZIL: (t) => 60,
    },
  },
  GELADEIRA: {
    CANTALOUPE: {
      SAMBA: (t) => 65,
      BRAZIL: (t) => 65,
    },
    ORANGE: {
      BAHIA: (t) => 130,
      MOSSORO: (t) => 130,
    },
    "ORANGE REDE": {
      MOSSORO: (t) => 77,
    },
    DINO: {
      SAMBA: (t) => 84,
      BRAZIL: (t) => 84,
    },
  },
  ITAUEIRA: {
    AMARELO: {
      REI: (t) => (t === 4 ? 77 : 84),
      "REI 14Kg": (t) => 66,
      CEPI: (t) => (t === 4 ? 77 : 84),
      GAIA: (t) => (t >= 4 && t <= 7 ? 66 : 65),
    },
    SAPO: {
      REI: (t) => (t === 4 ? 77 : 84),
      "REI 14Kg": (t) => 66,
      CEPI: (t) => (t === 4 ? 77 : 84),
      GAIA: (t) => (t >= 6 && t <= 7 ? 66 : 65),
    },
    "MELANCIA (ITAUEIRA)": {
      MAGALI: (t) => (t >= 5 && t <= 6 ? 77 : 84),
      "MAGALI 14Kg": (t) => 66,
      CEPI: (t) => (t >= 5 && t <= 6 ? 77 : 84),
      "CEPI 14Kg": (t) => 66,
      "CEPI BRANCA": (t) => 54,
    },
    MATISSE: {
      "MATISSE REI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
      "MATISSE CEPI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
      CEPI: (t) => (t >= 5 && t <= 6 ? 77 : 84),
    },
    CANTALOUPE: {
      "CANTALOUPE REI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
      "CANTALOUPE CEPI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
    },
    GALIA: {
      "GALIA REI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
      "GALIA CEPI": (t) => (t >= 5 && t <= 6 ? 77 : 84),
    },
    PIMENTAO: {
      AMARELO: (t) => 88,
      VERMELHO: (t) => 88,
      LARANJA: (t) => 88,
      DUO: (t) => 88,
    },
  },
};

export function cloneConfigTree(sourceConfig = {}) {
  const cloned = {};
  Object.entries(sourceConfig || {}).forEach(([setor, produtos]) => {
    cloned[setor] = {};
    Object.entries(produtos || {}).forEach(([produto, marcas]) => {
      cloned[setor][produto] = { ...(marcas || {}) };
    });
  });
  return cloned;
}

export const BASE_CONFIG_GERAL = cloneConfigTree(CONFIG_GERAL);

export const NUMBER_WORDS = {
  ZERO: 0,
  UM: 1,
  UMA: 1,
  DOIS: 2,
  DUAS: 2,
  TRES: 3,
  QUATRO: 4,
  CINCO: 5,
  SEIS: 6,
  SETE: 7,
  OITO: 8,
  NOVE: 9,
  DEZ: 10,
  ONZE: 11,
  DOZE: 12,
  TREZE: 13,
  CATORZE: 14,
  QUATORZE: 14,
  QUINZE: 15,
  DEZESSEIS: 16,
  DEZESSETE: 17,
  DEZOITO: 18,
  DEZENOVE: 19,
  VINTE: 20,
};

export const ADD_KEYWORDS = new Set([
  "ADICIONAR",
  "ADICIONE",
  "ADICIONA",
  "SOMAR",
  "SOME",
  "SOMA",
  "ACRESCENTAR",
  "ACRESCENTE",
  "ACRESCENTA",
  "MAIS",
]);

export const BOX_KEYWORDS = new Set([
  "CAIXA",
  "CAIXAS",
  "CX",
  "CXS",
  "AVULSA",
  "AVULSAS",
]);

export const REMOVE_KEYWORDS = new Set(["REMOVER", "REMOVA", "DESFAZER"]);
export const CORRECT_KEYWORDS = new Set(["CORRIGIR", "CORRIGE", "CORRECAO"]);
export const LAUNCH_KEYWORDS = new Set(["LANCAR"]);
export const SAVE_KEYWORDS = new Set(["SALVAR", "ENVIAR", "PUBLICAR"]);
export const DISCARD_KEYWORDS = new Set(["DESCARTAR", "CANCELAR"]);

export const BASE_NO_TIPO_PRODUCTS = new Set(["PIMENTAO"]);
export const NO_TIPO_PRODUCTS = new Set(BASE_NO_TIPO_PRODUCTS);
export const NO_TIPO_VALUE = 0;
export const TIPO_MIN = 3;
export const TIPO_MAX = 15;
export const SPECIAL_TIPO_VARIANTS = {
  ORANGE: [
    {
      value: 14,
      legacyValues: [601],
      baseValue: 6,
      sortOrder: 61,
      label: "6A",
      matchSequences: [
        ["6", "A"],
        ["SEIS", "A"],
      ],
    },
    {
      value: 15,
      legacyValues: [602],
      baseValue: 6,
      sortOrder: 62,
      label: "6B",
      matchSequences: [
        ["6", "B"],
        ["SEIS", "B"],
      ],
    },
  ],
};
