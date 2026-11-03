BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nexo_coro_contributions)
  THEN RAISE EXCEPTION 'rollback_0072_requires_export_or_empty_contributions';
  END IF;
END $$;
DROP TABLE public.nexo_coro_contributions;
DELETE FROM public.kallistis_schema_migrations
WHERE version='0072' AND filename='0072_nexo_coro_contributions.sql';
COMMIT;
