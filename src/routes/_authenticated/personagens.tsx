import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Feather, Plus, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { deriveCharacterDisplayState } from "@/lib/character-display-state";

type Character = {
  id: string;
  name: string;
  status: string;
  ruleset?: string;
  snapshot?: Record<string, unknown>;
  mesas?: Array<{ name: string }>;
  version: number;
};
export const Route = createFileRoute("/_authenticated/personagens")({ component: PersonagensPage });
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function activeTrail(snapshot: Record<string, unknown>) {
  const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
  const index = Number.isInteger(snapshot.trilhaAtiva) ? Number(snapshot.trilhaAtiva) : 0;
  return trails[index] && typeof trails[index] === "object"
    ? (trails[index] as Record<string, unknown>)
    : {};
}
function PersonagensPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/characters?includeArchived=false", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          characters?: Character[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "characters_failed");
        if (!cancelled) setCharacters(payload.characters ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "characters_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const activeCharacters = useMemo(
    () => characters.filter((character) => character.status !== "archived"),
    [characters],
  );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#08080E] text-[#F3EBDD]">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 pb-24 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-[color:var(--gold)]">
              Jornada do jogador
            </p>
            <h1 className="serif mt-2 text-4xl">Personagens</h1>
            <p className="mt-2 text-sm text-[#F3EBDD]/60">
              Todas as suas personagens, cada uma com sua própria ficha e aprovação.
            </p>
          </div>
          <Link
            to="/criar-personagem"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--gold)]/45 px-4 text-sm text-[color:var(--gold)]"
          >
            <Plus className="h-4 w-4" /> Criar personagem
          </Link>
        </header>
        <aside
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111016] px-4 py-3"
          aria-label="Recuperar fichas antigas"
        >
          <p className="text-sm text-[#F3EBDD]/60">
            Rascunhos e fichas antigas continuam disponíveis no Forge.
          </p>
          <Link
            to={"/microapp?app=character-forge" as never}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[color:var(--gold)] hover:bg-white/5"
          >
            <Feather className="h-4 w-4" /> Recuperar ficha antiga
          </Link>
        </aside>
        {loading ? (
          <p className="text-sm text-[#F3EBDD]/60">Consultando personagens reais…</p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl border border-red-400/30 p-4 text-sm text-red-200">
            Não foi possível carregar suas personagens.
          </p>
        ) : null}
        {!loading && !error && activeCharacters.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
            <ScrollText className="mx-auto h-8 w-8 text-[color:var(--gold)]/70" />
            <h2 className="serif mt-3 text-2xl">Nenhum personagem oficial ainda</h2>
            <p className="mt-2 text-sm text-[#F3EBDD]/55">
              Comece uma nova ficha pela criação conversacional. Rascunhos antigos podem ser
              recuperados pelo Forge.
            </p>
          </section>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {activeCharacters.map((character) => (
            <CharacterCard key={character.id} character={character} />
          ))}
        </div>
      </div>
    </div>
  );
}
function CharacterCard({ character }: { character: Character }) {
  const snapshot = character.snapshot ?? {};
  if (character.ruleset === "KALLISTIS_NEXO_FINAL") {
    const fields = snapshot.fields && typeof snapshot.fields === "object"
      ? snapshot.fields as Record<string, unknown>
      : {};
    const canonical = snapshot.canonical && typeof snapshot.canonical === "object"
      ? snapshot.canonical as Record<string, unknown>
      : {};
    const complete = snapshot.creationStatus === "complete";
    const metadata = [text(fields.povo), fields.origemTrocado === true ? "Trocado · " + text(fields.modoTrocado) : "", text(fields.oficio), text(fields.papel), fields.marco ? "Marco " + String(fields.marco) : ""].filter(Boolean).join(" · ");
    return (
      <article className="rounded-2xl border border-white/10 bg-[#111016] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="serif text-2xl">{character.name || text(fields.concept) || "Personagem em construção"}</h2>
            <p className="mt-2 text-xs text-[#F3EBDD]/50">{metadata || "Ficha NEXO FINAL"}</p>
          </div>
          <span className="rounded-full border border-[color:var(--gold)]/35 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[color:var(--gold)]">
            {complete ? "Ficha pronta" : "Rascunho"}
          </span>
        </div>
        <p className="mt-4 text-sm text-[#F3EBDD]/65">
          {complete ? "Criação confirmada na revisão " + text(canonical.revision) + "." : "Continue a criação conversacional salva neste personagem."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={"/personagem/" + encodeURIComponent(character.id) + "/ficha" as never} className="rounded-lg border border-white/15 px-3 py-2 text-xs">Abrir ficha</Link>
          <Link to={"/criar-personagem?characterId=" + encodeURIComponent(character.id) as never} className="rounded-lg border border-[color:var(--gold)]/40 px-3 py-2 text-xs text-[color:var(--gold)]">Editar</Link>
        </div>
      </article>
    );
  }
  const trail = activeTrail(snapshot);
  const state = deriveCharacterDisplayState({
    status: character.status,
    completo: snapshot.completo === true,
  });
  const metadata = [
    text(snapshot.povo),
    text(trail.oficio),
    trail.marco ? `Marco ${trail.marco}` : "",
    (character.mesas ?? []).map((mesa) => mesa.name).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="rounded-2xl border border-white/10 bg-[#111016] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="serif text-2xl">{character.name || "Personagem sem nome"}</h2>
          <p className="mt-2 text-xs text-[#F3EBDD]/50">{metadata || "Ficha em construção"}</p>
        </div>
        <span className="rounded-full border border-[color:var(--gold)]/35 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[color:var(--gold)]">
          {state.playerLabel}
        </span>
      </div>
      <p className="mt-4 text-sm text-[#F3EBDD]/65">
        {state.key === "ready"
          ? "Sua ficha está completa e ainda não foi enviada ao Mestre."
          : state.key === "submitted"
            ? "Sua ficha foi enviada e aguarda a revisão do Mestre."
            : state.key === "rejected"
              ? "Revise a nota do Mestre e envie novamente quando estiver pronta."
              : "Continue construindo sua ficha no seu ritmo."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          to={`/personagem/${encodeURIComponent(character.id)}/ficha` as never}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs"
        >
          Abrir ficha
        </Link>
        {character.status === "draft" || character.status === "rejected" ? (
          <Link
            to={
              `/microapp?app=character-forge&characterId=${encodeURIComponent(character.id)}` as never
            }
            className="rounded-lg border border-[color:var(--gold)]/40 px-3 py-2 text-xs text-[color:var(--gold)]"
          >
            Editar
          </Link>
        ) : null}
        {state.key === "ready" ? <SubmitButton characterId={character.id} /> : null}
      </div>
    </article>
  );
}
function SubmitButton({ characterId }: { characterId: string }) {
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit", id: characterId }),
      });
      if (!response.ok) throw new Error("Não foi possível enviar a ficha.");
      window.location.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar a ficha.");
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void submit()}
      disabled={busy}
      className="rounded-lg bg-[color:var(--gold)] px-3 py-2 text-xs text-black disabled:opacity-60"
    >
      {busy ? "Enviando…" : "Enviar ao Mestre"}
    </button>
  );
}
