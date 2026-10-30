import { createHash, randomUUID } from "node:crypto";
import { generateText } from "ai";
import { createFileRoute } from "@tanstack/react-router";
import { AI_MODELS } from "@/lib/ai-models.server";
import { createOpenRouterProvider, providerFailureMessage } from "@/lib/openrouter.server";
import { requireUser } from "@/lib/require-user.server";
import { distributedChatRateLimit } from "@/lib/rate-limit";
import {
  CANONICAL_MANIFEST,
  getCanonicalCharacterChoices,
  getCanonicalCharacterSources,
  getCanonicalOptionDefinition,
  getCanonicalSourceGap,
  getCanonicalTrocadoCreationRule,
  searchCanonical,
  type CanonicalEvidence,
} from "@/server/canonical/genesis-canonical-core";
import { reviewerForNewCharacter } from "@/server/characters/authorization";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createBunPostgresExecutor, type SqlExecutor } from "@/server/local-core/postgres";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";

const HEADERS = { "Cache-Control": "no-store" };
const RULESET = "KALLISTIS_NEXO_FINAL";
const CANONICAL_REVISION = "editorial-final-movimento-b-2026-10-30";
const MAX_BODY = 20_000;
const MAX_TEXT = 4_000;

type Fields = {
  name: string;
  concept: string;
  povo: string;
  herancaPovo: string;
  origem: string;
  origemTrocado: boolean;
  modoTrocado: string;
  luz: number | null;
  escuridao: number | null;
  oficio: string;
  papel: string;
  chave: string;
  marco: number;
  promessa: string;
  vinculo: string;
  experiencia: string;
  feridaMarcante: string;
  equipamento: string;
  relacoes: string;
  perguntaPessoal: string;
  manifestacaoPessoal: string;
};
type LearnedCapability = { name: string; evidence: CanonicalEvidence };
type NexoSnapshot = {
  canonical: {
    id: string;
    revision: string;
    markdownSha256: string;
    pdfSha256: string;
  };
  creationStatus: "draft" | "complete";
  fields: Fields;
  learnedCapabilities: LearnedCapability[];
  povoEvidence: CanonicalEvidence | null;
  trocadoEvidence: CanonicalEvidence | null;
  originCatalogGap: { note: string; evidence: CanonicalEvidence[] };
  confirmedAt: string | null;
};
type CharacterRow = {
  id: string;
  owner_user_id: string;
  status: string;
  ruleset: string;
  name: string;
  player_name: string;
  snapshot: NexoSnapshot;
  version: number;
  updated_at: string;
};
type MessageRow = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function database() {
  const url = getRuntimeDatabaseUrl();
  return url ? createBunPostgresExecutor(url) : null;
}

function csrf(request: Request) {
  return isSameOriginRequest(
    request,
    process.env.KALLISTIS_PUBLIC_ORIGIN || "https://kallistis.app",
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("body_too_large");
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("invalid_request");
  }
}

export function emptyFields(): Fields {
  return {
    name: "",
    concept: "",
    povo: "",
    herancaPovo: "",
    origem: "",
    origemTrocado: false,
    modoTrocado: "",
    luz: null,
    escuridao: null,
    oficio: "",
    papel: "",
    chave: "",
    marco: 1,
    promessa: "",
    vinculo: "",
    experiencia: "",
    feridaMarcante: "",
    equipamento: "",
    relacoes: "",
    perguntaPessoal: "",
    manifestacaoPessoal: "",
  };
}

function canonicalCreationEvidence() {
  return getCanonicalCharacterSources("Criação de personagem NEXO", 4).find((item) =>
    item.headings.includes("Criação de personagem NEXO"),
  );
}

function originGap() {
  const gap = getCanonicalSourceGap("Origem");
  return {
    note: gap.note ?? "Lacuna explícita: esta revisão não oferece um catálogo fechado de Origens.",
    evidence: [...gap.evidence],
  };
}

export function createSnapshot(initialConcept = ""): NexoSnapshot {
  if (CANONICAL_MANIFEST.revision !== CANONICAL_REVISION)
    throw new Error("canonical_revision_mismatch");
  const source = canonicalCreationEvidence();
  if (!source) throw new Error("canonical_creation_source_missing");
  const gap = originGap();
  return {
    canonical: {
      id: CANONICAL_MANIFEST.canonicalId,
      revision: CANONICAL_MANIFEST.revision,
      markdownSha256: CANONICAL_MANIFEST.markdownSha256,
      pdfSha256: CANONICAL_MANIFEST.pdfSha256,
    },
    creationStatus: "draft",
    fields: { ...emptyFields(), concept: initialConcept },
    learnedCapabilities: [],
    povoEvidence: null,
    trocadoEvidence: null,
    originCatalogGap: gap,
    confirmedAt: null,
  };
}

