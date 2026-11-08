import { randomInt } from "node:crypto";
import { isSpecializationEligibleAtMarco } from "@/server/characters/character-canon";

export const NEXO_RULESET = "KALLISTIS_NEXO_1" as const;
export const NEXO_RULESETS = [NEXO_RULESET, "KALLISTIS_NEXO_FINAL"] as const;
export const NEXO_RULESETS_POSTGRES_ARRAY = `{${NEXO_RULESETS.join(",")}}`;
export function isNexoRuleset(value: unknown): value is (typeof NEXO_RULESETS)[number] {
  return typeof value === "string" && (NEXO_RULESETS as readonly string[]).includes(value);
}
export type NexoGrade = "severe_failure" | "failure" | "success" | "strong_success" | "extraordinary";
export type NexoRoll = {
  light: number; shadow: number; arguments: number; bonus: number; total: number;
  resistance: number; margin: number; grade: NexoGrade;
  predominance: "light" | "shadow" | "balanced"; resonance: boolean;
};

export function argumentBonus(marco: number, argumentsAccepted: number): number {
  if (!Number.isInteger(marco) || marco < 1 || marco > 15) throw new Error("invalid_marco");
  if (!Number.isInteger(argumentsAccepted) || argumentsAccepted < 0 || argumentsAccepted > 2)
    throw new Error("invalid_arguments");
  return argumentsAccepted * (2 + Math.floor((marco - 1) / 3));
}

export function validateAcceptedArguments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 2 || input.some((value) => typeof value !== "string" || !value.trim() || value.length > 500))
    throw new Error("invalid_arguments");
  const values = input.map((value) => (value as string).trim());
  const normalized = values.map((value) => value.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"));
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate_arguments");
  return values;
}

export function validateProposedArguments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 2 || input.some((value) => typeof value !== "string" || !value.trim() || value.length > 500))
    throw new Error("invalid_arguments");
  const values = input.map((value) => (value as string).trim());
  const normalized = values.map((value) => value.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"));
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate_arguments");
  return values;
}

export function gradeForMargin(margin: number): NexoGrade {
  if (margin <= -5) return "severe_failure";
  if (margin <= -1) return "failure";
  if (margin <= 4) return "success";
  if (margin <= 9) return "strong_success";
  return "extraordinary";
}

export function resolveRoll(input: {
  marco: number; argumentsAccepted: number; resistance: number; light: number; shadow: number;
}): NexoRoll {
  if (!Number.isInteger(input.resistance) || input.resistance < 0 || input.resistance > 100)
    throw new Error("invalid_resistance");
  for (const die of [input.light, input.shadow])
    if (!Number.isInteger(die) || die < 1 || die > 10) throw new Error("invalid_die");
  const bonus = argumentBonus(input.marco, input.argumentsAccepted);
  const total = input.light + input.shadow + bonus;
  const margin = total - input.resistance;
  return {
    light: input.light, shadow: input.shadow, arguments: input.argumentsAccepted, bonus,
    total, resistance: input.resistance, margin, grade: gradeForMargin(margin),
    predominance: input.light > input.shadow ? "light" : input.shadow > input.light ? "shadow" : "balanced",
    resonance: input.light === input.shadow,
  };
}

export function rollNexo(input: { marco: number; argumentsAccepted: number; resistance: number }): NexoRoll {
  return resolveRoll({ ...input, light: randomInt(1, 11), shadow: randomInt(1, 11) });
}

export function maximumLearnedForms(marco: number, office: string) {
  if (!Number.isInteger(marco) || marco < 1 || marco > 15) throw new Error("invalid_marco");
  if (office === "Tecelão") return null; // The canonical Weaver progression remains its own ruleset.
  if (marco <= 2) return { count: 1, grade: 0 };
  if (marco === 3) return { count: 2, grade: 0 };
  if (marco <= 5) return { count: 2, grade: 1 };
  if (marco <= 7) return { count: 3, grade: 1 };
  if (marco === 8) return { count: 3, grade: 2 };
  if (marco <= 11) return { count: 4, grade: 2 };
  return { count: 5, grade: 3 };
}

export function maxCoroBars(characterCount: number) {
  if (!Number.isInteger(characterCount) || characterCount < 0) throw new Error("invalid_character_count");
  return characterCount <= 2 ? 1 : characterCount <= 4 ? 2 : 3;
}

export function canSoloMasterAdjudicateOwnCoroAction(input: {
  memberRole: string; contributorUserId: string; adjudicatorUserId: string;
  activeMesaParticipantUserIds: readonly string[];
}): boolean {
  const participants = [...new Set(input.activeMesaParticipantUserIds)];
  return input.memberRole === "mestre"
    && input.contributorUserId === input.adjudicatorUserId
    && participants.length === 1
    && participants[0] === input.contributorUserId;
}

export function validateLearnedForms(input: unknown, marco: number, office: string, canonicalIds: readonly string[]) {
  if (office === "Tecelão") return [] as string[]; // Do not replace its existing progression.
  const cap = maximumLearnedForms(marco, office);
  if (!Array.isArray(input)) return ["invalid_learned_forms"];
  const errors: string[] = [];
  if (input.length > (cap?.count ?? 0)) errors.push("learned_form_count_exceeded");
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object") { errors.push("invalid_learned_form"); continue; }
    const form = item as Record<string, unknown>;
    const id = String(form.formId || "");
    if (!canonicalIds.includes(id)) errors.push("noncanonical_form");
    if (seen.has(id)) errors.push("duplicate_form");
    seen.add(id);
    if (!Number.isInteger(form.grade) || Number(form.grade) < 0 || Number(form.grade) > (cap?.grade ?? 0)) errors.push("form_grade_exceeded");
    if (typeof form.source !== "string" || !form.source.trim()) errors.push("form_source_required");
    if (typeof form.condition !== "string" || !form.condition.trim()) errors.push("form_condition_required");
  }
  return errors;
}

