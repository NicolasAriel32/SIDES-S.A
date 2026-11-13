-- SIDES · Hardening RLS for lotes/cajas
-- Compatible with the existing original schema and the SPC staging schema.
-- Adds least-privilege grants and role-scoped policies; preserves all rows.
-- Apply only after backup/restore readiness and coordinated frontend verification.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.lotes') IS NULL OR to_regclass('public.cajas') IS NULL
     OR to_regprocedure('public.get_my_profile()') IS NULL THEN
    RAISE EXCEPTION 'SIDES RLS hardening: required tables/profile function missing';
  END IF;
END
$preflight$;

ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lotes, public.cajas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lotes, public.cajas TO authenticated;

DROP POLICY IF EXISTS sides_lotes_select_auth ON public.lotes;
DROP POLICY IF EXISTS sides_lotes_insert_admin_supervisor ON public.lotes;
DROP POLICY IF EXISTS sides_lotes_update_admin_supervisor ON public.lotes;
DROP POLICY IF EXISTS sides_cajas_select_role_scoped ON public.cajas;
DROP POLICY IF EXISTS sides_cajas_insert_role_scoped ON public.cajas;
DROP POLICY IF EXISTS sides_cajas_update_admin_supervisor ON public.cajas;

CREATE POLICY sides_lotes_select_auth ON public.lotes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY sides_lotes_insert_admin_supervisor ON public.lotes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT p.rol::text FROM public.get_my_profile() p)
              = ANY (ARRAY['admin','supervisor']));

CREATE POLICY sides_lotes_update_admin_supervisor ON public.lotes
  FOR UPDATE TO authenticated
  USING ((SELECT p.rol::text FROM public.get_my_profile() p)
         = ANY (ARRAY['admin','supervisor']))
  WITH CHECK ((SELECT p.rol::text FROM public.get_my_profile() p)
              = ANY (ARRAY['admin','supervisor']));

CREATE POLICY sides_cajas_select_role_scoped ON public.cajas
  FOR SELECT TO authenticated
  USING (
    (SELECT p.rol::text FROM public.get_my_profile() p)
      = ANY (ARRAY['admin','supervisor','auditor'])
    OR (
      (SELECT p.rol::text FROM public.get_my_profile() p) = 'operario'
      AND maquina_id = (SELECT p.maquina_asignada::text
                        FROM public.get_my_profile() p)
    )
  );

CREATE POLICY sides_cajas_insert_role_scoped ON public.cajas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT p.rol::text FROM public.get_my_profile() p)
      = ANY (ARRAY['admin','supervisor'])
    OR (
      (SELECT p.rol::text FROM public.get_my_profile() p) = 'operario'
      AND maquina_id = (SELECT p.maquina_asignada::text
                        FROM public.get_my_profile() p)
    )
  );

CREATE POLICY sides_cajas_update_admin_supervisor ON public.cajas
  FOR UPDATE TO authenticated
  USING ((SELECT p.rol::text FROM public.get_my_profile() p)
         = ANY (ARRAY['admin','supervisor']))
  WITH CHECK ((SELECT p.rol::text FROM public.get_my_profile() p)
              = ANY (ARRAY['admin','supervisor']));

COMMIT;