function choicesPayload() {
  const creation = canonicalCreationEvidence();
  if (!creation) throw new Error("canonical_creation_source_missing");
  const marco = searchCanonical("Marco inicial M1 salvo decisão de campanha", {
    books: ["LIVRO III — SISTEMA"],
    limit: 3,
  });
  const gap = originGap();
  return {
    canonical: CANONICAL_MANIFEST,
    choices: getCanonicalCharacterChoices(),
    creationEvidence: creation,
    marcoEvidence: marco,
    originGap: gap,
    trocadoRule: getCanonicalTrocadoCreationRule(),
  };
}

export function officeDetails(name: string) {
  const evidence = getCanonicalOptionDefinition("offices", name)[0];
  if (!evidence || evidence.revision !== CANONICAL_REVISION)
    throw new Error("canonical_office_not_found");
  const rolesText = evidence.text.match(/\*\*Papéis:\*\*\s*([\s\S]*?)\s*\*\*Proficiências:/i)?.[1];
  const initialTechnique = evidence.text.match(/^#{1,6}\s*Técnica inicial\s*[—–-]\s*(.+?)\s*$/im)?.[1]?.trim();
  if (!rolesText || !initialTechnique) throw new Error("canonical_office_definition_incomplete");
  const roles = rolesText
    .replace(/\s+/g, " ")
    .split(/\s+ou\s+|,\s*/i)
    .map((role) => role.trim())
    .filter(Boolean);
  return { evidence, roles, initialTechnique };
}

export function peopleHeritages(evidence: CanonicalEvidence) {
  const block = evidence.text.match(/#### Heranças\s*([\s\S]*?)(?=\n####\s|\n---|$)/i)?.[1] ?? "";
  const names = [...block.matchAll(/\*\*([^*]+)\.\*\*/g)].map((match) => match[1].trim());
  if (names.length !== 2) throw new Error("canonical_people_heritage_definition_incomplete");
  return names;
}

export function requiredFields(fields: Fields) {
  const required = [
    "name", "concept", "povo", "herancaPovo", "origem", "luz", "escuridao", "oficio", "papel", "chave",
    "promessa", "vinculo", "experiencia", "equipamento", "relacoes", "perguntaPessoal",
    "manifestacaoPessoal",
  ].filter((field) => {
    const value = fields[field as keyof Fields];
    return typeof value === "number" ? value === null : !String(value ?? "").trim();
  });
  if (fields.origemTrocado && !fields.modoTrocado.trim()) required.push("modoTrocado");
  return required;
}

function nonemptyText(value: unknown, field: string, max = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`invalid_${field}`);
  return value.trim();
}

function assertChoice(category: "peoples" | "offices", value: unknown) {
  if (typeof value !== "string") throw new Error(`invalid_${category}`);
  const contract = getCanonicalCharacterChoices()[category];
  if (contract.status !== "available" || !contract.items.some((item) => item.name === value))
    throw new Error(`invalid_${category}`);
  const evidence = getCanonicalOptionDefinition(category, value)[0];
  if (!evidence || evidence.revision !== CANONICAL_REVISION)
    throw new Error(`canonical_${category}_definition_missing`);
  return evidence;
}

export function updateField(snapshot: NexoSnapshot, field: string, value: unknown): NexoSnapshot {
  const fields = { ...snapshot.fields };
  let learnedCapabilities = snapshot.learnedCapabilities;
  if (field === "name") fields.name = nonemptyText(value, field, 100);
  else if (field === "concept") fields.concept = nonemptyText(value, field);
  else if (field === "povo") {
    const evidence = assertChoice("peoples", value);
    fields.povo = value as string;
    fields.herancaPovo = "";
    snapshot = { ...snapshot, povoEvidence: evidence };
  } else if (field === "herancaPovo") {
    if (!snapshot.fields.povo || !snapshot.povoEvidence) throw new Error("povo_required_before_heritage");
    const options = peopleHeritages(snapshot.povoEvidence);
    if (typeof value !== "string" || !options.includes(value)) throw new Error("invalid_heritage_for_povo");
    fields.herancaPovo = value;
  } else if (field === "origem") fields.origem = nonemptyText(value, field);
  else if (field === "origemTrocado") {
    if (typeof value !== "boolean") throw new Error("invalid_origemTrocado");
    fields.origemTrocado = value;
    if (value) {
      const rule = getCanonicalTrocadoCreationRule();
      if (rule.status !== "available" || rule.evidence.revision !== CANONICAL_REVISION)
        throw new Error("canonical_trocado_rule_missing");
      snapshot = { ...snapshot, trocadoEvidence: rule.evidence };
    } else {
      fields.modoTrocado = "";
      snapshot = { ...snapshot, trocadoEvidence: null };
    }
  } else if (field === "modoTrocado") {
    if (!fields.origemTrocado) throw new Error("trocado_origin_required");
    const rule = getCanonicalTrocadoCreationRule();
    if (rule.status !== "available" || rule.evidence.revision !== CANONICAL_REVISION)
      throw new Error("canonical_trocado_rule_missing");
    if (typeof value !== "string" || !rule.options.includes(value)) throw new Error("invalid_modoTrocado");
    fields.modoTrocado = value;
    snapshot = { ...snapshot, trocadoEvidence: rule.evidence };
  }
  else if (field === "distribuicao") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_distribuicao");
    const input = value as Record<string, unknown>;
    const luz = Number(input.luz);
    const escuridao = Number(input.escuridao);
    if (!Number.isInteger(luz) || !Number.isInteger(escuridao) || luz < 0 || escuridao < 0 || luz > 10 || escuridao > 10 || luz + escuridao !== 10)
      throw new Error("invalid_distribuicao");
    fields.luz = luz;
    fields.escuridao = escuridao;
  } else if (field === "oficio") {
    const evidence = assertChoice("offices", value);
    const details = officeDetails(value as string);
    fields.oficio = value as string;
    fields.papel = "";
    fields.chave = "";
    learnedCapabilities = [{
      name: details.initialTechnique,
      evidence: { ...evidence, text: details.evidence.text },
    }];
  } else if (field === "papel") {
    if (!fields.oficio) throw new Error("office_required_before_role");
    const { roles } = officeDetails(fields.oficio);
    if (typeof value !== "string" || !roles.includes(value)) throw new Error("invalid_papel_for_office");
    fields.papel = value;
  } else if (field === "chave") {
    if (!fields.oficio) throw new Error("office_required_before_key");
    fields.chave = nonemptyText(value, field);
  } else if (field === "marco") {
    if (value !== 1) throw new Error("invalid_initial_marco");
    fields.marco = 1;
  } else if (field === "promessa") fields.promessa = nonemptyText(value, field);
  else if (field === "vinculo") fields.vinculo = nonemptyText(value, field);
  else if (field === "experiencia") fields.experiencia = nonemptyText(value, field);
  else if (field === "feridaMarcante") {
    if (typeof value !== "string" || value.trim().length > MAX_TEXT) throw new Error("invalid_feridaMarcante");
    fields.feridaMarcante = value.trim();
  } else if (field === "equipamento") fields.equipamento = nonemptyText(value, field);
  else if (field === "relacoes") fields.relacoes = nonemptyText(value, field);
  else if (field === "perguntaPessoal") fields.perguntaPessoal = nonemptyText(value, field);
  else if (field === "manifestacaoPessoal") fields.manifestacaoPessoal = nonemptyText(value, field);
  else throw new Error("invalid_field");

  if ((fields.luz !== null || fields.escuridao !== null)
    && (fields.luz === null || fields.escuridao === null || fields.luz + fields.escuridao !== 10))
    throw new Error("invalid_distribuicao");
  const remainsComplete = snapshot.creationStatus === "complete"
    && requiredFields(fields).length === 0
    && learnedCapabilities.length > 0;
  return {
    ...snapshot,
    fields,
    learnedCapabilities,
    confirmedAt: remainsComplete ? snapshot.confirmedAt : null,
    creationStatus: remainsComplete ? "complete" : "draft",
  };
}

