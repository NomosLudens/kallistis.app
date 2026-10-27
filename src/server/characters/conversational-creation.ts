import {
  ATTRIBUTE_NAMES,
  CHARACTER_ORIGINS,
  CHARACTER_PEOPLES,
  INITIAL_ATTRIBUTE_DISTRIBUTION,
  INITIAL_SKILL_DISTRIBUTION,
  SKILL_NAMES,
  buildCharacterSkillProvenance,
  characterOfficeRules,
  mechanicalFingerprint,
  validateCharacterSnapshot,
  validatePartialInitialDistributions,
  validateMagicChoices,
  tecelaoMagicTotals,
  type CharacterSnapshot,
} from "./character-canon";
import { buildCharacterDraft } from "./chat-creation";
import { characterChoiceOptions } from "./character-choice-registry";
import catalog from "./character-forge-choice-catalog.generated.json";

type Pending = { path: string; label: string; value: unknown };
export type PendingCharacterProposal = Pending & {
  sourceText: string;
  dependencies: string[];
  effects: string[];
};
type Progress = {
  status: "in_progress" | "complete";
  pending: Pending | null;
  pendingProposals?: PendingCharacterProposal[];
  confirmedPaths?: string[];
  providerUnavailable?: boolean;
  overridePath?: string;
  targetMarco?: number;
};
type Step = {
  path: string;
  label: string;
  kind: "text" | "choice" | "multi" | "attributes" | "skills" | "yes";
  options?: (s: CharacterSnapshot) => readonly string[];
  min?: number;
  max?: number;
};
const stepList: Step[] = [
  { path: "nome", label: "nome do personagem", kind: "text" },
  { path: "conceito.identidade", label: "identidade do conceito", kind: "text" },
  { path: "conceito.objetivo", label: "objetivo do conceito", kind: "text" },
  { path: "conceito.perda", label: "perda do conceito", kind: "text" },
  { path: "povo", label: "Povo", kind: "choice", options: () => CHARACTER_PEOPLES },
  ...Object.entries(catalog.peopleChoices).flatMap(([people, choices]) =>
    choices.map((choice) => ({
      path: `escolhasPovo.${choice.key}`,
      label: `${choice.key} de ${people}`,
      kind: (choice.max === 1 ? "choice" : "multi") as Step["kind"],
      options: () => choice.values,
      min: choice.min,
      max: choice.max,
    })),
  ),
  { path: "aspectoOutro", label: "descrição do outro Aspecto", kind: "text" },
  {
    path: "heranca",
    label: "Herança",
    kind: "choice",
    options: (s) => characterChoiceOptions("heranca", s),
  },
  { path: "origem", label: "origem", kind: "choice", options: () => CHARACTER_ORIGINS },
  {
    path: "origemBeneficio",
    label: "benefício da origem",
    kind: "choice",
    options: (s) => characterChoiceOptions("origemBeneficio", s),
  },
  { path: "dividaComunitaria", label: "dívida comunitária", kind: "text" },
  { path: "origemTrocado.nascimento", label: "origem Trocado: nascimento", kind: "text" },
  { path: "origemTrocado.criacao", label: "origem Trocado: criação", kind: "text" },
  { path: "origemTrocado.descricao", label: "origem Trocado: descrição", kind: "text" },
  {
    path: "trilhas.0.oficio",
    label: "Ofício",
    kind: "choice",
    options: () => characterChoiceOptions("trilhas[].oficio", {}),
  },
  {
    path: "trilhas.0.papel",
    label: "papel do Ofício",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].papel", s),
  },
  {
    path: "trilhas.0.chave",
    label: "chave do Ofício",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].chave", s),
  },
  {
    path: "trilhas.0.pericaEscolhida",
    label: "perícia opcional do Ofício",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].pericaEscolhida", s),
  },
  { path: "evocacao.nome", label: "nome da Evocação", kind: "text" },
  {
    path: "evocacao.porte",
    label: "porte da Evocação",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].vinculosEvocados[].porte", s),
  },
  {
    path: "evocacao.forma",
    label: "forma da Evocação",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].vinculosEvocados[].forma", s),
  },
  {
    path: "evocacao.modelo",
    label: "modelo da Evocação",
    kind: "choice",
    options: (s) => characterChoiceOptions("trilhas[].vinculosEvocados[].modelo", s),
  },
  { path: "evocacao.aparencia", label: "aparência da Evocação", kind: "text" },
  { path: "evocacao.ancora", label: "âncora da Evocação", kind: "text" },
  { path: "evocacao.impulso", label: "impulso da Evocação", kind: "text" },
  { path: "evocacao.pacto", label: "pacto da Evocação", kind: "text" },
  { path: "evocacao.consciencia", label: "consciência da Evocação", kind: "text" },
  {
    path: "pericaLivre",
    label: "perícia da Aprendizagem Cruzada",
    kind: "choice",
    options: () => SKILL_NAMES,
  },
  {
    path: "tecnicaHeranca.oficio",
    label: "Ofício da técnica de Herança",
    kind: "choice",
    options: (s) => characterChoiceOptions("tecnicaHeranca.oficio", s),
  },
  {
    path: "tecnicaHeranca.nome",
    label: "técnica de Herança",
    kind: "choice",
    options: (s) => characterChoiceOptions("tecnicaHeranca.nome", s),
  },
  {
    path: "trilhas.0.knownForms",
    label: "formas conhecidas do Tecelão",
    kind: "multi",
    options: (s) => characterChoiceOptions("trilhas[].knownForms[].formId", s),
    min: tecelaoMagicTotals(1),
    max: tecelaoMagicTotals(1),
  },
  { path: "atributosBase", label: "distribuição de atributos", kind: "attributes" },
  { path: "periciasBase", label: "distribuição de perícias", kind: "skills" },
  {
    path: "equipamento.arma",
    label: "arma",
    kind: "choice",
    options: (s) => characterChoiceOptions("equipamento.arma", s),
  },
  {
    path: "equipamento.proficienciaConfirmada",
    label: "confirmação de proficiência da arma",
    kind: "yes",
  },
  {
    path: "equipamento.armadura",
    label: "armadura",
    kind: "choice",
    options: (s) => characterChoiceOptions("equipamento.armadura", s),
  },
  {
    path: "equipamento.ferramenta",
    label: "ferramenta",
    kind: "choice",
    options: (s) => characterChoiceOptions("equipamento.ferramenta", s),
  },
  {
    path: "equipamento.consumiveis",
    label: "dois consumíveis",
    kind: "multi",
    options: () => catalog.consumables,
    min: 2,
    max: 2,
  },
  { path: "vinculos.0", label: "primeiro vínculo", kind: "text" },
  { path: "vinculos.1", label: "segundo vínculo", kind: "text" },
  { path: "vinculos.2", label: "terceiro vínculo", kind: "text" },
  { path: "promessa", label: "promessa", kind: "text" },
  { path: "ferida", label: "ferida", kind: "text" },
  { path: "pergunta", label: "pergunta central", kind: "text" },
];
export const CREATION_PROPOSAL_PATHS = stepList.map((step) => step.path) as [string, ...string[]];
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function progressOf(s: CharacterSnapshot): Progress {
  const p = obj(s.serverCreationProgress);
  return {
    status: p.status === "complete" ? "complete" : "in_progress",
    pending: (p.pending as Pending | null) ?? null,
    pendingProposals: Array.isArray(p.pendingProposals)
      ? (p.pendingProposals as PendingCharacterProposal[])
      : [],
    confirmedPaths: Array.isArray(p.confirmedPaths)
      ? p.confirmedPaths.filter((path): path is string => typeof path === "string")
      : [],
    providerUnavailable: p.providerUnavailable === true,
    ...(typeof p.overridePath === "string" ? { overridePath: p.overridePath } : {}),
    targetMarco:
      Number.isInteger(p.targetMarco) && Number(p.targetMarco) >= 1 && Number(p.targetMarco) <= 4
        ? Number(p.targetMarco)
        : 1,
  };
}
function storeProgress(s: CharacterSnapshot, p: Progress) {
  s.serverCreationProgress = p;
}
export function hasConversationalCreationProgress(snapshot: CharacterSnapshot) {
  return Boolean(
    snapshot.serverCreationProgress && typeof snapshot.serverCreationProgress === "object",
  );
}
export function setCreationTargetMarco(input: CharacterSnapshot, targetMarco: number) {
  if (!Number.isInteger(targetMarco) || targetMarco < 1 || targetMarco > 4)
    throw new Error("invalid_request");
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  progress.targetMarco = targetMarco;
  storeProgress(snapshot, progress);
  return snapshot;
}
function get(s: CharacterSnapshot, path: string): unknown {
  if (path.startsWith("evocacao.")) {
    const trail = obj(Array.isArray(s.trilhas) ? s.trilhas[0] : null);
    const evocation = Array.isArray(trail.vinculosEvocados) ? trail.vinculosEvocados[0] : null;
    return obj(evocation)[path.slice("evocacao.".length)];
  }
  if (path === "trilhas.0.knownForms")
    return obj((Array.isArray(s.trilhas) ? s.trilhas[0] : null) as unknown).knownForms;
  if (path.startsWith("vinculos."))
    return (Array.isArray(s.vinculos) ? s.vinculos[Number(path.slice(-1))] : undefined) ?? "";
  const parts = path.split(".");
  return parts.reduce<unknown>((cur, part, index) => {
    if (part === "trilhas") return obj(cur).trilhas;
    if (parts[index - 1] === "trilhas" && part === "0")
      return Array.isArray(cur) ? cur[0] : undefined;
    return obj(cur)[part];
  }, s);
}
function set(s: CharacterSnapshot, path: string, value: unknown) {
  if (path.startsWith("vinculos.")) {
    const a = Array.isArray(s.vinculos) ? [...s.vinculos] : [];
    a[Number(path.slice(-1))] = value;
    s.vinculos = a;
    return;
  }
  const parts = path.split(".");
  let cur: Record<string, unknown> = s;
  for (const part of parts.slice(0, -1)) {
    if (part === "trilhas") {
      cur = (cur.trilhas as Record<string, unknown>[])[0]!;
      continue;
    }
    if (parts[parts.indexOf(part) - 1] === "trilhas" && part === "0") continue;
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts.at(-1)!] = value;
}
function stepsFor(s: CharacterSnapshot): Step[] {
  const office = String(obj((s.trilhas as unknown[])[0]).oficio ?? ""),
    povo = String(s.povo ?? ""),
    heranca = String(s.heranca ?? ""),
    origem = String(s.origem ?? "");
  return stepList.filter((x) => {
    if (x.path.startsWith("escolhasPovo."))
      return (
        (catalog.peopleChoices as Record<string, Array<{ key: string }>>)[povo]?.some(
          (choice) => x.path === `escolhasPovo.${choice.key}`,
        ) ?? false
      );
    if (x.path === "aspectoOutro")
      return (
        povo === "Teriantes" &&
        String(obj(s.escolhasPovo).aspecto ?? "").startsWith("Outro Aspecto")
      );
    if (x.path === "origemBeneficio" || x.path === "dividaComunitaria") return origem === "Outro";
    if (x.path.startsWith("origemTrocado.")) return origem === "Trocado";
    if (x.path === "pericaLivre") return povo === "Livres";
    if (x.path.startsWith("tecnicaHeranca."))
      return povo === "Livres" && heranca === "Múltiplos Caminhos";
    if (x.path.startsWith("evocacao.")) return office === "Evocador";
    if (x.path === "trilhas.0.knownForms") return office === "Tecelão";
    if (x.path === "trilhas.0.pericaEscolhida")
      return Boolean(characterOfficeRules(office)?.optionalSkills.length);
    return true;
  });
}
const setValue = (v: unknown) =>
  Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
