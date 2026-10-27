import forgeCatalog from "./character-forge-choice-catalog.generated.json";
import {
  INITIAL_ATTRIBUTE_DISTRIBUTION,
  INITIAL_SKILL_DISTRIBUTION,
  characterArmorOptionsForOffice,
  characterToolOptionsForOffice,
  characterWeaponOptionsForOffice,
  universalMagicGradeMax,
} from "./character-canon";

export const CHARACTER_FORGE_CHOICE_CATALOG = forgeCatalog;

export type CharacterChoiceFieldType =
  | "CLOSED_CHOICE"
  | "MULTI_CHOICE"
  | "NUMERIC_DISTRIBUTION"
  | "FREE_TEXT"
  | "DERIVED"
  | "AUTO_FILLED";

export type CharacterChoiceField = {
  field: string;
  type: CharacterChoiceFieldType;
  canonicalValues: readonly string[];
  aliases?: Readonly<Record<string, string>>;
  dependencies: readonly string[];
  minChoices?: number;
  maxChoices?: number;
};

const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))];
const officeValues = forgeCatalog.offices.map((office) => office.name);
const heritageValues = unique(forgeCatalog.peoples.flatMap((people) => people.heritages));
const roleValues = unique(forgeCatalog.offices.flatMap((office) => office.roles));
const keyValues = unique(forgeCatalog.offices.flatMap((office) => office.keys));
const techniqueValues = unique([
  ...forgeCatalog.offices.flatMap((office) => [
    office.initialTechnique,
    ...office.techniques,
    ...office.specializations.flatMap((specialization) => specialization.techniques),
  ]),
  ...forgeCatalog.universalTechniques,
  ...forgeCatalog.magic,
]);
const specializationValues = unique(
  forgeCatalog.offices.flatMap((office) =>
    office.specializations.map((specialization) => specialization.name),
  ),
);
const magicFormValues = forgeCatalog.magicForms.map((form) => form.id);
const evocationModelValues = unique(forgeCatalog.evocations);
const peopleChoiceValues = unique(
  Object.values(forgeCatalog.peopleChoices).flatMap((choices) =>
    choices.flatMap((choice) => choice.values),
  ),
);

const closed = (
  field: string,
  canonicalValues: readonly string[],
  dependencies: readonly string[] = [],
  aliases?: Readonly<Record<string, string>>,
): CharacterChoiceField => ({
  field,
  type: "CLOSED_CHOICE",
  canonicalValues,
  dependencies,
  aliases,
});
const multi = (
  field: string,
  canonicalValues: readonly string[],
  dependencies: readonly string[] = [],
  minChoices?: number,
  maxChoices?: number,
) =>
  ({
    field,
    type: "MULTI_CHOICE",
    canonicalValues,
    dependencies,
    minChoices,
    maxChoices,
  }) satisfies CharacterChoiceField;
const numeric = (
  field: string,
  canonicalValues: readonly string[],
  dependencies: readonly string[] = [],
) =>
  ({
    field,
    type: "NUMERIC_DISTRIBUTION",
    canonicalValues,
    dependencies,
  }) satisfies CharacterChoiceField;
const free = (field: string, dependencies: readonly string[] = []) =>
  ({ field, type: "FREE_TEXT", canonicalValues: [], dependencies }) satisfies CharacterChoiceField;
const derived = (field: string, dependencies: readonly string[] = []) =>
  ({ field, type: "DERIVED", canonicalValues: [], dependencies }) satisfies CharacterChoiceField;
const automatic = (field: string) =>
  ({
    field,
    type: "AUTO_FILLED",
    canonicalValues: [],
    dependencies: [],
  }) satisfies CharacterChoiceField;
const conditionalPeopleFields = Object.entries(forgeCatalog.peopleChoices).flatMap(
  ([people, choices]) =>
    choices.map((choice) => ({
      ...(choice.max === 1
        ? closed(`escolhasPovo.${people}.${choice.key}`, choice.values, [`povo=${people}`])
        : multi(
            `escolhasPovo.${people}.${choice.key}`,
            choice.values,
            [`povo=${people}`],
            choice.min,
            choice.max,
          )),
      minChoices: choice.min,
      maxChoices: choice.max,
    })),
);

