import { describe, expect, it } from "vitest";
import {
  renderCanonicalRouteInstructions,
  routeCanonicalChatQuestion,
} from "./canonical-intent-routing";

describe("Chat Geral canon intent routing", () => {
  it.each([
    ["Como funciona a fórmula NEXO no Marco 7?", "rules", "LIVRO III — SISTEMA"],
    ["Posso usar três argumentos na mesma ação?", "rules", "LIVRO III — SISTEMA"],
    ["Como criar um personagem pelas novas regras?", "character_creation_rules", "LIVRO III — SISTEMA"],
    ["O que acontece quando os dados mostram 9–9, mas a margem é negativa?", "rules", "LIVRO III — SISTEMA"],
    ["Qual a diferença entre Escuridão e Sombra?", "history_cosmology", "LIVRO I — HISTÓRIA"],
    ["Como funciona a iniciativa por Vanguarda?", "rules", "LIVRO III — SISTEMA"],
    ["Como o Coro acumula Pulsos e Barras?", "rules", "LIVRO III — SISTEMA"],
    ["Um personagem ainda possui Vitalidade e Guarda numéricas?", "rules", "LIVRO III — SISTEMA"],
    ["Como funciona a exceção de rolagem dos Trocados?", "rules", "LIVRO III — SISTEMA"],
    ["Qual é a história do Grande Cristal?", "history_cosmology", "LIVRO I — HISTÓRIA"],
    ["O que aconteceu com o Cristal Partido?", "history_cosmology", "LIVRO I — HISTÓRIA"],
  ])("routes canon question: %s", (question, intent, book) => {
    const route = routeCanonicalChatQuestion(question);
    expect(route.intent).toBe(intent);
    expect(route.books).toContain(book);
    expect(route.handling).toBe("answer");
  });

  it("keeps narrative chat free and does not route it to character creation", () => {
    const route = routeCanonicalChatQuestion("Quero conversar com Berta na taverna.");
    expect(route).toEqual({
      intent: "narrative",
      books: [],
      handling: "conversation",
    });
    const instructions = renderCanonicalRouteInstructions(route);
    expect(instructions).toContain("premissas para uma cena ficcional");
    expect(instructions).toContain("sem exigir campanha ou Mesa ativa");
  });

  it("keeps direct scene invitations with named characters in narrative chat", () => {
    expect(routeCanonicalChatQuestion("Vamos encenar uma conversa com Berta no balcão da taverna.")).toEqual({
      intent: "narrative",
      books: [],
      handling: "conversation",
    });
  });

  it("routes a multi-concept Povo, Origem and comunidade question to both pertinent books", () => {
    expect(routeCanonicalChatQuestion("Qual é a relação entre Povo, Origem e comunidade no cânone?")).toEqual({
      intent: "setting_atlas",
      books: ["LIVRO II — ATLAS", "LIVRO III — SISTEMA"],
      handling: "answer",
    });
    expect(
      routeCanonicalChatQuestion(
        "No manuscrito, explique separadamente o que Povo, Origem e comunidade significam para a personagem; indique o que o texto não define.",
      ).books,
    ).toEqual(["LIVRO II — ATLAS", "LIVRO III — SISTEMA"]);
  });

  it("routes an unsupported but explicitly canonical factual question to the canon source", () => {
    expect(routeCanonicalChatQuestion("No manuscrito, qual é o custo em pontos de mana para voltar no tempo?")).toEqual({
      intent: "rules",
      books: ["LIVRO III — SISTEMA"],
      handling: "answer",
    });
  });

  it("requires supported claims and exact citations for canon answers", () => {
    const instructions = renderCanonicalRouteInstructions(
      routeCanonicalChatQuestion("Qual é a regra NEXO?"),
    );
    expect(instructions).toContain("suporte textual direto");
    expect(instructions).toContain("Nunca escreva referências bibliográficas próprias");
    expect(instructions).toContain("declare a lacuna");
  });

  it("routes Mestre resistance and consequences questions to Livros IV and III", () => {
    expect(
      routeCanonicalChatQuestion("Como estabelecer Resistência e consequências de uma ação?"),
    ).toEqual({
      intent: "table_guidance",
      books: ["LIVRO IV — NARRANDO O JOGO", "LIVRO III — SISTEMA"],
      handling: "answer",
    });
    expect(
      routeCanonicalChatQuestion(
        "O que o Livro IV orienta o Mestre a fazer ao apresentar a situação, definir o risco e comunicar consequências antes da rolagem?",
      ),
    ).toEqual({
      intent: "table_guidance",
      books: ["LIVRO IV — NARRANDO O JOGO", "LIVRO III — SISTEMA"],
      handling: "answer",
    });
  });

  it("does not adjudicate an action declared in the shared room", () => {
    expect(routeCanonicalChatQuestion("Declaro a ação: protejo a ponte.")).toEqual({
      intent: "game_action",
      books: ["LIVRO III — SISTEMA"],
      handling: "action_handoff",
    });
  });
});
