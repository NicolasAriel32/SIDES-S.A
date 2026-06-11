-- =====================================================================
-- Trazabilidad — Migración 12 (APLICADA el 2026-06-11 vía MCP)
-- 1) recontroles.turno_codigo (M/T/N, calculado en hora argentina por
--    la RPC guardar_recontrol) + índices para filtrar por turno/fecha.
-- 2) Tabla mermas: registro analítico de merma. Hoy se alimenta
--    automáticamente por trigger con cada recontrol que descarta
--    cabezales; a futuro admite otros orígenes (columna `origen`).
-- 3) guardar_recontrol actualizada: calcula turno y lo persiste.
-- =====================================================================

-- 1) turno del recontrol
ALTER TABLE recontroles ADD COLUMN IF NOT EXISTS turno_codigo varchar(1);
DO $$ BEGIN
  ALTER TABLE recontroles ADD CONSTRAINT recontroles_turno_chk
    CHECK (turno_codigo IS NULL OR turno_codigo IN ('M','T','N'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_recontroles_turno ON recontroles(turno_codigo);
CREATE INDEX IF NOT EXISTS idx_recontroles_fecha ON recontroles(fecha_hora);

-- 2) tabla mermas
CREATE TABLE IF NOT EXISTS mermas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha              date        NOT NULL,
  turno_codigo       varchar(1)  CHECK (turno_codigo IS NULL OR turno_codigo IN ('M','T','N')),
  maquina_id         varchar(10),
  nombre_producto    varchar(100),
  numero_lote        varchar(64),
  kg                 numeric(10,3) NOT NULL CHECK (kg >= 0),
  cabezales          integer       CHECK (cabezales IS NULL OR cabezales >= 0),
  origen             varchar(20)   NOT NULL DEFAULT 'RECONTROL',
  recontrol_id       uuid REFERENCES recontroles(id),
  no_conformidad_id  uuid REFERENCES no_conformidades(id),
  created_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mermas_fecha  ON mermas(fecha);
CREATE INDEX IF NOT EXISTS idx_mermas_turno  ON mermas(turno_codigo);

ALTER TABLE mermas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mermas_select_authenticated ON mermas;
CREATE POLICY mermas_select_authenticated ON mermas
  FOR SELECT TO authenticated USING (true);

-- 3) trigger: cada recontrol con descarte genera su fila de merma
CREATE OR REPLACE FUNCTION registrar_merma_recontrol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c record;
BEGIN
  IF coalesce(NEW.cabezales_descartados, 0) <= 0 THEN RETURN NEW; END IF;
  SELECT cc.id_maquina, cc.nombre_producto, cc.numero_lote INTO c
  FROM no_conformidades nc
  LEFT JOIN controles_calidad cc ON cc.id = nc.control_calidad_id
  WHERE nc.id = NEW.no_conformidad_id;

  INSERT INTO mermas (fecha, turno_codigo, maquina_id, nombre_producto, numero_lote,
                      kg, cabezales, origen, recontrol_id, no_conformidad_id)
  VALUES (
    ((NEW.fecha_hora AT TIME ZONE 'utc') AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
    NEW.turno_codigo, c.id_maquina, c.nombre_producto, c.numero_lote,
    coalesce(NEW.kg_merma, 0), NEW.cabezales_descartados, 'RECONTROL',
    NEW.id, NEW.no_conformidad_id
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_merma_recontrol ON recontroles;
CREATE TRIGGER trg_merma_recontrol AFTER INSERT ON recontroles
  FOR EACH ROW EXECUTE FUNCTION registrar_merma_recontrol();

-- 4) guardar_recontrol con turno automático (ver definición completa en
--    migración aplicada; reemplaza la versión de 08)
-- (cuerpo idéntico a 08 + cálculo de v_turno y columna turno_codigo)
