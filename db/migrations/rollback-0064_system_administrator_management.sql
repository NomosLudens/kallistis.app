REVOKE ALL ON FUNCTION public.bootstrap_initial_system_master(uuid) FROM PUBLIC, kallistis;
REVOKE ALL ON FUNCTION public.change_system_master(uuid, uuid, text) FROM PUBLIC, kallistis;
DROP FUNCTION public.bootstrap_initial_system_master(uuid);
DROP FUNCTION public.change_system_master(uuid, uuid, text);
DROP POLICY kallistis_worker_read ON public.system_role_events;
ALTER TABLE public.system_role_events DISABLE ROW LEVEL SECURITY;
DROP TABLE public.system_role_events;
