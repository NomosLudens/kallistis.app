import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Download,
  LoaderCircle,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

type DraftSummary = {
  id: string;
  name: string;
  status: string;
  version: number;
  updated_at: string;
};
type Message = { role: "user" | "assistant"; content: string; created_at?: string };
type CreationCharacter = {
  id: string;
  status: string;
  version: number;
  snapshot: Record<string, unknown>;
};
type PendingProposal = {
  path: string;
  label: string;
  value: unknown;
  sourceText: string;
  dependencies: string[];
  effects: string[];
};
type Conversation = {
  targetMarco: number;
  pending: PendingProposal[];
  providerUnavailable: boolean;
  confirmedPaths: string[];
  confirmed: Array<{ path: string; label: string; value: unknown }>;
  progress: { complete: number; total: number };
  nextOptions: {
    path: string;
    label: string;
    kind: string;
    options: string[];
    names: string[];
    pool: number[];
    min?: number;
    max?: number;
  } | null;
};
type MemoryRecord = Record<string, unknown>;
type CreationMemory = {
  qa: MemoryRecord[];
  narrativeIdentity: MemoryRecord[];
  choices: MemoryRecord[];
  inferences: MemoryRecord[];
  pendingContradictions: MemoryRecord[];
  consultedSources: MemoryRecord[];
};
type Detail = {
  character: CreationCharacter;
  messages: Message[];
  conversation: Conversation;
  memory: CreationMemory;
  progression?: Array<{ id: string; fromMarco: number; toMarco: number; status: string }>;
  progressionChoices?: {
    currentMarco: number;
    choices: Array<{
      id: string;
      label: string;
      kind: "choice" | "multi";
      options: string[];
      min?: number;
      max?: number;
      value: unknown;
    }>;
    next: {
      id: string;
      label: string;
      kind: "choice" | "multi";
      options: string[];
      min?: number;
      max?: number;
    } | null;
    complete: boolean;
  };
};
export const Route = createFileRoute("/_authenticated/criar-personagem")({
  component: ConversationalCreationPage,
});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      payload.error === "generation_incomplete"
        ? "A IA interrompeu a resposta. Nada foi gravado nesta tentativa; sua mensagem foi preservada para nova tentativa."
        : payload.error || "Falha ao salvar a conversa.",
    );
  return payload;
}

