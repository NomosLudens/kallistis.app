import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { NexoActionBoard } from "@/components/NexoNarrativeSheet";

type Catalog = {
  peoples: { name: string }[];
  origins: string[];
  offices: { name: string; specializations: { name: string }[] }[];
};
type Character = { id: string; name: string; ruleset: string; version: number; snapshot: Record<string, unknown> };
type Mesa = { id: string; name: string; slug: string; member_role: string };
type Campaign = { id: string; name: string; status: string };
type RollRecord = { id: string; character_id: string; action_description: string; arguments_text: string[]; light_die: number; shadow_die: number; total: number; margin: number; grade: string; resonance: boolean; created_at: string };
type CoroOption = { id: string; paper: string; level: number; name: string; actionType: string; scope: string };
type CoroConsentView = { participant_user_id: string; display_name: string; member_role_snapshot: string; response: string };
type CoroManifestationView = Record<string, unknown> & { id: string; status: string; consents?: CoroConsentView[]; canAdjudicate?: boolean; canCancel?: boolean; currentUserIsParticipant?: boolean; currentUserConsent?: string | null; agreedCount?: number; consentCount?: number };
export const Route = createFileRoute("/_authenticated/nexo")({ component: NexoPage });

function NexoPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rollHistory, setRollHistory] = useState<RollRecord[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [canCreateMesa, setCanCreateMesa] = useState(false);
  const [mesaId, setMesaId] = useState("");
  const [coro, setCoro] = useState<Record<string, unknown> | null>(null);
  const [coroActionDescription, setCoroActionDescription] = useState("");
  const [coroAdjudicationNote, setCoroAdjudicationNote] = useState("");
  const [coroLevel, setCoroLevel] = useState(1);
  const [coroManifestNarrative, setCoroManifestNarrative] = useState("");
  const [coroParticipantIds, setCoroParticipantIds] = useState<string[]>([]);
  const [coroManifestOutcome, setCoroManifestOutcome] = useState("");
  const [coroManifestNote, setCoroManifestNote] = useState("");
  const [coroBusy, setCoroBusy] = useState(false);
  const [linkCharacterId, setLinkCharacterId] = useState("");
  const [linkingCharacter, setLinkingCharacter] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [mesaName, setMesaName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [people, setPeople] = useState("");
  const [origin, setOrigin] = useState("");
  const [office, setOffice] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [promise, setPromise] = useState("");
  const [bond, setBond] = useState("");
  const [experience, setExperience] = useState("");
  const [wound, setWound] = useState("");
  const [light, setLight] = useState(5);
  const [dark, setDark] = useState(5);
  const [resistanceCharacterId, setResistanceCharacterId] = useState("");
  const [resistanceActionDescription, setResistanceActionDescription] = useState("");
  const [resistanceValue, setResistanceValue] = useState(10);
  const [reason, setReason] = useState("");

  async function reload() {
    const response = await fetch("/api/nexo", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "nexo_load_failed");
    setCatalog(data.catalog);
    setCharacters(data.characters || []);
    if (!linkCharacterId && data.characters?.[0]) setLinkCharacterId(data.characters[0].id);
    setRollHistory(data.rolls || []);
    const mesaResponse = await fetch("/api/nexo/mesas", { credentials: "same-origin", cache: "no-store" });
    const mesaData = await mesaResponse.json();
    setCanCreateMesa(mesaData.canCreateMesa === true);
    if (mesaResponse.ok) {
      setMesas(mesaData.mesas || []);
      if (!mesaId && mesaData.mesas?.[0]) setMesaId(mesaData.mesas[0].id);
    }
  }
  useEffect(() => { void reload().catch((error) => toast.error(error.message)).finally(() => setLoading(false)); }, []);
  const activeOffice = catalog?.offices.find((entry) => entry.name === office);

  async function createCharacter(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const character = {
      nome: name.trim(), conceito: concept.trim(), povo: people, origem: origin, oficio: office,
      especializacao: specialization, marco: 1, influencia: { luz: light, escuridao: dark },
      historia: { promessa: promise.trim(), vinculo: bond.trim(), experiencia: experience.trim(), feridaMarcante: wound.trim() },
      promessa: promise.trim(), vinculo: bond.trim(), experiencia: experience.trim(), feridaMarcante: wound.trim(),
      capacidades: { dons: [], tecnicas: [], formas: [], evocoes: [], chaves: [], equipamentos: [] },
      estado: { marcasSombra: 0, ferimentos: [], condicoes: [] },
    };
    try {
      const response = await fetch("/api/nexo", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_character", character }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "nexo_create_failed");
      toast.success("Ficha NEXO persistida como rascunho.");
      await reload();
      setName(""); setConcept(""); setPromise(""); setBond(""); setExperience(""); setWound("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao salvar"); }
    finally { setSaving(false); }
  }

  async function changeShadow(character: Character, delta: number) {
    const response = await fetch("/api/nexo", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change_shadow", characterId: character.id, delta, reason }) });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error || "Falha ao alterar Sombra"); return; }
    toast.success("Marca de Sombra registrada."); setReason(""); await reload();
  }
  async function createMesa(event: React.FormEvent) {
    event.preventDefault();
    const slug = mesaName.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const response = await fetch("/api/nexo/mesas", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: mesaName, slug }) });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error || "Falha ao criar Mesa"); return; }
    setMesaName(""); toast.success("Mesa NEXO criada."); await reload(); setMesaId(data.mesa.id);
  }
  async function linkCharacter() {
    if (!mesaId || !linkCharacterId || linkingCharacter) return;
    setLinkingCharacter(true);
    try {
      const response = await fetch("/api/nexo/character-mesas", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ mesaId, characterId: linkCharacterId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "character_link_failed");
      toast.success("Seu personagem foi vinculado à Mesa.");
      await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao vincular personagem"); }
    finally { setLinkingCharacter(false); }
  }
  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/nexo/campaigns", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ mesaId, name: campaignName }) });
    const data = await response.json(); if (!response.ok) { toast.error(data.error || "Falha ao criar campanha"); return; }
    setCampaignName(""); if (data.campaign?.id) setCampaignId(data.campaign.id); toast.success("Campanha NEXO criada."); await loadCampaigns();
  }
  async function startSession(event: React.FormEvent) {
    event.preventDefault();
    if (!campaignId) { toast.error("Selecione uma campanha NEXO ativa."); return; }
    const response = await fetch("/api/nexo/sessions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ mesaId, campaignId, title: sessionTitle }) });
    const data = await response.json(); if (!response.ok) { toast.error(data.error || "Falha ao iniciar sessão"); return; }
    setSessionTitle(""); toast.success("Sessão NEXO iniciada."); await loadSessions();
  }
  async function loadCampaigns() {
    if (!mesaId) { setCampaigns([]); return; }
    const response = await fetch(`/api/nexo/campaigns?mesaId=${encodeURIComponent(mesaId)}`, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setCampaigns(data.campaigns || []); if (!campaignId && data.campaigns?.[0]) setCampaignId(data.campaigns[0].id); }
  }
  async function loadSessions() {
    if (!mesaId) { setSessions([]); return; }
    const response = await fetch(`/api/nexo/sessions?mesaId=${encodeURIComponent(mesaId)}`, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json(); if (response.ok) setSessions(data.sessions || []);
  }
  async function loadCoro() {
    if (!mesaId) { setCoro(null); return; }
    const response = await fetch(`/api/nexo/coro?mesaId=${encodeURIComponent(mesaId)}`, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setCoro({ error: data.error }); return; }
    setCoro(data);
  }
  async function initializeCoro() {
    const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "initialize", mesaId }) });
    const data = await response.json(); if (!response.ok) { toast.error(data.error || "Falha ao inicializar o Coro"); return; }
    await loadCoro();
  }
  async function setMasterResistance(event: React.FormEvent) {
    event.preventDefault();
    if (!mesaId || !resistanceCharacterId || !resistanceActionDescription.trim()) return;
    const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_resistance", mesaId, characterId: resistanceCharacterId, actionDescription: resistanceActionDescription, resistance: resistanceValue }) });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error || "Não foi possível definir a Resistência"); return; }
    toast.success("Resistência definida para esta ação."); setResistanceActionDescription(""); await loadCoro();
  }
  async function submitCoroAction(characterId: string) {
    if (coroBusy) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit_contribution", mesaId, characterId, actionDescription: coroActionDescription }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_contribution_failed");
      setCoroActionDescription(""); toast.success("Ação enviada ao Mestre para adjudicação."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao registrar a ação"); }
    finally { setCoroBusy(false); }
  }
  async function adjudicateCoroAction(contributionId: string, approved: boolean) {
    if (coroBusy) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "adjudicate_contribution", mesaId, contributionId, approved, note: coroAdjudicationNote }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_adjudication_failed");
      setCoroAdjudicationNote(""); toast.success(approved ? "Contribuição aprovada; Pulso persistido." : "Contribuição devolvida sem conceder Pulso."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao adjudicar"); }
    finally { setCoroBusy(false); }
  }
  async function advanceCoroRound() {
    if (coroBusy || !window.confirm("Avançar a rodada real desta Mesa? A ação ficará registrada.")) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "advance_round", mesaId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_round_advance_failed");
      toast.success(`Rodada ${String((data.state as Record<string, unknown>)?.round_number)} iniciada.`); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao avançar rodada"); }
    finally { setCoroBusy(false); }
  }
  async function proposeCoroManifestation(characterId: string, level: number) {
    if (coroBusy) return;
    setCoroBusy(true);
    try {
      const currentUserId = String(coro?.currentUserId ?? "");
      const participantUserIds = [...new Set([...coroParticipantIds, currentUserId])];
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "propose_manifestation", mesaId, characterId, level, narrative: coroManifestNarrative, participantUserIds }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_manifestation_proposal_failed");
      setCoroManifestNarrative(""); setCoroParticipantIds([]);
      toast.success("Proposta registrada. Cada participante precisa concordar expressamente antes da adjudicação."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao propor manifestação"); }
    finally { setCoroBusy(false); }
  }
  async function respondCoroConsent(manifestationId: string, agreed: boolean) {
    if (coroBusy) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "respond_manifestation_consent", mesaId, manifestationId, agreed }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_consent_failed");
      toast.success(agreed ? "Concordância registrada." : "Recusa registrada; a manifestação não gastará Barras."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao registrar concordância"); }
    finally { setCoroBusy(false); }
  }
  async function finalizeCoroManifestation(manifestationId: string) {
    if (coroBusy || coroManifestOutcome.trim().length < 8) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finalize_manifestation", mesaId, manifestationId, adjudicationNote: coroManifestNote, outcome: coroManifestOutcome }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_manifestation_finalize_failed");
      setCoroManifestOutcome(""); setCoroManifestNote("");
      toast.success("Manifestação adjudicada e Barras registradas no estado coletivo."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao confirmar manifestação"); }
    finally { setCoroBusy(false); }
  }
  async function cancelCoroManifestation(manifestationId: string) {
    if (coroBusy) return;
    setCoroBusy(true);
    try {
      const response = await fetch("/api/nexo/coro", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel_manifestation", mesaId, manifestationId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "coro_manifestation_cancel_failed");
      toast.success("Proposta cancelada sem gasto de Barras."); await loadCoro();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao cancelar proposta"); }
    finally { setCoroBusy(false); }
  }
  useEffect(() => { setCoroParticipantIds([]); void loadCoro(); }, [mesaId]);
  useEffect(() => { setCampaignId(""); void loadCampaigns(); void loadSessions(); }, [mesaId]);
  const coroOptions = (coro?.manifestationOptions ?? []) as CoroOption[];
  const activeManifestation = (coro?.activeManifestation ?? null) as CoroManifestationView | null;
  const manifestationHistory = (coro?.manifestations ?? []) as CoroManifestationView[];

  return <main className="mx-auto min-h-full max-w-6xl space-y-8 px-4 py-8 pb-28 text-[#F3EBDD] sm:px-8">
    <header><p className="text-xs uppercase tracking-[.28em] text-[color:var(--gold)]">Sistema de regras · NEXO canônico</p><h1 className="serif mt-2 text-4xl">NEXO</h1><p className="mt-2 max-w-2xl text-sm text-white/60">Fichas e operações NEXO são versionadas separadamente. Personagens e Mesas legadas permanecem em suas regras atuais.</p></header>
    <section className="rounded-2xl border border-white/10 bg-[#111016] p-5 sm:p-7">
      <h2 className="serif text-2xl">Nova ficha NEXO</h2>
      <form onSubmit={(event) => void createCharacter(event)} className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Nome"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Conceito"><input required value={concept} onChange={(e) => setConcept(e.target.value)} /></Field>
        <Field label="Povo"><select required value={people} onChange={(e) => setPeople(e.target.value)}><option value="">Escolha</option>{catalog?.peoples.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
        <Field label="Origem"><select required value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">Escolha</option>{catalog?.origins.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Ofício"><select required value={office} onChange={(e) => { setOffice(e.target.value); setSpecialization(""); }}><option value="">Escolha</option>{catalog?.offices.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
        <Field label="Especialização"><select required value={specialization} onChange={(e) => setSpecialization(e.target.value)}><option value="">Escolha</option>{activeOffice?.specializations.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
        <Field label="Promessa"><textarea required value={promise} onChange={(e) => setPromise(e.target.value)} /></Field>
        <Field label="Vínculo"><textarea required value={bond} onChange={(e) => setBond(e.target.value)} /></Field>
        <Field label="Experiência"><textarea required value={experience} onChange={(e) => setExperience(e.target.value)} /></Field>
        <Field label="Ferida marcante (opcional)"><textarea value={wound} onChange={(e) => setWound(e.target.value)} /></Field>
        <div className="md:col-span-2"><p className="mb-2 text-sm">Influência inicial (a soma deve ser 10)</p><div className="grid grid-cols-2 gap-3"><Field label={`Luz · ${light}`}><input type="range" min="0" max="10" value={light} onChange={(e) => { const value = Number(e.target.value); setLight(value); setDark(10-value); }} /></Field><Field label={`Escuridão · ${dark}`}><input type="range" min="0" max="10" value={dark} onChange={(e) => { const value = Number(e.target.value); setDark(value); setLight(10-value); }} /></Field></div></div>
        <button disabled={saving} className="min-h-11 rounded-lg bg-[color:var(--gold)] px-5 font-medium text-black disabled:opacity-50 md:col-span-2">{saving ? "Salvando…" : "Salvar rascunho NEXO"}</button>
      </form>
    </section>
    <section className="space-y-4"><h2 className="serif text-2xl">Suas fichas NEXO</h2>{loading ? <p className="text-white/60">Carregando do PostgreSQL…</p> : characters.length === 0 ? <p className="rounded-xl border border-dashed border-white/15 p-5 text-white/60">Nenhuma ficha NEXO ainda.</p> : null}
      {characters.map((character) => <article key={character.id} className="space-y-4 rounded-2xl border border-white/10 bg-[#111016] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="serif text-2xl">{character.name}</h3><p className="text-xs text-white/50">Rascunho · versão {character.version} · Marco {String(character.snapshot.marco)}</p></div><Link to={`/personagem/${encodeURIComponent(character.id)}/ficha` as never} className="rounded border border-white/20 px-3 py-2 text-sm">Abrir ficha</Link></div>
        <NexoActionBoard character={character} mesaId={mesaId} />
        {rollHistory.filter((entry) => entry.character_id === character.id).slice(0, 5).map((entry) => <div key={entry.id} className="rounded bg-black/20 p-2 text-xs text-white/55"><p>{new Date(entry.created_at).toLocaleString("pt-BR")} · {gradeText(entry.grade)} · margem {entry.margin}{entry.resonance ? " · Ressonância" : ""}</p>{entry.action_description ? <p className="mt-1 text-white/70">Ação: {entry.action_description}</p> : null}<details className="mt-1"><summary>Dados da rolagem</summary><p>Luz {entry.light_die} + Escuridão {entry.shadow_die} · total {entry.total}</p></details></div>)}
        <div className="flex flex-wrap items-end gap-2"><Field label="Motivo da mudança de Sombra"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" /></Field><button disabled={reason.trim().length < 3} onClick={() => void changeShadow(character, -1)} className="rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">−1 Marca de Sombra</button><button disabled={reason.trim().length < 3} onClick={() => void changeShadow(character, 1)} className="rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">+1 Marca de Sombra</button><span className="text-xs text-white/55">Marcas atuais: {String((character.snapshot.estado as Record<string, unknown>)?.marcasSombra ?? 0)} / 6</span></div>
      </article>)}
    </section>
    <section className="space-y-4 rounded-2xl border border-white/10 bg-[#111016] p-5 sm:p-7"><div><p className="text-xs uppercase tracking-[.2em] text-[color:var(--gold)]">Mesas versionadas</p><h2 className="serif mt-1 text-2xl">Campanhas e Coro</h2><p className="mt-2 text-sm text-white/55">Somente Mesas explicitamente marcadas NEXO aparecem aqui. Mesas antigas continuam separadas.</p></div>
      {mesas.length ? <Field label="Mesa NEXO"><select value={mesaId} onChange={(e) => setMesaId(e.target.value)}>{mesas.map((mesa) => <option key={mesa.id} value={mesa.id}>{mesa.name} · {mesa.member_role}</option>)}</select></Field> : <p className="text-sm text-white/55">Você ainda não tem Mesa NEXO acessível.</p>}
      {mesas.some((mesa) => mesa.id === mesaId) && characters.length ? <div className="flex flex-wrap items-end gap-2"><Field label="Seu personagem NEXO"><select value={linkCharacterId} onChange={(e) => setLinkCharacterId(e.target.value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></Field><button disabled={!linkCharacterId || linkingCharacter} onClick={() => void linkCharacter()} className="min-h-10 rounded border border-white/20 px-3 disabled:opacity-40">{linkingCharacter ? "Vinculando…" : "Vincular à Mesa"}</button></div> : null}
      {coro?.error ? <p className="text-sm text-white/55">Coro indisponível: {String(coro.error)}</p> : coro ? <div className="space-y-4 rounded-xl border border-white/10 p-4">
        <p className="text-sm">{String(coro.mesa)} · {String(coro.eligibleCharacterCount)} personagens com Papel ativo de {String(coro.characterCount)} vinculados · máximo {String(coro.maxBars)} Barras</p>
        <p className="serif text-xl">{coro.state ? `${String((coro.state as Record<string, unknown>).bars)} Barras completas · ${String((coro.state as Record<string, unknown>).pulses_in_current_bar)}/4 Pulsos da próxima` : "0 Barras completas · 0/4 Pulsos da próxima"}</p>
        {coro.state ? <p className="text-xs text-white/55">Rodada {String((coro.state as Record<string, unknown>).round_number)} · ativação {((coro.state as Record<string, unknown>).activation_used ? "já usada" : "disponível")}</p> : null}
        {!coro.state && mesas.some((mesa) => mesa.id === mesaId && mesa.member_role === "mestre") ? <button onClick={() => void initializeCoro()} className="rounded border border-white/20 px-3 py-2 text-sm">Inicializar estado compartilhado</button> : null}
        {coro.canManage === true ? <form className="grid gap-3 rounded-lg border border-white/10 bg-black/20 p-3" onSubmit={(event) => void setMasterResistance(event)}><h3 className="text-sm font-medium">Definir Resistência para uma ação</h3><Field label="Personagem"><select required value={resistanceCharacterId} onChange={(event) => setResistanceCharacterId(event.target.value)}><option value="">Escolha</option>{((coro.characters ?? []) as Array<{id:string;name:string}>).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></Field><Field label="Ação a que esta Resistência se aplica"><input required maxLength={1000} value={resistanceActionDescription} onChange={(event) => setResistanceActionDescription(event.target.value)} /></Field><Field label="Resistência"><input required type="number" min="0" max="100" value={resistanceValue} onChange={(event) => setResistanceValue(Number(event.target.value))} /></Field><p className="text-xs text-white/50">A definição fica vinculada à descrição exata e só pode resolver uma rolagem.</p><button disabled={!resistanceCharacterId || !resistanceActionDescription.trim()} className="justify-self-start rounded border border-[color:var(--gold)]/40 px-3 py-2 text-sm text-[color:var(--gold)] disabled:opacity-40">Definir para esta ação</button></form> : null}
        {(coro.characters as Array<{id:string;name:string;isOwner:boolean;activePaper:string|null}> | undefined)?.filter((character) => character.isOwner).map((character) => <div key={character.id} className="rounded-lg border border-white/10 p-3">
          <p className="text-sm">{character.name} · Papel ativo: {character.activePaper || "não definido em uma Trilha ativa"}</p>
          {character.activePaper ? <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); void submitCoroAction(character.id); }}><Field label="Ação realmente realizada nesta cena"><textarea required minLength={8} maxLength={1000} value={coroActionDescription} onChange={(event) => setCoroActionDescription(event.target.value)} /></Field><button disabled={coroBusy || coroActionDescription.trim().length < 8} className="min-h-10 justify-self-start rounded border border-[color:var(--gold)]/40 px-3 text-sm text-[color:var(--gold)] disabled:opacity-40">Enviar ao Mestre</button></form> : <p className="mt-2 text-xs text-white/50">Nenhuma ação pode ser enviada para esta ficha até existir Papel canônico ativo na Trilha. A ficha não será alterada aqui.</p>}
          {character.activePaper && !activeManifestation && coro.state && !(coro.state as Record<string, unknown>).activation_used ? <form className="mt-4 grid gap-3 border-t border-white/10 pt-3" onSubmit={(event) => { event.preventDefault(); void proposeCoroManifestation(character.id, coroLevel); }}>
            <h4 className="text-sm font-medium">Propor manifestação coletiva</h4>
            <Field label="Nível e Barras"><select value={coroLevel} onChange={(event) => setCoroLevel(Number(event.target.value))}>{coroOptions.filter((option) => option.paper === character.activePaper).map((option) => <option key={option.id} value={option.level}>Nível {option.level} · {option.name} · {option.level} Barra(s) · {option.actionType === "reaction" ? "Reação" : "Ação"}</option>)}</select></Field>
            {coroOptions.find((option) => option.paper === character.activePaper && option.level === coroLevel) ? <p className="text-xs text-white/55">{coroOptions.find((option) => option.paper === character.activePaper && option.level === coroLevel)?.scope}</p> : null}
            <Field label="Descreva a manifestação que o grupo deseja realizar"><textarea required minLength={8} maxLength={1000} value={coroManifestNarrative} onChange={(event) => setCoroManifestNarrative(event.target.value)} placeholder="Inclua a intenção, os alvos, o alcance e o resultado pretendido." /></Field>
            <fieldset className="grid gap-2"><legend className="text-xs text-white/65">Quem participará desta manifestação?</legend>{((coro?.participants ?? []) as Array<{user_id:string;display_name:string;member_role:string}>).map((participant) => { const isProposer = participant.user_id === String(coro?.currentUserId ?? ""); const checked = isProposer || coroParticipantIds.includes(participant.user_id); return <label key={participant.user_id} className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={checked} disabled={isProposer} onChange={(event) => setCoroParticipantIds((current) => event.target.checked ? [...new Set([...current, participant.user_id])] : current.filter((id) => id !== participant.user_id))} />{participant.display_name} · {participant.member_role}{isProposer ? " · proponente" : ""}</label>; })}</fieldset>
            <p className="text-xs text-white/45">Somente as pessoas selecionadas precisam concordar. Cada uma responde pela própria participação; silêncio não conta. A proposta não consome Barras.</p>
            <button disabled={coroBusy || Number((coro.state as Record<string, unknown>).bars) < coroLevel || coroManifestNarrative.trim().length < 8} className="min-h-10 justify-self-start rounded border border-[color:var(--gold)]/40 px-3 text-sm text-[color:var(--gold)] disabled:opacity-40">Propor e solicitar concordância</button>
          </form> : null}
        </div>)}
        {activeManifestation ? <article className="space-y-3 rounded-lg border border-[color:var(--gold)]/25 bg-black/20 p-3">
          <h3 className="serif text-lg">Manifestação proposta · {String(activeManifestation.status === "ready" ? "aguarda validação do Mestre" : "aguarda concordância")}</h3>
          <p className="text-sm">{String(activeManifestation.leader_character_name)} · {String(activeManifestation.active_paper)} · Nível {String(activeManifestation.level)} · {String(activeManifestation.bars_required)} Barra(s) · {String(activeManifestation.action_type === "reaction" ? "Reação" : "Ação")}</p>
          <p className="text-sm font-medium">{String(activeManifestation.effect_name)}</p>
          <p className="whitespace-pre-wrap text-sm">{String(activeManifestation.narrative ?? activeManifestation.action_context)}</p>
          <p className="text-xs text-white/55">Concordâncias: {String(activeManifestation.agreedCount ?? 0)}/{String(activeManifestation.consentCount ?? 0)} · pendentes ou recusas impedem gasto.</p>
          <div className="grid gap-1">{(activeManifestation.consents ?? []).map((vote) => <p key={vote.participant_user_id} className="text-xs text-white/55">{vote.display_name} · {vote.member_role_snapshot} · {vote.response === "agreed" ? "concordou" : vote.response === "declined" ? "recusou" : "aguarda resposta"}</p>)}</div>
          {activeManifestation.currentUserIsParticipant && activeManifestation.currentUserConsent === "pending" ? <div className="flex flex-wrap gap-2"><button disabled={coroBusy} onClick={() => void respondCoroConsent(activeManifestation.id, true)} className="rounded bg-[color:var(--gold)] px-3 py-2 text-sm text-black disabled:opacity-40">Concordo expressamente</button><button disabled={coroBusy} onClick={() => void respondCoroConsent(activeManifestation.id, false)} className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Recuso</button></div> : activeManifestation.currentUserIsParticipant ? <p className="text-xs text-white/50">Sua resposta: {activeManifestation.currentUserConsent === "agreed" ? "concordância registrada" : "recusa registrada"}.</p> : null}
          {coro.canManage === true && activeManifestation.canAdjudicate && activeManifestation.status === "ready" ? <div className="space-y-3 border-t border-white/10 pt-3"><h4 className="text-sm font-medium">Adjudicar manifestação</h4><Field label="Aplicação concreta, alvos e estados alterados"><textarea required minLength={8} maxLength={1500} value={coroManifestOutcome} onChange={(event) => setCoroManifestOutcome(event.target.value)} /></Field><Field label="Nota do Mestre (opcional)"><input maxLength={1000} value={coroManifestNote} onChange={(event) => setCoroManifestNote(event.target.value)} /></Field><p className="text-xs text-white/45">A adjudicação confirma a disponibilidade da Ação/Reação e sua aplicação no momento canônico.</p><button disabled={coroBusy || coroManifestOutcome.trim().length < 8} onClick={() => void finalizeCoroManifestation(activeManifestation.id)} className="rounded bg-[color:var(--gold)] px-3 py-2 text-sm text-black disabled:opacity-40">Confirmar execução e gastar {String(activeManifestation.bars_required)} Barra(s)</button></div> : null}
          {activeManifestation.canCancel ? <button disabled={coroBusy} onClick={() => void cancelCoroManifestation(activeManifestation.id)} className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Cancelar proposta sem gasto</button> : null}
        </article> : null}
        {coro.canManage === true ? <div className="border-t border-white/10 pt-3">{(coro.contributions as Array<Record<string, unknown>> | undefined)?.some((item) => item.status === "pending") ? <div className="space-y-3"><h3 className="serif text-lg">Adjudicação do Mestre</h3>{(coro.contributions as Array<Record<string, unknown>>).filter((item) => item.status === "pending").map((item) => <article key={String(item.id)} className="space-y-2 rounded-lg bg-black/20 p-3"><p className="text-sm">{String(item.character_name)} · {String(item.active_paper)} · rodada {String(item.round_number)}</p><p className="whitespace-pre-wrap text-sm text-white/75">{String(item.action_description)}</p><p className="text-xs text-white/45">Contribuição enviada para adjudicação · {new Date(String(item.created_at)).toLocaleString("pt-BR")}</p><Field label="Nota de adjudicação"><input value={coroAdjudicationNote} onChange={(event) => setCoroAdjudicationNote(event.target.value)} maxLength={500} placeholder="Opcional" /></Field><div className="flex flex-wrap gap-2"><button disabled={coroBusy || item.canAdjudicate !== true} onClick={() => void adjudicateCoroAction(String(item.id), true)} className="rounded bg-[color:var(--gold)] px-3 py-2 text-sm text-black disabled:opacity-40">Aprovar e conceder 1 Pulso</button><button disabled={coroBusy || item.canAdjudicate !== true} onClick={() => void adjudicateCoroAction(String(item.id), false)} className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Rejeitar sem Pulso</button></div></article>)}</div> : null}<details className="mt-3"><summary className="cursor-pointer text-sm text-white/65">Controles do Mestre</summary><button disabled={coroBusy || Number(coro.pendingCount) > 0 || !!activeManifestation} onClick={() => void advanceCoroRound()} className="mt-3 rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Avançar rodada</button></details></div> : null}
        <div className="space-y-2 border-t border-white/10 pt-3"><h3 className="serif text-lg">Histórico de contribuições</h3>{(coro.contributions as Array<Record<string, unknown>> | undefined)?.length ? (coro.contributions as Array<Record<string, unknown>>).map((item) => <p key={String(item.id)} className="text-sm text-white/60">{String(item.character_name)} · {String(item.active_paper)} · rodada {String(item.round_number)} · {String(item.status)} · {String(item.action_description)}</p>) : <p className="text-sm text-white/50">Ainda sem contribuições registradas.</p>}</div>
        <div className="space-y-2 border-t border-white/10 pt-3"><h3 className="serif text-lg">Histórico de manifestações</h3>{manifestationHistory.length ? manifestationHistory.filter((item) => item.status !== "pending_consent" && item.status !== "ready").map((item) => <article key={item.id} className="rounded-lg bg-black/20 p-3 text-sm"><p>{String(item.leader_character_name)} · {String(item.active_paper)} Nível {String(item.level)} · {String(item.status)}{item.status === "manifested" ? ` · ${String(item.bars_required)} Barra(s) consumida(s)` : " · sem gasto"}</p><p className="mt-1 whitespace-pre-wrap text-white/70">{String(item.narrative ?? item.action_context)}</p>{item.status === "manifested" ? <p className="mt-1 text-white/70">Resultado adjudicado: {String(item.outcome)}</p> : null}</article>) : <p className="text-sm text-white/50">Ainda sem manifestações registradas.</p>}</div>
        <button onClick={() => void loadCoro()} className="rounded border border-white/20 px-3 py-2 text-sm">Atualizar do servidor</button>
      </div> : null}
      {canCreateMesa && !mesas.length ? <form className="flex max-w-xl items-end gap-2 border-t border-white/10 pt-4" onSubmit={(e) => void createMesa(e)}><Field label="Criar Mesa NEXO (administrador global)"><input value={mesaName} onChange={(e) => setMesaName(e.target.value)} placeholder="Nome da Mesa" /></Field><button disabled={!mesaName.trim()} className="min-h-10 rounded border border-[color:var(--gold)]/40 px-3 text-[color:var(--gold)] disabled:opacity-40">Criar Mesa</button></form> : null}
    </section>
  </main>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-xs text-white/65">{label}<span className="block [&_input:not([type=range])]:min-h-10 [&_input:not([type=range])]:w-full [&_input:not([type=range])]:rounded-lg [&_input:not([type=range])]:border [&_input:not([type=range])]:border-white/15 [&_input:not([type=range])]:bg-black/20 [&_input:not([type=range])]:px-3 [&_input:not([type=range])]:text-sm [&_select]:min-h-10 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-white/15 [&_select]:bg-[#17151d] [&_select]:px-3 [&_select]:text-sm [&_textarea]:min-h-20 [&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-white/15 [&_textarea]:bg-black/20 [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span></label>; }
function gradeText(grade: string) { return ({ severe_failure: "Falha grave", failure: "Falha", success: "Sucesso", strong_success: "Sucesso forte", extraordinary: "Sucesso extraordinário" } as Record<string, string>)[grade] ?? grade; }