function stepComplete(step: Step, s: CharacterSnapshot) {
  const value = get(s, step.path);
  if (step.kind === "multi")
    return (
      Array.isArray(value) &&
      value.length >= (step.min ?? 1) &&
      (step.path === "trilhas.0.knownForms" || value.length <= (step.max ?? Infinity))
    );
  if (step.path === "equipamento.proficienciaConfirmada") return value === true;
  if (step.kind === "attributes" || step.kind === "skills") {
    const names = step.kind === "attributes" ? ATTRIBUTE_NAMES : SKILL_NAMES;
    const pool =
      step.kind === "attributes" ? INITIAL_ATTRIBUTE_DISTRIBUTION : INITIAL_SKILL_DISTRIBUTION;
    const values = obj(value);
    return (
      Object.keys(values).length === names.length &&
      names.every((name) => Number.isInteger(values[name])) &&
      JSON.stringify(Object.values(values).sort((a, b) => Number(a) - Number(b))) ===
        JSON.stringify([...pool].sort((a, b) => a - b))
    );
  }
  return setValue(value);
}
function stepFor(s: CharacterSnapshot, p: Progress) {
  return p.overridePath
    ? (stepsFor(s).find((x) => x.path === p.overridePath) ?? null)
    : (stepsFor(s).find((x) => !stepComplete(x, s)) ?? null);
}
function prompt(step: Step, s: CharacterSnapshot) {
  if (step.kind === "attributes")
    return (
      "Distribua os atributos na ordem " +
      ATTRIBUTE_NAMES.join(", ") +
      ". Use exatamente o conjunto " +
      INITIAL_ATTRIBUTE_DISTRIBUTION.join(", ") +
      " e nomeie cada atributo."
    );
  if (step.kind === "skills")
    return (
      "Distribua as perícias na ordem " +
      SKILL_NAMES.join(", ") +
      ". Use exatamente o conjunto " +
      INITIAL_SKILL_DISTRIBUTION.join(", ") +
      " e nomeie cada perícia."
    );
  if (step.path === "equipamento.consumiveis")
    return (
      "Quais são os dois consumíveis? Opções canônicas: " +
      (step.options?.(s) ?? []).join(", ") +
      "."
    );
  if (step.path === "trilhas.0.knownForms")
    return (
      "Escolha " +
      step.min +
      " forma(s) canônica(s) pelo identificador: " +
      (step.options?.(s) ?? [])
        .map((id) => {
          const form = catalog.magicForms.find((item) => item.id === id);
          return id + (form ? " (" + form.canonicalName + ")" : "");
        })
        .join(", ") +
      "."
    );
  if (step.kind === "yes")
    return "Você confirma que a arma escolhida é compatível com a proficiência deste Ofício? Responda sim ou não.";
  const options = step.options?.(s) ?? [];
  return (
    "Qual é " +
    step.label +
    "?" +
    (options.length ? " Opções canônicas: " + options.join(", ") + "." : "")
  );
}
function distribution(step: Step, text: string): Record<string, number> | null {
  const names = step.kind === "attributes" ? ATTRIBUTE_NAMES : SKILL_NAMES;
  const pool =
    step.kind === "attributes" ? INITIAL_ATTRIBUTE_DISTRIBUTION : INITIAL_SKILL_DISTRIBUTION;
  const source = norm(text),
    out: Record<string, number> = {};
  for (const name of names) {
    const escaped = norm(name);
    const m = source.match(
      new RegExp(
        "(?:\\b" +
          escaped +
          "\\s*(?:vale|fica|com|e)?\\s*[:=]?\\s*([0-3])\\b|\\b([0-3])\\s+(?:em|para)\\s+" +
          escaped +
          "\\b)",
        "i",
      ),
    );
    if (m) out[name] = Number(m[1] ?? m[2]);
  }
  if (Object.keys(out).length !== names.length) return null;
  return JSON.stringify(Object.values(out).sort((a, b) => a - b)) ===
    JSON.stringify([...pool].sort((a, b) => a - b))
    ? out
    : null;
}
function parse(
  step: Step,
  text: string,
  s: CharacterSnapshot,
): { value?: unknown; error?: string } {
  const raw = text
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
  if (step.kind === "text") {
    if (step.path === "biografia" && /^(pular|sem biografia)$/i.test(raw)) return { value: "" };
    return raw.length >= 2 && raw.length <= 2500
      ? { value: raw }
      : { error: "Escreva uma resposta entre 2 e 2500 caracteres." };
  }
  if (step.kind === "yes")
    return /^(sim|confirmo)$/i.test(raw)
      ? { value: true }
      : { error: "Responda sim para confirmar a proficiência." };
  if (step.kind === "attributes" || step.kind === "skills")
    return {
      value: distribution(step, raw),
      ...(distribution(step, raw)
        ? {}
        : {
            error:
              "Distribuição inválida. Informe todos os campos com os valores canônicos indicados.",
          }),
    };
  const options = step.options?.(s) ?? [];
  if (step.kind === "multi") {
    const tokens = norm(raw)
      .split(/\s*(?:,|;|\be\b|\band\b)\s*/)
      .map((token) => token.replace(/^(?:quero|escolho|prefiro)\s+/, ""));
    const selected = options.filter((x) =>
      tokens.some(
        (token) =>
          token === norm(x) ||
          (step.path === "trilhas.0.knownForms" &&
            token === norm(catalog.magicForms.find((form) => form.id === x)?.canonicalName ?? "")),
      ),
    );
    if (selected.length !== step.min || new Set(selected).size !== selected.length)
      return {
        error: "Escolha exatamente " + step.min + " opções canônicas: " + options.join(", ") + ".",
      };
    return { value: selected };
  }
  const source = norm(raw);
  const matches = options.filter((option) => {
    const term = norm(option);
    let index = source.indexOf(term);
    while (index >= 0) {
      const beforeChar = source[index - 1] ?? " ";
      const afterChar = source[index + term.length] ?? " ";
      const bounded = !/[\p{L}\p{N}]/u.test(beforeChar) && !/[\p{L}\p{N}]/u.test(afterChar);
      if (bounded) {
        const before = source.slice(Math.max(0, index - 30), index);
        if (!/(?:^|\b)(?:nao|em vez de|no lugar de)(?:\s+[\p{L}\p{N}]+){0,2}\s*$/u.test(before))
          return true;
      }
      index = source.indexOf(term, index + 1);
    }
    return false;
  });
  if (matches.length === 1) return { value: matches[0] };
  return {
    error:
      matches.length > 1
        ? "Encontrei mais de uma opção possível para " +
          step.label +
          ". Escolha uma só: " +
          options.join(", ") +
          "."
        : "Essa opção não é canônica para " +
          step.label +
          ". Opções válidas: " +
          options.join(", ") +
          ".",
  };
}
function apply(s: CharacterSnapshot, path: string, value: unknown) {
  if (path === "trilhas.0.knownForms") {
    obj((s.trilhas as unknown[])[0]).knownForms = (value as string[]).map((formId) => ({
      formId,
      maxGrade: 0,
    }));
    return;
  }
  if (path.startsWith("evocacao.")) {
    const trail = obj((s.trilhas as unknown[])[0]);
    const items = Array.isArray(trail.vinculosEvocados) ? [...trail.vinculosEvocados] : [];
    const evocacao = obj(items[0]);
    const field = path.slice("evocacao.".length);
    evocacao[field] = value;
    items[0] = evocacao;
    trail.vinculosEvocados = items;
    return;
  }
  set(s, path, value);
  if (path === "trilhas.0.oficio") {
    const t = obj((s.trilhas as unknown[])[0]),
      rules = characterOfficeRules(String(value));
    t.tecnicas = rules?.initialTechnique ? [rules.initialTechnique] : [];
    t.pericias = [...(rules?.fixedSkills ?? [])];
    t.papel = "";
    t.chave = "";
    t.pericaEscolhida = "";
    t.knownForms = [];
    t.vinculosEvocados = [];
    const eq = obj(s.equipamento);
    eq.arma = "";
    eq.armadura = "";
    eq.ferramenta = "";
    eq.proficienciaConfirmada = false;
  }
  if (path === "povo") {
    s.heranca = "";
    s.escolhasPovo = {};
    s.aspectoOutro = "";
    s.pericaLivre = "";
    s.tecnicaHeranca = null;
  }
  if (path === "heranca")
    s.tecnicaHeranca = value === "Múltiplos Caminhos" ? { oficio: "", nome: "" } : null;
  if (path === "origem") {
    s.origemBeneficio = "";
    s.dividaComunitaria = "";
    s.origemTrocado = { nascimento: "", criacao: "", descricao: "" };
  }
  if (path === "equipamento.arma") obj(s.equipamento).proficienciaConfirmada = false;
}
function confirm(text: string) {
  return /^(sim|confirmo|confirmar|está certo|esta certo|pode salvar|pode criar)[.! ]*$/i.test(
    text.trim(),
  );
}
function display(v: unknown) {
  return Array.isArray(v)
    ? v.join(", ")
    : typeof v === "object" && v
      ? JSON.stringify(v)
      : String(v);
}
function correctionPath(text: string, s: CharacterSnapshot) {
  const n = norm(text),
    map: Array<[string, string]> = [
      ["nome", "nome"],
      ["conceito.identidade", "identidade"],
      ["conceito.objetivo", "objetivo"],
      ["conceito.perda", "perda"],
      ["povo", "povo"],
      ["heranca", "heranca"],
      ["origem", "origem"],
      ["trilhas.0.oficio", "oficio"],
      ["trilhas.0.papel", "papel"],
      ["trilhas.0.chave", "chave"],
      ["atributosBase", "atributos"],
      ["periciasBase", "pericias"],
      ["equipamento.arma", "arma"],
      ["equipamento.armadura", "armadura"],
      ["equipamento.ferramenta", "ferramenta"],
      ["equipamento.consumiveis", "consumiveis"],
      ["promessa", "promessa"],
      ["ferida", "ferida"],
      ["pergunta", "pergunta"],
    ];
  return (
    map.find(
      ([path, hint]) => n.includes(norm(hint)) && stepsFor(s).some((x) => x.path === path),
    )?.[0] ?? null
  );
}
function validatePartial(s: CharacterSnapshot) {
  const baseline = new Set(
    validateCharacterSnapshot(buildCharacterDraft("", "", ""), false).errors,
  );
  return [
    ...new Set([
      ...validatePartialInitialDistributions(s),
      ...validateMagicChoices(s, false),
      ...validateCharacterSnapshot(s, false).errors.filter((x) => !baseline.has(x)),
    ]),
  ];
}
function finalize(s: CharacterSnapshot) {
  s.completo = true;
  s.periciasProveniencia = buildCharacterSkillProvenance(s);
  const result = validateCharacterSnapshot(s, true);
  if (!result.ok) s.completo = false;
  return result.errors;
}
export function startConversationalCreation(
  userName: string,
  firstMessage: string,
  targetMarco = 1,
) {
  const snapshot = buildCharacterDraft("", "", "", "", userName),
    p: Progress = {
      status: "in_progress",
      pending: null,
      pendingProposals: [],
      confirmedPaths: [],
      providerUnavailable: false,
      targetMarco,
    };
  storeProgress(snapshot, p);
  return {
    snapshot,
    reply:
      "Vamos criar sua personagem por conversa. Cada decisão será validada e salva progressivamente. " +
      prompt(stepList[0]!, snapshot),
    userMessage: firstMessage.trim().slice(0, 12000),
    fingerprint: mechanicalFingerprint(snapshot),
  };
}

