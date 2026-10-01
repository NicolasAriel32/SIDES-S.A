-- =====================================================================
-- Security hardening
-- Applied 2026-10-01
--
-- 1) Remove self-update on usuarios. The old policy allowed any signed-in
--    user to update their own row, including security-sensitive columns
--    such as rol, activo and maquina_asignada.
-- 2) Add a narrowly scoped RPC used after changing the Supabase Auth
--    password, so the user can only clear fuerza_cambio for their own row.
-- 3) Revoke the temporary debug RPC from public/authenticated access.
-- =====================================================================

DROP POLICY IF EXISTS usuarios_self_update ON public.usuarios;

CREATE OR REPLACE FUNCTION public.marcar_password_cambiada()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.usuarios
     SET fuerza_cambio = false,
         cambio_password_date = now(),
         updated_at = now()
   WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario autenticado sin perfil';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_password_cambiada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_password_cambiada() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.debug_my_rls() FROM PUBLIC, anon, authenticated;
