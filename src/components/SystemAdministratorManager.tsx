import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, ShieldPlus, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ManagedAccount = {
  id: string;
  displayName: string | null;
  status: "active" | "disabled";
  isSystemMaster: boolean;
  grantedAt: string | null;
};
type RoleEvent = {
  actor: string | null;
  target: string | null;
  action: "bootstrap" | "grant" | "revoke";
  createdAt: string;
};
type AdminState = {
  users: ManagedAccount[];
  events: RoleEvent[];
  administratorCount: number;
};

const label = (name: string | null) => name?.trim() || "Conta sem nome";

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const labels: Record<string, string> = {
    administrator_already_exists: "A configuração do primeiro administrador já foi realizada.",
    administrator_change_failed: "Não foi possível alterar o acesso administrativo.",
    invalid_administrator_action: "A ação solicitada não é válida.",
    last_active_administrator_cannot_be_removed: "É necessário manter ao menos um administrador ativo.",
    self_removal_is_not_allowed: "Outro administrador precisa retirar seu acesso.",
    target_account_is_inactive: "Só é possível promover uma conta ativa.",
    target_account_not_found: "A conta selecionada não está disponível.",
    system_master_required: "Esta ação exige acesso de administrador.",
  };
  return labels[message] ?? message ?? "Não foi possível alterar os administradores.";
}

export function SystemAdministratorManager() {
  const [state, setState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/system-administrators", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as (AdminState & { error?: string }) | null;
      if (!response.ok || !data) throw new Error(data?.error ?? "admin_list_unavailable");
      setState(data);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const candidates = useMemo(
    () => state?.users.filter((user) => user.status === "active" && !user.isSystemMaster) ?? [],
    [state?.users],
  );
  const administrators = useMemo(
    () => state?.users.filter((user) => user.isSystemMaster) ?? [],
    [state?.users],
  );

  async function changeRole(user: ManagedAccount, action: "grant" | "revoke") {
    const userLabel = label(user.displayName);
    if (action === "grant" && !window.confirm(
      `Conceder administração global a ${userLabel}?\n\nEssa conta poderá acessar e administrar todas as Mesas e funções globais do KALLÍSTIS.`,
    )) return;
    if (action === "revoke" && !window.confirm(
      `Retirar o papel de administrador de ${userLabel}?\n\nO histórico, a conta e eventuais vínculos como Mestre de Mesa serão preservados.`,
    )) return;
    setPending(user.id);
    try {
      const response = await fetch("/api/admin/system-administrators", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, targetUserId: user.id }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "administrator_change_failed");
      toast.success(action === "grant" ? `${userLabel} agora é administrador.` : `Acesso administrativo de ${userLabel} retirado.`);
      await load();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setPending("");
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-5 text-sm text-[#F3EBDD]/55"><Loader2 className="h-4 w-4 animate-spin" />Carregando administradores…</div>;
  if (!state) return <p className="text-sm text-red-200">Não foi possível carregar a gestão de administradores.</p>;

  return (
    <section className="space-y-5 rounded-xl border border-[color:var(--gold)]/35 bg-black/15 p-4 sm:p-5" aria-label="Administradores do sistema">
      <header className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold)]" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--gold)]">Administradores do sistema</h3>
          <p className="mt-1 text-xs leading-relaxed text-[color:var(--ivory-dim)]">
            Contas novas são criadas pelo cadastro normal e promovidas aqui. Remover este papel preserva a conta, os dados e as funções de Mestre em Mesas específicas.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="block text-xs text-[color:var(--ivory-dim)]" htmlFor="system-admin-candidate">
          Conta ativa
          <select id="system-admin-candidate" className="mt-2 w-full rounded-xl border border-[color:var(--border)] bg-card px-4 py-3 text-sm text-foreground" value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)} disabled={!candidates.length || Boolean(pending)}>
            <option value="">{candidates.length ? "Escolha para promover…" : "Nenhuma conta ativa disponível"}</option>
            {candidates.map((user) => <option key={user.id} value={user.id}>{label(user.displayName)}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" disabled={!selectedCandidateId || Boolean(pending)} onClick={() => {
          const user = candidates.find((candidate) => candidate.id === selectedCandidateId);
          if (user) void changeRole(user, "grant");
        }}>
          {pending === selectedCandidateId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldPlus className="mr-2 h-4 w-4" />}
          Conceder administrador
        </Button>
        <p className="text-xs text-[#F3EBDD]/45 sm:pb-3">{state.administratorCount} administrador{state.administratorCount === 1 ? "" : "es"} ativo{state.administratorCount === 1 ? "" : "s"}</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wider text-[#F3EBDD]/55">Acesso administrativo atual</h4>
        {administrators.length ? administrators.map((user) => (
          <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-[color:var(--ivory)]">{label(user.displayName)}{user.status === "disabled" ? " · conta desativada" : ""}</p>
              <p className="mt-1 text-[11px] text-[#F3EBDD]/40">{user.grantedAt ? `Concedido em ${new Date(user.grantedAt).toLocaleString("pt-BR")}` : "Papel de administrador"}</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={Boolean(pending) || user.status === "active" && state.administratorCount <= 1} onClick={() => void changeRole(user, "revoke")} aria-label={`Retirar administrador de ${label(user.displayName)}`}>
              {pending === user.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldX className="mr-2 h-4 w-4" />}
              Retirar acesso
            </Button>
          </div>
        )) : <p className="text-sm text-[#F3EBDD]/45">Nenhum administrador registrado.</p>}
      </div>

      {state.events.length ? (
        <details className="rounded-lg border border-white/10 px-3 py-3">
          <summary className="cursor-pointer text-xs text-[color:var(--ivory-dim)]">Histórico de concessões e remoções</summary>
          <ul className="mt-3 space-y-2">
            {state.events.map((event, index) => (
              <li key={`${event.createdAt}:${index}`} className="text-xs leading-relaxed text-[#F3EBDD]/50">
                {new Date(event.createdAt).toLocaleString("pt-BR")} · {event.action === "bootstrap" ? "primeiro administrador configurado" : event.action === "grant" ? "acesso concedido" : "acesso retirado"} · {label(event.actor)} → {label(event.target)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