export function creationOptionsForSnapshot(snapshot: CharacterSnapshot) {
  return stepsFor(snapshot).map((step) => ({
    path: step.path,
    label: step.label,
    kind: step.kind,
    options: step.options?.(snapshot) ?? [],
    min: step.min,
    max: step.max,
  }));
}

export function creationConversationState(snapshot: CharacterSnapshot) {
  const progress = progressOf(snapshot);
  const steps = stepsFor(snapshot);
  const complete = steps.filter((step) => stepComplete(step, snapshot)).length;
  const next = stepFor(snapshot, progress);
  return {
    pending: progress.pendingProposals?.length
      ? progress.pendingProposals
      : progress.pending
        ? [{ ...progress.pending, sourceText: "", dependencies: [], effects: [] }]
        : [],
    providerUnavailable: progress.providerUnavailable === true,
    targetMarco: progress.targetMarco ?? 1,
    confirmedPaths: progress.confirmedPaths ?? [],
    confirmed: (progress.confirmedPaths ?? []).map((path) => ({
      path,
      label: stepList.find((step) => step.path === path)?.label ?? path,
      value: get(snapshot, path),
    })),
    nextOptions: next
      ? {
          path: next.path,
          label: next.label,
          kind: next.kind,
          options: next.options?.(snapshot) ?? [],
          names:
            next.kind === "attributes"
              ? ATTRIBUTE_NAMES
              : next.kind === "skills"
                ? SKILL_NAMES
                : [],
          pool:
            next.kind === "attributes"
              ? INITIAL_ATTRIBUTE_DISTRIBUTION
              : next.kind === "skills"
                ? INITIAL_SKILL_DISTRIBUTION
                : [],
          min: next.min,
          max: next.max,
        }
      : null,
    progress: { complete, total: steps.length },
  };
}

