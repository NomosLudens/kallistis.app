BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nexo_coro_contributions WHERE adjudicator_user_id = contributor_user_id)
  THEN RAISE EXCEPTION 'rollback_0073_requires_no_self_adjudications';
  END IF;
END $$;
ALTER TABLE public.nexo_coro_contributions
  ADD CONSTRAINT nexo_coro_contributions_check1
  CHECK (adjudicator_user_id IS NULL OR adjudicator_user_id <> contributor_user_id);
DELETE FROM public.kallistis_schema_migrations
WHERE version='0073' AND filename='0073_nexo_coro_solo_master_adjudication.sql';
COMMIT;
