import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/runtime-boundary");
  vi.doUnmock("@/lib/background-task");
  vi.doUnmock("@/lib/contexto-vivo.server");
  vi.doUnmock("@/lib/presenca-regime.server");
  vi.doUnmock("@/lib/contexto-externo.server");
  vi.doUnmock("@/lib/kline-ledger.server");
  vi.resetModules();
  vi.restoreAllMocks();
});

async function setupRuntime(
  boundary: { blocked: boolean; message?: string } = { blocked: false },
  options: {
    contextRows?: Array<{ titulo: string; conteudo: string; tipo?: string }>;
    contextError?: boolean;
  } = {},
) {
  const runInBackground = vi.fn();
  const createBoundaryHandoffCandidate = vi.fn(async () => undefined);
  vi.doMock("@/lib/background-task", () => ({ runInBackground }));
  vi.doMock("@/lib/kline-ledger.server", () => ({ createBoundaryHandoffCandidate }));
  vi.doMock("@/lib/chat-request-contract", () => ({
    attachmentSizeError: vi.fn(() => null),
    MAX_CHAT_HISTORY_MESSAGES: 80,
    MAX_CHAT_HISTORY_CHARS: 60_000,
  }));
  vi.doMock("@/lib/runtime-boundary", () => ({
    resolveRuntimeBoundary: vi.fn(() =>
      boundary.blocked
        ? {
            blocked: true,
            message: boundary.message ?? "boundary",
            targetApp: "agenda",
            reason: "scope",
          }
        : { blocked: false },
    ),
  }));
  const lerContextoVivo = vi.fn(async () => ({}));
  vi.doMock("@/lib/contexto-vivo.server", () => ({
    lerContextoVivo,
    renderContextoVivoBlock: vi.fn(() => ""),
  }));
  vi.doMock("@/lib/presenca-regime.server", () => ({
    lerPresencaRegime: vi.fn(async () => null),
    renderPresencaRegimeBlock: vi.fn(() => ""),
  }));
  const lerContextosAtivos = vi.fn(async () => {
    if (options.contextError) throw new Error("confirmed_identity_unavailable");
    return options.contextRows ?? [];
  });
  vi.doMock("@/lib/contexto-externo.server", () => ({
    lerContextosAtivos,
    renderConfirmedIdentityBlock: vi.fn((rows: Array<{ tipo?: string; conteudo: string }>) =>
      rows
        .filter((row) => (row.tipo ?? "identidade") === "identidade")
        .map((row) => row.conteudo)
        .join("\n"),
    ),
    renderRelationalMemoryBlock: vi.fn((rows: Array<{ tipo?: string; conteudo: string }>) =>
      rows
        .filter((row) => row.tipo === "memoria_relacional")
        .map((row) => row.conteudo)
        .join("\n"),
    ),
  }));
  const mod = await import("./kallistis-chat-runtime");
  return {
    ...mod,
    runInBackground,
    createBoundaryHandoffCandidate,
    lerContextoVivo,
    lerContextosAtivos,
  };
}

function userMessage() {
  return {
    id: "user-message",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "oi" }],
  };
}

function inspectRuntime() {
  const calls: string[] = [];
  const runtime = {
    chat: {
      getThreadById: vi.fn(async (userId: string, threadId: string) => {
        calls.push("chat_threads");
        return {
          id: threadId,
          userId,
          facet: "kallistis",
          surface: "kallistis",
          title: null,
          createdAt: "",
          lastSedimentadoAt: null,
        };
      }),
      insertMessage: vi.fn(),
      listThreadMessages: vi.fn(),
      updateThreadSedimentationCursor: vi.fn(),
    },
    memory: {
      listCandidates: vi.fn(),
      listMemories: vi.fn(async () => []),
      listSediments: vi.fn(async () => []),
    },
    sedimentation: {
      insertSediment: vi.fn(),
      getSediment: vi.fn(),
      discardSediment: vi.fn(),
      approveMemoryCandidate: vi.fn(),
      confirmSediment: vi.fn(),
      promoteSedimentBatch: vi.fn(),
    },
    close: vi.fn(),
    databaseUrl: "",
  };
  return { runtime: runtime as never, calls };
}

function prepareSupabase(input: { upsertError?: unknown; includeCurrent?: boolean } = {}) {
  const upsert = vi.fn(async () => {
    if (input.upsertError) throw input.upsertError;
  });
  const rows = [
    ...(input.includeCurrent === false
      ? []
      : [{ id: "user-message", role: "user", content: "oi" }]),
    { id: "assistant-old", role: "assistant", content: "olá" },
  ];
  const runtime = {
    chat: {
      getThreadById: vi.fn(async (userId: string, threadId: string) => ({
        id: threadId,
        userId,
        facet: "kallistis",
        surface: "kallistis",
        title: null,
        createdAt: "",
        lastSedimentadoAt: null,
        campaignId: null,
        mesaId: null,
      })),
      insertMessage: upsert,
      listThreadMessages: vi.fn(async () => rows),
      updateThreadSedimentationCursor: vi.fn(),
    },
    memory: {
      listCandidates: vi.fn(),
      listMemories: vi.fn(async () => []),
      listSediments: vi.fn(async () => []),
    },
    sedimentation: {
      insertSediment: vi.fn(),
      getSediment: vi.fn(),
      discardSediment: vi.fn(),
      approveMemoryCandidate: vi.fn(),
      confirmSediment: vi.fn(),
      promoteSedimentBatch: vi.fn(),
    },
    close: vi.fn(),
    databaseUrl: "",
  };
  return { runtime: runtime as never, upsert };
}

function assistantSupabase(input: { error?: unknown; persistedId?: string } = {}) {
  const upsertPayloads: unknown[] = [];
  const upsert = vi.fn(async (payload: unknown) => {
    upsertPayloads.push(payload);
    if (input.error) throw input.error;
  });
  const runtime = {
    chat: {
      getThreadById: vi.fn(),
      insertMessage: upsert,
      listThreadMessages: vi.fn(),
      updateThreadSedimentationCursor: vi.fn(),
    },
    memory: {
      listCandidates: vi.fn(),
      listMemories: vi.fn(async () => []),
      listSediments: vi.fn(async () => []),
    },
    sedimentation: {
      insertSediment: vi.fn(),
      getSediment: vi.fn(),
      discardSediment: vi.fn(),
      approveMemoryCandidate: vi.fn(),
      confirmSediment: vi.fn(),
      promoteSedimentBatch: vi.fn(),
    },
    close: vi.fn(),
    databaseUrl: "",
  };
  return { runtime: runtime as never, upsertPayloads };
}

