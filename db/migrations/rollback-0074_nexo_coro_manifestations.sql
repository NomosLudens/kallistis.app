BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nexo_coro_manifestations)
     OR EXISTS (SELECT 1 FROM public.nexo_coro_events WHERE manifestation_id IS NOT NULL)
  THEN RAISE EXCEPTION 'rollback_0074_requires_no_manifestation_records';
  END IF;
END $$;

DROP INDEX public.nexo_coro_manifestation_event_once;
ALTER TABLE public.nexo_coro_events DROP COLUMN manifestation_id;
DROP TABLE public.nexo_coro_manifestation_consents;
DROP TABLE public.nexo_coro_manifestations;
DELETE FROM public.kallistis_schema_migrations
WHERE version='0074' AND filename='0074_nexo_coro_manifestations.sql';

COMMIT;
