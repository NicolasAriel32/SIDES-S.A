-- =====================================================================
-- Trazabilidad — Migración 14 (APLICADA el 2026-06-11 vía MCP)
-- Carga de pruebas desde cualquier máquina para roles de supervisión
-- (admin / supervisor / inspector). El operario sigue limitado a su
-- máquina asignada. En todos los casos operario_legajo debe ser el
-- legajo de quien carga (trazabilidad del registro).
-- También: el inspector puede actualizar pruebas (cola de aprobaciones)
-- e insertar pruebas_fallas.
-- Front: VistaOperario muestra selector de máquina para roles no-operario.
-- =====================================================================

DROP POLICY IF EXISTS pruebas_insert ON pruebas;
CREATE POLICY pruebas_insert ON pruebas
  FOR INSERT
  WITH CHECK (
    (
      (SELECT rol FROM get_my_profile())::text = 'operario'
      AND id_maquina::text = (SELECT maquina_asignada FROM get_my_profile())::text
      AND operario_legajo::text = (SELECT legajo FROM get_my_profile())::text
    )
    OR (
      (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','inspector')
      AND operario_legajo::text = (SELECT legajo FROM get_my_profile())::text
    )
  );

DROP POLICY IF EXISTS pruebas_fallas_insert ON pruebas_fallas;
CREATE POLICY pruebas_fallas_insert ON pruebas_fallas
  FOR INSERT
  WITH CHECK (
    prueba_id IN (
      SELECT id FROM pruebas
      WHERE operario_legajo::text = (SELECT legajo FROM get_my_profile())::text
    )
    OR (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','inspector')
  );

DROP POLICY IF EXISTS pruebas_update ON pruebas;
CREATE POLICY pruebas_update ON pruebas
  FOR UPDATE
  USING (
    (SELECT rol FROM get_my_profile())::text IN ('admin','supervisor','inspector')
    OR (
      (SELECT rol FROM get_my_profile())::text = 'operario'
      AND operario_legajo::text = (SELECT legajo FROM get_my_profile())::text
      AND anulada IS NOT TRUE
    )
  );

-- Nota: en esta misma fecha se re-sembró el catálogo `turnos` (M/T/N)
-- que estaba vacío:
-- INSERT INTO turnos (codigo, nombre, hora_inicio, hora_fin) VALUES
--   ('M','MAÑANA','06:00','14:00'),('T','TARDE','14:00','22:00'),
--   ('N','NOCHE','22:00','06:00') ON CONFLICT (codigo) DO NOTHING;
