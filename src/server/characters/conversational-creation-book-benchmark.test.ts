import { describe, expect, it } from "vitest";
import { CONV02_BOOK_QUESTIONS } from "./conversational-creation-book-benchmark";
import { classifyCreationIntent, isStandaloneBookQuestion } from "./conversational-creation-ai";
import {
  KALLISTIS_BOOK_MEMORY,
  resolveBookMemoryEntities,
} from "./conversational-creation-memory-graph";

describe("CONV-02 book-question benchmark", () => {
  it("contains the 37 original questions with unique traceable ids", () => {
    expect(CONV02_BOOK_QUESTIONS).toHaveLength(37);
    expect(new Set(CONV02_BOOK_QUESTIONS.map((item) => item.id)).size).toBe(37);
    expect(CONV02_BOOK_QUESTIONS.every((item) => item.question.endsWith("?"))).toBe(true);
  });

  it("keeps every question in question/summary routing rather than character completion", () => {
    const results = CONV02_BOOK_QUESTIONS.map((item) => ({
      id: item.id,
      expected: item.expectedIntent,
      actual: classifyCreationIntent(item.question),
      standalone: isStandaloneBookQuestion(item.question),
    }));
    expect(
      results.filter((item) => item.expected !== item.actual),
      JSON.stringify(results),
    ).toEqual([]);
    expect(
      results.filter((item) => !item.standalone && item.actual !== "summary"),
      JSON.stringify(results),
    ).toEqual([]);
  });

  it("resolves mapped concepts and evidence-backed relations without inventing unmapped knowledge", () => {
    const relations = new Set(
      KALLISTIS_BOOK_MEMORY.relations.map((item) => `${item.from}:${item.relation}:${item.to}`),
    );
    for (const item of CONV02_BOOK_QUESTIONS) {
      const resolved = resolveBookMemoryEntities(item.question);
      expect(resolved.matchedEntityIds, item.id).toEqual(
        expect.arrayContaining(item.expectedEntities),
      );
      expect(resolved.chunkIds, item.id).toEqual(expect.arrayContaining(item.expectedSources));
      for (const relation of item.expectedRelations) {
        expect(relations.has(relation), `${item.id}: ${relation}`).toBe(true);
        expect(
          resolved.relations.map((found) => `${found.from}:${found.relation}:${found.to}`),
          item.id,
        ).toContain(relation);
      }
      if (!item.expectedEntities.length) expect(resolved.matchedEntityIds, item.id).toEqual([]);
    }
  });

  it("returns factual memory as verbatim, versioned source claims", () => {
    const resolved = resolveBookMemoryEntities("Como meu personagem Evocador define a Âncora?");
    expect(resolved.facts).toContainEqual(
      expect.objectContaining({
        id: "ancora-definicao",
        statement:
          "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
        sourceChunkId: "K12-0120",
        sourceLineRange: { startLine: 5266, endLine: 5266 },
        sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
        sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
        mechanicalStatus: "normative",
        authorityLevel: "canonical_book",
      }),
    );
  });

  it("traverses only relations connected to matched concepts and their explicit neighbors", () => {
    const attributes = resolveBookMemoryEntities("Como são distribuídos os seis atributos?");
    expect(attributes.relations).not.toContainEqual(
      expect.objectContaining({
        from: "oficios",
        relation: "related_to",
        to: "atributos-e-pericias",
      }),
    );

    const officeChange = resolveBookMemoryEntities(
      "Se mudar meu Ofício agora, quais escolhas precisam ser revistas?",
    );
    expect(officeChange.relations).toContainEqual(
      expect.objectContaining({
        from: "oficios",
        relation: "related_to",
        to: "atributos-e-pericias",
      }),
    );
  });

  it("retrieves the documented Anchor, Form, Impulse, and Pact relationship set for Evocation", () => {
    const resolved = resolveBookMemoryEntities(
      "Como a Âncora se relaciona com Forma, Impulso e Pacto na Evocação?",
    );
    expect(resolved.relations.map((item) => `${item.from}:${item.relation}:${item.to}`)).toEqual(
      expect.arrayContaining([
        "evocacao:requires:ancora",
        "evocacao:requires:forma-evocacao",
        "evocacao:requires:impulso-evocacao",
        "evocacao:requires:pacto-evocacao",
      ]),
    );
    expect(resolved.chunkIds).toContain("K12-0120");
    expect(resolved.facts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([
        "ancora-definicao",
        "forma-evocacao-definicao",
        "impulso-evocacao-definicao",
        "pacto-evocacao-definicao",
      ]),
    );
  });

  it("keeps every graph edge attached to a known entity and the pinned source", () => {
    const entityIds = new Set(KALLISTIS_BOOK_MEMORY.entities.map((entity) => entity.id));
    for (const entity of KALLISTIS_BOOK_MEMORY.entities) {
      expect(
        entity.relatedEntities.filter((id) => !entityIds.has(id)),
        `${entity.id} has dangling related entity IDs`,
      ).toEqual([]);
      expect(entity.sourceVersion).toBe(KALLISTIS_BOOK_MEMORY.sourceVersion);
      expect(entity.sourceHash).toBe(KALLISTIS_BOOK_MEMORY.sourceHash);
    }
    for (const relation of KALLISTIS_BOOK_MEMORY.relations) {
      expect(entityIds.has(relation.from), relation.from).toBe(true);
      expect(entityIds.has(relation.to), relation.to).toBe(true);
      expect(relation.sourceVersion).toBe(KALLISTIS_BOOK_MEMORY.sourceVersion);
      expect(relation.sourceHash).toBe(KALLISTIS_BOOK_MEMORY.sourceHash);
    }
    for (const fact of KALLISTIS_BOOK_MEMORY.facts) {
      expect(
        fact.entityIds.every((id) => entityIds.has(id)),
        fact.id,
      ).toBe(true);
      expect(fact.sourceVersion).toBe(KALLISTIS_BOOK_MEMORY.sourceVersion);
      expect(fact.sourceHash).toBe(KALLISTIS_BOOK_MEMORY.sourceHash);
    }
  });
});
