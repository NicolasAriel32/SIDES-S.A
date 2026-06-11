-- =====================================================================
-- Trazabilidad — Migración 13 (APLICADA el 2026-06-11 vía MCP)
-- El rol inspector (control de calidad) puede ver las pruebas de
-- estanqueidad de todas las máquinas (monitoreo en tiempo real).
-- Antes solo admin/supervisor/auditor (y el operario su máquina),
-- por lo que el tablero aparecía vacío para el inspector.
-- =====================================================================

DROP POLICY IF EXISTS pruebas_select ON pruebas;
CREATE POLICY pruebas_select ON pruebas
  FOR SELECT
  USING (
    (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','auditor','inspector')
    OR (
      (SELECT rol FROM get_my_profile())::text = 'operario'
      AND id_maquina::text = (SELECT maquina_asignada FROM get_my_profile())::text
    )
  );
