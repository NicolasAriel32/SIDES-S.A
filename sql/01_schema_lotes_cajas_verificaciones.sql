-- =====================================================================
-- Trazabilidad pruebas de estanqueidad — SIDES S.A.
-- Migración 01 · turnos + lotes + cajas + verificaciones_fisicas
-- + parches no destructivos a la tabla `pruebas`
--
-- Idempotente: usa CREATE/ALTER ... IF NOT EXISTS y ON CONFLICT DO NOTHING.
-- Pegá esto en el SQL editor de Supabase y ejecutá. Si algo falla, todo
-- hace rollback (transacción única). No borra ni modifica datos existentes.
--
-- Corrección v2: cajas.maquina_id pasa de uuid a varchar(10)
-- para coincidir con maquinas.id (character varying(10)).
-- Verificado contra information_schema:
--   maquinas.id        → varchar(10)
--   usuarios.id        → uuid
--   pruebas.id         → uuid
--   no_conformidades.id→ uuid
-- =====================================================================

BEGIN;

-- pgcrypto provee gen_random_uuid(). En Supabase suele estar habilitada,
-- pero CREATE EXTENSION IF NOT EXISTS es seguro y no rompe si ya existe.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- 1) TABLA  turnos
-- =====================================================================
-- Catálogo cerrado. 3 filas: MAÑANA / TARDE / NOCHE.
-- Permite filtrar KPIs por turno y asignar verificaciones físicas.
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
-- 2) TABLA  lotes
-- =====================================================================
-- Lote = identificador del producto (viene impreso en la etiqueta y el
-- operario lo copia manualmente). Un lote puede atravesar varias máquinas;
-- el vínculo a máquina vive en la tabla `cajas`, no acá.
-- =====================================================================
CREATE TABLE IF NOT EXISTS lotes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_lote                 varchar(64) NOT NULL UNIQUE,
  fecha_creacion              date        NOT NULL DEFAULT current_date,
  codigo_producto             varchar(50),
  estado                      varchar(20) NOT NULL DEFAULT 'en_produccion'
                              CHECK (estado IN
                                ('en_produccion','liberado','retenido','rechazado')),
  responsable_liberacion_id   uuid REFERENCES usuarios(id),
  fecha_liberacion            timestamptz,
  comentario_liberacion       text,
  anulada                     boolean NOT NULL DEFAULT false,
  anulacion_motivo            text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lotes_estado          ON lotes(estado);
CREATE INDEX IF NOT EXISTS idx_lotes_fecha_creacion  ON lotes(fecha_creacion);


-- =====================================================================
-- 3) TABLA  cajas
-- =====================================================================
-- Caja = unidad física de almacenamiento. Pertenece a UNA máquina y
-- UN lote (un mismo lote puede tener cajas de varias máquinas).
-- numero_caja se reinicia por lote: por eso UNIQUE(numero_caja, lote_id).
--
-- Importante: cajas.maquina_id es varchar(10) porque maquinas.id es varchar.
-- =====================================================================
CREATE TABLE IF NOT EXISTS cajas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_caja         varchar(64) NOT NULL,
  lote_id             uuid        NOT NULL REFERENCES lotes(id),
  maquina_id          varchar(10) NOT NULL REFERENCES maquinas(id),
  fecha_armado        date        NOT NULL DEFAULT current_date,
  cantidad_cabezales  integer     NOT NULL DEFAULT 336
                      CHECK (cantidad_cabezales > 0),
  estado              varchar(20) NOT NULL DEFAULT 'en_produccion'
                      CHECK (estado IN
                        ('en_produccion','ok','retenida','liberada','rechazada')),
  ubicacion_almacen   varchar(120),
  anulada             boolean     NOT NULL DEFAULT false,
  anulacion_motivo    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cajas_numero_lote_unq UNIQUE (numero_caja, lote_id)
);

CREATE INDEX IF NOT EXISTS idx_cajas_lote_id     ON cajas(lote_id);
CREATE INDEX IF NOT EXISTS idx_cajas_maquina_id  ON cajas(maquina_id);
CREATE INDEX IF NOT EXISTS idx_cajas_estado      ON cajas(estado);


-- =====================================================================
-- 4) TABLA  verificaciones_fisicas
-- =====================================================================
-- Anti-fraude. N8N selecciona aleatoriamente 2 pruebas del turno anterior
-- y crea una fila acá. Supervisor va al almacén, busca la contramuestra,
-- valida y completa. Tolerancia cero: cualquier desvío → DISCREPANCIA.
--
-- prueba_id   = lo que se debió haber muestreado
-- caja_id     = lo que efectivamente apareció en el almacén (puede diferir)
-- =====================================================================
CREATE TABLE IF NOT EXISTS verificaciones_fisicas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                   varchar(40) UNIQUE,        -- ej: VF-20260508-0001
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
  foto_almacen_url         text,                      -- futuro Supabase Storage
  observaciones            text,
  resultado                varchar(20) NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (resultado IN ('PENDIENTE','OK','DISCREPANCIA')),
  genera_nc                boolean NOT NULL DEFAULT false,
  no_conformidad_id        uuid REFERENCES no_conformidades(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_prueba_id          ON verificaciones_fisicas(prueba_id);
CREATE INDEX IF NOT EXISTS idx_vf_caja_id            ON verificaciones_fisicas(caja_id);
CREATE INDEX IF NOT EXISTS idx_vf_supervisor         ON verificaciones_fisicas(supervisor_asignado_id);
CREATE INDEX IF NOT EXISTS idx_vf_resultado          ON verificaciones_fisicas(resultado);


-- =====================================================================
-- 5) PARCHES NO DESTRUCTIVOS A `pruebas`
-- =====================================================================
-- Agrego columnas nuevas, todas nullable, sin tocar lo existente.
-- numero_caja y numero_lote (varchar) quedan como snapshot, igual que
-- maquina_codigo. caja_id y lote_id pasan a ser la fuente de verdad.
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
-- 6) Verificación rápida (no muta nada).
-- Si la corrida fue OK, vas a ver "turnos cargados | 3" y las 4 tablas.
-- =====================================================================
SELECT 'turnos cargados' AS check_, count(*) AS filas FROM turnos;

SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name IN ('turnos','lotes','cajas','verificaciones_fisicas')
ORDER  BY table_name;

COMMIT;
