import {
  SKILL_NAMES,
  activeMarco,
  buildCharacterSkillProvenance,
  progressionGainIdsForSnapshot,
  tecelaoMagicTotals,
  universalMagicCap,
  universalMagicGradeMax,
  validateProgressionSnapshot,
  type CharacterSnapshot,
} from "./character-canon";
import catalog from "./character-forge-choice-catalog.generated.json";

type Step = {
  id: string;
  label: string;
  kind: "choice" | "multi";
  options: string[];
  min?: number;
  max?: number;
};
type SelectionState = { fromMarco: number; values: Record<string, unknown> };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const activeTrail = (snapshot: CharacterSnapshot) =>
  object(
    (Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [])[Number(snapshot.trilhaAtiva) || 0],
  );
const selectionState = (snapshot: CharacterSnapshot): SelectionState => {
  const raw = object(object(snapshot.serverCreationProgress).progressionSelections);
  const fromMarco = activeMarco(snapshot);
  return Number(raw.fromMarco) === fromMarco
    ? { fromMarco, values: object(raw.values) }
    : { fromMarco, values: {} };
};

function steps(snapshot: CharacterSnapshot): Step[] {
  const trail = activeTrail(snapshot);
  const from = activeMarco(snapshot);
  if (from < 1 || from >= 4) return [];
  const to = from + 1;
  const office = catalog.offices.find((item) => item.name === trail.oficio);
  if (!office) return [];
  const known = new Set(
    Array.isArray(trail.knownForms)
      ? trail.knownForms.map((item) => String(object(item).formId))
      : [],
  );
  const selectedM2 = String(selectionState(snapshot).values.m2 ?? "");
  if (from === 1 && selectedM2.startsWith("Forma: "))
    known.add(selectedM2.slice(7).split(" · ")[0]!);
  const techniques = new Set(Array.isArray(trail.tecnicas) ? trail.tecnicas.map(String) : []);
  const techniqueOptions = office.techniquesWithLevels
    .filter(
      (item) =>
        (({ Inicial: 1, I: 2, II: 4, III: 6, Legado: 10 }) as Record<string, number>)[
          item.level
        ]! <= to && !techniques.has(item.name),
    )
    .map((item) => `Técnica: ${item.name}`);
  const hasMagicAccess = trail.oficio === "Tecelão" || known.size > 0 || trail.acessoMagia === true;
  const magicOptions =
    hasMagicAccess && (trail.oficio === "Tecelão" || known.size < universalMagicCap(snapshot))
      ? catalog.magicForms
          .filter((item) => !known.has(item.id))
          .map((item) => `Forma: ${item.id} · ${item.canonicalName}`)
      : [];
  const result: Step[] = [];
  const gainIds = new Set(progressionGainIdsForSnapshot(snapshot, to));
  if (gainIds.has("m2"))
    result.push({
      id: "m2",
      label: "Técnica ou Forma do Marco 2",
      kind: "choice",
      options: [...techniqueOptions, ...magicOptions],
    });
  if (gainIds.has("m3"))
    result.push({
      id: "m3",
      label: "Especialização do Marco 3",
      kind: "choice",
      options: office.specializations
        .filter(
          (item) =>
            !(Array.isArray(trail.especializacoes) ? trail.especializacoes : []).includes(
              item.name,
            ),
        )
        .map((item) => item.name),
    });
  if (gainIds.has("m4a") || gainIds.has("m4b")) {
    const provenance = buildCharacterSkillProvenance(snapshot);
    if (gainIds.has("m4a"))
      result.push({
        id: "m4a",
        label: "Perícia +1 do Marco 4",
        kind: "choice",
        options: SKILL_NAMES.filter(
          (skill) =>
            Number(provenance[skill]?.base ?? 0) + Number(provenance[skill]?.bonus ?? 0) < 5,
        ),
      });
    if (gainIds.has("m4b"))
      result.push({
        id: "m4b",
        label: "Técnica do Marco 4",
        kind: "choice",
        options: techniqueOptions,
      });
  }
  if (trail.oficio === "Tecelão") {
    const deficit = tecelaoMagicTotals(to) - known.size;
    if (deficit > 0)
      result.push({
        id: "forms",
        label: `Novas Formas do Tecelão no Marco ${to}`,
        kind: "multi",
        options: catalog.magicForms
          .filter((item) => !known.has(item.id))
          .map((item) => `${item.id} · ${item.canonicalName}`),
        min: deficit,
        max: deficit,
      });
  }
  return result;
}