function snapshotHash(snapshot: NexoSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function saveSnapshot(input: {
  sql: SqlExecutor;
  character: CharacterRow;
  userId: string;
  snapshot: NexoSnapshot;
  reason: string;
}) {
  const tx = input.sql.transaction;
  if (!tx) throw new Error("database_transactions_required");
  const nextVersion = Number(input.character.version) + 1;
  const id = input.character.id;
  await tx(async (connection) => {
    const locked = await connection.query<CharacterRow>(
      "SELECT id,owner_user_id,status,ruleset,name,player_name,snapshot,version,updated_at FROM public.characters WHERE id=$1 AND owner_user_id=$2 AND ruleset=$3 FOR UPDATE",
      [id, input.userId, RULESET],
    );
    if (!locked[0] || Number(locked[0].version) !== Number(input.character.version))
      throw new Error("stale_character_version");
    await connection.query(
      "UPDATE public.characters SET name=$3,snapshot=$4::jsonb,version=$5,mechanical_fingerprint=$6,updated_at=now() WHERE id=$1 AND owner_user_id=$2",
      [id, input.userId, input.snapshot.fields.name, input.snapshot, nextVersion, snapshotHash(input.snapshot)],
    );
    await connection.query(
      "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,$2,$3::jsonb,$4,$5)",
      [id, nextVersion, input.snapshot, input.reason, input.userId],
    );
    await connection.query(
      "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
      [id, input.userId, input.reason, { canonicalRevision: CANONICAL_REVISION }, input.character.version, nextVersion],
    );
  });
  return { ...input.character, name: input.snapshot.fields.name, snapshot: input.snapshot, version: nextVersion };
}

async function ownedCharacter(sql: SqlExecutor, id: string, userId: string) {
  const rows = await sql.query<CharacterRow>(
    "SELECT id,owner_user_id,status,ruleset,name,player_name,snapshot,version,updated_at FROM public.characters WHERE id=$1 AND owner_user_id=$2 AND ruleset=$3 LIMIT 1",
    [id, userId, RULESET],
  );
  if (!rows[0]) throw new Error("character_not_found");
  const stored = rows[0].snapshot as NexoSnapshot;
  const snapshot: NexoSnapshot = {
    ...stored,
    fields: {
      ...emptyFields(),
      ...stored.fields,
      origemTrocado: stored.fields?.origemTrocado === true,
      modoTrocado: typeof stored.fields?.modoTrocado === "string" ? stored.fields.modoTrocado : "",
    },
    trocadoEvidence: stored.trocadoEvidence ?? null,
  };
  if (snapshot.canonical?.revision !== CANONICAL_REVISION) throw new Error("canonical_revision_mismatch");
  return { ...rows[0], snapshot };
}

async function readMessages(sql: SqlExecutor, id: string, userId: string) {
  return await sql.query<MessageRow>(
    "SELECT id,role,content,created_at FROM public.character_creation_messages WHERE character_id=$1 AND user_id=$2 ORDER BY created_at ASC,id ASC",
    [id, userId],
  );
}

async function persistMessage(sql: SqlExecutor, id: string, userId: string, role: "user" | "assistant", content: string) {
  await sql.query(
    "INSERT INTO public.character_creation_messages (character_id,user_id,role,content) VALUES ($1,$2,$3,$4) RETURNING id",
    [id, userId, role, content.slice(0, 12_000)],
  );
}

async function respondToConversation(input: {
  requestId: string;
  userMessage: string;
  history: readonly MessageRow[];
  snapshot: NexoSnapshot;
}) {
  const sources = getCanonicalCharacterSources(input.userMessage, 4);
  const creation = canonicalCreationEvidence();
  if (!creation) throw new Error("canonical_creation_source_missing");
  const office = input.snapshot.fields.oficio
    ? getCanonicalOptionDefinition("offices", input.snapshot.fields.oficio)
    : [];
  const trocadoSources = input.snapshot.fields.origemTrocado
    ? searchCanonical("Trocados padrões de adaptação Fenda história pessoal vínculos trauma treino exposição anterior", {
      books: ["LIVRO III — SISTEMA"],
      limit: 2,
    })
    : [];
  const characterChoices = getCanonicalCharacterChoices();
  const evidence = [creation, ...(input.snapshot.povoEvidence ? [input.snapshot.povoEvidence] : []),
    ...(input.snapshot.trocadoEvidence ? [input.snapshot.trocadoEvidence] : []), ...trocadoSources, ...office, ...sources]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.book === item.book && candidate.page === item.page && candidate.section === item.section) === index)
    .slice(0, 6);
  const sourceBlock = evidence.map((item, index) =>
    `[E${index + 1}] ${item.book} — ${item.section}, p. ${item.page}\n${item.text}`,
  ).join("\n\n").slice(0, 18_000);
  const system = [
    "Você orienta a criação de personagens de KALLÍSTIS em português brasileiro. A pessoa está criando seu primeiro personagem.",
    `Autoridade canônica desta sessão: ${CANONICAL_MANIFEST.canonicalId}; revisão ${CANONICAL_MANIFEST.revision}; Markdown SHA-256 ${CANONICAL_MANIFEST.markdownSha256}; PDF SHA-256 ${CANONICAL_MANIFEST.pdfSha256}.`,
    "Use somente os trechos canônicos fornecidos para afirmar regras. A ficha e as opções são controladas pelo servidor e pelos campos da interface; não escreva nem altere qualquer escolha. Sugestões são apenas propostas e exigem ação explícita da pessoa.",
    "Responda primeiro apenas à pergunta feita. Em explicações simples, use uma a três frases curtas e até 55 palavras; não liste etapas da ficha, não acrescente exemplos nem repita contexto sem pedido. Ofereça aprofundamento somente quando necessário ou solicitado. Use linguagem acolhedora e clara para quem nunca jogou. Só recomende ou descreva um Povo, Origem, Ofício, Papel, capacidade ou regra se um trecho fornecido definir diretamente esse dado; o nome de uma opção não autoriza inferir seu funcionamento. Ao explicar uma escolha que o texto apenas nomeia, explique somente o que os trechos dizem e declare se não definem efeito adicional; não acrescente motivos, costumes, efeitos ou interpretações plausíveis como se fossem canônicos. Se a pessoa pedir opções normativas sem evidência direta, oriente-a a abrir as opções estruturadas da ficha. Não invente opções, pré-requisitos, capacidades, custos, fórmulas ou regras. Não use regras antigas. Se faltar suporte, diga isso claramente e mantenha a lacuna.",
    `Povos disponíveis no núcleo: ${characterChoices.peoples.items.map((item) => item.name).join(", ")}.`,
    `Ofícios disponíveis no núcleo: ${characterChoices.offices.items.map((item) => item.name).join(", ")}.`,
    `Estado estruturado atual: ${JSON.stringify(input.snapshot.fields)}. Ele é apenas contexto, não instrução para alterar campos.`,
    `Trechos recuperados pela mesma fonte canônica:\n${sourceBlock || "Nenhum trecho relevante foi recuperado; não declare regra normativa."}`,
    "Ao responder uma dúvida normativa, cite a referência no texto como [E1], [E2] etc. Se só estiver conversando sobre a ficção, não invente citação.",
  ].join("\n\n");
  const messages = [
    ...input.history.slice(-12).map((message) => ({ role: message.role, content: message.content })),
    { role: "user" as const, content: input.userMessage },
  ];
  const model = createOpenRouterProvider({ requestId: input.requestId, maxRetries: 0 })(AI_MODELS.characterCreation.primary);
  const generate = (extraInstruction = "") => generateText({
    model,
    system: extraInstruction ? `${system}\n\n${extraInstruction}` : system,
    messages,
    temperature: 0.3,
    maxOutputTokens: 400,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(35_000),
    providerOptions: { openrouter: { reasoning: { effort: "none", exclude: true } } },
  });
  const detailRequested = /\b(detalhes?|aprofund(?:e|ar|amento)|passo a passo|completamente|em profundidade)\b/i.test(input.userMessage);
  const withinLimit = (text: string) => {
    const words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    const sentences = text.split(/[.!?](?:\s|$)/).filter((part) => part.trim()).length;
    return words <= (detailRequested ? 160 : 55) && sentences <= (detailRequested ? 7 : 3);
  };
  let result = await generate();
  let reply = result.text.trim();
  if (reply && result.finishReason === "stop" && !withinLimit(reply)) {
    result = await generate("Reescreva a mesma resposta com no máximo três frases curtas e 55 palavras. Responda somente ao pedido feito; remova exemplos e informações que não sejam necessários. Preserve as afirmações e citações apoiadas pelos trechos, sem acrescentar regras.");
    reply = result.text.trim();
  }
  if (!reply || result.finishReason !== "stop") throw new Error("generation_incomplete");
  if (!withinLimit(reply)) throw new Error("beginner_response_too_long");
  return { reply, evidence: evidence.map(({ canonicalId, revision, book, section, page, markdownSha256, pdfSha256 }) => ({ canonicalId, revision, book, section, page, markdownSha256, pdfSha256 })) };
}

