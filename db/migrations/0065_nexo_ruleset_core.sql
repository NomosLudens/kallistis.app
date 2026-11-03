BEGIN;

-- Additive ruleset boundary: NULL means the pre-existing campaign/table/session
-- and therefore keeps its historical rules. No legacy row is converted here.
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS ruleset text;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS ruleset text;
ALTER TABLE public.mesa_live_sessions ADD COLUMN IF NOT EXISTS ruleset text;
ALTER TABLE public.mesa_live_sessions ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.mesas ADD CONSTRAINT mesas_ruleset_check CHECK (ruleset IS NULL OR ruleset = 'KALLISTIS_NEXO_1');
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ruleset_check CHECK (ruleset IS NULL OR ruleset = 'KALLISTIS_NEXO_1');
ALTER TABLE public.mesa_live_sessions ADD CONSTRAINT mesa_live_sessions_ruleset_check CHECK (ruleset IS NULL OR ruleset = 'KALLISTIS_NEXO_1');

CREATE TABLE public.nexo_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id text NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.mesa_live_sessions(id) ON DELETE RESTRICT,
  arguments_text jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(arguments_text) = 'array'),
  arguments_count integer NOT NULL CHECK (arguments_count BETWEEN 0 AND 2),
  resistance integer NOT NULL CHECK (resistance BETWEEN 0 AND 100),
  marco integer NOT NULL CHECK (marco BETWEEN 1 AND 15),
  light_die integer NOT NULL CHECK (light_die BETWEEN 1 AND 10),
  shadow_die integer NOT NULL CHECK (shadow_die BETWEEN 1 AND 10),
  bonus integer NOT NULL,
  total integer NOT NULL,
  margin integer NOT NULL,
  grade text NOT NULL CHECK (grade IN ('severe_failure','failure','success','strong_success','extraordinary')),
  predominance text NOT NULL CHECK (predominance IN ('light','shadow','balanced')),
  resonance boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexo_rolls_character_created_idx ON public.nexo_rolls(character_id, created_at DESC);

CREATE TABLE public.nexo_coro_state (
  mesa_id uuid PRIMARY KEY REFERENCES public.mesas(id) ON DELETE RESTRICT,
  bars integer NOT NULL DEFAULT 0 CHECK (bars BETWEEN 0 AND 3),
  pulses_in_current_bar integer NOT NULL DEFAULT 0 CHECK (pulses_in_current_bar BETWEEN 0 AND 4),
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  activation_used boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.nexo_coro_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('pulse_gain','pulse_spend','round_advanced','activation_used')),
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 4),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  state_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexo_coro_events_mesa_idx ON public.nexo_coro_events(mesa_id, created_at, id);

ALTER TABLE public.nexo_rolls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_coro_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_coro_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_all ON public.nexo_rolls FOR ALL TO kallistis USING (true) WITH CHECK (true);
CREATE POLICY kallistis_worker_all ON public.nexo_coro_state FOR ALL TO kallistis USING (true) WITH CHECK (true);
CREATE POLICY kallistis_worker_all ON public.nexo_coro_events FOR ALL TO kallistis USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.nexo_rolls TO kallistis;
GRANT SELECT, INSERT, UPDATE ON public.nexo_coro_state TO kallistis;
GRANT SELECT, INSERT ON public.nexo_coro_events TO kallistis;

COMMIT;
