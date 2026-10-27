import { afterEach, describe, expect, it, vi } from "vitest";
import {
  historyBeforeCreationRetry,
  readOwnedCharacter,
  responseError,
} from "./character-creation";

describe("character creation diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a specific prerequisite conflict for an owned but uninitialized character", async () => {
    const response = responseError(
      new Error("conversational_creation_not_initialized"),
      "request-qa",
      "character_lookup",
      12,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "conversational_creation_not_initialized",
      requestId: "request-qa",
      stage: "character_lookup",
    });
  });

  it("returns a retryable 503 for incomplete model text instead of accepting a saved turn", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseError(
      new Error("generation_incomplete"),
      "request-truncated",
      "primary_generation",
      2400,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "generation_incomplete",
      requestId: "request-truncated",
      stage: "primary_generation",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "[character-creation] request failed",
      expect.objectContaining({
        requestId: "request-truncated",
        code: "generation_incomplete",
      }),
    );
  });

  it("removes the failed turn and all prior retry replies from model context", () => {
    const history = [
      { role: "user" as const, content: "Quero criar uma Evocadora." },
      { role: "assistant" as const, content: "Vamos conversar." },
      { role: "user" as const, content: "Quero seguir pelo papel de Bastião." },
      { role: "assistant" as const, content: "O provider está indisponível." },
      { role: "assistant" as const, content: "A proposta foi recusada." },
    ];

    expect(historyBeforeCreationRetry(history)).toEqual(history.slice(0, 2));
    expect(historyBeforeCreationRetry([])).toEqual([]);
  });

  it("distinguishes missing, foreign-owned, and uninitialized characters internally", async () => {
    type Query = Parameters<typeof readOwnedCharacter>[0]["query"];
    const sql = (responses: unknown[][]) => {
      const query = vi.fn(async () => responses.shift() ?? []);
      return { query, queryMock: query } as unknown as Parameters<typeof readOwnedCharacter>[0] & {
        queryMock: ReturnType<typeof vi.fn<Query>>;
      };
    };

    const missing = sql([[]]);
    await expect(readOwnedCharacter(missing, "missing", "qa-owner")).rejects.toThrow(
      "character_not_found",
    );
    expect(missing.queryMock).toHaveBeenCalledTimes(1);

    const foreign = sql([[{ owner_user_id: "another-owner" }]]);
    await expect(readOwnedCharacter(foreign, "foreign", "qa-owner")).rejects.toThrow(
      "character_not_owned",
    );
    expect(foreign.queryMock).toHaveBeenCalledTimes(1);

    const uninitialized = sql([
      [{ owner_user_id: "qa-owner" }],
      [
        {
          id: "owned-draft",
          owner_user_id: "qa-owner",
          status: "draft",
          version: 1,
          snapshot: {},
        },
      ],
    ]);
    await expect(readOwnedCharacter(uninitialized, "owned-draft", "qa-owner")).rejects.toThrow(
      "conversational_creation_not_initialized",
    );
  });

  it("keeps foreign ownership indistinguishable from absence in the public response", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseError(
      new Error("character_not_owned"),
      "request-private-id",
      "character_lookup",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "character_not_found",
      requestId: "request-private-id",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("another-owner");
  });

  it("correlates database failures by safe stage and SQLSTATE without logging raw detail", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const databaseError = Object.assign(
      new Error("postgres connection string and SQL text must not be logged"),
      { code: "08006" },
    );
    const response = responseError(databaseError, "request-db", "persistence", 286);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "character_creation_unavailable",
      requestId: "request-db",
      stage: "persistence",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "[character-creation] request failed",
      expect.objectContaining({
        requestId: "request-db",
        stage: "persistence",
        durationMs: 286,
        errorClass: "database_error",
        code: "08006",
      }),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("connection string");
  });
});