const dependencyLabels: Record<string, string[]> = {
  heranca: ["Povo"],
  origemBeneficio: ["Origem Outro"],
  dividaComunitaria: ["Origem Outro"],
  "origemTrocado.nascimento": ["Origem Trocado"],
  "origemTrocado.criacao": ["Origem Trocado"],
  "origemTrocado.descricao": ["Origem Trocado"],
  "trilhas.0.papel": ["Ofício"],
  "trilhas.0.chave": ["Ofício"],
  "trilhas.0.pericaEscolhida": ["Ofício"],
  "trilhas.0.knownForms": ["Ofício Tecelão"],
  "evocacao.nome": ["Ofício Evocador"],
  "evocacao.porte": ["Ofício Evocador"],
  "evocacao.forma": ["Ofício Evocador"],
  "evocacao.modelo": ["Ofício Evocador"],
  "evocacao.aparencia": ["Ofício Evocador"],
  "evocacao.ancora": ["Ofício Evocador"],
  "evocacao.impulso": ["Ofício Evocador"],
  "evocacao.pacto": ["Ofício Evocador"],
  "evocacao.consciencia": ["Ofício Evocador"],
  pericaLivre: ["Povo Livres"],
  "tecnicaHeranca.oficio": ["Povo Livres", "Herança Múltiplos Caminhos"],
  "tecnicaHeranca.nome": ["Povo Livres", "Herança Múltiplos Caminhos", "Ofício da técnica"],
  "equipamento.arma": ["Ofício"],
  "equipamento.proficienciaConfirmada": ["Arma", "Ofício"],
  "equipamento.armadura": ["Ofício"],
  "equipamento.ferramenta": ["Ofício"],
  "equipamento.consumiveis": ["Ofício"],
};
const sideEffectPaths = [
  "heranca",
  "origemBeneficio",
  "dividaComunitaria",
  "origemTrocado.nascimento",
  "origemTrocado.criacao",
  "origemTrocado.descricao",
  "pericaLivre",
  "tecnicaHeranca.oficio",
  "tecnicaHeranca.nome",
  "trilhas.0.oficio",
  "trilhas.0.papel",
  "trilhas.0.chave",
  "trilhas.0.pericaEscolhida",
  "trilhas.0.knownForms",
  "evocacao.nome",
  "evocacao.porte",
  "evocacao.forma",
  "evocacao.modelo",
  "evocacao.aparencia",
  "evocacao.ancora",
  "evocacao.impulso",
  "evocacao.pacto",
  "evocacao.consciencia",
  "equipamento.arma",
  "equipamento.armadura",
  "equipamento.ferramenta",
  "equipamento.proficienciaConfirmada",
];
function changedValue(before: CharacterSnapshot, after: CharacterSnapshot, path: string) {
  const left = get(before, path);
  const right = get(after, path);
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}
function isPopulated(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}
function proposalDependencies(path: string) {
  return dependencyLabels[path] ?? [];
}
function validateProposedValue(snapshot: CharacterSnapshot, path: string, value: unknown) {
  const step = stepList.find((item) => item.path === path);
  if (!step || !stepsFor(snapshot).some((item) => item.path === path))
    return { ok: false, error: "campo indisponível para as escolhas atuais" };
  if (step.kind === "text") {
    if (typeof value !== "string") return { ok: false, error: "texto esperado" };
    const parsed = parse(step, value, snapshot);
    return parsed.error ? { ok: false, error: parsed.error } : { ok: true };
  }
  if (step.kind === "yes")
    return value === true
      ? { ok: true }
      : { ok: false, error: "proficiência precisa ser confirmada pela pessoa jogadora" };
  if (step.kind === "attributes" || step.kind === "skills") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ok: false, error: "distribuição estruturada esperada" };
    const names = step.kind === "attributes" ? ATTRIBUTE_NAMES : SKILL_NAMES;
    const pool =
      step.kind === "attributes" ? INITIAL_ATTRIBUTE_DISTRIBUTION : INITIAL_SKILL_DISTRIBUTION;
    const record = value as Record<string, unknown>;
    const values = Object.values(record);
    return Object.keys(record).length === names.length &&
      names.every((name) => Number.isInteger(record[name])) &&
      JSON.stringify(values.sort((a, b) => Number(a) - Number(b))) ===
        JSON.stringify([...pool].sort((a, b) => a - b))
      ? { ok: true }
      : { ok: false, error: "distribuição fora do conjunto canônico" };
  }
  const options = step.options?.(snapshot) ?? [];
  if (step.kind === "multi") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      return { ok: false, error: "lista de escolhas esperada" };
    const selected = value as string[];
    return selected.length === step.min &&
      new Set(selected).size === selected.length &&
      selected.every((item) => options.includes(item))
      ? { ok: true }
      : { ok: false, error: "opções múltiplas não correspondem ao catálogo canônico" };
  }
  if (typeof value !== "string") return { ok: false, error: "opção canônica em texto esperada" };
  const parsed = parse(step, value, snapshot);
  return parsed.error || parsed.value !== value
    ? { ok: false, error: parsed.error ?? "opção não canônica" }
    : { ok: true };
}

