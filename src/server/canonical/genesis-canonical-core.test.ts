import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_MANIFEST,
  getCanonicalCharacterChoices,
  getCanonicalCharacterSources,
  getCanonicalOptionDefinition,
  getCanonicalSourceGap,
  getCanonicalTrocadoCreationRule,
  searchCanonical,
} from "./genesis-canonical-core";

const root = process.cwd();
const sha256 = (path: string) => createHash("sha256").update(readFileSync(`${root}/${path}`)).digest("hex");

describe("Genesis single canonical authority", () => {
  it("binds the executable index to the exact current Markdown and PDF bytes", () => {
    expect(sha256(CANONICAL_MANIFEST.markdownFile)).toBe(CANONICAL_MANIFEST.markdownSha256);
    expect(sha256(CANONICAL_MANIFEST.pdfFile)).toBe(CANONICAL_MANIFEST.pdfSha256);
    expect(CANONICAL_MANIFEST.pageCount).toBe(187);
    expect(CANONICAL_MANIFEST.editorialMarker).toBe("MOVIMENTO B — COMUNIDADES VIVAS");
    expect(CANONICAL_MANIFEST.editorialMarkerPdfPage).toBe(45);
  });

  it("provides the book's Povo and Ofício options with page provenance", () => {
    const choices = getCanonicalCharacterChoices();
    expect(choices.peoples.status).toBe("available");
    expect(choices.peoples.items.map((item) => item.name)).toEqual([
      "Aelvari", "Kragor", "Draken", "Nomos", "Livres", "Dóreos", "Teriantes", "Nimari", "Vitrálios",
    ]);
    expect(choices.offices.status).toBe("available");
    expect(choices.offices.items.map((item) => item.name)).toEqual([
      "Guardião", "Duelista", "Atirador", "Tecelão", "Curador", "Evocador", "Artífice", "Batedor", "Satirista",
    ]);
    for (const item of [...choices.peoples.items, ...choices.offices.items]) {
      expect(item.pageNumber).toBeGreaterThan(64);
      expect(item.pageNumber).toBeLessThan(124);
      expect(item.source?.canonicalId).toBe(CANONICAL_MANIFEST.canonicalId);
      expect(item.source?.markdownSha256).toBe(CANONICAL_MANIFEST.markdownSha256);
      expect(item.source?.pdfSha256).toBe(CANONICAL_MANIFEST.pdfSha256);
      expect(item.source?.book).toBe("LIVRO III — SISTEMA");
      expect(item.source?.section).toBe(item.name);
    }
    const aelvari = getCanonicalOptionDefinition("peoples", "Aelvari");
    expect(aelvari).toHaveLength(1);
    expect(aelvari[0].text).toContain("Cronista");
    expect(aelvari[0].section).toBe("Aelvari");
  });

  it("returns exact source evidence to character rules and Chat retrieval from the same index", () => {
    const creation = getCanonicalCharacterSources("Criação de personagem NEXO", 4);
    expect(creation.length).toBeGreaterThan(0);
    expect(creation.every((item) => item.book === "LIVRO III — SISTEMA")).toBe(true);
    expect(creation.every((item) => item.canonicalId === CANONICAL_MANIFEST.canonicalId)).toBe(true);
    expect(creation.every((item) => item.markdownSha256 === CANONICAL_MANIFEST.markdownSha256)).toBe(true);
    expect(creation.every((item) => item.pdfSha256 === CANONICAL_MANIFEST.pdfSha256)).toBe(true);
    expect(creation.map((item) => item.page)).toContain(92);
    expect(creation.some((item) => item.text.includes("dez pontos narrativos distribuídos entre Luz e Escuridão"))).toBe(true);

    const communities = searchCanonical("MOVIMENTO B comunidades vivas", { books: ["LIVRO II — ATLAS"], limit: 3 });
    expect(communities.some((item) => item.page === 45
      && item.headings.includes("MOVIMENTO B — COMUNIDADES VIVAS")
      && item.sectionPath.includes("MOVIMENTO B — COMUNIDADES VIVAS"))).toBe(true);
  });

  it("signals the absence of a closed Origem catalog instead of restoring legacy choices", () => {
    const origins = getCanonicalCharacterChoices().origins;
    expect(origins.status).toBe("gap");
    expect(origins.items).toEqual([]);
    const gap = getCanonicalSourceGap("Origem");
    expect(gap.status).toBe("gap");
    expect(gap.evidence.some((item) => item.page === 92 && item.text.includes("Povo, Origem e Ofício são escolhas distintas"))).toBe(true);
  });

  it("exposes only the conditional Trocado modes stated on canonical page 92", () => {
    const rule = getCanonicalTrocadoCreationRule();
    expect(rule.status).toBe("available");
    if (rule.status !== "available") return;
    expect(rule.condition).toContain("Origem Trocado nasceu em um mundo e foi criada no outro");
    expect(rule.options).toEqual([
      "adaptação do mundo de criação",
      "ressonância involuntária do mundo de nascimento",
    ]);
    expect(rule.rollException).toContain("exceção de três d10");
    expect(rule.evidence.page).toBe(92);
    expect(rule.evidence.revision).toBe(CANONICAL_MANIFEST.revision);
    expect(rule.evidence.markdownSha256).toBe(CANONICAL_MANIFEST.markdownSha256);
    expect(rule.evidence.pdfSha256).toBe(CANONICAL_MANIFEST.pdfSha256);
  });

  it("returns no substitute evidence when a query is absent from the canonical source", () => {
    expect(searchCanonical("ZXQ-UNDEFINED-CANONICAL-CHOICE-9F3A")).toEqual([]);
    expect(getCanonicalCharacterSources("ZXQ-UNDEFINED-CANONICAL-CHOICE-9F3A")).toEqual([]);
  });
});
