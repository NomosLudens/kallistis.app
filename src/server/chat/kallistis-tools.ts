import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { retrieveCanonicalRules } from "@/lib/canonical-rules.server";
import type { ChatScope } from "@/server/local-core/data-contracts";
import { createLocalChatRuntime } from "@/server/local-core/chat-runtime";
import type { LocalChatRuntime } from "@/server/local-core/chat-runtime";
import {
  applyExplicitCharacterChoices,
  buildCharacterDraft,
  detectExplicitCharacterChoices,
  getCharacterCreationState,
} from "@/server/characters/chat-creation";
import {
  canonicalizeCharacterChoice,
  characterChoiceCandidatePatch,
  characterChoiceOptions,
  CHARACTER_CHOICE_REGISTRY,
  CHARACTER_FORGE_CHOICE_CATALOG,
  resolveCharacterChoiceCandidate,
  resolveNumericDistribution,
} from "@/server/characters/character-choice-registry";
import {
  CHARACTER_OFFICES,
  CHARACTER_PEOPLES,
  CHARACTER_ORIGINS,
  CHARACTER_RULESET,
  INITIAL_ATTRIBUTE_DISTRIBUTION,
  INITIAL_SKILL_DISTRIBUTION,
  buildCharacterSkillProvenance,
  characterOfficeRules,
  mechanicalFingerprint,
  type CharacterSnapshot,
  validateCharacterSnapshot,
} from "@/server/characters/character-canon";
const MAX_TOOL_CALLS_PER_TURN = 4;
const MAX_RULE_TEXT = 4_000;
const MAX_BIOGRAPHY = 2_500;

type ToolStatus =
  | "success"
  | "not_found"
  | "forbidden"
  | "validation_error"
  | "requires_confirmation";

type ToolResult = {
  status: ToolStatus;
  code?: string;
  [key: string]: unknown;
};

export type KallistisToolInput = {
  databaseUrl: string;
  userId: string;
  threadId: string;
  requestId: string;
  scope: ChatScope;
  activeCharacterId?: string | null;
  rawUserText?: string;
  contextReference?: string | null;
};

function safeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function explicitWeaponProficiencyAnswer(text: string): boolean | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
  if (
    /\b(nao sei se|nao lembro se|nao tenho certeza|talvez|acho que|confirmar se|confirmo se)\b/.test(
      normalized,
    )
  )
    return null;
  if (
    /\bsem (?:nenhuma? )?proficiencia\b|\bnao (?:tenho|possuo|sou) proficiente\b|\bnao sei usar\b|\bnao (?:confirmo|confirmar|confirmamos)\b|\bconfirm(?:ar|o|a|amos|ou)\b[\s\S]{0,80}\bnao\s+(?:tenho|possuo)\s+(?:a\s+)?proficiencia\b/.test(
      normalized,
    )
  )
    return false;
  if (
    /\bcom proficiencia\b|\b(?:tenho|possuo|sou) proficiente\b|\bsei usar\b|\bconfirmo\b[\s\S]{0,80}\b(?:atende|compativel|proficiente)\b|\bconfirm(?:ar|o|a|amos|ou)\b[\s\S]{0,100}\b(?:tem|possui|tenho|possuo|e|esta)\s+(?:a\s+)?proficiencia\b/.test(
      normalized,
    )
  )
    return true;
  return null;
}

async function findEditableCharacter(
  runtime: ReturnType<typeof createLocalChatRuntime>,
  userId: string,
  characterId?: string,
) {
  if (!characterId) return null;
  return runtime.characters?.get(userId, characterId) ?? null;
}

const CHARACTER_CREATION_PATCH_FIELDS = new Set([
  "nome",
  "conceito",
  "pronomes",
  "campanha",
  "apelido",
  "descricao",
  "aparencia",
  "biografia",
  "manifestacao_pessoal",
  "montaria",
  "pet",
  "povo",
  "heranca",
  "escolhasPovo",
  "pericaLivre",
  "aspectoOutro",
  "tecnicaHeranca",
  "origem",
  "origemDetalhe",
  "origemBeneficio",
  "dividaComunitaria",
  "origemTrocado",
  "trilhas",
  "atributosBase",
  "periciasBase",
  "equipamento",
  "vinculos",
  "promessa",
  "ferida",
  "pergunta",
]);

export function mergeCharacterCreationPatch(
  current: CharacterSnapshot,
  patch: Record<string, unknown>,
): CharacterSnapshot {
  const next = structuredClone(current);
  const merge = (before: unknown, value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(value);
    const result =
      before && typeof before === "object" && !Array.isArray(before) ? structuredClone(before) : {};
    for (const [key, nested] of Object.entries(value)) {
      const previous = (result as Record<string, unknown>)[key];
      if (key === "vinculosEvocados" && Array.isArray(previous) && Array.isArray(nested)) {
        const links = [...previous];
        nested.forEach((link, index) => {
          if (link !== null && link !== undefined) links[index] = merge(previous[index], link);
        });
        (result as Record<string, unknown>)[key] = links;
      } else {
        (result as Record<string, unknown>)[key] = merge(previous, nested);
      }
    }
    return result;
  };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "trilhas" && Array.isArray(value)) {
      const currentTrails = Array.isArray(next.trilhas) ? next.trilhas : [];
      const mergedTrails = [...currentTrails];
      value.forEach((trail, index) => {
        if (trail !== null && trail !== undefined)
          mergedTrails[index] = merge(currentTrails[index], trail);
      });
      next.trilhas = mergedTrails;
    } else {
      next[key] = merge(next[key], value);
    }
  }
  return next;
}

function captureLabeledValue(text: string, expression: RegExp) {
  const match = text.match(expression);
  return (
    match?.[1]
      ?.trim()
      .replace(/[.!?]+$/, "")
      .trim() ?? null
  );
}

