import { describe, expect, it } from "vitest";
import { argumentBonus, canSoloMasterAdjudicateOwnCoroAction, evocationCallNeedsRoll, gradeForMargin, maxCoroBars, maximumLearnedForms, resolveOpposition, resolveRoll, resolveVanguardContest, validateAcceptedArguments, validateLearnedForms, validateNexoCharacter, validateEvocationProfile } from "./engine";

describe("NEXO core", () => {
  it("calculates the approved Marco bonus", () => {
    expect(argumentBonus(1, 2)).toBe(4);
    expect(argumentBonus(3, 2)).toBe(4);
    expect(argumentBonus(4, 2)).toBe(6);
    expect(() => argumentBonus(16, 0)).toThrow("invalid_marco");
    expect(() => argumentBonus(1, 3)).toThrow("invalid_arguments");
    expect(argumentBonus(1, 0)).toBe(0);
    expect(argumentBonus(4, 2)).toBe(6);
    expect(argumentBonus(7, 2)).toBe(8);
  });

  it("accepts up to two distinct arguments and rejects duplicates after normalization", () => {
    expect(validateAcceptedArguments(["Guarda a passagem", "Protege a testemunha"])).toEqual(["Guarda a passagem", "Protege a testemunha"]);
    expect(() => validateAcceptedArguments(["Proteger a ponte", " proteger   a PONTE "])).toThrow("duplicate_arguments");
    expect(() => validateAcceptedArguments(["", "Outro"])).toThrow("invalid_arguments");
  });

  it("classifies all margin bands and keeps resonance non-automatic", () => {
    expect(gradeForMargin(-5)).toBe("severe_failure");
    expect(gradeForMargin(-1)).toBe("failure");
    expect(gradeForMargin(0)).toBe("success");
    expect(gradeForMargin(5)).toBe("strong_success");
    expect(gradeForMargin(10)).toBe("extraordinary");
    const result = resolveRoll({ marco: 1, argumentsAccepted: 0, resistance: 30, light: 4, shadow: 4 });
    expect(result.resonance).toBe(true);
    expect(result.grade).toBe("severe_failure");
    expect(result.predominance).toBe("balanced");
  });

  it("enforces the approved non-Weaver progression and Coro capacity", () => {
    expect(maximumLearnedForms(1, "Curador")).toEqual({ count: 1, grade: 0 });
    expect(maximumLearnedForms(8, "Curador")).toEqual({ count: 3, grade: 2 });
    expect(maximumLearnedForms(12, "Curador")).toEqual({ count: 5, grade: 3 });
    expect(maximumLearnedForms(12, "Tecelão")).toBeNull();
    expect([maxCoroBars(2), maxCoroBars(3), maxCoroBars(5)]).toEqual([1, 2, 3]);
  });

  it("allows self-adjudication only when the Mestre is the sole active Mesa identity", () => {
    expect(canSoloMasterAdjudicateOwnCoroAction({ memberRole: "mestre", contributorUserId: "u1", adjudicatorUserId: "u1", activeMesaParticipantUserIds: ["u1"] })).toBe(true);
    expect(canSoloMasterAdjudicateOwnCoroAction({ memberRole: "jogador", contributorUserId: "u1", adjudicatorUserId: "u1", activeMesaParticipantUserIds: ["u1"] })).toBe(false);
    // The second active identity blocks the exception even if that player's character has no active Papel.
    expect(canSoloMasterAdjudicateOwnCoroAction({ memberRole: "mestre", contributorUserId: "u1", adjudicatorUserId: "u1", activeMesaParticipantUserIds: ["u1", "u2"] })).toBe(false);
    expect(canSoloMasterAdjudicateOwnCoroAction({ memberRole: "mestre", contributorUserId: "u1", adjudicatorUserId: "u2", activeMesaParticipantUserIds: ["u1"] })).toBe(false);
  });

  it("rejects traditional mechanics and invalid influence totals in an NEXO sheet", () => {
    const base = { nome: "Teste", conceito: "Conceito", povo: "Aelvari", origem: "Criado na Luz", oficio: "Curador", especializacao: "Amparo", marco: 1, influencia: { luz: 5, escuridao: 5 }, promessa: "Promessa", vinculo: "Vínculo", experiencia: "Experiência", feridaMarcante: "Ferida", capacidades: { dons: [], tecnicas: [], formas: [], evocoes: [], chaves: [], equipamentos: [] }, estado: { marcasSombra: 0 } };
    expect(validateNexoCharacter(base)).toEqual([]);
    const { feridaMarcante, ...withoutWound } = base;
    void feridaMarcante;
    expect(validateNexoCharacter(withoutWound)).toEqual([]);
    expect(validateNexoCharacter({ ...withoutWound, feridaMarcante: 42 })).toContain("feridaMarcante_invalid");
    expect(validateNexoCharacter({ ...base, atributos: { corpo: 3 }, influencia: { luz: 2, escuridao: 2 } })).toContain("legacy_or_collective_fields_forbidden");
  });

  it("requires provenance for learned forms and the canonical evocation profile", () => {
    expect(validateLearnedForms([{ formId: "SILMA", grade: 0, source: "Mestra", condition: "Pacto" }], 1, "Curador", ["SILMA"])).toEqual([]);
    expect(validateLearnedForms([{ formId: "UNKNOWN", grade: 2 }], 1, "Curador", ["SILMA"])).toContain("noncanonical_form");
    expect(validateEvocationProfile({ anchor: "A", form: "B", impulse: "C", pact: "D", porte: "E" })).toEqual([]);
    expect(validateEvocationProfile({})).toHaveLength(5);
    expect(evocationCallNeedsRoll(true)).toBe(false);
    expect(evocationCallNeedsRoll(false)).toBe(true);
  });

  it("leaves opposing state unchanged on ties and rerolls each vanguard contest", () => {
    const tie = resolveRoll({ marco: 1, argumentsAccepted: 0, resistance: 10, light: 5, shadow: 4 });
    expect(resolveOpposition(tie, tie)).toEqual({ outcome: "tie", stateChanges: false });
    expect(resolveVanguardContest(tie, tie)).toEqual({ outcome: "tie", vanguard: null });
  });
});
