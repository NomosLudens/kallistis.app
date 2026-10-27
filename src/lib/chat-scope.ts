export type PlayerChatScope = "general" | "character_creation" | "master";

export function resolvePlayerChatScope(search: {
  scope?: string;
  mode?: string;
  experience?: string;
}): PlayerChatScope {
  if (search.scope === "master") return "master";
  if (
    search.scope === "character_creation" ||
    search.mode === "character_creation" ||
    search.experience === "CHARACTER_CREATION"
  ) {
    return "character_creation";
  }
  return "general";
}