export function stageNarrativeCreationProposals(
  input: CharacterSnapshot,
  proposals: Array<{ path: string; value: unknown; sourceText: string }>,
  userMessages: string[],
) {
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  const existing =
    progress.pendingProposals ??
    (progress.pending
      ? [{ ...progress.pending, sourceText: "", dependencies: [], effects: [] }]
      : []);
  const merged = new Map(existing.map((proposal) => [proposal.path, proposal]));
  const candidate = structuredClone(snapshot);
  for (const proposal of [...existing].sort(
    (a, b) =>
      stepList.findIndex((s) => s.path === a.path) - stepList.findIndex((s) => s.path === b.path),
  )) {
    const checked = validateProposedValue(candidate, proposal.path, proposal.value);
    if (!checked.ok)
      return {
        ok: false as const,
        error:
          "A proposta pendente para " +
          proposal.label +
          " precisa ser revisada após uma mudança dependente: " +
          checked.error +
          ".",
      };
    apply(candidate, proposal.path, proposal.value);
  }
  for (const proposal of [...proposals].sort(
    (a, b) =>
      stepList.findIndex((s) => s.path === a.path) - stepList.findIndex((s) => s.path === b.path),
  )) {
    const quote = norm(proposal.sourceText);
    const grounded =
      Boolean(quote) && userMessages.some((message) => norm(message).includes(quote));
    if (!grounded)
      return {
        ok: false as const,
        error:
          "Não consegui ligar uma sugestão a uma frase sua. Explique ou escolha explicitamente o que deseja.",
      };
    const checked = validateProposedValue(candidate, proposal.path, proposal.value);
    if (!checked.ok)
      return {
        ok: false as const,
        error:
          "A proposta para " +
          (stepList.find((s) => s.path === proposal.path)?.label ?? proposal.path) +
          " não passou pela validação canônica: " +
          checked.error +
          ".",
      };
    apply(candidate, proposal.path, proposal.value);
    merged.set(proposal.path, {
      path: proposal.path,
      label: stepList.find((s) => s.path === proposal.path)!.label,
      value: proposal.value,
      sourceText: proposal.sourceText,
      dependencies: proposalDependencies(proposal.path),
      effects: [],
    });
  }
  const errors = validatePartial(candidate);
  if (errors.length)
    return {
      ok: false as const,
      error: "A proposta não passou pela validação canônica: " + errors.join(", ") + ".",
    };
  const paths = new Set([...merged.keys()]);
  const effects = sideEffectPaths
    .filter(
      (path) =>
        !paths.has(path) &&
        changedValue(snapshot, candidate, path) &&
        isPopulated(get(snapshot, path)),
    )
    .map(
      (path) =>
        "A escolha " +
        (stepList.find((s) => s.path === path)?.label ?? path) +
        " será removida porque depende de uma escolha alterada.",
    );
  const pending = [...merged.values()].map((proposal) => ({
    ...proposal,
    effects: proposal.effects,
  }));
  if (effects.length && pending.length) pending[0] = { ...pending[0]!, effects };
  progress.pending = null;
  progress.pendingProposals = pending;
  progress.providerUnavailable = false;
  storeProgress(snapshot, progress);
  return { ok: true as const, snapshot, pending, effects };
}

