import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { CharacterVisualSheet } from "@/components/CharacterVisualSheet";
import { RouteErrorBoundary, RouteNotFoundBoundary } from "@/components/loading-states";

type NexoSheetRecord = {
  id: string;
  name: string;
  version: number;
  snapshot: {
    canonical: { revision: string };
    creationStatus: "draft" | "complete";
    fields: Record<string, string | number | boolean | null>;
    learnedCapabilities: Array<{ name: string; evidence: { book: string; section: string; page: number } }>;
    povoEvidence: { book: string; section: string; page: number; text: string } | null;
    trocadoEvidence: { book: string; section: string; page: number; text: string } | null;
  };
};

export const Route = createFileRoute("/_authenticated/personagem/$characterId/ficha")({
  component: CharacterVisualSheetRoute,
  errorComponent: RouteErrorBoundary,
  notFoundComponent: () => <RouteNotFoundBoundary />,
});

function CharacterVisualSheetRoute() {
  const { characterId } = Route.useParams();
  const [mode, setMode] = useState<"loading" | "nexo" | "legacy" | "error">("loading");
  const [nexo, setNexo] = useState<NexoSheetRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/nexo-character-creation?characterId=" + encodeURIComponent(characterId), {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (response.status === 404) {
        if (active) setMode("legacy");
        return;
      }
      if (!response.ok) throw new Error("A ficha não pôde ser recuperada do servidor.");
      const payload = await response.json() as { character: NexoSheetRecord };
      if (active) { setNexo(payload.character); setMode("nexo"); }
    }).catch((cause) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : "Falha ao carregar a ficha.");
        setMode("error");
      }
    });
    return () => { active = false; };
  }, [characterId]);

  if (mode === "loading") return <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-white/55">Abrindo ficha…</div>;
  if (mode === "error") return <div role="alert" className="mx-auto max-w-3xl px-4 py-12 text-sm text-red-100">{error}</div>;
  if (mode === "nexo" && nexo) return <NexoCharacterSheet character={nexo} />;
  return <CharacterVisualSheet characterId={characterId} />;
}

function NexoCharacterSheet({ character }: { character: NexoSheetRecord }) {
  const f = character.snapshot.fields;
  const sections: Array<[string, string | number | boolean | null]> = [
    ["Conceito", f.concept], ["Povo", f.povo], ["Herança do Povo", f.herancaPovo], ["Origem", f.origem],
    ["Origem Trocado", f.origemTrocado ? "Sim" : "Não"],
    ...(f.origemTrocado ? [["Forma de Trocado", f.modoTrocado] as [string, string | number | boolean | null]] : []),
    ["Luz", f.luz], ["Escuridão", f.escuridao], ["Ofício", f.oficio],
    ["Papel", f.papel], ["Chave", f.chave], ["Marco", f.marco],
    ["Promessa", f.promessa], ["Vínculo", f.vinculo], ["Experiência", f.experiencia],
    ["Ferida Marcante", f.feridaMarcante], ["Equipamento", f.equipamento],
    ["Relações", f.relacoes], ["Pergunta pessoal", f.perguntaPessoal],
    ["Manifestação Pessoal", f.manifestacaoPessoal],
  ];
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 text-[#f2e9d9] sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--gold)]">KALLÍSTIS · NEXO FINAL</p>
          <h1 className="serif mt-2 text-4xl">{String(f.name || character.name || "Personagem sem nome")}</h1>
          <p className="mt-2 text-xs text-white/45">Ficha de personagem · versão {character.version} · {character.snapshot.canonical.revision}</p>
        </div>
        <a href={"/criar-personagem?characterId=" + encodeURIComponent(character.id)} className="rounded-xl border border-[color:var(--gold)]/40 px-4 py-2.5 text-sm text-[color:var(--gold)]">Editar ficha</a>
      </header>
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-white/70">
        <p><strong>Conceito:</strong> {String(f.concept || "—")}</p>
        <p className="mt-2"><strong>Ofício:</strong> {String(f.oficio || "—")} · <strong>Papel:</strong> {String(f.papel || "—")} · <strong>Marco:</strong> {String(f.marco || 1)}</p>
        {character.snapshot.learnedCapabilities.map((capability) => (
          <p key={capability.name} className="mt-2"><strong>Técnica inicial:</strong> {capability.name} <span className="text-xs text-white/40">({capability.evidence.book}, {capability.evidence.section}, p. {capability.evidence.page})</span></p>
        ))}
      </div>
      {character.snapshot.povoEvidence ? <section className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4"><h2 className="text-[10px] uppercase tracking-[0.16em] text-white/40">Definição canônica do Povo · {character.snapshot.povoEvidence.book}, {character.snapshot.povoEvidence.section}, p. {character.snapshot.povoEvidence.page}</h2><pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5 text-white/65">{character.snapshot.povoEvidence.text}</pre></section> : null}
      {character.snapshot.trocadoEvidence ? <section className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4"><h2 className="text-[10px] uppercase tracking-[0.16em] text-white/40">Regra canônica de Trocado · {character.snapshot.trocadoEvidence.book}, {character.snapshot.trocadoEvidence.section}, p. {character.snapshot.trocadoEvidence.page}</h2><pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5 text-white/65">{character.snapshot.trocadoEvidence.text}</pre></section> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {sections.map(([label, value]) => (
          <section key={label} className="rounded-xl border border-white/10 bg-black/10 p-4">
            <h2 className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/80">{String(value ?? "—")}</p>
          </section>
        ))}
      </div>
      <footer className="mt-6 rounded-xl border border-white/10 p-4 text-xs text-white/45">
        Criação {character.snapshot.creationStatus === "complete" ? "confirmada" : "em rascunho"} · Fonte: Livro III, “Criação de personagem NEXO”, p. 92 · revisão {character.snapshot.canonical.revision}
      </footer>
    </main>
  );
}
