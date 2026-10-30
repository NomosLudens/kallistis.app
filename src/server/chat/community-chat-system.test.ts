import { describe, expect, it, vi } from "vitest";
import { CANONICAL_MANIFEST } from "@/server/canonical/genesis-canonical-core";
import type { LocalChatRuntime } from "@/server/local-core/chat-runtime";
import { buildKallistisCommunitySystem } from "./community-chat-system";

function runtime() {
  return {
    identity: {
      getForUser: vi.fn(async () => ({
        profile: { id: "caller", display_name: "Jogador", pronouns: "ele/dele" },
        systemRole: null,
      })),
    },
  } as unknown as LocalChatRuntime;
}

describe("Chat Geral com autoridade canônica NEXO", () => {
  it("injeta proveniência da busca canônica e não carrega a fonte de regras legada", async () => {
    const prompt = await buildKallistisCommunitySystem(
      runtime(),
      "caller",
      "request-1",
      "@kallistis Ser Trocado concede algum bônus ou capacidade adicional?",
    );

    expect(prompt).toContain(CANONICAL_MANIFEST.revision);
    expect(prompt).toContain(CANONICAL_MANIFEST.markdownSha256);
    expect(prompt).toContain(CANONICAL_MANIFEST.pdfSha256);
    expect(prompt).toContain("Trocados e identidade — exceção de rolagem, p. 70");
    expect(prompt).toContain("terceiro d10");
    expect(prompt).toContain("Respostas anteriores do assistente não são fonte normativa");
    expect(prompt).toContain("Não crie nem altere fichas por esta conversa");
    expect(prompt).not.toContain("kallistis-rules-2.0");
    expect(prompt).not.toContain("REGISTRY COMPLETO DE ESCOLHAS DO FORGE");
  });

  it("inclui a distinção canônica entre Povo e Ofício com referência", async () => {
    const prompt = await buildKallistisCommunitySystem(
      runtime(),
      "caller",
      "request-2",
      "@kallistis Qual é a diferença entre Povo e Ofício em KALLÍSTIS?",
    );

    expect(prompt).toContain("Povo = corpo e herança cosmológica");
    expect(prompt).toContain("Ofício = prática aprendida e Trilha ativa");
    expect(prompt).toContain("[E3] LIVRO II — ATLAS");
  });

  it("explicita a lacuna quando a busca não encontra o conceito", async () => {
    const prompt = await buildKallistisCommunitySystem(
      runtime(),
      "caller",
      "request-3",
      "@kallistis ZXQ-UNDEFINED-CANONICAL-CHOICE-9F3A",
    );

    expect(prompt).toContain("A busca no índice canônico não retornou trechos");
    expect(prompt).toContain("não complete a lacuna com memória");
  });
});