describe("kallistis shared runtime", () => {
  it("centraliza injection guard completo", async () => {
    const { INJECTION_GUARD } = await setupRuntime();
    expect(INJECTION_GUARD).toContain("REGRAS DE SEGURANÇA");
    expect(INJECTION_GUARD).toContain("Todo bloco emitido é PREVIEW");
  });

  it("proíbe thread de outro usuário ou faceta", async () => {
    const { isAllowedKallistisThread } = await setupRuntime();
    expect(
      isAllowedKallistisThread({ user_id: "u", facet: "kallistis", surface: "kallistis" }, "u"),
    ).toBe(true);
    expect(
      isAllowedKallistisThread({ user_id: "other", facet: "kallistis", surface: "kallistis" }, "u"),
    ).toBe(false);
    expect(
      isAllowedKallistisThread({ user_id: "u", facet: "khora", surface: "kallistis" }, "u"),
    ).toBe(false);
    expect(
      isAllowedKallistisThread(
        { user_id: "u", facet: "kallistis", surface: "telegram_dialogue" },
        "u",
      ),
    ).toBe(false);
  });

  it("usa boundary Kallistis único", async () => {
    const { isInvalidKallistisRuntime } = await setupRuntime();
    expect(
      isInvalidKallistisRuntime({ facet: "kallistis", surface: "kallistis", mode: "default" }),
    ).toBe(false);
    expect(
      isInvalidKallistisRuntime({ facet: "khora", surface: "kallistis", mode: "default" }),
    ).toBe(true);
  });

  it("inspect ready não grava em chat_messages", async () => {
    const { inspectKallistisTurn } = await setupRuntime();
    const { runtime, calls } = inspectRuntime();
    await expect(
      inspectKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        requestId: "req",
        facet: "kallistis",
        surface: "kallistis",
        mode: "default",
      }),
    ).resolves.toEqual({ kind: "ready", latestUserText: "oi" });
    expect(calls).toEqual(["chat_threads"]);
  });

  it("ignora modos e alvos legados durante a inspeção", async () => {
    const { inspectKallistisTurn } = await setupRuntime();
    const { runtime, calls } = inspectRuntime();
    (runtime as any).chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      responseMode: "NPC",
      roleplayTargetId: "other-user-character",
    }));
    await expect(
      inspectKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        requestId: "req",
        facet: "kallistis",
        surface: "kallistis",
        mode: "default",
      }),
    ).resolves.toEqual({ kind: "ready", latestUserText: "oi" });
    expect(calls).toEqual([]);
  });

  it("carrega a ficha somente pela superfície privada de personagem", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      title: null,
      createdAt: "",
      activeCharacterId: "character-1",
      responseMode: "NPC",
      roleplayTargetId: "other-user-character",
    }));
    runtimeValue.characters = {
      get: vi.fn(async () => ({
        id: "character-1",
        ownerUserId: "user",
        masterUserId: "",
        status: "draft",
        ruleset: "",
        name: "Lira",
        playerName: "Tony",
        version: 1,
        snapshot: { nome: "Lira", povo: "Aelvari", trilhas: [], trilhaAtiva: 0 },
      })),
    };
    const system = await buildKallistisSystem(runtime, "user", "thread", "req");
    expect(system).toContain("**Nome:** Lira");
    expect(system).toContain("superficie=CHARACTER");
    expect(system).not.toContain("modo=NPC");
    expect(system).not.toContain("voz=NPC");
  });

  it("dá ao chat de criação a distribuição numérica canônica do Forge", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      campaignId: null,
      mesaId: null,
      activeCharacterId: null,
    }));
    runtimeValue.characters = { list: vi.fn(async () => []) };

    const system = await buildKallistisSystem(runtime, "user", "thread", "req");

    expect(system).toContain("atributosBase recebe exatamente os seis valores 3, 2, 2, 1, 1, 0");
    expect(system).toContain(
      "periciasBase recebe exatamente um valor 3, três valores 2, quatro valores 1 e sete valores 0 (3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0)",
    );
    expect(system).toContain("não envie id, marco, ganhos ou atributosGanhos");
  });

  it("boundary bloqueado não persiste mensagem", async () => {
    const { inspectKallistisTurn } = await setupRuntime({ blocked: true, message: "boundary" });
    const { runtime, calls } = inspectRuntime();
    await expect(
      inspectKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        requestId: "req",
        facet: "kallistis",
        surface: "kallistis",
        mode: "default",
      }),
    ).resolves.toEqual({ kind: "blocked", message: "boundary" });
    expect(calls).toEqual(["chat_threads"]);
  });

  it("prepare persiste mensagem humana, carrega histórico e monta saída", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime, upsert } = prepareSupabase();
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: userMessage(),
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "oi" },
      sourceChannel: "C01",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-message", role: "user", content: "oi" }),
    );
    expect(prepared.derivedFrom).toEqual(["assistant-old", "user-message"]);
    expect(prepared.modelMessages.length).toBeGreaterThan(0);
    expect(prepared.modelMessages).toContainEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("IDENTIDADE DO PRODUTO: KALLISTIS"),
      }),
    );
    expect(prepared.system).toContain("REGRAS DE SEGURANÇA");
  });

  it("propõe a origem contextual da técnica para confirmação sem trocar o Ofício principal", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    const snapshot = buildCharacterDraft("Jinjo", "Livres", "Curador");
    snapshot.heranca = "Múltiplos Caminhos";
    const character = {
      id: "character-current",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "Jinjo",
      playerName: "Jinjo",
      version: 3,
      snapshot,
    };
    const save = vi.fn();
    const createPreview = vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      id: "confirmation-1",
      status: "pending",
      operation: "character_creation_patch",
      operationId: "operation-1",
      createdAt: "",
      expiresAt: "later",
      confirmedAt: null,
      beforeBiography: null,
      nextBiography: null,
      payload: { patch: input.patch, preview: input.preview },
    }));
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: character.id,
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      {
        id: "assistant-old",
        role: "assistant",
        content: "Você escolheu Múltiplos Caminhos. De qual Ofício quer obter a técnica?",
      },
      { id: "user-message", role: "user", content: "Escolho Artífice" },
    ]);
    runtimeValue.characters = {
      get: vi.fn(async () => character),
      save,
    };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreationPatchPreview: createPreview,
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Escolho Artífice" }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "Escolho Artífice" },
      sourceChannel: "C01",
    });

    expect(save).not.toHaveBeenCalled();
    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        patch: { tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" } },
      }),
    );
    expect(prepared.directAssistantReply).toContain(
      "Técnica de Múltiplos Caminhos · Artífice · Preparação de Campo",
    );
    expect(prepared.directAssistantReply).toContain("Ofício principal atual foi preservado");
    expect((character.snapshot.trilhas as Array<{ oficio: string }>)[0]?.oficio).toBe("Curador");
  });

  it("pergunta qual campo a pessoa quis dizer quando Artífice chega sem contexto", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: "character-current",
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "Artífice." },
    ]);
    const character = {
      id: "character-current",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "Jinjo",
      playerName: "Jinjo",
      version: 3,
      snapshot: buildCharacterDraft("Jinjo", "Livres", "Curador"),
    };
    const createPreview = vi.fn();
    runtimeValue.characters = { get: vi.fn(async () => character), save: vi.fn() };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreationPatchPreview: createPreview,
    };
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Artífice." }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "Artífice." },
      sourceChannel: "C01",
    });
    expect(createPreview).not.toHaveBeenCalled();
    expect(prepared.directAssistantReply).toContain("Ofício principal");
    expect(prepared.directAssistantReply).toContain("origem da técnica");
    expect((character.snapshot.trilhas as Array<{ oficio: string }>)[0]?.oficio).toBe("Curador");
  });

  it("transforma Livre Curandeiro em um único preview de Povo e Ofício", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: "character-current",
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "Meu personagem é um Livre Curandeiro" },
    ]);
    const character = {
      id: "character-current",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "Jinjo",
      playerName: "Jinjo",
      version: 3,
      snapshot: buildCharacterDraft("Jinjo", "Aelvari", "Guardião"),
    };
    const save = vi.fn();
    const createPreview = vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      id: "confirmation-1",
      status: "pending",
      operation: "character_creation_patch",
      operationId: "operation-1",
      createdAt: "",
      expiresAt: "later",
      confirmedAt: null,
      beforeBiography: null,
      nextBiography: null,
      payload: { patch: input.patch, preview: input.preview },
    }));
    runtimeValue.characters = { get: vi.fn(async () => character), save };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreationPatchPreview: createPreview,
    };
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Meu personagem é um Livre Curandeiro" }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "Meu personagem é um Livre Curandeiro" },
      sourceChannel: "C01",
    });
    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        patch: { povo: "Livres", trilhas: [{ oficio: "Curador" }] },
      }),
    );
    expect(prepared.directAssistantReply).toContain("Povo · Livres");
    expect(prepared.directAssistantReply).toContain("Ofício principal · Curador");
    expect(save).not.toHaveBeenCalled();
    expect(character.snapshot.povo).toBe("Aelvari");
  });

  it("propõe a primeira escolha composta em conversa nova sem gravar personagem", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: null,
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "Meu personagem é um Livre Curandeiro" },
    ]);
    const create = vi.fn();
    const createPreview = vi.fn(async (input: Record<string, any>) => ({
      ...input,
      id: "create-confirmation-1",
      status: "pending",
      operation: "character_create",
      operationId: "create-operation-1",
      createdAt: "",
      expiresAt: "later",
      confirmedAt: null,
      characterId: null,
      expectedVersion: null,
      beforeBiography: null,
      nextBiography: null,
      payload: { ...input.payload, plannedCharacterId: input.plannedCharacterId },
    }));
    runtimeValue.characters = { list: vi.fn(async () => []), create };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreatePreview: createPreview,
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Meu personagem é um Livre Curandeiro" }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "Meu personagem é um Livre Curandeiro" },
      sourceChannel: "C01",
    });

    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          rawUserText: "Meu personagem é um Livre Curandeiro",
          snapshot: expect.objectContaining({
            povo: "Livres",
            trilhas: [expect.objectContaining({ oficio: "Curador" })],
          }),
        }),
      }),
    );
    expect(prepared.directAssistantReply).toContain("Povo · Livres");
    expect(prepared.directAssistantReply).toContain("Ofício principal · Curador");
    expect(create).not.toHaveBeenCalled();
  });

  it("interpreta Ofício de origem explicitamente e mantém o Ofício principal no preview", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: "character-current",
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      {
        id: "user-message",
        role: "user",
        content: "Quero a técnica inicial de Múltiplos Caminhos do Ofício Artífice",
      },
    ]);
    const snapshot = buildCharacterDraft("", "Livres", "Curador");
    snapshot.heranca = "Múltiplos Caminhos";
    const character = {
      id: "character-current",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "",
      playerName: "",
      version: 2,
      snapshot,
    };
    const createPreview = vi.fn(async (input: Record<string, any>) => ({
      ...input,
      id: "confirmation-1",
      status: "pending",
      operation: "character_creation_patch",
      operationId: "operation-1",
      createdAt: "",
      expiresAt: "later",
      confirmedAt: null,
      beforeBiography: null,
      nextBiography: null,
      payload: { patch: input.patch, preview: input.preview },
    }));
    runtimeValue.characters = { get: vi.fn(async () => character), save: vi.fn() };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreationPatchPreview: createPreview,
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Quero a técnica inicial de Múltiplos Caminhos do Ofício Artífice",
          },
        ],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: {
        kind: "ready",
        latestUserText: "Quero a técnica inicial de Múltiplos Caminhos do Ofício Artífice",
      },
      sourceChannel: "C01",
    });

    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" } },
      }),
    );
    expect(prepared.directAssistantReply).toContain("Ofício principal continua Curador");
    expect((character.snapshot.trilhas as Array<{ oficio: string }>)[0]?.oficio).toBe("Curador");
  });

  it.each(["sim", "Sim, confirma essas escolhas.", "sim, finalizar"])(
    "confirma uma proposta pendente por resposta natural (%s) com optimistic locking",
    async (confirmation) => {
      const { prepareKallistisTurn } = await setupRuntime();
      const { buildCharacterDraft } = await import("../characters/chat-creation");
      const { runtime } = prepareSupabase();
      const runtimeValue = runtime as any;
      const character = {
        id: "character-current",
        ownerUserId: "user",
        masterUserId: "",
        status: "draft",
        ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
        name: "Jinjo",
        playerName: "Jinjo",
        version: 3,
        snapshot: buildCharacterDraft("Jinjo", "Livres", "Curador"),
      };
      const updated = {
        ...character,
        version: 4,
        snapshot: { ...character.snapshot, nome: "Jinjo" },
      };
      const pending = {
        id: "confirmation-1",
        operation: "character_creation_patch",
        characterId: character.id,
        expectedVersion: 3,
        payload: { patch: { nome: "Jinjo" }, preview: { nome: "Jinjo" } },
      };
      const save = vi.fn(async () => updated);
      const complete = vi.fn(async () => undefined);
      runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
        id: threadId,
        userId,
        facet: "kallistis",
        surface: "kallistis",
        title: null,
        createdAt: "",
        lastSedimentadoAt: null,
        scope: "character_creation",
        activeCharacterId: character.id,
      }));
      runtimeValue.chat.listThreadMessages = vi.fn(async () => [
        { id: "user-message", role: "user", content: confirmation },
        { id: "assistant-old", role: "assistant", content: "Entendi: Nome Jinjo. Confere?" },
      ]);
      runtimeValue.characters = { get: vi.fn(async () => character), save };
      runtimeValue.mutations = {
        listPendingMutations: vi.fn(async () => [pending]),
        claimPendingMutation: vi.fn(async () => pending),
        releasePendingMutation: vi.fn(),
        completePendingMutation: complete,
      };

      const prepared = await prepareKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: confirmation }],
        },
        assistantMessageId: "assistant-message",
        requestId: "req",
        inspection: { kind: "ready", latestUserText: confirmation },
        sourceChannel: "C01",
      });

      expect(save).toHaveBeenCalledWith(
        "user",
        character.id,
        expect.objectContaining({ nome: "Jinjo" }),
        expect.any(String),
        3,
      );
      expect(complete).toHaveBeenCalledWith("user", "confirmation-1");
      expect(prepared.directAssistantReply).toContain("versão 4");
    },
  );

  it("cria a personagem pendente somente após a confirmação explícita 'sim, finalizar'", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    const snapshot = buildCharacterDraft("Ayla QA", "Livres", "Curador");
    const proposal = {
      id: "create-confirmation-1",
      operation: "character_create",
      payload: {
        snapshot,
        ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
        plannedCharacterId: "character-created-1",
      },
    };
    const created = { id: "character-created-1", version: 1, status: "draft" };
    const create = vi.fn(async () => created);
    const complete = vi.fn(async () => undefined);
    const updatePlayerExperience = vi.fn(async () => true);
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: null,
    }));
    runtimeValue.chat.updatePlayerExperience = updatePlayerExperience;
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "sim, finalizar" },
      { id: "assistant-old", role: "assistant", content: "Revise a prévia e diga sim, finalizar." },
    ]);
    runtimeValue.characters = { list: vi.fn(async () => []), create };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => [proposal]),
      claimPendingMutation: vi.fn(async () => proposal),
      releasePendingMutation: vi.fn(),
      completePendingMutation: complete,
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "sim, finalizar" }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "sim, finalizar" },
      sourceChannel: "C01",
    });

    expect(create).toHaveBeenCalledWith(
      "user",
      "character-created-1",
      snapshot,
      "KALLISTIS_REGRAS_CANONICAS_2.0",
      expect.any(String),
    );
    expect(updatePlayerExperience).toHaveBeenCalledWith(
      "user",
      "thread",
      null,
      "character-created-1",
    );
    expect(complete).toHaveBeenCalledWith("user", "create-confirmation-1");
    expect(prepared.directAssistantReply).toContain("Rascunho criado e vinculado ao chat");
    expect(prepared.directAssistantReply).toContain("versão 1, status draft");
  });

  it("recusa confirmação quando a versão do personagem mudou", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    const character = {
      id: "character-current",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "Jinjo",
      playerName: "Jinjo",
      version: 4,
      snapshot: buildCharacterDraft("Jinjo", "Livres", "Curador"),
    };
    const pending = {
      id: "confirmation-1",
      operation: "character_creation_patch",
      characterId: character.id,
      expectedVersion: 3,
      payload: { patch: { nome: "Jinjo" }, preview: { nome: "Jinjo" } },
    };
    const save = vi.fn();
    const release = vi.fn(async () => undefined);
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      scope: "character_creation",
      activeCharacterId: character.id,
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "sim" },
      { id: "assistant-old", role: "assistant", content: "Entendi: Nome Jinjo. Confere?" },
    ]);
    runtimeValue.characters = { get: vi.fn(async () => character), save };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => [pending]),
      claimPendingMutation: vi.fn(async () => pending),
      releasePendingMutation: release,
      completePendingMutation: vi.fn(),
    };
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: { id: "user-message", role: "user", parts: [{ type: "text", text: "sim" }] },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "sim" },
      sourceChannel: "C01",
    });
    expect(release).toHaveBeenCalledWith("user", "confirmation-1");
    expect(save).not.toHaveBeenCalled();
    expect(prepared.directAssistantReply).toContain("A ficha mudou desde o preview");
  });

  it("resposta negativa cancela a proposta sem gravar dados", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    const cancel = vi.fn(async () => true);
    const save = vi.fn();
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      activeCharacterId: "character-current",
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "não" },
      { id: "assistant-old", role: "assistant", content: "Entendi: Povo Livres. Confere?" },
    ]);
    runtimeValue.characters = {
      get: vi.fn(async () => ({
        id: "character-current",
        ownerUserId: "user",
        masterUserId: "",
        status: "draft",
        ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
        name: "Jinjo",
        playerName: "Jinjo",
        version: 3,
        snapshot: { nome: "Jinjo", povo: "Livres", trilhas: [], trilhaAtiva: 0 },
      })),
      save,
    };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => [
        { id: "confirmation-1", operation: "character_creation_patch" },
      ]),
      cancelPendingMutation: cancel,
    };
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: { id: "user-message", role: "user", parts: [{ type: "text", text: "não" }] },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "não" },
      sourceChannel: "C01",
    });
    expect(cancel).toHaveBeenCalledWith("user", "confirmation-1");
    expect(save).not.toHaveBeenCalled();
    expect(prepared.directAssistantReply).toContain("Nenhuma alteração foi gravada");
  });

  it("explica ferramenta fora do catálogo do Ofício e não cria preview", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { buildCharacterDraft } = await import("../characters/chat-creation");
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    const text = "Ferramenta: Foco de magia.";
    const character = {
      id: "character-qa",
      ownerUserId: "user",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "QA Curador",
      playerName: "QA",
      version: 1,
      snapshot: buildCharacterDraft("QA Curador", "Livres", "Curador"),
    };
    const createPreview = vi.fn();
    const save = vi.fn();
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      activeCharacterId: character.id,
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: text },
    ]);
    runtimeValue.characters = {
      get: vi.fn(async () => character),
      list: vi.fn(async () => [character]),
      save,
    };
    runtimeValue.mutations = {
      listPendingMutations: vi.fn(async () => []),
      createCharacterCreationPatchPreview: createPreview,
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: { id: "user-message", role: "user", parts: [{ type: "text", text }] },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: text },
      sourceChannel: "C01",
    });

    expect(prepared.directAssistantReply).toContain("Foco de magia");
    expect(prepared.directAssistantReply).toContain("Kit de cura");
    expect(prepared.directAssistantReply).toContain("Não alterei a ficha");
    expect(createPreview).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("coloca o estado atual do Forge depois do histórico stale", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      responseMode: "ASSISTENTE",
      playerExperience: "CHARACTER_CREATION",
      activeCharacterId: "character-current",
      roleplayTargetId: null,
    }));
    runtimeValue.chat.listThreadMessages = vi.fn(async () => [
      { id: "user-message", role: "user", content: "Qual é o meu Povo agora?" },
      { id: "assistant-old", role: "assistant", content: "Seu Povo é Nomos." },
    ]);
    runtimeValue.characters = {
      get: vi.fn(async () => ({
        id: "character-current",
        ownerUserId: "user",
        masterUserId: "",
        status: "draft",
        ruleset: "",
        name: "Personagem",
        playerName: "Jogador",
        version: 7,
        snapshot: { nome: "Personagem", povo: "Kragor", trilhas: [], trilhaAtiva: 0 },
      })),
    };
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Qual é o meu Povo agora?" }],
      },
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "Qual é o meu Povo agora?" },
      sourceChannel: "C01",
    });
    const authoritativeMessage = prepared.modelMessages.at(-2);
    expect(authoritativeMessage).toMatchObject({ role: "system" });
    expect(prepared.derivedFrom).toContain("assistant-old");
    const staleAssistantIndex = prepared.modelMessages.findIndex(
      (message) => message.role === "assistant" && message.content === "Seu Povo é Nomos.",
    );
    const authoritativeStateIndex = prepared.modelMessages.findIndex(
      (message) =>
        message.role === "system" &&
        String(message.content).includes("ESTADO ATUAL AUTORITATIVO DO CHARACTER FORGE"),
    );
    expect(staleAssistantIndex).toBeGreaterThanOrEqual(0);
    expect(authoritativeStateIndex).toBeGreaterThan(staleAssistantIndex);
    expect(authoritativeMessage?.content).toContain("Povo atual persistido do Forge = Kragor");
    expect(authoritativeMessage?.content).toContain("Povo / Herança:** Kragor");
    expect(authoritativeMessage?.content).toContain(
      "histórico conversacional pode mencionar valores antigos",
    );
    expect(prepared.modelMessages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Qual é o meu Povo agora?" }],
    });
  });

  it("reforça identidade, superfície e papel em cada turno", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "master",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      campaignId: null,
      mesaId: null,
      responseMode: "PERSONAGEM",
      playerExperience: "CHARACTER_CREATION",
      roleplayTargetId: null,
    }));
    runtimeValue.identity = {
      getForUser: vi.fn(async () => ({
        profile: { id: "user", display_name: "Tony", pronouns: "ele/dele" },
        systemRole: "system_master",
        activeMembershipCount: 0,
        mesa: null,
      })),
    };

    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: userMessage(),
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "qual é o plano?" },
      sourceChannel: "C01",
    });
    const reinforcement = prepared.modelMessages.find(
      (message) => message.role === "system" && message.content.includes("SUPERFÍCIE=master"),
    );
    expect(reinforcement?.content).toContain("IDENTIDADE DO PRODUTO: KALLISTIS");
    expect(reinforcement?.content).toContain("SUPERFÍCIE=master");
    expect(reinforcement?.content).toContain("PAPEL=system_master");
    expect(reinforcement?.content).not.toContain("CREATION-ADMIN");
    expect(prepared.system).not.toContain("modo=PERSONAGEM");
    expect(prepared.system).not.toContain("experiencia_jogador=");
  });

  it("deriva o contexto externo da campanha persistida na thread", async () => {
    const { buildKallistisSystem, lerContextosAtivos } = await setupRuntime(
      { blocked: false },
      { contextRows: [{ titulo: "Campanha", conteudo: "MARCADOR", tipo: "identidade" }] },
    );
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      campaignId: "campaign-a",
      mesaId: "mesa-a",
    }));
    await buildKallistisSystem(runtime, "user", "thread", "req");
    expect(lerContextosAtivos).toHaveBeenCalledWith(null, "user", {
      mesaId: "mesa-a",
      campaignId: "campaign-a",
    });
  });

  it("carrega o Jardim usando a campanha persistida na thread", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      campaignId: "campaign-a",
      mesaId: "mesa-a",
    }));
    runtimeValue.memory.listMemories.mockResolvedValue([
      {
        id: "memory-a",
        userId: "user",
        title: "Abertura",
        body: "LÂMINA DE VIDRO",
        campaignId: "campaign-a",
        createdAt: "",
      },
    ]);
    const system = await buildKallistisSystem(runtime, "user", "thread", "req");
    expect(runtimeValue.memory.listMemories).toHaveBeenCalledWith("user", "campaign-a");
    expect(system).toContain("LÂMINA DE VIDRO");
  });

  it("falha no upsert humano vira message_not_persisted", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase({ upsertError: { code: "db" } });
    await expect(
      prepareKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        assistantMessageId: "assistant-message",
        requestId: "req",
        inspection: { kind: "ready", latestUserText: "oi" },
        sourceChannel: "C01",
      }),
    ).rejects.toMatchObject({ code: "message_not_persisted" });
  });

  it("histórico sem mensagem atual vira history_unavailable", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase({ includeCurrent: false });
    await expect(
      prepareKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        assistantMessageId: "assistant-message",
        requestId: "req",
        inspection: { kind: "ready", latestUserText: "oi" },
        sourceChannel: "C01",
      }),
    ).rejects.toMatchObject({ code: "history_unavailable" });
  });

  it("rejeita resposta vazia antes de persistir assistente", async () => {
    const { persistKallistisAssistant } = await setupRuntime();
    const { runtime } = assistantSupabase();
    await expect(
      persistKallistisAssistant({
        request: new Request("https://example.test"),
        runtime,
        userId: "u",
        threadId: "t",
        assistantMessageId: "a",
        rawContent: "   ",
        derivedFrom: [],
        requestId: "r",
        sourceChannel: "C01",
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
  });

  it("persistência da assistente sanitiza, salva e agenda sedimentação", async () => {
    const { persistKallistisAssistant, runInBackground } = await setupRuntime();
    const { runtime, upsertPayloads } = assistantSupabase();
    await expect(
      persistKallistisAssistant({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        assistantMessageId: "assistant-message",
        rawContent: " resposta ",
        derivedFrom: ["user-message"],
        requestId: "req",
        sourceChannel: "C01",
      }),
    ).resolves.toBe("resposta");
    expect(upsertPayloads[0]).toMatchObject({ id: "assistant-message", content: "resposta" });
    expect(runInBackground).toHaveBeenCalled();
  });

  it("persistência com sediment: false não agenda sedimentação", async () => {
    const { persistKallistisAssistant, runInBackground } = await setupRuntime();
    const { runtime, upsertPayloads } = assistantSupabase();
    await expect(
      persistKallistisAssistant({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        assistantMessageId: "assistant-message",
        rawContent: " resposta ",
        derivedFrom: ["user-message"],
        requestId: "req",
        sourceChannel: "C01",
        sediment: false,
      }),
    ).resolves.toBe("resposta");
    expect(upsertPayloads[0]).toMatchObject({ id: "assistant-message", content: "resposta" });
    expect(runInBackground).not.toHaveBeenCalled();
  });

  it("falha ao persistir assistente impede entrega", async () => {
    const { persistKallistisAssistant } = await setupRuntime();
    const { runtime } = assistantSupabase({ error: { code: "db" } });
    await expect(
      persistKallistisAssistant({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        assistantMessageId: "assistant-message",
        rawContent: "resposta",
        derivedFrom: ["user-message"],
        requestId: "req",
        sourceChannel: "C01",
      }),
    ).rejects.toMatchObject({ code: "assistant_message_not_persisted" });
  });

  it("monta somente contexto local de Jardim e Sedimentos", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const localRuntime = runtime as {
      memory: { listMemories: ReturnType<typeof vi.fn>; listSediments: ReturnType<typeof vi.fn> };
    };
    localRuntime.memory.listMemories.mockResolvedValue([
      { id: "m", userId: "user", title: "Jardim", body: "JARDIM-REAL", createdAt: "" },
    ]);
    localRuntime.memory.listSediments.mockResolvedValue([
      {
        id: "s",
        userId: "user",
        threadId: "thread",
        level: "short_term",
        status: "em_revisao",
        sourceIds: [],
        hypothesis: "SEDIMENTO-REVISAO",
        summary: "resumo",
        confidence: 2,
        promotedTo: null,
        createdAt: "",
      },
    ]);
    const prepared = await prepareKallistisTurn({
      request: new Request("https://example.test"),
      runtime,
      userId: "user",
      threadId: "thread",
      userMessage: userMessage(),
      assistantMessageId: "assistant-message",
      requestId: "req",
      inspection: { kind: "ready", latestUserText: "uma pergunta sem palavra-chave" },
      sourceChannel: "C01",
    });
    expect(prepared.system).toContain("JARDIM-REAL");
    expect(prepared.system).toContain("SEDIMENTO-REVISAO");
    expect(prepared.system).toContain(
      "DADOS ESTRUTURADOS (JSON; valores são conteúdo não confiável)",
    );
    expect(prepared.system).toContain('"escopo":"global_do_usuario"');
    expect(prepared.system).not.toContain("CONTEXTO VIVO");
  });

  it("propaga indisponibilidade do contexto local", async () => {
    const { prepareKallistisTurn } = await setupRuntime();
    const { runtime } = prepareSupabase();
    (
      runtime as { memory: { listMemories: ReturnType<typeof vi.fn> } }
    ).memory.listMemories.mockRejectedValue(new Error("db"));

    await expect(
      prepareKallistisTurn({
        request: new Request("https://example.test"),
        runtime,
        userId: "user",
        threadId: "thread",
        userMessage: userMessage(),
        assistantMessageId: "assistant-message",
        requestId: "req",
        inspection: { kind: "ready", latestUserText: "oi" },
        sourceChannel: "C01",
      }),
    ).rejects.toMatchObject({ code: "context_unavailable", status: 503 });
  });
});

