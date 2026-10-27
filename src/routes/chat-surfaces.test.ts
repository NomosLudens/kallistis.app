import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const compact = (source: string) => source.replace(/\s+/g, "");

describe("contrato das duas superfícies conversacionais", () => {
  it("mantém Geral comunitário e Criação privada", () => {
    const index = read("./_authenticated/chat.index.tsx");
    const communityView = read("../components/CommunityChatView.tsx");
    const community = read("./api/community-chat.ts");
    const thread = read("./api/chat/thread.ts");
    const chatView = read("../components/ChatView.tsx");
    const characters = read("./_authenticated/personagens.tsx");
    const creation = read("./_authenticated/criar-personagem.tsx");
    const creationApi = read("./api/character-creation.ts");
    const creationPersistence = read("../server/characters/character-creation-persistence.ts");
    expect(index).toContain("<CommunityChatView />");
    expect(index).toContain("ensureThread(scope)");
    expect(community).toContain("listCommunityChatMessages");
    expect(read("../server/local-core/community-chat.ts")).toContain("community_chat_messages");
    expect(community).toContain("buildKallistisCommunitySystem");
    expect(community).not.toContain("createThread({");
    expect(thread).toContain('scope === "character_creation" ? "CHARACTER_CREATION" : null');
    expect(thread).toContain("CHAT_SCOPE_MARKERS[scope]");
    expect(compact(chatView)).toContain(compact("{initialMessages !== null && messages.map"));
    expect(communityView).toContain("if (opening) return");
    expect(characters).toContain('to="/criar-personagem"');
    expect(creation).toContain('"/api/character-creation"');
    expect(creationApi).toContain("public.character_creation_messages");
    expect(creationApi).toContain("public.character_versions");
    expect(creationApi).toContain("public.character_events");
    expect(creationApi).toContain("updateCharacterCreationSnapshot");
    expect(creationPersistence).toContain("WHERE id=$1 AND owner_user_id=$6 AND version=$7");
    expect(creationPersistence).toContain("RETURNING id");
    expect(creationApi).not.toContain("DELETE FROM public.character_creation_messages");
    expect(characters).not.toContain('createNewThread("character_creation")');
  });

  it("não abre um terceiro histórico no Forge", () => {
    const bridge = read("../../public/jogar/character-forge-bridge.pr31a-kallistis-v3.js");
    const characters = read("./api/characters.ts");
    expect(bridge).toContain("/criar-personagem");
    expect(bridge).not.toContain('action: "assist"');
    expect(characters).not.toContain('if (action === "assist")');
  });
});
