import { BOOK_SOURCE_SHA256, BOOK_SOURCE_VERSION } from "./conversational-creation-book-manifest";

export type BookMemoryEntity = {
  id: string;
  canonicalName: string;
  entityType: "concept" | "people" | "office" | "role" | "rule_group";
  aliases: string[];
  shortDefinition: string;
  relatedEntities: string[];
  sourceChunkIds: string[];
  sourceLineRanges: Array<{ chunkId: string; startLine: number; endLine: number }>;
  sourceVersion: string;
  sourceHash: string;
  mechanicalStatus: "normative" | "descriptive";
  authorityLevel: "canonical_book";
};

export type BookMemoryRelation = {
  from: string;
  relation: "defined_by" | "requires" | "permits" | "related_to";
  to: string;
  sourceChunkId: string;
  sourceLineRange: { startLine: number; endLine: number };
  evidence: string;
  sourceVersion: string;
  sourceHash: string;
  authorityLevel: "canonical_book";
};

export type BookMemoryFact = {
  id: string;
  statement: string;
  entityIds: string[];
  sourceChunkId: string;
  sourceLineRange: { startLine: number; endLine: number };
  sourceVersion: string;
  sourceHash: string;
  mechanicalStatus: "normative" | "descriptive";
  authorityLevel: "canonical_book";
};

const source = (chunkId: string, startLine: number, endLine: number) => ({
  chunkId,
  startLine,
  endLine,
});

