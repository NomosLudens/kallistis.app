BEGIN;

DO $rollback_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.character_master_source_notes) THEN
    RAISE EXCEPTION 'character_master_source_notes_contains_private_records_refuse_rollback';
  END IF;
END
$rollback_guard$;

DROP TABLE public.character_master_source_notes;

COMMIT;
