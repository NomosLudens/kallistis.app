import type { SqlExecutor } from "@/server/local-core/postgres";

export async function updateCharacterCreationSnapshot(input: {
  tx: SqlExecutor;
  id: string;
  userId: string;
  expectedVersion: number;
  name: string;
  snapshot: unknown;
  mechanicalFingerprint: string;
}) {
  const updated = await input.tx.query<{ id: string }>(
    "UPDATE public.characters SET name=$2,snapshot=$3::jsonb,version=$4,mechanical_fingerprint=$5,updated_at=now() WHERE id=$1 AND owner_user_id=$6 AND version=$7 RETURNING id",
    [
      input.id,
      input.name,
      input.snapshot,
      input.expectedVersion + 1,
      input.mechanicalFingerprint,
      input.userId,
      input.expectedVersion,
    ],
  );
  if (updated.length !== 1) throw new Error("stale_character_version");
  return updated[0]!;
}
