-- ============================================================================
-- MÓDULO RECONTROL DE NC — re-inspección de rechazos, colgada de la NC
-- Plataforma: SIDES S.A (rzejddqcjqtxsenbdocz)
--
-- Decisiones del diseño (acordadas):
--   · Unidad de conteo: CABEZAL (merma = descartados × 0.0184 kg).
--   · "Abrir una NC" = en jerga de planta, "rechazar" / "abrir un rechazo".
--   · recuperados = reinspeccionados − descartados (calculado). El inspector
--     solo carga el total y los descartados (= rechazados = merma).
--   · Una NC puede tener VARIOS recontroles sucesivos (numero_intento).
--   · El cierre de la NC es MANUAL (lo hace el supervisor en el flujo de NC);
--     el recontrol solo marca cuál es el definitivo (es_recontrol_final).
--   · El recontrol SOLO cuenta disposición (no re-mide los 4 cabezales).
--
-- NO aplicar todavía: revisar primero. set_updated_at() ya existe.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) Prerrequisito: que una NC pueda nacer de un control de calidad, no solo
--    de una prueba de estanqueidad. Retrocompatible: las NC actuales conservan
--    su prueba_id; las nuevas de calidad usan control_calidad_id.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.no_conformidades
  ALTER COLUMN prueba_id DROP NOT NULL;

ALTER TABLE public.no_conformidades
  ADD COLUMN IF NOT EXISTS control_calidad_id uuid REFERENCES public.controles_calidad(id);

ALTER TABLE public.no_conformidades
  ADD CONSTRAINT nc_origen_chk
  CHECK (prueba_id IS NOT NULL OR control_calidad_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_nc_control_calidad ON public.no_conformidades(control_calidad_id);

-- ============================================================================
-- 1) recontroles — un recontrol = una re-inspección de los rechazos de UNA NC.
--    Varios por NC, ordenados por numero_intento. Conteo en cabezales.
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.recontroles_num_seq;

CREATE TABLE IF NOT EXISTS public.recontroles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_secuencial         bigint NOT NULL UNIQUE
                              DEFAULT nextval('public.recontroles_num_seq'),

  -- ── Vínculos ──────────────────────────────────────────────────────────────
  no_conformidad_id         uuid NOT NULL REFERENCES public.no_conformidades(id),
  control_calidad_id        uuid REFERENCES public.controles_calidad(id),   -- conveniencia
  numero_intento            integer NOT NULL DEFAULT 1 CHECK (numero_intento >= 1),
  inspector_legajo          varchar NOT NULL REFERENCES public.inspectores_calidad(legajo),
  inspector_nombre          varchar,
  supervisor_legajo         varchar REFERENCES public.usuarios(legajo),

  fecha_hora                timestamp without time zone NOT NULL DEFAULT now(),

  -- ── Qué se hizo antes de re-inspeccionar ──────────────────────────────────
  accion_previa             varchar
        CHECK (accion_previa IS NULL OR accion_previa IN ('RETRABAJO','SELECCION','LIMPIEZA','OTRO')),

  -- ── Conteo de la re-inspección (en CABEZALES) ─────────────────────────────
  -- La caja entra rechazada entera. El inspector saca los defectuosos
  -- (descartados = rechazados = merma). Todo lo demás es recuperado:
  -- recuperados = reinspeccionados − descartados (columna calculada).
  cabezales_reinspeccionados integer NOT NULL CHECK (cabezales_reinspeccionados >= 0),
  cabezales_descartados      integer NOT NULL DEFAULT 0 CHECK (cabezales_descartados >= 0),
  cabezales_recuperados      integer GENERATED ALWAYS AS
                               (cabezales_reinspeccionados - cabezales_descartados) STORED,

  resultado                 varchar NOT NULL DEFAULT 'PENDIENTE'
        CHECK (resultado IN ('RECUPERADO_TOTAL','RECUPERADO_PARCIAL','RECHAZADO_TOTAL','PENDIENTE')),

  -- ── Merma definitiva: descartados × 0.0184 kg (calculada automáticamente) ──
  kg_merma                  numeric GENERATED ALWAYS AS (cabezales_descartados * 0.0184) STORED,

  -- ── ¿Es el recontrol definitivo de esta NC? (el cierre lo hace el supervisor)
  es_recontrol_final        boolean NOT NULL DEFAULT false,
  observaciones             text,

  -- ── Auditoría (igual que pruebas / controles_calidad) ─────────────────────
  hash_integridad           varchar,
  firma_criptografica       varchar,

  anulado                   boolean NOT NULL DEFAULT false,
  razon_anulacion           text,
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  updated_at                timestamp without time zone NOT NULL DEFAULT now(),

  CONSTRAINT recontrol_descartados_chk
    CHECK (cabezales_descartados <= cabezales_reinspeccionados),
  CONSTRAINT recontrol_intento_unico
    UNIQUE (no_conformidad_id, numero_intento)
);

CREATE INDEX IF NOT EXISTS idx_rec_nc        ON public.recontroles(no_conformidad_id);
CREATE INDEX IF NOT EXISTS idx_rec_control   ON public.recontroles(control_calidad_id);
CREATE INDEX IF NOT EXISTS idx_rec_inspector ON public.recontroles(inspector_legajo);
CREATE INDEX IF NOT EXISTS idx_rec_fecha     ON public.recontroles(fecha_hora);

CREATE TRIGGER trg_recontroles_updated
  BEFORE UPDATE ON public.recontroles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2) recontrol_defectos — defectos que PERSISTEN tras el recontrol
--    (puente N:M al catálogo único tipos_falla; mismo patrón que controles_defectos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recontrol_defectos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recontrol_id              uuid NOT NULL
                              REFERENCES public.recontroles(id) ON DELETE CASCADE,
  tipo_falla_id             varchar NOT NULL REFERENCES public.tipos_falla(id),
  cantidad_items_afectados  integer DEFAULT 1,
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT recontrol_defectos_unico UNIQUE (recontrol_id, tipo_falla_id)
);

CREATE INDEX IF NOT EXISTS idx_recdef_recontrol ON public.recontrol_defectos(recontrol_id);
CREATE INDEX IF NOT EXISTS idx_recdef_tipo      ON public.recontrol_defectos(tipo_falla_id);

-- ============================================================================
-- 3) RLS — alinear con el resto (placeholder authenticated; ajustar luego)
-- ============================================================================
ALTER TABLE public.recontroles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recontrol_defectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY rec_rw_authenticated ON public.recontroles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY recdef_rw_authenticated ON public.recontrol_defectos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- NOTA · Cierre de la NC = MANUAL.
--   El recontrol no cierra la NC por sí mismo. Cuando es_recontrol_final = true,
--   el supervisor revisa y cierra la NC desde el flujo de no_conformidades
--   (estado='CERRADA', kg_merma, legajo_cierre, etc.). Si más adelante quieren
--   automatizarlo, se agrega un trigger AFTER INSERT que actualice la NC.
-- ============================================================================
