import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { NEXO_RULESETS, isNexoRuleset, validateProposedArguments } from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };
function error(code: string, status = 400) {
  return Response.json({ error: code }, { status, headers });
}
function statusFor(code: string) {
  if (code.endsWith("_forbidden")) return 403;
  if (code.endsWith("_not_found")) return 404;
  if (code.startsWith("invalid_") || code.includes("_invalid")) return 422;
  if (code.includes("_missing") || code.includes("_already") || code.includes("_pending"))
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

export const Route = createFileRoute("/api/nexo/actions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const mesaId = new URL(request.url).searchParams.get("mesaId");
        if (!mesaId) return error("mesa_id_required");
        const url = getRuntimeDatabaseUrl();
        if (!url) return error("database_unavailable", 503);
        const sql = createBunPostgresExecutor(url);
        try {
          const members = await sql.query<{ member_role: string }>(
            `SELECT member_role FROM public.mesa_members WHERE mesa_id=$1 AND user_id=$2 AND membership_status='active'`,
            [mesaId, auth.userId],
          );
          if (!members.length) return error("mesa_access_forbidden", 403);
          const mesas = await sql.query<{ ruleset: string | null }>(
            `SELECT ruleset FROM public.mesas WHERE id=$1`,
            [mesaId],
          );
          if (!mesas[0]) return error("mesa_not_found", 404);
          if (!isNexoRuleset(mesas[0].ruleset)) return error("mesa_ruleset_not_nexo", 409);
          const master = members[0].member_role === "mestre";
          const rows = await sql.query<Record<string, unknown>>(
            `SELECT s.id,s.character_id,c.snapshot->>'nome' AS character_name,s.actor_user_id,s.action_description,s.status,s.created_at,
                a.id AS resistance_assignment_id,a.resistance,s.consequence_text,r.light_die,r.shadow_die,r.total,r.margin,r.grade,r.predominance,r.resonance,r.arguments_text,r.bonus,r.created_at AS rolled_at
           FROM public.nexo_action_submissions s
           JOIN public.characters c ON c.id=s.character_id
           JOIN public.nexo_resistance_assignments a ON a.id=s.resistance_assignment_id
           LEFT JOIN public.nexo_rolls r ON r.id=s.roll_id
          WHERE s.mesa_id=$1 AND ($2::boolean OR s.actor_user_id=$3)
          ORDER BY s.created_at DESC LIMIT 100`,
            [mesaId, master, auth.userId],
          );
          const ids = rows.map((row) => String(row.id));
          const args = ids.length
            ? await sql.query<Record<string, unknown>>(
                `SELECT submission_id,slot,argument_text,status,adjudicated_by_user_id,adjudicated_at FROM public.nexo_action_arguments WHERE submission_id=ANY($1::uuid[]) ORDER BY submission_id,slot`,
                [ids],
              )
            : [];
          const bySubmission = new Map<string, Record<string, unknown>[]>();
          for (const argument of args) {
            const id = String(argument.submission_id);
            bySubmission.set(id, [...(bySubmission.get(id) ?? []), argument]);
          }
          return Response.json(
            {
              canAdjudicate: master,
              actions: rows.map((row) => ({
                ...row,
                arguments: bySubmission.get(String(row.id)) ?? [],
              })),
            },
            { headers },
          );
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : "nexo_actions_failed", 503);
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
            if (!mesaId) throw new Error("mesa_id_required");
            const members = await tx.query<{ member_role: string }>(
              `SELECT member_role FROM public.mesa_members WHERE mesa_id=$1 AND user_id=$2 AND membership_status='active' FOR UPDATE`,
              [mesaId, auth.userId],
            );
            const role = members[0]?.member_role;
            if (!role) throw new Error("mesa_access_forbidden");
            const mesas = await tx.query<{ ruleset: string | null }>(
              `SELECT ruleset FROM public.mesas WHERE id=$1 FOR UPDATE`,
              [mesaId],
            );
            if (!mesas[0]) throw new Error("mesa_not_found");
            if (!isNexoRuleset(mesas[0].ruleset)) throw new Error("mesa_ruleset_not_nexo");

            if (body.action === "submit") {
              if (role !== "jogador") throw new Error("nexo_action_player_forbidden");
              const characterId = typeof body.characterId === "string" ? body.characterId : "";
              const description =
                typeof body.actionDescription === "string"
                  ? body.actionDescription.trim().slice(0, 1000)
                  : "";
              if (!characterId || description.length < 3) throw new Error("invalid_nexo_action");
              const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
              if (sessionId) {
                const sessions = await tx.query(
                  `SELECT 1 FROM public.mesa_live_sessions WHERE id=$1 AND mesa_id=$2 AND status='live' AND ruleset = ANY($3::text[]) FOR UPDATE`,
                  [sessionId, mesaId, NEXO_RULESETS],
                );
                if (!sessions.length) throw new Error("nexo_session_not_found");
              }
              const proposed = validateProposedArguments(body.arguments);
              const characters = await tx.query<Record<string, unknown>>(
                `SELECT c.id,c.ruleset FROM public.characters c JOIN public.character_mesas cm ON cm.character_id=c.id AND cm.mesa_id=$1 WHERE c.id=$2 AND c.owner_user_id=$3 AND c.status <> 'archived' FOR UPDATE OF c`,
                [mesaId, characterId, auth.userId],
              );
              if (!characters.length || !isNexoRuleset(characters[0].ruleset))
                throw new Error("nexo_character_not_found");
              const assignments = await tx.query<Record<string, unknown>>(
                `SELECT a.id FROM public.nexo_resistance_assignments a JOIN public.mesa_members master ON master.mesa_id=a.mesa_id AND master.user_id=a.set_by_user_id AND master.member_role='mestre' AND master.membership_status='active' WHERE a.mesa_id=$1 AND a.character_id=$2 AND a.action_description=$3 AND a.consumed_at IS NULL FOR UPDATE OF a`,
                [mesaId, characterId, description],
              );
              if (!assignments[0]) throw new Error("nexo_master_resistance_missing_or_mismatched");
              const submitted = await tx.query<Record<string, unknown>>(
                `INSERT INTO public.nexo_action_submissions(mesa_id,character_id,actor_user_id,session_id,resistance_assignment_id,action_description,status,adjudicated_by_user_id,adjudicated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7='ready' THEN now() ELSE NULL END)
             RETURNING id,mesa_id,character_id,action_description,status,created_at`,
                [
                  mesaId,
                  characterId,
                  auth.userId,
                  sessionId,
                  assignments[0].id,
                  description,
                  proposed.length ? "pending" : "ready",
                  proposed.length ? null : auth.userId,
                ],
              );
              const submission = submitted[0]!;
              for (const [index, argument] of proposed.entries())
                await tx.query(
                  `INSERT INTO public.nexo_action_arguments(submission_id,slot,argument_text) VALUES($1,$2,$3)`,
                  [submission.id, index + 1, argument],
                );
              return {
                submission,
                arguments: proposed.map((argument, index) => ({
                  slot: index + 1,
                  argument_text: argument,
                  status: proposed.length ? "pending" : "accepted",
                })),
              };
            }

            if (body.action === "adjudicate") {
              if (role !== "mestre") throw new Error("nexo_action_master_forbidden");
              const id = typeof body.submissionId === "string" ? body.submissionId : "";
              const accepted = body.acceptedSlots;
              if (
                !id ||
                !Array.isArray(accepted) ||
                accepted.some((slot) => ![1, 2].includes(Number(slot)))
              )
                throw new Error("invalid_nexo_adjudication");
              const uniqueAccepted = [...new Set(accepted.map(Number))];
              if (uniqueAccepted.length !== accepted.length)
                throw new Error("invalid_nexo_adjudication");
              const submissions = await tx.query<Record<string, unknown>>(
                `SELECT id,status FROM public.nexo_action_submissions WHERE id=$1 AND mesa_id=$2 FOR UPDATE`,
                [id, mesaId],
              );
              const submission = submissions[0];
              if (!submission) throw new Error("nexo_action_not_found");
              if (submission.status !== "pending")
                throw new Error("nexo_action_already_adjudicated");
              const args = await tx.query<Record<string, unknown>>(
                `SELECT slot FROM public.nexo_action_arguments WHERE submission_id=$1 ORDER BY slot FOR UPDATE`,
                [id],
              );
              if (!args.length) throw new Error("nexo_action_arguments_missing");
              if (args.some((argument) => ![1, 2].includes(Number(argument.slot))))
                throw new Error("invalid_nexo_adjudication");
              for (const argument of args) {
                const slot = Number(argument.slot);
                await tx.query(
                  `UPDATE public.nexo_action_arguments SET status=$3,adjudicated_by_user_id=$2,adjudicated_at=now() WHERE submission_id=$1 AND slot=$4`,
                  [id, auth.userId, uniqueAccepted.includes(slot) ? "accepted" : "rejected", slot],
                );
              }
              await tx.query(
                `UPDATE public.nexo_action_submissions SET status='ready',adjudicated_by_user_id=$2,adjudicated_at=now() WHERE id=$1`,
                [id, auth.userId],
              );
              return { submissionId: id, status: "ready", acceptedSlots: uniqueAccepted };
            }

            if (body.action === "record_consequence") {
              if (role !== "mestre") throw new Error("nexo_action_master_forbidden");
              const id = typeof body.submissionId === "string" ? body.submissionId : "";
              const consequence =
                typeof body.consequence === "string" ? body.consequence.trim().slice(0, 1500) : "";
              if (!id || consequence.length < 3) throw new Error("invalid_nexo_action_consequence");
              const submissions = await tx.query<Record<string, unknown>>(
                `SELECT status,consequence_text FROM public.nexo_action_submissions WHERE id=$1 AND mesa_id=$2 FOR UPDATE`,
                [id, mesaId],
              );
              const submission = submissions[0];
              if (!submission) throw new Error("nexo_action_not_found");
              if (submission.status !== "resolved") throw new Error("nexo_action_roll_required");
              if (submission.consequence_text)
                throw new Error("nexo_action_consequence_already_recorded");
              await tx.query(
                `UPDATE public.nexo_action_submissions SET consequence_text=$2,consequence_by_user_id=$3,consequence_at=now() WHERE id=$1`,
                [id, consequence, auth.userId],
              );
              return { submissionId: id, consequence };
            }
            throw new Error("invalid_nexo_action_operation");
          });
          return Response.json(result, { status: body.action === "submit" ? 201 : 200, headers });
        } catch (cause) {
          const code = cause instanceof Error ? cause.message : "nexo_actions_failed";
          return error(code, statusFor(code));
        } finally {
          sql.close();
        }
      },
    },
  },
});
