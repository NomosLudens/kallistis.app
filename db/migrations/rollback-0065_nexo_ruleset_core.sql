BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.characters WHERE ruleset = 'KALLISTIS_NEXO_1')
     OR EXISTS (SELECT 1 FROM public.campaigns WHERE ruleset = 'KALLISTIS_NEXO_1')
     OR EXISTS (SELECT 1 FROM public.mesas WHERE ruleset = 'KALLISTIS_NEXO_1')
     OR EXISTS (SELECT 1 FROM public.mesa_live_sessions WHERE ruleset = 'KALLISTIS_NEXO_1')
     OR EXISTS (SELECT 1 FROM public.nexo_rolls)
     OR EXISTS (SELECT 1 FROM public.nexo_coro_events)
     OR EXISTS (SELECT 1 FROM public.nexo_coro_state)
  THEN RAISE EXCEPTION 'rollback_0065_requires_export_or_empty_nexo_data';
  END IF;
END $$;
DROP TABLE public.nexo_coro_events;
DROP TABLE public.nexo_coro_state;
DROP TABLE public.nexo_rolls;
ALTER TABLE public.mesa_live_sessions DROP CONSTRAINT mesa_live_sessions_ruleset_check, DROP COLUMN campaign_id, DROP COLUMN ruleset;
ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_ruleset_check, DROP COLUMN ruleset;
ALTER TABLE public.mesas DROP CONSTRAINT mesas_ruleset_check, DROP COLUMN ruleset;
DELETE FROM public.kallistis_schema_migrations WHERE version='0065' AND filename='0065_nexo_ruleset_core.sql';
COMMIT;
