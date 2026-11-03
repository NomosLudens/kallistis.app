BEGIN;

-- Keep old NEXO rows valid while accepting the canonical final identifier.
ALTER TABLE public.mesas DROP CONSTRAINT mesas_ruleset_check;
ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_ruleset_check;
ALTER TABLE public.mesa_live_sessions DROP CONSTRAINT mesa_live_sessions_ruleset_check;
ALTER TABLE public.mesas ADD CONSTRAINT mesas_ruleset_check CHECK (ruleset IS NULL OR ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL'));
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ruleset_check CHECK (ruleset IS NULL OR ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL'));
ALTER TABLE public.mesa_live_sessions ADD CONSTRAINT mesa_live_sessions_ruleset_check CHECK (ruleset IS NULL OR ruleset IN ('KALLISTIS_NEXO_1','KALLISTIS_NEXO_FINAL'));

CREATE TABLE public.nexo_action_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE RESTRICT,
  character_id text NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.mesa_live_sessions(id) ON DELETE RESTRICT,
  resistance_assignment_id uuid NOT NULL UNIQUE REFERENCES public.nexo_resistance_assignments(id) ON DELETE RESTRICT,
  action_description text NOT NULL CHECK (length(trim(action_description)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','resolved')),
  adjudicated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  adjudicated_at timestamptz,
  roll_id uuid UNIQUE REFERENCES public.nexo_rolls(id) ON DELETE RESTRICT,
  consequence_text text CHECK (consequence_text IS NULL OR length(trim(consequence_text)) BETWEEN 1 AND 1500),
  consequence_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  consequence_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX nexo_action_submissions_mesa_status_idx ON public.nexo_action_submissions(mesa_id,status,created_at DESC);

CREATE TABLE public.nexo_action_arguments (
  submission_id uuid NOT NULL REFERENCES public.nexo_action_submissions(id) ON DELETE RESTRICT,
  slot integer NOT NULL CHECK (slot IN (1,2)),
  argument_text text NOT NULL CHECK (length(trim(argument_text)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  adjudicated_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  adjudicated_at timestamptz,
  PRIMARY KEY (submission_id,slot)
);

ALTER TABLE public.nexo_action_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_action_arguments ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_all ON public.nexo_action_submissions FOR ALL TO kallistis USING (true) WITH CHECK (true);
CREATE POLICY kallistis_worker_all ON public.nexo_action_arguments FOR ALL TO kallistis USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON public.nexo_action_submissions TO kallistis;
GRANT SELECT,INSERT,UPDATE ON public.nexo_action_arguments TO kallistis;

COMMIT;
