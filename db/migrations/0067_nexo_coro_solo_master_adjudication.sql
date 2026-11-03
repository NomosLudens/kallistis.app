BEGIN;

-- The application server now authorizes same-user adjudication only when the
-- authenticated user is the Mesa Mestre and the sole eligible participant.
-- Keep the database row shape valid while allowing that narrowly guarded case.
ALTER TABLE public.nexo_coro_contributions
  DROP CONSTRAINT nexo_coro_contributions_check1;

COMMIT;
