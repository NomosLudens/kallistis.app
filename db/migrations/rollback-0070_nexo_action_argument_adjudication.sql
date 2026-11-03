BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nexo_action_submissions LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.mesas WHERE ruleset='KALLISTIS_NEXO_FINAL')
     OR EXISTS (SELECT 1 FROM public.campaigns WHERE ruleset='KALLISTIS_NEXO_FINAL')
     OR EXISTS (SELECT 1 FROM public.mesa_live_sessions WHERE ruleset='KALLISTIS_NEXO_FINAL') THEN
    RAISE EXCEPTION 'rollback_0070_requires_no_action_submissions_or_final_ruleset_rows';
  END IF;
END $$;

DROP TABLE public.nexo_action_arguments;
DROP TABLE public.nexo_action_submissions;

ALTER TABLE public.mesas DROP CONSTRAINT mesas_ruleset_check;
ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_ruleset_check;
ALTER TABLE public.mesa_live_sessions DROP CONSTRAINT mesa_live_sessions_ruleset_check;
ALTER TABLE public.mesas ADD CONSTRAINT mesas_ruleset_check CHECK (ruleset IS NULL OR ruleset='KALLISTIS_NEXO_1');
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ruleset_check CHECK (ruleset IS NULL OR ruleset='KALLISTIS_NEXO_1');
ALTER TABLE public.mesa_live_sessions ADD CONSTRAINT mesa_live_sessions_ruleset_check CHECK (ruleset IS NULL OR ruleset='KALLISTIS_NEXO_1');
DELETE FROM public.kallistis_schema_migrations WHERE version='0070' AND filename='0070_nexo_action_argument_adjudication.sql';

COMMIT;
