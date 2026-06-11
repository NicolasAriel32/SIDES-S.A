-- =====================================================================
-- Trazabilidad — Migración 11 (APLICADA el 2026-06-11 vía MCP)
-- El recontrol lo puede registrar cualquier usuario del sistema:
-- la FK de recontroles.inspector_legajo pasa de inspectores_calidad
-- a usuarios(legajo).
-- NOT VALID: los registros históricos (legajos CAL1..CAL4 de prueba)
-- quedan intactos; la FK se exige solo para filas nuevas.
-- =====================================================================

ALTER TABLE recontroles DROP CONSTRAINT IF EXISTS recontroles_inspector_legajo_fkey;
ALTER TABLE recontroles
  ADD CONSTRAINT recontroles_inspector_legajo_fkey
  FOREIGN KEY (inspector_legajo) REFERENCES usuarios(legajo) NOT VALID;
