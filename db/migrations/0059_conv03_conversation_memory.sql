-- CONV-03: private book retrieval and durable per-conversation worksheet.
-- The Worker remains the sole application authorization boundary.

CREATE TABLE IF NOT EXISTS public.character_creation_book_sources (
  source_sha256 text PRIMARY KEY CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_version text NOT NULL,
  drive_file_id text NOT NULL,
  file_name text NOT NULL,
  source_bytes integer NOT NULL CHECK (source_bytes > 0),
  chunk_count integer NOT NULL CHECK (chunk_count = 200),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS character_creation_book_one_active_idx
  ON public.character_creation_book_sources ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.character_creation_book_chunks (
  chunk_id text NOT NULL,
  source_version text NOT NULL,
  source_sha256 text NOT NULL REFERENCES public.character_creation_book_sources(source_sha256) ON DELETE CASCADE,
  book_title text NOT NULL,
  chapter text NOT NULL DEFAULT '',
  section text NOT NULL DEFAULT '',
  heading_path jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(heading_path) = 'array'),
  start_line integer NOT NULL CHECK (start_line > 0),
  end_line integer NOT NULL CHECK (end_line >= start_line),
  start_byte integer NOT NULL CHECK (start_byte >= 0),
  end_byte integer NOT NULL CHECK (end_byte >= start_byte),
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  keywords text[] NOT NULL DEFAULT '{}',
  entities text[] NOT NULL DEFAULT '{}',
  rule_tags text[] NOT NULL DEFAULT '{}',
  related_chunk_ids text[] NOT NULL DEFAULT '{}',
  route50_id text NOT NULL,
  route10_id text NOT NULL,
  route4_id text NOT NULL,
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_sha256, chunk_id)
);

CREATE INDEX IF NOT EXISTS character_creation_book_chunks_search_idx
  ON public.character_creation_book_chunks USING gin (search_document);
CREATE INDEX IF NOT EXISTS character_creation_book_chunks_keywords_idx
  ON public.character_creation_book_chunks USING gin (keywords);
CREATE INDEX IF NOT EXISTS character_creation_book_chunks_entities_idx
  ON public.character_creation_book_chunks USING gin (entities);
CREATE INDEX IF NOT EXISTS character_creation_book_chunks_tags_idx
  ON public.character_creation_book_chunks USING gin (rule_tags);
CREATE INDEX IF NOT EXISTS character_creation_book_chunks_route_idx
  ON public.character_creation_book_chunks (route4_id, route10_id, route50_id);

CREATE TABLE IF NOT EXISTS public.character_creation_conversation_memory (
  character_id text PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  qa jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(qa) = 'array'),
  narrative_identity jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(narrative_identity) = 'array'),
  choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(choices) = 'array'),
  inferences jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inferences) = 'array'),
  pending_contradictions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pending_contradictions) = 'array'),
  consulted_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(consulted_sources) = 'array'),
  last_message_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.character_creation_book_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_creation_book_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_creation_conversation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kallistis_worker_select ON public.character_creation_book_chunks;
CREATE POLICY kallistis_worker_select ON public.character_creation_book_chunks
  FOR SELECT TO kallistis USING (true);

DROP POLICY IF EXISTS kallistis_worker_select ON public.character_creation_book_sources;
CREATE POLICY kallistis_worker_select ON public.character_creation_book_sources
  FOR SELECT TO kallistis USING (true);

DROP POLICY IF EXISTS kallistis_worker_all ON public.character_creation_conversation_memory;
CREATE POLICY kallistis_worker_all ON public.character_creation_conversation_memory
  FOR ALL TO kallistis USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.character_creation_book_chunks,
  public.character_creation_book_sources,
  public.character_creation_conversation_memory FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.character_creation_book_chunks TO kallistis;
GRANT SELECT ON TABLE public.character_creation_book_sources TO kallistis;
GRANT SELECT, INSERT, UPDATE ON TABLE public.character_creation_conversation_memory TO kallistis;
