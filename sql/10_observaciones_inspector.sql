-- =====================================================================
-- Trazabilidad — Migración 10 (APLICADA el 2026-06-11 vía MCP)
-- Fix: la notificación del botón "Observar" no llegaba al operario
-- cuando la enviaba el inspector de calidad (rol 'inspector').
--
-- Causas:
--  1. observaciones_insert solo permitía admin/supervisor.
--  2. observaciones_select no incluía al emisor → el INSERT ... RETURNING
--     del front fallaba con RLS aunque el insert fuera válido.
--
-- Verificado simulando al inspector (legajo 300): inserta con RETURNING
-- y el operario (legajo 42) ve la observación no leída.
-- =====================================================================

DROP POLICY IF EXISTS observaciones_insert ON observaciones;
CREATE POLICY observaciones_insert ON observaciones
  FOR INSERT
  WITH CHECK (
    (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','inspector')
    AND supervisor_legajo::text = (SELECT legajo FROM get_my_profile())::text
  );

DROP POLICY IF EXISTS observaciones_select ON observaciones;
CREATE POLICY observaciones_select ON observaciones
  FOR SELECT
  USING (
    (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','auditor','inspector')
    OR operario_legajo::text   = (SELECT legajo FROM get_my_profile())::text
    OR supervisor_legajo::text = (SELECT legajo FROM get_my_profile())::text
    OR maquina_codigo::text    = (SELECT maquina_asignada FROM get_my_profile())::text
  );