export function validateEvocationProfile(input: unknown) {
  if (!input || typeof input !== "object") return ["invalid_evocation"];
  const value = input as Record<string, unknown>;
  const required = ["anchor", "form", "impulse", "pact", "porte"];
  return required.filter((key) => typeof value[key] !== "string" || !String(value[key]).trim()).map((key) => `evocation_${key}_required`);
}

export function evocationCallNeedsRoll(relationshipVerifiedAndCompatible: boolean) {
  return !relationshipVerifiedAndCompatible;
}

export function resolveOpposition(left: NexoRoll, right: NexoRoll) {
  if (left.margin === right.margin) return { outcome: "tie" as const, stateChanges: false };
  return { outcome: left.margin > right.margin ? "left_wins" as const : "right_wins" as const, stateChanges: true };
}

export function resolveVanguardContest(left: NexoRoll, right: NexoRoll) {
  if (left.margin === right.margin) return { outcome: "tie" as const, vanguard: null };
  return { outcome: "decided" as const, vanguard: left.margin > right.margin ? "left" as const : "right" as const };
}

export function validateNexoCharacter(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["invalid_character"];
  const s = value as Record<string, unknown>;
  const errors: string[] = [];
  const required = ["nome", "conceito", "povo", "origem", "oficio", "promessa", "vinculo", "experiencia"];
  for (const key of required) if (typeof s[key] !== "string" || !String(s[key]).trim()) errors.push(`${key}_required`);
  if (s.feridaMarcante !== undefined && typeof s.feridaMarcante !== "string") errors.push("feridaMarcante_invalid");
  if (!Number.isInteger(s.marco) || Number(s.marco) < 1 || Number(s.marco) > 15) errors.push("invalid_marco");
  const specialization = typeof s.especializacao === "string" ? s.especializacao.trim() : "";
  if (specialization && !isNexoSpecializationEligible(Number(s.marco))) errors.push("specialization_locked_before_marco_3");
  if (!specialization && isNexoSpecializationEligible(Number(s.marco))) errors.push("especializacao_required");
  const influence = s.influencia as Record<string, unknown> | undefined;
  if (!influence || !Number.isInteger(influence.luz) || !Number.isInteger(influence.escuridao) || Number(influence.luz) < 0 || Number(influence.escuridao) < 0 || Number(influence.luz) + Number(influence.escuridao) !== 10) errors.push("influences_must_sum_10");
  const state = s.estado as Record<string, unknown> | undefined;
  const shadow = state?.marcasSombra;
  if (!Number.isInteger(shadow) || Number(shadow) < 0 || Number(shadow) > 6) errors.push("invalid_shadow_marks");
  if (s.atributos !== undefined || s.pericias !== undefined || s.fluxo !== undefined || s.folego !== undefined || s.coro !== undefined) errors.push("legacy_or_collective_fields_forbidden");
  const capacities = s.capacidades as Record<string, unknown> | undefined;
  if (!capacities || !Array.isArray(capacities.dons) || !Array.isArray(capacities.tecnicas) || !Array.isArray(capacities.formas) || !Array.isArray(capacities.evocoes) || !Array.isArray(capacities.chaves) || !Array.isArray(capacities.equipamentos)) errors.push("invalid_capacities");
  return errors;
}

export function isNexoSpecializationEligible(marco: number): boolean {
  return isSpecializationEligibleAtMarco(marco);
}

export function validateNexoCanon(snapshot: unknown, canon: {
  peoples: readonly { name: string }[]; origins: readonly string[]; offices: readonly { name: string; specializations: readonly { name: string }[] }[];
}): string[] {
  const errors = validateNexoCharacter(snapshot);
  if (!snapshot || typeof snapshot !== "object") return errors;
  const s = snapshot as Record<string, unknown>;
  if (!canon.peoples.some((entry) => entry.name === s.povo)) errors.push("noncanonical_people");
  if (!canon.origins.includes(String(s.origem))) errors.push("noncanonical_origin");
  const office = canon.offices.find((entry) => entry.name === s.oficio);
  const specialization = typeof s.especializacao === "string" ? s.especializacao.trim() : "";
  if (!office) errors.push("noncanonical_office");
  else if (specialization && !office.specializations.some((entry) => entry.name === specialization)) errors.push("noncanonical_specialization");
  return errors;
}

export function validateNexoCharacterCreation(snapshot: unknown, canon: {
  peoples: readonly { name: string }[]; origins: readonly string[]; offices: readonly { name: string; specializations: readonly { name: string }[] }[];
}): string[] {
  const errors = validateNexoCanon(snapshot, canon);
  if (!snapshot || typeof snapshot !== "object" || Number((snapshot as Record<string, unknown>).marco) !== 1)
    errors.push("nexo_creation_must_start_at_marco_1");
  if (snapshot && typeof snapshot === "object") {
    const value = snapshot as Record<string, unknown>;
    if (typeof value.perguntaPessoal !== "string" || !value.perguntaPessoal.trim())
      errors.push("perguntaPessoal_required");
    if (typeof value.manifestacao_pessoal !== "string" || !value.manifestacao_pessoal.trim())
      errors.push("manifestacao_pessoal_required");
  }
  return errors;
}
