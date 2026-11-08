import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { kallistisCapabilities } from "@/server/characters/presentation";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const methodNotAllowed = () =>
  Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { ...headers, Allow: "GET" } },
  );

type PublicCharacterRow = {
  id: string;
  name: string;
  snapshot: Record<string, unknown>;
};

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const Route = createFileRoute("/api/public/taverna-dos-pandas")({
  server: {
    handlers: {
      DELETE: methodNotAllowed,
      GET: async () => {
        const url = getRuntimeDatabaseUrl();
        if (!url)
          return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });

        const sql = createBunPostgresExecutor(url);
        try {
          const rows = await sql.query<PublicCharacterRow>(
            `SELECT c.id, c.name, c.snapshot
               FROM public.characters c
               JOIN public.character_mesas cm ON cm.character_id=c.id
               JOIN public.mesas m ON m.id=cm.mesa_id
              WHERE m.slug = 'taverna-dos-pandas'
                AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')
                AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')
                AND c.status <> 'archived'
              ORDER BY c.name, c.id`,
            [],
          );

          if (rows.length !== 6 || new Set(rows.map((row) => row.id)).size !== 6)
            return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });

          return Response.json(
            {
              characters: rows.map(({ id, name, snapshot: rawSnapshot }) => {
                const snapshot = object(rawSnapshot);
                const history = object(snapshot.historia);
                const capabilities = kallistisCapabilities(snapshot as never).map((item) => ({
                  type: item.type,
                  name: item.name,
                  summary: item.canonical_definition.summary,
                }));
                return {
                  name,
                  concept: text(snapshot.conceito),
                  people: text(snapshot.povo),
                  peopleDescription: text(snapshot.povoDescricao),
                  origin: text(snapshot.origem),
                  originDescription: text(snapshot.origemDescricao),
                  office: text(snapshot.oficio),
                  officeDescription: text(snapshot.oficioDescricao) || text(snapshot.oficioNarrativo),
                  appearance: id === "hist-f3f3fbc1967c4c191819-04" ? null : text(snapshot.aparencia),
                  history: text(snapshot.biografia) || text(history.experiencia),
                  manifestations: text(snapshot.manifestacao_pessoal) || text(history.manifestacaoPessoal),
                  memory: text(snapshot.memoria) || text(history.vinculo),
                  promise: text(snapshot.promessa) || text(history.promessa),
                  loss: id === "hist-f3f3fbc1967c4c191819-02" ? null : text(snapshot.ferida),
                  question: text(snapshot.pergunta) || text(history.perguntaPessoal),
                  marco: Number.isInteger(snapshot.marco) ? snapshot.marco : null,
                  influence: object(snapshot.influencia),
                  capabilities,
                  complete: snapshot.completo === true && capabilities.length > 0,
                };
              }),
            },
            { headers },
          );
        } catch {
          return Response.json({ error: "public_roster_unavailable" }, { status: 503, headers });
        } finally {
          sql.close();
        }
      },
      PATCH: methodNotAllowed,
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
    },
  },
});