export function confirmNarrativeCreationProposals(input: CharacterSnapshot) {
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  const pending = progress.pendingProposals?.length
    ? progress.pendingProposals
    : progress.pending
      ? [{ ...progress.pending, sourceText: "", dependencies: [], effects: [] }]
      : [];
  if (!pending.length) return { ok: false as const, error: "Não há propostas para confirmar." };
  const candidate = structuredClone(snapshot);
  const current = progress;
  for (const proposal of [...pending].sort(
    (a, b) =>
      stepList.findIndex((s) => s.path === a.path) - stepList.findIndex((s) => s.path === b.path),
  )) {
    const checked = validateProposedValue(candidate, proposal.path, proposal.value);
    if (!checked.ok)
      return {
        ok: false as const,
        error: "A confirmação foi recusada pela validação canônica: " + checked.error + ".",
      };
    apply(candidate, proposal.path, proposal.value);
  }
  const errors = validatePartial(candidate);
  if (errors.length)
    return { ok: false as const, error: "A confirmação foi recusada: " + errors.join(", ") + "." };
  current.pending = null;
  current.pendingProposals = [];
  current.providerUnavailable = false;
  current.confirmedPaths = [
    ...new Set([...(current.confirmedPaths ?? []), ...pending.map((proposal) => proposal.path)]),
  ];
  current.confirmedPaths = current.confirmedPaths.filter(
    (path) => !sideEffectPaths.includes(path) || isPopulated(get(candidate, path)),
  );
  current.overridePath = undefined;
  const next = stepFor(candidate, current);
  let completed = false;
  if (!next) {
    const finalErrors = finalize(candidate);
    if (finalErrors.length)
      return {
        ok: false as const,
        error: "A ficha ainda precisa de ajustes canônicos: " + finalErrors.join(", ") + ".",
      };
    current.status = "complete";
    completed = true;
  }
  storeProgress(candidate, current);
  return {
    ok: true as const,
    snapshot: candidate,
    completed,
    saved: pending.map(({ path, label, value }) => ({ path, label, value })),
    next: next ? prompt(next, candidate) : null,
    fingerprint: mechanicalFingerprint(candidate),
  };
}

