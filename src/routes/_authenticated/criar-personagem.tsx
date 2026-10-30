import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronRight, LoaderCircle, MessageCircle, RotateCcw, Save, Send, Sparkles } from "lucide-react";

type Evidence = { canonicalId: string; revision: string; book: string; section: string; page: number; text: string; markdownSha256: string; pdfSha256: string };
type Fields = {
  name: string; concept: string; povo: string; herancaPovo: string; origem: string; origemTrocado: boolean; modoTrocado: string; luz: number | null; escuridao: number | null;
  oficio: string; papel: string; chave: string; marco: number; promessa: string; vinculo: string;
  experiencia: string; feridaMarcante: string; equipamento: string; relacoes: string;
  perguntaPessoal: string; manifestacaoPessoal: string;
};
type Snapshot = {
  canonical: { id: string; revision: string; markdownSha256: string; pdfSha256: string };
  creationStatus: "draft" | "complete"; fields: Fields;
  learnedCapabilities: Array<{ name: string; evidence: Evidence }>;
  trocadoEvidence: Evidence | null;
  originCatalogGap: { note: string; evidence: Evidence[] }; confirmedAt: string | null;
};
type Character = { id: string; status: string; ruleset: string; name: string; version: number; snapshot: Snapshot; updated_at?: string };
type ChatMessage = { id?: string; role: "user" | "assistant"; content: string; created_at?: string };
type ChoiceContract = { status: "available" | "gap"; items: Array<{ name: string; pageNumber: number }>; note?: string };
type Bootstrap = {
  canonical: { canonicalId: string; revision: string; markdownSha256: string; pdfSha256: string };
  choices: { peoples: ChoiceContract; offices: ChoiceContract; origins: ChoiceContract };
  creationEvidence: Evidence; marcoEvidence: Evidence[]; originGap: { note: string; evidence: Evidence[] };
  trocadoRule: { status: "available" | "gap"; condition?: string; options?: string[]; rollException?: string; evidence?: Evidence };
  characters?: Character[]; character?: Character; messages?: ChatMessage[];
};

const API = "/api/nexo-character-creation";
const STEPS: Array<{ field: string; label: string; help: string; optional?: boolean }> = [
  { field: "name", label: "Nome", help: "Como essa pessoa é chamada?" },
  { field: "concept", label: "Conceito", help: "Quem ela é, o que deseja e o que teme?" },
  { field: "povo", label: "Povo", help: "Povo registra corpo, herança cosmológica e formas de relação." },
  { field: "herancaPovo", label: "Herança do Povo", help: "Escolha uma das duas Heranças descritas para o Povo." },
  { field: "origem", label: "Origem", help: "Descreva de onde essa pessoa vem e o que moldou sua formação. Se nasceu em um mundo e foi criada no outro, marque Origem Trocado para ver a escolha específica do livro." },
  { field: "distribuicao", label: "Luz e Escuridão", help: "Distribua dez pontos narrativos. Eles não são somados aos dados." },
  { field: "oficio", label: "Ofício", help: "O servidor associa a Técnica inicial indicada no trecho canônico." },
  { field: "papel", label: "Papel", help: "Escolha um dos Papéis que o texto do Ofício permite." },
  { field: "chave", label: "Chave do Ofício", help: "Descreva a arma, ferramenta, foco, dispositivo ou símbolo ligado ao treinamento." },
  { field: "marco", label: "Marco inicial", help: "O Livro III indica M1 como marco inicial, salvo decisão diferente da campanha." },
  { field: "promessa", label: "Promessa", help: "Que compromisso essa pessoa assumiu?" },
  { field: "vinculo", label: "Vínculo", help: "Que relação concreta importa para ela?" },
  { field: "experiencia", label: "Experiência", help: "O que viveu e pode fundamentar decisões futuras?" },
  { field: "feridaMarcante", label: "Ferida Marcante", help: "Opcional: uma marca persistente da trajetória.", optional: true },
  { field: "equipamento", label: "Equipamento", help: "O que carrega ou usa? Registre os itens que fazem parte da história." },
  { field: "relacoes", label: "Relações", help: "Que pessoas, comunidades ou compromissos fazem parte da história?" },
  { field: "perguntaPessoal", label: "Pergunta pessoal", help: "Qual pergunta permanece sem resposta no início da jornada?" },
  { field: "manifestacaoPessoal", label: "Manifestação Pessoal", help: "Como a presença e as capacidades encontram forma no mundo?" },
] as const;

