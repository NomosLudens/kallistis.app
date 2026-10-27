import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  repo: {
    get: vi.fn(),
    create: vi.fn(),
    progression: vi.fn(),
    progressionList: vi.fn(),
  },
  sql: { query: vi.fn(), close: vi.fn() },
  validatePartialInitialDistributions: vi.fn(() => [] as string[]),
  validateMagicChoices: vi.fn(() => [] as string[]),
  validateCharacterSnapshot: vi.fn(() => ({ ok: true, errors: [], warnings: [] })),
}));

vi.mock("@/server/runtime/context", () => ({
  getRuntimeDatabaseUrl: vi.fn(() => "postgresql://test/kallistis"),
}));
vi.mock("@/lib/require-user.server", () => ({
  requireUser: vi.fn(async () => ({ userId: "player-1" })),
}));
vi.mock("@/server/local-core/csrf", () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock("@/server/local-core/postgres", () => ({
  createBunPostgresExecutor: vi.fn(() => state.sql),
}));
vi.mock("@/server/characters/context", () => ({ buildCharacterContext: vi.fn(() => "") }));
vi.mock("@/server/characters/character-canon", () => ({
  mechanicalFingerprint: vi.fn(),
  validateMagicChoices: state.validateMagicChoices,
  validateCharacterSnapshot: state.validateCharacterSnapshot,
  validatePartialInitialDistributions: state.validatePartialInitialDistributions,
}));
vi.mock("@/server/local-core/player-access", () => ({ isSystemMaster: vi.fn(async () => false) }));
vi.mock("@/server/characters/repository", () => ({
  createPostgresCharacterRepository: vi.fn(() => state.repo),
}));

import { Route } from "@/routes/api/characters";

const postHandler = (Route.options as any).server.handlers.POST as (input: {
  request: Request;
}) => Promise<Response>;
const putHandler = (Route.options as any).server.handlers.PUT as (input: {
  request: Request;
}) => Promise<Response>;

describe("contrato da API de personagens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.validatePartialInitialDistributions.mockReturnValue([]);
    state.repo.progression.mockResolvedValue({
      id: "progression-request-1",
      character_id: "character-1",
      status: "requested",
    });
    state.repo.create.mockResolvedValue({ id: "qa-character-1", status: "draft", version: 1 });
    state.repo.get.mockResolvedValue({ id: "character-1", status: "approved", version: 26 });
    state.repo.progressionList.mockResolvedValue([
      { id: "progression-request-1", status: "requested" },
    ]);
  });

  it("devolve a personagem canônica após criar uma solicitação", async () => {
    const request = new Request("https://kallistis.app/api/characters", {
      method: "POST",
      headers: { origin: "https://kallistis.app", "content-type": "application/json" },
      body: JSON.stringify({ id: "character-1", action: "request" }),
    });

    const response = await postHandler({ request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      character: { id: "character-1", status: "approved", version: 26 },
      progression: [{ id: "progression-request-1", status: "requested" }],
    });
    expect(state.repo.get).toHaveBeenCalledWith("player-1", "character-1");
  });

  it("rejeita uma distribuição parcial inválida antes de gravar no repositório", async () => {
    state.validatePartialInitialDistributions.mockReturnValue(["attributes_distribution_invalid"]);
    const request = new Request("https://kallistis.app/api/characters", {
      method: "PUT",
      headers: { origin: "https://kallistis.app", "content-type": "application/json" },
      body: JSON.stringify({
        id: "qa-character-1",
        snapshot: { nome: "QA parcial", completo: false },
      }),
    });

    const response = await putHandler({ request });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "character_invalid",
      validation: { ok: false, errors: ["attributes_distribution_invalid"] },
    });
    expect(state.repo.get).not.toHaveBeenCalled();
    expect(state.repo.create).not.toHaveBeenCalled();
  });

  it("permite persistir um rascunho QA parcial dentro dos limites", async () => {
    state.repo.get.mockResolvedValue(null);
    const request = new Request("https://kallistis.app/api/characters", {
      method: "PUT",
      headers: { origin: "https://kallistis.app", "content-type": "application/json" },
      body: JSON.stringify({
        id: "qa-character-1",
        snapshot: {
          nome: "QA parcial",
          completo: false,
          atributosBase: { Corpo: 3, Agilidade: null },
          periciasBase: { Atletismo: 3, Combate: 0 },
        },
      }),
    });

    const response = await putHandler({ request });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      character: { id: "qa-character-1", status: "draft", version: 1 },
    });
    expect(state.repo.create).toHaveBeenCalledOnce();
  });
});