export const CHARACTER_CHOICE_REGISTRY: readonly CharacterChoiceField[] = [
  automatic("jogador"),
  automatic("id"),
  automatic("criadoEm"),
  automatic("historico"),
  automatic("checkpoints"),
  automatic("artefatosVinculados"),
  automatic("completo"),
  automatic("passo"),
  derived("trilhaAtiva", ["trilhas"]),
  derived("reservas", ["atributosBase", "trilhas[].oficio"]),
  closed(
    "povo",
    forgeCatalog.peoples.map((people) => people.name),
    [],
    { livre: "Livres" },
  ),
  closed("heranca", heritageValues, ["povo"]),
  closed("origem", forgeCatalog.origins),
  closed("trilhas[].oficio", officeValues, [], {
    curadora: "Curador",
    curandeiro: "Curador",
    curandeira: "Curador",
  }),
  closed("trilhas[].papel", roleValues, ["trilhas[].oficio"]),
  closed("trilhas[].chave", keyValues, ["trilhas[].oficio"]),
  closed(
    "trilhas[].pericaEscolhida",
    unique(forgeCatalog.offices.flatMap((office) => office.optionalSkills)),
    ["trilhas[].oficio"],
  ),
  closed("trilhas[].tecnicas", techniqueValues, ["trilhas[].oficio", "trilhas[].marco"]),
  multi("trilhas", officeValues, ["trilhas[].oficio"]),
  multi("trilhas[].pericias", forgeCatalog.skills, ["trilhas[].oficio"]),
  multi("trilhas[].magias", forgeCatalog.magic, ["trilhas[].oficio"]),
  multi("trilhas[].especializacoes", specializationValues, ["trilhas[].oficio"]),
  multi("trilhas[].knownForms[].formId", magicFormValues, [
    "trilhas[].oficio=Tecelão",
    "trilhas[].marco",
  ]),
  multi("trilhas[].knownForms", magicFormValues, ["trilhas[].oficio=Tecelão", "trilhas[].marco"]),
  numeric(
    "trilhas[].marco",
    Array.from({ length: 15 }, (_, index) => String(index + 1)),
  ),
  automatic("trilhas[].id"),
  derived("trilhas[].chaveNome", ["trilhas[].chave"]),
  derived("trilhas[].ganhos", ["trilhas[].marco"]),
  derived("trilhas[].atributosGanhos", ["trilhas[].ganhos"]),
  free("trilhas[].manifestacoesEpicas", ["trilhas[].marco"]),
  closed("trilhas[].magiaEpica", forgeCatalog.magic, ["trilhas[].marco"]),
  free("trilhas[].legado", ["trilhas[].marco"]),
  automatic("trilhas[].acessoMagia"),
  automatic("trilhas[].advanceAuthorizedFor"),
  automatic("trilhas[].advanceNote"),
  closed("pericaLivre", forgeCatalog.skills, ["povo=Livres"]),
  closed("tecnicaHeranca.oficio", officeValues, [
    "povo=Livres",
    "heranca=Múltiplos Caminhos",
    "trilhas[0].oficio",
  ]),
  closed("tecnicaHeranca.nome", techniqueValues, ["tecnicaHeranca.oficio"]),
  ...conditionalPeopleFields,
  multi("escolhasPovo.*", peopleChoiceValues, ["povo"]),
  closed("origemBeneficio", forgeCatalog.originBenefits, ["origem=Outro"]),
  free("origemTrocado.nascimento", ["origem=Trocado"]),
  free("origemTrocado.criacao", ["origem=Trocado"]),
  free("origemTrocado.descricao", ["origem=Trocado"]),
  numeric("atributosBase", forgeCatalog.attributes),
  numeric("periciasBase", forgeCatalog.skills),
  closed("equipamento.arma", forgeCatalog.weapons, ["trilhas[].oficio"]),
  closed("equipamento.armadura", forgeCatalog.armors, ["trilhas[].oficio"]),
  closed("equipamento.ferramenta", forgeCatalog.tools, ["trilhas[].oficio"]),
  multi("equipamento.consumiveis", forgeCatalog.consumables, [], 2, 2),
  multi("equipamento.extras", ["Escudo"], ["trilhas[].oficio"], 0, 1),
  closed(
    "equipamento.proficienciaConfirmada",
    ["true", "false"],
    ["equipamento.arma", "trilhas[].oficio"],
    { sim: "true", confirmo: "true", não: "false", nao: "false" },
  ),
  closed("trilhas[].vinculosEvocados[].porte", forgeCatalog.evocationSizes, [
    "trilhas[].oficio=Evocador",
  ]),
  closed("trilhas[].vinculosEvocados[].forma", forgeCatalog.evocationForms, [
    "trilhas[].oficio=Evocador",
  ]),
  closed("trilhas[].vinculosEvocados[].modelo", evocationModelValues, [
    "trilhas[].oficio=Evocador",
  ]),
  multi("trilhas[].vinculosEvocados", evocationModelValues, ["trilhas[].oficio=Evocador"]),
  multi("condicoes", forgeCatalog.conditions),
  closed("progressao[].ganho", forgeCatalog.progressions),
  closed("qualidade", forgeCatalog.qualities),
  numeric("atributosBase.*", ["0", "1", "2", "3"], ["atributosBase"]),
  numeric("periciasBase.*", ["0", "1", "2", "3"], ["periciasBase"]),
  derived("atributosGanhos.*", ["trilhas[].ganhos"]),
  derived("periciasProveniencia.*", ["povo", "heranca", "trilhas[].oficio", "periciasBase"]),
  derived("trilhas[].ganhos.*", ["trilhas[].marco"]),
  derived("trilhas[].atributosGanhos.*", ["trilhas[].ganhos"]),
  derived("reservas.*", ["atributosBase", "trilhas[].oficio"]),
  free("nome"),
  free("sobrenome"),
  free("pronomes"),
  free("campanha"),
  free("apelido"),
  free("descricao"),
  free("aparencia"),
  free("conceito.identidade"),
  free("conceito.objetivo"),
  free("conceito.perda"),
  free("montaria.nome"),
  free("montaria.descricao"),
  free("montaria.notas"),
  free("pet.nome"),
  free("pet.descricao"),
  free("pet.notas"),
  free("montaria"),
  free("pet"),
  free("conceito"),
  multi("equipamento", []),
  multi("tecnicaHeranca", officeValues),
  free("origemDetalhe", ["origem"]),
  free("origemTrocado", ["origem=Trocado"]),
  free("dividaComunitaria", ["origem=Outro"]),
  free("biografia"),
  free("manifestacao_pessoal"),
  free("anotacoes"),
  free("fulgor"),
  free("capacidade_manifestacoes"),
  free("retrato"),
  multi("galeria", []),
  free("aspectoOutro", ["povo=Teriantes", "escolhasPovo.aspecto=Outro Aspecto"]),
  free("trilhas[].vinculosEvocados[].nome", ["trilhas[].oficio=Evocador"]),
  free("trilhas[].vinculosEvocados[].aparencia", ["trilhas[].oficio=Evocador"]),
  free("trilhas[].vinculosEvocados[].ancora", ["trilhas[].oficio=Evocador"]),
  free("trilhas[].vinculosEvocados[].impulso", ["trilhas[].oficio=Evocador"]),
  free("trilhas[].vinculosEvocados[].pacto", ["trilhas[].oficio=Evocador"]),
  free("trilhas[].vinculosEvocados[].consciencia", ["trilhas[].oficio=Evocador"]),
  free("vinculos"),
  multi("escolhasPovo", peopleChoiceValues, ["povo"]),
  free("promessa"),
  free("ferida"),
  free("pergunta"),
  derived("periciasProveniencia", ["povo", "heranca", "trilhas[].oficio", "periciasBase"]),
  derived("atributosGanhos", ["atributosBase", "marco"]),
  derived("trilhas[].tecnicaInicial", ["trilhas[].oficio"]),
  derived("recursosDerivados", ["atributosBase", "trilhas[].oficio"]),
];

