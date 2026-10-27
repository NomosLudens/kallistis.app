import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { classifyProviderError, providerFailureMessage } from "@/lib/openrouter.server";
import { requireUser } from "@/lib/require-user.server";
import { distributedChatRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { reviewerForNewCharacter } from "@/server/characters/authorization";
import {
  CHARACTER_RULESET,
  mechanicalFingerprint,
  validateCharacterSnapshot,
  type CharacterSnapshot,
} from "@/server/characters/character-canon";
import { createPostgresCharacterRepository } from "@/server/characters/repository";
import {
  cancelNarrativeCreationProposals,
  confirmNarrativeCreationProposals,
  creationConversationState,
  hasConversationalCreationProgress,
  markCreationProviderUnavailable,
  stageNarrativeCreationProposals,
  setCreationTargetMarco,
  startConversationalCreation,
} from "@/server/characters/conversational-creation";
import { updateCharacterCreationSnapshot } from "@/server/characters/character-creation-persistence";
import { interpretNarrativeCreationTurn } from "@/server/characters/conversational-creation-ai";
import {
  creationConversationMemoryCsv,
  emptyCreationConversationMemory,
  readCreationConversationMemory,
  saveCreationConversationMemory,
  searchCreationBook,
  updateCreationConversationMemory,
  type CreationBookSource,
  type CreationConversationMemory,
} from "@/server/characters/conversational-creation-knowledge";
import { activeMarco } from "@/server/characters/character-canon";
import {
  buildConversationalProgressionSnapshot,
  conversationalProgressionState,
  selectConversationalProgressionChoice,
} from "@/server/characters/conversational-progression";

const headers = { "Cache-Control": "no-store" };
type DiagnosticStage =
  | "csrf"
  | "auth"
  | "database_connection"
  | "character_lookup"
  | "book_retrieval"
  | "primary_generation"
  | "support_evaluation"
  | "persistence"
  | "request_validation";
type Sql = NonNullable<ReturnType<typeof db>>;
type Message = { id?: string; role: "user" | "assistant"; content: string; created_at?: string };
type CurrentCharacter = {
  id: string;
  owner_user_id: string;
  status: string;
  version: number;
  snapshot: CharacterSnapshot;
};

function db() {
  const url = getRuntimeDatabaseUrl();
  return url ? createBunPostgresExecutor(url) : null;
}

async function readBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 20_000) throw new Error("body_too_large");
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function responseError(
  error: unknown,
  requestId: string,
  stage: DiagnosticStage = "persistence",
  durationMs?: number,
) {
  const cause = error instanceof Error ? error : new Error("unknown_error");
  const code = cause.message;
  const knownCode = /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
  const rawDatabaseCode = (cause as Error & { code?: unknown }).code;
  const databaseCode =
    typeof rawDatabaseCode === "string" && /^[0-9A-Z]{5}$/.test(rawDatabaseCode)
      ? rawDatabaseCode
      : null;
  console.error("[character-creation] request failed", {
    requestId,
    stage,
    ...(durationMs === undefined ? {} : { durationMs }),
    name: cause.name,
    errorClass: databaseCode ? "database_error" : knownCode ? "application_error" : "unknown_error",
    code: databaseCode ?? knownCode,
  });
  const status =
    code === "character_not_found" || code === "character_not_owned"
      ? 404
      : code === "conversational_creation_not_initialized"
        ? 409
        : code === "stale_character_version" ||
            code === "character_not_editable" ||
            code === "creation_already_complete" ||
            code === "no_pending_proposals" ||
            code === "invalid_progression_transition" ||
            code === "progression_gain_missing"
          ? 409
          : code === "retry_not_available"
            ? 409
            : code === "empty_message" || code === "invalid_request"
              ? 400
              : code === "body_too_large"
                ? 413
                : code === "character_incomplete" ||
                    code === "invalid_proposal" ||
                    code.startsWith("progression_patch_invalid:")
                  ? 422
                  : [
                        "database_connection",
                        "character_lookup",
                        "book_retrieval",
                        "persistence",
                      ].includes(stage)
                    ? 503
                    : 500;
  if (code === "generation_incomplete") {
    return Response.json({ error: code, requestId, stage }, { status: 503, headers });
  }
  return Response.json(
    {
      error:
        status === 500 || status === 503
          ? "character_creation_unavailable"
          : code === "character_not_owned"
            ? "character_not_found"
            : code,
      requestId,
      stage,
    },
    { status, headers },
  );
}

function csrf(request: Request) {
  return isSameOriginRequest(
    request,
    process.env.KALLISTIS_PUBLIC_ORIGIN || "https://kallistis.app",
  );
}

