ALTER TABLE public.chat_mutation_confirmations
  DROP CONSTRAINT IF EXISTS chat_mutation_confirmations_operation_check;

ALTER TABLE public.chat_mutation_confirmations
  ADD CONSTRAINT chat_mutation_confirmations_operation_check
  CHECK (operation IN ('character_biography_update', 'character_create', 'character_creation_patch'));
