BEGIN;

DO $nexo_migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0069'
      AND (filename = '0069_nexo_simplification_fix.sql' OR checksum_sha256 = '22b92f4693f0df0dd7ee82ef6fab2e8f34c09e12be6e29867b40b9831931e526')
  ) THEN
    RAISE EXCEPTION 'nexo_legacy_migration_0069_already_applied_do_not_replay';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0075' OR filename = '0075_nexo_simplification_fix.sql'
  ) THEN
    RAISE EXCEPTION 'nexo_migration_0075_already_registered';
  END IF;
END
$nexo_migration_guard$;

ALTER TABLE public.nexo_rolls
  ADD COLUMN IF NOT EXISTS action_description text NOT NULL DEFAULT ''
  CHECK (length(action_description) <= 1000);

ALTER TABLE public.nexo_coro_manifestations
  ADD COLUMN IF NOT EXISTS narrative text;

UPDATE public.nexo_coro_manifestations
SET narrative = concat_ws(E'\n\n',
  NULLIF(action_context, ''),
  NULLIF(intent, ''),
  NULLIF(target_scope, '')
)
WHERE narrative IS NULL;

ALTER TABLE public.nexo_coro_manifestations
  ALTER COLUMN narrative SET NOT NULL,
  ALTER COLUMN intent SET DEFAULT '',
  ALTER COLUMN target_scope SET DEFAULT '';

ALTER TABLE public.nexo_coro_manifestations
  DROP CONSTRAINT IF EXISTS nexo_coro_manifestations_intent_check,
  DROP CONSTRAINT IF EXISTS nexo_coro_manifestations_target_scope_check;

ALTER TABLE public.nexo_coro_manifestations
  ADD CONSTRAINT nexo_coro_manifestations_narrative_check
    CHECK (length(trim(narrative)) BETWEEN 8 AND 3002),
  ADD CONSTRAINT nexo_coro_manifestations_intent_check
    CHECK (length(trim(intent)) = 0 OR length(trim(intent)) BETWEEN 8 AND 1000),
  ADD CONSTRAINT nexo_coro_manifestations_target_scope_check
    CHECK (length(trim(target_scope)) = 0 OR length(trim(target_scope)) BETWEEN 8 AND 1000);

CREATE TABLE public.nexo_resistance_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE RESTRICT,
  character_id text NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  action_description text NOT NULL CHECK (length(trim(action_description)) BETWEEN 1 AND 1000),
  resistance integer NOT NULL CHECK (resistance BETWEEN 0 AND 100),
  set_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE UNIQUE INDEX nexo_resistance_assignments_one_pending
  ON public.nexo_resistance_assignments(mesa_id, character_id)
  WHERE consumed_at IS NULL;
ALTER TABLE public.nexo_resistance_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_all ON public.nexo_resistance_assignments FOR ALL TO kallistis USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.nexo_resistance_assignments TO kallistis;

COMMIT;
