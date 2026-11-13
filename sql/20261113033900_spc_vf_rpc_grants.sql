-- Restrict the new assignment RPC to authenticated callers; its body also validates an active supervisor/admin.
REVOKE ALL ON FUNCTION public.vf_asegurar_verificaciones_turno_anterior() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vf_asegurar_verificaciones_turno_anterior() TO authenticated;
