import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { responseError } from "@/routes/api/character-creation";
import { createWorkerPostgresExecutor, type SqlExecutor } from "@/server/local-core/postgres";
import {
  cancelNarrativeCreationProposals,
  confirmNarrativeCreationProposals,
  stageNarrativeCreationProposals,
  startConversationalCreation,
} from "./conversational-creation";
import { updateCharacterCreationSnapshot } from "./character-creation-persistence";

const databaseUrl = process.env.KALLISTIS_PG_TEST_URL;
const testDescribe = databaseUrl ? describe : describe.skip;
let sql: SqlExecutor | undefined;
let characterId = "";
let ownerId = "";

if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("KALLISTIS_PG_TEST_URL must point to a local PostgreSQL test database");
  }
  if (!parsed.pathname.toLowerCase().includes("test")) {
    throw new Error("KALLISTIS_PG_TEST_URL database name must contain 'test'");
  }
}

async function query<T extends Record<string, unknown>>(statement: string, values?: unknown[]) {
  if (!sql) throw new Error("local postgres test database is unavailable");
  return sql.query<T>(statement, values);
}

async function seed(snapshot: Record<string, unknown> = {}, version = 1) {
  await query(
    "INSERT INTO public.characters (id,owner_user_id,name,snapshot,version,mechanical_fingerprint,updated_at) VALUES ($1,$2,'QA', $3::jsonb,$4,'before',now())",
    [characterId, ownerId, snapshot, version],
  );
}

async function update(snapshot: Record<string, unknown>, expectedVersion = 1, userId = ownerId) {
  if (!sql) throw new Error("local postgres test database is unavailable");
  return updateCharacterCreationSnapshot({
    tx: sql,
    id: characterId,
    userId,
    expectedVersion,
    name: String(snapshot.nome ?? "QA"),
    snapshot,
    mechanicalFingerprint: "after",
  });
}

async function readCharacter() {
  const rows = await query<{ id: string; owner_user_id: string; version: number; snapshot: any }>(
    "SELECT id,owner_user_id,version,snapshot FROM public.characters WHERE id=$1",
    [characterId],
  );
  return rows[0];
}

beforeAll(async () => {
  if (!databaseUrl) return;
  sql = createWorkerPostgresExecutor(databaseUrl);
  await sql.query(
    "CREATE TABLE IF NOT EXISTS public.characters (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, name text NOT NULL, snapshot jsonb NOT NULL, version integer NOT NULL, mechanical_fingerprint text NOT NULL, updated_at timestamptz NOT NULL)",
  );
  await sql.query(
    "CREATE TABLE IF NOT EXISTS public.character_versions (character_id uuid NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL, actor_user_id uuid NOT NULL)",
  );
  await sql.query(
    "CREATE TABLE IF NOT EXISTS public.character_events (character_id uuid NOT NULL, actor_user_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL, version_before integer, version_after integer)",
  );
  await sql.query(
    "CREATE TABLE IF NOT EXISTS public.character_creation_messages (id bigserial PRIMARY KEY, character_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
  );
});

beforeEach(() => {
  characterId = randomUUID();
  ownerId = randomUUID();
});

afterEach(async () => {
  if (!sql || !characterId) return;
  await sql.query("DELETE FROM public.character_creation_messages WHERE character_id=$1", [
    characterId,
  ]);
  await sql.query("DELETE FROM public.character_events WHERE character_id=$1", [characterId]);
  await sql.query("DELETE FROM public.character_versions WHERE character_id=$1", [characterId]);
  await sql.query("DELETE FROM public.characters WHERE id=$1", [characterId]);
});

afterAll(() => sql?.close());

