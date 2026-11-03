BEGIN;

DO $nexo_migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0066'
      AND (filename = '0066_nexo_coro_contributions.sql' OR checksum_sha256 = '9b437cac715e07050f99a6a716d839c6c240b75696d59c04c393f04b2e9ee43e')
  ) THEN
    RAISE EXCEPTION 'nexo_legacy_migration_0066_already_applied_do_not_replay';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0072' OR filename = '0072_nexo_coro_contributions.sql'
  ) THEN
    RAISE EXCEPTION 'nexo_migration_0072_already_registered';
  END IF;
END
$nexo_migration_guard$;

CREATE TABLE public.nexo_coro_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE RESTRICT,
  character_id text NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  contributor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  active_paper text NOT NULL CHECK (active_paper IN ('Vanguarda','Artilharia','Amparo','Bastião')),
  action_description text NOT NULL CHECK (length(trim(action_description)) BETWEEN 8 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  adjudicator_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  adjudication_note text NOT NULL DEFAULT '' CHECK (length(adjudication_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  adjudicated_at timestamptz,
  CHECK ((status = 'pending' AND adjudicator_user_id IS NULL AND adjudicated_at IS NULL)
      OR (status <> 'pending' AND adjudicator_user_id IS NOT NULL AND adjudicated_at IS NOT NULL)),
  CHECK (adjudicator_user_id IS NULL OR adjudicator_user_id <> contributor_user_id)
);

CREATE UNIQUE INDEX nexo_coro_one_pending_contribution_per_character_round
  ON public.nexo_coro_contributions(mesa_id, character_id, round_number)
  WHERE status = 'pending';
CREATE UNIQUE INDEX nexo_coro_one_approved_pulse_per_character_round
  ON public.nexo_coro_contributions(mesa_id, character_id, round_number)
  WHERE status = 'approved';
CREATE INDEX nexo_coro_contributions_history_idx
  ON public.nexo_coro_contributions(mesa_id, created_at DESC, id DESC);

ALTER TABLE public.nexo_coro_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_all ON public.nexo_coro_contributions
  FOR ALL TO kallistis USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.nexo_coro_contributions TO kallistis;

COMMIT;
