import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { isSystemMaster } from "@/server/local-core/player-access";
import { NEXO_RULESET } from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/nexo/mesas")({ server: { handlers: {
  GET: async ({ request }) => {
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const rows = await sql.query<Record<string, unknown>>(`SELECT m.id,m.slug,m.name,m.ruleset,mm.member_role,mm.membership_status FROM public.mesas m JOIN public.mesa_members mm ON mm.mesa_id=m.id WHERE mm.user_id=$1 AND mm.membership_status='active' AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') ORDER BY m.name`, [auth.userId]);
      return Response.json({ mesas: rows, canCreateMesa: await isSystemMaster(sql, auth.userId) }, { headers });
    } finally { sql.close(); }
  },
  POST: async ({ request }) => {
    if (!isSameOriginRequest(request, process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app")) return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const sqlUrl = getRuntimeDatabaseUrl(); if (!sqlUrl) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(sqlUrl);
    try {
      if (!(await isSystemMaster(sql, auth.userId))) return Response.json({ error: "system_master_required" }, { status: 403, headers });
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
      if (name.length < 1 || name.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return Response.json({ error: "invalid_mesa" }, { status: 422, headers });
      const mesa = await sql.transaction!(async (tx) => {
        const rows = await tx.query<Record<string, unknown>>(`INSERT INTO public.mesas(slug,name,ruleset) VALUES($1,$2,$3) RETURNING id,slug,name,ruleset`, [slug,name,NEXO_RULESET]);
        await tx.query(`INSERT INTO public.mesa_members(mesa_id,user_id,member_role,membership_status) VALUES($1,$2,'mestre','active')`, [rows[0].id,auth.userId]);
        await tx.query(`INSERT INTO public.nexo_coro_state(mesa_id) VALUES($1) ON CONFLICT(mesa_id) DO NOTHING`, [rows[0].id]);
        return rows[0];
      });
      return Response.json({ mesa }, { status: 201, headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : "nexo_mesa_create_failed";
      return Response.json({ error: message.includes("unique") ? "mesa_slug_in_use" : message }, { status: 409, headers });
    } finally { sql.close(); }
  },
} } });