export const FORGE_CLOSED_CHOICE_COUNT = CHARACTER_CHOICE_REGISTRY.filter(
  (field) => field.type === "CLOSED_CHOICE" || field.type === "MULTI_CHOICE",
).reduce((total, field) => total + field.canonicalValues.length, 0);

/** One field-scoped equivalence row for every value the current Forge can select. */
export const CHARACTER_CHOICE_EQUIVALENCES = CHARACTER_CHOICE_REGISTRY.filter(
  (field) => field.type === "CLOSED_CHOICE" || field.type === "MULTI_CHOICE",
).flatMap((field) =>
  field.canonicalValues.map((canonical) => ({
    field: field.field,
    canonical,
    aliases: [
      canonical,
      ...Object.entries(field.aliases ?? {})
        .filter(([, target]) => target === canonical)
        .map(([alias]) => alias),
    ],
    dependencies: field.dependencies,
  })),
);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function canonicalizeCharacterChoice(fieldPath: string, rawValue: string): string | null {
  const normalizedPath = fieldPath.replace(/\[\d+\]/g, "[]");
  const entry = CHARACTER_CHOICE_REGISTRY.find(
    (field) =>
      (field.field === normalizedPath ||
        (field.field.endsWith(".*") && normalizedPath.startsWith(field.field.slice(0, -1)))) &&
      (field.type === "CLOSED_CHOICE" || field.type === "MULTI_CHOICE"),
  );
  if (!entry) return null;
  const normalized = normalize(rawValue);
  const canonical = entry.canonicalValues.find((value) => normalize(value) === normalized);
  if (canonical) return canonical;
  const alias = Object.entries(entry.aliases ?? {}).find(([key]) => normalize(key) === normalized);
  return alias?.[1] ?? null;
}

