-- =====================================================================
-- Trazabilidad — Migración 05 (APLICADA el 2026-06-09 vía MCP)
-- sesiones_calidad + ordenes_maquina + vínculos en controles_calidad
-- + seed de inspectores_calidad. Idempotente.
-- =====================================================================

BEGIN;

-- 1) sesiones_calidad: una por turno de control de calidad.
CREATE TABLE IF NOT EXISTS sesiones_calidad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        varchar(40) NOT NULL UNIQUE,          -- ej: SES-20260609-0731
  fecha         date        NOT NULL DEFAULT current_date,
  turno_codigo  varchar(1)  NOT NULL CHECK (turno_codigo IN ('M','T','N')),
  -- snapshot de asignación inspector→máquinas:
  -- [{ "legajo":"CAL2","nombre":"Pereyra, Luis","maquinas":["MAQ-001",...] }]
  inspectores   jsonb       NOT NULL DEFAULT '[]',
  estado        varchar(10) NOT NULL DEFAULT 'ABIERTA'
                CHECK (estado IN ('ABIERTA','CERRADA')),
  abierta_por   uuid REFERENCES usuarios(id),
  cerrada_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sescal_fecha  ON sesiones_calidad(fecha);
CREATE INDEX IF NOT EXISTS idx_sescal_estado ON sesiones_calidad(estado);

-- Solo una sesión ABIERTA por turno+fecha
CREATE UNIQUE INDEX IF NOT EXISTS idx_sescal_abierta_unq
  ON sesiones_calidad(fecha, turno_codigo) WHERE estado = 'ABIERTA';

-- 2) ordenes_maquina: orden de producción activa en cada máquina.
CREATE TABLE IF NOT EXISTS ordenes_maquina (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id            varchar(10) NOT NULL REFERENCES maquinas(id),
  especifc_producto_id  uuid REFERENCES especifc_producto(id),
  nombre_producto       varchar(100) NOT NULL,        -- snapshot
  numero_lote           varchar(64)  NOT NULL,
  cliente               varchar(100),
  orden_produccion      varchar(40),                  -- ej: OP-2026-0481
  activa                boolean      NOT NULL DEFAULT true,
  abierta_en            timestamptz  NOT NULL DEFAULT now(),
  cerrada_en            timestamptz,
  sesion_apertura_id    uuid REFERENCES sesiones_calidad(id),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_om_maquina ON ordenes_maquina(maquina_id);
-- una sola orden activa por máquina
CREATE UNIQUE INDEX IF NOT EXISTS idx_om_activa_unq
  ON ordenes_maquina(maquina_id) WHERE activa;

-- 3) vínculos en controles_calidad
ALTER TABLE controles_calidad
  ADD COLUMN IF NOT EXISTS orden_maquina_id   uuid REFERENCES ordenes_maquina(id),
  ADD COLUMN IF NOT EXISTS sesion_calidad_id  uuid REFERENCES sesiones_calidad(id);
CREATE INDEX IF NOT EXISTS idx_cc_orden_maquina ON controles_calidad(orden_maquina_id);
CREATE INDEX IF NOT EXISTS idx_cc_sesion        ON controles_calidad(sesion_calidad_id);

-- 4) triggers updated_at (reusa set_updated_at existente)
DROP TRIGGER IF EXISTS trg_sescal_updated ON sesiones_calidad;
CREATE TRIGGER trg_sescal_updated BEFORE UPDATE ON sesiones_calidad
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_om_updated ON ordenes_maquina;
CREATE TRIGGER trg_om_updated BEFORE UPDATE ON ordenes_maquina
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5) RLS
ALTER TABLE sesiones_calidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_maquina  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sescal_rw_authenticated ON sesiones_calidad;
CREATE POLICY sescal_rw_authenticated ON sesiones_calidad
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS om_rw_authenticated ON ordenes_maquina;
CREATE POLICY om_rw_authenticated ON ordenes_maquina
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6) seed inspectores_calidad
INSERT INTO inspectores_calidad (legajo, nombre) VALUES
  ('CAL1','García, Marcela'),
  ('CAL2','Pereyra, Luis'),
  ('CAL3','Romero, Ana'),
  ('CAL4','Díaz, Fabián')
ON CONFLICT DO NOTHING;

COMMIT;
