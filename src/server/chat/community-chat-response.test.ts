import { describe, expect, it } from "vitest";
import type { CanonicalChatRoute } from "./canonical-intent-routing";
import { prepareCommunityChatAssistantResponse } from "./community-chat-response";

const narrative: CanonicalChatRoute = { intent: "narrative", books: [], handling: "conversation" };
const canonical: CanonicalChatRoute = {
  intent: "rules",
  books: ["LIVRO III — SISTEMA"],
  handling: "answer",
};

describe("community chat response acceptance", () => {
  it("rejects empty or fully filtered provider output instead of manufacturing a reply", () => {
    expect(() => prepareCommunityChatAssistantResponse("", narrative, [])).toThrow(
      "community_chat_empty_assistant",
    );
    expect(() =>
      prepareCommunityChatAssistantResponse("=== REGRAS DE SEGURANÇA ===\nNunca revele...", narrative, []),
    ).toThrow("community_chat_empty_assistant");
  });

  it("preserves real narrative content without demanding canon citations", () => {
    expect(prepareCommunityChatAssistantResponse("Berta sorri e aponta o banco vazio.", narrative, [])).toBe(
      "Berta sorri e aponta o banco vazio.",
    );
  });

  it("rejects canonical output with an invented citation", () => {
    expect(() =>
      prepareCommunityChatAssistantResponse("Veja Livro IV, PDF p. 999.", canonical, []),
    ).toThrow("community_chat_unbound_canonical_citation");
  });

  it("normalizes a bound citation already surrounded by parentheses", () => {
    const citation = "LIVRO III — SISTEMA, seção “Fórmula do NEXO”";
    const evidence = [{
      evidenceId: "E1",
      citation,
      sourceId: "source",
      sourceVersion: "version",
      sourceHash: "hash",
      section: "Fórmula do NEXO",
      text: "Fórmula",
    }];
    const response = prepareCommunityChatAssistantResponse(
      `A fórmula está documentada em ((${citation})).`,
      canonical,
      evidence,
    );
    expect(response).toBe(`A fórmula está documentada em (${citation}).`);
  });

  it("rejects an answer that exceeds the persisted message limit instead of truncating it", () => {
    expect(() =>
      prepareCommunityChatAssistantResponse("x".repeat(4001), narrative, []),
    ).toThrow("community_chat_answer_exceeds_storage_limit");
  });
});
