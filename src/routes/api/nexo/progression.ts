import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { mechanicalFingerprint } from "@/server/characters/character-canon";
import { CHARACTER_FORGE_CHOICE_CATALOG } from "@/server/characters/character-choice-registry";
import { isNexoRuleset } from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };

function error(code: string, status = 400) {
  return Response.json({ error: code }, { status, headers });
}

function statusFor(code: string) {
  if (code.endsWith("_forbidden")) return 403;
  if (code.endsWith("_not_found")) return 404;
  if (code.startsWith("invalid_") || code.endsWith("_invalid")) return 422;
  if (code.includes("_missing") || code.includes("_conflict") || code.includes("_ceiling"))
    return 409;
  return 400;
}

async function readBody(request: Request) {
  const value = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function withTransaction<T>(
  sql: ReturnType<typeof createBunPostgresExecutor>,
  fn: (tx: typeof sql) => Promise<T>,
): Promise<T> {
  if (sql.transaction) return sql.transaction(fn);
  await sql.query("BEGIN");
  try {
    const result = await fn(sql);
    await sql.query("COMMIT");
    return result;
  } catch (cause) {
    await sql.query("ROLLBACK").catch(() => undefined);
    throw cause;
  }
}

export const Route = createFileRoute("/api/nexo/progression")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const query = new URL(request.url).searchParams;
        const mesaId = query.get("mesaId") || "";
        const characterId = query.get("characterId") || "";
        if (!mesaId || !characterId) return error("nexo_progression_context_required");
        const url = getRuntimeDatabaseUrl();
        if (!url) return error("database_unavailable", 503);
        const sql = createBunPostgresExecutor(url);
        try {
          const access = await sql.query<{ member_role: string }>(
            `SELECT mm.member_role
               FROM public.character_mesas cm
               JOIN public.characters c ON c.id=cm.character_id
               JOIN public.mesa_members mm ON mm.mesa_id=cm.mesa_id
               JOIN public.mesas m ON m.id=cm.mesa_id
              WHERE cm.character_id=$1 AND cm.mesa_id=$2 AND mm.user_id=$3
                AND mm.membership_status='active'
                AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')
                AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')
                AND c.status <> 'archived'
              LIMIT 1`,
            [characterId, mesaId, auth.userId],
          );
          if (!access.length) return error("nexo_progression_access_forbidden", 403);
          const events = await sql.query<Record<string, unknown>>(
            `SELECT e.id,e.event_type,e.payload,e.created_at,p.display_name AS actor_name
               FROM public.character_events e
               LEFT JOIN public.profiles p ON p.id=e.actor_user_id
              WHERE e.character_id=$1
                AND e.event_type IN ('nexo_narrative_progression','nexo_marco_advanced','nexo_specialization_selected')
              ORDER BY e.created_at ASC,e.id ASC`,
            [characterId],
          );
          return Response.json(
            {
              role: access[0]!.member_role,
              events: events.map((event) => ({
                id: String(event.id),
                type: String(event.event_type),
                payload: event.payload,
                actorName: String(event.actor_name || "Mesa"),
                createdAt: new Date(String(event.created_at)).toISOString(),
              })),
            },
            { headers },
          );
        } catch {
          return error("nexo_progression_read_failed", 503);
        } finally {
          sql.close();
        }
      },
      POST: async ({ request }) => {
        const expectedOrigin =
          process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app";
        if (!isSameOriginRequest(request, expectedOrigin)) return error("csrf_rejected", 403);
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const body = await readBody(request);
        if (!body) return error("invalid_json");
        const url = getRuntimeDatabaseUrl();
        if (!url) return error("database_unavailable", 503);
        const sql = createBunPostgresExecutor(url);
        try {
          const result = await withTransaction(sql, async (tx) => {
            const mesaId = typeof body.mesaId === "string" ? body.mesaId : "";
            const characterId = typeof body.characterId === "string" ? body.characterId : "";
            if (!mesaId || !characterId) throw new Error("nexo_progression_context_required");
            const members = await tx.query<{ member_role: string }>(
              `SELECT mm.member_role
                 FROM public.mesa_members mm
                 JOIN public.mesas m ON m.id=mm.mesa_id
                WHERE mm.mesa_id=$1 AND mm.user_id=$2 AND mm.membership_status='active'
                  AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')
                FOR UPDATE OF mm`,
              [mesaId, auth.userId],
            );
            const role = members[0]?.member_role;
            if (!role) throw new Error("nexo_progression_access_forbidden");
            const rows = await tx.query<{
              owner_user_id: string;
              snapshot: Record<string, unknown>;
              version: number;
              ruleset: string;
            }>(
              `SELECT c.owner_user_id::text,c.snapshot,c.version,c.ruleset
                 FROM public.characters c
                 JOIN public.character_mesas cm ON cm.character_id=c.id AND cm.mesa_id=$2
                WHERE c.id=$1 AND c.status <> 'archived'
                FOR UPDATE OF c`,
              [characterId, mesaId],
            );
            const character = rows[0];
            if (!character || !isNexoRuleset(character.ruleset))
              throw new Error("nexo_character_not_found");
            const snapshot = character.snapshot;
            const marco = Number(snapshot.marco);
            if (!Number.isInteger(marco) || marco < 1 || marco > 15)
              throw new Error("invalid_nexo_marco");
            const currentVersion = Number(character.version);
            const action = body.action;

            if (action === "choose_specialization") {
              if (role !== "jogador" || character.owner_user_id !== auth.userId)
                throw new Error("nexo_specialization_forbidden");
              if (marco !== 3) throw new Error("invalid_nexo_specialization_marco");
              if (typeof snapshot.especializacao === "string" && snapshot.especializacao.trim())
                throw new Error("nexo_specialization_already_selected");
              const specialization =
                typeof body.specialization === "string" ? body.specialization.trim() : "";
              const office = CHARACTER_FORGE_CHOICE_CATALOG.offices.find(
                (item) => item.name === snapshot.oficio,
              );
              if (
                !specialization ||
                !office?.specializations.some((item) => item.name === specialization)
              )
                throw new Error("invalid_nexo_specialization");
              const nextSnapshot = { ...snapshot, especializacao: specialization };
              const nextVersion = currentVersion + 1;
              const updated = await tx.query<{ version: number }>(
                `UPDATE public.characters
                    SET snapshot=$2::jsonb,version=$3,mechanical_fingerprint=$4,updated_at=now()
                  WHERE id=$1 AND version=$5
                  RETURNING version`,
                [
                  characterId,
                  nextSnapshot,
                  nextVersion,
                  mechanicalFingerprint(nextSnapshot),
                  currentVersion,
                ],
              );
              if (!updated.length) throw new Error("nexo_progression_version_conflict");
              await tx.query(
                `INSERT INTO public.character_versions
                   (character_id,version,snapshot,reason,actor_user_id)
                 VALUES ($1,$2,$3::jsonb,'nexo_specialization_selected',$4)`,
                [characterId, nextVersion, nextSnapshot, auth.userId],
              );
              const event = await tx.query<{ id: string; created_at: Date }>(
                `INSERT INTO public.character_events
                   (character_id,actor_user_id,event_type,payload,version_before,version_after)
                 VALUES ($1,$2,'nexo_specialization_selected',$3::jsonb,$4,$5)
                 RETURNING id,created_at`,
                [characterId, auth.userId, { specialization, marco }, currentVersion, nextVersion],
              );
              return {
                type: "specialization",
                id: event[0]!.id,
                specialization,
                marco,
                version: nextVersion,
              };
            }

            if (action === "record_narrative") {
              if (role !== "jogador" || character.owner_user_id !== auth.userId)
                throw new Error("nexo_narrative_progression_forbidden");
              const category = String(body.category || "");
              const allowedCategories = ["historia", "vinculo", "conhecimento", "consequencia"];
              const description =
                typeof body.description === "string" ? body.description.trim() : "";
              if (
                !allowedCategories.includes(category) ||
                description.length < 5 ||
                description.length > 1500
              )
                throw new Error("invalid_nexo_narrative_progression");
              const event = await tx.query<{ id: string; created_at: Date }>(
                `INSERT INTO public.character_events
                   (character_id,actor_user_id,event_type,payload,version_before,version_after)
                 VALUES ($1,$2,'nexo_narrative_progression',$3::jsonb,$4,$4)
                 RETURNING id,created_at`,
                [characterId, auth.userId, { category, description, marco }, currentVersion],
              );
              return {
                type: "narrative",
                id: event[0]!.id,
                marco,
                createdAt: event[0]!.created_at,
              };
            }

            if (action === "advance_marco") {
              if (role !== "mestre") throw new Error("nexo_marco_advancement_forbidden");
              const expectedVersion = Number(body.expectedVersion);
              const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
              if (
                !Number.isInteger(expectedVersion) ||
                expectedVersion < 1 ||
                rationale.length < 10 ||
                rationale.length > 1500
              )
                throw new Error("invalid_nexo_marco_advancement");
              if (expectedVersion !== currentVersion)
                throw new Error("nexo_progression_version_conflict");
              if (marco >= 15) throw new Error("nexo_marco_ceiling");
              const nextSnapshot = { ...snapshot, marco: marco + 1 };
              const nextVersion = currentVersion + 1;
              const updated = await tx.query<{ version: number }>(
                `UPDATE public.characters
                    SET snapshot=$2::jsonb,version=$3,mechanical_fingerprint=$4,updated_at=now()
                  WHERE id=$1 AND version=$5
                  RETURNING version`,
                [
                  characterId,
                  nextSnapshot,
                  nextVersion,
                  mechanicalFingerprint(nextSnapshot),
                  currentVersion,
                ],
              );
              if (!updated.length) throw new Error("nexo_progression_version_conflict");
              await tx.query(
                `INSERT INTO public.character_versions
                   (character_id,version,snapshot,reason,actor_user_id)
                 VALUES ($1,$2,$3::jsonb,'nexo_marco_advanced',$4)`,
                [characterId, nextVersion, nextSnapshot, auth.userId],
              );
              const event = await tx.query<{ id: string; created_at: Date }>(
                `INSERT INTO public.character_events
                   (character_id,actor_user_id,event_type,payload,version_before,version_after)
                 VALUES ($1,$2,'nexo_marco_advanced',$3::jsonb,$4,$5)
                 RETURNING id,created_at`,
                [
                  characterId,
                  auth.userId,
                  { fromMarco: marco, toMarco: marco + 1, rationale },
                  currentVersion,
                  nextVersion,
                ],
              );
              return { type: "mechanical", id: event[0]!.id, fromMarco: marco, toMarco: marco + 1 };
            }
            throw new Error("invalid_nexo_progression_action");
          });
          return Response.json(result, { headers });
        } catch (cause) {
          const code = cause instanceof Error ? cause.message : "nexo_progression_failed";
          const status = code === "nexo_progression_version_conflict" ? 409 : statusFor(code);
          return error(code, status);
        } finally {
          sql.close();
        }
      },
    },
  },
});
