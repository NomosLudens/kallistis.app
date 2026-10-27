-- Narrative-only memory used by the dedicated KALLÍSTIS ZeroClaw agent.
-- Identity and campaign scope are assigned by the authenticated backend.
CREATE TABLE IF NOT EXISTS public.kallistis_agent_memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    character_id text NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
    content text NOT NULL,
    category text NOT NULL DEFAULT 'narrative',
    provenance text NOT NULL,
    source_thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    source_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kallistis_agent_memories_category_check CHECK (category = 'narrative'),
    CONSTRAINT kallistis_agent_memories_content_check CHECK (length(trim(content)) BETWEEN 1 AND 1000),
    CONSTRAINT kallistis_agent_memories_provenance_check CHECK (provenance = 'explicit_player_instruction')
);

CREATE INDEX IF NOT EXISTS kallistis_agent_memories_scope_created_idx
    ON public.kallistis_agent_memories (user_id, character_id, campaign_id, created_at DESC, id);

ALTER TABLE public.kallistis_agent_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kallistis_worker_all ON public.kallistis_agent_memories;
CREATE POLICY kallistis_worker_all ON public.kallistis_agent_memories
    USING (current_user = 'kallistis')
    WITH CHECK (current_user = 'kallistis');
REVOKE ALL ON TABLE public.kallistis_agent_memories FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.kallistis_agent_memories TO kallistis;
