import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/nexo/character-mesas")({ server: { handlers: {
  GET: async ({ request }) => {
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const id = new URL(request.url).searchParams.get("characterId"); if (!id) return Response.json({ error: "character_id_required" }, { status: 400, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      const rows = await sql.query(`SELECT m.id,m.name,m.slug FROM public.mesas m JOIN public.character_mesas cm ON cm.mesa_id=m.id JOIN public.characters c ON c.id=cm.character_id WHERE c.id=$1 AND c.owner_user_id=$2 AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') ORDER BY m.name`, [id,auth.userId]);
      return Response.json({ mesas: rows }, { headers });
    } finally { sql.close(); }
  },
  POST: async ({ request }) => {
    if (!isSameOriginRequest(request, process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app")) return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const mesaId = String(body?.mesaId || ""), characterId = String(body?.characterId || "");
    if (!mesaId || !characterId) return Response.json({ error: "invalid_character_link" }, { status: 422, headers });
    const url = getRuntimeDatabaseUrl(); if (!url) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
    const sql = createBunPostgresExecutor(url);
    try {
      await sql.transaction!(async (tx) => {
        const rows = await tx.query(`SELECT 1 FROM public.mesas m JOIN public.mesa_members mm ON mm.mesa_id=m.id JOIN public.characters c ON c.id=$2 WHERE m.id=$1 AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') AND mm.user_id=$3 AND mm.member_role IN ('jogador','mestre') AND mm.membership_status='active' AND c.owner_user_id=$3 AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') AND c.status <> 'archived' FOR UPDATE`, [mesaId,characterId,auth.userId]);
        if (!rows.length) throw new Error("nexo_character_or_membership_not_available");
        await tx.query(`INSERT INTO public.character_mesas(character_id,mesa_id) VALUES($1,$2) ON CONFLICT(character_id,mesa_id) DO NOTHING`, [characterId,mesaId]);
      });
      return Response.json({ linked: true }, { status: 201, headers });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "character_link_failed";
      return Response.json({ error: code }, { status: code.endsWith("forbidden") ? 403 : 409, headers });
    } finally { sql.close(); }
  },
} } });
