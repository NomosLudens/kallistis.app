import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

type PublicCharacter = {
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

export const Route = createFileRoute("/taverna-dos-pandas")({
  component: TavernaDosPandasPage,
});

function NarrativeBlock({ label, children }: { label: string; children: string | null }) {
  if (!children?.trim()) return null;
  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--gold)]">
        {label}
      </h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white/80">{children}</p>
    </section>
  );
}

function TavernaDosPandasPage() {
  const [characters, setCharacters] = useState<PublicCharacter[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/public/taverna-dos-pandas", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("roster_unavailable");
        return (await response.json()) as { characters?: PublicCharacter[] };
      })
      .then((result) => {
        if (!active) return;
        const roster = Array.isArray(result.characters) ? result.characters : [];
        if (roster.length !== 5) throw new Error("roster_unavailable");
        setCharacters(roster);
        setSelectedName(roster[0]?.name ?? "");
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = characters.find((character) => character.name === selectedName);

  return (
    <main className="min-h-screen bg-[#100f12] px-4 py-8 text-white sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--gold)]">
            KALLÍSTIS · Taverna dos Pandas
          </p>
          <h1 className="serif mt-3 text-3xl sm:text-5xl">Histórias antes da ficha</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">
            Conheça as personagens e os caminhos narrativos que seus jogadores trouxeram ao
            KALLÍSTIS. As escolhas mecânicas serão registradas pelos próprios jogadores.
          </p>
        </header>

        {loading ? (
          <p className="mt-12 text-center text-sm text-white/60" role="status">
            Carregando personagens…
          </p>
        ) : unavailable ? (
          <p
            className="mt-12 rounded-2xl border border-white/10 p-6 text-center text-sm text-white/70"
            role="status"
          >
            As fichas estão temporariamente indisponíveis.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <nav aria-label="Personagens da Taverna dos Pandas" className="min-w-0">
              <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
                {characters.map((character) => (
                  <button
                    key={character.name}
                    type="button"
                    aria-pressed={character.name === selectedName}
                    onClick={() => setSelectedName(character.name)}
                    className="min-h-11 shrink-0 rounded-xl border border-white/10 px-4 py-3 text-left text-sm transition hover:border-[color:var(--gold)]/50 aria-pressed:border-[color:var(--gold)]/70 aria-pressed:bg-white/5"
                  >
                    {character.name}
                  </button>
                ))}
              </div>
            </nav>

            {selected ? (
              <article className="min-w-0 rounded-3xl border border-white/10 bg-[#18161c] p-5 sm:p-8">
                <header className="border-b border-white/10 pb-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Personagem de jogador · rascunho narrativo
                  </p>
                  <h2 className="serif mt-2 text-3xl sm:text-4xl">{selected.name}</h2>
                  <p className="mt-3 text-sm text-white/65">
                    {[selected.people, selected.origin, selected.office]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <NarrativeBlock label="Povo" children={selected.peopleDescription} />
                  <NarrativeBlock label="Origem" children={selected.originDescription} />
                  <NarrativeBlock label="Ofício" children={selected.officeDescription} />
                  <NarrativeBlock
                    label="Aparência e personalidade"
                    children={selected.appearance}
                  />
                  <NarrativeBlock label="História" children={selected.history} />
                  <NarrativeBlock
                    label="Capacidades e manifestação"
                    children={selected.manifestations}
                  />
                  <NarrativeBlock label="Vínculo" children={selected.memory} />
                  <NarrativeBlock label="Promessa" children={selected.promise} />
                  <NarrativeBlock label="Perda" children={selected.loss} />
                  <NarrativeBlock label="Pergunta pessoal" children={selected.question} />
                </div>

                {!selected.complete ? (
                  <p className="mt-5 rounded-xl border border-white/10 px-4 py-3 text-sm text-white/55">
                    Nenhuma escolha mecânica foi registrada nesta ficha ainda.
                  </p>
                ) : null}
              </article>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
