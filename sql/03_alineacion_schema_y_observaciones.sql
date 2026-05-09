-- =====================================================================
-- Trazabilidad pruebas de estanqueidad — SIDES S.A.
-- Migración 03 · alineación de schema con el front + observaciones
--
-- Idempotente y no destructiva. Usa CREATE/ALTER ... IF NOT EXISTS.
-- Pegá esto en el SQL editor de Supabase y ejecutá. Si algo falla, todo
-- hace rollback (transacción única). No borra ni modifica datos existentes.
--
-- Decisiones tomadas con el cliente (registradas como deuda ISO):
--   1A) hash_integridad / firma_criptografica / hash_evento / firma_evento
--       pasan a NULLABLE temporalmente. La cadena de hash criptográfica
--       real se implementará en una Edge Function en una etapa posterior.
--   2A) Crear tabla `observaciones` para mensajes supervisor → operario.
--   3 ok) Acciones de NC quedan embebidas en no_conformidades.acciones_tomadas
--       (no se crea `acciones_nc` como tabla separada).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- 1) (Re)creación de turnos — al parecer SQL 01 no la dejó creada
-- =====================================================================
CREATE TABLE IF NOT EXISTS turnos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                 varchar(1)  NOT NULL UNIQUE
                         CHECK (codigo IN ('M','T','N')),
  nombre                 varchar(20) NOT NULL,
  hora_inicio            time        NOT NULL,
  hora_fin               time        NOT NULL,
  supervisor_default_id  uuid REFERENCES usuarios(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO turnos (codigo, nombre, hora_inicio, hora_fin) VALUES
  ('M', 'MAÑANA', '06:00', '14:00'),
  ('T', 'TARDE',  '14:00', '22:00'),
  ('N', 'NOCHE',  '22:00', '06:00')
ON CONFLICT (codigo) DO NOTHING;


-- =====================================================================
-- 2) (Re)creación de verificaciones_fisicas
-- =====================================================================
CREATE TABLE IF NOT EXISTS verificaciones_fisicas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                   varchar(40) UNIQUE,
  prueba_id                uuid NOT NULL REFERENCES pruebas(id),
  caja_id                  uuid REFERENCES cajas(id),
  turno_origen_id          uuid REFERENCES turnos(id),
  fecha_seleccion          timestamptz NOT NULL DEFAULT now(),
  supervisor_asignado_id   uuid NOT NULL REFERENCES usuarios(id),
  fecha_verificacion       timestamptz,
  muestras_presentes       varchar(20)
                           CHECK (muestras_presentes IS NULL
                             OR muestras_presentes IN ('si_todas','parcial','no')),
  cantidad_encontrada      integer
                           CHECK (cantidad_encontrada IS NULL
                             OR cantidad_encontrada >= 0),
  coincide_etiqueta_lote   boolean,
  coincide_caja            boolean,
  foto_almacen_url         text,
  observaciones            text,
  resultado                varchar(20) NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (resultado IN ('PENDIENTE','OK','DISCREPANCIA')),
  genera_nc                boolean NOT NULL DEFAULT false,
  no_conformidad_id        uuid REFERENCES no_conformidades(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_prueba_id    ON verificaciones_fisicas(prueba_id);
CREATE INDEX IF NOT EXISTS idx_vf_caja_id      ON verificaciones_fisicas(caja_id);
CREATE INDEX IF NOT EXISTS idx_vf_supervisor   ON verificaciones_fisicas(supervisor_asignado_id);
CREATE INDEX IF NOT EXISTS idx_vf_resultado    ON verificaciones_fisicas(resultado);


-- =====================================================================
-- 3) Tabla `observaciones` — mensajes supervisor → operario
-- =====================================================================
-- Cada fila es un mensaje del supervisor sobre una prueba específica.
-- El operario lo recibe en su pantalla (banner + toast) y lo confirma
-- con "OK, recibido" → leida=true.
-- =====================================================================
CREATE TABLE IF NOT EXISTS observaciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prueba_id           uuid        NOT NULL REFERENCES pruebas(id),
  prueba_codigo       varchar(40),                 -- snapshot por compatibilidad con front
  supervisor_legajo   varchar(4)  NOT NULL,
  supervisor_nombre   varchar(120),                -- snapshot
  operario_legajo     varchar(4)  NOT NULL,
  maquina_codigo      varchar(10) REFERENCES maquinas(id),
  mensaje             text        NOT NULL,
  leida               boolean     NOT NULL DEFAULT false,
  leida_at            timestamptz,
  leida_por           varchar(120),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_operario_leida ON observaciones(operario_legajo, leida);
CREATE INDEX IF NOT EXISTS idx_obs_prueba_id      ON observaciones(prueba_id);
CREATE INDEX IF NOT EXISTS idx_obs_created_at     ON observaciones(created_at);


-- =====================================================================
-- 4) Hacer NULLABLE los campos de hash/firma (deuda ISO 27001 conocida)
-- =====================================================================
-- Pruebas
ALTER TABLE pruebas
  ALTER COLUMN hash_integridad      DROP NOT NULL,
  ALTER COLUMN firma_criptografica  DROP NOT NULL;

-- Audit log
ALTER TABLE audit_log
  ALTER COLUMN hash_evento   DROP NOT NULL,
  ALTER COLUMN firma_evento  DROP NOT NULL;


-- =====================================================================
-- 5) ALTER defensivo de `pruebas` — columnas que SQL 01 debió agregar
-- =====================================================================
ALTER TABLE pruebas
  ADD COLUMN IF NOT EXISTS caja_id                  uuid REFERENCES cajas(id),
  ADD COLUMN IF NOT EXISTS lote_id                  uuid REFERENCES lotes(id),
  ADD COLUMN IF NOT EXISTS turno_id                 uuid REFERENCES turnos(id),
  ADD COLUMN IF NOT EXISTS etiqueta_contramuestra   text,
  ADD COLUMN IF NOT EXISTS ubicacion_contramuestra  text;

CREATE INDEX IF NOT EXISTS idx_pruebas_caja_id   ON pruebas(caja_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_lote_id   ON pruebas(lote_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_turno_id  ON pruebas(turno_id);


-- =====================================================================
-- 6) Diagnóstico — para cerrar la migración con confirmación visual
-- =====================================================================
-- 6a) Tablas que tienen que existir
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name IN ('turnos','lotes','cajas','verificaciones_fisicas',
                      'observaciones','tipos_falla')
ORDER  BY table_name;

-- 6b) Schema de tipos_falla (para que confirmemos cómo es la PK)
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'tipos_falla'
ORDER  BY ordinal_position;

-- 6c) Verificar que los hash/firma quedaron nullable
SELECT table_name, column_name, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  ((table_name = 'pruebas'   AND column_name IN ('hash_integridad','firma_criptografica'))
     OR (table_name = 'audit_log' AND column_name IN ('hash_evento','firma_evento')))
ORDER  BY table_name, column_name;

-- 6d) Cantidad de turnos cargados
SELECT 'turnos cargados' AS check_, count(*) AS filas FROM turnos;

COMMIT;
