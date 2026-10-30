import { describe, expect, it } from "vitest";
import {
  CANONICAL_MANIFEST,
  getCanonicalCharacterChoices,
  getCanonicalOptionDefinition,
  getCanonicalSourceGap,
  getCanonicalTrocadoCreationRule,
} from "@/server/canonical/genesis-canonical-core";
import {
  createSnapshot,
  officeDetails,
  peopleHeritages,
  requiredFields,
  updateField,
} from "@/routes/api/nexo-character-creation";

describe("NEXO character creation canonical contract", () => {
  it("binds new snapshots to the editorial final revision and exposes the Origin gap", () => {
    const snapshot = createSnapshot("A character idea");
    expect(snapshot.canonical.revision).toBe("editorial-final-movimento-b-2026-10-30");
    expect(snapshot.canonical.markdownSha256).toBe(CANONICAL_MANIFEST.markdownSha256);
    expect(snapshot.canonical.pdfSha256).toBe(CANONICAL_MANIFEST.pdfSha256);
    expect(snapshot.originCatalogGap.note).toContain("catálogo fechado");
    expect(getCanonicalSourceGap("Origem").status).toBe("gap");
  });

  it("validates the selected People and only accepts one of its two canonical Heritages", () => {
    const initial = createSnapshot();
    const withPeople = updateField(initial, "povo", "Nimari");
    expect(withPeople.povoEvidence?.revision).toBe(CANONICAL_MANIFEST.revision);
    const options = peopleHeritages(withPeople.povoEvidence!);
    expect(options).toEqual(["Cartógrafo de Frestas", "Negociador de Risco"]);
    expect(getCanonicalOptionDefinition("peoples", "Nimari")[0]?.page).toBe(withPeople.povoEvidence?.page);
    expect(() => updateField(withPeople, "herancaPovo", "Herança inventada")).toThrow("invalid_heritage_for_povo");
    const chosen = updateField(withPeople, "herancaPovo", "Cartógrafo de Frestas");
    expect(chosen.fields.herancaPovo).toBe("Cartógrafo de Frestas");
  });

  it("derives an Office's allowed Roles and initial Technique from the same canonical definition", () => {
    const choices = getCanonicalCharacterChoices();
    const guard = choices.offices.items.find((item) => item.name === "Guardião");
    expect(guard).toBeDefined();
    const details = officeDetails("Guardião");
    expect(details.evidence.revision).toBe(CANONICAL_MANIFEST.revision);
    expect(details.roles).toEqual(["Bastião", "Amparo"]);
    expect(details.initialTechnique).toBe("Interpor");
    const withOffice = updateField(createSnapshot(), "oficio", "Guardião");
    expect(withOffice.learnedCapabilities[0]?.name).toBe("Interpor");
    expect(withOffice.learnedCapabilities[0]?.evidence.markdownSha256).toBe(CANONICAL_MANIFEST.markdownSha256);
    expect(() => updateField(withOffice, "papel", "Artilharia")).toThrow("invalid_papel_for_office");
  });

  it("enforces the ten narrative point total and never adds legacy numeric fields", () => {
    const initial = createSnapshot();
    expect(() => updateField(initial, "distribuicao", { luz: 6, escuridao: 3 })).toThrow("invalid_distribuicao");
    const distributed = updateField(initial, "distribuicao", { luz: 6, escuridao: 4 });
    expect(Number(distributed.fields.luz) + Number(distributed.fields.escuridao)).toBe(10);
    expect(Object.keys(distributed.fields)).not.toEqual(expect.arrayContaining(["forca", "agilidade", "vitalidade", "lucidez", "fluxo", "fôlego"]));
    expect(requiredFields(distributed.fields)).toContain("povo");
  });

  it("requires exactly one canonical Trocado mode only when the character is marked Trocado", () => {
    const rule = getCanonicalTrocadoCreationRule();
    expect(rule.status).toBe("available");
    if (rule.status !== "available") return;
    const ordinary = createSnapshot();
    expect(ordinary.fields.origemTrocado).toBe(false);
    expect(requiredFields(ordinary.fields)).not.toContain("modoTrocado");
    expect(() => updateField(ordinary, "modoTrocado", rule.options[0])).toThrow("trocado_origin_required");

    const trocado = updateField(ordinary, "origemTrocado", true);
    expect(trocado.trocadoEvidence?.page).toBe(92);
    expect(requiredFields(trocado.fields)).toContain("modoTrocado");
    expect(() => updateField(trocado, "modoTrocado", "Herança inventada")).toThrow("invalid_modoTrocado");

    const chosen = updateField(trocado, "modoTrocado", rule.options[1]);
    expect(chosen.fields.modoTrocado).toBe("ressonância involuntária do mundo de nascimento");
    expect(requiredFields(chosen.fields)).not.toContain("modoTrocado");
    const ordinaryAgain = updateField(chosen, "origemTrocado", false);
    expect(ordinaryAgain.fields.modoTrocado).toBe("");
    expect(ordinaryAgain.trocadoEvidence).toBeNull();
  });
});
