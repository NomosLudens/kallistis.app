import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl, getRuntimeEnv } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { isSystemMaster } from "@/server/local-core/player-access";
import { hasSupabaseAuthRuntime } from "@/server/runtime/supabase-auth";

const headers = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function runtime() {
  const url = getRuntimeDatabaseUrl();
  return url ? createBunPostgresExecutor(url) : null;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function canBootstrapFromLocalDevelopment(request: Request): boolean {
  const env = getRuntimeEnv();
  const databaseUrl = getRuntimeDatabaseUrl();
  if (!databaseUrl || env.appEnv !== "development" || env.workerRuntime || hasSupabaseAuthRuntime())
    return false;
  try {
    const requestUrl = new URL(request.url);
    const database = new URL(databaseUrl);
    return requestUrl.protocol === "http:" && isLoopback(requestUrl.hostname) && isLoopback(database.hostname);
  } catch {
    return false;
  }
}

function expectedOrigin(request: Request): string {
  return getRuntimeEnv().publicOrigin || new URL(request.url).origin;
}

export const Route = createFileRoute("/api/admin/system-administrators")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const sql = runtime();
        if (!sql) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
        try {
          if (!(await isSystemMaster(sql, auth.userId))) {
            const bootstrapState = await sql.query<{ count: number }>(
              "SELECT count(*)::integer AS count FROM public.system_roles WHERE system_role='system_master'",
            );
            if (!bootstrapState[0]?.count && canBootstrapFromLocalDevelopment(request)) {
              const currentUser = await sql.query<{ id: string; displayName: string | null }>(
                "SELECT u.id::text AS id,p.display_name AS \"displayName\" FROM public.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=$1 AND u.status='active' LIMIT 1",
                [auth.userId],
              );
              return Response.json(
                { isSystemMaster: false, canBootstrap: Boolean(currentUser[0]), currentUser: currentUser[0] },
                { headers },
              );
            }
            return Response.json({ error: "system_master_required" }, { status: 403, headers });
          }

          const [users, events, count] = await Promise.all([
            sql.query<{
              id: string;
              displayName: string | null;
              status: "active" | "disabled";
              isSystemMaster: boolean;
              grantedAt: string | null;
            }>(
              `SELECT u.id::text AS id,p.display_name AS "displayName",u.status,
                      (sr.user_id IS NOT NULL) AS "isSystemMaster",sr.created_at::text AS "grantedAt"
                 FROM public.users u
                 LEFT JOIN public.profiles p ON p.id=u.id
                 LEFT JOIN public.system_roles sr ON sr.user_id=u.id AND sr.system_role='system_master'
                WHERE u.status='active' OR sr.user_id IS NOT NULL
                ORDER BY (sr.user_id IS NOT NULL) DESC,lower(COALESCE(p.display_name,'')),u.id`,
            ),
            sql.query<{
              actor: string | null;
              target: string | null;
              action: "bootstrap" | "grant" | "revoke";
              createdAt: string;
            }>(
              `SELECT ap.display_name AS actor,tp.display_name AS target,e.action,e.created_at::text AS "createdAt"
                 FROM public.system_role_events e
                 LEFT JOIN public.profiles ap ON ap.id=e.actor_user_id
                 LEFT JOIN public.profiles tp ON tp.id=e.target_user_id
                ORDER BY e.created_at DESC,e.id DESC LIMIT 30`,
            ),
            sql.query<{ count: number }>(
              `SELECT count(*)::integer AS count FROM public.system_roles sr
                JOIN public.users u ON u.id=sr.user_id
               WHERE sr.system_role='system_master' AND u.status='active'`,
            ),
          ]);
          return Response.json(
            { isSystemMaster: true, users, events, administratorCount: count[0]?.count ?? 0 },
            { headers },
          );
        } finally {
          sql.close();
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginRequest(request, expectedOrigin(request)))
          return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const sql = runtime();
        if (!sql) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
        try {
          const body = (await request.json().catch(() => null)) as {
            action?: unknown;
            targetUserId?: unknown;
          } | null;
          if (body?.action === "bootstrap") {
            if (Object.keys(body).sort().join(",") !== "action" || !canBootstrapFromLocalDevelopment(request))
              return Response.json({ error: "local_bootstrap_unavailable" }, { status: 403, headers });
            const rows = await sql.query<{ administratorCount: number }>(
              "SELECT public.bootstrap_initial_system_master($1)::integer AS \"administratorCount\"",
              [auth.userId],
            );
            console.info(JSON.stringify({
              event: "system_master_bootstrapped",
              actorUserId: auth.userId,
              targetUserId: auth.userId,
              requestId: request.headers.get("x-request-id") || undefined,
            }));
            return Response.json({ ok: true, administratorCount: rows[0]?.administratorCount ?? 1 }, { headers });
          }

          if (body?.action !== "grant" && body?.action !== "revoke")
            return Response.json({ error: "invalid_administrator_action" }, { status: 400, headers });
          if (Object.keys(body).sort().join(",") !== "action,targetUserId" || typeof body.targetUserId !== "string" || !uuidPattern.test(body.targetUserId))
            return Response.json({ error: "invalid_administrator_target" }, { status: 400, headers });
          if (!(await isSystemMaster(sql, auth.userId)))
            return Response.json({ error: "system_master_required" }, { status: 403, headers });

          const result = await sql.query<{ result: string; administrator_count: number }>(
            "SELECT result,administrator_count FROM public.change_system_master($1,$2,$3)",
            [auth.userId, body.targetUserId, body.action],
          );
          const changed = result[0]?.result === "granted" || result[0]?.result === "revoked";
          if (changed) console.info(JSON.stringify({
            event: "system_master_role_changed",
            action: result[0]?.result,
            actorUserId: auth.userId,
            targetUserId: body.targetUserId,
            requestId: request.headers.get("x-request-id") || undefined,
          }));
          return Response.json(
            { ok: true, result: result[0]?.result ?? "unchanged", administratorCount: result[0]?.administrator_count ?? 0 },
            { headers },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "administrator_change_failed";
          const [errorCode, status] =
            message.includes("already exists") ? ["administrator_already_exists", 409] as const :
            message.includes("last active administrator") ? ["last_active_administrator_cannot_be_removed", 409] as const :
            message.includes("target account not found") ? ["target_account_not_found", 422] as const :
            message.includes("target account is inactive") ? ["target_account_is_inactive", 422] as const :
            message.includes("system administrator required") ? ["system_master_required", 403] as const :
            message.includes("self removal") ? ["self_removal_is_not_allowed", 409] as const :
            message.includes("invalid administrator action") ? ["invalid_administrator_action", 400] as const :
            ["administrator_change_failed", 500] as const;
          return Response.json({ error: errorCode }, { status, headers });
        } finally {
          sql.close();
        }
      },
    },
  },
});
