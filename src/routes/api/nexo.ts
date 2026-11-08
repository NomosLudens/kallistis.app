import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { createPostgresCharacterRepository } from "@/server/characters/repository";
import { CHARACTER_FORGE_CHOICE_CATALOG } from "@/server/characters/character-choice-registry";
import { mechanicalFingerprint } from "@/server/characters/character-canon";
import { MAGIC_FORMS } from "@/server/characters/magic-forms";
import {
  NEXO_RULESET,
  isNexoRuleset,
  rollNexo,
  validateAcceptedArguments,
  validateLearnedForms,
  validateNexoCharacterCreation,
} from "@/server/nexo/engine";

const headers = { "Cache-Control": "no-store" };
const runtime = () => {
  const url = getRuntimeDatabaseUrl();
  return url ? createBunPostgresExecutor(url) : null;
};
async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await request.text();
    if (raw.length > 1_048_576) throw new Error("body_too_large");
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
async function transaction<T>(
  sql: ReturnType<typeof createBunPostgresExecutor>,
  fn: (tx: typeof sql) => Promise<T>,
): Promise<T> {
  if (sql.transaction) return sql.transaction(fn);
  await sql.query("BEGIN");
  try {
    const value = await fn(sql);
    await sql.query("COMMIT");
    return value;
  } catch (cause) {
    await sql.query("ROLLBACK").catch(() => undefined);
    throw cause;
  }
}
function responseError(error: unknown) {
  const code = error instanceof Error ? error.message : "nexo_request_failed";
  const status = code.endsWith("_forbidden")
    ? 403
    : code.endsWith("_not_found")
      ? 404
      : code.startsWith("invalid_") || code.includes("_invalid")
        ? 422
        : 400;
  return Response.json({ error: code }, { status, headers });
}