export function characterChoiceOptions(
  fieldPath: string,
  snapshot: Record<string, unknown>,
): readonly string[] {
  const path = fieldPath.replace(/\[\d+\]/g, "[]");
  if (path === "heranca") {
    const people = String(snapshot.povo ?? "");
    return forgeCatalog.peoples.find((entry) => entry.name === people)?.heritages ?? [];
  }
  if (path === "trilhas[].papel" || path === "trilhas[].chave") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = forgeCatalog.offices.find((entry) => entry.name === String(trail?.oficio ?? ""));
    return path.endsWith("papel") ? (office?.roles ?? []) : (office?.keys ?? []);
  }
  if (path === "trilhas[].especializacoes") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = forgeCatalog.offices.find((entry) => entry.name === String(trail?.oficio ?? ""));
    return office?.specializations.map((item) => item.name) ?? [];
  }
  if (path === "trilhas[].pericaEscolhida" || path === "trilhas[].tecnicas") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = forgeCatalog.offices.find((entry) => entry.name === String(trail?.oficio ?? ""));
    if (path.endsWith("pericaEscolhida")) return office?.optionalSkills ?? [];
    if (!office) return [];
    return unique([
      office.initialTechnique,
      ...office.techniques,
      ...office.specializations.flatMap((specialization) => specialization.techniques),
      ...forgeCatalog.universalTechniques,
      ...forgeCatalog.magic,
    ]);
  }
  if (path === "equipamento.armadura" || path === "equipamento.extras") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = forgeCatalog.offices.find((entry) => entry.name === String(trail?.oficio ?? ""));
    const proficiencies = office?.proficiencies.toLocaleLowerCase("pt-BR") ?? "";
    if (path === "equipamento.extras") return /escudos/.test(proficiencies) ? ["Escudo"] : [];
    return characterArmorOptionsForOffice(office?.name ?? "").filter((value) =>
      forgeCatalog.armors.includes(value),
    );
  }
  if (path === "trilhas[].vinculosEvocados[].modelo") {
    return forgeCatalog.evocationModels
      .filter((entry) => entry.size === "Menor")
      .map((entry) => entry.name);
  }
  if (path === "trilhas[].knownForms[].formId") return magicFormValues;
  if (path === "equipamento.arma" || path === "equipamento.ferramenta") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = String(trail?.oficio ?? "");
    const options =
      path === "equipamento.arma"
        ? characterWeaponOptionsForOffice(office)
        : characterToolOptionsForOffice(office);
    return options.filter((value) =>
      (path === "equipamento.arma" ? forgeCatalog.weapons : forgeCatalog.tools).includes(value),
    );
  }
  if (path === "pericaLivre") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const trail = trails[Number(snapshot.trilhaAtiva) || 0];
    const office = forgeCatalog.offices.find((entry) => entry.name === String(trail?.oficio ?? ""));
    const trained = new Set([
      ...(office?.skills ?? []).map((entry) => entry.split(";")[0]?.trim() ?? ""),
      String(trail?.pericaEscolhida ?? ""),
    ]);
    return forgeCatalog.skills.filter((skill) => !trained.has(skill));
  }
  if (path === "tecnicaHeranca.oficio") {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const active = trails[Number(snapshot.trilhaAtiva) || 0];
    const mainOffice = String(active?.oficio ?? "");
    return forgeCatalog.offices
      .filter((office) => office.name !== mainOffice)
      .map((office) => office.name);
  }
  if (path === "tecnicaHeranca.nome") {
    const officeName = String(
      (snapshot.tecnicaHeranca as Record<string, unknown> | null)?.oficio ?? "",
    );
    const office = forgeCatalog.offices.find((entry) => entry.name === officeName);
    return office?.initialTechnique ? [office.initialTechnique] : [];
  }
  const entry = CHARACTER_CHOICE_REGISTRY.find(
    (field) =>
      field.field === path ||
      (field.field.endsWith(".*") && path.startsWith(field.field.slice(0, -1))),
  );
  return entry?.canonicalValues ?? [];
}

