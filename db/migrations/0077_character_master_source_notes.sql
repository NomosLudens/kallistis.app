BEGIN;

CREATE TABLE public.character_master_source_notes (
  character_id text PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,
  source_key text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_row integer NOT NULL CHECK (source_row > 1),
  private_payload jsonb NOT NULL CHECK (jsonb_typeof(private_payload) = 'object'),
  recorded_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.character_master_source_notes FROM PUBLIC;
GRANT SELECT, INSERT ON public.character_master_source_notes TO kallistis;

COMMIT;
