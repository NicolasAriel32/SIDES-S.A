-- ============================================================================
-- MÓDULO CONTROL DE CALIDAD (dimensional/visual)
-- Integración sobre la plataforma de Trazabilidad de Estanqueidad (SIDES S.A)
-- Tablas nuevas: especifc_producto · controles_calidad · mediciones
-- Se enganchan a la columna vertebral existente: maquinas, lotes, cajas,
-- turnos, usuarios, no_conformidades (NC unificadas) y audit_log.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) Función genérica para mantener updated_at (segura de re-ejecutar)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1) especifc_producto — límites/especificaciones por producto
--    (hoy viven hardcodeados en el JSX: rangos de apertura y de largo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.especifc_producto (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_producto           varchar NOT NULL UNIQUE,            -- "Sifón 1L Classic"
  codigo_producto           varchar UNIQUE
        CHECK (codigo_producto IS NULL
               OR codigo_producto ~ '^RC[LE]-\d{3}[CA]-[A-Z]{2}$'), -- formato de B
  -- Apertura de tapa (rango fijo universal en el JSX: 800–1800 g)
  apertura_min_g            numeric NOT NULL DEFAULT 800,
  apertura_max_g            numeric NOT NULL DEFAULT 1800,
  -- Largo de cabezal (varía por producto, ± sobre nominal)
  largo_min_mm              numeric NOT NULL,
  largo_max_mm              numeric NOT NULL,
  largo_nom_mm              numeric,
  -- Cantidad de cabezales que se miden por control (4 en el prototipo)
  cabezales_muestra         integer NOT NULL DEFAULT 4 CHECK (cabezales_muestra > 0),
  activo                    boolean NOT NULL DEFAULT true,
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  updated_at                timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT especifc_producto_apertura_chk CHECK (apertura_max_g  > apertura_min_g),
  CONSTRAINT especifc_producto_largo_chk    CHECK (largo_max_mm    > largo_min_mm)
);

CREATE TRIGGER trg_especifc_producto_updated
  BEFORE UPDATE ON public.especifc_producto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1b) inspectores_calidad — catálogo del personal de calidad (NO inician sesión)
--     La estación de calidad entra con UNA sola cuenta (usuarios.rol='inspector')
--     y, dentro del módulo, se elige quién está de turno desde este catálogo
--     (reemplaza la lista INSPECTORES hardcodeada del JSX).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inspectores_calidad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legajo        varchar NOT NULL UNIQUE,        -- ej: 'CAL1'
  nombre        varchar NOT NULL,               -- ej: 'García, Marcela'
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamp without time zone NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2) controles_calidad — registro de control (equivalente al `registros` del JSX)
--    Espejo estructural de `pruebas`, pero para el control dimensional/visual.
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.controles_calidad_num_seq;

