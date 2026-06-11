-- =====================================================================
-- Trazabilidad — Migración 09 (APLICADA el 2026-06-09 vía MCP)
-- Las NC originadas en control de calidad son visibles para cualquier
-- usuario autenticado. Sin esto, la cola de recontrol quedaba vacía
-- para inspectores (nc_select solo permitía admin/supervisor/auditor).
-- =====================================================================

DROP POLICY IF EXISTS nc_select_calidad ON no_conformidades;
CREATE POLICY nc_select_calidad ON no_conformidades
  FOR SELECT TO authenticated
  USING (control_calidad_id IS NOT NULL);
