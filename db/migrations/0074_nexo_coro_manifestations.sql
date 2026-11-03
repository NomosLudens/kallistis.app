BEGIN;

DO $nexo_migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0068'
      AND (filename = '0068_nexo_coro_manifestations.sql' OR checksum_sha256 = '34037c595fe2b952cdd70d24cd1e15ea918305be7ed82c94e65d6e4b992a3e4d')
  ) THEN
    RAISE EXCEPTION 'nexo_legacy_migration_0068_already_applied_do_not_replay';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0074' OR filename = '0074_nexo_coro_manifestations.sql'
  ) THEN
    RAISE EXCEPTION 'nexo_migration_0074_already_registered';
  END IF;
END
$nexo_migration_guard$;

CREATE TABLE public.nexo_coro_manifestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  proposer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  leader_character_id text NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  active_paper text NOT NULL CHECK (active_paper IN ('Vanguarda','Artilharia','Amparo','Bastião')),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 3),
  bars_required integer NOT NULL CHECK (bars_required BETWEEN 1 AND 3 AND bars_required = level),
  effect_name text NOT NULL CHECK (length(trim(effect_name)) BETWEEN 1 AND 120),
  action_type text NOT NULL CHECK (action_type IN ('action','reaction')),
  action_context text NOT NULL CHECK (length(trim(action_context)) BETWEEN 8 AND 1000),
  intent text NOT NULL CHECK (length(trim(intent)) BETWEEN 8 AND 1000),
  target_scope text NOT NULL CHECK (length(trim(target_scope)) BETWEEN 8 AND 1000),
  status text NOT NULL DEFAULT 'pending_consent' CHECK (status IN ('pending_consent','ready','declined','cancelled','manifested')),
  adjudicator_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action_available_confirmed boolean NOT NULL DEFAULT false,
  timing_window_confirmed boolean NOT NULL DEFAULT false,
  adjudication_note text NOT NULL DEFAULT '' CHECK (length(adjudication_note) <= 1000),
  outcome text NOT NULL DEFAULT '' CHECK (length(outcome) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  manifested_at timestamptz,
  CHECK ((active_paper = 'Bastião' AND action_type = 'reaction') OR (active_paper <> 'Bastião' AND action_type = 'action')),
  CHECK ((status = 'manifested' AND adjudicator_user_id IS NOT NULL AND action_available_confirmed AND timing_window_confirmed AND length(trim(outcome)) >= 8 AND manifested_at IS NOT NULL)
      OR (status <> 'manifested' AND adjudicator_user_id IS NULL AND NOT action_available_confirmed AND NOT timing_window_confirmed AND outcome = '' AND manifested_at IS NULL))
);

CREATE UNIQUE INDEX nexo_coro_one_open_or_used_manifestation_per_round
  ON public.nexo_coro_manifestations(mesa_id, round_number)
  WHERE status IN ('pending_consent','ready','manifested');
CREATE INDEX nexo_coro_manifestations_history_idx
  ON public.nexo_coro_manifestations(mesa_id, created_at DESC, id DESC);

CREATE TABLE public.nexo_coro_manifestation_consents (
  manifestation_id uuid NOT NULL REFERENCES public.nexo_coro_manifestations(id) ON DELETE RESTRICT,
  participant_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  member_role_snapshot text NOT NULL CHECK (member_role_snapshot IN ('jogador','mestre')),
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','agreed','declined')),
  responded_at timestamptz,
  PRIMARY KEY (manifestation_id, participant_user_id),
  CHECK ((response = 'pending' AND responded_at IS NULL) OR (response <> 'pending' AND responded_at IS NOT NULL))
);
CREATE INDEX nexo_coro_manifestation_consents_user_idx
  ON public.nexo_coro_manifestation_consents(participant_user_id, manifestation_id);

ALTER TABLE public.nexo_coro_events
  ADD COLUMN manifestation_id uuid REFERENCES public.nexo_coro_manifestations(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX nexo_coro_manifestation_event_once
  ON public.nexo_coro_events(manifestation_id, event_type)
  WHERE manifestation_id IS NOT NULL;

ALTER TABLE public.nexo_coro_manifestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_coro_manifestation_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_all ON public.nexo_coro_manifestations FOR ALL TO kallistis USING (true) WITH CHECK (true);
CREATE POLICY kallistis_worker_all ON public.nexo_coro_manifestation_consents FOR ALL TO kallistis USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.nexo_coro_manifestations TO kallistis;
GRANT SELECT, INSERT, UPDATE ON public.nexo_coro_manifestation_consents TO kallistis;
GRANT SELECT, INSERT ON public.nexo_coro_events TO kallistis;

COMMIT;
