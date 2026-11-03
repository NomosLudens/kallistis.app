import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CharacterVisualSheet } from "@/components/CharacterVisualSheet";
import { NexoNarrativeSheet } from "@/components/NexoNarrativeSheet";
import { RouteErrorBoundary, RouteNotFoundBoundary } from "@/components/loading-states";

const NEXO_RULESETS = new Set(["KALLISTIS_NEXO_1", "KALLISTIS_NEXO_FINAL"]);
type CharacterPayload = Record<string, unknown> & {
  ruleset?: string;
  id?: string;
  snapshot?: Record<string, unknown>;
};

export const Route = createFileRoute("/_authenticated/personagem/$characterId/ficha")({
  component: CharacterVisualSheetRoute,
  errorComponent: RouteErrorBoundary,
  notFoundComponent: () => <RouteNotFoundBoundary />,
});

function CharacterVisualSheetRoute() {
  const { characterId } = Route.useParams();
  const [record, setRecord] = useState<CharacterPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function read(path: string) {
      return fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
    }
    void (async () => {
      try {
        let response = await read(`/api/characters?characterId=${encodeURIComponent(characterId)}`);
        if (response.status === 404 || response.status === 403)
          response = await read(
            `/api/master/characters?characterId=${encodeURIComponent(characterId)}`,
          );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.character?.id !== characterId)
          throw new Error(payload?.error || "character_not_found");
        if (active) setRecord(payload.character);
      } catch (cause) {
        if (active && !controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "character_sheet_failed");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [characterId]);

  if (!loaded)
    return (
      <div className="p-8 text-white/60" role="status">
        Carregando ficha…
      </div>
    );
  if (record && NEXO_RULESETS.has(String(record.ruleset)))
    return <NexoNarrativeSheet character={record as never} />;
  if (record) return <CharacterVisualSheet characterId={characterId} />;
  return (
    <main className="mx-auto max-w-3xl p-8 text-white/70" role="alert">
      Não foi possível abrir esta ficha: {error || "personagem não encontrado"}.
    </main>
  );
}