function ConversationalCreationPage() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [distribution, setDistribution] = useState<Record<string, number>>({});
  const [targetMarco, setTargetMarco] = useState(1);
  const [progressionSelection, setProgressionSelection] = useState<string | string[] | null>(null);
  const logRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [detail?.messages.length]);

  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get("seed");
    if (seed) setMessage(seed.slice(0, 12000));
  }, []);

  const next = conversation?.nextOptions;
  useEffect(() => {
    setSelected([]);
    setDistribution({});
  }, [next?.path]);
  useEffect(() => setProgressionSelection(null), [detail?.progressionChoices?.next?.id]);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ drafts: DraftSummary[] }>("/api/character-creation");
      setDrafts(result.drafts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar os rascunhos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  async function openDraft(id: string) {
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>(
        "/api/character-creation?characterId=" + encodeURIComponent(id),
      );
      setDetail(result);
      setConversation(result.conversation);
      setTargetMarco(result.conversation.targetMarco);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível recuperar esta ficha.");
    } finally {
      setSending(false);
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const firstMessage = message.trim();
    if (!firstMessage || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", message: firstMessage, targetMarco }),
      });
      setDetail(result);
      setConversation(result.conversation);
      setMessage("");
      await loadDrafts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A ficha não foi criada.");
    } finally {
      setSending(false);
    }
  }

  async function sendText(text: string) {
    if (!detail || !text.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: detail.character.status === "approved" ? "progression_turn" : "turn",
          characterId: detail.character.id,
          expectedVersion: detail.character.version,
          message: text.trim(),
        }),
      });
      setDetail(result);
      setConversation(result.conversation);
      setMessage("");
      await loadDrafts();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mensagem não foi salva. Tente novamente.",
      );
    } finally {
      setSending(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    await sendText(message);
  }
  async function choose(value: unknown) {
    if (!detail || !next || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "choose",
          characterId: detail.character.id,
          expectedVersion: detail.character.version,
          path: next.path,
          value,
        }),
      });
      setDetail(result);
      setConversation(result.conversation);
      await loadDrafts();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A opção foi recusada pela validação canônica.",
      );
    } finally {
      setSending(false);
    }
  }
  async function changeTargetMarco(value: number) {
    if (!detail || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "target_marco",
          characterId: detail.character.id,
          expectedVersion: detail.character.version,
          targetMarco: value,
        }),
      });
      setDetail(result);
      setConversation(result.conversation);
      setTargetMarco(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível definir o Marco.");
    } finally {
      setSending(false);
    }
  }
  async function progressionAction(
    action:
      | "progression_request"
      | "progression_start"
      | "progression_apply"
      | "progression_choice",
  ) {
    if (!detail || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<Detail>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          characterId: detail.character.id,
          expectedVersion: detail.character.version,
          ...(action === "progression_choice"
            ? { choiceId: detail.progressionChoices?.next?.id, value: progressionSelection }
            : {}),
        }),
      });
      setDetail(result);
      setConversation(result.conversation);
      setProgressionSelection(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível avançar o Marco.");
    } finally {
      setSending(false);
    }
  }
  async function sendAction(action: "confirm" | "cancel" | "retry") {
    if (!detail || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{
        character: CreationCharacter;
        messages?: Message[];
        reply?: string;
        completed?: boolean;
        conversation: Conversation;
        memory: CreationMemory;
      }>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          characterId: detail.character.id,
          expectedVersion: detail.character.version,
        }),
      });
      const messages = result.messages ?? [
        ...detail.messages,
        ...(result.reply ? [{ role: "assistant" as const, content: result.reply }] : []),
      ];
      setDetail({
        character: result.character,
        messages,
        conversation: result.conversation,
        memory: result.memory,
      });
      setConversation(result.conversation);
      await loadDrafts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a conversa.");
    } finally {
      setSending(false);
    }
  }
  async function submitToMaster() {
    if (!detail || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ character: CreationCharacter }>("/api/character-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", characterId: detail.character.id }),
      });
      setDetail({ ...detail, character: result.character });
      await loadDrafts();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível enviar a ficha ao Mestre.",
      );
    } finally {
      setSending(false);
    }
  }
  const creationProgress = detail
    ? (detail.character.snapshot.serverCreationProgress as { status?: string } | undefined)
    : undefined;
  const isComplete = creationProgress?.status === "complete";
  const isSubmitted = detail?.character.status === "submitted";
  const progressionRequest = detail?.progression?.find(
    (item) =>
      item.fromMarco === detail.progressionChoices?.currentMarco &&
      ["requested", "authorized", "in_progress"].includes(item.status),
  );
  const memoryRows = detail
    ? [
        ...detail.memory.qa.map((item, index) => ({
          sheet: "Perguntas e respostas",
          key: String(item.questionShort ?? `Pergunta ${index + 1}`),
          value: String(item.answerShort ?? ""),
          status: String(item.confidence ?? item.status ?? ""),
          sources: JSON.stringify(item.sourceChunkIds ?? []),
        })),
        ...detail.memory.narrativeIdentity.map((item, index) => ({
          sheet: "Identidade narrativa",
          key: `Declaração ${index + 1}`,
          value: String(item.text ?? ""),
          status: String(item.source ?? ""),
          sources: "—",
        })),
        ...detail.memory.choices.map((item) => ({
          sheet: "Escolhas da ficha",
          key: String(item.fieldPath ?? ""),
          value: JSON.stringify({ current: item.currentValue, proposal: item.proposalValue }),
          status: String(item.status ?? ""),
          sources: JSON.stringify(item.sourceChunkIds ?? []),
        })),
        ...detail.memory.inferences.map((item, index) => ({
          sheet: "Inferências",
          key: `Inferência ${index + 1}`,
          value: String(item.text ?? ""),
          status: String(item.confidence ?? item.status ?? ""),
          sources: String(item.evidence ?? ""),
        })),
        ...detail.memory.pendingContradictions.map((item) => ({
          sheet: "Pendências e contradições",
          key: String(item.path ?? ""),
          value: JSON.stringify(item.value),
          status: String(item.status ?? ""),
          sources: String(item.note ?? ""),
        })),
        ...detail.memory.consultedSources.map((item) => ({
          sheet: "Fontes consultadas",
          key: String(item.chunkId ?? ""),
          value: `${String(item.chapter ?? "")} · ${String(item.section ?? "")} · linhas ${String(item.startLine ?? "")}-${String(item.endLine ?? "")}`,
          status: String(item.sourceVersion ?? ""),
          sources: String(item.sourceSha256 ?? ""),
        })),
      ]
    : [];
  const distributionValid =
    Boolean(next?.names?.length) &&
    next!.names.every((name) => Number.isInteger(distribution[name])) &&
    JSON.stringify(next!.names.map((name) => distribution[name]).sort((a, b) => a! - b!)) ===
      JSON.stringify([...next!.pool].sort((a, b) => a - b));

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-[#08080E] text-[#F3EBDD]">
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[color:var(--gold)]">
              Oficina de personagens
            </p>
            <h1 className="serif mt-2 text-3xl">Criar por conversa</h1>
          </div>
          <Link
            to="/personagens"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-white/70"
          >
            <ArrowLeft className="h-4 w-4" /> Personagens
          </Link>
        </header>

        {!detail ? (
          <section className="rounded-2xl border border-white/10 bg-[#111016] p-5">
            <p className="text-sm leading-6 text-white/70">
              Conte livremente quem é essa pessoa, o que busca e o que perdeu. A conversa ajuda a
              explorar possibilidades; nenhuma escolha mecânica é salva sem sua revisão e
              confirmação.
            </p>
            <form onSubmit={(event) => void start(event)} className="mt-5 space-y-3">
              <label className="block text-sm text-white/70">
                Marco de destino
                <select
                  value={targetMarco}
                  onChange={(event) => setTargetMarco(Number(event.target.value))}
                  className="mt-2 block min-h-10 rounded-lg border border-white/15 bg-[#24212a] px-3"
                >
                  {[1, 2, 3, 4].map((marco) => (
                    <option key={marco} value={marco}>
                      Marco {marco}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-white/50">
                A criação começa no Marco 1. Os Marcos seguintes dependem da revisão e autorização
                do Mestre.
              </p>
              <label className="sr-only" htmlFor="creation-first-message">
                Conte a história inicial do personagem
              </label>
              <textarea
                id="creation-first-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                maxLength={12000}
                disabled={sending}
                placeholder="Quero criar alguém que…"
                className="min-h-32 w-full resize-y rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm leading-6 outline-none focus:border-[color:var(--gold)]/60"
              />
              <button
                type="submit"
                disabled={sending || !message.trim()}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[color:var(--gold)] px-4 font-medium text-[#16120b] disabled:opacity-50"
              >
                {sending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Começar pela minha história
              </button>
            </form>
            <div className="mt-8 border-t border-white/10 pt-5">
              <h2 className="serif text-xl">Continuar personagem</h2>
              {loading ? (
                <p className="mt-3 text-sm text-white/50">Carregando seus rascunhos…</p>
              ) : null}
              {!loading && drafts.length === 0 ? (
                <p className="mt-3 text-sm text-white/50">
                  Nenhuma ficha em conversa para continuar.
                </p>
              ) : null}
              <ul className="mt-3 space-y-2">
                {drafts.map((draft) => (
                  <li key={draft.id}>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void openDraft(draft.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-3 text-left hover:border-[color:var(--gold)]/50"
                    >
                      <MessageCircle className="h-4 w-4 text-[color:var(--gold)]" />
                      <span className="text-sm">{draft.name || "Personagem em construção"}</span>
                      <span className="text-xs text-white/45">{draft.status}</span>
                      <span className="ml-auto text-xs text-white/40">v{draft.version}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : (
          <>
            {detail.character.status === "draft" || detail.character.status === "rejected" ? (
              <label className="mb-3 block text-sm text-white/70">
                Marco de destino
                <select
                  value={conversation?.targetMarco ?? targetMarco}
                  disabled={sending}
                  onChange={(event) => void changeTargetMarco(Number(event.target.value))}
                  className="ml-3 min-h-10 rounded-lg border border-white/15 bg-[#24212a] px-3"
                >
                  {[1, 2, 3, 4].map((marco) => (
                    <option key={marco} value={marco}>
                      Marco {marco}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <section
              ref={logRef}
              aria-label="Conversa de criação"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              className="max-h-[55dvh] min-h-[35dvh] space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#111016] p-4 sm:max-h-[62dvh] sm:p-6"
            >
              <p className="text-xs text-white/40">
                Rascunho {detail.character.id.slice(0, 8)} · versão {detail.character.version}
              </p>
              {conversation ? (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-white/60">
                    <span>Progresso canônico</span>
                    <span>
                      {conversation.progress.complete}/{conversation.progress.total}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-valuenow={conversation.progress.complete}
                    aria-valuemin={0}
                    aria-valuemax={conversation.progress.total}
                    aria-label="Progresso da ficha"
                  >
                    <div
                      className="h-full bg-[color:var(--gold)] transition-[width]"
                      style={{
                        width: `${conversation.progress.total ? Math.round((conversation.progress.complete / conversation.progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {conversation?.confirmed.length ? (
                <details className="rounded-lg border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm text-white/80">
                    Decisões já confirmadas ({conversation.confirmed.length})
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm text-white/65">
                    {conversation.confirmed.map((choice) => (
                      <li key={choice.path}>
                        <span className="text-white/40">{choice.label}:</span>{" "}
                        {JSON.stringify(choice.value)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {detail.messages.map((item, index) => (
                <article
                  key={item.created_at ?? index}
                  className={
                    item.role === "user"
                      ? "ml-8 rounded-xl border border-[color:var(--gold)]/25 bg-[color:var(--gold)]/10 p-4"
                      : "mr-8 rounded-xl border border-white/10 bg-black/20 p-4"
                  }
                >
                  <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">
                    {item.role === "user" ? "Você" : "KALLISTIS"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                </article>
              ))}
            </section>
            <details className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-white/65">
                Memória desta conversa ({memoryRows.length} registros)
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
                  <thead className="text-white/45">
                    <tr>
                      <th className="border-b border-white/10 p-2">Aba</th>
                      <th className="border-b border-white/10 p-2">Registro</th>
                      <th className="border-b border-white/10 p-2">Valor</th>
                      <th className="border-b border-white/10 p-2">Estado / fonte</th>
                      <th className="border-b border-white/10 p-2">Proveniência</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    {memoryRows.map((row, index) => (
                      <tr key={`${row.sheet}-${index}`}>
                        <td className="border-b border-white/5 p-2">{row.sheet}</td>
                        <td className="border-b border-white/5 p-2">{row.key}</td>
                        <td className="max-w-xs whitespace-pre-wrap border-b border-white/5 p-2">
                          {row.value}
                        </td>
                        <td className="border-b border-white/5 p-2">{row.status}</td>
                        <td className="border-b border-white/5 p-2">{row.sources}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <a
                href={`/api/character-creation?characterId=${encodeURIComponent(detail.character.id)}&format=csv`}
                download
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs text-white/75"
              >
                <Download className="h-4 w-4" /> Baixar memória em CSV
              </a>
            </details>
            {next && !conversation?.pending.length && !isComplete && !isSubmitted ? (
              <section
                aria-label="Próxima escolha"
                className="mt-3 rounded-xl border border-[color:var(--gold)]/30 bg-[#111016] p-4 text-sm"
              >
                <h2 className="serif text-xl">Agora: {next.label}</h2>
                <p className="mt-1 text-white/55">
                  Escolha aqui ou responda livremente na conversa. Toda escolha será apresentada
                  para sua confirmação antes de entrar na ficha.
                </p>
                {next.kind === "choice" || next.kind === "yes" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(next.kind === "yes" ? ["Confirmo a proficiência"] : next.options).map(
                      (option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={sending}
                          onClick={() => void choose(next.kind === "yes" ? true : option)}
                          className="min-h-10 rounded-lg border border-white/20 px-3 text-left hover:border-[color:var(--gold)]/70 disabled:opacity-50"
                        >
                          {option}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
                {next.kind === "multi" ? (
                  <>
                    <p className="mt-2 text-xs text-white/50">
                      Escolha {next.min === next.max ? next.min : `${next.min} a ${next.max}`}{" "}
                      opções.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {next.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={selected.includes(option)}
                          disabled={sending}
                          onClick={() =>
                            setSelected((current) =>
                              current.includes(option)
                                ? current.filter((item) => item !== option)
                                : [...current, option],
                            )
                          }
                          className={`min-h-10 rounded-lg border px-3 text-left disabled:opacity-50 ${selected.includes(option) ? "border-[color:var(--gold)] bg-[color:var(--gold)]/15" : "border-white/20"}`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={
                        sending ||
                        selected.length < (next.min ?? 0) ||
                        selected.length > (next.max ?? Infinity)
                      }
                      onClick={() => void choose(selected)}
                      className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                    >
                      Revisar seleção
                    </button>
                  </>
                ) : null}
                {next.kind === "attributes" || next.kind === "skills" ? (
                  <>
                    <p className="mt-2 text-xs text-white/50">
                      Distribua exatamente: {next.pool.join(", ")}.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {next.names.map((name) => (
                        <label
                          key={name}
                          className="flex items-center justify-between gap-3 rounded-lg border border-white/15 p-2"
                        >
                          <span>{name}</span>
                          <select
                            aria-label={name}
                            value={distribution[name] ?? ""}
                            onChange={(event) =>
                              setDistribution((current) => ({
                                ...current,
                                [name]: Number(event.target.value),
                              }))
                            }
                            className="rounded bg-[#24212a] px-2 py-1"
                          >
                            <option value="">—</option>
                            {[...new Set(next.pool)]
                              .sort((a, b) => b - a)
                              .map((number) => (
                                <option key={number} value={number}>
                                  {number}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={sending || !distributionValid}
                      onClick={() => void choose(distribution)}
                      className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                    >
                      Revisar distribuição
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  disabled={sending}
                  onClick={() =>
                    void sendText(
                      `Sugira uma opção canônica para ${next.label} coerente com minha personagem. Apresente como proposta para eu confirmar.`,
                    )
                  }
                  className="mt-3 block min-h-10 rounded-lg border border-white/20 px-3 text-white/80 disabled:opacity-50"
                >
                  Pedir sugestão à IA
                </button>
              </section>
            ) : null}
            {conversation?.pending.length ? (
              <section
                aria-label="Propostas para revisar"
                className="mt-3 rounded-xl border border-[color:var(--gold)]/30 bg-[color:var(--gold)]/5 p-4"
              >
                <h2 className="serif text-xl">Revise antes de registrar</h2>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  Confirmar salva somente estas propostas depois da validação do servidor. Sua
                  história, por si só, não escolhe nada.
                </p>
                <ul className="mt-3 space-y-3">
                  {conversation.pending.map((proposal) => (
                    <li key={proposal.path} className="border-t border-white/10 pt-3 text-sm">
                      <p>
                        <strong>{proposal.label}:</strong> {JSON.stringify(proposal.value)}
                      </p>
                      {proposal.sourceText ? (
                        <p className="mt-1 text-xs text-white/45">
                          Da sua frase: “{proposal.sourceText}”
                        </p>
                      ) : null}
                      {proposal.dependencies.length ? (
                        <p className="mt-1 text-xs text-white/45">
                          Depende de: {proposal.dependencies.join(", ")}
                        </p>
                      ) : null}
                      {proposal.effects.map((effect) => (
                        <p key={effect} className="mt-1 text-xs text-amber-200">
                          {effect}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void sendAction("confirm")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[color:var(--gold)] px-3 text-sm font-medium text-[#16120b] disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    Confirmar este conjunto
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void sendAction("cancel")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-white/75 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    Cancelar propostas
                  </button>
                </div>
              </section>
            ) : null}
            {isComplete &&
            (detail.character.status === "draft" || detail.character.status === "rejected") ? (
              <button
                type="button"
                disabled={sending}
                onClick={() => void submitToMaster()}
                className="mt-3 min-h-11 rounded-lg bg-[color:var(--gold)] px-4 font-medium text-[#16120b] disabled:opacity-50"
              >
                {sending ? "Enviando…" : "Enviar ficha ao Mestre"}
              </button>
            ) : null}
            {isSubmitted ? (
              <p className="mt-3 rounded-lg border border-emerald-400/30 p-3 text-sm text-emerald-100">
                Ficha enviada e salva; agora aguarda revisão do Mestre.
              </p>
            ) : null}
            {detail.character.status === "approved" && detail.progressionChoices ? (
              <section
                aria-label="Progressão por conversa"
                className="mt-3 rounded-xl border border-white/15 bg-[#111016] p-4 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="serif text-xl">
                    Marco {detail.progressionChoices.currentMarco} · objetivo inicial Marco{" "}
                    {conversation?.targetMarco ?? 1}
                  </h2>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void openDraft(detail.character.id)}
                    className="min-h-10 rounded-lg border border-white/20 px-3 disabled:opacity-50"
                  >
                    Atualizar revisão
                  </button>
                </div>
                {detail.progressionChoices.currentMarco >= 4 ? (
                  <p className="mt-2 text-emerald-100">
                    O Marco 4 está persistido na ficha. Para evoluir além dele, use a progressão
                    canônica da personagem com autorização do Mestre.
                  </p>
                ) : !progressionRequest ? (
                  <div className="mt-3">
                    <p className="text-white/60">
                      O próximo Marco precisa de autorização do Mestre. O pedido será registrado na
                      ficha.
                    </p>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void progressionAction("progression_request")}
                      className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                    >
                      Solicitar Marco {detail.progressionChoices.currentMarco + 1}
                    </button>
                  </div>
                ) : progressionRequest.status === "requested" ? (
                  <p className="mt-2 text-amber-100">
                    Marco {progressionRequest.toMarco} solicitado. Aguarde a autorização legítima do
                    Mestre e atualize esta conversa.
                  </p>
                ) : progressionRequest.status === "authorized" ? (
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void progressionAction("progression_start")}
                    className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                  >
                    Iniciar Marco {progressionRequest.toMarco} autorizado
                  </button>
                ) : (
                  <div className="mt-3">
                    <p className="text-white/60">
                      Escolha os ganhos canônicos deste Marco. Cada confirmação fica no histórico; a
                      ficha avança somente depois da validação completa.
                    </p>
                    <ul className="mt-3 space-y-1 text-xs text-white/50">
                      {detail.progressionChoices.choices.map((choice) => (
                        <li key={choice.id}>
                          {choice.label}:{" "}
                          {choice.value == null ? "pendente" : JSON.stringify(choice.value)}
                        </li>
                      ))}
                    </ul>
                    {detail.progressionChoices.next ? (
                      <div className="mt-3">
                        <h3 className="font-medium">{detail.progressionChoices.next.label}</h3>
                        <button
                          type="button"
                          disabled={sending}
                          onClick={() =>
                            void sendText(
                              `Explique ${detail.progressionChoices?.next?.label} e recomende uma das opções canônicas para minha personagem. Eu confirmarei a escolha no chat.`,
                            )
                          }
                          className="mt-2 min-h-10 rounded-lg border border-white/20 px-3 text-white/80 disabled:opacity-50"
                        >
                          Pedir orientação à IA
                        </button>
                        {detail.progressionChoices.next.kind === "multi" ? (
                          <p className="mt-1 text-xs text-white/50">
                            Selecione {detail.progressionChoices.next.min} opções.
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {detail.progressionChoices.next.options.map((option) => {
                            const active = Array.isArray(progressionSelection)
                              ? progressionSelection.includes(option)
                              : progressionSelection === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={active}
                                disabled={sending}
                                onClick={() =>
                                  setProgressionSelection((current) =>
                                    detail.progressionChoices?.next?.kind === "multi"
                                      ? Array.isArray(current)
                                        ? current.includes(option)
                                          ? current.filter((item) => item !== option)
                                          : [...current, option]
                                        : [option]
                                      : option,
                                  )
                                }
                                className={`min-h-10 rounded-lg border px-3 text-left disabled:opacity-50 ${active ? "border-[color:var(--gold)] bg-[color:var(--gold)]/15" : "border-white/20"}`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          disabled={
                            sending ||
                            !progressionSelection ||
                            (Array.isArray(progressionSelection) &&
                              progressionSelection.length !== detail.progressionChoices.next.min)
                          }
                          onClick={() => void progressionAction("progression_choice")}
                          className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                        >
                          Confirmar escolha do Marco
                        </button>
                      </div>
                    ) : detail.progressionChoices.complete ? (
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => void progressionAction("progression_apply")}
                        className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 font-medium text-[#16120b] disabled:opacity-50"
                      >
                        Validar e aplicar Marco {progressionRequest.toMarco}
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-red-400/30 bg-red-950/30 p-3 text-sm text-red-200"
              >
                A gravação não foi confirmada: {error}
              </p>
            ) : null}
            {conversation?.providerUnavailable ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300/25 bg-amber-950/20 p-3 text-sm text-amber-100">
                <span>
                  O serviço de interpretação está indisponível. Seu rascunho e a mensagem já foram
                  preservados.
                </span>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendAction("retry")}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-amber-200/30 px-3 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Tentar novamente
                </button>
              </div>
            ) : null}
            {(!isComplete || detail.character.status === "approved") && !isSubmitted ? (
              <form
                onSubmit={send}
                className="sticky bottom-0 mt-3 flex items-end gap-2 bg-[#08080E]/95 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur"
              >
                <label className="sr-only" htmlFor="creation-message">
                  Sua resposta
                </label>
                <textarea
                  id="creation-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={2}
                  maxLength={12000}
                  disabled={sending}
                  placeholder="Escreva sua escolha ou resposta…"
                  className="min-h-14 flex-1 resize-y rounded-xl border border-white/15 bg-[#111016] px-4 py-3 text-sm outline-none focus:border-[color:var(--gold)]/60"
                />
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  aria-label="Enviar resposta"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[color:var(--gold)] text-[#16120b] disabled:opacity-50"
                >
                  {sending ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </form>
            ) : null}
          </>
        )}
        {!detail && error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-400/30 p-3 text-sm text-red-200"
          >
            Não foi possível carregar ou criar o rascunho: {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
