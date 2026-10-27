import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSessionCookie } from "@/server/local-core/cookies";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { registerLocalPlayer } from "@/server/local-core/local-player-registration";
import { getRuntimeDatabaseUrl, getRuntimeEnv } from "@/server/runtime/context";

const headers = { "Cache-Control": "no-store" };
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function localGenesisDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const database = new URL(databaseUrl);
    return (
      LOOPBACK_HOSTS.has(database.hostname) &&
      database.port === "5432" &&
      database.pathname === "/kallistis_genesis"
    );
  } catch {
    return false;
  }
}

function localDevelopmentRequest(request: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function expectedOrigin(): string {
  return getRuntimeEnv().publicOrigin || "http://127.0.0.1:5175";
}

function registrationEnabled(request: Request): boolean {
  const runtime = getRuntimeEnv();
  return (
    runtime.workerRuntime !== true &&
    runtime.appEnv !== "production" &&
    localDevelopmentRequest(request) &&
    localGenesisDatabase(getRuntimeDatabaseUrl())
  );
}

export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!registrationEnabled(request)) {
          return Response.json({ error: "local_registration_disabled" }, { status: 404, headers });
        }
        if (!isSameOriginRequest(request, expectedOrigin())) {
          return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
        }
        const runtime = getRuntimeEnv();
        const databaseUrl = getRuntimeDatabaseUrl();
        if (!databaseUrl || !runtime.credentialLookupKey) {
          return Response.json({ error: "local_registration_unavailable" }, { status: 503, headers });
        }
        if (!checkRateLimit("local-player-registration", 5, 60 * 60).ok) {
          return Response.json({ error: "registration_rate_limited" }, { status: 429, headers });
        }

        const body = (await request.json().catch(() => null)) as {
          displayName?: unknown;
          pronouns?: unknown;
          credential?: unknown;
        } | null;
        if (
          !body ||
          typeof body.displayName !== "string" ||
          typeof body.pronouns !== "string" ||
          typeof body.credential !== "string"
        ) {
          return Response.json({ error: "registration_input_invalid" }, { status: 400, headers });
        }

        const sql = createBunPostgresExecutor(databaseUrl);
        try {
          const result = await registerLocalPlayer(sql, runtime.credentialLookupKey, {
            displayName: body.displayName,
            pronouns: body.pronouns,
            credential: body.credential,
          });
          return Response.json(
            { user: { id: result.userId }, player_label: result.playerLabel },
            {
              status: 201,
              headers: {
                ...headers,
                "Set-Cookie": buildSessionCookie(result.sessionToken, 30 * 24 * 60 * 60),
              },
            },
          );
        } catch (error) {
          const code = error instanceof Error ? error.message : "registration_failed";
          const status = code === "invite_capacity_exhausted" ? 409 : code.startsWith("registration_") ? 400 : 503;
          const errorCode = code === "invite_capacity_exhausted" ? code : code.startsWith("registration_") ? code : "registration_failed";
          return Response.json({ error: errorCode }, { status, headers });
        } finally {
          sql.close();
        }
      },
    },
  },
});
