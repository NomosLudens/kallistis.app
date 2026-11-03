import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user.server";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";
import { createBunPostgresExecutor } from "@/server/local-core/postgres";
import type { SqlExecutor } from "@/server/local-core/postgres";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { characterOfficeRules } from "@/server/characters/character-canon";
import { canSoloMasterAdjudicateOwnCoroAction, maxCoroBars, NEXO_RULESETS, isNexoRuleset } from "@/server/nexo/engine";
import { CORO_EFFECTS, coroConsentParticipants, getCoroEffect } from "@/server/nexo/coro-catalog";

const headers = { "Cache-Control": "no-store" };
const PAPERS = new Set(["Vanguarda", "Artilharia", "Amparo", "Bastião"]);
type ActiveMember = { user_id: string; member_role: string };
function error(code: string, status = 400) { return Response.json({ error: code }, { status, headers }); }
async function readBody(request: Request) { try { return await request.json() as Record<string, unknown>; } catch { return null; } }
function activePaper(raw: unknown): { paper: string; office: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as Record<string, unknown>;
  const trails = Array.isArray(snapshot.trilhas) ? snapshot.trilhas : [];
  const index = Number.isInteger(snapshot.trilhaAtiva) ? Number(snapshot.trilhaAtiva) : 0;
  const trail = trails[index];
  if (!trail || typeof trail !== "object" || Array.isArray(trail)) return null;
  const fields = trail as Record<string, unknown>;
  const office = typeof fields.oficio === "string" ? fields.oficio.trim() : "";
  const paper = typeof fields.papel === "string" ? fields.papel.trim() : "";
  const rules = characterOfficeRules(office);
  return PAPERS.has(paper) && rules?.roles.includes(paper) ? { paper, office } : null;
}
function failureStatus(code: string) {
  if (code.endsWith("_forbidden")) return 403;
  if (code.endsWith("_not_found")) return 404;
  if (code.includes("not_owned_or_linked")) return 403;
  if (code.includes("_unavailable")) return 503;
  if (/(?:_not_nexo|_duplicate|_already|_full|_round|_pending|_paper|_contribution|_adjudicator|_manifestation|_consent|_activation|_bars|_participant|_window|_action_available)/.test(code)) return 409;
  return 400;
}
async function activeMembers(tx: Pick<SqlExecutor, "query">, mesaId: string) {
  return tx.query<ActiveMember>(`SELECT user_id::text AS user_id,member_role FROM public.mesa_members WHERE mesa_id=$1 AND membership_status='active' ORDER BY user_id`, [mesaId]);
}
function activeIdentityIds(members: readonly ActiveMember[]) { return [...new Set(members.map((member) => member.user_id))]; }
async function linkedCharacters(tx: Pick<SqlExecutor, "query">, mesaId: string) {
  return tx.query<Record<string, unknown>>(`SELECT c.id,c.snapshot,c.owner_user_id FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id JOIN public.mesa_members mm ON mm.mesa_id=cm.mesa_id AND mm.user_id=c.owner_user_id AND mm.membership_status='active' WHERE cm.mesa_id=$1 AND c.ruleset = ANY($2::text[]) AND c.status <> 'archived' ORDER BY c.created_at,c.id`, [mesaId,NEXO_RULESETS]);
}
function eligibleParticipantIds(characters: readonly Record<string, unknown>[]) {
  return [...new Set(characters.filter((row) => activePaper(row.snapshot)).map((row) => String(row.owner_user_id)))];
}
function validText(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max ? value.trim() : "";
}

