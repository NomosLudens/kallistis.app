import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import generatedBookSearchIndex from "./canonical-book-search-index.generated.json";
import { BOOK_SOURCE_SHA256 } from "@/server/characters/conversational-creation-book-manifest";
import {
  BOOK_SOURCE_FILE,
  BOOK_SOURCE_ID,
  BOOK_SOURCE_VERSION,
  bindCanonicalEvidenceCitations,
  renderCanonicalBookContext,
  retrieveCanonicalBookEvidence,
  retrieveCanonicalBook,
} from "./canonical-rules.server";

const examples = [
  {
    question: "Como funciona uma rolagem NEXO?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Fórmula do NEXO|TOTAL\s*=\s*d10\(Luz\)\s*\+\s*d10\(Escuridão\)\s*\+\s*NEXO/i,
  },
  {
    question: "Como funciona a fórmula NEXO no Marco 7?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /NEXO|Marco 7/i,
  },
  {
    question: "Posso usar três argumentos na mesma ação?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /dois argumentos|limite.*dois/i,
  },
  {
    question: "Como funciona a criação de personagem NEXO?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /dez pontos narrativos|Criação de personagem NEXO/i,
  },
  {
    question: "O que acontece quando os dados mostram 9–9, mas a margem é negativa?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Ressonância|margem|dados naturais/i,
  },
  {
    question: "Qual a diferença entre Escuridão e Sombra?",
    book: "LIVRO I — HISTÓRIA" as const,
    evidence: /Escuridão não é Sombra|Escuridão.*Sombra/i,
  },
  {
    question: "Como funciona a iniciativa por Vanguarda?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Vanguarda.*escolhe|escolhe um participante/i,
  },
  {
    question: "Como o Coro acumula Pulsos e Barras?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Cada Barra contém quatro Pulsos|Mestre anuncia o Pulso|Pulso|Barras/i,
  },
  {
    question: "Um personagem ainda possui Vitalidade e Guarda numéricas?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Vitalidade|Guarda/i,
  },
  {
    question: "Como funciona a exceção de rolagem dos Trocados?",
    book: "LIVRO III — SISTEMA" as const,
    evidence: /Trocado|Predominância|terceiro dado/i,
  },
  {
    question: "Qual é a história do Grande Cristal?",
    book: "LIVRO I — HISTÓRIA" as const,
    evidence: /Grande Cristal|fraturou o Grande Cristal/i,
  },
];

describe("reviewed full-book canon retrieval", () => {
  it("indexes the complete approved manuscript and keeps its source fingerprint", () => {
    const source = readFileSync(resolve(process.cwd(), "CANON", BOOK_SOURCE_FILE), "utf8");
    expect(createHash("sha256").update(source).digest("hex")).toBe(BOOK_SOURCE_SHA256);
    expect(source).toContain("## 11. Marcos, aprendizagem e continuidade");
    expect(source).toContain("M3 | Escolha de Especialização do Ofício ativo.");
    expect(generatedBookSearchIndex.sourceHash).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    expect(BOOK_SOURCE_ID).toBe("kallistis-livro-completo-nexo-motor-progressao");
    expect(BOOK_SOURCE_VERSION).toBe("2026-11-05-4416d5ce");
  });

  it.each(examples)("retrieves on-topic evidence for: $question", ({ question, book, evidence }) => {
    const matches = retrieveCanonicalBook(question, book);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => match.searchHeadings?.[0] === book)).toBe(true);
    expect(matches.every((match) => match.sourceHash === BOOK_SOURCE_SHA256)).toBe(true);
    expect(matches.some((match) => evidence.test(match.text))).toBe(true);
  });

  it("does not send legacy corpus context to the Chat Geral manual route", () => {
    const rendered = renderCanonicalBookContext(
      "Como funciona a fórmula NEXO no Marco 7?",
      ["LIVRO III — SISTEMA"],
    );
    expect(rendered).toContain(`SOURCE_ID=${BOOK_SOURCE_ID}`);
    expect(rendered).toContain(`SOURCE_VERSION=${BOOK_SOURCE_VERSION}`);
    expect(rendered).toContain(`SOURCE_SHA256=${BOOK_SOURCE_SHA256}`);
    expect(rendered).not.toContain("marcadores [[EVIDENCE:E1]]");
    expect(rendered).not.toContain("KALLISTIS_REGRAS_CANONICAS_COMPLETAS.md");
  });

  it("retrieves separate evidence coverage for Povo, Origem and comunidade", () => {
    const evidence = retrieveCanonicalBookEvidence(
      "Pelo texto dos Livros II e III, defina Povo, explique o papel da Origem na criação e diga o que está documentado sobre comunidades.",
      ["LIVRO II — ATLAS", "LIVRO III — SISTEMA"],
    );
    expect(evidence.some((item) => item.book === "LIVRO III — SISTEMA" && /Povo|Origem/i.test(item.text))).toBe(true);
    expect(evidence.some((item) => item.book === "LIVRO II — ATLAS" && /comunidade/i.test(item.text))).toBe(true);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.sourceHash === BOOK_SOURCE_SHA256)).toBe(true);
    expect(evidence.reduce((total, item) => total + item.text.length, 0)).toBeLessThan(12_000);
  });

  it("recovers source-linked Book IV evidence for a Master scene question", () => {
    const evidence = retrieveCanonicalBookEvidence(
      "Como o Mestre deve apresentar a cena, anunciar o risco e conduzir uma ação?",
      ["LIVRO IV — NARRANDO O JOGO", "LIVRO III — SISTEMA"],
    );
    expect(evidence.some((item) => item.book === "LIVRO IV — NARRANDO O JOGO")).toBe(true);
    expect(evidence.every((item) => item.sectionTitle.length > 0 && item.citation.includes(item.sectionTitle))).toBe(true);
  });

  it("binds exact retrieved references and evidence IDs while rejecting invented references", () => {
    const evidence = retrieveCanonicalBookEvidence(
      "Como funciona uma rolagem NEXO?",
      ["LIVRO III — SISTEMA"],
    );
    const first = evidence[0]!;
    expect(bindCanonicalEvidenceCitations(`A afirmação está demonstrada [[EVIDENCE:${first.evidenceId}]].`, evidence, true)).toContain(first.citation);
    expect(bindCanonicalEvidenceCitations(`A afirmação está demonstrada (${first.citation}).`, evidence, true)).toContain(first.citation);
    expect(() =>
      bindCanonicalEvidenceCitations("O manuscrito não estabelece o custo em mana para viajar ao passado.", evidence, true),
    ).toThrow("community_chat_missing_canonical_citation");
    expect(() => bindCanonicalEvidenceCitations("Regra — Livro IV, PDF p. 999.", evidence, true)).toThrow("community_chat_unbound_canonical_citation");
    expect(() => bindCanonicalEvidenceCitations("A resposta é esta.", evidence, true)).toThrow("community_chat_missing_canonical_citation");
  });
});
