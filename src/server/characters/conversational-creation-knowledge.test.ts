import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "@/server/local-core/postgres";
import { retrieveCanonicalRules } from "@/lib/canonical-rules.server";
import type { CharacterSnapshot } from "./character-canon";
import {
  canonicalEvidenceIdsForRevalidation,
  emptyCreationConversationMemory,
  canonicalRuleEvidenceId,
  creationConversationMemoryCsv,
  readCreationConversationMemory,
  routeR1Candidates,
  routeR2RefineCandidates,
  routeR3SelectChunks,
  selectRelevantCreationMemory,
  saveCreationConversationMemory,
  searchCreationBook,
  updateCreationConversationMemory,
} from "./conversational-creation-knowledge";

function executor(
  rows: Record<string, unknown>[] = [],
): SqlExecutor & { queryMock: ReturnType<typeof vi.fn> } {
  const queryMock = vi.fn(async () => rows);
  return {
    query: queryMock as unknown as SqlExecutor["query"],
    queryMock,
    close: vi.fn(),
  };
}

describe("conversation book retrieval and persistent memory", () => {
  it("routes 200 retrieved candidates through 50, 10, and 4 before loading source text", async () => {
    const hits = Array.from({ length: 200 }, (_, index) => ({
      chunk_id: `K12-${String(index + 1).padStart(4, "0")}`,
      book_title: "KALLISTIS — LIVRO COMPLETO 2.0",
      chapter: "Parte QA",
      section: "Regras",
      heading_path: ["Regras", "Atributos"],
      start_line: index + 1,
      end_line: index + 2,
      content: `Trecho ${index + 1}`,
      route4_id: `R4-${Math.ceil((index + 1) / 50)}`,
      route10_id: `R10-${String(Math.ceil((index + 1) / 5)).padStart(3, "0")}`,
      route50_id: `R50-${String(index + 1).padStart(3, "0")}`,
      keywords: [],
      entities: [],
      rule_tags: [],
      related_chunk_ids: [],
      score: 50 - index,
    }));
    const sql = executor(hits);

    const r1 = routeR1Candidates(hits);
    const r2 = routeR2RefineCandidates(r1, "como funcionam os atributos?");
    const r3 = routeR3SelectChunks(r2);
    const sources = await searchCreationBook(sql, "como funcionam os atributos?");

    expect(sql.queryMock).toHaveBeenCalledTimes(2);
    expect(sql.queryMock.mock.calls[0]?.[0]).toContain("LIMIT 200");
    expect(r1).toHaveLength(50);
    expect(r2).toHaveLength(10);
    expect(r3).toHaveLength(4);
    expect(sql.queryMock.mock.calls[0]?.[1]).toEqual([
      "como funcionam os atributos?",
      expect.arrayContaining(["atributos", "funcionam"]),
      ["attributes"],
      "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
      expect.arrayContaining(["K12-0106", "K12-0120"]),
    ]);
    expect(sources).toHaveLength(4);
    expect(sources[0]?.chunkId).toBe("K12-0106");
    expect(sources.every((source) => source.text.startsWith("Trecho "))).toBe(true);
  });

  it("keeps the normative Evocation Anchor source ahead of a high-scoring lexical distractor", async () => {
    const graphIds = ["K12-0093", "K12-0120", "K12-0123"];
    const hits = Array.from({ length: 200 }, (_, index) => {
      const chunkId = `K12-${String(index + 1).padStart(4, "0")}`;
      return {
        chunk_id: chunkId,
        book_title: "KALLISTIS — Livro consolidado",
        chapter: chunkId === "K12-0120" ? "Evocações" : "Parte QA",
        section: chunkId === "K12-0120" ? "Âncora" : "Regras",
        heading_path: ["Evocações", "Âncora"],
        start_line: 5256,
        end_line: 5301,
        content:
          chunkId === "K12-0120"
            ? "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído."
            : chunkId === "K12-0093"
              ? "Evocador. **Papéis:** Artilharia, Amparo ou Bastião."
              : `Trecho ${chunkId}`,
        route4_id: "R4-QA",
        route10_id: `R10-${chunkId}`,
        route50_id: `R50-${chunkId}`,
        keywords: [],
        entities: [],
        rule_tags: [],
        related_chunk_ids: [],
        score: chunkId === "K12-0199" ? 1000 : graphIds.includes(chunkId) ? 0.1 : 50 - index,
      };
    });
    const sql = executor(hits);
    const sources = await searchCreationBook(
      sql,
      "Como meu personagem Evocador define a Âncora e quais papéis pode exercer?",
    );

    expect(sources.map((source) => source.chunkId)).toContain("K12-0120");
    expect(sources.map((source) => source.chunkId)).toContain("K12-0093");
    expect(sources.find((source) => source.chunkId === "K12-0093")?.text).toContain(
      "**Papéis:** Artilharia, Amparo ou Bastião",
    );
    expect(sources.map((source) => source.chunkId)).not.toContain("K12-0199");
    expect(sql.queryMock.mock.calls[0]?.[1]?.[4]).toContain("K12-0120");
  });

  it("persists six workbook tabs from server-authoritative state and exact player narrative", () => {
    const snapshot = {
      nome: "Ayla",
      serverCreationProgress: {
        confirmedPaths: ["povo"],
        pendingProposals: [{ path: "origem", value: "Outro" }],
      },
      povo: "Livres",
    } as unknown as CharacterSnapshot;
    const memory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot,
      userMessage: "Minha personagem cresceu entre cartógrafos.",
      assistantMessage: "Que lembrança marcou sua personagem?",
      intent: "narrative",
      sources: [
        {
          chunkId: "K12-0012",
          sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
          sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
          bookTitle: "Livro",
          chapter: "Parte I",
          section: "Origens",
          headingPath: ["Parte I", "Origens"],
          startLine: 120,
          endLine: 132,
          text: "Contexto do livro",
          route4Id: "R4-1",
          route10Id: "R10-1",
          route50Id: "R50-1",
          relatedChunkIds: [],
          ruleTags: ["narrative"],
        },
      ],
    });

    expect(memory.narrativeIdentity).toEqual([
      expect.objectContaining({
        text: "Minha personagem cresceu entre cartógrafos.",
        source: "player",
      }),
    ]);
    expect(memory.choices).toContainEqual(
      expect.objectContaining({
        fieldPath: "povo",
        currentValue: "Livres",
        status: "CONFIRMED",
      }),
    );
    expect(memory.pendingContradictions).toEqual([
      { path: "origem", value: "Outro", status: "proposed" },
    ]);
    expect(memory.consultedSources).toEqual([
      {
        chunkId: "K12-0012",
        chapter: "Parte I",
        section: "Origens",
        startLine: 120,
        endLine: 132,
        sourceKind: "book",
        sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
        sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
      },
    ]);
    expect(memory.inferences).toEqual([]);
  });

  it("does not search canonical rules for an entire history of unverified answers", async () => {
    const memory = emptyCreationConversationMemory();
    for (let index = 0; index < 60; index++) {
      memory.qa.push({
        qaId: `unverified-${index}`,
        questionShort: `Como funciona regra ${index}?`,
        answerShort: "Sem evidência confirmada.",
        sourceChunkIds: [],
        sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
        sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
        confidence: "unverified",
        supportStatus: "UNVERIFIED",
        status: "answered",
        createdAt: "2026-10-24T00:00:00.000Z",
      });
    }
    expect(canonicalEvidenceIdsForRevalidation(memory.qa)).toEqual([]);
    const sql = executor([
      {
        qa: memory.qa,
        narrative_identity: [],
        choices: [],
        inferences: [],
        pending_contradictions: [],
        consulted_sources: [],
      },
    ]);
    const reloaded = await readCreationConversationMemory(sql, "character-qa", "owner-qa");
    expect(reloaded.qa).toHaveLength(60);
    expect(reloaded.qa.every((item) => item.supportStatus === "UNVERIFIED")).toBe(true);
    expect(sql.queryMock).toHaveBeenCalledTimes(1);
  });

  it("scopes persistent memory reads to both conversation and owner", async () => {
    const sql = executor([]);
    await readCreationConversationMemory(sql, "character-1", "user-1");
    expect(sql.queryMock).toHaveBeenCalledWith(
      expect.stringContaining("character_id = $1 AND owner_user_id = $2"),
      ["character-1", "user-1"],
    );
  });

  it("writes the entire workbook with an owner-scoped upsert", async () => {
    const sql = executor([]);
    await saveCreationConversationMemory({
      sql,
      characterId: "character-1",
      ownerUserId: "user-1",
      memory: emptyCreationConversationMemory(),
    });
    expect(sql.queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (character_id) DO UPDATE"),
      ["character-1", "user-1", "[]", "[]", "[]", "[]", "[]", "[]", null],
    );
  });

  it("exports the six conversation sheets as escaped CSV without dropping provenance", () => {
    const memory = emptyCreationConversationMemory();
    memory.qa.push({
      qaId: "turn-1",
      questionShort: 'O que é "Sintonia"?',
      answerShort: "Resposta curta",
      sourceChunkIds: ["K12-0042"],
      sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
      confidence: "source-backed",
      status: "answered",
      createdAt: "2026-10-23T00:00:00.000Z",
    });

    const csv = creationConversationMemoryCsv("conversation-1", memory);

    expect(csv).toContain('"conversation_id","sheet","record"');
    expect(csv).toContain('"O que é ""Sintonia""?"');
    expect(csv).toContain('"[""K12-0042""]"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("reuses only current, source-backed answers relevant to the query", () => {
    const memory = emptyCreationConversationMemory();
    memory.qa.push(
      {
        qaId: "current",
        questionShort: "Como funciona Sintonia?",
        answerShort: "Limita o uso de formas mágicas.",
        sourceChunkIds: ["K12-0042"],
        sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
        sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
        confidence: "source-backed",
        supportStatus: "VERIFIED",
        supportedClaims: [
          {
            claim: "Sintonia limita formas mágicas",
            quote: "Sintonia limita formas mágicas.",
            chunkId: "K12-0042",
          },
        ],
        status: "answered",
        createdAt: "2026-10-23T00:00:00.000Z",
      },
      {
        qaId: "old",
        questionShort: "Como funciona Sintonia?",
        answerShort: "Resposta antiga.",
        sourceChunkIds: ["K12-0001"],
        sourceVersion: "KALLISTIS-LIVRO-2026-08-01",
        sourceSha256: "old-hash",
        confidence: "source-backed",
        supportStatus: "VERIFIED",
        supportedClaims: [
          { claim: "Resposta antiga", quote: "Resposta antiga literal.", chunkId: "K12-0001" },
        ],
        status: "answered",
        createdAt: "2026-10-22T00:00:00.000Z",
      },
      {
        qaId: "unverified",
        questionShort: "Sintonia?",
        answerShort: "Resposta sem fonte.",
        sourceChunkIds: [],
        sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
        confidence: "unverified",
        supportStatus: "UNVERIFIED",
        status: "answered",
        createdAt: "2026-10-21T00:00:00.000Z",
      },
    );

    const selected = selectRelevantCreationMemory(memory, "Explique a Sintonia");

    expect(selected.qa.map((item) => item.qaId)).toEqual(["current"]);
  });

  it("never promotes an answer to trusted memory because sources were merely present", () => {
    const snapshot = { serverCreationProgress: {} } as CharacterSnapshot;
    const source = {
      sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
      sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
      chunkId: "K12-0120",
      bookTitle: "Livro",
      chapter: "Evocações",
      section: "Âncora",
      headingPath: ["Evocações", "Âncora"],
      startLine: 5256,
      endLine: 5301,
      text: "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
      route4Id: "R4-1",
      route10Id: "R10-1",
      route50Id: "R50-1",
      relatedChunkIds: [],
      ruleTags: [],
    };
    const memory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot,
      userMessage: "O que é Âncora?",
      assistantMessage: "Resposta qualquer",
      intent: "question",
      sources: [source],
    });
    expect(memory.qa[0]).toMatchObject({
      confidence: "unverified",
      supportStatus: "UNVERIFIED",
      supportedClaims: [],
    });
    expect(selectRelevantCreationMemory(memory, "Âncora").qa).toEqual([]);
  });

  it("stores only exact source claims as trusted memory, never extra model prose", () => {
    const snapshot = { serverCreationProgress: {} } as CharacterSnapshot;
    const quote = "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.";
    const source = {
      chunkId: "K12-0120",
      sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
      sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
      bookTitle: "Livro",
      chapter: "Evocações",
      section: "Âncora",
      headingPath: ["Evocações", "Âncora"],
      startLine: 5256,
      endLine: 5301,
      text: quote,
      route4Id: "R4-1",
      route10Id: "R10-1",
      route50Id: "R50-1",
      relatedChunkIds: [],
      ruleTags: [],
    };
    const memory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot,
      userMessage: "O que é Âncora?",
      assistantMessage: `${quote} Além disso, a âncora concede uma ação extra.`,
      intent: "question",
      sources: [source],
      answerSupport: {
        status: "VERIFIED",
        answer: `Neste trecho: ${quote}`,
        claims: [{ claim: quote, quote, chunkId: "K12-0120" }],
      },
    });
    expect(memory.qa[0]).toMatchObject({
      confidence: "source-backed",
      supportStatus: "VERIFIED",
      answerShort: `Neste trecho: ${quote}`,
      supportedClaims: [{ claim: quote, quote, chunkId: "K12-0120" }],
    });
    expect(selectRelevantCreationMemory(memory, "Âncora").qa[0]?.answerShort).toBe(
      `Neste trecho: ${quote}`,
    );
  });

  it("stores independently supported paraphrases with the natural answer and source provenance", () => {
    const snapshot = { serverCreationProgress: {} } as CharacterSnapshot;
    const answer =
      "A Âncora pode ser um objeto, lugar ou lembrança que sustenta o vínculo evocado.";
    const claim = "Âncora inclui objetos, lugares ou lembranças para sustentar um vínculo.";
    const quote = "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.";
    const source = {
      chunkId: "K12-0120",
      sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
      sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
      bookTitle: "Livro",
      chapter: "Evocações",
      section: "Âncora",
      headingPath: ["Evocações", "Âncora"],
      startLine: 5256,
      endLine: 5301,
      text: quote,
      route4Id: "R4-1",
      route10Id: "R10-1",
      route50Id: "R50-1",
      relatedChunkIds: [],
      ruleTags: [],
    };
    const memory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot,
      userMessage: "Como funciona a Âncora?",
      assistantMessage: `${answer}\n\nFontes verificadas pelo servidor: K12-0120.`,
      intent: "question",
      sources: [source],
      answerSupport: {
        status: "SUPPORTED",
        answer,
        claims: [
          {
            claim,
            answerQuote: answer,
            kind: "factual",
            status: "SUPPORTED",
            answerAnchor: "MATCHED",
            provenanceStatus: "VERIFIED",
            semanticStatus: "SUPPORTED",
            contradictionStatus: "NONE",
            evidence: [{ quote, chunkId: "K12-0120" }],
          },
        ],
      },
    });

    expect(memory.qa[0]).toMatchObject({
      answerShort: answer,
      confidence: "source-backed",
      supportStatus: "SUPPORTED",
      supportMethod: "independent-evaluator-v1",
      answerClaims: [
        {
          claim,
          answerSpan: answer,
          evidence: [
            {
              quote,
              chunkId: "K12-0120",
              sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
              sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
              provenance: "literal_source_match",
            },
          ],
          answerAnchor: "MATCHED",
          provenanceStatus: "VERIFIED",
          semanticStatus: "SUPPORTED",
          contradictionStatus: "NONE",
        },
      ],
      supportedClaims: [{ claim, quote, chunkId: "K12-0120", status: "SUPPORTED" }],
    });
    expect(selectRelevantCreationMemory(memory, "Explique a Âncora").qa[0]?.answerShort).toBe(
      answer,
    );
  });

  it("revalidates paraphrase memory against current source quotes without requiring quote-equal answers", async () => {
    const quote = "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.";
    const answer =
      "A Âncora pode ser um objeto, lugar ou lembrança que sustenta o vínculo evocado.";
    const claim = "Âncora inclui objetos, lugares ou lembranças para sustentar um vínculo.";
    const memoryRow = {
      qa: [
        {
          qaId: "supported-paraphrase",
          questionShort: "Como funciona a Âncora?",
          answerShort: answer,
          sourceChunkIds: ["K12-0120"],
          sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
          sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
          confidence: "source-backed",
          supportStatus: "SUPPORTED",
          supportMethod: "independent-evaluator-v1",
          answerClaims: [
            {
              claim,
              answerSpan: answer,
              kind: "factual",
              status: "SUPPORTED",
              answerAnchor: "MATCHED",
              provenanceStatus: "VERIFIED",
              semanticStatus: "SUPPORTED",
              contradictionStatus: "NONE",
              evidence: [
                {
                  quote,
                  chunkId: "K12-0120",
                  sourceKind: "book",
                  sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
                  sourceSha256: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
                  provenance: "literal_source_match",
                },
              ],
            },
          ],
          supportedClaims: [{ claim: answer, quote, chunkId: "K12-0120", status: "SUPPORTED" }],
          status: "answered",
          createdAt: "2026-10-23T00:00:00.000Z",
        },
      ],
      narrative_identity: [],
      choices: [],
      inferences: [],
      pending_contradictions: [],
      consulted_sources: [],
    };
    const sql = {
      query: vi.fn(async (statement: string) =>
        statement.includes("SELECT qa,") ? [memoryRow] : [{ chunk_id: "K12-0120", content: quote }],
      ),
      close: vi.fn(),
    } as unknown as SqlExecutor;

    const read = await readCreationConversationMemory(sql, "character-1", "owner-1");

    expect(read.qa[0]).toMatchObject({
      answerShort: answer,
      confidence: "source-backed",
      supportStatus: "SUPPORTED",
      answerClaims: memoryRow.qa[0]?.answerClaims,
    });
    expect(selectRelevantCreationMemory(read, "Explique a Âncora").qa[0]?.answerShort).toBe(answer);
  });

  it("revalidates canonical-rule citations from the active versioned rule source after reload", async () => {
    const question = "Como são distribuídos os seis atributos?";
    const rule = retrieveCanonicalRules(question).find((item) =>
      /atribut/i.test(`${item.section} ${item.text}`),
    );
    expect(rule).toBeDefined();
    const quote = rule!.text.trim().slice(0, 180);
    const answer = "A distribuição inicial está descrita no contrato canônico.";
    const source = {
      sourceKind: "canonical_rule" as const,
      sourceVersion: rule!.sourceVersion,
      sourceHash: rule!.sourceHash,
      chunkId: canonicalRuleEvidenceId(rule!.sourceId, rule!.section),
      bookTitle: "Regras canônicas de KALLISTIS",
      chapter: rule!.section,
      section: rule!.section,
      headingPath: rule!.searchHeadings ?? [rule!.section],
      text: rule!.text,
    };
    const memory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot: { serverCreationProgress: {} } as CharacterSnapshot,
      userMessage: question,
      assistantMessage: answer,
      intent: "question",
      sources: [source],
      answerSupport: {
        status: "SUPPORTED",
        answer,
        claims: [
          {
            claim: "A regra define a distribuição inicial dos atributos.",
            answerQuote: answer,
            kind: "mechanical",
            status: "SUPPORTED",
            answerAnchor: "MATCHED",
            provenanceStatus: "VERIFIED",
            semanticStatus: "SUPPORTED",
            contradictionStatus: "NONE",
            evidence: [
              {
                quote,
                chunkId: source.chunkId,
                sourceKind: "canonical_rule",
                sourceVersion: rule!.sourceVersion,
                sourceHash: rule!.sourceHash,
              },
            ],
          },
        ],
      },
    });
    const sql = executor([
      {
        qa: memory.qa,
        narrative_identity: [],
        choices: [],
        inferences: [],
        pending_contradictions: [],
        consulted_sources: memory.consultedSources,
      },
    ]);

    const reloaded = await readCreationConversationMemory(sql, "character-qa", "owner-qa");

    expect(reloaded.qa[0]).toMatchObject({
      confidence: "source-backed",
      supportStatus: "SUPPORTED",
      answerClaims: [
        {
          evidence: [
            {
              chunkId: source.chunkId,
              sourceKind: "canonical_rule",
              sourceVersion: rule!.sourceVersion,
              sourceSha256: rule!.sourceHash,
            },
          ],
        },
      ],
    });
  });
});