export function cancelNarrativeCreationProposals(input: CharacterSnapshot) {
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  progress.pending = null;
  progress.pendingProposals = [];
  progress.providerUnavailable = false;
  storeProgress(snapshot, progress);
  return snapshot;
}

export function markCreationProviderUnavailable(input: CharacterSnapshot) {
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  progress.providerUnavailable = true;
  storeProgress(snapshot, progress);
  return snapshot;
}
export function markCreationProviderAvailable(input: CharacterSnapshot) {
  const snapshot = structuredClone(input);
  const progress = progressOf(snapshot);
  progress.providerUnavailable = false;
  storeProgress(snapshot, progress);
  return snapshot;
}
export function processConversationalCreationTurn(input: CharacterSnapshot, message: string) {
  const s = structuredClone(input),
    p = progressOf(s),
    text = message.trim().slice(0, 12000);
  if (!text) throw new Error("empty_message");
  if (p.status === "complete") throw new Error("creation_already_complete");
  if (p.pending && /^(quero outra opção|outra opção|mudei de ideia|não|nao)[.! ]*$/i.test(text)) {
    const current = p.pending.path;
    p.pending = null;
    const step = stepsFor(s).find((x) => x.path === current) ?? stepFor(s, p);
    storeProgress(s, p);
    return {
      snapshot: s,
      reply: step ? "Tudo bem. " + prompt(step, s) : "Qual escolha quer rever?",
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  }
  if (p.pending && /^(mudei de ideia|troquei|na verdade|quero mudar)\b/i.test(text)) {
    const pendingStep = stepsFor(s).find((x) => x.path === p.pending?.path);
    if (pendingStep) {
      const raw = text.replace(
        /^(mudei de ideia|troquei|na verdade|quero mudar)(?:\s+(?:para|por))?\s*/i,
        "",
      );
      const parsed = parse(pendingStep, raw, s);
      if (parsed.value !== undefined && !parsed.error) {
        p.pending = { path: pendingStep.path, label: pendingStep.label, value: parsed.value };
        storeProgress(s, p);
        return {
          snapshot: s,
          reply:
            "Entendi a mudança. Você confirma " +
            pendingStep.label +
            ": " +
            display(parsed.value) +
            "? Diga “confirmo” para registrar.",
          completed: false,
          fingerprint: mechanicalFingerprint(s),
        };
      }
    }
  }
  if (p.pending && confirm(text)) {
    const pending = p.pending,
      before = structuredClone(s);
    apply(s, pending.path, pending.value);
    const errors = validatePartial(s);
    if (errors.length) {
      Object.assign(s, before);
      p.pending = null;
      storeProgress(s, p);
      return {
        snapshot: s,
        reply: "Não salvei a escolha; a validação canônica rejeitou: " + errors.join(", ") + ".",
        completed: false,
        fingerprint: mechanicalFingerprint(s),
      };
    }
    p.pending = null;
    p.overridePath = undefined;
    const next = stepFor(s, p);
    if (!next) {
      const finalErrors = finalize(s);
      if (finalErrors.length) {
        storeProgress(s, p);
        return {
          snapshot: s,
          reply: "A ficha ainda não está pronta para concluir: " + finalErrors.join(", ") + ".",
          completed: false,
          fingerprint: mechanicalFingerprint(s),
        };
      }
      p.status = "complete";
      storeProgress(s, p);
      return {
        snapshot: s,
        reply:
          "Ficha completa, validada e salva como rascunho, pronta para revisão e envio ao Mestre.",
        completed: true,
        fingerprint: mechanicalFingerprint(s),
      };
    }
    storeProgress(s, p);
    return {
      snapshot: s,
      reply: "Registrado: " + pending.label + ". " + prompt(next, s),
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  }
  if (p.pending)
    return {
      snapshot: s,
      reply:
        "Ainda está pendente confirmar " +
        p.pending.label +
        ": " +
        display(p.pending.value) +
        ". Diga “confirmo”, “mudei de ideia” ou “quero outra opção”.",
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  const correction = /mudei de ideia|quero mudar|trocar/i.test(text)
    ? correctionPath(text, s)
    : null;
  if (/mudei de ideia|quero mudar|trocar/i.test(text) && !correction)
    return {
      snapshot: s,
      reply: "Qual escolha quer mudar? Diga o campo, por exemplo: “mudei de ideia sobre o Povo”.",
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  const step = correction ? stepsFor(s).find((x) => x.path === correction) : stepFor(s, p);
  if (!step)
    return {
      snapshot: s,
      reply: "Não encontrei campo pendente. Indique qual escolha anterior quer revisar.",
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  const raw = correction
    ? (text.match(/\b(?:para|por)\s+(.+)$/i)?.[1] ??
      text.replace(/^(mudei de ideia|quero mudar|trocar)(?:\s+(?:o|a|para|sobre))?\s*/i, ""))
    : text;
  const parsed = parse(step, raw, s);
  if (parsed.error || parsed.value === undefined)
    return {
      snapshot: s,
      reply: (parsed.error ?? "Não reconheci a resposta.") + " " + prompt(step, s),
      completed: false,
      fingerprint: mechanicalFingerprint(s),
    };
  p.overridePath = correction ?? undefined;
  p.pending = { path: step.path, label: step.label, value: parsed.value };
  storeProgress(s, p);
  return {
    snapshot: s,
    reply:
      "Você escolheu " +
      display(parsed.value) +
      " para " +
      step.label +
      ". Diga “confirmo” para salvar.",
    completed: false,
    fingerprint: mechanicalFingerprint(s),
  };
}