function normalizeChoiceText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function labeledChoicePatch(text: string) {
  const patch: Record<string, unknown> = {};
  const setChoice = (field: string, expression: RegExp) => {
    const value = captureLabeledValue(text, expression);
    const canonical = value ? canonicalizeCharacterChoice(field, value) : null;
    if (canonical) {
      const candidate = characterChoiceCandidatePatch({
        field,
        values: [canonical],
        ambiguous: false,
        incomplete: false,
      });
      Object.assign(patch, mergeCharacterCreationPatch(patch as CharacterSnapshot, candidate));
    }
  };

  setChoice("povo", /\bpovo\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("heranca", /\bheran[cç]a\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("trilhas[0].oficio", /\bof[ií]cio\s+principal\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("origem", /\borigem\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("trilhas[0].papel", /\bpapel\s*(?:=|:)??\s*(.+?)(?=\s+e\s+chave\b|[,;.\n]|$)/i);
  setChoice("trilhas[0].chave", /\bchave\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice(
    "pericaLivre",
    /\bper[ií]cia\s+livre(?:\s+adicional)?\s*(?:=|:|(?:é|e))?\s*([^,;.\n]+)/i,
  );
  setChoice("equipamento.arma", /\barma\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("equipamento.armadura", /\barmadura\s*(?:=|:)??\s*([^,;.\n]+)/i);
  setChoice("equipamento.ferramenta", /\bferramenta\s*(?:=|:)??\s*([^,;.\n]+)/i);
  const initialTechnique = captureLabeledValue(
    text,
    /\bt[eé]cnica inicial\s*(?:=|:|(?:é|e\b))?\s*([^,;.\n]+)/i,
  );
  if (initialTechnique) {
    const canonical = canonicalizeCharacterChoice("trilhas[0].tecnicas", initialTechnique);
    if (canonical)
      Object.assign(
        patch,
        mergeCharacterCreationPatch(patch as CharacterSnapshot, {
          trilhas: [{ tecnicas: [canonical] }],
        }),
      );
  }
  const techniqueMentions = text.matchAll(/\bt[eé]cnica\s*(?:=|:|(?:é|e\b))?\s*([^,;.\n]+)/gi);
  for (const [, technique] of techniqueMentions) {
    if (/\bde heran[cç]a\b/i.test(technique)) continue;
    const canonical = canonicalizeCharacterChoice("trilhas[0].tecnicas", technique.trim());
    if (canonical)
      Object.assign(
        patch,
        mergeCharacterCreationPatch(patch as CharacterSnapshot, {
          trilhas: [{ tecnicas: [canonical] }],
        }),
      );
  }
  const heritageTechnique = text.match(
    /\bt[eé]cnica\s+de\s+heran[cç]a\s+(.+?)\s+do\s+of[ií]cio\s+([^,;.\n]+)/i,
  );
  if (heritageTechnique) {
    const name = canonicalizeCharacterChoice("tecnicaHeranca.nome", heritageTechnique[1]!.trim());
    const office = canonicalizeCharacterChoice(
      "tecnicaHeranca.oficio",
      heritageTechnique[2]!.trim(),
    );
    if (name && office) patch.tecnicaHeranca = { oficio: office, nome: name };
  }
  const consumablesText = captureLabeledValue(
    text,
    /\bconsum[ií]veis?\s*(?:=|:)?\s*(.+?)(?=[.;\n]|$)/i,
  );
  if (consumablesText) {
    const consumables = CHARACTER_FORGE_CHOICE_CATALOG.consumables.filter((value) =>
      consumablesText.toLocaleLowerCase("pt-BR").includes(value.toLocaleLowerCase("pt-BR")),
    );
    if (consumables.length)
      patch.equipamento = {
        ...(patch.equipamento as Record<string, unknown> | undefined),
        consumiveis: consumables,
      };
  }

  const equipmentText = captureLabeledValue(text, /\bequipamento\s*(?:=|:)\s*([^.;\n]+)/i);
  const equipment = patch.equipamento as Record<string, unknown> | undefined;
  if (equipmentText && !equipment?.arma) {
    const weapon = CHARACTER_FORGE_CHOICE_CATALOG.weapons.find((value) => {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(equipmentText);
    });
    if (weapon)
      patch.equipamento = {
        ...equipment,
        arma: weapon,
      };
  }

  const concept: Record<string, string> = {};
  const identity = captureLabeledValue(text, /\bconceito\s*(?:=|:)\s*([^.;\n]+)/i);
  if (identity) concept.identidade = identity;
  for (const field of ["identidade", "objetivo", "perda"] as const) {
    const value = captureLabeledValue(
      text,
      new RegExp(`\\bconceito\\s*[·.]\\s*${field}\\s*(?:=|:)\\s*([^.;\\n]+)`, "i"),
    );
    if (value) concept[field] = value;
  }
  if (/\bconceito\s*[·.]\s*objetivo\s+e\s+conceito\s*[·.]\s*perda\s+em\s+branco\b/i.test(text)) {
    concept.objetivo = "";
    concept.perda = "";
  }
  if (Object.keys(concept).length)
    patch.conceito = {
      ...(patch.conceito as Record<string, unknown> | undefined),
      ...concept,
    };

  const name = captureLabeledValue(text, /\bnome\s+(?:=|:|(?:é|e))?\s*([^.;\n]+)/i);
  if (name) patch.nome = name;
  const linksText = text.match(/\bv[ií]nculos?\s*[:=]\s*(.+?)(?=\bpromessa\s*[:=]|$)/i)?.[1];
  if (linksText) {
    const links = linksText
      .split(linksText.includes(";") ? /;/ : /\s*,\s*|\s+e\s+/i)
      .map((value) =>
        value
          .trim()
          .replace(/^e\s+/i, "")
          .replace(/[.!?]+$/, ""),
      )
      .filter(Boolean);
    if (links.length) patch.vinculos = links;
  }
  const promise = captureLabeledValue(text, /\bpromessa\s*[:=]\s*(.+?)(?=\bferida\s*[:=]|$)/i);
  if (promise) patch.promessa = promise;
  const wound = captureLabeledValue(text, /\bferida\s*[:=]\s*(.+?)(?=\bpergunta\s*[:=]|$)/i);
  if (wound) patch.ferida = wound;
  const question = text.match(/\bpergunta\s*[:=]\s*([^.!?\n]+[.!?]?)/i)?.[1]?.trim();
  if (question) patch.pergunta = question;
  return patch;
}

export function reconstructCharacterCreationPatchFromHistory(
  messages: readonly { role: "user" | "assistant"; content: string }[],
  initialSnapshot: CharacterSnapshot = buildCharacterDraft("", "", ""),
) {
  let snapshot = structuredClone(initialSnapshot);
  let patch: Record<string, unknown> = {};
  let previousAssistantMessage: string | undefined;
  const unresolvedDistributions = new Set<string>();
  const applyPatch = (nextPatch: Record<string, unknown>) => {
    snapshot = mergeCharacterCreationPatch(snapshot, nextPatch);
    patch = mergeCharacterCreationPatch(patch as CharacterSnapshot, nextPatch);
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      previousAssistantMessage = message.content;
      continue;
    }
    const choices = detectExplicitCharacterChoices(message.content, { previousAssistantMessage });
    if (choices.length) {
      snapshot = applyExplicitCharacterChoices(snapshot, choices);
      const explicitPatch: Record<string, unknown> = {};
      for (const choice of choices) {
        if (choice.field === "nome") explicitPatch.nome = choice.value;
        else if (choice.field === "sobrenome") explicitPatch.nome = snapshot.nome;
        else if (choice.field === "povo") explicitPatch.povo = choice.value;
        else if (choice.field === "oficio") {
          const index = Math.max(0, Number(snapshot.trilhaAtiva) || 0);
          const trails: Array<Record<string, unknown> | null> = Array(index + 1).fill(null);
          trails[index] = { oficio: choice.value };
          explicitPatch.trilhas = trails;
        } else if (choice.field === "tecnicaHeranca.oficio")
          explicitPatch.tecnicaHeranca = { oficio: choice.value };
      }
      if (Object.keys(explicitPatch).length) applyPatch(explicitPatch);
    }
    const directCandidate = resolveCharacterChoiceCandidate(
      message.content,
      previousAssistantMessage,
      snapshot,
    );
    if (
      directCandidate &&
      !directCandidate.ambiguous &&
      !directCandidate.incomplete &&
      !directCandidate.invalid
    )
      applyPatch(characterChoiceCandidatePatch(directCandidate));

    const normalizedUserText = normalizeChoiceText(message.content);
    const mentionsAttributes =
      /\batributos?\b/.test(normalizedUserText) ||
      CHARACTER_FORGE_CHOICE_CATALOG.attributes.some((name) =>
        new RegExp(`\\b${normalizeChoiceText(name)}\\b`).test(normalizedUserText),
      );
    const mentionsSkills =
      /\bpericias?\b/.test(normalizedUserText) ||
      CHARACTER_FORGE_CHOICE_CATALOG.skills.some((name) =>
        new RegExp(`\\b${normalizeChoiceText(name)}\\b`).test(normalizedUserText),
      );
    for (const field of ["atributosBase", "periciasBase"] as const) {
      if (field === "atributosBase" ? !mentionsAttributes : !mentionsSkills) continue;
      const candidate = resolveNumericDistribution(field, normalizeChoiceText(message.content));
      if (!candidate) continue;
      if (candidate.patch && !candidate.incomplete && !candidate.invalid) {
        applyPatch(candidate.patch);
        unresolvedDistributions.delete(field);
      } else {
        unresolvedDistributions.add(field);
      }
    }
    const labeledPatch = labeledChoicePatch(message.content);
    if (Object.keys(labeledPatch).length) applyPatch(labeledPatch);
  }

  return {
    patch,
    snapshot,
    unresolvedDistributions: [...unresolvedDistributions],
  };
}

export async function applyCharacterCreationPatch(input: {
  runtime: LocalChatRuntime;
  userId: string;
  threadId: string;
  activeCharacterId?: string | null;
  scope: ChatScope;
  patch: Record<string, unknown>;
  rawUserText?: string;
  contextReference?: string | null;
}): Promise<ToolResult | null> {
  if (input.scope !== "character_creation") return null;
  const createsDraft = !input.activeCharacterId;
  const invalidFields = Object.keys(input.patch).filter(
    (key) => !CHARACTER_CREATION_PATCH_FIELDS.has(key),
  );
  if (invalidFields.length)
    return { status: "validation_error", code: "creation_patch_field_forbidden", invalidFields };
  const invalidNested: string[] = [];
  const checkKeys = (value: unknown, allowed: readonly string[], path: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalidNested.push(path);
      return;
    }
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) invalidNested.push(`${path}.${key}`);
  };
  for (const [field, allowed] of [
    ["conceito", ["identidade", "objetivo", "perda"]],
    ["montaria", ["nome", "descricao", "notas"]],
    ["pet", ["nome", "descricao", "notas"]],
    ["origemTrocado", ["nascimento", "criacao", "descricao"]],
    ["tecnicaHeranca", ["oficio", "nome"]],
    [
      "equipamento",
      ["arma", "armadura", "ferramenta", "consumiveis", "extras", "proficienciaConfirmada"],
    ],
  ] as const)
    if (Object.hasOwn(input.patch, field)) checkKeys(input.patch[field], allowed, field);
  if (Object.hasOwn(input.patch, "escolhasPovo")) {
    const choices = input.patch.escolhasPovo;
    if (!choices || typeof choices !== "object" || Array.isArray(choices))
      invalidNested.push("escolhasPovo");
    else {
      const choiceKeys = new Set(
        Object.values(CHARACTER_FORGE_CHOICE_CATALOG.peopleChoices).flatMap((items) =>
          items.map((item) => item.key),
        ),
      );
      for (const key of Object.keys(choices))
        if (!choiceKeys.has(key)) invalidNested.push(`escolhasPovo.${key}`);
    }
  }
  if (!createsDraft && Object.hasOwn(input.patch, "atributosBase"))
    checkKeys(
      input.patch.atributosBase,
      CHARACTER_FORGE_CHOICE_CATALOG.attributes,
      "atributosBase",
    );
  if (!createsDraft && Object.hasOwn(input.patch, "periciasBase"))
    checkKeys(input.patch.periciasBase, CHARACTER_FORGE_CHOICE_CATALOG.skills, "periciasBase");
  if (Object.hasOwn(input.patch, "trilhas")) {
    if (!Array.isArray(input.patch.trilhas)) invalidNested.push("trilhas");
    else
      input.patch.trilhas.forEach((rawTrail, index) => {
        if (rawTrail === null) return;
        const trailPath = `trilhas[${index}]`;
        checkKeys(
          rawTrail,
          [
            "oficio",
            "marco",
            "papel",
            "chave",
            "pericias",
            "pericaEscolhida",
            "especializacoes",
            "tecnicas",
            "magias",
            "knownForms",
            "vinculosEvocados",
          ],
          trailPath,
        );
        if (!rawTrail || typeof rawTrail !== "object" || Array.isArray(rawTrail)) return;
        const trail = rawTrail as Record<string, unknown>;
        if (Object.hasOwn(trail, "knownForms")) {
          if (!Array.isArray(trail.knownForms)) invalidNested.push(`${trailPath}.knownForms`);
          else
            trail.knownForms.forEach((form, formIndex) =>
              checkKeys(form, ["formId"], `${trailPath}.knownForms[${formIndex}]`),
            );
        }
        if (Object.hasOwn(trail, "vinculosEvocados")) {
          if (!Array.isArray(trail.vinculosEvocados))
            invalidNested.push(`${trailPath}.vinculosEvocados`);
          else
            trail.vinculosEvocados.forEach((link, linkIndex) =>
              checkKeys(
                link,
                [
                  "nome",
                  "porte",
                  "modelo",
                  "forma",
                  "ancora",
                  "impulso",
                  "pacto",
                  "aparencia",
                  "consciencia",
                ],
                `${trailPath}.vinculosEvocados[${linkIndex}]`,
              ),
            );
        }
      });
  }
  if (invalidNested.length)
    return {
      status: "validation_error",
      code: "creation_patch_field_forbidden",
      invalidFields: invalidNested,
    };
  const invalidDistributions: string[] = [];
  const validateDistribution = (
    field: "atributosBase" | "periciasBase",
    raw: unknown,
    keys: readonly string[],
    expected: readonly number[],
  ) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalidDistributions.push(field);
      return;
    }
    const values = raw as Record<string, unknown>;
    if (
      Object.keys(values).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(values, key)) ||
      Object.values(values).some((value) => typeof value !== "number" || !Number.isInteger(value))
    ) {
      invalidDistributions.push(field);
      return;
    }
    const actual = Object.values(values as Record<string, number>).sort((a, b) => a - b);
    if (
      actual.some((value) => value < 0 || value > 3) ||
      actual.join(",") !== [...expected].sort((a, b) => a - b).join(",")
    )
      invalidDistributions.push(field);
  };
  if (!createsDraft && Object.hasOwn(input.patch, "atributosBase"))
    validateDistribution(
      "atributosBase",
      input.patch.atributosBase,
      CHARACTER_FORGE_CHOICE_CATALOG.attributes,
      INITIAL_ATTRIBUTE_DISTRIBUTION,
    );
  if (!createsDraft && Object.hasOwn(input.patch, "periciasBase"))
    validateDistribution(
      "periciasBase",
      input.patch.periciasBase,
      CHARACTER_FORGE_CHOICE_CATALOG.skills,
      INITIAL_SKILL_DISTRIBUTION,
    );
  if (!createsDraft && invalidDistributions.length)
    return {
      status: "validation_error",
      code: "numeric_distribution_invalid",
      invalidFields: invalidDistributions,
    };
  const existingCharacter = await findEditableCharacter(
    input.runtime,
    input.userId,
    input.activeCharacterId ?? undefined,
  );
  const cancelledPreview = createsDraft
    ? await input.runtime.mutations?.getLatestCancelledCharacterCreatePreview?.(
        input.userId,
        input.threadId,
      )
    : null;
  const cancelledSnapshot = cancelledPreview?.payload.snapshot;
  const resumedSnapshot =
    cancelledSnapshot &&
    typeof cancelledSnapshot === "object" &&
    !Array.isArray(cancelledSnapshot) &&
    (cancelledSnapshot as Record<string, unknown>).ruleset === CHARACTER_RULESET
      ? (cancelledSnapshot as CharacterSnapshot)
      : null;
  if (cancelledPreview && !resumedSnapshot)
    return { status: "validation_error", code: "cancelled_creation_preview_invalid" };
  const character =
    existingCharacter ??
    (createsDraft
      ? {
          id: randomUUID(),
          version: 0,
          status: "draft" as const,
          snapshot: resumedSnapshot ?? buildCharacterDraft("", "", ""),
        }
      : null);
  if (!character) return { status: "not_found", code: "forge_draft_not_found" };
  if (
    createsDraft
      ? !input.runtime.mutations?.createCharacterCreatePreview
      : !input.runtime.mutations?.createCharacterCreationPatchPreview
  )
    return { status: "validation_error", code: "mutation_unavailable" };
  const mutations = input.runtime.mutations!;
  if (!Object.keys(input.patch).length)
    return { status: "validation_error", code: "creation_patch_required" };

  const creationHistory = createsDraft
    ? [
        ...((await input.runtime.chat.listThreadMessages?.(input.userId, input.threadId, 200)) ??
          []),
      ].reverse()
    : [];
  const reconstructed: { patch: Record<string, unknown>; unresolvedDistributions: string[] } =
    createsDraft
      ? reconstructCharacterCreationPatchFromHistory(creationHistory, character.snapshot)
      : { patch: {}, unresolvedDistributions: [] as string[] };
  if (reconstructed.unresolvedDistributions.length)
    return {
      status: "validation_error",
      code: "numeric_distribution_invalid",
      invalidFields: reconstructed.unresolvedDistributions,
    };
  const normalizedPatch: Record<string, unknown> = createsDraft
    ? mergeCharacterCreationPatch(structuredClone(input.patch), reconstructed.patch)
    : structuredClone(input.patch);
  if (createsDraft) {
    for (const field of ["atributosBase", "periciasBase"] as const) {
      if (Object.hasOwn(reconstructed.patch, field)) {
        normalizedPatch[field] = structuredClone(reconstructed.patch[field]);
      }
    }
    if (Array.isArray(normalizedPatch.trilhas)) {
      for (const trail of normalizedPatch.trilhas) {
        if (!trail || typeof trail !== "object" || Array.isArray(trail)) continue;
        delete (trail as Record<string, unknown>).pericias;
        delete (trail as Record<string, unknown>).tecnicas;
      }
    }
  }
  const mergedDistributions: string[] = [];
  if (Object.hasOwn(normalizedPatch, "atributosBase"))
    validateDistribution(
      "atributosBase",
      normalizedPatch.atributosBase,
      CHARACTER_FORGE_CHOICE_CATALOG.attributes,
      INITIAL_ATTRIBUTE_DISTRIBUTION,
    );
  if (Object.hasOwn(normalizedPatch, "periciasBase"))
    validateDistribution(
      "periciasBase",
      normalizedPatch.periciasBase,
      CHARACTER_FORGE_CHOICE_CATALOG.skills,
      INITIAL_SKILL_DISTRIBUTION,
    );
  if (invalidDistributions.length) mergedDistributions.push(...invalidDistributions);
  if (mergedDistributions.length)
    return {
      status: "validation_error",
      code: "numeric_distribution_invalid",
      invalidFields: [...new Set(mergedDistributions)],
    };
  const normalize = (field: string, raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const canonical = canonicalizeCharacterChoice(field, raw);
    if (!canonical) return null;
    const options = characterChoiceOptions(
      field,
      mergeCharacterCreationPatch(character.snapshot, normalizedPatch),
    );
    return options.includes(canonical) ? canonical : null;
  };
  const invalidChoices: string[] = [];
  const normalizeScalar = (patch: Record<string, unknown>, key: string, field: string) => {
    if (!Object.hasOwn(patch, key)) return;
    const canonical = normalize(field, patch[key]);
    if (!canonical) invalidChoices.push(field);
    else patch[key] = canonical;
  };

  normalizeScalar(normalizedPatch, "povo", "povo");
  normalizeScalar(normalizedPatch, "heranca", "heranca");
  normalizeScalar(normalizedPatch, "origem", "origem");
  normalizeScalar(normalizedPatch, "pericaLivre", "pericaLivre");
  normalizeScalar(normalizedPatch, "origemBeneficio", "origemBeneficio");
  if (normalizedPatch.tecnicaHeranca && typeof normalizedPatch.tecnicaHeranca === "object") {
    const external = normalizedPatch.tecnicaHeranca as Record<string, unknown>;
    normalizeScalar(external, "oficio", "tecnicaHeranca.oficio");
    normalizeScalar(external, "nome", "tecnicaHeranca.nome");
  }
  if (normalizedPatch.escolhasPovo && typeof normalizedPatch.escolhasPovo === "object") {
    const choices = normalizedPatch.escolhasPovo as Record<string, unknown>;
    const people = String(normalizedPatch.povo ?? character.snapshot.povo ?? "");
    const choiceSpecs = new Map(
      (
        CHARACTER_FORGE_CHOICE_CATALOG.peopleChoices[
          people as keyof typeof CHARACTER_FORGE_CHOICE_CATALOG.peopleChoices
        ] ?? []
      ).map((choice) => [choice.key, choice]),
    );
    for (const [key, value] of Object.entries(choices)) {
      const field = `escolhasPovo.${people}.${key}`;
      const spec = choiceSpecs.get(key);
      const rawValues = Array.isArray(value) ? value : [value];
      if (
        !spec ||
        rawValues.length < spec.min ||
        rawValues.length > spec.max ||
        new Set(rawValues).size !== rawValues.length
      )
        invalidChoices.push(field);
      const normalized = rawValues.map((item) => normalize(field, item));
      if (normalized.some((item) => !item)) invalidChoices.push(field);
      else if (spec?.max === 1) {
        choices[key] = normalized[0];
      } else {
        choices[key] = normalized;
      }
    }
  }
  if (Array.isArray(normalizedPatch.trilhas)) {
    normalizedPatch.trilhas.forEach((rawTrail, index) => {
      if (!rawTrail || typeof rawTrail !== "object" || Array.isArray(rawTrail)) return;
      const trail = rawTrail as Record<string, unknown>;
      for (const key of ["oficio", "papel", "chave", "pericaEscolhida"]) {
        if (!Object.hasOwn(trail, key)) continue;
        const field = `trilhas[${index}].${key}`;
        const canonical = normalize(field, trail[key]);
        if (!canonical) invalidChoices.push(field);
        else trail[key] = canonical;
      }
      for (const key of ["tecnicas", "pericias", "magias", "especializacoes"]) {
        if (!Array.isArray(trail[key])) continue;
        const field = `trilhas[${index}].${key}`;
        const normalized = (trail[key] as unknown[]).map((item) => normalize(field, item));
        if (normalized.some((item) => !item) || new Set(normalized).size !== normalized.length)
          invalidChoices.push(field);
        else trail[key] = normalized;
      }
      if (Array.isArray(trail.knownForms))
        trail.knownForms.forEach((rawForm, formIndex) => {
          const form = rawForm as Record<string, unknown>;
          if (!Object.hasOwn(form, "formId")) return;
          const field = `trilhas[${index}].knownForms[${formIndex}].formId`;
          const canonical = normalize(field, form.formId);
          if (!canonical) invalidChoices.push(field);
          else form.formId = canonical;
        });
      if (Array.isArray(trail.vinculosEvocados))
        trail.vinculosEvocados.forEach((rawLink, linkIndex) => {
          const link = rawLink as Record<string, unknown>;
          for (const key of ["porte", "forma", "modelo"]) {
            if (!Object.hasOwn(link, key)) continue;
            const field = `trilhas[${index}].vinculosEvocados[${linkIndex}].${key}`;
            const canonical = normalize(field, link[key]);
            if (!canonical) invalidChoices.push(field);
            else link[key] = canonical;
          }
        });
    });
  }
  if (normalizedPatch.equipamento && typeof normalizedPatch.equipamento === "object") {
    const equipment = normalizedPatch.equipamento as Record<string, unknown>;
    for (const key of ["arma", "armadura", "ferramenta"])
      normalizeScalar(equipment, key, `equipamento.${key}`);
    if (Object.hasOwn(equipment, "arma")) {
      const userStatements = [
        ...creationHistory
          .filter((message) => message.role === "user")
          .map((message) => message.content),
        input.rawUserText ?? "",
      ];
      const proficiencyAnswer =
        userStatements
          .map(explicitWeaponProficiencyAnswer)
          .reverse()
          .find((answer) => answer !== null) ?? null;
      // The Forge checkbox is an affirmative compatibility attestation, not
      // a marker that the player merely answered a yes/no question.
      equipment.proficienciaConfirmada = proficiencyAnswer === true;
    }
    if (Object.hasOwn(equipment, "proficienciaConfirmada")) {
      const canonical = normalize(
        "equipamento.proficienciaConfirmada",
        String(equipment.proficienciaConfirmada),
      );
      if (!canonical) invalidChoices.push("equipamento.proficienciaConfirmada");
      else equipment.proficienciaConfirmada = canonical === "true";
    }
    if (Object.hasOwn(equipment, "arma") && equipment.proficienciaConfirmada !== true)
      invalidChoices.push("equipamento.proficienciaConfirmada (confirmação explícita exigida)");
    if (Array.isArray(equipment.consumiveis)) {
      const normalized = equipment.consumiveis.map((item) =>
        normalize("equipamento.consumiveis", item),
      );
      if (normalized.some((item) => !item)) invalidChoices.push("equipamento.consumiveis");
      else equipment.consumiveis = normalized;
    }
    if (Array.isArray(equipment.extras)) {
      const normalized = equipment.extras.map((item) => normalize("equipamento.extras", item));
      if (normalized.some((item) => !item)) invalidChoices.push("equipamento.extras");
      else equipment.extras = normalized;
    }
  }

  // Keep the write boundary synchronized with the complete Forge registry.
  // The field-by-field normalization above also handles legacy patch shapes;
  // this recursive pass covers newly added and conditional closed choices so
  // they cannot silently bypass canonical validation when the Forge evolves.
  const normalizeRegisteredChoices = (value: unknown, path: string): unknown => {
    const registryPath = path.replace(/\[\d+\]/g, "[]");
    const entry = CHARACTER_CHOICE_REGISTRY.find(
      (field) =>
        field.field === registryPath ||
        (field.field.endsWith(".*") && registryPath.startsWith(field.field.slice(0, -1))),
    );
    if (typeof value === "string" && entry?.type === "CLOSED_CHOICE") {
      const canonical = canonicalizeCharacterChoice(registryPath, value);
      const options = characterChoiceOptions(
        registryPath,
        mergeCharacterCreationPatch(character.snapshot, normalizedPatch),
      );
      if (!canonical || !options.includes(canonical)) {
        invalidChoices.push(registryPath);
        return value;
      }
      return canonical;
    }
    if (Array.isArray(value)) {
      if (entry?.type === "MULTI_CHOICE" && value.every((item) => typeof item === "string")) {
        const normalized = value.map((item) => canonicalizeCharacterChoice(registryPath, item));
        const options = characterChoiceOptions(
          registryPath,
          mergeCharacterCreationPatch(character.snapshot, normalizedPatch),
        );
        if (
          normalized.some((item) => !item || !options.includes(item)) ||
          new Set(normalized).size !== normalized.length ||
          (entry.minChoices !== undefined && value.length < entry.minChoices) ||
          (entry.maxChoices !== undefined && value.length > entry.maxChoices)
        ) {
          invalidChoices.push(registryPath);
          return value;
        }
        return normalized;
      }
      return value.map((item, index) => normalizeRegisteredChoices(item, `${path}[${index}]`));
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        // Forge stores people-specific choices without repeating the people
        // name in the snapshot. Resolve their registry path from the selected
        // people so each option remains scoped to its actual catalog.
        if (path === "escolhasPovo") {
          const people = String(normalizedPatch.povo ?? character.snapshot.povo ?? "");
          const field = `escolhasPovo.${people}.${key}`;
          const spec = (
            CHARACTER_FORGE_CHOICE_CATALOG.peopleChoices[
              people as keyof typeof CHARACTER_FORGE_CHOICE_CATALOG.peopleChoices
            ] ?? []
          ).find((choice) => choice.key === key);
          const values = Array.isArray(nested) ? nested : [nested];
          const canonical = values.map((item) =>
            typeof item === "string" ? canonicalizeCharacterChoice(field, item) : null,
          );
          const options = spec?.values ?? [];
          if (
            !spec ||
            values.length < spec.min ||
            values.length > spec.max ||
            canonical.some((item) => !item || !options.includes(item))
          ) {
            invalidChoices.push(field);
            result[key] = nested;
          } else {
            result[key] = spec.max === 1 ? canonical[0] : canonical;
          }
        } else {
          result[key] = normalizeRegisteredChoices(nested, `${path}.${key}`);
        }
      }
      return result;
    }
    return value;
  };
  for (const [key, value] of Object.entries(normalizedPatch))
    normalizedPatch[key] = normalizeRegisteredChoices(value, key);

  if (invalidChoices.length)
    return {
      status: "validation_error",
      code: "character_choice_invalid_or_dependency_missing",
      invalidFields: [...new Set(invalidChoices)],
    };

  const nextSnapshot = mergeCharacterCreationPatch(character.snapshot, normalizedPatch);
  const activeTrailIndex = Math.max(0, Number(nextSnapshot.trilhaAtiva) || 0);
  const nextTrails = Array.isArray(nextSnapshot.trilhas) ? [...nextSnapshot.trilhas] : [];
  const activeTrail = nextTrails[activeTrailIndex];
  if (activeTrail && typeof activeTrail === "object" && !Array.isArray(activeTrail)) {
    const trail = { ...activeTrail } as Record<string, unknown>;
    const officeRule = characterOfficeRules(String(trail.oficio ?? ""));
    if (officeRule) {
      trail.pericias = createsDraft
        ? [...officeRule.fixedSkills]
        : [
            ...new Set([
              ...officeRule.fixedSkills,
              ...(Array.isArray(trail.pericias)
                ? trail.pericias.filter((value): value is string => typeof value === "string")
                : []),
            ]),
          ];
      trail.tecnicas = createsDraft
        ? [officeRule.initialTechnique]
        : [
            ...new Set([
              officeRule.initialTechnique,
              ...(Array.isArray(trail.tecnicas)
                ? trail.tecnicas.filter((value): value is string => typeof value === "string")
                : []),
            ]),
          ];
      nextTrails[activeTrailIndex] = trail;
      nextSnapshot.trilhas = nextTrails;
    }
  }
  nextSnapshot.periciasProveniencia = buildCharacterSkillProvenance(nextSnapshot);
  if (
    createsDraft &&
    normalizedPatch.tecnicaHeranca &&
    (!String(nextSnapshot.povo ?? "").trim() ||
      !String(nextSnapshot.heranca ?? "").trim() ||
      !Array.isArray(nextSnapshot.trilhas) ||
      !String((nextSnapshot.trilhas[0] as { oficio?: unknown } | undefined)?.oficio ?? "").trim())
  ) {
    return {
      status: "validation_error",
      code: "creation_context_missing",
      invalidFields: ["povo", "heranca", "trilhas[0].oficio"],
    };
  }
  const existingErrors = new Set(validateCharacterSnapshot(character.snapshot, false).errors);
  const introducedErrors = validateCharacterSnapshot(nextSnapshot, false).errors.filter(
    (error) => !existingErrors.has(error),
  );
  if (introducedErrors.length)
    return {
      status: "validation_error",
      code: "character_creation_patch_invalid",
      invalidFields: introducedErrors,
    };
  if (createsDraft) {
    const name = String(nextSnapshot.nome ?? "").trim();
    const firstTrail = Array.isArray(nextSnapshot.trilhas) ? nextSnapshot.trilhas[0] : null;
    const existing = await input.runtime.characters?.list(input.userId);
    if (name && existing?.some((item) => item.name === name && item.status !== "archived"))
      return { status: "validation_error", code: "character_name_already_exists" };
    const mutation = await mutations.createCharacterCreatePreview({
      id: randomUUID(),
      operationId: randomUUID(),
      userId: input.userId,
      threadId: input.threadId,
      plannedCharacterId: randomUUID(),
      payload: {
        snapshot: nextSnapshot,
        ruleset: CHARACTER_RULESET,
        mechanicalFingerprint: mechanicalFingerprint(nextSnapshot),
        ...(input.rawUserText ? { rawUserText: input.rawUserText } : {}),
        contextReference: input.contextReference ?? null,
      },
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    return {
      status: "requires_confirmation",
      operation: mutation.operation,
      confirmationId: mutation.id,
      characterId: mutation.payload.plannedCharacterId,
      expectedVersion: null,
      name: String(nextSnapshot.nome ?? ""),
      povo: String(nextSnapshot.povo ?? ""),
      oficio:
        firstTrail && typeof firstTrail === "object" && "oficio" in firstTrail
          ? String(firstTrail.oficio ?? "")
          : "",
      biografia: safeText(nextSnapshot.biografia, MAX_BIOGRAPHY),
      preview: Object.fromEntries(Object.entries(normalizedPatch)),
      fields: Object.keys(normalizedPatch),
      expiresAt: mutation.expiresAt,
    };
  }
  const preview = Object.fromEntries(
    Object.entries(normalizedPatch).map(([field, value]) => [field, value]),
  );
  const mutation = await mutations.createCharacterCreationPatchPreview({
    id: randomUUID(),
    operationId: randomUUID(),
    userId: input.userId,
    threadId: input.threadId,
    characterId: character.id,
    expectedVersion: character.version,
    patch: normalizedPatch,
    preview,
    rawUserText: input.rawUserText,
    contextReference: input.contextReference,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  return {
    status: "requires_confirmation",
    operation: mutation.operation,
    confirmationId: mutation.id,
    characterId: character.id,
    expectedVersion: character.version,
    preview,
    fields: Object.keys(normalizedPatch),
    expiresAt: mutation.expiresAt,
    nextSnapshotFingerprint: mechanicalFingerprint(nextSnapshot),
  };
}

export function createKallistisTools(input: KallistisToolInput) {
  let callCount = 0;

  async function runTool(name: string, execute: () => Promise<ToolResult>): Promise<ToolResult> {
    callCount += 1;
    if (callCount > MAX_TOOL_CALLS_PER_TURN) {
      console.info(
        JSON.stringify({
          level: "info",
          type: "chat_tool_result",
          request_id: input.requestId,
          tool_name: name,
          status: "validation_error",
          call_number: callCount,
        }),
      );
      return { status: "validation_error", code: "tool_call_limit" };
    }
    try {
      const result = await execute();
      console.info(
        JSON.stringify({
          level: "info",
          type: "chat_tool_result",
          request_id: input.requestId,
          tool_name: name,
          status: result.status,
          code: result.status === "validation_error" ? result.code : undefined,
          invalid_fields:
            result.status === "validation_error" && Array.isArray(result.invalidFields)
              ? result.invalidFields.filter((field): field is string => typeof field === "string")
              : undefined,
          call_number: callCount,
        }),
      );
      return result;
    } catch {
      console.warn(
        JSON.stringify({
          level: "warn",
          type: "chat_tool_result",
          request_id: input.requestId,
          tool_name: name,
          status: "validation_error",
          call_number: callCount,
        }),
      );
      return { status: "validation_error", code: "tool_execution_failed" };
    }
  }

  const consultRule = tool({
    description:
      "Consulta uma regra normativa do cânone KALLISTIS por termos fornecidos pelo usuário.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    execute: ({ query }) =>
      runTool("consult_rule", async () => {
        const matches = retrieveCanonicalRules(query);
        if (!matches.length) return { status: "not_found", code: "rule_not_found" };
        return {
          status: "success",
          sourceId: matches[0].sourceId,
          sourceVersion: matches[0].sourceVersion,
          sections: matches.slice(0, 6).map((match) => ({
            section: match.section,
            text: safeText(match.text, MAX_RULE_TEXT),
          })),
        };
      }),
  });

  const consultCampaign = tool({
    description: "Consulta apenas a campanha já autorizada para a conversa atual.",
    // Keep malformed model output inside the tool contract. Zod rejecting an
    // invalid UUID here aborts the whole UI stream before the assistant can
    // recover and answer the user's actual question.
    inputSchema: z.object({ campaignId: z.string().optional() }).strict(),
    execute: ({ campaignId }) =>
      runTool("consult_campaign", async () => {
        if (campaignId && !z.string().uuid().safeParse(campaignId).success)
          return { status: "not_found", code: "invalid_campaign_id" };
        const runtime = createLocalChatRuntime(input.databaseUrl);
        try {
          const thread = await runtime.chat.getThreadById(input.userId, input.threadId);
          if (!thread?.campaignId) return { status: "not_found", code: "campaign_not_selected" };
          if (campaignId && campaignId !== thread.campaignId)
            return { status: "forbidden", code: "campaign_not_in_thread" };
          const campaign =
            thread.scope === "master"
              ? await runtime.campaigns?.getMasterAuthorized(input.userId, thread.campaignId)
              : await runtime.campaigns?.getAuthorized(input.userId, thread.campaignId);
          if (!campaign) return { status: "forbidden", code: "campaign_not_authorized" };
          return {
            status: "success",
            campaign: {
              id: campaign.id,
              name: campaign.name,
              mesaName: campaign.mesaName,
              status: campaign.status,
            },
          };
        } finally {
          runtime.close();
        }
      }),
  });

  const consultCharacter = tool({
    description: "Consulta uma ficha de personagem pertencente ao usuário autenticado.",
    inputSchema: z.object({ characterId: z.string().trim().min(1).max(200).optional() }).strict(),
    execute: ({ characterId }) =>
      runTool("consult_character", async () => {
        const runtime = createLocalChatRuntime(input.databaseUrl);
        try {
          if (input.scope !== "general" && !input.activeCharacterId)
            if (input.scope !== "character_creation")
              return { status: "not_found", code: "active_character_not_selected" };
          const characterIdForLookup =
            input.scope !== "general" ? input.activeCharacterId : characterId;
          const draft =
            input.scope === "character_creation" && !characterIdForLookup
              ? (await runtime.characters?.list(input.userId))?.find((item) =>
                  ["draft", "rejected"].includes(item.status),
                )
              : null;
          const characterIdToLookup = characterIdForLookup ?? draft?.id;
          if (!characterIdToLookup)
            return { status: "not_found", code: "active_character_not_selected" };
          const character = await runtime.characters?.get(input.userId, characterIdToLookup);
          if (!character || character.status === "archived")
            return { status: "not_found", code: "character_not_found" };
          return {
            status: "success",
            character: {
              id: character.id,
              name: character.name,
              playerName: character.playerName,
              status: character.status,
              version: character.version,
              povo: safeText(character.snapshot.povo, 100),
              oficio: safeText(
                Array.isArray(character.snapshot.trilhas)
                  ? (character.snapshot.trilhas[0] as { oficio?: unknown })?.oficio
                  : "",
                100,
              ),
              biography: safeText(character.snapshot.biografia, MAX_BIOGRAPHY),
            },
          };
        } finally {
          runtime.close();
        }
      }),
  });

  const updateCharacterCreationFields = tool({
    description: `Cria um preview estruturado do Character Forge e exige confirmação explícita; nunca grava nesta ferramenta. Use-a também para criar draft incompleto quando ainda não existir personagem estruturado; o servidor monta o snapshot-base. Reconstrua do histórico todos os valores escolhidos ainda válidos, inclusive listas em texto natural e distribuições com “demais/outras 0”. A distribuição inicial deve corresponder exatamente a atributosBase [${INITIAL_ATTRIBUTE_DISTRIBUTION.join(",")}] e periciasBase [${INITIAL_SKILL_DISTRIBUTION.join(",")}]; não a descreva como seis ou quatro pontos. Bônus de Ofício, Povo e Herança são separados. Envie somente escolhas do jogador. Em trilhas, não envie id, marco, ganhos, atributosGanhos, perícias fixas do Ofício nem técnica inicial: o servidor deriva esses dados do cânone. Não envie jogador, periciasProveniencia ou reservas. proficienciaConfirmada significa confirmação afirmativa de compatibilidade com o Ofício, não apenas que o jogador respondeu; nunca converta “sem proficiência”, “não” ou dúvida em true. A proficiência efetiva é verificada pelo cânone. Se houver resposta negativa ou dúvida, não crie preview: explique a regra aplicável e pergunte como a pessoa quer corrigir. Prefira esta ferramenta para a criação conversacional e não use propose_character_create para handoff. Se faltar escolha, houver ambiguidade ou a distribuição não fechar, pergunte sem criar preview. O servidor valida valores fechados no registry do Forge, deriva campos canônicos, preserva campos não enviados e vincula alterações à versão atual.`,
    inputSchema: z
      .object({
        patch: z
          .record(z.string(), z.unknown())
          .refine((value) => Object.keys(value).length > 0, "creation_patch_required"),
      })
      .strict(),
    execute: ({ patch }) =>
      runTool("update_character_creation_fields", async () => {
        const runtime = createLocalChatRuntime(input.databaseUrl);
        try {
          const result = await applyCharacterCreationPatch({
            runtime,
            userId: input.userId,
            threadId: input.threadId,
            activeCharacterId: input.activeCharacterId,
            scope: input.scope,
            patch,
            rawUserText: input.rawUserText,
            contextReference: input.contextReference,
          });
          return result ?? { status: "forbidden", code: "character_creation_experience_required" };
        } finally {
          runtime.close();
        }
      }),
  });

  const proposeCharacterBiographyUpdate = tool({
    description:
      "Prepara um preview de alteração de biografia; nunca grava sem confirmação explícita.",
    inputSchema: z
      .object({
        characterId: z.string().trim().min(1).max(200),
        biography: z.string().trim().min(1).max(MAX_BIOGRAPHY),
      })
      .strict(),
    execute: ({ characterId, biography }) =>
      runTool("propose_character_biography_update", async () => {
        if (input.scope !== "character_creation")
          return { status: "forbidden", code: "character_surface_required" };
        const runtime = createLocalChatRuntime(input.databaseUrl);
        try {
          const characterIdForLookup = input.activeCharacterId ?? characterId;
          if (!characterIdForLookup)
            return { status: "not_found", code: "active_character_not_selected" };
          const character = await runtime.characters?.get(input.userId, characterIdForLookup);
          if (!character) return { status: "not_found", code: "character_not_found" };
          if (!(["draft", "rejected"] as string[]).includes(character.status))
            return { status: "forbidden", code: "character_not_editable" };
          if (!runtime.mutations)
            return { status: "validation_error", code: "mutation_unavailable" };
          const mutation = await runtime.mutations.createCharacterBiographyPreview({
            id: randomUUID(),
            operationId: randomUUID(),
            userId: input.userId,
            threadId: input.threadId,
            characterId: character.id,
            expectedVersion: character.version,
            beforeBiography: safeText(character.snapshot.biografia, MAX_BIOGRAPHY),
            nextBiography: biography,
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
          return {
            status: "requires_confirmation",
            operation: mutation.operation,
            confirmationId: mutation.id,
            operationId: mutation.operationId,
            characterId: mutation.characterId,
            expectedVersion: mutation.expectedVersion,
            beforeBiography: mutation.beforeBiography,
            nextBiography: mutation.nextBiography,
            expiresAt: mutation.expiresAt,
          };
        } finally {
          runtime.close();
        }
      }),
  });

  const proposeCharacterCreate = tool({
    description:
      "Prepara um preview de criação de personagem. Quando a conversa já tiver coletado e normalizado os dados, envie o snapshot canônico COMPLETO nesta chamada — não envie apenas nome, povo, ofício e biografia. O snapshot deve seguir exatamente o modelo do Character Forge, com completo=true, origem, conceito {identidade, objetivo, perda}, trilhas completas (papel, chave, técnica inicial e perícias), atributosBase, periciasBase, periciasProveniencia, equipamento, vínculos, promessa, ferida e pergunta. Use apenas valores já normalizados pelo cânone (por exemplo, Guardião, nunca Guardiã). A validação canônica é obrigatória e nada grava sem confirmação explícita.",
    inputSchema: z
      .object({
        snapshot: z
          .object({
            ruleset: z.literal(CHARACTER_RULESET),
            nome: z.string().trim().min(2).max(160),
            jogador: z.string().trim().max(160).optional(),
            povo: z.enum(CHARACTER_PEOPLES),
            heranca: z.string().trim().min(1).max(160),
            origem: z.enum(CHARACTER_ORIGINS),
            conceito: z
              .object({
                identidade: z.string().trim().min(1).max(500),
                objetivo: z.string().trim().min(1).max(500),
                perda: z.string().trim().min(1).max(500),
              })
              .strict(),
            biografia: z.string().trim().max(MAX_BIOGRAPHY).optional(),
            completo: z.literal(true),
            trilhas: z
              .array(
                z
                  .object({
                    id: z.string().trim().min(1).max(160),
                    oficio: z.enum(CHARACTER_OFFICES),
                    marco: z.number().int().min(1).max(15),
                    papel: z.string().trim().min(1).max(160),
                    chave: z.string().trim().min(1).max(160),
                    tecnicas: z.array(z.string().trim().min(1)).min(1),
                    pericias: z.array(z.string().trim().min(1)).min(1),
                    pericaEscolhida: z.string().trim().max(160).optional(),
                    especializacoes: z.array(z.string().trim().min(1)).optional(),
                    ganhos: z.record(z.string(), z.unknown()),
                    atributosGanhos: z.record(z.string(), z.number()),
                  })
                  .passthrough(),
              )
              .min(1),
            trilhaAtiva: z.number().int().nonnegative(),
            atributosBase: z.record(z.string(), z.number()),
            periciasBase: z.record(z.string(), z.number()),
            periciasProveniencia: z.record(
              z.string(),
              z
                .object({
                  base: z.number(),
                  bonus: z.number(),
                  fontes: z.array(z.string().trim().min(1)),
                })
                .strict(),
            ),
            equipamento: z
              .object({
                arma: z.string().trim().min(1).max(160),
                armadura: z.string().trim().min(1).max(160),
                ferramenta: z.string().trim().min(1).max(160),
                consumiveis: z.array(z.string().trim().min(1)).min(2),
                extras: z.array(z.string().trim().min(1)),
                proficienciaConfirmada: z.literal(true),
              })
              .passthrough(),
            vinculos: z.array(z.string().trim().min(1)).min(3),
            promessa: z.string().trim().min(1).max(1000),
            ferida: z.string().trim().min(1).max(1000),
            pergunta: z.string().trim().min(1).max(1000),
          })
          .passthrough(),
      })
      .strict(),
    execute: ({ snapshot }) =>
      runTool("propose_character_create", async () => {
        if (input.scope !== "character_creation")
          return { status: "forbidden", code: "character_creation_experience_required" };
        const candidate = snapshot as CharacterSnapshot;
        const validation = validateCharacterSnapshot(candidate, true);
        if (!validation.ok) {
          console.info(
            JSON.stringify({
              level: "info",
              type: "character_create_snapshot_rejected",
              request_id: input.requestId,
              errors: validation.errors,
            }),
          );
          return {
            status: "validation_error",
            code: "character_snapshot_invalid",
            errors: validation.errors,
          };
        }
        const runtime = createLocalChatRuntime(input.databaseUrl);
        try {
          const existing = await runtime.characters?.list(input.userId);
          if (
            existing?.some(
              (character) =>
                character.name === String(candidate.nome) && character.status !== "archived",
            )
          )
            return { status: "validation_error", code: "character_name_already_exists" };
          if (!runtime.mutations)
            return { status: "validation_error", code: "mutation_unavailable" };
          const mutation = await runtime.mutations.createCharacterCreatePreview({
            id: randomUUID(),
            operationId: randomUUID(),
            userId: input.userId,
            threadId: input.threadId,
            plannedCharacterId: randomUUID(),
            payload: {
              snapshot: candidate,
              ruleset: CHARACTER_RULESET,
              mechanicalFingerprint: mechanicalFingerprint(candidate),
            },
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
          return {
            status: "requires_confirmation",
            operation: mutation.operation,
            confirmationId: mutation.id,
            operationId: mutation.operationId,
            name: String(candidate.nome),
            povo: String(candidate.povo),
            oficio: String((candidate.trilhas as Array<{ oficio: string }>)[0]?.oficio ?? ""),
            biografia: safeText(candidate.biografia, MAX_BIOGRAPHY),
            expiresAt: mutation.expiresAt,
          };
        } finally {
          runtime.close();
        }
      }),
  });

  const tools = {
    consult_rule: consultRule,
    consult_campaign: consultCampaign,
    consult_character: consultCharacter,
    ...(input.scope === "character_creation"
      ? {
          update_character_creation_fields: updateCharacterCreationFields,
        }
      : {}),
    ...(input.scope === "character_creation"
      ? {
          propose_character_biography_update: proposeCharacterBiographyUpdate,
          ...(input.scope === "character_creation"
            ? { propose_character_create: proposeCharacterCreate }
            : {}),
        }
      : {}),
  };

  return tools;
}

export const KALLISTIS_MAX_TOOL_CALLS_PER_TURN = MAX_TOOL_CALLS_PER_TURN;