async function withDb<T>(fn: (sql: Sql) => Promise<T>, requestId?: string, startedAt?: number) {
  const sql = db();
  if (!sql) {
    if (requestId)
      console.error("[character-creation] request failed", {
        requestId,
        stage: "database_connection",
        durationMs: startedAt === undefined ? null : Date.now() - startedAt,
        name: "DatabaseUnavailable",
        errorClass: "database_unavailable",
        code: null,
      });
    return Response.json(
      {
        error: "database_unavailable",
        ...(requestId ? { requestId, stage: "database_connection" } : {}),
      },
      { status: 503, headers },
    );
  }
  try {
    return await fn(sql);
  } finally {
    sql.close();
  }
}

function requireTransaction(sql: Sql) {
  if (!sql.transaction) throw new Error("database_transactions_required");
  return sql.transaction.bind(sql);
}

async function saveMessage(
  sql: Sql,
  characterId: string,
  userId: string,
  role: "user" | "assistant",
  content: string,
) {
  await sql.query(
    "INSERT INTO public.character_creation_messages (character_id,user_id,role,content,created_at) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(created_at),transaction_timestamp()-interval '1 microsecond')+interval '1 microsecond' FROM public.character_creation_messages WHERE character_id=$1))",
    [characterId, userId, role, content.slice(0, 12000)],
  );
}

export async function readOwnedCharacter(sql: Sql, id: string, userId: string) {
  const ownership = await sql.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM public.characters WHERE id=$1 LIMIT 1",
    [id],
  );
  if (!ownership[0]) throw new Error("character_not_found");
  if (ownership[0].owner_user_id !== userId) throw new Error("character_not_owned");
  const rows = await sql.query<CurrentCharacter>(
    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 LIMIT 1",
    [id, userId],
  );
  const character = rows[0];
  if (!character) throw new Error("character_not_found");
  if (!hasConversationalCreationProgress(character.snapshot))
    throw new Error("conversational_creation_not_initialized");
  return character;
}

async function readMessages(sql: Sql, id: string, userId: string) {
  return sql.query<Message>(
    "SELECT m.id,m.role,m.content,m.created_at FROM public.character_creation_messages m JOIN public.characters c ON c.id=m.character_id WHERE m.character_id=$1 AND c.owner_user_id=$2 ORDER BY m.created_at ASC,m.id ASC",
    [id, userId],
  );
}

export function historyBeforeCreationRetry(messages: Message[]) {
  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") lastUserIndex = index;
  }
  return lastUserIndex < 0 ? [] : messages.slice(0, lastUserIndex);
}