testDescribe("character-creation persistence on real PostgreSQL", () => {
  it("UPDATE without RETURNING yields no rows, while the shared helper returns the changed id", async () => {
    await seed();
    const noReturning = await query(
      "UPDATE public.characters SET updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND version=$3",
      [characterId, ownerId, 1],
    );
    expect(noReturning).toEqual([]);

    const result = await update({ nome: "Lira" });
    expect(result).toEqual({ id: characterId });
    expect(await readCharacter()).toMatchObject({
      id: characterId,
      version: 2,
      snapshot: { nome: "Lira" },
    });
  });

  it("returns HTTP 409 for a stale version and leaves the row unchanged", async () => {
    await seed({ nome: "Original" }, 2);
    await expect(update({ nome: "Stale" }, 1)).rejects.toThrow("stale_character_version");
    expect(responseError(new Error("stale_character_version"), "qa-request").status).toBe(409);
    expect(await readCharacter()).toMatchObject({ version: 2, snapshot: { nome: "Original" } });
  });

  it("does not update a character when the owner predicate does not match", async () => {
    await seed({ nome: "Original" });
    await expect(update({ nome: "Other owner" }, 1, randomUUID())).rejects.toThrow(
      "stale_character_version",
    );
    expect(await readCharacter()).toMatchObject({ version: 1, snapshot: { nome: "Original" } });
  });

  it("persists a grouped confirmation with exactly one version increment", async () => {
    const started = startConversationalCreation(
      "QA",
      "Quero uma personagem chamada Lira, do Povo Kragor.",
    );
    const staged = stageNarrativeCreationProposals(
      started.snapshot,
      [
        { path: "nome", value: "Lira", sourceText: "personagem chamada Lira" },
        { path: "povo", value: "Kragor", sourceText: "Povo Kragor" },
      ],
      [started.userMessage],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const confirmed = confirmNarrativeCreationProposals(staged.snapshot);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok || !sql) return;
    await seed(staged.snapshot);
    await sql.transaction!(async (tx) => {
      await updateCharacterCreationSnapshot({
        tx,
        id: characterId,
        userId: ownerId,
        expectedVersion: 1,
        name: "Lira",
        snapshot: confirmed.snapshot,
        mechanicalFingerprint: "confirmed",
      });
      await tx.query(
        "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,2,$2::jsonb,'conversation_confirm',$3)",
        [characterId, confirmed.snapshot, ownerId],
      );
      await tx.query(
        "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,'character_proposals_confirmed','{}'::jsonb,1,2)",
        [characterId, ownerId],
      );
    });
    expect(await readCharacter()).toMatchObject({
      version: 2,
      snapshot: { nome: "Lira", povo: "Kragor" },
    });
    expect(
      await query("SELECT version FROM public.character_versions WHERE character_id=$1", [
        characterId,
      ]),
    ).toHaveLength(1);
  });

  it("persists a narrative turn as snapshot, version, event, and both messages", async () => {
    await seed({ nome: "Lira" });
    const next = { nome: "Lira", conceito: { identidade: "guardião" } };
    await sql!.transaction!(async (tx) => {
      await updateCharacterCreationSnapshot({
        tx,
        id: characterId,
        userId: ownerId,
        expectedVersion: 1,
        name: "Lira",
        snapshot: next,
        mechanicalFingerprint: "turn",
      });
      await tx.query(
        "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,2,$2::jsonb,'conversation_turn',$3)",
        [characterId, next, ownerId],
      );
      await tx.query(
        "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,'character_conversation_turn','{}'::jsonb,1,2)",
        [characterId, ownerId],
      );
      await tx.query(
        "INSERT INTO public.character_creation_messages (character_id,user_id,role,content) VALUES ($1,$2,'user','história'),($1,$2,'assistant','resposta')",
        [characterId, ownerId],
      );
    });
    expect(await readCharacter()).toMatchObject({ version: 2, snapshot: next });
    expect(
      await query("SELECT reason FROM public.character_versions WHERE character_id=$1", [
        characterId,
      ]),
    ).toEqual([{ reason: "conversation_turn" }]);
    expect(
      await query("SELECT event_type FROM public.character_events WHERE character_id=$1", [
        characterId,
      ]),
    ).toEqual([{ event_type: "character_conversation_turn" }]);
    expect(
      await query(
        "SELECT role,content FROM public.character_creation_messages WHERE character_id=$1 ORDER BY id",
        [characterId],
      ),
    ).toEqual([
      { role: "user", content: "história" },
      { role: "assistant", content: "resposta" },
    ]);
  });

  it("cancels grouped proposals without persisting proposed mechanical choices", async () => {
    const started = startConversationalCreation("QA", "Quero ser do Povo Kragor.");
    const staged = stageNarrativeCreationProposals(
      started.snapshot,
      [{ path: "povo", value: "Kragor", sourceText: "Povo Kragor" }],
      [started.userMessage],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const cancelled = cancelNarrativeCreationProposals(staged.snapshot);
    await seed(staged.snapshot);
    await update(cancelled);
    expect(await readCharacter()).toMatchObject({ version: 2, snapshot: { povo: "" } });
    expect((await readCharacter())?.snapshot.serverCreationProgress.pendingProposals).toEqual([]);
  });

  it("serializes concurrent confirmations so only one expected-version update succeeds", async () => {
    await seed({ nome: "Original" });
    const first = createWorkerPostgresExecutor(databaseUrl!);
    const second = createWorkerPostgresExecutor(databaseUrl!);
    const run = (connection: SqlExecutor, name: string) =>
      connection.transaction!(async (tx) =>
        updateCharacterCreationSnapshot({
          tx,
          id: characterId,
          userId: ownerId,
          expectedVersion: 1,
          name,
          snapshot: { nome: name },
          mechanicalFingerprint: name,
        }),
      );
    const outcomes = await Promise.allSettled([run(first, "Lira"), run(second, "Sora")]);
    first.close();
    second.close();
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await readCharacter()).toMatchObject({ version: 2 });
  });

  it("rolls back snapshot, versions, events, and messages after a transaction failure", async () => {
    await seed({ nome: "Original" });
    await expect(
      sql!.transaction!(async (tx) => {
        await updateCharacterCreationSnapshot({
          tx,
          id: characterId,
          userId: ownerId,
          expectedVersion: 1,
          name: "Partial",
          snapshot: { nome: "Partial" },
          mechanicalFingerprint: "partial",
        });
        await tx.query(
          "INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id) VALUES ($1,2,'{}'::jsonb,'test',$2)",
          [characterId, ownerId],
        );
        await tx.query(
          "INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES ($1,$2,'test','{}'::jsonb,1,2)",
          [characterId, ownerId],
        );
        await tx.query(
          "INSERT INTO public.character_creation_messages (character_id,user_id,role,content) VALUES ($1,$2,'assistant','partial')",
          [characterId, ownerId],
        );
        throw new Error("qa_transaction_failure");
      }),
    ).rejects.toThrow("qa_transaction_failure");
    expect(await readCharacter()).toMatchObject({ version: 1, snapshot: { nome: "Original" } });
    expect(
      await query("SELECT version FROM public.character_versions WHERE character_id=$1", [
        characterId,
      ]),
    ).toEqual([]);
    expect(
      await query("SELECT event_type FROM public.character_events WHERE character_id=$1", [
        characterId,
      ]),
    ).toEqual([]);
    expect(
      await query("SELECT id FROM public.character_creation_messages WHERE character_id=$1", [
        characterId,
      ]),
    ).toEqual([]);
  });
});
