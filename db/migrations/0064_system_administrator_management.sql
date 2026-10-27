-- Audited system-master lifecycle. Runtime role can only invoke the guarded
-- functions; it cannot write system_roles directly.
CREATE TABLE IF NOT EXISTS public.system_role_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('bootstrap', 'grant', 'revoke')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_role_events_created_idx
    ON public.system_role_events (created_at DESC, id);

ALTER TABLE public.system_role_events OWNER TO kgen_admin;
ALTER TABLE public.system_role_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY kallistis_worker_read ON public.system_role_events
    FOR SELECT TO kallistis
    USING (true);
GRANT SELECT ON TABLE public.system_role_events TO kallistis;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.system_role_events FROM kallistis;

-- system_roles predates this guarded lifecycle. Keep its read path for
-- authorization checks, but route administrator changes through the audited
-- SECURITY DEFINER functions below.
GRANT SELECT ON TABLE public.system_roles TO kallistis;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.system_roles FROM kallistis;

CREATE OR REPLACE FUNCTION public.bootstrap_initial_system_master(p_actor_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_admin_count integer;
BEGIN
    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'administrator identity required' USING ERRCODE = '22023';
    END IF;

    LOCK TABLE public.system_roles IN EXCLUSIVE MODE;

    SELECT count(*)::integer INTO v_admin_count
      FROM public.system_roles
     WHERE system_role = 'system_master';
    IF v_admin_count <> 0 THEN
        RAISE EXCEPTION 'initial administrator already exists' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users
         WHERE id = p_actor_user_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'active administrator account required' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.system_roles (user_id, system_role)
    VALUES (p_actor_user_id, 'system_master');
    INSERT INTO public.system_role_events (actor_user_id, target_user_id, action)
    VALUES (p_actor_user_id, p_actor_user_id, 'bootstrap');

    RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_system_master(
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_action text
)
RETURNS TABLE (result text, administrator_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_changed integer := 0;
    v_target_active boolean;
BEGIN
    IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_action IS NULL THEN
        RAISE EXCEPTION 'administrator identities required' USING ERRCODE = '22023';
    END IF;
    IF p_action NOT IN ('grant', 'revoke') THEN
        RAISE EXCEPTION 'invalid administrator action' USING ERRCODE = '22023';
    END IF;

    LOCK TABLE public.system_roles IN EXCLUSIVE MODE;

    IF NOT EXISTS (
        SELECT 1 FROM public.users
         WHERE id = p_actor_user_id AND status = 'active'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.system_roles
         WHERE user_id = p_actor_user_id AND system_role = 'system_master'
    ) THEN
        RAISE EXCEPTION 'system administrator required' USING ERRCODE = '42501';
    END IF;

    SELECT (u.status = 'active') INTO v_target_active
      FROM public.users u
     WHERE u.id = p_target_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target account not found' USING ERRCODE = 'P0002';
    END IF;

    IF p_action = 'grant' THEN
        IF NOT v_target_active THEN
            RAISE EXCEPTION 'target account is inactive' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.system_roles (user_id, system_role)
        VALUES (p_target_user_id, 'system_master')
        ON CONFLICT (user_id) DO NOTHING;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed = 1 THEN
            INSERT INTO public.system_role_events (actor_user_id, target_user_id, action)
            VALUES (p_actor_user_id, p_target_user_id, 'grant');
            result := 'granted';
        ELSE
            result := 'already_admin';
        END IF;
    ELSE
        IF p_actor_user_id = p_target_user_id THEN
            RAISE EXCEPTION 'self removal is not allowed' USING ERRCODE = '42501';
        END IF;
        IF v_target_active AND (
            SELECT count(*) FROM public.system_roles sr
            JOIN public.users u ON u.id = sr.user_id
            WHERE sr.system_role = 'system_master' AND u.status = 'active'
        ) <= 1 THEN
            RAISE EXCEPTION 'last active administrator cannot be removed' USING ERRCODE = '23514';
        END IF;
        DELETE FROM public.system_roles
         WHERE user_id = p_target_user_id AND system_role = 'system_master';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed = 1 THEN
            INSERT INTO public.system_role_events (actor_user_id, target_user_id, action)
            VALUES (p_actor_user_id, p_target_user_id, 'revoke');
            result := 'revoked';
        ELSE
            result := 'not_admin';
        END IF;
    END IF;

    SELECT count(*)::integer INTO administrator_count
      FROM public.system_roles sr
      JOIN public.users u ON u.id = sr.user_id
     WHERE sr.system_role = 'system_master' AND u.status = 'active';
    RETURN NEXT;
END;
$$;

ALTER FUNCTION public.bootstrap_initial_system_master(uuid) OWNER TO kgen_admin;
ALTER FUNCTION public.change_system_master(uuid, uuid, text) OWNER TO kgen_admin;

REVOKE ALL ON FUNCTION public.bootstrap_initial_system_master(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_system_master(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_system_master(uuid) TO kallistis;
GRANT EXECUTE ON FUNCTION public.change_system_master(uuid, uuid, text) TO kallistis;