export const Route = createFileRoute("/api/nexo/coro")({ server: { handlers: {
  GET: async ({ request }) => {
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const mesaId = new URL(request.url).searchParams.get("mesaId"); if (!mesaId) return error("mesa_id_required");
    const url = getRuntimeDatabaseUrl(); if (!url) return error("database_unavailable", 503);
    const sql = createBunPostgresExecutor(url);
    try {
      const members = await activeMembers(sql, mesaId);
      const access = members.find((member) => member.user_id === auth.userId);
      if (!access) return error("mesa_access_forbidden", 403);
      const mesa = await sql.query<{ name: string; ruleset: string | null }>(`SELECT name,ruleset FROM public.mesas WHERE id=$1`, [mesaId]);
      if (!mesa[0]) return error("mesa_not_found", 404);
      if (!isNexoRuleset(mesa[0].ruleset)) return error("mesa_ruleset_not_nexo", 409);
      const characters = await linkedCharacters(sql, mesaId);
      const eligibleIds = eligibleParticipantIds(characters);
      const state = await sql.query<Record<string, unknown>>(`SELECT bars,pulses_in_current_bar,round_number,activation_used,version,updated_at FROM public.nexo_coro_state WHERE mesa_id=$1`, [mesaId]);
      const contributions = await sql.query<Record<string, unknown>>(`SELECT cc.id,cc.character_id,c.snapshot->>'nome' AS character_name,cc.contributor_user_id,cc.round_number,cc.active_paper,cc.action_description,cc.status,cc.adjudicator_user_id,cc.adjudication_note,cc.created_at,cc.adjudicated_at FROM public.nexo_coro_contributions cc JOIN public.characters c ON c.id=cc.character_id WHERE cc.mesa_id=$1 ORDER BY cc.created_at DESC,cc.id DESC LIMIT 50`, [mesaId]);
      const manifestations = await sql.query<Record<string, unknown>>(`SELECT m.id,m.mesa_id,m.round_number,m.proposer_user_id,m.leader_character_id,c.snapshot->>'nome' AS leader_character_name,m.active_paper,m.level,m.bars_required,m.effect_name,m.action_type,m.narrative,m.action_context,m.intent,m.target_scope,m.status,m.adjudicator_user_id,m.action_available_confirmed,m.timing_window_confirmed,m.adjudication_note,m.outcome,m.created_at,m.manifested_at FROM public.nexo_coro_manifestations m JOIN public.characters c ON c.id=m.leader_character_id WHERE m.mesa_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 30`, [mesaId]);
      const consents = await sql.query<Record<string, unknown>>(`SELECT mc.manifestation_id,mc.participant_user_id,mc.member_role_snapshot,mc.response,mc.responded_at,COALESCE(NULLIF(p.display_name,''),'Participante') AS display_name FROM public.nexo_coro_manifestation_consents mc LEFT JOIN public.profiles p ON p.id=mc.participant_user_id WHERE mc.manifestation_id IN (SELECT id FROM public.nexo_coro_manifestations WHERE mesa_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30) ORDER BY mc.manifestation_id,mc.participant_user_id`, [mesaId]);
      const characterView = characters.map((row) => {
        const role = activePaper(row.snapshot);
        return { id: row.id, name: (row.snapshot as Record<string, unknown>)?.nome ?? "Personagem", isOwner: row.owner_user_id === auth.userId, activePaper: role?.paper ?? null, office: role?.office ?? null };
      });
      const pending = contributions.filter((entry) => entry.status === "pending").length;
      const soloAllowed = canSoloMasterAdjudicateOwnCoroAction({ memberRole: access.member_role, contributorUserId: auth.userId, adjudicatorUserId: auth.userId, activeMesaParticipantUserIds: activeIdentityIds(members) });
      const contributionView = contributions.map((entry) => ({ ...entry, canAdjudicate: access.member_role === "mestre" && (entry.contributor_user_id !== auth.userId || soloAllowed) }));
      const ownManifestations: Record<string, unknown>[] = manifestations.map((manifestation) => {
        const votes = consents.filter((vote) => vote.manifestation_id === manifestation.id);
        const currentVote = votes.find((vote) => vote.participant_user_id === auth.userId);
        const agreed = votes.filter((vote) => vote.response === "agreed").length;
        const declined = votes.some((vote) => vote.response === "declined");
        const activeParticipants = votes.map((vote) => String(vote.participant_user_id));
        const maySelfAdjudicate = canSoloMasterAdjudicateOwnCoroAction({ memberRole: access.member_role, contributorUserId: String(manifestation.proposer_user_id), adjudicatorUserId: auth.userId, activeMesaParticipantUserIds: activeIdentityIds(members) });
        return { ...manifestation, consents: votes, consentCount: votes.length, agreedCount: agreed, declined, currentUserIsParticipant: activeParticipants.includes(auth.userId), currentUserConsent: currentVote?.response ?? null, canAdjudicate: access.member_role === "mestre" && (manifestation.proposer_user_id !== auth.userId || maySelfAdjudicate), canCancel: manifestation.proposer_user_id === auth.userId || access.member_role === "mestre" };
      });
      const activeManifestation = ownManifestations.find((entry) => entry.status === "pending_consent" || entry.status === "ready") ?? null;
      const participants = await sql.query<Record<string, unknown>>(`SELECT mm.user_id::text AS user_id,mm.member_role,COALESCE(NULLIF(p.display_name,''),'Participante') AS display_name FROM public.mesa_members mm LEFT JOIN public.profiles p ON p.id=mm.user_id WHERE mm.mesa_id=$1 AND mm.membership_status='active' ORDER BY mm.member_role,display_name`, [mesaId]);
      const resistanceAssignments = await sql.query<Record<string, unknown>>(`SELECT character_id,action_description,resistance,created_at FROM public.nexo_resistance_assignments WHERE mesa_id=$1 AND consumed_at IS NULL`, [mesaId]);
      return Response.json({
        mesa: mesa[0].name, ruleset: mesa[0].ruleset,
        characterCount: characters.length, eligibleCharacterCount: eligibleIds.length, maxBars: maxCoroBars(eligibleIds.length),
        currentUserId: auth.userId, participants, resistanceAssignments, activeParticipantCount: activeIdentityIds(members).length,
        state: state[0] ?? null, contributions: contributionView, characters: characterView,
        manifestations: ownManifestations, activeManifestation, manifestationOptions: CORO_EFFECTS,
        canManage: access.member_role === "mestre", pendingCount: pending,
      }, { headers });
    } finally { sql.close(); }
  },
  POST: async ({ request }) => {
    if (!isSameOriginRequest(request, process.env.KALLISTIS_PUBLIC_ORIGIN || "https://genesis.kallistis.app")) return error("csrf_rejected", 403);
    const auth = await requireUser(request); if ("error" in auth) return auth.error;
    const body = await readBody(request); if (!body) return error("invalid_json");
    const mesaId = typeof body.mesaId === "string" ? body.mesaId : "";
    const action = typeof body.action === "string" ? body.action : "";
    const actions = ["initialize", "submit_contribution", "adjudicate_contribution", "advance_round", "propose_manifestation", "respond_manifestation_consent", "finalize_manifestation", "cancel_manifestation", "set_resistance"];
    if (!mesaId || !actions.includes(action)) return error("coro_action_invalid", 422);
    const url = getRuntimeDatabaseUrl(); if (!url) return error("database_unavailable", 503);
    const sql = createBunPostgresExecutor(url);
    try {
      const result = await sql.transaction!(async (tx) => {
        const memberRows = await tx.query<ActiveMember>(`SELECT user_id::text AS user_id,member_role FROM public.mesa_members WHERE mesa_id=$1 AND membership_status='active' ORDER BY user_id FOR UPDATE`, [mesaId]);
        const member = memberRows.find((row) => row.user_id === auth.userId);
        if (!member) throw new Error("coro_manage_forbidden");
        const mesa = await tx.query<{ ruleset: string | null }>(`SELECT ruleset FROM public.mesas WHERE id=$1 FOR UPDATE`, [mesaId]);
        if (!mesa[0]) throw new Error("mesa_not_found");
        if (!isNexoRuleset(mesa[0].ruleset)) throw new Error("mesa_ruleset_not_nexo");
        if (action === "initialize" && member.member_role !== "mestre") throw new Error("coro_manage_forbidden");
        if (action === "set_resistance") {
          if (member.member_role !== "mestre") throw new Error("coro_resistance_set_forbidden");
          const characterId = typeof body.characterId === "string" ? body.characterId : "";
          const actionDescription = validText(body.actionDescription, 1, 1000);
          const resistance = Number(body.resistance);
          if (!characterId || !actionDescription || !Number.isInteger(resistance) || resistance < 0 || resistance > 100) throw new Error("coro_resistance_invalid");
          const linked = await tx.query(`SELECT 1 FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id WHERE cm.mesa_id=$1 AND cm.character_id=$2 AND c.ruleset = ANY($3::text[]) AND c.status <> 'archived' FOR UPDATE`, [mesaId,characterId,NEXO_RULESETS]);
          if (!linked.length) throw new Error("coro_character_not_found");
          const locked = await tx.query(`SELECT 1 FROM public.nexo_action_submissions WHERE mesa_id=$1 AND character_id=$2 AND status IN ('pending','ready') LIMIT 1 FOR UPDATE`, [mesaId,characterId]);
          if (locked.length) throw new Error("nexo_resistance_locked_by_action");
          const rows = await tx.query<Record<string, unknown>>(`INSERT INTO public.nexo_resistance_assignments(mesa_id,character_id,action_description,resistance,set_by_user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (mesa_id,character_id) WHERE consumed_at IS NULL DO UPDATE SET action_description=EXCLUDED.action_description,resistance=EXCLUDED.resistance,set_by_user_id=EXCLUDED.set_by_user_id,created_at=now() RETURNING character_id,action_description,resistance,created_at`, [mesaId,characterId,actionDescription,resistance,auth.userId]);
          return { resistanceAssignment: rows[0] };
        }
        await tx.query(`INSERT INTO public.nexo_coro_state(mesa_id) VALUES($1) ON CONFLICT(mesa_id) DO NOTHING`, [mesaId]);
        const states = await tx.query<Record<string, unknown>>(`SELECT bars,pulses_in_current_bar,round_number,activation_used,version FROM public.nexo_coro_state WHERE mesa_id=$1 FOR UPDATE`, [mesaId]);
        const state = states[0]!;

        if (action === "initialize") return { state };


        if (action === "submit_contribution") {
          const characterId = typeof body.characterId === "string" ? body.characterId : "";
          const description = validText(body.actionDescription, 8, 1000);
          if (!characterId || !description) throw new Error("coro_action_description_invalid");
          const characters = await tx.query<Record<string, unknown>>(`SELECT c.id,c.snapshot,c.owner_user_id FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id WHERE cm.mesa_id=$1 AND c.id=$2 AND c.ruleset = ANY($3::text[]) AND c.status <> 'archived' AND c.owner_user_id=$4 FOR UPDATE`, [mesaId,characterId,NEXO_RULESETS,auth.userId]);
          if (!characters.length) throw new Error("coro_character_not_owned_or_linked");
          const role = activePaper(characters[0].snapshot);
          if (!role) throw new Error("coro_active_paper_missing_or_invalid");
          const duplicate = await tx.query(`SELECT 1 FROM public.nexo_coro_contributions WHERE mesa_id=$1 AND character_id=$2 AND round_number=$3 AND status IN ('pending','approved')`, [mesaId,characterId,state.round_number]);
          if (duplicate.length) throw new Error("coro_contribution_duplicate");
          const participantRows = await linkedCharacters(tx, mesaId);
          const cap = maxCoroBars(eligibleParticipantIds(participantRows).length);
          if (Number(state.bars) >= cap) throw new Error("coro_bars_full");
          const inserted = await tx.query<Record<string, unknown>>(`INSERT INTO public.nexo_coro_contributions(mesa_id,character_id,contributor_user_id,round_number,active_paper,action_description) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,mesa_id,character_id,contributor_user_id,round_number,active_paper,action_description,status,created_at`, [mesaId,characterId,auth.userId,state.round_number,role.paper,description]);
          return { contribution: inserted[0] };
        }

        if (action === "adjudicate_contribution") {
          if (member.member_role !== "mestre") throw new Error("coro_manage_forbidden");
          const contributionId = typeof body.contributionId === "string" ? body.contributionId : "";
          const approved = body.approved === true;
          const note = typeof body.note === "string" ? body.note.trim().slice(0,500) : "";
          const records = await tx.query<Record<string, unknown>>(`SELECT * FROM public.nexo_coro_contributions WHERE id=$1 AND mesa_id=$2 FOR UPDATE`, [contributionId,mesaId]);
          const contribution = records[0];
          if (!contribution) throw new Error("coro_contribution_not_found");
          if (contribution.status !== "pending") throw new Error("coro_contribution_already_adjudicated");
          if (contribution.contributor_user_id === auth.userId) {
            if (!canSoloMasterAdjudicateOwnCoroAction({ memberRole: member.member_role, contributorUserId: String(contribution.contributor_user_id), adjudicatorUserId: auth.userId, activeMesaParticipantUserIds: activeIdentityIds(memberRows) })) throw new Error("coro_self_adjudication_requires_solo_mesa");
          }
          if (Number(contribution.round_number) !== Number(state.round_number)) throw new Error("coro_contribution_round_stale");
          let nextState = state;
          if (approved) {
            const characters = await tx.query<Record<string, unknown>>(`SELECT c.snapshot,c.owner_user_id FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id WHERE cm.mesa_id=$1 AND c.id=$2 AND c.ruleset = ANY($3::text[]) AND c.status <> 'archived' FOR UPDATE`, [mesaId,contribution.character_id,NEXO_RULESETS]);
            if (!characters.length) throw new Error("coro_character_not_found");
            if (characters[0].owner_user_id !== contribution.contributor_user_id) throw new Error("coro_character_owner_changed");
            const role = activePaper(characters[0].snapshot);
            if (!role || role.paper !== contribution.active_paper) throw new Error("coro_active_paper_changed");
            const participantRows = await linkedCharacters(tx, mesaId);
            const cap = maxCoroBars(eligibleParticipantIds(participantRows).length);
            if (Number(state.bars) >= cap) throw new Error("coro_bars_full");
            const pulses = Number(state.pulses_in_current_bar) + 1;
            const bars = Number(state.bars) + (pulses === 4 ? 1 : 0);
            if (bars > cap) throw new Error("coro_bars_full");
            const updated = await tx.query<Record<string, unknown>>(`UPDATE public.nexo_coro_state SET bars=$2,pulses_in_current_bar=$3,version=version+1,updated_at=now() WHERE mesa_id=$1 RETURNING bars,pulses_in_current_bar,round_number,activation_used,version,updated_at`, [mesaId,bars,pulses === 4 ? 0 : pulses]);
            nextState = updated[0]!;
            await tx.query(`UPDATE public.nexo_coro_contributions SET status='approved',adjudicator_user_id=$2,adjudication_note=$3,adjudicated_at=now() WHERE id=$1`, [contributionId,auth.userId,note]);
            await tx.query(`INSERT INTO public.nexo_coro_events(mesa_id,actor_user_id,event_type,amount,reason,state_version) VALUES($1,$2,'pulse_gain',1,$3,$4)`, [mesaId,auth.userId,`Contribuição aprovada (${contribution.active_paper})`,nextState.version]);
          } else {
            await tx.query(`UPDATE public.nexo_coro_contributions SET status='rejected',adjudicator_user_id=$2,adjudication_note=$3,adjudicated_at=now() WHERE id=$1`, [contributionId,auth.userId,note]);
          }
          return { contributionId, status: approved ? "approved" : "rejected", state: nextState };
        }

        if (action === "propose_manifestation") {
          const characterId = typeof body.characterId === "string" ? body.characterId : "";
          const narrative = validText(body.narrative, 8, 1000);
          const level = Number(body.level);
          const requestedIds = Array.isArray(body.participantUserIds) ? body.participantUserIds.filter((id): id is string => typeof id === "string") : [];
          if (!characterId || !narrative || !requestedIds.length) throw new Error("coro_manifestation_input_invalid");
          const characters = await tx.query<Record<string, unknown>>(`SELECT c.id,c.snapshot,c.owner_user_id FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id WHERE cm.mesa_id=$1 AND c.id=$2 AND c.ruleset = ANY($3::text[]) AND c.status <> 'archived' AND c.owner_user_id=$4 FOR UPDATE`, [mesaId,characterId,NEXO_RULESETS,auth.userId]);
          if (!characters.length) throw new Error("coro_character_not_owned_or_linked");
          const role = activePaper(characters[0].snapshot);
          if (!role) throw new Error("coro_active_paper_missing_or_invalid");
          const effect = getCoroEffect(role.paper, level);
          if (!effect) throw new Error("coro_manifestation_level_invalid");
          if (state.activation_used) throw new Error("coro_activation_already_used");
          if (Number(state.bars) < level) throw new Error("coro_manifestation_bars_insufficient");
          const open = await tx.query(`SELECT 1 FROM public.nexo_coro_manifestations WHERE mesa_id=$1 AND round_number=$2 AND status IN ('pending_consent','ready','manifested')`, [mesaId,state.round_number]);
          if (open.length) throw new Error("coro_manifestation_already_open_or_used");
          const currentMembers = await activeMembers(tx, mesaId);
          const participantIds = coroConsentParticipants(currentMembers.map((m) => ({ userId: m.user_id, memberRole: m.member_role })), requestedIds, auth.userId);
          const roleById = new Map(currentMembers.map((m) => [m.user_id,m.member_role]));
          if (!participantIds.length || participantIds.some((id) => !roleById.has(id))) throw new Error("coro_manifestation_participant_not_active");
          const inserted = await tx.query<Record<string, unknown>>(`INSERT INTO public.nexo_coro_manifestations(mesa_id,round_number,proposer_user_id,leader_character_id,active_paper,level,bars_required,effect_name,action_type,action_context,intent,target_scope,narrative) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'','',$10) RETURNING *`, [mesaId,state.round_number,auth.userId,characterId,role.paper,level,effect.name,effect.actionType,narrative,narrative]);
          const manifestation = inserted[0]!;
          for (const participantUserId of participantIds) {
            await tx.query(`INSERT INTO public.nexo_coro_manifestation_consents(manifestation_id,participant_user_id,member_role_snapshot) VALUES($1,$2,$3)`, [manifestation.id,participantUserId,roleById.get(participantUserId)]);
          }
          return { manifestation, consentCount: participantIds.length };
        }

        if (action === "respond_manifestation_consent") {
          const manifestationId = typeof body.manifestationId === "string" ? body.manifestationId : "";
          const agreed = body.agreed === true;
          const records = await tx.query<Record<string, unknown>>(`SELECT * FROM public.nexo_coro_manifestations WHERE id=$1 AND mesa_id=$2 FOR UPDATE`, [manifestationId,mesaId]);
          const manifestation = records[0];
          if (!manifestation) throw new Error("coro_manifestation_not_found");
          if (manifestation.status !== "pending_consent") throw new Error("coro_manifestation_consent_closed");
          if (Number(manifestation.round_number) !== Number(state.round_number)) throw new Error("coro_manifestation_round_stale");
          const votes = await tx.query<Record<string, unknown>>(`SELECT participant_user_id,response,member_role_snapshot FROM public.nexo_coro_manifestation_consents WHERE manifestation_id=$1 ORDER BY participant_user_id FOR UPDATE`, [manifestationId]);
          const myVote = votes.find((vote) => vote.participant_user_id === auth.userId);
          if (!myVote) throw new Error("coro_manifestation_consent_forbidden");
          if (myVote.response !== "pending") throw new Error("coro_manifestation_consent_already_recorded");
          const currentMembers = await activeMembers(tx, mesaId);
          const currentRole = currentMembers.find((entry) => entry.user_id === auth.userId)?.member_role;
          if (currentRole !== myVote.member_role_snapshot) throw new Error("coro_manifestation_participant_changed");
          await tx.query(`UPDATE public.nexo_coro_manifestation_consents SET response=$3,responded_at=now() WHERE manifestation_id=$1 AND participant_user_id=$2`, [manifestationId,auth.userId,agreed ? "agreed" : "declined"]);
          let status = "pending_consent";
          if (!agreed) status = "declined";
          else if (votes.every((vote) => vote.participant_user_id === auth.userId || vote.response === "agreed")) status = "ready";
          if (status !== "pending_consent") await tx.query(`UPDATE public.nexo_coro_manifestations SET status=$2 WHERE id=$1`, [manifestationId,status]);
          return { manifestationId,status,response:agreed ? "agreed" : "declined" };
        }

        if (action === "finalize_manifestation") {
          if (member.member_role !== "mestre") throw new Error("coro_manifestation_adjudicator_forbidden");
          const manifestationId = typeof body.manifestationId === "string" ? body.manifestationId : "";
          const adjudicationNote = validText(body.adjudicationNote, 0, 1000);
          const outcome = validText(body.outcome, 8, 1500);
          if (!outcome) throw new Error("coro_manifestation_outcome_required");
          const records = await tx.query<Record<string, unknown>>(`SELECT * FROM public.nexo_coro_manifestations WHERE id=$1 AND mesa_id=$2 FOR UPDATE`, [manifestationId,mesaId]);
          const manifestation = records[0];
          if (!manifestation) throw new Error("coro_manifestation_not_found");
          if (manifestation.status !== "ready") throw new Error("coro_manifestation_consents_incomplete");
          if (Number(manifestation.round_number) !== Number(state.round_number)) throw new Error("coro_manifestation_round_stale");
          if (state.activation_used) throw new Error("coro_activation_already_used");
          if (Number(state.bars) < Number(manifestation.bars_required)) throw new Error("coro_manifestation_bars_insufficient");
          if (manifestation.proposer_user_id === auth.userId && !canSoloMasterAdjudicateOwnCoroAction({ memberRole: member.member_role, contributorUserId: String(manifestation.proposer_user_id), adjudicatorUserId: auth.userId, activeMesaParticipantUserIds: activeIdentityIds(memberRows) })) throw new Error("coro_self_adjudication_requires_solo_mesa");
          const effect = getCoroEffect(manifestation.active_paper, manifestation.level);
          if (!effect || effect.name !== manifestation.effect_name || effect.actionType !== manifestation.action_type) throw new Error("coro_manifestation_canonical_effect_changed");
          const leader = await tx.query<Record<string, unknown>>(`SELECT c.snapshot,c.owner_user_id FROM public.character_mesas cm JOIN public.characters c ON c.id=cm.character_id WHERE cm.mesa_id=$1 AND c.id=$2 AND c.ruleset = ANY($3::text[]) AND c.status <> 'archived' FOR UPDATE`, [mesaId,manifestation.leader_character_id,NEXO_RULESETS]);
          if (!leader.length || leader[0].owner_user_id !== manifestation.proposer_user_id) throw new Error("coro_manifestation_leader_changed");
          const currentRole = activePaper(leader[0].snapshot);
          if (!currentRole || currentRole.paper !== manifestation.active_paper) throw new Error("coro_active_paper_changed");
          const currentMembers = await activeMembers(tx, mesaId);
          const votes = await tx.query<Record<string, unknown>>(`SELECT participant_user_id,response,member_role_snapshot FROM public.nexo_coro_manifestation_consents WHERE manifestation_id=$1 ORDER BY participant_user_id FOR UPDATE`, [manifestationId]);
          const participantIds = votes.map((vote) => String(vote.participant_user_id));
          if (!participantIds.includes(String(manifestation.proposer_user_id)) || participantIds.some((id) => !currentMembers.some((m) => m.user_id === id))) throw new Error("coro_manifestation_participants_changed");
          if (votes.some((vote) => vote.response !== "agreed")) throw new Error("coro_manifestation_consents_incomplete");
          if (votes.some((vote) => currentMembers.find((m) => m.user_id === vote.participant_user_id)?.member_role !== vote.member_role_snapshot)) throw new Error("coro_manifestation_participant_changed");
          const nextStateRows = await tx.query<Record<string, unknown>>(`UPDATE public.nexo_coro_state SET bars=bars-$2,activation_used=true,version=version+1,updated_at=now() WHERE mesa_id=$1 AND round_number=$3 AND activation_used=false AND bars >= $2 RETURNING bars,pulses_in_current_bar,round_number,activation_used,version,updated_at`, [mesaId,manifestation.bars_required,state.round_number]);
          if (!nextStateRows.length) throw new Error("coro_manifestation_state_changed");
          const nextState = nextStateRows[0]!;
          const updated = await tx.query<Record<string, unknown>>(`UPDATE public.nexo_coro_manifestations SET status='manifested',adjudicator_user_id=$2,action_available_confirmed=true,timing_window_confirmed=true,adjudication_note=$3,outcome=$4,manifested_at=now() WHERE id=$1 AND status='ready' RETURNING *`, [manifestationId,auth.userId,adjudicationNote,outcome]);
          if (!updated.length) throw new Error("coro_manifestation_already_finalized");
          const reason = `Manifestação ${effect.name} · ${effect.paper} nível ${effect.level}`;
          await tx.query(`INSERT INTO public.nexo_coro_events(mesa_id,actor_user_id,event_type,amount,reason,state_version,manifestation_id) VALUES($1,$2,'pulse_spend',$3,$4,$5,$6)`, [mesaId,auth.userId,manifestation.bars_required,reason,nextState.version,manifestationId]);
          await tx.query(`INSERT INTO public.nexo_coro_events(mesa_id,actor_user_id,event_type,amount,reason,state_version,manifestation_id) VALUES($1,$2,'activation_used',1,$3,$4,$5)`, [mesaId,auth.userId,reason,nextState.version,manifestationId]);
          return { manifestation: updated[0], state: nextState };
        }

        if (action === "cancel_manifestation") {
          const manifestationId = typeof body.manifestationId === "string" ? body.manifestationId : "";
          const records = await tx.query<Record<string, unknown>>(`SELECT * FROM public.nexo_coro_manifestations WHERE id=$1 AND mesa_id=$2 FOR UPDATE`, [manifestationId,mesaId]);
          const manifestation = records[0];
          if (!manifestation) throw new Error("coro_manifestation_not_found");
          if (manifestation.proposer_user_id !== auth.userId && member.member_role !== "mestre") throw new Error("coro_manifestation_cancel_forbidden");
          if (manifestation.status !== "pending_consent" && manifestation.status !== "ready") throw new Error("coro_manifestation_cannot_cancel");
          await tx.query(`UPDATE public.nexo_coro_manifestations SET status='cancelled' WHERE id=$1`, [manifestationId]);
          return { manifestationId,status:"cancelled",resourceConsumed:false };
        }

        if (member.member_role !== "mestre") throw new Error("coro_manage_forbidden");
        const pending = await tx.query(`SELECT 1 FROM public.nexo_coro_contributions WHERE mesa_id=$1 AND status='pending' UNION ALL SELECT 1 FROM public.nexo_coro_manifestations WHERE mesa_id=$1 AND status IN ('pending_consent','ready') LIMIT 1`, [mesaId]);
        if (pending.length) throw new Error("coro_contributions_or_manifestations_pending");
        const next = await tx.query<Record<string, unknown>>(`UPDATE public.nexo_coro_state SET round_number=round_number+1,activation_used=false,version=version+1,updated_at=now() WHERE mesa_id=$1 RETURNING bars,pulses_in_current_bar,round_number,activation_used,version,updated_at`, [mesaId]);
        await tx.query(`INSERT INTO public.nexo_coro_events(mesa_id,actor_user_id,event_type,amount,reason,state_version) VALUES($1,$2,'round_advanced',1,'Avanço de rodada pelo Mestre', $3)`, [mesaId,auth.userId,next[0]!.version]);
        return { state: next[0] };
      });
      return Response.json(result, { status: action === "submit_contribution" || action === "propose_manifestation" ? 201 : 200, headers });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "coro_operation_failed";
      return error(code,failureStatus(code));
    } finally { sql.close(); }
  },
} } });
