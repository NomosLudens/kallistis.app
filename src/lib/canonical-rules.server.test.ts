import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import generatedBookSearchIndex from "./canonical-book-search-index.generated.json";
import {
  BOOK_SOURCE_FILE,
  BOOK_SOURCE_ID,
  BOOK_SOURCE_VERSION,
  renderCanonicalRuleContext,
  retrieveCanonicalCreationSections,
  retrieveCanonicalSectionByHeading,
  retrieveCanonicalRules,
} from "./canonical-rules.server";
import { BOOK_SOURCE_SHA256 } from "@/server/characters/conversational-creation-book-manifest";

describe("current NEXO canonical retrieval", () => {
  const source = readFileSync(resolve(process.cwd(), "CANON", BOOK_SOURCE_FILE), "utf8");

  it("binds search offsets to the complete 2026-11-05 manuscript", () => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(BOOK_SOURCE_SHA256);
    expect(generatedBookSearchIndex.sourceHash).toBe(BOOK_SOURCE_SHA256);
    expect(generatedBookSearchIndex.sections.length).toBeGreaterThan(1000);
  });

  it("uses the M3 specialization rule and current provenance", () => {
    const result = retrieveCanonicalRules("Quando a Especialização do Ofício é escolhida?");
    expect(result.length).toBeGreaterThan(0);
    expect(retrieveCanonicalSectionByHeading("Regras gerais dos Ofícios")?.text).toContain("Ao alcançar o Marco 3");
    expect(result.every((item) => item.sourceId === BOOK_SOURCE_ID)).toBe(true);
    expect(result.every((item) => item.sourceVersion === BOOK_SOURCE_VERSION)).toBe(true);
    expect(result.every((item) => item.sourceHash === BOOK_SOURCE_SHA256)).toBe(true);
    expect(renderCanonicalRuleContext("Quando a Especialização do Ofício é escolhida?")).toContain(BOOK_SOURCE_FILE);
  });

  it("carries the authorial pending status into contexts without treating proposals as rules", () => {
    const context = renderCanonicalRuleContext("H1 Fortuna: qual regra aplicar?");
    expect(context).toContain("H1 Fortuna");
    expect(context).toContain("não homologadas; não aplicar como regra");
    expect(context).toContain("aguardam aprovação");
    expect(context).not.toContain("proposta operacional detalhada");
  });

  it("retrieves current character creation and office progression sections", () => {
    const sections = retrieveCanonicalCreationSections(
      "SMOKE de criação: explique Origem, Ofício, perícias e Vínculos no NEXO.",
    );
    expect(sections?.map(({ section }) => section)).toEqual([
      "Criação de personagem NEXO",
      "Regras gerais dos Ofícios",
    ]);
    expect(sections?.[0]?.text).toContain("Povo, Origem e Ofício são escolhas distintas");
    expect(sections?.[1]?.text).toContain("Ao alcançar o Marco 3");
  });

  it("looks up exact headings only in the current manuscript", () => {
    const heading = "Criação de personagem NEXO";
    const section = retrieveCanonicalSectionByHeading(heading);
    expect(section?.section).toBe(heading);
    expect(section?.sourceHash).toBe(BOOK_SOURCE_SHA256);
    expect(section?.text).toContain("Marco inicial (M1 salvo decisão de campanha)");
    expect(retrieveCanonicalSectionByHeading("Nenhuma seção chamada assim")).toBeNull();
  });
});