CREATE TABLE IF NOT EXISTS public.controles_calidad (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_secuencial         bigint NOT NULL UNIQUE
                              DEFAULT nextval('public.controles_calidad_num_seq'),

  -- ── Claves de unión con la columna vertebral ──────────────────────────────
  id_maquina                varchar NOT NULL REFERENCES public.maquinas(id),
  caja_id                   uuid REFERENCES public.cajas(id),
  lote_id                   uuid REFERENCES public.lotes(id),
  turno_id                  uuid REFERENCES public.turnos(id),
  especifc_producto_id      uuid REFERENCES public.especifc_producto(id),
  inspector_legajo          varchar NOT NULL REFERENCES public.inspectores_calidad(legajo),
  inspector_nombre          varchar,                            -- snapshot del nombre
  supervisor_legajo         varchar REFERENCES public.usuarios(legajo),

  -- ── Snapshots denormalizados (igual que hace `pruebas`) ───────────────────
  numero_caja               varchar,
  numero_lote               varchar,
  nombre_producto           varchar,
  codigo_producto           varchar
        CHECK (codigo_producto IS NULL
               OR codigo_producto ~ '^RC[LE]-\d{3}[CA]-[A-Z]{2}$'),
  cliente                   varchar,
  orden_id                  varchar,
  sesion_id                 varchar,                            -- "SES-YYYYMMDD-HHMM"

  -- ── Resultado del control ─────────────────────────────────────────────────
  fecha_hora                timestamp without time zone NOT NULL DEFAULT now(),
  resultado                 varchar NOT NULL DEFAULT 'PENDIENTE'
        CHECK (resultado IN ('OK','RECHAZADO','PENDIENTE')),
  no_conforme               boolean NOT NULL DEFAULT false,
  observacion_libre         text,                               -- defectos → tabla controles_defectos

  -- ── Rango de rechazo (lógica del panel NC del JSX) ────────────────────────
  cantidad_rechazo          integer CHECK (cantidad_rechazo IS NULL OR cantidad_rechazo >= 0),
  caja_desde                integer,
  caja_hasta                integer,

  -- ── Enganche con la NC unificada y con la auditoría ───────────────────────
  no_conformidad_id         uuid REFERENCES public.no_conformidades(id),
  hash_integridad           varchar,
  firma_criptografica       varchar,

  anulada                   boolean NOT NULL DEFAULT false,
  razon_anulacion           text,
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  updated_at                timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT cc_rango_coherente CHECK (
    caja_desde IS NULL OR caja_hasta IS NULL OR caja_hasta >= caja_desde
  ),
  CONSTRAINT cc_nc_requiere_rango CHECK (
    no_conforme = false
    OR (cantidad_rechazo IS NOT NULL AND caja_desde IS NOT NULL AND caja_hasta IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cc_maquina   ON public.controles_calidad(id_maquina);
CREATE INDEX IF NOT EXISTS idx_cc_caja      ON public.controles_calidad(caja_id);
CREATE INDEX IF NOT EXISTS idx_cc_lote      ON public.controles_calidad(lote_id);
CREATE INDEX IF NOT EXISTS idx_cc_turno     ON public.controles_calidad(turno_id);
CREATE INDEX IF NOT EXISTS idx_cc_inspector ON public.controles_calidad(inspector_legajo);
CREATE INDEX IF NOT EXISTS idx_cc_nc        ON public.controles_calidad(no_conformidad_id);
CREATE INDEX IF NOT EXISTS idx_cc_fecha     ON public.controles_calidad(fecha_hora);

CREATE TRIGGER trg_controles_calidad_updated
  BEFORE UPDATE ON public.controles_calidad
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3) mediciones — detalle por cabezal (normaliza apertura_tapa[4] y largo_cabezal[4])
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mediciones (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id                uuid NOT NULL
                              REFERENCES public.controles_calidad(id) ON DELETE CASCADE,
  posicion_cabezal          integer NOT NULL CHECK (posicion_cabezal BETWEEN 1 AND 8),
  tipo_medicion             varchar NOT NULL CHECK (tipo_medicion IN ('APERTURA','LARGO')),
  valor                     numeric NOT NULL,
  unidad                    varchar NOT NULL CHECK (unidad IN ('g','mm')),
  fuera_rango               boolean NOT NULL DEFAULT false,     -- flag de alerta del JSX
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT mediciones_unica UNIQUE (control_id, tipo_medicion, posicion_cabezal)
);

CREATE INDEX IF NOT EXISTS idx_med_control ON public.mediciones(control_id);

-- ============================================================================
-- 3b) controles_defectos — puente N:M con el catálogo EXISTENTE tipos_falla
--     (mismo patrón que pruebas_fallas; no se duplica catálogo de defectos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.controles_defectos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id                uuid NOT NULL
                              REFERENCES public.controles_calidad(id) ON DELETE CASCADE,
  tipo_falla_id             varchar NOT NULL REFERENCES public.tipos_falla(id),
  cantidad_items_afectados  integer DEFAULT 1,
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT controles_defectos_unico UNIQUE (control_id, tipo_falla_id)
);

CREATE INDEX IF NOT EXISTS idx_cdef_control ON public.controles_defectos(control_id);
CREATE INDEX IF NOT EXISTS idx_cdef_tipo    ON public.controles_defectos(tipo_falla_id);

-- ============================================================================
-- 4) RLS — alinear con el resto del esquema (todas las tablas usan RLS)
--    Ajustá las policies a tus roles reales; estas son un punto de partida.
-- ============================================================================
ALTER TABLE public.especifc_producto    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspectores_calidad  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controles_calidad    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediciones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controles_defectos   ENABLE ROW LEVEL SECURITY;

CREATE POLICY insp_rw_authenticated ON public.inspectores_calidad
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY cdef_rw_authenticated ON public.controles_defectos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY cc_rw_authenticated ON public.controles_calidad
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY med_rw_authenticated ON public.mediciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY especif_read_authenticated ON public.especifc_producto
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 5) Rol 'inspector' = UNA sola cuenta compartida (la estación de calidad)
--    Todos los de calidad usan la misma PC y entran con este único usuario.
--    El inspector de turno se elige DENTRO del módulo (inspectores_calidad),
--    no es un login por persona. Solo se habilita la lógica del rol.
-- ============================================================================
ALTER TABLE public.usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('operario','supervisor','admin','auditor','inspector'));

-- ============================================================================
-- 6) Seed de especifc_producto con los 5 productos del prototipo
-- ============================================================================
INSERT INTO public.especifc_producto
  (nombre_producto, apertura_min_g, apertura_max_g, largo_min_mm, largo_max_mm, largo_nom_mm)
VALUES
  ('Sifón 1L Classic', 800, 1800, 145.0, 149.0, 147),
  ('Sifón 1L Premium', 800, 1800, 146.0, 150.0, 148),
  ('Sifón 750ml',      800, 1800, 130.0, 134.0, 132),
  ('Recarga CO2 std',  800, 1800, 120.0, 124.0, 122),
  ('Recarga CO2 plus', 800, 1800, 122.0, 126.0, 124)
ON CONFLICT (nombre_producto) DO NOTHING;

-- ============================================================================
-- 7) Extender tipos_falla con los defectos propios del control de calidad
--    que aún no existen en el catálogo (los demás ya estaban: PRC, CLV, EST,
--    ENC, MGT, CTP, STB, MPR, INO). Así se usa UN solo catálogo compartido.
-- ============================================================================
INSERT INTO public.tipos_falla (id, nombre, gravedad, descripcion) VALUES
  ('PLH', 'Leve palanca hundida',     'MENOR', 'Defecto visual de palanca'),
  ('PLV', 'Polvillo',                 'MENOR', 'Presencia de polvillo'),
  ('PCD', 'Pico descolorido',         'MENOR', 'Decoloración en el pico'),
  ('CBG', 'Cabezal con golpe',        'MAYOR', 'Golpe en cabezal'),
  ('LFR', 'Largo fuera de rango',     'MAYOR', 'Largo de cabezal fuera de especificación'),
  ('AFR', 'Apertura fuera de rango',  'MAYOR', 'Apertura de tapa fuera de 800-1800 g'),
  ('OTR', 'Otro',                     'MENOR', 'Otro defecto (ver observación libre)')
ON CONFLICT (id) DO NOTHING;
