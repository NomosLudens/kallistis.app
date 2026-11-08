import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { isNexoRuleset } from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/nexo/sessions")({ server: { handlers: {
  GET: async ({ request }) => {
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const mesaId = new URL(request.url).searchParams.get("mesaId"); if (!mesaId) return Response.json({ error: "mesa_id_required" }, { status: 400, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const member = await sql.query(`SELECT 1 FROM public.mesa_members WHERE mesa_id=$1 AND user_id=$2 AND membership_status='active'`, [mesaId,auth.userId]);
      if (!member.length) return Response.json({ error: "mesa_access_forbidden" }, { status: 403, headers });
      const rows = await sql.query(`SELECT id,campaign_id,title,status,started_at,ended_at FROM public.mesa_live_sessions WHERE mesa_id=$1 AND ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') ORDER BY started_at DESC`, [mesaId]);
      return Response.json({ sessions: rows }, { headers });
    } finally { sql.close(); }
  },
  POST: async ({ request }) => {
    if (!isSameOriginRequest(request, process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app")) return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const mesaId = String(body?.mesaId || ""), campaignId = String(body?.campaignId || ""), title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!mesaId || !campaignId || title.length < 1 || title.length > 160) return Response.json({ error: "invalid_session" }, { status: 422, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const result = await sql.transaction!(async (tx) => {
        const allowed = await tx.query<{ ruleset: string }>(`SELECT m.ruleset FROM public.mesas m JOIN public.mesa_members mm ON mm.mesa_id=m.id JOIN public.campaigns c ON c.mesa_id=m.id WHERE m.id=$1 AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') AND mm.user_id=$2 AND mm.member_role='mestre' AND mm.membership_status='active' AND c.id=$3 AND c.ruleset=m.ruleset AND c.status='active' FOR UPDATE`, [mesaId,auth.userId,campaignId]);
        if (!allowed.length) throw new Error("nexo_campaign_master_access_forbidden");
        if (!isNexoRuleset(allowed[0].ruleset)) throw new Error("mesa_ruleset_not_nexo");
        const rows = await tx.query(`INSERT INTO public.mesa_live_sessions(mesa_id,campaign_id,title,status,created_by_user_id,ruleset) VALUES($1,$2,$3,'live',$4,$5) RETURNING id,mesa_id,campaign_id,title,status,started_at,ruleset`, [mesaId,campaignId,title,auth.userId,allowed[0].ruleset]);
        return rows[0];
      });
      return Response.json({ session: result }, { status: 201, headers });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "session_create_failed";
      return Response.json({ error: code }, { status: code.endsWith("forbidden") ? 403 : 409, headers });
    } finally { sql.close(); }
  },
} } });
