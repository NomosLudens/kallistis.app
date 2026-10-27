import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCharacterDraft } from "@/server/characters/chat-creation";

const state = vi.hoisted(() => ({
  character: null as Record<string, unknown> | null,
  close: vi.fn(),
  pending: null as {
    id: string;
    operation: string;
    characterId: string;
    expectedVersion: number;
    payload: { patch: Record<string, unknown> };
  } | null,
  save: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/server/runtime/context", () => ({
  getRuntimeDatabaseUrl: vi.fn(() => "postgresql://qa/kallistis"),
}));
vi.mock("@/lib/require-user.server", () => ({
  requireUser: vi.fn(async () => ({ userId: "qa-player" })),
}));
vi.mock("@/server/local-core/chat-runtime", () => ({
  createLocalChatRuntime: vi.fn(() => ({
    characters: {
      get: vi.fn(async () => state.character),
      save: state.save,
    },
    mutations: {
      claimPendingMutation: vi.fn(async () => state.pending),
      completePendingMutation: state.complete,
      releasePendingMutation: vi.fn(async () => undefined),
    },
    close: state.close,
  })),
}));

import { Route } from "./mutations";

const post = (confirmationId: string) =>
  new Request("https://kallistis.app/api/chat/mutations", {
    method: "POST",
    headers: { Origin: "https://kallistis.app", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", confirmationId }),
  });

describe("confirmação de preview de equipamento do Forge", () => {
  beforeEach(() => {
    state.close.mockReset();
    state.complete.mockReset().mockResolvedValue(undefined);
    state.character = {
      id: "qa-character",
      ownerUserId: "qa-player",
      masterUserId: "",
      status: "draft",
      ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
      name: "Jinjo QA",
      playerName: "QA Player",
      version: 23,
      snapshot: buildCharacterDraft("Jinjo QA", "", "Curador"),
      mechanicalFingerprint: "before",
      createdAt: "",
      updatedAt: "",
      mesas: [],
    };
    const equipmentPatch = {
      arma: "Lança curta",
      proficienciaConfirmada: true,
      armadura: "Leve",
      ferramenta: "Kit de cura",
      consumiveis: ["Estabilizador de Fluxo", "Sal de Memória"],
    };
    state.pending = {
      id: "77777777-7777-4777-8777-777777777777",
      operation: "character_creation_patch",
      characterId: "qa-character",
      expectedVersion: 23,
      payload: { patch: { equipamento: equipmentPatch } },
    };
    state.save.mockImplementation(async (_userId: string, id: string, snapshot: unknown) => {
      const current = state.character as Record<string, unknown>;
      state.character = { ...state.character, id, snapshot, version: 24 };
      return { ...current, id, snapshot, version: 24 };
    });
  });

  it("confirma preview válido e recupera equipamento pelo readback da ficha QA", async () => {
    const pending = state.pending;
    if (!pending) throw new Error("QA preview fixture was not initialized");
    const route = Route.options as unknown as {
      server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } };
    };
    const handlers = route.server.handlers;
    const response = await handlers.POST({ request: post(pending.id) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "confirmed", operation: "character_creation_patch" });
    const equipment = body.character.snapshot.equipamento as Record<string, unknown>;
    expect(equipment).toMatchObject({
      arma: "Lança curta",
      proficienciaConfirmada: true,
      armadura: "Leve",
      ferramenta: "Kit de cura",
      consumiveis: ["Estabilizador de Fluxo", "Sal de Memória"],
    });
    expect(state.complete).toHaveBeenCalledWith("qa-player", pending.id);

    const readbackAfterReload = await Promise.resolve(state.character as Record<string, unknown>);
    const readbackEquipment = (readbackAfterReload.snapshot as Record<string, unknown>).equipamento;
    expect(readbackEquipment).toEqual(equipment);
    expect(readbackAfterReload.version).toBe(24);
  });
});