function resolveFieldFromQuestion(
  question: string,
  snapshot: Record<string, unknown>,
): string | null {
  const normalized = normalize(question);
  const has = (...terms: string[]) => terms.every((term) => normalized.includes(normalize(term)));
  const hasAny = (...terms: string[]) => terms.some((term) => normalized.includes(normalize(term)));
  const people = String(snapshot.povo ?? "");
  if (hasAny("benefício", "beneficio") && hasAny("origem", "outro")) return "origemBeneficio";
  if (has("ofício", "técnica") && hasAny("de qual", "origem", "obter", "Múltiplos Caminhos"))
    return "tecnicaHeranca.oficio";
  if (has("técnica inicial") && hasAny("herança", "múltiplos caminhos"))
    return "tecnicaHeranca.nome";
  if (hasAny("aprendizagem cruzada", "perícia fora do ofício", "perícia de outro ofício"))
    return "pericaLivre";
  if (hasAny("povo", "espécie")) return "povo";
  if (hasAny("herança", "heranca")) return "heranca";
  if (has("ofício") && hasAny("principal", "personagem", "sua personagem", "escolhe"))
    return "trilhas[].oficio";
  if (hasAny("origem", "mundo de criação")) return "origem";
  if (hasAny("papel de ressonância", "papel de ressonancia")) return "trilhas[].papel";
  if (hasAny("papel") && hasAny("trilha", "ofício", "oficio", "ressonância", "ressonancia"))
    return "trilhas[].papel";
  if (hasAny("chave da trilha", "qual chave", "sua chave")) return "trilhas[].chave";
  if (hasAny("perícia escolhida", "segunda perícia", "perícia opcional"))
    return "trilhas[].pericaEscolhida";
  if (hasAny("especialização", "especializacao")) return "trilhas[].especializacoes";
  if (hasAny("técnica", "tecnica") && hasAny("trilha", "ofício", "oficio"))
    return "trilhas[].tecnicas";
  if (hasAny("forma mágica", "forma de magia", "formas conhecidas"))
    return "trilhas[].knownForms[].formId";
  if (hasAny("afinidade")) return people === "Draken" ? `escolhasPovo.${people}.afinidade` : null;
  if (hasAny("módulo", "módulos", "modulo", "modulos"))
    return people === "Nomos" ? `escolhasPovo.${people}.modulos` : null;
  if (hasAny("frequência", "frequencia"))
    return people === "Vitrálios" ? `escolhasPovo.${people}.frequencia` : null;
  if (hasAny("aspecto")) return people === "Teriantes" ? `escolhasPovo.${people}.aspecto` : null;
  if (hasAny("atributos", "distribuição de atributos")) return "atributosBase";
  if (hasAny("perícias", "pericias", "distribuição de perícias")) return "periciasBase";
  if (hasAny("ferramenta", "kit do ofício", "kit do oficio")) return "equipamento.ferramenta";
  if (hasAny("armadura")) return "equipamento.armadura";
  if (hasAny("arma", "foco")) return "equipamento.arma";
  if (hasAny("consumível", "consumíveis", "consumivel", "consumiveis"))
    return "equipamento.consumiveis";
  if (hasAny("escudo")) return "equipamento.extras";
  if (hasAny("modelo", "evocação", "evocacao")) return "trilhas[].vinculosEvocados[].modelo";
  if (hasAny("forma") && hasAny("evocação", "evocacao", "vínculo", "vinculo"))
    return "trilhas[].vinculosEvocados[].forma";
  if (hasAny("porte") && hasAny("evocação", "evocacao", "vínculo", "vinculo"))
    return "trilhas[].vinculosEvocados[].porte";
  if (hasAny("condição", "condicoes", "condições")) return "condicoes";
  if (hasAny("progressão", "progressao", "avanço", "avanco")) return "progressao[].ganho";
  if (hasAny("qualidade")) return "qualidade";
  if (hasAny("nome")) return "nome";
  return null;
}

