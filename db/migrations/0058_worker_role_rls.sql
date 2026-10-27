-- Enable default-deny RLS on the reviewed public tables while preserving the
-- existing PostgreSQL privilege surface. Runtime policies apply only to the
-- trusted Worker role inherited via kallistis_worker -> kallistis. They do not
-- provide per-player row isolation; the Worker remains the application auth boundary.

ALTER TABLE public.agenda_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auth_recovery_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.camara_mapas_continuidade ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.camara_segmentos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.camara_sessoes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_continuity_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_continuity_publications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_creation_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_mesas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_progression_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_mutation_confirmations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.community_chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contexto_externo ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.jardim_memorias ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kallistis_schema_migrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kline_event_review_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kline_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.master_mesa_surface_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.master_user_surface_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.memory_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesa_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesa_live_session_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesa_live_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesa_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesa_responsible_masters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_invite_oauth_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.presence_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.presence_regimes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile_avatars ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.registro_vivo ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sedimentos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_access_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_app_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_recovery_credentials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_campaign_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_handoff_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY kallistis_worker_all ON public.agenda_events
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.auth_recovery_events
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.camara_mapas_continuidade
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.camara_segmentos
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.camara_sessoes
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.campaign_continuity_entries
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.campaign_continuity_publications
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.campaigns
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.character_creation_messages
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.character_events
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.character_mesas
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.character_progression_requests
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.character_versions
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.characters
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.chat_messages
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.chat_mutation_confirmations
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.chat_threads
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.community_chat_messages
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.contexto_externo
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.credentials
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.jardim_memorias
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.kline_event_review_state
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.kline_events
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.master_mesa_surface_state
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.master_user_surface_state
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.memory_candidates
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesa_invites
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesa_live_session_events
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesa_live_sessions
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesa_members
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesa_responsible_masters
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.mesas
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.player_access
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.player_invite_oauth_states
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.player_invites
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.presence_messages
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.presence_regimes
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.profile_avatars
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.profiles
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.registro_vivo
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.sedimentos
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.sessions
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.system_identities
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.system_roles
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.user_app_access
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.user_preferences
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.user_recovery_credentials
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.users
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.vtt_campaign_mappings
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

CREATE POLICY kallistis_worker_all ON public.vtt_handoff_codes
    FOR ALL TO kallistis
    USING (true)
    WITH CHECK (true);

-- kallistis_schema_migrations has no runtime grants and is not used by the Worker.
-- user_access_events has no runtime table grants; its only application write path is
-- set_player_access_status(), SECURITY DEFINER owned by postgres.
