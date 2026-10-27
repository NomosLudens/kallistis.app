DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.character_creation_conversation_memory)
     OR EXISTS (SELECT 1 FROM public.character_creation_book_chunks)
     OR EXISTS (SELECT 1 FROM public.character_creation_book_sources) THEN
    RAISE EXCEPTION 'conv03_rollback_refused_nonempty_tables';
  END IF;
END $$;

DROP TABLE public.character_creation_conversation_memory;
DROP TABLE public.character_creation_book_chunks;
DROP TABLE public.character_creation_book_sources;