export type CharacterChoiceCandidate = {
  field: string;
  values: readonly string[];
  ambiguous: boolean;
  incomplete: boolean;
  invalid?: boolean;
  patch?: Record<string, unknown>;
};

export function resolveNumericDistribution(
  field: string,
  text: string,
): CharacterChoiceCandidate | null {
  const names = field === "atributosBase" ? forgeCatalog.attributes : forgeCatalog.skills;
  const values: Record<string, number> = {};
  for (const name of names) {
    const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `(?:\\b${escaped}\\s*(?:(?:vale|fica|com|e)\\s*)?[:=]?\\s*([0-3])\\b|\\b([0-3])\\s+(?:em|para)\\s+${escaped}\\b)`,
        "i",
      ),
    );
    const value = match?.[1] ?? match?.[2];
    if (value !== undefined) values[name] = Number(value);
  }
  const zeroGroup = text.match(
    /([^.;\n]*?)\s+(?:ficam|fica|sao|são)?\s*(?:explicitamente\s*)?(?:em\s*)?0\b/i,
  )?.[1];
  if (zeroGroup) {
    for (const name of names) {
      const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!Object.hasOwn(values, name) && new RegExp(`\\b${escaped}\\b`, "i").test(zeroGroup))
        values[name] = 0;
    }
  }
  const zeroRemainder =
    /\b(?:(?:as|os)\s+)?(?:demais|restantes|outras|outros)\b[\s\S]{0,24}\b0\b/i.test(text) ||
    /\b(?:todas\s+as\s+outras|todos\s+os\s+outros|todo\s+o\s+resto|tudo\s+mais)\b[\s\S]{0,24}\b0\b/i.test(
      text,
    );
  if (zeroRemainder) for (const name of names) if (!Object.hasOwn(values, name)) values[name] = 0;
  if (!Object.keys(values).length) return null;
  const expected = field === "atributosBase" ? 6 : 15;
  const distribution =
    field === "atributosBase" ? INITIAL_ATTRIBUTE_DISTRIBUTION : INITIAL_SKILL_DISTRIBUTION;
  const complete = Object.keys(values).length === expected;
  const matchesRules =
    complete &&
    Object.values(values)
      .sort((a, b) => a - b)
      .join(",") === [...distribution].sort((a, b) => a - b).join(",");
  return {
    field,
    values: Object.keys(values),
    ambiguous: false,
    incomplete: !complete,
    invalid: complete && !matchesRules,
    patch: matchesRules ? { [field]: values } : undefined,
  };
}

