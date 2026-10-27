import { createFileRoute, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";

const HTML_APPS = {
  "character-forge": {
    title: "Character Forge",
    src: "/jogar/character-forge.html",
  },
  velarim: {
    title: "Velarim",
    src: "/jogar/velarim.html",
  },
  "canon-explorer": {
    title: "Canon Explorer",
    src: "/jogar/canon-explorer.html",
  },
} as const;

type HtmlAppId = keyof typeof HTML_APPS;

function MicroappPage() {
  const search = useSearch({ from: "/_authenticated/microapp" }) as {
    app?: string;
    mode?: string;
    characterId?: string;
    returnTo?: string;
  };
  const app = search.app && search.app in HTML_APPS ? HTML_APPS[search.app as HtmlAppId] : null;
  const returnTo =
    typeof search.returnTo === "string" && /^\/chat\/[a-z0-9-]{36}$/i.test(search.returnTo)
      ? search.returnTo
      : "/chat";

  if (!app) {
    return (
      <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center">
        Superfície não encontrada.
      </div>
    );
  }

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0a0910]/90 px-3 backdrop-blur sm:px-5">
        <a
          href={returnTo}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>Voltar à conversa</span>
        </a>
        <div className="flex items-center gap-2 text-xs text-white/45 sm:text-sm">
          <Sparkles className="h-4 w-4 text-[color:var(--gold)]" aria-hidden />
          <span className="truncate">{app.title}</span>
        </div>
      </header>
      <iframe
        title={app.title}
        src={
          app.src +
          (search.mode === "tal" && search.characterId
            ? `?mode=tal&characterId=${encodeURIComponent(search.characterId)}&source=master-characters-hub`
            : search.characterId
              ? `?characterId=${encodeURIComponent(search.characterId)}`
              : "")
        }
        className="min-h-0 w-full flex-1 border-0"
      />
    </main>
  );
}

export const Route = createFileRoute("/_authenticated/microapp")({ component: MicroappPage });
