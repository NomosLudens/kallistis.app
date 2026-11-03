BEGIN;

DO $nexo_migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0067'
      AND (filename = '0067_nexo_coro_solo_master_adjudication.sql' OR checksum_sha256 = '35ccf19f06fd96de7ca69a4e15ec429360792128c6e614d18e42b4ddb88b408b')
  ) THEN
    RAISE EXCEPTION 'nexo_legacy_migration_0067_already_applied_do_not_replay';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kallistis_schema_migrations
    WHERE version = '0073' OR filename = '0073_nexo_coro_solo_master_adjudication.sql'
  ) THEN
    RAISE EXCEPTION 'nexo_migration_0073_already_registered';
  END IF;
END
$nexo_migration_guard$;

-- The application server now authorizes same-user adjudication only when the
-- authenticated user is the Mesa Mestre and the sole eligible participant.
-- Keep the database row shape valid while allowing that narrowly guarded case.
ALTER TABLE public.nexo_coro_contributions
  DROP CONSTRAINT nexo_coro_contributions_check1;

COMMIT;