function citedAssistantMessage(reply: string, evidence: Awaited<ReturnType<typeof respondToConversation>>["evidence"]) {
  const citations = evidence.map((item) => item.book + ", " + item.section + ", p. " + item.page).join("; ") || "sem trecho normativo recuperado";
  return reply + "\n\nFonte da revisão " + CANONICAL_REVISION + ": " + citations + ".";
}

function errorResponse(error: unknown, statusOverride?: number) {
  const code = error instanceof Error ? error.message : "request_failed";
  const status = statusOverride ?? (
    code === "character_not_found" ? 404
      : code === "stale_character_version" ? 409
        : code === "canonical_revision_mismatch" ? 409
          : code.startsWith("invalid_") || code === "office_required_before_role" || code === "office_required_before_key" || code === "invalid_papel_for_office" || code === "povo_required_before_heritage" || code === "trocado_origin_required" ? 422
            : 500
  );
  return Response.json({ error: code }, { status, headers: HEADERS });
}

export const Route = createFileRoute("/api/nexo-character-creation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const sql = database();
        if (!sql) return Response.json({ error: "database_unavailable" }, { status: 503, headers: HEADERS });
        try {
          const url = new URL(request.url);
          const characterId = url.searchParams.get("characterId");
          const category = url.searchParams.get("category");
          const optionName = url.searchParams.get("name");
          if (category && optionName && (category === "peoples" || category === "offices")) {
            const evidence = getCanonicalOptionDefinition(category, optionName)[0];
            if (!evidence) return Response.json({ error: "canonical_option_not_found" }, { status: 404, headers: HEADERS });
            const details = category === "offices"
              ? officeDetails(optionName)
              : { heritages: peopleHeritages(evidence) };
            return Response.json({ evidence, details }, { headers: HEADERS });
          }
          if (characterId) {
            const character = await ownedCharacter(sql, characterId, auth.userId);
            const messages = await readMessages(sql, characterId, auth.userId);
            return Response.json({ ...choicesPayload(), character, messages }, { headers: HEADERS });
          }
          const characters = await sql.query(
            "SELECT id,name,status,version,updated_at,snapshot FROM public.characters WHERE owner_user_id=$1 AND ruleset=$2 ORDER BY updated_at DESC",
            [auth.userId, RULESET],
          );
          return Response.json({ ...choicesPayload(), characters }, { headers: HEADERS });
        } catch (error) {
          return errorResponse(error);
        } finally {
          sql.close();
        }
      },
      POST: async ({ request }) => {
        if (!csrf(request)) return Response.json({ error: "csrf_rejected" }, { status: 403, headers: HEADERS });
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const requestId = randomUUID();
        let sql: ReturnType<typeof database> = null;
        try {
          const input = await readBody(request);
          if (["start", "message", "retryAssistant"].includes(String(input.action))) {
            const limited = await distributedChatRateLimit(request, auth.userId);
            if (limited) return limited;
          }
          sql = database();
          if (!sql) return Response.json({ error: "database_unavailable", requestId }, { status: 503, headers: HEADERS });

          if (input.action === "start") {
            const concept = nonemptyText(input.message, "concept", 2_000);
            const id = randomUUID();
            const created = createSnapshot(concept);
            const reviewerId = await reviewerForNewCharacter(sql, auth.userId);
            const profile = await sql.query<{ display_name: string | null }>(
              "SELECT display_name FROM public.profiles WHERE id=$1 LIMIT 1",
              [auth.userId],
            );
            const playerName = profile[0]?.display_name?.trim() || "Jogador";
            if (!sql.transaction) throw new Error("database_transactions_required");
            await sql.transaction(async (tx) => {
              await tx.query(
                "INSERT INTO public.characters (id,owner_user_id,master_user_id,status,ruleset,name,player_name,snapshot,version,mechanical_fingerprint) VALUES ($1,$2,$3,'draft',$4,'',$5,$6::jsonb,1,$7)",
                [id, auth.userId, reviewerId, RULESET, playerName, created, snapshotHash(created)],
              );
              await tx.query(
                "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,1,$2::jsonb,'nexo_creation_started',$3)",
                [id, created, auth.userId],
              );
              await tx.query(
                "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,'nexo_creation_started',$3::jsonb,NULL,1)",
                [id, auth.userId, { canonicalRevision: CANONICAL_REVISION, canonicalId: CANONICAL_MANIFEST.canonicalId }],
              );
              await persistMessage(tx, id, auth.userId, "user", concept);
            });
            let conversation: Awaited<ReturnType<typeof respondToConversation>> | null = null;
            let aiError: string | null = null;
            try {
              conversation = await respondToConversation({ requestId, userMessage: concept, history: [], snapshot: created });
            } catch (error) {
              aiError = error instanceof Error && ["generation_incomplete", "beginner_response_too_long"].includes(error.message) ? "generation_incomplete" : "provider_unavailable";
              console.warn("[nexo-character-creation] provider failed", { requestId, error: aiError });
            }
            if (conversation) await persistMessage(sql, id, auth.userId, "assistant", citedAssistantMessage(conversation.reply, conversation.evidence));
            const character = await ownedCharacter(sql, id, auth.userId);
            const messages = await readMessages(sql, id, auth.userId);
            return Response.json({ ...choicesPayload(), character, messages, ...(aiError ? { aiError, requestId } : {}) }, { status: 201, headers: HEADERS });
          }

          const id = nonemptyText(input.characterId, "character_id", 100);
          const character = await ownedCharacter(sql, id, auth.userId);
          const expectedVersion = Number(input.expectedVersion);
          if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(character.version))
            throw new Error("stale_character_version");

          if (input.action === "saveDraft") {
            return Response.json({ character, messages: await readMessages(sql, id, auth.userId) }, { headers: HEADERS });
          }
          if (input.action === "updateField") {
            const snapshot = updateField(character.snapshot, String(input.field ?? ""), input.value);
            const updated = await saveSnapshot({ sql, character, userId: auth.userId, snapshot, reason: "nexo_creation_field_saved" });
            return Response.json({ character: updated, ...choicesPayload() }, { headers: HEADERS });
          }
          if (input.action === "confirm") {
            const missing = requiredFields(character.snapshot.fields);
            if (missing.length) return Response.json({ error: "character_incomplete", missing }, { status: 422, headers: HEADERS });
            if (!character.snapshot.learnedCapabilities.length) return Response.json({ error: "canonical_initial_capability_missing" }, { status: 422, headers: HEADERS });
            const snapshot = { ...character.snapshot, creationStatus: "complete" as const, confirmedAt: new Date().toISOString() };
            const updated = await saveSnapshot({ sql, character, userId: auth.userId, snapshot, reason: "nexo_character_confirmed" });
            return Response.json({ character: updated, ...choicesPayload() }, { headers: HEADERS });
          }
          if (input.action === "message" || input.action === "retryAssistant") {
            const message = input.action === "retryAssistant"
              ? [...await readMessages(sql, id, auth.userId)].reverse().find((item) => item.role === "user")?.content
              : nonemptyText(input.message, "message", 4_000);
            if (!message) throw new Error("no_message_to_retry");
            const historyBefore = await readMessages(sql, id, auth.userId);
            if (input.action === "message") await persistMessage(sql, id, auth.userId, "user", message);
            let conversation: Awaited<ReturnType<typeof respondToConversation>>;
            try {
              const conversationHistory = input.action === "retryAssistant" && historyBefore.at(-1)?.role === "user"
                ? historyBefore.slice(0, -1)
                : historyBefore;
              conversation = await respondToConversation({ requestId, userMessage: message, history: conversationHistory, snapshot: character.snapshot });
            } catch (error) {
              const outputRejected = error instanceof Error && ["generation_incomplete", "beginner_response_too_long"].includes(error.message);
              const providerMessage = outputRejected
                ? "generation_incomplete"
                : providerFailureMessage(error, requestId);
              console.warn("[nexo-character-creation] provider failed", { requestId, error: providerMessage });
              return Response.json({ error: outputRejected ? "generation_incomplete" : "provider_unavailable", detail: providerMessage, requestId, messagePersisted: input.action === "message" }, { status: 503, headers: HEADERS });
            }
            await persistMessage(sql, id, auth.userId, "assistant", citedAssistantMessage(conversation.reply, conversation.evidence));
            return Response.json({ character, messages: await readMessages(sql, id, auth.userId), ...choicesPayload() }, { headers: HEADERS });
          }
          throw new Error("invalid_action");
        } catch (error) {
          return errorResponse(error);
        } finally {
          sql?.close();
        }
      },
    },
  },
});