export const Route = createFileRoute("/api/nexo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const sql = runtime();
        if (!sql) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
        try {
          const characters = await createPostgresCharacterRepository(sql).list(auth.userId);
          const nexoCharacters = characters.filter((c) => isNexoRuleset(c.ruleset));
          const characterIds = nexoCharacters.map((character) => character.id);
          const history = characterIds.length
            ? await sql.query<Record<string, unknown>>(
                `SELECT id,character_id,action_description,arguments_text,arguments_count,resistance,marco,light_die,shadow_die,bonus,total,margin,grade,predominance,resonance,created_at FROM public.nexo_rolls WHERE character_id IN (${characterIds.map((_, index) => `$${index + 1}`).join(",")}) ORDER BY created_at DESC LIMIT 100`,
                characterIds,
              )
            : [];
          const catalog = {
            peoples: CHARACTER_FORGE_CHOICE_CATALOG.peoples,
            origins: CHARACTER_FORGE_CHOICE_CATALOG.origins,
            offices: CHARACTER_FORGE_CHOICE_CATALOG.offices.map((office) => ({
              name: office.name,
              initialTechnique: office.initialTechnique,
              specializations: office.specializations.map((item) => ({ name: item.name })),
            })),
          };
          return Response.json(
            { catalog, characters: nexoCharacters, rolls: history },
            { headers },
          );
        } finally {
          sql.close();
        }
      },
      POST: async ({ request }) => {
        const expectedOrigin =
          process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app";
        if (!isSameOriginRequest(request, expectedOrigin))
          return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
        const auth = await requireUser(request);
        if ("error" in auth) return auth.error;
        const input = await jsonBody(request);
        if (!input) return Response.json({ error: "invalid_json" }, { status: 400, headers });
        const sql = runtime();
        if (!sql) return Response.json({ error: "database_unavailable" }, { status: 503, headers });
        try {
          if (input.action === "create_character") {
            const rawCharacter = input.character;
            if (!rawCharacter || typeof rawCharacter !== "object" || Array.isArray(rawCharacter))
              return Response.json({ error: "nexo_character_invalid", validation: ["invalid_character"] }, { status: 422, headers });
            const value = rawCharacter as Record<string, unknown>;
            const office = CHARACTER_FORGE_CHOICE_CATALOG.offices.find((entry) => entry.name === value.oficio);
            const rawCapacities = value.capacidades && typeof value.capacidades === "object" && !Array.isArray(value.capacidades)
              ? value.capacidades as Record<string, unknown>
              : {};
            const techniques = Array.isArray(rawCapacities.tecnicas) ? [...rawCapacities.tecnicas] : [];
            if (office?.initialTechnique && !techniques.some((item) => {
              const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
              return String(record?.nome || record?.name || item || "").trim() === office.initialTechnique;
            })) techniques.unshift(office.initialTechnique);
            const history = value.historia && typeof value.historia === "object" && !Array.isArray(value.historia)
              ? value.historia as Record<string, unknown>
              : {};
            const snapshot = {
              ...value,
              capacidades: { ...rawCapacities, tecnicas: techniques },
              perguntaPessoal: String(value.perguntaPessoal || history.perguntaPessoal || "").trim(),
              manifestacao_pessoal: String(value.manifestacao_pessoal || history.manifestacaoPessoal || "").trim(),
            };
            const errors = validateNexoCharacterCreation(snapshot, CHARACTER_FORGE_CHOICE_CATALOG);
            if (errors.length)
              return Response.json(
                { error: "nexo_character_invalid", validation: errors },
                { status: 422, headers },
              );
            const full = {
              ruleset: NEXO_RULESET,
              nome: String(value.nome).trim(),
              conceito: String(value.conceito).trim(),
              povo: value.povo,
              origem: value.origem,
              oficio: value.oficio,
              especializacao: value.especializacao,
              marco: value.marco,
              influencia: value.influencia,
              historia: {
                ...history,
                promessa: value.promessa ?? history.promessa,
                vinculo: value.vinculo ?? history.vinculo,
                experiencia: value.experiencia ?? history.experiencia,
                feridaMarcante: value.feridaMarcante ?? history.feridaMarcante,
                perguntaPessoal: snapshot.perguntaPessoal,
                manifestacaoPessoal: snapshot.manifestacao_pessoal,
              },
              promessa: value.promessa,
              vinculo: value.vinculo,
              experiencia: value.experiencia,
              feridaMarcante: value.feridaMarcante,
              perguntaPessoal: snapshot.perguntaPessoal,
              manifestacao_pessoal: snapshot.manifestacao_pessoal,
              capacidades: snapshot.capacidades,
              estado: value.estado,
              completo: true,
            };
            const id = randomUUID();
            const character = await createPostgresCharacterRepository(sql).create(
              auth.userId,
              id,
              full,
              NEXO_RULESET,
              mechanicalFingerprint(full),
            );
            return Response.json({ character }, { status: 201, headers });
          }
          if (input.action === "roll") {
            const characterId = String(input.characterId || "");
            const character = await createPostgresCharacterRepository(sql).get(
              auth.userId,
              characterId,
            );
            if (!character || !isNexoRuleset(character.ruleset))
              return Response.json({ error: "nexo_character_not_found" }, { status: 404, headers });
            const submissionId = typeof input.submissionId === "string" ? input.submissionId : "";
            if (!submissionId) throw new Error("nexo_action_submission_required");
            const snapshot = character.snapshot;
            const result = await transaction(sql, async (tx) => {
              const submissions = await tx.query<Record<string, unknown>>(
                `SELECT s.id,s.mesa_id,s.session_id,s.action_description,s.status,s.resistance_assignment_id,a.resistance
                 FROM public.nexo_action_submissions s
                 JOIN public.nexo_resistance_assignments a ON a.id=s.resistance_assignment_id
                WHERE s.id=$1 AND s.character_id=$2 AND s.actor_user_id=$3 FOR UPDATE OF s,a`,
                [submissionId, characterId, auth.userId],
              );
              const submission = submissions[0];
              if (!submission) throw new Error("nexo_action_not_found");
              if (submission.status !== "ready") throw new Error("nexo_action_arguments_pending");
              const mesaId = String(submission.mesa_id);
              const sessionId = submission.session_id ? String(submission.session_id) : null;
              const access = await tx.query<{ ok: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM public.character_mesas cm JOIN public.mesa_members mm ON mm.mesa_id=cm.mesa_id JOIN public.mesas m ON m.id=cm.mesa_id WHERE cm.mesa_id=$1 AND cm.character_id=$2 AND mm.user_id=$3 AND mm.membership_status='active' AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')) AS ok`,
                [mesaId, characterId, auth.userId],
              );
              if (!access[0]?.ok) throw new Error("session_access_forbidden");
              if (sessionId) {
                const sessionAccess = await tx.query<{ ok: boolean }>(
                  `SELECT EXISTS (SELECT 1 FROM public.mesa_live_sessions s WHERE s.id=$1 AND s.mesa_id=$2 AND s.status='live' AND s.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL')) AS ok`,
                  [sessionId, mesaId],
                );
                if (!sessionAccess[0]?.ok) throw new Error("session_access_forbidden");
              }
              const proposedRows = await tx.query<Record<string, unknown>>(
                `SELECT slot,argument_text,status FROM public.nexo_action_arguments WHERE submission_id=$1 ORDER BY slot`,
                [submissionId],
              );
              if (proposedRows.some((argument) => argument.status === "pending"))
                throw new Error("nexo_action_arguments_pending");
              const requestedArguments = validateAcceptedArguments(
                proposedRows
                  .filter((argument) => argument.status === "accepted")
                  .map((argument) => String(argument.argument_text)),
              );
              const roll = rollNexo({
                marco: Number(snapshot.marco),
                argumentsAccepted: requestedArguments.length,
                resistance: Number(submission.resistance),
              });
              const consumed = await tx.query(
                `UPDATE public.nexo_resistance_assignments SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`,
                [submission.resistance_assignment_id],
              );
              if (!consumed.length) throw new Error("nexo_master_resistance_already_used");
              const insertedRoll = await tx.query<{ id: string }>(
                `INSERT INTO public.nexo_rolls (character_id,actor_user_id,session_id,action_description,arguments_text,arguments_count,resistance,marco,light_die,shadow_die,bonus,total,margin,grade,predominance,resonance) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
                [
                  characterId,
                  auth.userId,
                  sessionId,
                  submission.action_description,
                  JSON.stringify(requestedArguments),
                  roll.arguments,
                  roll.resistance,
                  Number(snapshot.marco),
                  roll.light,
                  roll.shadow,
                  roll.bonus,
                  roll.total,
                  roll.margin,
                  roll.grade,
                  roll.predominance,
                  roll.resonance,
                ],
              );
              const rollId = insertedRoll[0]?.id;
              if (!rollId) throw new Error("nexo_roll_persistence_failed");
              await tx.query(
                `UPDATE public.nexo_action_submissions SET status='resolved',roll_id=$2,resolved_at=now() WHERE id=$1`,
                [submissionId, rollId],
              );
              return roll;
            });
            return Response.json({ roll: result }, { status: 201, headers });
          }
          if (input.action === "learn_form") {
            const characterId = String(input.characterId || "");
            const formId = String(input.formId || "");
            const source =
              typeof input.source === "string" ? input.source.trim().slice(0, 300) : "";
            const condition =
              typeof input.condition === "string" ? input.condition.trim().slice(0, 500) : "";
            const grade = Number(input.grade);
            if (
              !MAGIC_FORMS.some((form) => form.id === formId) ||
              !source ||
              !condition ||
              !Number.isInteger(grade)
            )
              throw new Error("invalid_learned_form");
            const learned = await transaction(sql, async (tx) => {
              const rows = await tx.query<Record<string, unknown>>(
                `SELECT c.id,c.snapshot,c.version,c.ruleset FROM public.characters c WHERE c.id=$1 AND c.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') FOR UPDATE`,
                [characterId],
              );
              const row = rows[0];
              if (!row) throw new Error("nexo_character_not_found");
              const access = await tx.query(
                `SELECT 1 FROM public.character_mesas cm JOIN public.mesa_members mm ON mm.mesa_id=cm.mesa_id JOIN public.mesas m ON m.id=cm.mesa_id WHERE cm.character_id=$1 AND mm.user_id=$2 AND mm.member_role='mestre' AND mm.membership_status='active' AND m.ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL') LIMIT 1`,
                [characterId, auth.userId],
              );
              if (!access.length) throw new Error("form_learning_master_forbidden");
              const snapshot = row.snapshot as Record<string, unknown>;
              if (snapshot.oficio === "Tecelão")
                throw new Error("weaver_progression_uses_existing_rules");
              const capabilities = snapshot.capacidades as Record<string, unknown>;
              const forms = Array.isArray(capabilities.formas) ? [...capabilities.formas] : [];
              const nextForms = [
                ...forms,
                {
                  formId,
                  grade,
                  source,
                  condition,
                  learnedBy: auth.userId,
                  learnedAt: new Date().toISOString(),
                },
              ];
              const errors = validateLearnedForms(
                nextForms,
                Number(snapshot.marco),
                String(snapshot.oficio),
                MAGIC_FORMS.map((form) => form.id),
              );
              if (errors.length) throw new Error("learned_form_invalid");
              const next = { ...snapshot, capacidades: { ...capabilities, formas: nextForms } };
              const before = Number(row.version),
                after = before + 1;
              await tx.query(
                `UPDATE public.characters SET snapshot=$2::jsonb,version=$3,mechanical_fingerprint=$4,updated_at=now() WHERE id=$1`,
                [characterId, next, after, mechanicalFingerprint(next)],
              );
              await tx.query(
                `INSERT INTO public.character_versions(character_id,version,snapshot,reason,actor_user_id) VALUES($1,$2,$3::jsonb,'nexo_form_learned',$4)`,
                [characterId, after, next, auth.userId],
              );
              await tx.query(
                `INSERT INTO public.character_events(character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES($1,$2,'nexo_form_learned',$3::jsonb,$4,$5)`,
                [characterId, auth.userId, { formId, grade, source, condition }, before, after],
              );
              return { characterId, version: after, form: formId };
            });
            return Response.json({ learned }, { status: 201, headers });
          }
          if (input.action === "change_shadow") {
            const characterId = String(input.characterId || "");
            const delta = Number(input.delta);
            const reason = String(input.reason || "")
              .trim()
              .slice(0, 500);
            if (![-1, 1].includes(delta) || reason.length < 3)
              throw new Error("invalid_shadow_change");
            const updated = await transaction(sql, async (tx) => {
              const rows = await tx.query<Record<string, unknown>>(
                `SELECT id,snapshot,version,ruleset FROM public.characters WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
                [characterId, auth.userId],
              );
              const row = rows[0];
              if (!row || !isNexoRuleset(row.ruleset)) throw new Error("nexo_character_not_found");
              const snapshot = row.snapshot as Record<string, unknown>;
              const state = snapshot.estado as Record<string, unknown>;
              const before = Number(state.marcasSombra);
              if (!Number.isInteger(before) || before < 0 || before > 6)
                throw new Error("invalid_shadow_change");
              const after = before + delta;
              if (after < 0 || after > 6) throw new Error("invalid_shadow_change");
              const next = { ...snapshot, estado: { ...state, marcasSombra: after } };
              const versionBefore = Number(row.version);
              const versionAfter = versionBefore + 1;
              await tx.query(
                `UPDATE public.characters SET snapshot=$2::jsonb,version=$3,mechanical_fingerprint=$4,updated_at=now() WHERE id=$1`,
                [characterId, next, versionAfter, mechanicalFingerprint(next)],
              );
              await tx.query(
                `INSERT INTO public.character_versions(character_id,version,snapshot,reason,actor_user_id) VALUES($1,$2,$3::jsonb,'nexo_shadow_change',$4)`,
                [characterId, versionAfter, next, auth.userId],
              );
              await tx.query(
                `INSERT INTO public.character_events(character_id,actor_user_id,event_type,payload,version_before,version_after) VALUES($1,$2,'nexo_shadow_change',$3::jsonb,$4,$5)`,
                [
                  characterId,
                  auth.userId,
                  { before, after, delta, reason },
                  versionBefore,
                  versionAfter,
                ],
              );
              return { characterId, version: versionAfter, marks: after };
            });
            return Response.json({ shadow: updated }, { headers });
          }
          return Response.json({ error: "nexo_action_invalid" }, { status: 400, headers });
        } catch (error) {
          return responseError(error);
        } finally {
          sql.close();
        }
      },
    },
  },
});