export function resolveCharacterChoiceCandidate(
  userText: string,
  previousAssistantMessage: string | undefined,
  snapshot: Record<string, unknown>,
): CharacterChoiceCandidate | null {
  const normalizedText = normalize(userText);
  if (
    !normalizedText ||
    /\b(talvez|exemplo|imagina|e se|seria|poderia|nao sei|nao tenho certeza)\b/.test(normalizedText)
  )
    return null;
  const hasQuestion = /[?¿]/.test(userText);
  const explicitSelection =
    /\b(escolho|escolher|quero|queria|prefiro|vou de|vou querer|sou|fica com|fico com|seleciono|opto por|meu povo e|meu oficio e|minha heranca e)\b/.test(
      normalizedText,
    );
  const explicitCorrection = /\bnao\b/.test(normalizedText);
  if (
    hasQuestion ||
    (!explicitSelection &&
      !explicitCorrection &&
      /\b(fala|explique|explica|descreva|opcoes|opcao|serve|significa|sobre)\b/.test(
        normalizedText,
      ))
  )
    return null;
  const fieldPath =
    resolveFieldFromQuestion(userText, snapshot) ??
    resolveFieldFromQuestion(previousAssistantMessage ?? "", snapshot);
  if (!fieldPath) return null;
  const activeTrailIndex = Math.max(0, Number(snapshot.trilhaAtiva) || 0);
  const resolvedFieldPath = fieldPath.replaceAll("trilhas[]", `trilhas[${activeTrailIndex}]`);
  if (
    resolvedFieldPath.includes("trilhas[") &&
    activeTrailIndex >= (Array.isArray(snapshot.trilhas) ? snapshot.trilhas.length : 0)
  )
    return null;
  const numericField = fieldPath === "atributosBase" || fieldPath === "periciasBase";
  if (numericField) return resolveNumericDistribution(fieldPath, normalizedText);
  const options = characterChoiceOptions(resolvedFieldPath, snapshot);
  const registryPath = resolvedFieldPath.replace(/\[\d+\]/g, "[]");
  const entry = CHARACTER_CHOICE_REGISTRY.find((candidate) => candidate.field === registryPath);
  if (!entry) return null;
  const equivalences = [
    ...entry.canonicalValues.map((canonical) => ({ raw: canonical, canonical })),
    ...Object.entries(entry.aliases ?? {}).map(([raw, canonical]) => ({ raw, canonical })),
  ];
  const negativeValues = unique(
    equivalences
      .filter(({ raw }) => {
        const value = normalize(raw).replace(/\s+/g, "\\s+");
        return (
          new RegExp(`\\bnao\\s+(?:(?:quero|escolho|prefiro)\\s+)?${value}\\b`, "i").test(
            normalizedText,
          ) ||
          new RegExp(`\\b(?:em vez de|ao inves de|no lugar de)\\s+${value}\\b`, "i").test(
            normalizedText,
          )
        );
      })
      .map(({ canonical }) => canonical),
  );
  const affirmedText = negativeValues.length
    ? normalizedText.replace(/\bnao\b/g, " ").replace(/\bnao sei\b/g, " ")
    : normalizedText;
  const mentionedChoices = equivalences.filter(
    ({ raw, canonical }) =>
      !negativeValues.includes(canonical) && ` ${affirmedText} `.includes(` ${normalize(raw)} `),
  );
  const matches = unique(
    mentionedChoices
      .filter(({ canonical }) => options.includes(canonical))
      .map(({ canonical }) => canonical),
  );
  if (!matches.length) {
    const rejected = unique(mentionedChoices.map(({ canonical }) => canonical));
    return rejected.length
      ? {
          field: resolvedFieldPath,
          values: rejected,
          ambiguous: rejected.length > 1,
          incomplete: false,
          invalid: true,
        }
      : null;
  }
  if (resolvedFieldPath === "trilhas" && entry.type === "MULTI_CHOICE")
    return {
      field: resolvedFieldPath,
      values: matches,
      ambiguous: matches.length > 0 && matches.length < 2,
      incomplete: false,
      patch: matches.length >= 2 ? { trilhas: matches.map((oficio) => ({ oficio })) } : undefined,
    };
  if (entry.type === "CLOSED_CHOICE")
    return {
      field: resolvedFieldPath,
      values: matches,
      ambiguous: matches.length > 1,
      incomplete: false,
    };
  const tooFew = entry.minChoices !== undefined && matches.length < entry.minChoices;
  const tooMany = entry.maxChoices !== undefined && matches.length > entry.maxChoices;
  const candidate: CharacterChoiceCandidate = {
    field: resolvedFieldPath,
    values: matches,
    ambiguous: (matches.length > 1 && entry.maxChoices === 1) || tooMany,
    incomplete: tooFew,
  };
  if (
    registryPath === "trilhas[].knownForms[].formId" &&
    !candidate.ambiguous &&
    !candidate.incomplete
  ) {
    const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
    const active = trails[Number(snapshot.trilhaAtiva) || 0] as Record<string, unknown> | undefined;
    const marco = Number(active?.marco ?? 1);
    const trailPatches: Array<Record<string, unknown> | null> = Array(activeTrailIndex + 1).fill(
      null,
    );
    trailPatches[activeTrailIndex] = {
      knownForms: matches.map((formId) => ({ formId, maxGrade: universalMagicGradeMax(marco) })),
    };
    candidate.patch = { trilhas: trailPatches };
  }
  return candidate;
}