export function conversationalProgressionState(snapshot: CharacterSnapshot) {
  const values = selectionState(snapshot).values;
  const required = steps(snapshot);
  return {
    currentMarco: activeMarco(snapshot),
    choices: required.map((step) => ({ ...step, value: values[step.id] ?? null })),
    next: required.find((step) => values[step.id] == null) ?? null,
    complete: required.length > 0 && required.every((step) => values[step.id] != null),
  };
}

export function selectConversationalProgressionChoice(
  snapshot: CharacterSnapshot,
  id: string,
  value: unknown,
) {
  const state = conversationalProgressionState(snapshot);
  const step = state.next;
  if (!step || step.id !== id) throw new Error("invalid_proposal");
  const valid =
    step.kind === "multi"
      ? Array.isArray(value) &&
        value.length === step.min &&
        new Set(value).size === value.length &&
        value.every((item) => typeof item === "string" && step.options.includes(item))
      : typeof value === "string" && step.options.includes(value);
  if (!valid) throw new Error("invalid_proposal");
  const next = structuredClone(snapshot);
  const progress = object(next.serverCreationProgress);
  const prior = selectionState(next);
  progress.progressionSelections = {
    fromMarco: prior.fromMarco,
    values: { ...prior.values, [id]: value },
  };
  next.serverCreationProgress = progress;
  return next;
}

export function buildConversationalProgressionSnapshot(snapshot: CharacterSnapshot) {
  const state = conversationalProgressionState(snapshot);
  if (!state.complete) throw new Error("progression_gain_missing");
  const target = state.currentMarco + 1;
  const candidate = structuredClone(snapshot);
  const trail = activeTrail(candidate);
  const values = selectionState(snapshot).values;
  const gains = { ...object(trail.ganhos) };
  for (const id of progressionGainIdsForSnapshot(snapshot, target)) {
    const selection = String(values[id] ?? "");
    if (!selection) throw new Error("progression_gain_missing");
    if (id === "m2" && selection.startsWith("Forma: ")) {
      const formId = selection.slice(7).split(" · ")[0]!;
      trail.knownForms = [
        ...(Array.isArray(trail.knownForms) ? trail.knownForms : []),
        { formId, maxGrade: universalMagicGradeMax(target) },
      ];
      gains[id] = { tipo: "forma", valor: formId };
    } else if (id === "m2" || id === "m4b") {
      const name = selection.replace(/^Técnica: /, "");
      trail.tecnicas = [...(Array.isArray(trail.tecnicas) ? trail.tecnicas : []), name];
      gains[id] = { tipo: "tecnica", valor: name };
    } else if (id === "m3") {
      trail.especializacoes = [
        ...(Array.isArray(trail.especializacoes) ? trail.especializacoes : []),
        selection,
      ];
      gains[id] = { tipo: "especializacao", valor: selection };
    } else if (id === "m4a") gains[id] = { tipo: "pericia", valor: selection };
  }
  trail.ganhos = gains;
  trail.marco = target;
  if (trail.oficio === "Tecelão") {
    const extra = values.forms as string[];
    trail.knownForms = [
      ...(Array.isArray(trail.knownForms) ? trail.knownForms : []),
      ...extra.map((item) => ({
        formId: item.split(" · ")[0]!,
        maxGrade: universalMagicGradeMax(target),
      })),
    ];
  }
  candidate.periciasProveniencia = buildCharacterSkillProvenance(candidate);
  const progress = object(candidate.serverCreationProgress);
  candidate.serverCreationProgress = progress;
  const trailId = String(trail.id ?? "");
  const validation = validateProgressionSnapshot(snapshot, candidate, trailId, target);
  if (!validation.ok) throw new Error(`progression_patch_invalid:${validation.errors.join(",")}`);
  return candidate;
}
