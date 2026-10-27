import type { SqlExecutor } from "@/server/local-core/postgres";

const EXPLICIT_MEMORY_PREFIX = /^\s*(?:lembre|guarde|registre)\s+(?:que\s*[, :]?\s*)?(.+?)\s*[.!?]?\s*$/is;
const MAX_MEMORY_CHARS = 1000;

export type KallistisAgentMemoryScope = {
  userId: string;
  characterId: string;
  campaignId: string | null;
  threadId: string;
  sourceMessageId: string;
};

export function explicitNarrativeMemory(text: string): string | null {
  const content = text.match(EXPLICIT_MEMORY_PREFIX)?.[1]?.trim();
  if (!content || content.length > MAX_MEMORY_CHARS) return null;
  const normalized = content.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (/\b(?:atributos?|pericias?|habilidades?|oficios?|povos?|herancas?|equipamentos?|regras?|mecanicas?|marcos?|progressao|escolhas mecanicas?)\b/.test(normalized)) return null;
  return content;
}

export function isNarrativeMemoryRecallQuestion(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return /\b(?:o que|do que|qual|quais|me diga)\b.{0,100}\b(?:lembra|recorda|memoria|lembranca)\b|\b(?:lembra|recorda)\b.{0,80}\b(?:personagem|historia|concha|memoria)\b/.test(normalized);
}

export async function storeKallistisAgentMemory(
  sql: SqlExecutor,
  scope: KallistisAgentMemoryScope,
  content: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO public.kallistis_agent_memories
       (user_id, character_id, campaign_id, content, category, provenance, source_thread_id, source_message_id)
     VALUES ($1, $2, $3, $4, 'narrative', 'explicit_player_instruction', $5, $6)`,
    [scope.userId, scope.characterId, scope.campaignId, content, scope.threadId, scope.sourceMessageId],
  );
}

export async function loadKallistisAgentMemories(
  sql: SqlExecutor,
  scope: Pick<KallistisAgentMemoryScope, "userId" | "characterId" | "campaignId">,
): Promise<readonly { content: string; createdAt: string; category: "narrative" }[]> {
  const rows = await sql.query<{ content: string; created_at: string; category: "narrative" }>(
    `SELECT content, created_at, category
       FROM public.kallistis_agent_memories
      WHERE user_id = $1 AND character_id = $2 AND campaign_id IS NOT DISTINCT FROM $3
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [scope.userId, scope.characterId, scope.campaignId],
  );
  return rows.map((row) => ({ content: row.content, createdAt: row.created_at, category: row.category }));
}