/** Curated, source-pinned concepts. The complete text remains in the existing 200-chunk store. */
export const KALLISTIS_BOOK_MEMORY = {
  id: "KALLISTIS_BOOK_MEMORY",
  sourceVersion: BOOK_SOURCE_VERSION,
  sourceHash: BOOK_SOURCE_SHA256,
  entities: [
    {
      id: "evocacao",
      canonicalName: "Evocação",
      entityType: "concept",
      aliases: [
        "evocação",
        "evocar",
        "presença evocada",
        "espírito evocado",
        "consciência própria",
        "consciência da criatura",
      ],
      shortDefinition:
        "Manifestação temporária de uma presença vinculada; evocar não significa possuir.",
      relatedEntities: [
        "ancora",
        "forma-evocacao",
        "impulso-evocacao",
        "pacto-evocacao",
        "evocador",
      ],
      sourceChunkIds: ["K12-0120", "K12-0123"],
      sourceLineRanges: [source("K12-0120", 5256, 5301), source("K12-0123", 5388, 5432)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "ancora",
      canonicalName: "Âncora",
      entityType: "concept",
      aliases: ["âncora da evocação", "âncora de pacto", "ancora", "âncoras"],
      shortDefinition:
        "Objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído que ancora o vínculo evocado.",
      relatedEntities: ["evocacao", "forma-evocacao", "impulso-evocacao", "pacto-evocacao"],
      sourceChunkIds: ["K12-0120"],
      sourceLineRanges: [source("K12-0120", 5256, 5301)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "forma-evocacao",
      canonicalName: "Forma da Evocação",
      entityType: "concept",
      aliases: ["forma", "forma evocada", "aparência da evocação"],
      shortDefinition: "Define como a presença aparece e quais funções consegue exercer.",
      relatedEntities: ["evocacao", "ancora", "impulso-evocacao", "pacto-evocacao"],
      sourceChunkIds: ["K12-0120", "K12-0123"],
      sourceLineRanges: [source("K12-0120", 5256, 5301), source("K12-0123", 5388, 5432)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "impulso-evocacao",
      canonicalName: "Impulso da Evocação",
      entityType: "concept",
      aliases: ["impulso", "impulso evocado", "tendência espontânea"],
      shortDefinition: "Aquilo que a presença tende a fazer espontaneamente.",
      relatedEntities: ["evocacao", "ancora", "forma-evocacao", "pacto-evocacao"],
      sourceChunkIds: ["K12-0120", "K12-0123"],
      sourceLineRanges: [source("K12-0120", 5256, 5301), source("K12-0123", 5388, 5432)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "pacto-evocacao",
      canonicalName: "Pacto da Evocação",
      entityType: "concept",
      aliases: ["pacto", "limitações do pacto", "acordo do vínculo"],
      shortDefinition: "Acordo que limita tanto o evocador quanto a presença.",
      relatedEntities: ["evocacao", "ancora", "forma-evocacao", "impulso-evocacao"],
      sourceChunkIds: ["K12-0120"],
      sourceLineRanges: [source("K12-0120", 5256, 5301)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "evocador",
      canonicalName: "Evocador",
      entityType: "office",
      aliases: ["evocadora", "ofício evocador", "trilha de evocador"],
      shortDefinition:
        "Ofício ligado ao estabelecimento, sustentação e comando de vínculos evocados conforme o pacto.",
      relatedEntities: ["evocacao", "pacto-evocacao", "tecelão"],
      sourceChunkIds: ["K12-0093", "K12-0094", "K12-0120"],
      sourceLineRanges: [
        source("K12-0093", 4115, 4161),
        source("K12-0094", 4162, 4205),
        source("K12-0120", 5256, 5301),
      ],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "tecelão",
      canonicalName: "Tecelão",
      entityType: "office",
      aliases: ["tecelã", "ofício tecelão", "trilha de tecelão"],
      shortDefinition: "Ofício associado à prática de fórmulas e controle de efeitos mágicos.",
      relatedEntities: ["evocador", "magia", "sintonia"],
      sourceChunkIds: ["K12-0092", "K12-0106", "K12-0119"],
      sourceLineRanges: [
        source("K12-0092", 4066, 4114),
        source("K12-0106", 4678, 4793),
        source("K12-0119", 5223, 5255),
      ],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "curador",
      canonicalName: "Curador",
      entityType: "office",
      aliases: ["curadora", "ofício curador", "trilha de curador"],
      shortDefinition:
        "Ofício de cuidado; suas regras definem papéis, perícias e proficiências sem impor uma identidade moral única.",
      relatedEntities: ["amparo", "guardiao", "tecelão"],
      sourceChunkIds: ["K12-0086", "K12-0093"],
      sourceLineRanges: [source("K12-0086", 3746, 3789), source("K12-0093", 4115, 4161)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "amparo",
      canonicalName: "Amparo",
      entityType: "role",
      aliases: ["papel amparo"],
      shortDefinition:
        "Papel possível do Curador e do Evocador; detalhes dependem da regra de cada Ofício.",
      relatedEntities: ["curador", "evocador"],
      sourceChunkIds: ["K12-0093"],
      sourceLineRanges: [source("K12-0093", 4115, 4161)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "bastiao",
      canonicalName: "Bastião",
      entityType: "role",
      aliases: ["papel bastião", "bastiao"],
      shortDefinition:
        "Papel possível do Evocador; a definição detalhada está no trecho normativo do Ofício.",
      relatedEntities: ["evocador", "evocacao"],
      sourceChunkIds: ["K12-0093"],
      sourceLineRanges: [source("K12-0093", 4115, 4161)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "guardiao",
      canonicalName: "Guardião",
      entityType: "office",
      aliases: ["guardião", "guardiao", "ofício guardião", "trilha de guardião"],
      shortDefinition:
        "Ofício com papéis Bastião ou Amparo, perícias Combate e Cuidado e proficiências em armaduras médias e pesadas, escudos e armas militares.",
      relatedEntities: ["oficios", "amparo", "bastiao"],
      sourceChunkIds: ["K12-0089"],
      sourceLineRanges: [source("K12-0089", 3916, 3964)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "povos",
      canonicalName: "Povos de KALLISTIS",
      entityType: "rule_group",
      aliases: ["nove povos", "povos", "diferenças entre os povos"],
      shortDefinition:
        "O manuscrito lista nove Povos e descreve diferenças culturais e de jogo sem reduzir cada pessoa a uma caricatura.",
      relatedEntities: [
        "aelvari",
        "kragor",
        "draken",
        "nomos",
        "livres",
        "doreos",
        "teriantes",
        "nimari",
        "vitralios",
      ],
      sourceChunkIds: ["K12-0038"],
      sourceLineRanges: [source("K12-0038", 1622, 1651)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "descriptive",
      authorityLevel: "canonical_book",
    },
    ...[
      [
        "aelvari",
        "Aelvari",
        ["aelvari"],
        "K12-0082",
        3499,
        3559,
        "Ao investigar um lugar, objeto ou tradição com vínculo histórico, receba +2.",
        "K12-0044",
        1817,
        1851,
        [],
      ],
      [
        "kragor",
        "Kragor",
        ["kragor"],
        "K12-0082",
        3499,
        3559,
        "Enquanto estiver adjacente ou na mesma zona que um aliado consciente, receba +1 Fortitude e +1 dano corpo a corpo.",
        "K12-0045",
        1852,
        1871,
        [],
      ],
      [
        "draken",
        "Draken",
        ["draken"],
        "K12-0082",
        3499,
        3559,
        "Escolha uma Afinidade entre brasa, frio, tormenta, pedra, maré ou vento.",
        "K12-0047",
        1912,
        1944,
        [["K12-0083", 3560, 3629]],
      ],
      [
        "nomos",
        "Nomos",
        ["nomos"],
        "K12-0083",
        3560,
        3629,
        "Escolha dois módulos.",
        "K12-0049",
        1996,
        2011,
        [],
      ],
      [
        "livres",
        "Livres",
        ["livre", "livres"],
        "K12-0083",
        3560,
        3629,
        "Escolha uma Perícia fora do seu Ofício e aumente-a em +1.",
        "K12-0051",
        2061,
        2109,
        [],
      ],
      [
        "doreos",
        "Dóreos",
        ["dóreo", "dóreos", "doreos"],
        "K12-0083",
        3560,
        3629,
        "Ao tocar uma obra, ferramenta ou estrutura, role 2d10 + Sintonia + Ofício.",
        "K12-0052",
        2110,
        2135,
        [["K12-0084", 3630, 3699]],
      ],
      [
        "teriantes",
        "Teriantes",
        ["teriante", "teriantes"],
        "K12-0084",
        3630,
        3699,
        "Escolha um Aspecto e um sentido associado.",
        "K12-0054",
        2177,
        2223,
        [],
      ],
      [
        "nimari",
        "Nimari",
        ["nimari", "nimaris"],
        "K12-0084",
        3630,
        3699,
        "Nimari são o povo pequeno das rotas.",
        "K12-0055",
        2224,
        2261,
        [],
      ],
      [
        "vitralios",
        "Vitrálios",
        ["vitrálio", "vitrálios", "vitralios"],
        "K12-0084",
        3630,
        3699,
        "Escolha uma frequência dominante entre calor, som, emoção, luz física, vibração ou magia.",
        "K12-0056",
        2262,
        2292,
        [
          ["K12-0057", 2293, 2357],
          ["K12-0085", 3700, 3745],
        ],
      ],
    ].map(
      ([
        id,
        canonicalName,
        aliases,
        chunkId,
        startLine,
        endLine,
        shortDefinition,
        narrativeChunkId,
        narrativeStart,
        narrativeEnd,
        additionalSources,
      ]) => ({
        id: String(id),
        canonicalName: String(canonicalName),
        entityType: "people" as const,
        aliases: aliases as string[],
        shortDefinition: String(shortDefinition),
        relatedEntities: ["povos"],
        sourceChunkIds: [
          String(chunkId),
          String(narrativeChunkId),
          "K12-0038",
          ...(additionalSources as Array<[string, number, number]>).map(([id]) => id),
        ],
        sourceLineRanges: [
          source(String(chunkId), Number(startLine), Number(endLine)),
          source(String(narrativeChunkId), Number(narrativeStart), Number(narrativeEnd)),
          source("K12-0038", 1622, 1651),
          ...(additionalSources as Array<[string, number, number]>).map(([id, start, end]) =>
            source(id, start, end),
          ),
        ],
        sourceVersion: BOOK_SOURCE_VERSION,
        sourceHash: BOOK_SOURCE_SHA256,
        mechanicalStatus: "normative" as const,
        authorityLevel: "canonical_book" as const,
      }),
    ),
    {
      id: "atributos-e-pericias",
      canonicalName: "Atributos e Perícias",
      entityType: "rule_group",
      aliases: ["atributo", "atributos", "perícia", "perícias", "distribuição inicial"],
      shortDefinition:
        "O capítulo Personagem e recursos contém as definições, relações e limites de atributos e Perícias.",
      relatedEntities: ["sintonia", "evocacao"],
      sourceChunkIds: ["K12-0106"],
      sourceLineRanges: [source("K12-0106", 4678, 4793)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "magia",
      canonicalName: "Magia",
      entityType: "concept",
      aliases: ["magias", "forma mágica", "formas mágicas"],
      shortDefinition:
        "Prática de fórmulas e efeitos mágicos, distinta do estabelecimento e comando de vínculos evocados.",
      relatedEntities: ["tecelão", "sintonia", "evocacao"],
      sourceChunkIds: ["K12-0106", "K12-0112", "K12-0120"],
      sourceLineRanges: [
        source("K12-0106", 4678, 4793),
        source("K12-0112", 5039, 5118),
        source("K12-0120", 5256, 5301),
      ],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "sintonia",
      canonicalName: "Sintonia",
      entityType: "concept",
      aliases: ["sintonia mágica", "limites de sintonia"],
      shortDefinition:
        "Atributo relacionado ao uso de magia e Evocação; consulte as regras de personagem e magia.",
      relatedEntities: ["magia", "evocacao", "tecelão", "evocador"],
      sourceChunkIds: ["K12-0106", "K12-0112"],
      sourceLineRanges: [source("K12-0106", 4678, 4793), source("K12-0112", 5039, 5118)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "origens-herancas",
      canonicalName: "Origens e Heranças",
      entityType: "rule_group",
      aliases: [
        "origem",
        "origens",
        "herança",
        "heranças",
        "múltiplos caminhos",
        "criado na luz",
        "criado na escuridão",
        "origem trocado",
        "nascimento e criação",
        "trocado",
      ],
      shortDefinition:
        "Categorias distintas da ficha; seus efeitos e escolhas dependem das regras e das opções canônicas vigentes.",
      relatedEntities: ["povos", "oficios"],
      sourceChunkIds: ["K12-0108", "K12-0082"],
      sourceLineRanges: [source("K12-0108", 4843, 4886), source("K12-0082", 3499, 3559)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "heranca-reparador",
      canonicalName: "Reparador",
      entityType: "concept",
      aliases: ["herança reparador", "reparador nomos"],
      shortDefinition: "Use Ofício no lugar de Cuidado ao tratar Nomos e dispositivos.",
      relatedEntities: ["origens-herancas", "nomos"],
      sourceChunkIds: ["K12-0083"],
      sourceLineRanges: [source("K12-0083", 3560, 3629)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "pergunta-central",
      canonicalName: "Pergunta pessoal",
      entityType: "concept",
      aliases: ["pergunta central", "pergunta pessoal", "questão central"],
      shortDefinition: "Campo narrativo da criação da personagem; não é uma escolha mecânica.",
      relatedEntities: [],
      sourceChunkIds: ["K12-0108"],
      sourceLineRanges: [source("K12-0108", 4843, 4886)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "descriptive",
      authorityLevel: "canonical_book",
    },
    {
      id: "equipamentos",
      canonicalName: "Equipamentos",
      entityType: "rule_group",
      aliases: [
        "equipamento",
        "equipamentos",
        "arma",
        "armas",
        "armadura",
        "armaduras",
        "ferramenta",
        "ferramentas",
        "consumíveis",
        "consumiveis",
        "proficiência de armas",
        "proficiências de armas",
        "proficiencia de armas",
        "proficiencias de armas",
      ],
      shortDefinition: "O capítulo Equipamentos reúne regras para itens usados pelas personagens.",
      relatedEntities: ["oficios"],
      sourceChunkIds: ["K12-0135"],
      sourceLineRanges: [source("K12-0135", 6005, 6084)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "progressao",
      canonicalName: "Progressão e Marcos",
      entityType: "rule_group",
      aliases: [
        "progressão",
        "progressao",
        "marco",
        "marcos",
        "manifestação épica",
        "manifestacao epica",
      ],
      shortDefinition: "O livro reúne a progressão por Marcos no capítulo Progressão e Fratura.",
      relatedEntities: ["oficios", "magia"],
      sourceChunkIds: ["K12-0140", "K12-0141", "K12-0142"],
      sourceLineRanges: [
        source("K12-0140", 6427, 6485),
        source("K12-0141", 6486, 6545),
        source("K12-0142", 6546, 6622),
      ],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "oficios",
      canonicalName: "Ofícios e Papéis",
      entityType: "rule_group",
      aliases: ["ofício", "ofícios", "papel", "papéis", "trilha"],
      shortDefinition:
        "Cada Ofício define papéis possíveis, perícias treinadas, proficiências, chave, técnica inicial e técnicas.",
      relatedEntities: [
        "curador",
        "evocador",
        "tecelão",
        "guardiao",
        "amparo",
        "bastiao",
        "atributos-e-pericias",
      ],
      sourceChunkIds: ["K12-0086"],
      sourceLineRanges: [source("K12-0086", 3746, 3789)],
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
  ] satisfies BookMemoryEntity[],
  relations: [
    {
      from: "evocacao",
      relation: "requires",
      to: "ancora",
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5256, endLine: 5301 },
      evidence:
        "No Marco 1, um Evocador começa com até 2 Vínculos menores estabelecidos, cada qual com Âncora, Forma, Impulso e Pacto definidos.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
    {
      from: "evocacao",
      relation: "requires",
      to: "forma-evocacao",
      sourceChunkId: "K12-0123",
      sourceLineRange: { startLine: 5388, endLine: 5432 },
      evidence:
        "A presença precisa de Âncora, aparência, Impulso e Pacto definidos antes de receber capacidades compatíveis com sua escala.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
    {
      from: "evocacao",
      relation: "requires",
      to: "impulso-evocacao",
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5256, endLine: 5301 },
      evidence: "Impulso. O que tende a fazer espontaneamente.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
    {
      from: "evocacao",
      relation: "requires",
      to: "pacto-evocacao",
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5256, endLine: 5301 },
      evidence: "Pacto. O acordo que limita evocador e presença.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
    {
      from: "oficios",
      relation: "related_to",
      to: "atributos-e-pericias",
      sourceChunkId: "K12-0086",
      sourceLineRange: { startLine: 3751, endLine: 3751 },
      evidence:
        "Cada Ofício define Papéis possíveis, duas Perícias treinadas, proficiências, uma Chave vinculada, técnica inicial e catálogo próprio de técnicas.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
    {
      from: "oficios",
      relation: "related_to",
      to: "evocador",
      sourceChunkId: "K12-0093",
      sourceLineRange: { startLine: 4115, endLine: 4161 },
      evidence: "Papéis: Artilharia, Amparo ou Bastião.",
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      authorityLevel: "canonical_book",
    },
  ] satisfies BookMemoryRelation[],
  facts: [
    {
      id: "evocacao-definicao",
      statement:
        "Evocação é manifestação temporária de presença vinculada: espírito, memória estruturada, forma elemental, construto, eco de criatura, padrão Vitrálio, projeção, entidade de pacto ou presença artificial. Evocar não significa possuir. Presença consciente pode recusar ordem incompatível com seu Pacto.",
      entityIds: ["evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5262, endLine: 5262 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "ancora-definicao",
      statement: "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
      entityIds: ["ancora", "evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5266, endLine: 5266 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "forma-evocacao-definicao",
      statement: "Forma. como a presença aparece e quais funções consegue exercer.",
      entityIds: ["forma-evocacao", "evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5269, endLine: 5269 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "impulso-evocacao-definicao",
      statement: "Impulso. o que tende a fazer espontaneamente.",
      entityIds: ["impulso-evocacao", "evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5272, endLine: 5272 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "pacto-evocacao-definicao",
      statement: "Pacto. o acordo que limita evocador e presença.",
      entityIds: ["pacto-evocacao", "evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5275, endLine: 5275 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "evocacao-marco-1-vinculos",
      statement:
        "No Marco 1, um Evocador começa com até 2 Vínculos menores estabelecidos, cada qual com Âncora, Forma, Impulso e Pacto definidos.",
      entityIds: [
        "evocacao",
        "evocador",
        "ancora",
        "forma-evocacao",
        "impulso-evocacao",
        "pacto-evocacao",
      ],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5282, endLine: 5282 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
    {
      id: "evocacao-consentimento",
      statement: "Uma presença consciente exige consentimento e pode negociar alteração do Pacto.",
      entityIds: ["evocacao", "pacto-evocacao"],
      sourceChunkId: "K12-0120",
      sourceLineRange: { startLine: 5280, endLine: 5280 },
      sourceVersion: BOOK_SOURCE_VERSION,
      sourceHash: BOOK_SOURCE_SHA256,
      mechanicalStatus: "normative",
      authorityLevel: "canonical_book",
    },
  ] satisfies BookMemoryFact[],
} as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function phraseMatches(query: string, alias: string) {
  const normalizedQuery = ` ${normalize(query)} `;
  const normalizedAlias = normalize(alias);
  return normalizedAlias.length > 2 && normalizedQuery.includes(` ${normalizedAlias} `);
}

export function resolveBookMemoryEntities(query: string) {
  const normalized = normalize(query);
  const matched = KALLISTIS_BOOK_MEMORY.entities.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some((alias) => {
      return phraseMatches(normalized, alias);
    }),
  );
  const entityIds = new Set(matched.map((entity) => entity.id));
  const relatedEntityIds = matched.flatMap((entity) => entity.relatedEntities);
  const traversableEntityIds = new Set([...entityIds, ...relatedEntityIds]);
  const relations = KALLISTIS_BOOK_MEMORY.relations.filter(
    (relation) => traversableEntityIds.has(relation.from) && traversableEntityIds.has(relation.to),
  );
  const related = relations.map((relation) => relation.sourceChunkId);
  const expanded = KALLISTIS_BOOK_MEMORY.entities.filter((entity) =>
    relatedEntityIds.includes(entity.id),
  );
  const chunkIds = [
    ...new Set(
      [...matched, ...expanded].flatMap((entity) => entity.sourceChunkIds).concat(related),
    ),
  ];
  return {
    entities: [...new Set([...matched, ...expanded])],
    matchedEntityIds: matched.map((entity) => entity.id),
    relations,
    facts: KALLISTIS_BOOK_MEMORY.facts.filter((fact) =>
      fact.entityIds.some((entityId) => [...entityIds, ...relatedEntityIds].includes(entityId)),
    ),
    chunkIds,
  };
}
