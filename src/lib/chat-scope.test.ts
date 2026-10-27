import { describe, expect, it } from "vitest";
import { resolvePlayerChatScope } from "./chat-scope";

describe("resolvePlayerChatScope", () => {
  it("honors the explicit character creation scope used by the player entry points", () => {
    expect(resolvePlayerChatScope({ scope: "character_creation" })).toBe("character_creation");
  });

  it("keeps the existing character creation aliases and master scope", () => {
    expect(resolvePlayerChatScope({ mode: "character_creation" })).toBe("character_creation");
    expect(resolvePlayerChatScope({ experience: "CHARACTER_CREATION" })).toBe("character_creation");
    expect(resolvePlayerChatScope({ scope: "master" })).toBe("master");
    expect(resolvePlayerChatScope({})).toBe("general");
  });
});
