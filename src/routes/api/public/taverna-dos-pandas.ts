import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";

const CHARACTER_IDS = [
  "hist-f3f3fbc1967c4c191819-02",
  "hist-f3f3fbc1967c4c191819-03",
  "hist-f3f3fbc1967c4c191819-04",
  "hist-f3f3fbc1967c4c191819-05",
  "hist-f3f3fbc1967c4c191819-06",
] as const;

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

type PublicCharacterRow = {
  id: string;
  name: string;
  people: string | null;
  peopleDescription: string | null;
  origin: string | null;
  originDescription: string | null;
  office: string | null;
  officeDescription: string | null;
  appearance: string | null;
  history: string | null;
  manifestations: string | null;
  memory: string | null;
  promise: string | null;
  loss: string | null;
  question: string | null;
  complete: boolean;
};

export const Route = createFileRoute("/api/public/taverna-dos-pandas")({
  server: {
    handlers: {
      GET: async () => {
        const url = getRuntimeDatabaseUrl();
        if (!url)
          return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });

        const sql = createBunPostgresExecutor(url);
        try {
          const allowedIds = CHARACTER_IDS.map(
            (_, index) => `($${index + 1}::text,${index + 1})`,
          ).join(",");
          const rows = await sql.query<PublicCharacterRow>(
            `WITH allowed(id, position) AS (VALUES ${allowedIds})
             SELECT c.id, c.name,
                    c.snapshot->>'povo' AS people,
                    c.snapshot->>'povoDescricao' AS "peopleDescription",
                    c.snapshot->>'origem' AS origin,
                    c.snapshot->>'origemDescricao' AS "originDescription",
                    c.snapshot->>'oficioNarrativo' AS office,
                    c.snapshot->>'oficioDescricao' AS "officeDescription",
                    CASE WHEN c.id = 'hist-f3f3fbc1967c4c191819-04'
                         THEN NULL ELSE c.snapshot->>'aparencia' END AS appearance,
                    c.snapshot->>'biografia' AS history,
                    c.snapshot->>'manifestacao_pessoal' AS manifestations,
                    c.snapshot->>'memoria' AS memory,
                    c.snapshot->>'promessa' AS promise,
                    CASE WHEN c.id = 'hist-f3f3fbc1967c4c191819-02'
                         THEN NULL ELSE c.snapshot->>'ferida' END AS loss,
                    c.snapshot->>'pergunta' AS question,
                    COALESCE((c.snapshot->>'completo')::boolean, false) AS complete
               FROM allowed
               JOIN public.characters c ON c.id=allowed.id
               JOIN public.character_mesas cm ON cm.character_id=c.id
               JOIN public.mesas m ON m.id=cm.mesa_id
              WHERE m.slug = 'taverna-dos-pandas'
                AND c.status <> 'archived'
              ORDER BY allowed.position`,
            [...CHARACTER_IDS],
          );

          if (
            rows.length !== CHARACTER_IDS.length ||
            new Set(rows.map((row) => row.id)).size !== CHARACTER_IDS.length
          )
            return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });

          return Response.json(
            {
              characters: rows.map(({ id: _id, ...character }) => character),
            },
            { headers },
          );
        } catch {
          return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });
        } finally {
          sql.close();
        }
      },
    },
  },
});