export const Route = createFileRoute("/_authenticated/criar-personagem")({ component: ConversationalNexoCreation });

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; detail?: string; requestId?: string };
  if (!response.ok) throw new Error([payload.error ?? "request_failed", payload.detail, payload.requestId].filter(Boolean).join(" — "));
  return payload;
}

function fieldValue(fields: Fields | undefined, field: string) {
  if (!fields) return "";
  if (field === "distribuicao") return fields.luz === null || fields.escuridao === null ? "" : fields.luz + "/" + fields.escuridao;
  const value = fields[field as keyof Fields];
  return value === null || value === undefined ? "" : String(value);
}
function isFilled(fields: Fields | undefined, field: string) {
  if (!fields) return false;
  if (field === "marco") return fields.marco === 1;
  if (field === "distribuicao") return fields.luz !== null && fields.escuridao !== null && fields.luz + fields.escuridao === 10;
  if (field === "origem") return Boolean(fields.origem.trim()) && (!fields.origemTrocado || Boolean(fields.modoTrocado.trim()));
  return Boolean(String(fields[field as keyof Fields] ?? "").trim());
}
function reviewFieldValue(fields: Fields, field: string) {
  if (field !== "origem") return fieldValue(fields, field);
  const trocado = fields.origemTrocado
    ? `Origem Trocado — ${fields.modoTrocado || "escolha pendente"}`
    : "";
  return [fields.origem, trocado].filter(Boolean).join("\n");
}
function sidebarFieldValue(fields: Fields | undefined, field: string) {
  if (!fields || field !== "origem" || !fields.origemTrocado) return fieldValue(fields, field);
  return `${fieldValue(fields, field)} · Trocado — ${fields.modoTrocado || "escolha pendente"}`;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5"><h2 className="serif text-xl text-[#f2e9d9]">{title}</h2><div className="mt-3">{children}</div></section>;
}
function textEvidence(evidence: Evidence) {
  return evidence.text.replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "");
}