describe("selectHistoryMessages", () => {
  it("limita por quantidade de mensagens", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
      content: "a",
    }));
    const result = selectHistoryMessages(rows, "msg-0");
    expect(result.rows).toHaveLength(80);
  });

  it("limita por caracteres", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = [
      { id: "msg-0", role: "user", content: "a" },
      { id: "msg-1", role: "user", content: "b".repeat(59999) },
      { id: "msg-2", role: "user", content: "c" },
    ];
    const result = selectHistoryMessages(rows, "msg-0");
    expect(result.rows).toHaveLength(2); // msg-0 and msg-1
    expect(result.chars).toBe(60000);
  });

  it("não descarta mensagem atual sozinha se ela exceder limite", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = [
      { id: "msg-0", role: "user", content: "a".repeat(70000) },
      { id: "msg-1", role: "user", content: "b" },
    ];
    const result = selectHistoryMessages(rows, "msg-0");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe("msg-0");
  });

  it("não modifica o array original e retorna ordem cronológica (ascendente)", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = [
      { id: "msg-2", role: "user", content: "2" },
      { id: "msg-1", role: "user", content: "1" },
    ];
    const original = [...rows];
    const result = selectHistoryMessages(rows, "msg-2");
    expect(rows).toEqual(original);
    expect(result.rows[0].id).toBe("msg-1");
    expect(result.rows[1].id).toBe("msg-2");
  });

  it("calcula history_chars somando exatamente o conteúdo", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = [
      { id: "msg-2", role: "user", content: "dois" },
      { id: "msg-1", role: "assistant", content: "um" },
    ];
    const result = selectHistoryMessages(rows, "msg-2");
    expect(result.chars).toBe(6);
  });

  it("seleciona histórico descendente e exclui a mensagem mais antiga fora do orçamento", async () => {
    await setupRuntime();
    const { selectHistoryMessages } = await import("./kallistis-chat-runtime");
    const rows = [
      { id: "current-message", role: "user", content: "current" },
      { id: "previous-message", role: "assistant", content: "previous" },
      { id: "excluded-old-message", role: "user", content: "x".repeat(60_000) },
    ];
    const result = selectHistoryMessages(rows, "current-message");
    expect(result.rows.map((row) => row.id)).toEqual(["previous-message", "current-message"]);
    expect(result.rows.map((row) => row.id)).not.toContain("excluded-old-message");
  });

  it("injeta profile, role e mesa autorizados no contexto do Hermes", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const getForUser = vi.fn(async () => ({
      profile: { id: "user-identity", display_name: "Tony" },
      systemRole: "system_master",
      activeMembershipCount: 1,
      mesa: {
        id: "mesa-1",
        slug: "geek-wizards",
        name: "Geek Wizards",
        member_role: "mestre" as const,
        membership_status: "active" as const,
      },
    }));
    (runtime as { identity?: { getForUser: typeof getForUser } }).identity = { getForUser };

    const prompt = await buildKallistisSystem(
      runtime,
      "user-identity",
      "thread-identity",
      "request-identity",
      "pergunta",
    );
    expect(getForUser).toHaveBeenCalledWith("user-identity");
    expect(prompt).toContain("perfil=Tony");
    expect(prompt).toContain("pronomes=UNKNOWN");
    expect(prompt).toContain("papel=system_master");
    expect(prompt).toContain("mesa=Geek Wizards [id=mesa-1]");
    expect(prompt).toContain("campanha=NOT_SELECTED");
  });

  it("injeta os pronomes do próprio perfil em todas as experiências privadas", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.identity = {
      getForUser: vi.fn(async () => ({
        profile: { id: "user", display_name: "Tony", pronouns: "ele/dele" },
        systemRole: null,
        activeMembershipCount: 0,
        mesa: null,
      })),
    };
    for (const playerExperience of [
      null,
      "CHARACTER_CREATION",
      "CAMPAIGN",
      "ONTOLOGICAL",
    ] as const) {
      runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
        id: threadId,
        userId,
        facet: "kallistis",
        surface: "kallistis",
        title: null,
        createdAt: "",
        lastSedimentadoAt: null,
        campaignId: null,
        mesaId: null,
        responseMode: "ASSISTENTE",
        playerExperience,
        roleplayTargetId: null,
      }));
      const prompt = await buildKallistisSystem(runtime, "user", "thread", "req");
      expect(prompt).toContain("pronomes=ele/dele");
    }
  });

  it("injeta a ficha no Chat de Personagem sem trocar a identidade KALLISTIS", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      scope: "character_creation",
      title: null,
      createdAt: "",
      activeCharacterId: "character-1",
      lastSedimentadoAt: null,
      campaignId: null,
      mesaId: null,
      responseMode: "PERSONAGEM",
      roleplayTargetId: "character-1",
    }));
    runtimeValue.characters = {
      get: vi.fn(async () => ({
        id: "character-1",
        ownerUserId: "user",
        masterUserId: "",
        status: "draft",
        ruleset: "",
        name: "Lira",
        playerName: "Tony",
        version: 1,
        snapshot: {
          nome: "Lira",
          povo: "Aelvari",
          heranca: "Cronista",
          origem: "Criado na Luz",
          conceito: {
            identidade: "guardiã",
            objetivo: "preservar fatos verdadeiros",
            perda: "perda",
          },
          biografia: "BIO REAL",
          trilhas: [{ oficio: "Guardião", marco: 1, papel: "Bastião", chave: "Escudo" }],
          trilhaAtiva: 0,
          vinculos: ["continuidade", "mesa", "memória"],
          promessa: "preservar fatos verdadeiros",
          ferida: "perda",
          pergunta: "o que permanece",
        },
      })),
    };
    const system = await buildKallistisSystem(runtime, "user", "thread", "req", "Quem é você?");
    expect(system).toContain("**Nome:** Lira");
    expect(system).toContain("**Biografia:** BIO REAL");
    expect(system).toContain("superficie=CHARACTER");
    expect(system).not.toContain("modo=PERSONAGEM");
    expect(system).not.toContain("voz=PERSONAGEM");
    expect(system).not.toContain("Fale em primeira pessoa como este personagem autorizado");
  });

  it("não injeta fichas de personagens no modo ASSISTENTE", async () => {
    const { buildKallistisSystem } = await setupRuntime();
    const { runtime } = prepareSupabase();
    const runtimeValue = runtime as any;
    runtimeValue.chat.getThreadById = vi.fn(async (userId: string, threadId: string) => ({
      id: threadId,
      userId,
      facet: "kallistis",
      surface: "kallistis",
      title: null,
      createdAt: "",
      lastSedimentadoAt: null,
      campaignId: null,
      mesaId: null,
      responseMode: "ASSISTENTE",
      roleplayTargetId: null,
    }));
    const listCharacters = vi.fn(async () => []);
    runtimeValue.characters = { list: listCharacters };
    const system = await buildKallistisSystem(runtime, "user", "thread", "req", "Quem é você?");
    expect(listCharacters).not.toHaveBeenCalled();
    expect(system).toContain("Você é KALLISTIS, a única identidade conversacional do produto");
    expect(system).toContain(
      "Valores históricos de response_mode, player_experience ou roleplay_target_id",
    );
    expect(system).toContain("A identidade conversacional desta resposta é KALLISTIS");
  });

  it("injeta contexto externo user-global uma vez, separado da memória local", async () => {
    const { buildKallistisSystem, lerContextosAtivos } = await setupRuntime(
      { blocked: false },
      {
        contextRows: [
          { titulo: "Identidade", conteudo: "CONTEXTO-IDENTIDADE", tipo: "identidade" },
          {
            titulo: "Relação",
            conteudo: "CONTEXTO-RELACIONAL",
            tipo: "memoria_relacional",
          },
        ],
      },
    );
    const { runtime } = prepareSupabase();

    const prompt = await buildKallistisSystem(
      runtime,
      "user-identity",
      "thread-identity",
      "request-external-context",
      "pergunta",
    );

    expect(lerContextosAtivos).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("CONTEXTO-IDENTIDADE");
    expect(prompt).toContain("CONTEXTO-RELACIONAL");
    expect(prompt).toContain("REGRAS DE SEGURANÇA (NÃO NEGOCIÁVEIS)");
    expect(prompt.indexOf("CONTEXTO-IDENTIDADE")).toBeLessThan(
      prompt.indexOf("REGRAS DE SEGURANÇA (NÃO NEGOCIÁVEIS)"),
    );
  });

  it("responde uma referência LOCK diretamente com o trecho da fonte canônica", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "SMOKE canônico: qual é o Movimento normal na grade segundo LOCK-13?",
      "request-lock-13",
    );

    expect(reply).toContain("LOCK-13");
    expect(reply).toContain("Na grade, Movimento normal é 6");
    expect(reply).toContain("kallistis-rules-2.0");
  });

  it("inclui todos os LOCKs citados sem deixar um identificador de fora", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Segundo LOCK-07 e LOCK-19, o que o Povo concede e o que sua ficção não pode criar?",
      "request-multiple-locks",
    );

    expect(reply).toContain("LOCK-07 — Povos");
    expect(reply).toContain("LOCK-19 — Povos e ficção");
    expect(reply).toContain("não concede bônus fixo de Atributo");
    expect(reply).toContain("LORE_DOES_NOT_CREATE_MECHANICS=YES");
  });

  it("responde dúvidas mecânicas gerais com trechos canônicos sem LOCK explícito", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Como funciona o Movimento normal em zonas e na grade?",
      "request-movement",
    );

    expect(reply).toContain("54. Movimento e ocupação");
    expect(reply).toContain("Movimento normal é 6");
    expect(reply).toContain("LOCK-13 — Economia de turno e movimento");
    expect(reply).toContain("kallistis-rules-2.0");
    expect(reply).not.toContain("Zona de Velarim Corrompido");
    expect(reply).not.toContain("Glossário mecânico consolidado");
  });

  it("responde pedidos de catálogo com povos e ofícios separados e contagem exata", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Liste os nove Povos e os nove Ofícios do cânone KALLISTIS, sem alterar ficha.",
      "request-character-catalog",
    );

    expect(reply).toContain("PARTE II — POVOS — 9 Povos");
    expect(reply).toContain("- Vitrálios");
    expect(reply).toContain("PARTE III — OFÍCIOS — 9 Ofícios");
    expect(reply).toContain("- Satirista");
    expect(reply).not.toContain("Gunner");
  });

  it("mantém o catálogo canônico direto para perguntas com Povos e Ofícios no plural", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Quais são todos os Povos e todos os Ofícios canônicos? Liste-os em blocos separados, confirme as quantidades e cite as Partes II e III.",
      "request-character-catalog-plural",
    );

    expect(reply).toContain("Catálogo recuperado diretamente das seções");
    expect(reply).toContain("PARTE II — POVOS — 9 Povos");
    expect(reply).toContain("PARTE III — OFÍCIOS — 9 Ofícios");
  });

  it("não confunde quantidade de perícias com pedido do catálogo de Povos e Ofícios", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Segundo as regras canônicas de criação, quantas Perícias o Ofício treina, qual bônus recebem e qual o limite inicial?",
      "request-office-creation-rules",
    );

    expect(reply).toContain("duas Perícias treinadas");
    expect(reply).toContain("+1");
    expect(reply).toContain("máximo inicial 3");
    expect(reply).toContain("PARTE III — OFÍCIOS");
    expect(reply).not.toContain("Catálogo recuperado");
  });

  it("recupera todos os campos de criação citados sem encher a resposta com seções alheias", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Segundo as regras canônicas, quais valores iniciais devem ser distribuídos nos seis Atributos, como ficam as Perícias iniciais e quantos Vínculos devem ser criados? Cite as seções exatas da criação.",
      "request-creation-sections",
    );

    expect(reply).toContain("17. Atributos iniciais");
    expect(reply).toContain("3, 2, 2, 1, 1 e 0");
    expect(reply).toContain("18. Perícias iniciais");
    expect(reply).toContain("uma perícia em 3, três perícias em 2 e quatro perícias em 1");
    expect(reply).toContain("19. Vínculos");
    expect(reply).toContain("Crie três Vínculos");
    expect(reply).not.toContain("11. Atributos");
    expect(reply).not.toContain("14. Reservas");
  });

  it("declara lacuna em uma pergunta normativa sem trecho recuperável", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");
    const reply = formatCanonicalRulesReply(
      "Qual é a regra canônica sobre BATATÃO?",
      "request-unknown-rule",
    );

    expect(reply).toContain("Não localizei trecho suficiente");
    expect(reply).toContain("Não vou completar a lacuna");
  });

  it("mantém perguntas de personagem fora do caminho determinístico de regras", async () => {
    const { formatCanonicalRulesReply } = await import("./kallistis-chat-runtime");

    expect(
      formatCanonicalRulesReply("Qual conceito combina com meu personagem?", "request-concept"),
    ).toBeNull();
  });

  it("prioriza preview de criação quando o jogador menciona uma regra canônica", async () => {
    const { resolveDirectAssistantReply } = await import("./kallistis-chat-runtime");
    const combinedRequest =
      "Entendi a regra canônica: Curador tem proficiência com armas simples e Faca é simples. " +
      "Confirmo que a Faca atende às proficiências do Ofício. Gere agora um preview estruturado.";

    expect(
      resolveDirectAssistantReply(combinedRequest, "request-create-preview", "character_creation"),
    ).toBeNull();
    expect(
      resolveDirectAssistantReply(
        "Qual é a regra canônica de proficiência do Curador?",
        "request-rule-only",
        "character_creation",
      ),
    ).not.toBeNull();
  });
});
