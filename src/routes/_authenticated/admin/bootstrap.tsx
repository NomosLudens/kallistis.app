import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type BootstrapState = {
  canBootstrap?: boolean;
  currentUser?: { id: string; displayName: string | null };
  error?: string;
};

export const Route = createFileRoute("/_authenticated/admin/bootstrap")({ component: InitialAdminBootstrapPage });

function InitialAdminBootstrapPage() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/system-administrators", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as BootstrapState | null;
        if (!response.ok || !payload) throw new Error(payload?.error ?? "bootstrap_unavailable");
        if (active) setState(payload);
      })
      .catch((error: unknown) => {
        if (active) setState({ error: error instanceof Error ? error.message : "bootstrap_unavailable" });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function bootstrap() {
    const name = state?.currentUser?.displayName?.trim() || "esta conta";
    if (!window.confirm(
      `Tornar ${name} o primeiro administrador do KALLÍSTIS neste ambiente local?\n\nAdministradores têm acesso global às Mesas e às funções administrativas.`,
    )) return;
    setWorking(true);
    try {
      const response = await fetch("/api/admin/system-administrators", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bootstrap" }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "bootstrap_failed");
      toast.success("Administrador inicial configurado.");
      // Recarrega a autorização do perfil: o cache de navegação da sessão
      // atual ainda pode refletir o estado anterior ao bootstrap.
      window.location.assign("/mestre");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível configurar o administrador inicial.");
      setWorking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className="w-full space-y-5 rounded-2xl border border-[color:var(--gold)]/35 bg-[#0C0B12]/70 p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-[color:var(--gold)]" aria-hidden="true" />
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--gold)]">Configuração local</p>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--ivory)]">Administrador inicial</h1>
          </div>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[color:var(--ivory-dim)]"><Loader2 className="h-4 w-4 animate-spin" />Verificando o ambiente…</p>
        ) : state?.canBootstrap ? (
          <>
            <p className="text-sm leading-relaxed text-[color:var(--ivory-dim)]">
              Não há administrador global cadastrado. Esta ação pode ser feita uma única vez, somente com uma sessão autenticada no servidor local de desenvolvimento e banco local. Ela concede acesso administrativo à conta <strong className="text-[color:var(--ivory)]">{state.currentUser?.displayName?.trim() || "sem nome"}</strong>.
            </p>
            <Button type="button" className="w-full sm:w-auto" disabled={working} onClick={() => void bootstrap()}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Configurar como primeiro administrador
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-[color:var(--ivory-dim)]">
              O bootstrap inicial só está disponível no Genesis local quando ainda não há administrador global. Peça a um administrador autorizado para conceder acesso por `/mestre`.
            </p>
            <a className="text-sm text-[color:var(--gold)] underline underline-offset-4" href="/perfil">Voltar ao perfil</a>
          </div>
        )}
      </section>
    </main>
  );
}
