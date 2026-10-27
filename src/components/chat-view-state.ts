import type { UIMessage } from "ai";

type PersistedPendingMutation = {
  id: string;
  output: Record<string, unknown>;
};

export function resolveInitialActiveCharacterId(input: {
  scope: "general" | "character_creation" | "master";
  selectedCharacterId: string | null;
  selectedExists: boolean;
  mesaCharacterIds: string[];
  hasMesa: boolean;
  availableCharacterIds: string[];
}): string | null {
  if (input.scope === "character_creation")
    return input.selectedExists ? input.selectedCharacterId : null;
  if (input.scope === "master") return input.selectedCharacterId;
  if (input.selectedExists) return input.selectedCharacterId;
  if (input.mesaCharacterIds.length === 1) return input.mesaCharacterIds[0]!;
  if (!input.hasMesa && input.availableCharacterIds.length === 1)
    return input.availableCharacterIds[0]!;
  return null;
}

function pendingMutationPart(pending: PersistedPendingMutation): UIMessage["parts"][number] {
  const operation = pending.output.operation;
  return {
    type:
      operation === "character_create"
        ? "tool-propose_character_create"
        : operation === "character_creation_patch"
          ? "tool-update_character_creation_fields"
          : "tool-propose_character_biography_update",
    state: "output-available",
    toolCallId: `persisted-${pending.id}`,
    output: pending.output,
  } as unknown as UIMessage["parts"][number];
}

export function restorePendingMutations(
  messages: UIMessage[],
  pendingMutations: PersistedPendingMutation[],
): UIMessage[] {
  if (!pendingMutations.length) return messages;
  const restored = [...messages];
  const lastAssistantIndex = restored.map((message) => message.role).lastIndexOf("assistant");
  const existingParts = lastAssistantIndex >= 0 ? restored[lastAssistantIndex]!.parts : [];
  const existingIds = new Set(
    existingParts
      .map((part) => (part as { toolCallId?: string }).toolCallId)
      .filter((id): id is string => Boolean(id)),
  );
  const pendingParts = pendingMutations
    .filter((pending) => !existingIds.has(`persisted-${pending.id}`))
    .map(pendingMutationPart);
  if (!pendingParts.length) return messages;

  if (lastAssistantIndex < 0) {
    return [
      ...restored,
      {
        id: `pending-${pendingMutations[0]!.id}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Há uma proposta pendente. Revise os dados e confirme ou cancele antes de continuar.",
          },
          ...pendingParts,
        ],
      },
    ];
  }

  const lastAssistant = restored[lastAssistantIndex]!;
  restored[lastAssistantIndex] = {
    ...lastAssistant,
    parts: [...lastAssistant.parts, ...pendingParts],
  };
  return restored;
}
