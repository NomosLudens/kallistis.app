import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { resolveInitialActiveCharacterId, restorePendingMutations } from "./chat-view-state";

describe("ChatView persisted state", () => {
  it("keeps character creation unbound even when the player has one existing character", () => {
    expect(
      resolveInitialActiveCharacterId({
        scope: "character_creation",
        selectedCharacterId: "existing-draft",
        selectedExists: true,
        mesaCharacterIds: [],
        hasMesa: false,
        availableCharacterIds: ["existing-draft"],
      }),
    ).toBeNull();
  });

  it("restores and renders a persisted proposal when the assistant message was not saved", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Quero criar uma personagem" }],
    } as unknown as UIMessage;
    const pending = {
      id: "confirmation-1",
      output: {
        operation: "character_create",
        status: "requires_confirmation",
        confirmationId: "confirmation-1",
        preview: { nome: "Lira QA" },
      },
    };

    const restored = restorePendingMutations([userMessage], [pending]);
    const assistant = restored.at(-1)!;

    expect(assistant.role).toBe("assistant");
    expect(assistant.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "tool-propose_character_create",
          toolCallId: "persisted-confirmation-1",
          output: pending.output,
        }),
      ]),
    );
  });

  it("does not duplicate a proposal already restored on the assistant message", () => {
    const assistant = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-update_character_creation_fields",
          state: "output-available",
          toolCallId: "persisted-confirmation-2",
          output: { operation: "character_creation_patch" },
        },
      ],
    } as unknown as UIMessage;

    const messages = [assistant];
    const restored = restorePendingMutations(messages, [
      { id: "confirmation-2", output: { operation: "character_creation_patch" } },
    ]);
    expect(restored).toBe(messages);
    expect(restored[0]!.parts).toHaveLength(1);
  });
});
