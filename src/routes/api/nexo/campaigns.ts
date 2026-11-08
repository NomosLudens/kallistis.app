import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { isNexoRuleset } from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/nexo/campaigns")({ server: { handlers: {
  GET: async ({ request }) => {
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const mesaId = new URL(request.url).searchParams.get("mesaId"); if (!mesaId) return Response.json({ error: "mesa_id_required" }, { status: 400, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const membership = await sql.query(`SELECT 1 FROM public.mesa_members WHERE mesa_id=$1 AND user_id=$2 AND membership_status='active'`, [mesaId,auth.userId]);
      if (!membership.length) return Response.json({ error: "mesa_access_forbidden" }, { status: 403, headers });
      const rows = await sql.query(`SELECT c.id,c.name,c.status,c.ruleset,c.created_at FROM public.campaigns c JOIN public.mesas m ON m.id=c.mesa_id WHERE c.mesa_id=$1 AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') AND c.ruleset=m.ruleset ORDER BY c.created_at`, [mesaId]);
      return Response.json({ campaigns: rows }, { headers });
    } finally { sql.close(); }
  },
  POST: async ({ request }) => {
    if (!isSameOriginRequest(request, process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app")) return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const mesaId = String(body?.mesaId || ""), name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!mesaId || name.length < 1 || name.length > 120) return Response.json({ error: "invalid_campaign" }, { status: 422, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const result = await sql.transaction!(async (tx) => {
        const rows = await tx.query<{ ruleset: string | null }>(`SELECT m.ruleset FROM public.mesas m JOIN public.mesa_members mm ON mm.mesa_id=m.id WHERE m.id=$1 AND mm.user_id=$2 AND mm.member_role='mestre' AND mm.membership_status='active' FOR UPDATE`, [mesaId,auth.userId]);
        if (!rows.length) throw new Error("mesa_master_access_forbidden");
        if (!isNexoRuleset(rows[0].ruleset)) throw new Error("mesa_ruleset_not_nexo");
        const campaign = await tx.query(`INSERT INTO public.campaigns(mesa_id,name,status,ruleset) VALUES($1,$2,'active',$3) RETURNING id,name,status,ruleset,created_at`, [mesaId,name,rows[0].ruleset]);
        return campaign[0];
      });
      return Response.json({ campaign: result }, { status: 201, headers });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "campaign_create_failed";
      return Response.json({ error: code }, { status: code.endsWith("_forbidden") ? 403 : 409, headers });
    } finally { sql.close(); }
  },
} } });
