import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/require-user.server";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createLocalChatRuntime } from "@/server/local-core/chat-runtime";
import {
  CHARACTER_RULESET,
  mechanicalFingerprint,
  validateCharacterSnapshot,
  type CharacterSnapshot,
} from "@/server/characters/character-canon";
import { mergeCharacterCreationPatch } from "@/server/chat/kallistis-tools";
import { validateCharacterCreationDraftSnapshot } from "@/server/characters/chat-creation";

const headers = { "Cache-Control": "no-store" };
const mutationRequestSchema = z
  .object({
    action: z.enum(["confirm", "cancel"]),
    confirmationId: z.string().uuid(),
  })
  .strict();

function response(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

export const Route = createFileRoute("/api/chat/mutations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedOrigin = process.env.KALLISTIS_PUBLIC_ORIGIN || "https://kallistis.app";
        if (!isSameOriginRequest(request, expectedOrigin)) return response("csrf_rejected", 403);
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        let input: z.infer<typeof mutationRequestSchema>;
        try {
          const raw = await request.json();
          input = mutationRequestSchema.parse(raw);
        } catch {
          return response("invalid_mutation_request", 400);
        }
        const databaseUrl = getRuntimeDatabaseUrl();
        if (!databaseUrl) return response("database_unavailable", 503);
        const runtime = createLocalChatRuntime(databaseUrl);
        try {
          if (!runtime.mutations || !runtime.characters)
            return response("mutation_unavailable", 503);
          if (input.action === "cancel") {
            const cancelled = await runtime.mutations.cancelPendingMutation(
              auth.userId,
              input.confirmationId,
            );
            return cancelled
              ? Response.json({ status: "cancelled" }, { headers })
              : response("mutation_not_pending", 409);
          }

          const pending = await runtime.mutations.claimPendingMutation(
            auth.userId,
            input.confirmationId,
          );
          if (!pending) return response("mutation_not_pending_or_expired", 409);
          let saved = false;
          try {
            if (pending.operation === "character_create") {
              const rawSnapshot = pending.payload.snapshot;
              const snapshot =
                rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
                  ? (rawSnapshot as CharacterSnapshot)
                  : null;
              const plannedCharacterId = pending.payload.plannedCharacterId;
              if (
                !snapshot ||
                pending.payload.ruleset !== CHARACTER_RULESET ||
                typeof plannedCharacterId !== "string" ||
                !/^[0-9a-f-]{36}$/i.test(plannedCharacterId)
              ) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("invalid_character_create_preview", 409);
              }
              const validation = validateCharacterCreationDraftSnapshot(snapshot);
              if (!validation.ok) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("invalid_character_snapshot", 409);
              }
              const existing = await runtime.characters.list(auth.userId);
              if (
                String(snapshot.nome ?? "").trim() &&
                existing.some(
                  (character) =>
                    character.name === String(snapshot.nome) && character.status !== "archived",
                )
              ) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("character_name_already_exists", 409);
              }
              const created = await runtime.characters.create(
                auth.userId,
                plannedCharacterId,
                snapshot,
                CHARACTER_RULESET,
                mechanicalFingerprint(snapshot),
              );
              const thread = await runtime.chat.getThreadById(auth.userId, pending.threadId);
              if (!thread || !runtime.chat.updatePlayerExperience) {
                return response("character_create_activation_failed", 409);
              }
              const activated = await runtime.chat.updatePlayerExperience(
                auth.userId,
                thread.id,
                null,
                created.id,
              );
              if (!activated) return response("character_create_activation_failed", 409);
              saved = true;
              await runtime.mutations.completePendingMutation(auth.userId, pending.id);
              return Response.json(
                {
                  status: "confirmed",
                  operation: pending.operation,
                  character: {
                    id: created.id,
                    name: created.name,
                    status: created.status,
                    version: created.version,
                  },
                },
                { headers },
              );
            }
            if (pending.operation === "character_creation_patch") {
              const character = await runtime.characters.get(auth.userId, pending.characterId);
              const patch = pending.payload.patch;
              if (!character || !patch || typeof patch !== "object" || Array.isArray(patch)) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("invalid_character_creation_patch", 409);
              }
              if (!("draft" === character.status || "rejected" === character.status)) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("character_not_editable", 409);
              }
              if (character.version !== pending.expectedVersion) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("stale_character_version", 409);
              }
              const snapshot = mergeCharacterCreationPatch(character.snapshot, patch);
              const currentErrors = new Set(
                validateCharacterSnapshot(character.snapshot, false).errors,
              );
              const newErrors = validateCharacterSnapshot(snapshot, false).errors.filter(
                (error) => !currentErrors.has(error),
              );
              if (newErrors.length) {
                await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
                return response("invalid_character_creation_patch", 409);
              }
              const updated = await runtime.characters.save(
                auth.userId,
                character.id,
                snapshot,
                mechanicalFingerprint(snapshot),
                pending.expectedVersion,
              );
              saved = true;
              await runtime.mutations.completePendingMutation(auth.userId, pending.id);
              return Response.json(
                {
                  status: "confirmed",
                  operation: pending.operation,
                  character: {
                    id: updated.id,
                    name: updated.name,
                    status: updated.status,
                    version: updated.version,
                    snapshot: updated.snapshot,
                  },
                },
                { headers },
              );
            }
            const character = await runtime.characters?.get(auth.userId, pending.characterId);
            if (!character) {
              await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
              return response("character_not_found", 404);
            }
            if (!["draft", "rejected"].includes(character.status)) {
              await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
              return response("character_not_editable", 409);
            }
            const currentBiography =
              typeof character.snapshot.biografia === "string"
                ? character.snapshot.biografia.trim()
                : "";
            if (
              character.version !== pending.expectedVersion ||
              currentBiography !== pending.beforeBiography
            ) {
              await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
              return response("stale_character_version", 409);
            }
            const nextSnapshot: CharacterSnapshot = {
              ...character.snapshot,
              biografia: pending.nextBiography,
            };
            const updated = await runtime.characters.save(
              auth.userId,
              character.id,
              nextSnapshot,
              mechanicalFingerprint(nextSnapshot),
              pending.expectedVersion,
            );
            saved = true;
            await runtime.mutations.completePendingMutation(auth.userId, pending.id);
            return Response.json(
              {
                status: "confirmed",
                operation: pending.operation,
                character: {
                  id: updated.id,
                  name: updated.name,
                  version: updated.version,
                  biography:
                    typeof updated.snapshot.biografia === "string"
                      ? updated.snapshot.biografia.trim().slice(0, 2_500)
                      : "",
                },
              },
              { headers },
            );
          } catch (error) {
            if (!saved) await runtime.mutations.releasePendingMutation(auth.userId, pending.id);
            const code = error instanceof Error ? error.message : "mutation_failed";
            return response(
              code === "stale_character_version" ? code : "mutation_failed",
              code === "stale_character_version" ? 409 : 409,
            );
          }
        } finally {
          runtime.close();
        }
      },
    },
  },
});