async function writeVersion(input: {
  tx: Sql;
  id: string;
  userId: string;
  expectedVersion: number;
  status: string;
  snapshot: CharacterSnapshot;
  reason: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const nextVersion = input.expectedVersion + 1;
  await updateCharacterCreationSnapshot({
    tx: input.tx,
    id: input.id,
    userId: input.userId,
    expectedVersion: input.expectedVersion,
    name: String(input.snapshot.nome ?? ""),
    snapshot: input.snapshot,
    mechanicalFingerprint: mechanicalFingerprint(input.snapshot),
  });
  await input.tx.query(
    "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,$2,$3::jsonb,$4,$5)",
    [input.id, nextVersion, input.snapshot, input.reason, input.userId],
  );
  await input.tx.query(
    "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
    [input.id, input.userId, input.eventType, input.payload, input.expectedVersion, nextVersion],
  );
  return { id: input.id, status: input.status, version: nextVersion, snapshot: input.snapshot };
}

function providerFailure(
  error: unknown,
  requestId: string,
  stage: "primary_generation" | "support_evaluation",
  durationMs: number,
) {
  const diagnostic = classifyProviderError(error);
  console.warn("[character-creation] narrative provider unavailable", {
    requestId,
    stage,
    durationMs,
    status: diagnostic.status,
    errorClass: diagnostic.errorClass,
    ...(diagnostic.errorParameter ? { errorParameter: diagnostic.errorParameter } : {}),
  });
  return `${providerFailureMessage(error, requestId)} Sua ficha e suas mensagens continuam salvas. Tente novamente quando o serviço voltar.`;
}

async function runNarrative(input: {
  requestId: string;
  snapshot: CharacterSnapshot;
  history: Message[];
  userMessage: string;
  memory: CreationConversationMemory;
  sources: CreationBookSource[];
  authenticatedUserId: string;
  characterId?: string;
  request: Request;
  onStage?: (stage: "primary_generation" | "support_evaluation") => void;
}) {
  const startedAt = Date.now();
  let stage: "primary_generation" | "support_evaluation" = "primary_generation";
  try {
    const result = await interpretNarrativeCreationTurn({
      requestId: input.requestId,
      snapshot: input.snapshot,
      history: input.history.map(({ role, content }) => ({ role, content })),
      userMessage: input.userMessage,
      memory: input.memory,
      sources: input.sources,
      authenticatedUserId: input.authenticatedUserId,
      characterId: input.characterId,
      signal: input.request.signal,
      onStage: (nextStage) => {
        stage = nextStage;
        input.onStage?.(nextStage);
      },
    });
    return { ...result, failed: false };
  } catch (error) {
    // Keep an interrupted provider turn as an explicit failure. Persist the
    // user's message and this diagnostic reply, never the truncated output.
    const interrupted = error instanceof Error && error.message === "generation_incomplete";
    return {
      snapshot: markCreationProviderUnavailable(input.snapshot),
      reply: interrupted
        ? `A IA interrompeu a resposta. Nenhuma escolha foi registrada nesta tentativa. Referência: ${input.requestId}. Sua mensagem foi preservada para nova tentativa.`
        : providerFailure(error, input.requestId, stage, Date.now() - startedAt),
      intent: "clarification" as const,
      pending: [],
      effects: [],
      sources: input.sources,
      memoryUpdates: [],
      answerSupport: { status: "UNVERIFIED" as const, claims: [] },
      providerUnavailable: true,
      failed: true,
    };
  }
}

export const Route = createFileRoute("/api/character-creation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestId = randomUUID();
        const requestStartedAt = Date.now();
        let stage: DiagnosticStage = "auth";
        const addRequestId = (response: Response) => {
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set("X-Request-ID", requestId);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        };
        try {
          let auth: Awaited<ReturnType<typeof requireUser>>;
          try {
            auth = await requireUser(request);
          } catch (cause) {
            return addRequestId(
              responseError(cause, requestId, "auth", Date.now() - requestStartedAt),
            );
          }
          if ("error" in auth) {
            const authStage: DiagnosticStage =
              auth.error.status === 503 ? "database_connection" : "auth";
            console.warn("[character-creation] request rejected", {
              requestId,
              stage: authStage,
              status: auth.error.status,
              errorClass:
                auth.error.status === 401 ? "unauthenticated" : "identity_or_database_unavailable",
              durationMs: Date.now() - requestStartedAt,
            });
            return addRequestId(auth.error);
          }
          stage = "database_connection";
          const result = await withDb(
            async (sql) => {
              stage = "character_lookup";
              const id = new URL(request.url).searchParams.get("characterId");
              if (!id) {
                const drafts = await sql.query(
                  "SELECT id,name,status,version,updated_at FROM public.characters WHERE owner_user_id=$1 AND status IN ('draft','rejected','submitted','approved') AND snapshot ? 'serverCreationProgress' ORDER BY updated_at DESC",
                  [auth.userId],
                );
                return Response.json({ drafts }, { headers });
              }
              let character: CurrentCharacter;
              try {
                character = await readOwnedCharacter(sql, id, auth.userId);
              } catch (error) {
                if (
                  error instanceof Error &&
                  (error.message === "character_not_found" ||
                    error.message === "character_not_owned")
                )
                  return Response.json({ error: "character_not_found" }, { status: 404, headers });
                if (
                  error instanceof Error &&
                  error.message === "conversational_creation_not_initialized"
                )
                  return Response.json(
                    { error: "conversational_creation_not_initialized" },
                    { status: 409, headers },
                  );
                throw error;
              }
              stage = "persistence";
              const messages = await readMessages(sql, id, auth.userId);
              const memory = await readCreationConversationMemory(sql, id, auth.userId);
              if (new URL(request.url).searchParams.get("format") === "csv") {
                return new Response(creationConversationMemoryCsv(id, memory), {
                  headers: {
                    ...headers,
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="kallistis-memory.csv"',
                  },
                });
              }
              return Response.json(
                {
                  character,
                  messages,
                  memory,
                  conversation: creationConversationState(character.snapshot),
                  progression: await createPostgresCharacterRepository(sql).progressionList(
                    auth.userId,
                    id,
                  ),
                  progressionChoices: conversationalProgressionState(character.snapshot),
                },
                { headers },
              );
            },
            requestId,
            requestStartedAt,
          );
          return addRequestId(result);
        } catch (error) {
          return addRequestId(
            responseError(error, requestId, stage, Date.now() - requestStartedAt),
          );
        }
      },

      POST: async ({ request }) => {
        const requestId = randomUUID();
        const requestStartedAt = Date.now();
        let stage: DiagnosticStage = "csrf";
        const addRequestId = (response: Response) => {
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set("X-Request-ID", requestId);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        };
        if (!(await csrf(request))) {
          console.warn("[character-creation] request rejected", {
            requestId,
            stage,
            status: 403,
            errorClass: "csrf_rejected",
            durationMs: Date.now() - requestStartedAt,
          });
          return addRequestId(
            Response.json({ error: "csrf_rejected", requestId, stage }, { status: 403, headers }),
          );
        }
        stage = "auth";
        let auth: Awaited<ReturnType<typeof requireUser>>;
        try {
          auth = await requireUser(request);
        } catch (cause) {
          return addRequestId(
            responseError(cause, requestId, "auth", Date.now() - requestStartedAt),
          );
        }
        if ("error" in auth) {
          const authStage: DiagnosticStage =
            auth.error.status === 503 ? "database_connection" : "auth";
          console.warn("[character-creation] request rejected", {
            requestId,
            stage: authStage,
            status: auth.error.status,
            errorClass:
              auth.error.status === 401 ? "unauthenticated" : "identity_or_database_unavailable",
            durationMs: Date.now() - requestStartedAt,
          });
          return addRequestId(auth.error);
        }
        try {
          stage = "request_validation";
          const input = await readBody(request);
          if (!input) throw new Error("invalid_request");
          if (["start", "turn", "retry", "progression_turn"].includes(String(input.action))) {
            const limited = await distributedChatRateLimit(request, auth.userId);
            if (limited) return addRequestId(limited);
          }
          stage = "database_connection";
          const result = await withDb(
            async (sql) => {
              const transaction = requireTransaction(sql);

              if (input.action === "start") {
                stage = "character_lookup";
                const firstMessage = String(input.message ?? "").trim();
                if (!firstMessage || firstMessage.length > 12000)
                  throw new Error("invalid_request");
                const targetMarco = Number(input.targetMarco ?? 1);
                if (!Number.isInteger(targetMarco) || targetMarco < 1 || targetMarco > 4)
                  throw new Error("invalid_request");
                const profile = await sql.query<{ display_name: string | null }>(
                  "SELECT display_name FROM public.profiles WHERE id=$1 LIMIT 1",
                  [auth.userId],
                );
                const started = startConversationalCreation(
                  String(profile[0]?.display_name ?? "Jogador"),
                  firstMessage,
                  targetMarco,
                );
                stage = "book_retrieval";
                const sources = await searchCreationBook(sql, firstMessage);
                const ai = await runNarrative({
                  requestId,
                  snapshot: started.snapshot,
                  history: [],
                  userMessage: firstMessage,
                  memory: emptyCreationConversationMemory(),
                  sources,
                  authenticatedUserId: auth.userId,
                  request,
                  onStage: (nextStage) => {
                    stage = nextStage;
                  },
                });
                const id = randomUUID();
                const reviewer = await reviewerForNewCharacter(sql, auth.userId);
                const now = new Date().toISOString();
                const memory = updateCreationConversationMemory({
                  previous: emptyCreationConversationMemory(),
                  snapshot: ai.snapshot,
                  userMessage: firstMessage,
                  assistantMessage: ai.reply,
                  intent: ai.intent,
                  sources: ai.sources,
                  answerSupport: ai.answerSupport,
                  memoryUpdates: ai.memoryUpdates,
                  evidenceMessages: [firstMessage],
                  characterVersion: 1,
                  updatedAt: now,
                });
                stage = "persistence";
                await transaction(async (tx) => {
                  await tx.query(
                    "INSERT INTO public.characters (id,owner_user_id,master_user_id,status,ruleset,name,player_name,snapshot,version,mechanical_fingerprint,created_at,updated_at) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7::jsonb,1,$8,$9,$9)",
                    [
                      id,
                      auth.userId,
                      reviewer,
                      CHARACTER_RULESET,
                      String(ai.snapshot.nome ?? ""),
                      String(ai.snapshot.jogador ?? "Jogador"),
                      ai.snapshot,
                      mechanicalFingerprint(ai.snapshot),
                      now,
                    ],
                  );
                  await tx.query(
                    "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,1,$2::jsonb,'conversation_start',$3)",
                    [id, ai.snapshot, auth.userId],
                  );
                  await tx.query(
                    "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,'character_conversation_started',$3::jsonb,NULL,1)",
                    [id, auth.userId, { providerUnavailable: ai.providerUnavailable }],
                  );
                  await saveMessage(tx as Sql, id, auth.userId, "user", firstMessage);
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", ai.reply);
                  await saveCreationConversationMemory({
                    sql: tx as Sql,
                    characterId: id,
                    ownerUserId: auth.userId,
                    memory,
                    lastMessageAt: now,
                  });
                });
                const character = { id, status: "draft", version: 1, snapshot: ai.snapshot };
                return Response.json(
                  {
                    character,
                    messages: [
                      { role: "user", content: firstMessage },
                      { role: "assistant", content: ai.reply },
                    ],
                    conversation: creationConversationState(ai.snapshot),
                    memory,
                  },
                  { status: 201, headers },
                );
              }

              if (input.action === "submit") {
                stage = "character_lookup";
                const id = String(input.characterId ?? "");
                const character = await createPostgresCharacterRepository(sql).get(auth.userId, id);
                if (!character || !character.snapshot.serverCreationProgress)
                  throw new Error("character_not_found");
                if (
                  (character.snapshot.serverCreationProgress as { status?: string }).status !==
                    "complete" ||
                  !validateCharacterSnapshot(character.snapshot, true).ok
                )
                  throw new Error("character_incomplete");
                const submitted = await createPostgresCharacterRepository(sql).transition(
                  auth.userId,
                  id,
                  "submit",
                );
                return Response.json({ character: submitted }, { headers });
              }

              const id = String(input.characterId ?? "");
              const expectedVersion = Number(input.expectedVersion);
              if (!id || !Number.isInteger(expectedVersion)) throw new Error("invalid_request");

              if (input.action === "progression_turn") {
                stage = "character_lookup";
                const current = await readOwnedCharacter(sql, id, auth.userId);
                if (Number(current.version) !== expectedVersion)
                  throw new Error("stale_character_version");
                if (current.status !== "approved") throw new Error("character_not_editable");
                const message = String(input.message ?? "").trim();
                if (!message || message.length > 12000) throw new Error("invalid_request");
                const history = await readMessages(sql, id, auth.userId);
                const priorMemory = await readCreationConversationMemory(sql, id, auth.userId);
                stage = "book_retrieval";
                const sources = await searchCreationBook(sql, message);
                const ai = await runNarrative({
                  requestId,
                  snapshot: current.snapshot,
                  history: [...history],
                  userMessage: message,
                  memory: priorMemory,
                  sources,
                  authenticatedUserId: auth.userId,
                  characterId: id,
                  request,
                  onStage: (nextStage) => {
                    stage = nextStage;
                  },
                });
                stage = "persistence";
                await transaction(async (tx) => {
                  const locked = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  if (
                    !locked[0] ||
                    Number(locked[0].version) !== expectedVersion ||
                    locked[0].status !== "approved"
                  )
                    throw new Error("stale_character_version");
                  await saveMessage(tx as Sql, id, auth.userId, "user", message);
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", ai.reply);
                  const memory = updateCreationConversationMemory({
                    previous: priorMemory,
                    snapshot: current.snapshot,
                    userMessage: message,
                    assistantMessage: ai.reply,
                    intent: ai.intent,
                    sources: ai.sources,
                    answerSupport: ai.answerSupport,
                    memoryUpdates: ai.memoryUpdates,
                    evidenceMessages: [
                      ...history.filter((item) => item.role === "user").map((item) => item.content),
                      message,
                    ],
                    characterVersion: expectedVersion,
                  });
                  await saveCreationConversationMemory({
                    sql: tx as Sql,
                    characterId: id,
                    ownerUserId: auth.userId,
                    memory,
                  });
                });
                const messages = await readMessages(sql, id, auth.userId);
                const memory = await readCreationConversationMemory(sql, id, auth.userId);
                return Response.json(
                  {
                    character: current,
                    messages,
                    memory,
                    conversation: creationConversationState(current.snapshot),
                    progression: await createPostgresCharacterRepository(sql).progressionList(
                      auth.userId,
                      id,
                    ),
                    progressionChoices: conversationalProgressionState(current.snapshot),
                  },
                  { headers },
                );
              }

              if (
                ["progression_request", "progression_start", "progression_apply"].includes(
                  String(input.action),
                )
              ) {
                stage = "character_lookup";
                const current = await readOwnedCharacter(sql, id, auth.userId);
                if (Number(current.version) !== expectedVersion)
                  throw new Error("stale_character_version");
                if (current.status !== "approved") throw new Error("character_not_editable");
                const targetMarco = Number(
                  (current.snapshot.serverCreationProgress as { targetMarco?: number })
                    .targetMarco ?? 1,
                );
                if (activeMarco(current.snapshot) >= 4) throw new Error("invalid_request");
                const action =
                  input.action === "progression_request"
                    ? "request"
                    : input.action === "progression_start"
                      ? "start"
                      : "apply";
                const repo = createPostgresCharacterRepository(sql);
                const candidate =
                  action === "apply"
                    ? buildConversationalProgressionSnapshot(current.snapshot)
                    : undefined;
                await repo.progression(auth.userId, id, action, expectedVersion, candidate);
                const character = await readOwnedCharacter(sql, id, auth.userId);
                const marco = activeMarco(current.snapshot) + 1;
                const reply =
                  action === "request"
                    ? `Solicitação do Marco ${marco} registrada. Agora aguardamos a autorização do Mestre.`
                    : action === "start"
                      ? `Marco ${marco} autorizado e iniciado. Vou orientar cada ganho canônico antes da aplicação.`
                      : `Marco ${marco} aplicado e validado na ficha. ${marco < 4 ? `Você pode solicitar o Marco ${marco + 1} ao Mestre quando desejar.` : "O Marco 4 foi alcançado."}${marco === targetMarco ? " O Marco de destino foi alcançado." : ""}`;
                await saveMessage(
                  sql,
                  id,
                  auth.userId,
                  "user",
                  action === "request"
                    ? `Solicito o Marco ${marco}.`
                    : action === "start"
                      ? `Inicio o Marco ${marco} autorizado.`
                      : `Aplico o Marco ${marco} com as escolhas confirmadas.`,
                );
                await saveMessage(sql, id, auth.userId, "assistant", reply);
                const progression = await repo.progressionList(auth.userId, id);
                const messages = await readMessages(sql, id, auth.userId);
                const memory = await readCreationConversationMemory(sql, id, auth.userId);
                return Response.json(
                  {
                    character,
                    messages,
                    memory,
                    conversation: creationConversationState(character.snapshot),
                    progression,
                    progressionChoices: conversationalProgressionState(character.snapshot),
                  },
                  { headers },
                );
              }

              if (input.action === "progression_choice") {
                stage = "persistence";
                return await transaction(async (tx) => {
                  const rows = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  const current = rows[0];
                  if (!current?.snapshot?.serverCreationProgress)
                    throw new Error("character_not_found");
                  if (Number(current.version) !== expectedVersion)
                    throw new Error("stale_character_version");
                  if (current.status !== "approved") throw new Error("character_not_editable");
                  const active = (
                    await createPostgresCharacterRepository(tx as Sql).progressionList(
                      auth.userId,
                      id,
                    )
                  ).find(
                    (item) =>
                      ["authorized", "in_progress"].includes(String(item.status)) &&
                      Number(item.fromMarco) === activeMarco(current.snapshot),
                  );
                  if (!active) throw new Error("invalid_progression_transition");
                  const choiceId = String(input.choiceId ?? "");
                  const snapshot = selectConversationalProgressionChoice(
                    current.snapshot,
                    choiceId,
                    input.value,
                  );
                  const character = await writeVersion({
                    tx: tx as Sql,
                    id,
                    userId: auth.userId,
                    expectedVersion,
                    status: current.status,
                    snapshot,
                    reason: "conversation_progression_choice",
                    eventType: "character_progression_choice_confirmed",
                    payload: { choiceId, toMarco: activeMarco(current.snapshot) + 1 },
                  });
                  const userMessage = `Confirmo ${choiceId}: ${JSON.stringify(input.value)}`;
                  const reply = `Registrei sua escolha de progressão para o Marco ${activeMarco(current.snapshot) + 1}. Ela será aplicada à ficha pelo mecanismo canônico quando todas as escolhas estiverem completas.`;
                  await saveMessage(tx as Sql, id, auth.userId, "user", userMessage);
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", reply);
                  const messages = await readMessages(tx as Sql, id, auth.userId);
                  const memory = await readCreationConversationMemory(tx as Sql, id, auth.userId);
                  return Response.json(
                    {
                      character,
                      messages,
                      memory,
                      conversation: creationConversationState(snapshot),
                      progression: await createPostgresCharacterRepository(
                        tx as Sql,
                      ).progressionList(auth.userId, id),
                      progressionChoices: conversationalProgressionState(snapshot),
                    },
                    { headers },
                  );
                });
              }

              if (input.action === "target_marco") {
                stage = "persistence";
                return await transaction(async (tx) => {
                  const rows = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  const current = rows[0];
                  if (!current?.snapshot?.serverCreationProgress)
                    throw new Error("character_not_found");
                  if (Number(current.version) !== expectedVersion)
                    throw new Error("stale_character_version");
                  if (!["draft", "rejected"].includes(current.status))
                    throw new Error("character_not_editable");
                  const targetMarco = Number(input.targetMarco);
                  const snapshot = setCreationTargetMarco(current.snapshot, targetMarco);
                  const character = await writeVersion({
                    tx: tx as Sql,
                    id,
                    userId: auth.userId,
                    expectedVersion,
                    status: current.status,
                    snapshot,
                    reason: "conversation_target_marco",
                    eventType: "character_target_marco_selected",
                    payload: { targetMarco },
                  });
                  const reply = `Destino definido: Marco ${targetMarco}. Primeiro concluiremos a ficha do Marco 1. Cada Marco seguinte exigirá a autorização do Mestre antes da progressão canônica.`;
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", reply);
                  const messages = await readMessages(tx as Sql, id, auth.userId);
                  const memory = await readCreationConversationMemory(tx as Sql, id, auth.userId);
                  return Response.json(
                    {
                      character,
                      messages,
                      conversation: creationConversationState(snapshot),
                      memory,
                    },
                    { headers },
                  );
                });
              }

              if (input.action === "choose") {
                stage = "persistence";
                return await transaction(async (tx) => {
                  const rows = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  const current = rows[0];
                  if (!current?.snapshot?.serverCreationProgress)
                    throw new Error("character_not_found");
                  if (Number(current.version) !== expectedVersion)
                    throw new Error("stale_character_version");
                  if (!["draft", "rejected"].includes(current.status))
                    throw new Error("character_not_editable");
                  const next = creationConversationState(current.snapshot).nextOptions;
                  if (
                    !next ||
                    next.path !== input.path ||
                    creationConversationState(current.snapshot).pending.length
                  )
                    throw new Error("invalid_proposal");
                  const value = input.value;
                  const sourceText = `Escolho ${next.label}: ${JSON.stringify(value)}`;
                  const staged = stageNarrativeCreationProposals(
                    current.snapshot,
                    [{ path: next.path, value, sourceText }],
                    [sourceText],
                  );
                  if (!staged.ok) throw new Error("invalid_proposal");
                  const reply = `Proposta canônica: ${next.label}: ${JSON.stringify(value)}. Confira e confirme para registrar.`;
                  const character = await writeVersion({
                    tx: tx as Sql,
                    id,
                    userId: auth.userId,
                    expectedVersion,
                    status: current.status,
                    snapshot: staged.snapshot,
                    reason: "conversation_choice",
                    eventType: "character_choice_proposed",
                    payload: { path: next.path },
                  });
                  await saveMessage(tx as Sql, id, auth.userId, "user", sourceText);
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", reply);
                  const priorMemory = await readCreationConversationMemory(
                    tx as Sql,
                    id,
                    auth.userId,
                  );
                  const memory = updateCreationConversationMemory({
                    previous: priorMemory,
                    snapshot: character.snapshot,
                    userMessage: sourceText,
                    assistantMessage: reply,
                    intent: "proposal",
                    sources: [],
                    evidenceMessages: [sourceText],
                    characterVersion: expectedVersion + 1,
                  });
                  await saveCreationConversationMemory({
                    sql: tx as Sql,
                    characterId: id,
                    ownerUserId: auth.userId,
                    memory,
                  });
                  const messages = await readMessages(tx as Sql, id, auth.userId);
                  return Response.json(
                    {
                      character,
                      messages,
                      conversation: creationConversationState(character.snapshot),
                      memory,
                    },
                    { headers },
                  );
                });
              }

              if (input.action === "turn" || input.action === "retry") {
                const message = String(input.message ?? "").trim();
                stage = "character_lookup";
                const before = await readOwnedCharacter(sql, id, auth.userId);
                if (Number(before.version) !== expectedVersion)
                  throw new Error("stale_character_version");
                if (!["draft", "rejected"].includes(before.status))
                  throw new Error("character_not_editable");
                const history = await readMessages(sql, id, auth.userId);
                const priorMemory = await readCreationConversationMemory(sql, id, auth.userId);
                const isRetry = input.action === "retry";
                if (isRetry) {
                  if (
                    !(before.snapshot.serverCreationProgress as { providerUnavailable?: boolean })
                      .providerUnavailable
                  )
                    throw new Error("retry_not_available");
                  if (message) throw new Error("invalid_request");
                } else if (!message || message.length > 12000) throw new Error("invalid_request");
                const lastUserMessage = isRetry
                  ? [...history].reverse().find((item) => item.role === "user")?.content
                  : message;
                if (!lastUserMessage) throw new Error("invalid_request");
                stage = "book_retrieval";
                const sources = await searchCreationBook(sql, lastUserMessage);
                let aiHistory: Message[] = [...history];
                if (isRetry) aiHistory = historyBeforeCreationRetry(aiHistory);
                const ai = await runNarrative({
                  requestId,
                  snapshot: before.snapshot,
                  history: aiHistory,
                  userMessage: lastUserMessage,
                  memory: priorMemory,
                  sources,
                  authenticatedUserId: auth.userId,
                  characterId: id,
                  request,
                  onStage: (nextStage) => {
                    stage = nextStage;
                  },
                });
                stage = "persistence";
                return await transaction(async (tx) => {
                  const locked = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  const current = locked[0];
                  if (!current || !current.snapshot?.serverCreationProgress)
                    throw new Error("character_not_found");
                  if (Number(current.version) !== expectedVersion)
                    throw new Error("stale_character_version");
                  if (!["draft", "rejected"].includes(current.status))
                    throw new Error("character_not_editable");
                  const nextVersion = expectedVersion + 1;
                  await updateCharacterCreationSnapshot({
                    tx: tx as Sql,
                    id,
                    userId: auth.userId,
                    expectedVersion,
                    name: String(ai.snapshot.nome ?? ""),
                    snapshot: ai.snapshot,
                    mechanicalFingerprint: mechanicalFingerprint(ai.snapshot),
                  });
                  await tx.query(
                    "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,$2,$3::jsonb,$4,$5)",
                    [
                      id,
                      nextVersion,
                      ai.snapshot,
                      isRetry ? "conversation_retry" : "conversation_turn",
                      auth.userId,
                    ],
                  );
                  await tx.query(
                    "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,$3,$4::jsonb,$5,$6)",
                    [
                      id,
                      auth.userId,
                      isRetry ? "character_conversation_retry" : "character_conversation_turn",
                      { providerUnavailable: ai.providerUnavailable },
                      expectedVersion,
                      nextVersion,
                    ],
                  );
                  if (!isRetry) await saveMessage(tx as Sql, id, auth.userId, "user", message);
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", ai.reply);
                  const memory = updateCreationConversationMemory({
                    previous: priorMemory,
                    snapshot: ai.snapshot,
                    userMessage: isRetry ? "" : message,
                    assistantMessage: ai.reply,
                    intent: ai.intent,
                    sources: ai.sources,
                    answerSupport: ai.answerSupport,
                    memoryUpdates: ai.memoryUpdates,
                    evidenceMessages: [
                      ...aiHistory
                        .filter((item) => item.role === "user")
                        .map((item) => item.content),
                      ...(isRetry ? [] : [message]),
                    ],
                    characterVersion: expectedVersion + 1,
                  });
                  await saveCreationConversationMemory({
                    sql: tx as Sql,
                    characterId: id,
                    ownerUserId: auth.userId,
                    memory,
                    lastMessageAt: new Date().toISOString(),
                  });
                  const character = {
                    id,
                    status: current.status,
                    version: nextVersion,
                    snapshot: ai.snapshot,
                  };
                  const messages = isRetry
                    ? [...history, { role: "assistant" as const, content: ai.reply }]
                    : [
                        ...history,
                        { role: "user" as const, content: message },
                        { role: "assistant" as const, content: ai.reply },
                      ];
                  return Response.json(
                    {
                      character,
                      messages,
                      conversation: creationConversationState(ai.snapshot),
                      memory,
                      providerUnavailable: ai.providerUnavailable,
                    },
                    { headers },
                  );
                });
              }

              if (input.action === "confirm" || input.action === "cancel") {
                stage = "persistence";
                return await transaction(async (tx) => {
                  const rows = await tx.query<CurrentCharacter>(
                    "SELECT id,owner_user_id,status,version,snapshot FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE",
                    [id, auth.userId],
                  );
                  const current = rows[0];
                  if (!current || !current.snapshot?.serverCreationProgress)
                    throw new Error("character_not_found");
                  if (Number(current.version) !== expectedVersion)
                    throw new Error("stale_character_version");
                  if (!["draft", "rejected"].includes(current.status))
                    throw new Error("character_not_editable");
                  const result =
                    input.action === "confirm"
                      ? confirmNarrativeCreationProposals(current.snapshot)
                      : {
                          ok: true as const,
                          snapshot: cancelNarrativeCreationProposals(current.snapshot),
                          saved: [],
                          completed: false,
                        };
                  if (!result.ok) throw new Error("invalid_proposal");
                  const saved = "saved" in result ? result.saved : [];
                  const reply =
                    input.action === "confirm"
                      ? `Salvo: ${saved.map((item) => `${item.label}: ${JSON.stringify(item.value)}`).join("; ")}. ${result.completed ? "A ficha passou pela validação canônica e está pronta para envio ao Mestre." : "As demais escolhas continuam pendentes."}`
                      : "Cancelei as propostas pendentes. Nenhuma delas foi gravada como escolha mecânica.";
                  const character = await writeVersion({
                    tx: tx as Sql,
                    id,
                    userId: auth.userId,
                    expectedVersion,
                    status: current.status,
                    snapshot: result.snapshot,
                    reason:
                      input.action === "confirm" ? "conversation_confirm" : "conversation_cancel",
                    eventType:
                      input.action === "confirm"
                        ? "character_proposals_confirmed"
                        : "character_proposals_cancelled",
                    payload: {
                      paths: saved.map((item) => item.path),
                      completed: "completed" in result && result.completed,
                    },
                  });
                  await saveMessage(tx as Sql, id, auth.userId, "assistant", reply);
                  const priorMemory = await readCreationConversationMemory(
                    tx as Sql,
                    id,
                    auth.userId,
                  );
                  const memory = updateCreationConversationMemory({
                    previous: priorMemory,
                    snapshot: character.snapshot,
                    userMessage: "",
                    assistantMessage: reply,
                    intent: "summary",
                    sources: [],
                    characterVersion: expectedVersion + 1,
                  });
                  await saveCreationConversationMemory({
                    sql: tx as Sql,
                    characterId: id,
                    ownerUserId: auth.userId,
                    memory,
                  });
                  return Response.json(
                    {
                      character,
                      reply,
                      completed: "completed" in result && result.completed,
                      conversation: creationConversationState(result.snapshot),
                      memory,
                    },
                    { headers },
                  );
                });
              }

              throw new Error("invalid_request");
            },
            requestId,
            requestStartedAt,
          );
          return addRequestId(result);
        } catch (cause) {
          return addRequestId(
            responseError(cause, requestId, stage, Date.now() - requestStartedAt),
          );
        }
      },
    },
  },
});