export function characterChoiceCandidatePatch(
  candidate: CharacterChoiceCandidate,
): Record<string, unknown> {
  if (candidate.patch) return structuredClone(candidate.patch);
  const value: unknown =
    candidate.values.length === 1 ? candidate.values[0] : [...candidate.values];
  const peopleChoice = candidate.field.match(/^escolhasPovo\.([^.]+)\.(.+)$/);
  if (peopleChoice) return { escolhasPovo: { [peopleChoice[2]]: value } };
  const techniqueHeritage = candidate.field.match(/^tecnicaHeranca\.(oficio|nome)$/);
  if (techniqueHeritage) return { tecnicaHeranca: { [techniqueHeritage[1]]: value } };
  const equipment = candidate.field.match(/^equipamento\.(.+)$/);
  if (equipment) return { equipamento: { [equipment[1]]: value } };
  const trail = candidate.field.match(/^trilhas\[(\d*)\]\.(.+)$/);
  if (trail) {
    const index = Number(trail[1] || 0);
    const trailPatch: Record<string, unknown> = {};
    if (trail[2] === "vinculosEvocados[].modelo") trailPatch.vinculosEvocados = [{ modelo: value }];
    else if (trail[2] === "vinculosEvocados[].forma")
      trailPatch.vinculosEvocados = [{ forma: value }];
    else if (trail[2] === "vinculosEvocados[].porte")
      trailPatch.vinculosEvocados = [{ porte: value }];
    else trailPatch[trail[2]] = value;
    const trails: Array<Record<string, unknown> | null> = Array(index + 1).fill(null);
    trails[index] = trailPatch;
    return { trilhas: trails };
  }
  if (candidate.field === "atributosBase" || candidate.field === "periciasBase") return {};
  return { [candidate.field]: value };
}