function ConversationalNexoCreation() {
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [initialIdea, setInitialIdea] = useState("");
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [luzValue, setLuzValue] = useState("");
  const [escuridaoValue, setEscuridaoValue] = useState("");
  const [optionEvidence, setOptionEvidence] = useState<Evidence | null>(null);
  const [officeRoles, setOfficeRoles] = useState<string[]>([]);
  const [povoHeritages, setPovoHeritages] = useState<string[]>([]);
  const [aiFailure, setAiFailure] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const characterId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("characterId");
  const fields = character?.snapshot.fields;
  const nextStep = useMemo(() => fields ? STEPS.find((step) => !step.optional && !isFilled(fields, step.field)) ?? null : null, [fields]);
  const displayStep = activeStep ? STEPS.find((step) => step.field === activeStep) ?? nextStep : nextStep;
  const complete = character?.snapshot.creationStatus === "complete";

  async function load(id?: string | null) {
    setLoading(true); setError("");
    try {
      const result = await request<Bootstrap>(id ? API + "?characterId=" + encodeURIComponent(id) : API);
      setBootstrap(result); setCharacter(result.character ?? null); setMessages(result.messages ?? []);
      setAiFailure(Boolean(result.messages?.length && result.messages.at(-1)?.role === "user"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir a criação."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(characterId); }, [characterId]);
  useEffect(() => {
    if (!displayStep || !fields) return;
    setDraftValue(fieldValue(fields, displayStep.field));
    if (displayStep.field === "distribuicao") {
      setLuzValue(fields.luz === null ? "" : String(fields.luz));
      setEscuridaoValue(fields.escuridao === null ? "" : String(fields.escuridao));
    }
    if (displayStep.field === "papel" && fields.oficio) void loadOffice(fields.oficio);
    if (displayStep.field === "herancaPovo" && fields.povo) void loadPeople(fields.povo);
  }, [displayStep?.field, character?.version]);

  async function loadOffice(name: string) {
    try {
      const result = await request<{ details: { roles: string[] } }>(API + "?category=offices&name=" + encodeURIComponent(name));
      setOfficeRoles(result.details.roles);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar o Ofício no cânone."); }
  }
  async function loadPeople(name: string) {
    try {
      const result = await request<{ details: { heritages: string[] } }>(API + "?category=peoples&name=" + encodeURIComponent(name));
      setPovoHeritages(result.details.heritages);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar as Heranças do Povo no cânone."); }
  }
  async function explain(category: "peoples" | "offices", name: string) {
    try {
      const result = await request<{ evidence: Evidence; details: { roles?: string[]; heritages?: string[] } | null }>(API + "?category=" + category + "&name=" + encodeURIComponent(name));
      setOptionEvidence(result.evidence); if (result.details?.roles) setOfficeRoles(result.details.roles); if (result.details?.heritages) setPovoHeritages(result.details.heritages);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível recuperar a definição canônica."); }
  }
  async function start(event: FormEvent) {
    event.preventDefault(); if (!initialIdea.trim() || busy) return;
    setBusy(true); setError(""); setAiFailure(false);
    try {
      const result = await request<Bootstrap & { character: Character; messages: ChatMessage[]; aiError?: string }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", message: initialIdea.trim() }),
      });
      setBootstrap(result); setCharacter(result.character); setMessages(result.messages); setInitialIdea("");
      window.history.replaceState({}, "", "/criar-personagem?characterId=" + encodeURIComponent(result.character.id));
      setAiFailure(Boolean(result.aiError));
      if (result.aiError) setError(result.aiError === "generation_incomplete" ? "A resposta da IA foi interrompida. A ideia e o rascunho foram salvos; tente novamente." : "A IA está indisponível. A ideia e o rascunho foram salvos; tente novamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar o rascunho."); }
    finally { setBusy(false); }
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault(); if (!character || !chatInput.trim() || busy) return;
    setBusy(true); setError(""); setAiFailure(false);
    try {
      const result = await request<Bootstrap & { character: Character; messages: ChatMessage[] }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", characterId: character.id, expectedVersion: character.version, message: chatInput.trim() }),
      });
      setBootstrap(result); setCharacter(result.character); setMessages(result.messages); setChatInput("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao consultar a IA.";
      setError(message); setAiFailure(/provider_unavailable|generation_incomplete/.test(message));
      if (/provider_unavailable|generation_incomplete/.test(message)) {
        setChatInput("");
        try {
          const latest = await request<Bootstrap & { character: Character; messages: ChatMessage[] }>(API + "?characterId=" + encodeURIComponent(character.id));
          setBootstrap(latest); setCharacter(latest.character); setMessages(latest.messages ?? []);
        } catch { /* mantém o erro original e o estado local */ }
      }
    } finally { setBusy(false); }
  }
  async function retryAssistant() {
    if (!character || busy) return;
    setBusy(true); setError(""); setAiFailure(false);
    try {
      const result = await request<Bootstrap & { character: Character; messages: ChatMessage[] }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retryAssistant", characterId: character.id, expectedVersion: character.version }),
      });
      setBootstrap(result); setCharacter(result.character); setMessages(result.messages); setAiFailure(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A nova tentativa falhou."); setAiFailure(true); }
    finally { setBusy(false); }
  }
  async function saveField(field: string, value: unknown) {
    if (!character || busy) return;
    setBusy(true); setError(""); setOptionEvidence(null);
    try {
      const result = await request<Bootstrap & { character: Character }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateField", characterId: character.id, expectedVersion: character.version, field, value }),
      });
      setBootstrap(result); setCharacter(result.character); setActiveStep(null);
      if (field === "oficio") await loadOffice(String(value));
      if (field === "povo") await loadPeople(String(value));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "O servidor recusou esta escolha."); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!character || busy) return;
    setBusy(true); setError("");
    try {
      let current = character;
      const field = activeStep ?? displayStep?.field;
      const serverChoiceFields = ["povo", "herancaPovo", "oficio", "papel", "marco"];
      if (field && fields && !serverChoiceFields.includes(field)) {
        const value = field === "distribuicao"
          ? { luz: Number(luzValue), escuridao: Number(escuridaoValue) }
          : draftValue;
        const unchanged = field === "distribuicao"
          ? fields.luz === Number(luzValue) && fields.escuridao === Number(escuridaoValue)
          : fieldValue(fields, field) === draftValue.trim();
        if (!unchanged) {
          const updated = await request<Bootstrap & { character: Character }>(API, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updateField", characterId: character.id, expectedVersion: character.version, field, value }),
          });
          current = updated.character;
          setBootstrap(updated);
          setCharacter(current);
        }
      }
      const result = await request<{ character: Character }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveDraft", characterId: current.id, expectedVersion: current.version }),
      });
      setCharacter(result.character);
      setActiveStep(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o salvamento."); }
    finally { setBusy(false); }
  }
  async function confirmCharacter() {
    if (!character || busy) return;
    setBusy(true); setError("");
    try {
      const result = await request<Bootstrap & { character: Character }>(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", characterId: character.id, expectedVersion: character.version }),
      });
      setBootstrap(result); setCharacter(result.character);
      setReviewing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A ficha ainda não pode ser confirmada."); }
    finally { setBusy(false); }
  }
  function renderEditor() {
    if (!displayStep || !fields || !bootstrap) return null;
    const field = displayStep.field;
    const options = field === "povo" ? bootstrap.choices.peoples.items : field === "oficio" ? bootstrap.choices.offices.items : [];
    const saveText = () => void saveField(field, draftValue);
    return <Panel title={displayStep.label}>
      <p className="text-sm leading-6 text-white/65">{displayStep.help}</p>
      {field === "povo" || field === "oficio" ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{options.map((option) => <article key={option.name} className="rounded-xl border border-white/10 bg-black/15 p-3"><div className="flex items-center justify-between gap-2"><button type="button" disabled={busy} onClick={() => void saveField(field, option.name)} className={"min-h-10 rounded-lg border px-3 text-left " + (fields[field === "povo" ? "povo" : "oficio"] === option.name ? "border-[color:var(--gold)] bg-[color:var(--gold)]/10 text-[color:var(--gold)]" : "border-white/15 hover:border-[color:var(--gold)]/50")}>{option.name}</button><button type="button" onClick={() => void explain(field === "povo" ? "peoples" : "offices", option.name)} className="text-xs text-white/55 underline underline-offset-4">Explicar</button></div></article>)}</div> : null}
      {field === "herancaPovo" ? <div className="mt-4 flex flex-wrap gap-2">{povoHeritages.map((heritage) => <button key={heritage} type="button" disabled={busy} onClick={() => void saveField("herancaPovo", heritage)} className={"min-h-10 rounded-lg border px-3 " + (fields.herancaPovo === heritage ? "border-[color:var(--gold)] text-[color:var(--gold)]" : "border-white/15")}>{heritage}</button>)}</div> : null}
      {field === "origem" ? <><p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-100/[0.04] p-3 text-xs leading-5 text-amber-100/75">{bootstrap.originGap.note} O livro não fornece um catálogo fechado de Origens. Descreva a história com suas palavras; nenhuma opção legada será sugerida.</p><textarea value={draftValue} onChange={(event) => setDraftValue(event.target.value)} maxLength={4000} rows={3} className="mt-3 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder="De onde essa pessoa vem e o que moldou sua formação?" />{bootstrap.trocadoRule.status === "available" ? <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3"><p className="text-xs leading-5 text-white/60">{bootstrap.trocadoRule.condition?.replace(/\s+/g, " ")}. Escolha essa condição se ela descreve a história da personagem.</p><button type="button" disabled={busy} aria-pressed={fields.origemTrocado} onClick={() => void saveField("origemTrocado", !fields.origemTrocado)} className={"mt-3 min-h-10 rounded-lg border px-3 text-sm " + (fields.origemTrocado ? "border-[color:var(--gold)] text-[color:var(--gold)]" : "border-white/15 text-white/70")}>{fields.origemTrocado ? "Origem Trocado selecionada · desmarcar" : "Esta pessoa é de Origem Trocado"}</button>{fields.origemTrocado ? <><div className="mt-3 flex flex-col gap-2">{bootstrap.trocadoRule.options?.map((option) => <button key={option} type="button" disabled={busy} onClick={() => void saveField("modoTrocado", option)} className={"min-h-10 rounded-lg border px-3 text-left text-sm " + (fields.modoTrocado === option ? "border-[color:var(--gold)] bg-[color:var(--gold)]/10 text-[color:var(--gold)]" : "border-white/15 text-white/70")}>{option}</button>)}</div><details className="mt-3 text-xs leading-5 text-white/50"><summary className="cursor-pointer">Como isso afeta uma rolagem</summary><p className="mt-2">{bootstrap.trocadoRule.rollException}</p></details><p className="mt-2 text-[10px] text-white/35">{bootstrap.trocadoRule.evidence?.book} · {bootstrap.trocadoRule.evidence?.section}, p. {bootstrap.trocadoRule.evidence?.page}</p></> : null}</div> : <p role="alert" className="mt-3 text-xs text-amber-100">A regra condicional de Trocado não pôde ser recuperada do cânone.</p>}</> : null}
      {field === "distribuicao" ? <div className="mt-4 grid grid-cols-2 gap-3">{[{ label: "Luz", value: luzValue, set: setLuzValue }, { label: "Escuridão", value: escuridaoValue, set: setEscuridaoValue }].map((item) => <label key={item.label} className="text-sm text-white/70">{item.label}<select value={item.value} onChange={(event) => item.set(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/15 bg-[#1d1b22] px-3 py-3 text-white"><option value="">Escolha</option>{Array.from({ length: 11 }, (_, number) => <option key={number} value={number}>{number}</option>)}</select></label>)}<p className="col-span-2 text-xs text-white/50">Total: {Number(luzValue || 0) + Number(escuridaoValue || 0)} / 10</p><button type="button" disabled={busy || luzValue === "" || escuridaoValue === "" || Number(luzValue) + Number(escuridaoValue) !== 10} onClick={() => void saveField("distribuicao", { luz: Number(luzValue), escuridao: Number(escuridaoValue) })} className="col-span-2 min-h-11 rounded-xl bg-[color:var(--gold)] px-4 text-sm font-medium text-[#1a1711] disabled:opacity-45">Salvar distribuição</button></div> : null}
      {field === "papel" ? <div className="mt-4 flex flex-wrap gap-2">{officeRoles.map((role) => <button key={role} type="button" disabled={busy} onClick={() => void saveField("papel", role)} className={"min-h-10 rounded-lg border px-3 " + (fields.papel === role ? "border-[color:var(--gold)] text-[color:var(--gold)]" : "border-white/15")}>{role}</button>)}</div> : null}
      {field === "marco" ? <div className="mt-4 rounded-xl border border-[color:var(--gold)]/30 p-4"><p className="text-lg">Marco 1</p><p className="mt-2 text-xs leading-5 text-white/55">O manuscrito indica M1 como marco inicial, salvo decisão de campanha. Esta criação não está vinculada a uma campanha com decisão diferente.</p><button type="button" disabled={busy} onClick={() => void saveField("marco", 1)} className="mt-3 min-h-10 rounded-lg bg-[color:var(--gold)] px-3 text-sm text-[#1a1711]">Registrar M1</button></div> : null}
      {field === "name" ? <input value={draftValue} onChange={(event) => setDraftValue(event.target.value)} maxLength={100} className="mt-4 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder="Nome da personagem" /> : null}
      {field === "concept" ? <textarea value={draftValue} onChange={(event) => setDraftValue(event.target.value)} maxLength={4000} rows={3} className="mt-4 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder="Identidade, objetivo e algo que teme perder" /> : null}
      {["chave", "promessa", "vinculo", "experiencia", "feridaMarcante", "equipamento", "relacoes", "perguntaPessoal", "manifestacaoPessoal"].includes(field) ? <textarea value={draftValue} onChange={(event) => setDraftValue(event.target.value)} maxLength={4000} rows={field === "manifestacaoPessoal" || field === "relacoes" ? 4 : 3} className="mt-4 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder={field === "feridaMarcante" ? "Opcional; deixe vazio se não quiser registrar uma." : "Escreva com suas palavras…"} /> : null}
      {!["distribuicao", "povo", "herancaPovo", "oficio", "papel", "marco"].includes(field) ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || (!draftValue.trim() && !displayStep.optional)} onClick={saveText} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[color:var(--gold)] px-4 text-sm font-medium text-[#1a1711] disabled:opacity-45"><Check className="h-4 w-4"/>Salvar escolha</button>{displayStep.optional ? <button type="button" disabled={busy} onClick={() => void saveField(field, "")} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-white/70">Pular</button> : null}</div> : null}
      {field === "oficio" && fields.oficio ? <p className="mt-3 text-xs text-[color:var(--gold)]">Técnica inicial registrada do texto canônico: {character?.snapshot.learnedCapabilities.map((capability) => capability.name).join(", ") || "aguardando seleção"}.</p> : null}
      {optionEvidence ? <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs text-[color:var(--gold)]">{optionEvidence.book} · {optionEvidence.section} · p. {optionEvidence.page}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5 text-white/65">{textEvidence(optionEvidence)}</pre></div> : null}
      {field === "oficio" && character?.snapshot.learnedCapabilities[0] ? <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3 text-xs leading-5 text-white/60"><p className="text-[color:var(--gold)]">Capacidade inicial · {character.snapshot.learnedCapabilities[0].evidence.book}, p. {character.snapshot.learnedCapabilities[0].evidence.page}</p><p className="mt-1">{character.snapshot.learnedCapabilities[0].name}</p></div> : null}
      <p className="mt-4 text-[11px] text-white/40">Fonte do fluxo: {bootstrap.creationEvidence.book}, {bootstrap.creationEvidence.section}, p. {bootstrap.creationEvidence.page} · revisão {bootstrap.canonical.revision}</p>
    </Panel>;
  }

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-white/55">Abrindo a criação…</div>;
  if (!bootstrap) return <div className="mx-auto max-w-3xl px-4 py-10"><p role="alert" className="rounded-xl border border-red-300/30 p-4 text-sm text-red-100">{error || "Não foi possível carregar o núcleo canônico."}</p><button type="button" onClick={() => void load(characterId)} className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm">Tentar novamente</button></div>;

  return <main className="mx-auto max-w-7xl px-3 pb-12 pt-5 text-[#f2e9d9] sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4"><div><a href="/personagens" className="inline-flex items-center gap-2 text-xs text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5"/>Personagens</a><p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-[color:var(--gold)]">Criação conversacional · NEXO FINAL</p><h1 className="serif mt-1 text-3xl sm:text-4xl">Sua história começa aqui</h1></div><div className="rounded-full border border-white/10 px-3 py-2 text-[10px] text-white/45">{bootstrap.canonical.revision}</div></header>
    {!character ? <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><Panel title="Que tipo de personagem você gostaria de interpretar?"><p className="text-sm leading-6 text-white/60">Conte sua ideia do seu jeito. A conversa ajuda a desenvolvê-la; as escolhas da ficha só mudam quando você as salva.</p><form onSubmit={start} className="mt-4"><textarea value={initialIdea} onChange={(event) => setInitialIdea(event.target.value)} maxLength={2000} rows={5} autoFocus className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder="Alguém que deseja proteger uma comunidade, mas teme repetir os erros de sua família…"/><button type="submit" disabled={busy || !initialIdea.trim()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[color:var(--gold)] px-4 text-sm font-medium text-[#1a1711] disabled:opacity-45">{busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/>}Começar conversa</button></form>{error ? <p role="alert" className="mt-3 text-xs text-red-200">{error}</p> : null}</Panel><Panel title="Retomar um rascunho"><div className="space-y-2">{bootstrap.characters?.length ? bootstrap.characters.map((item) => <a key={item.id} href={"/criar-personagem?characterId=" + encodeURIComponent(item.id)} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3 hover:border-[color:var(--gold)]/40"><span><strong className="block text-sm">{item.name || item.snapshot.fields.concept || "Personagem em construção"}</strong><small className="text-xs text-white/45">{item.snapshot.creationStatus === "complete" ? "Ficha pronta" : "Rascunho salvo"} · versão {item.version}</small></span><ChevronRight className="h-4 w-4 text-white/35"/></a>) : <p className="text-sm text-white/45">Seus rascunhos aparecerão aqui.</p>}</div><p className="mt-5 text-xs leading-5 text-white/40">Opções e definições vêm da revisão canônica acima. Os dados históricos continuam no acesso de personagens.</p></Panel></div>
      : <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]"><div className="space-y-4">
        <Panel title="Conversa guiada"><div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1" aria-live="polite">{messages.map((item, index) => <article key={item.id ?? item.role + "-" + index} className={"max-w-[94%] rounded-2xl p-3 text-sm leading-6 " + (item.role === "user" ? "ml-auto border border-[color:var(--gold)]/20 bg-[color:var(--gold)]/10" : "border border-white/10 bg-black/15")}><p className="mb-1 text-[10px] uppercase tracking-wide text-white/35">{item.role === "user" ? "Você" : "Orientação"}</p><p className="whitespace-pre-wrap">{item.content}</p></article>)}{!messages.length ? <p className="text-sm text-white/45">Conte sua ideia. As decisões registradas aparecem ao lado.</p> : null}</div><form onSubmit={sendMessage} className="mt-4 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={4000} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-sm outline-none focus:border-[color:var(--gold)]" placeholder="Pergunte ou desenvolva uma ideia…"/><button type="submit" disabled={busy || !chatInput.trim()} aria-label="Enviar mensagem" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color:var(--gold)] text-[#1a1711] disabled:opacity-45">{busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}</button></form>{aiFailure ? <button type="button" disabled={busy} onClick={() => void retryAssistant()} className="mt-3 inline-flex items-center gap-2 text-xs text-amber-100/75 underline underline-offset-4"><RotateCcw className="h-3.5 w-3.5"/>Tentar resposta novamente</button> : null}{error ? <p role="alert" className="mt-3 text-xs text-red-200">{error}</p> : null}<p className="mt-3 text-[11px] text-white/35">A IA sugere e explica. Somente suas ações nos campos estruturados alteram a ficha.</p></Panel>
        {complete && !activeStep ? <Panel title="Ficha confirmada"><p className="text-sm text-white/60">A ficha está pronta. Você ainda pode editar qualquer escolha.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setActiveStep(STEPS[0].field)} className="min-h-10 rounded-lg border border-white/15 px-3 text-sm">Editar escolhas</button><button type="button" onClick={() => void navigate({ to: "/personagem/$characterId/ficha", params: { characterId: character.id } })} className="min-h-10 rounded-lg bg-[color:var(--gold)] px-4 text-sm font-medium text-[#1a1711]">Abrir ficha</button></div></Panel> : reviewing && fields ? <Panel title="Revise sua ficha antes de confirmar"><p className="text-sm leading-6 text-white/60">Confira as escolhas. Você pode voltar a qualquer campo antes de concluir.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2">{STEPS.filter((step) => step.field !== "feridaMarcante" || fieldValue(fields, step.field)).map((step) => <div key={step.field} className="rounded-xl border border-white/10 bg-black/10 p-3"><dt className="text-[10px] uppercase tracking-wide text-white/40">{step.label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-white/80">{reviewFieldValue(fields, step.field) || "—"}</dd></div>)}</dl><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => { setReviewing(false); setActiveStep(STEPS[0].field); }} className="min-h-10 rounded-lg border border-white/15 px-3 text-sm">Voltar e editar</button><button type="button" disabled={busy} onClick={() => void confirmCharacter()} className="min-h-10 rounded-lg bg-[color:var(--gold)] px-4 text-sm font-medium text-[#1a1711]">Confirmar ficha</button></div></Panel> : renderEditor()}
      </div><aside className="space-y-4"><Panel title="Ficha em construção"><p className="text-xs text-white/45">{STEPS.filter((step) => !step.optional && fields && isFilled(fields, step.field)).length} de {STEPS.filter((step) => !step.optional).length} decisões registradas · {character.snapshot.canonical.revision}</p><ol className="mt-3 space-y-1.5">{STEPS.map((step, index) => {const filled = isFilled(fields, step.field); const active = displayStep?.field === step.field; return <li key={step.field}><button type="button" onClick={() => {setReviewing(false); setActiveStep(step.field); setOptionEvidence(null);}} className={"flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs " + (active ? "bg-[color:var(--gold)]/10 text-[color:var(--gold)]" : "text-white/55 hover:bg-white/[0.04]")}><span className={"grid h-5 w-5 shrink-0 place-items-center rounded-full border " + (filled ? "border-emerald-300/40 text-emerald-200" : "border-white/15")}>{filled ? <Check className="h-3 w-3"/> : index + 1}</span><span className="min-w-0 flex-1 truncate">{step.label}{step.optional ? " · opcional" : ""}</span><span className="max-w-[42%] truncate text-right text-white/40">{sidebarFieldValue(fields, step.field) || (step.field === "marco" ? "M1" : "")}</span></button></li>;})}</ol><div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3"><p className="text-xs font-medium">Capacidade inicial</p><p className="mt-1 text-sm text-white/65">{character.snapshot.learnedCapabilities[0]?.name || "Escolha um Ofício para consultar a definição."}</p>{character.snapshot.learnedCapabilities[0] ? <p className="mt-1 text-[10px] text-white/40">{character.snapshot.learnedCapabilities[0].evidence.section}, p. {character.snapshot.learnedCapabilities[0].evidence.page}</p> : null}</div><button type="button" disabled={busy} onClick={() => void saveDraft()} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/15 text-xs text-white/70"><Save className="h-3.5 w-3.5"/>Salvar rascunho</button>{!complete ? <button type="button" disabled={busy || Boolean(nextStep)} onClick={() => { setReviewing(true); setActiveStep(null); }} className="mt-2 min-h-11 w-full rounded-lg bg-[color:var(--gold)] px-3 text-sm font-medium text-[#1a1711] disabled:opacity-40">Revisar e confirmar ficha</button> : null}</Panel><Panel title="Fonte canônica"><p className="text-xs leading-5 text-white/60">{bootstrap.creationEvidence.book} · {bootstrap.creationEvidence.section} · p. {bootstrap.creationEvidence.page}</p><p className="mt-2 break-all text-[10px] text-white/35">Markdown {bootstrap.canonical.markdownSha256}<br/>PDF {bootstrap.canonical.pdfSha256}</p><div className="mt-3 border-t border-white/10 pt-3"><p className="text-xs text-white/50">Marco inicial</p><p className="mt-1 text-sm">M1 · evidência p. {bootstrap.marcoEvidence[0]?.page ?? bootstrap.creationEvidence.page}</p></div></Panel>{bootstrap.originGap ? <p className="rounded-xl border border-amber-200/15 px-3 py-2 text-[10px] leading-4 text-amber-100/55">Origem permanece como lacuna de catálogo; o campo livre registra narrativa do jogador.</p> : null}{optionEvidence ? <Panel title="Definição recuperada"><p className="text-[10px] text-[color:var(--gold)]">{optionEvidence.book} · {optionEvidence.section} · p. {optionEvidence.page}</p><pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-5 text-white/65">{textEvidence(optionEvidence)}</pre></Panel> : null}<div className="inline-flex items-center gap-2 px-1 text-[10px] text-white/30"><MessageCircle className="h-3.5 w-3.5"/>A conversa não confirma decisões automaticamente.</div></aside></div>}
  </main>;
}
