-- SIDES-SPC-003 | BORRADOR DE CONTRATO. NO APLICAR A PRODUCCION NI STAGING.
-- Requiere revisión de Calidad/Seguridad, migración versionada, backup/restore
-- y pruebas negativas Auth HTTP con usuarios sintéticos antes de su uso.
-- No habilita VALIDADO en pruebas.spc_uso_estadistico.
BEGIN;

CREATE SCHEMA IF NOT EXISTS spc_private;
REVOKE ALL ON SCHEMA spc_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA spc_private TO authenticated;

CREATE TABLE IF NOT EXISTS spc_private.protocolos_muestreo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  maquina_id text NOT NULL CHECK (maquina_id = 'MAQ-010'),
  tamano_muestra integer NOT NULL CHECK (tamano_muestra = 20),
  metodo_extraccion text NOT NULL CHECK (metodo_extraccion IN ('ALEATORIO_DOCUMENTADO', 'SISTEMATICO_VALIDADO')),
  estado text NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR', 'APROBADO', 'RETIRADO')),
  aprobado_por uuid REFERENCES public.usuarios(id),
  aprobado_en timestamptz,
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  CONSTRAINT protocolo_aprobacion_chk CHECK (
    (estado = 'APROBADO' AND aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL
     AND vigente_desde IS NOT NULL)
    OR estado <> 'APROBADO'
  ),
  CONSTRAINT protocolo_periodo_chk CHECK (
    vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta > vigente_desde
  ),
  UNIQUE (codigo, version)
);

CREATE TABLE IF NOT EXISTS spc_private.validaciones_muestra_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prueba_id uuid NOT NULL REFERENCES public.pruebas(id),
  protocolo_id uuid NOT NULL REFERENCES spc_private.protocolos_muestreo(id),
  decision text NOT NULL
    CHECK (decision IN ('VALIDAR_DESCRIPTIVA', 'RECHAZAR', 'REVOCAR')),
  evidencia_ref text NOT NULL CHECK (evidencia_ref ~ '^[A-Za-z0-9_./:-]{6,160}$'),
  motivo text,
  actor_uid uuid NOT NULL REFERENCES public.usuarios(id),
  fecha_servidor timestamptz NOT NULL DEFAULT clock_timestamp(),
  ensayo_servidor_utc timestamptz,
  huella_datos text NOT NULL CHECK (huella_datos ~ '^[a-f0-9]{64}$'),
  CONSTRAINT decision_motivo_chk CHECK (
    decision = 'VALIDAR_DESCRIPTIVA' OR
    (length(btrim(motivo)) BETWEEN 6 AND 300)
  )
);
CREATE INDEX IF NOT EXISTS idx_spc_validaciones_prueba_evento
  ON spc_private.validaciones_muestra_eventos (prueba_id, id DESC);

-- Las tablas privadas no están expuestas por Data API. No hay políticas
-- permisivas ni grants de escritura o lectura directa a authenticated.
ALTER TABLE spc_private.protocolos_muestreo ENABLE ROW LEVEL SECURITY;
ALTER TABLE spc_private.validaciones_muestra_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spc_private.protocolos_muestreo,
  spc_private.validaciones_muestra_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE spc_private.validaciones_muestra_eventos_id_seq
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION spc_private.impedir_edicion_validaciones()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
  RAISE EXCEPTION 'Historial de validación inmutable: registrar otro evento';
END
$guard$;
DROP TRIGGER IF EXISTS tr_spc_validaciones_inmutables
  ON spc_private.validaciones_muestra_eventos;
CREATE TRIGGER tr_spc_validaciones_inmutables
BEFORE UPDATE OR DELETE ON spc_private.validaciones_muestra_eventos
FOR EACH ROW EXECUTE FUNCTION spc_private.impedir_edicion_validaciones();

-- Huella de contenido original y detalle por tipo: si cambia la prueba
-- tras aprobarla, el estado vigente deja de considerarse válido.
CREATE OR REPLACE FUNCTION spc_private.huella_muestra(p_prueba_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $huella$
  SELECT encode(extensions.digest(jsonb_build_object(
    'prueba_id', t.id, 'solicitud', t.spc_request_id,
    'maquina', t.id_maquina, 'producto', t.codigo_producto,
    'caja', t.numero_caja, 'lote', t.numero_lote,
    'resultado', t.resultado, 'estado_final', t.estado_final,
    'afectados', t.cantidad_cabezales_afectados,
    'inspeccionados', t.spc_cabezales_inspeccionados,
    'origen', t.spc_origen_evento, 'uso', t.spc_uso_estadistico,
    'completada', t.timestamp_completada,
    'fallas', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id', f.id, 'tipo', f.tipo_falla_id,
         'cantidad', f.cantidad_items_afectados
       ) ORDER BY f.tipo_falla_id, f.id)
       FROM public.pruebas_fallas f WHERE f.prueba_id=t.id
     ), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  FROM public.pruebas t WHERE t.id=p_prueba_id;
$huella$;

CREATE OR REPLACE FUNCTION spc_private.resolver_validacion_muestra(
  p_prueba_id uuid, p_protocolo_id uuid, p_evidencia_ref text,
  p_decision text, p_motivo text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, spc_private
AS $impl$
DECLARE
  actor record;
  ensayo record;
  protocolo record;
  anterior text;
  n_tipos integer;
  n_distintos integer;
  n_suma integer;
  detalle_valido boolean;
  ensayo_utc timestamptz;
  huella text;
  nuevo_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT id, legajo, rol INTO actor FROM public.usuarios
    WHERE id=auth.uid() AND activo=true;
  IF NOT FOUND OR actor.rol <> 'supervisor' THEN
    RAISE EXCEPTION 'Solo supervisor de Calidad puede decidir sobre muestras';
  END IF;
  IF p_prueba_id IS NULL OR p_protocolo_id IS NULL
     OR p_decision NOT IN ('VALIDAR_DESCRIPTIVA','RECHAZAR','REVOCAR')
     OR p_evidencia_ref IS NULL
     OR p_evidencia_ref !~ '^[A-Za-z0-9_./:-]{6,160}$'
     OR (p_decision <> 'VALIDAR_DESCRIPTIVA'
         AND (p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 6 AND 300))
  THEN RAISE EXCEPTION 'Argumentos de validacion invalidos'; END IF;

  SELECT * INTO ensayo FROM public.pruebas WHERE id=p_prueba_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prueba inexistente'; END IF;
  IF ensayo.id_maquina <> 'MAQ-010' OR ensayo.spc_request_id IS NULL
    OR ensayo.spc_origen_evento <> 'MANUAL_NO_OT'
    OR ensayo.spc_uso_estadistico <> 'NO_VALIDADO'
    OR ensayo.operario_legajo = actor.legajo
  THEN RAISE EXCEPTION 'Prueba no autorizada para validacion independiente'; END IF;

  SELECT * INTO protocolo FROM spc_private.protocolos_muestreo
    WHERE id=p_protocolo_id;
  IF NOT FOUND OR protocolo.maquina_id <> ensayo.id_maquina
     OR protocolo.estado <> 'APROBADO' OR protocolo.tamano_muestra <> 20
     OR protocolo.aprobado_en IS NULL OR protocolo.vigente_desde IS NULL
  THEN RAISE EXCEPTION 'Protocolo no aprobado o no aplicable'; END IF;

  SELECT decision INTO anterior FROM spc_private.validaciones_muestra_eventos
   WHERE prueba_id=p_prueba_id ORDER BY id DESC LIMIT 1;

  IF p_decision='REVOCAR' THEN
    IF anterior IS DISTINCT FROM 'VALIDAR_DESCRIPTIVA' THEN
      RAISE EXCEPTION 'Solo se revoca una validacion vigente';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM spc_private.validaciones_muestra_eventos
    WHERE prueba_id=p_prueba_id AND decision='VALIDAR_DESCRIPTIVA'
  ) THEN
    RAISE EXCEPTION 'Una muestra validada o revocada no se revalida';
  END IF;

  IF p_decision='VALIDAR_DESCRIPTIVA' THEN
    IF ensayo.resultado NOT IN ('OK','RECHAZADO')
       OR ensayo.estado_final IN ('PENDIENTE','ANULADA','ANULADO','CANCELADA')
       OR ensayo.spc_cabezales_inspeccionados <> 20
       OR ensayo.codigo_producto IS NULL OR btrim(ensayo.codigo_producto)=''
       OR ensayo.numero_caja IS NULL OR btrim(ensayo.numero_caja)=''
       OR ensayo.numero_lote IS NULL OR btrim(ensayo.numero_lote)=''
       OR ensayo.cantidad_cabezales_afectados IS NULL
       OR ensayo.cantidad_cabezales_afectados NOT BETWEEN 0 AND 20
       OR ensayo.timestamp_completada IS NULL
    THEN RAISE EXCEPTION 'Prueba incompleta para validacion'; END IF;

    -- Solo RPC SPC-001 genera esta columna como UTC naive; el origen
    -- se verifica con spc_request_id y spc_origen_evento. No convertir
    -- created_at historico sin prueba de procedencia.
    ensayo_utc := ensayo.timestamp_completada AT TIME ZONE 'UTC';
    IF ensayo_utc > clock_timestamp() + interval '5 minutes'
       OR ensayo_utc < protocolo.vigente_desde
       OR ensayo_utc < protocolo.aprobado_en
       OR (protocolo.vigente_hasta IS NOT NULL
           AND ensayo_utc >= protocolo.vigente_hasta)
    THEN RAISE EXCEPTION 'Ensayo fuera de vigencia de protocolo'; END IF;

    SELECT count(*), count(DISTINCT tipo_falla_id),
           COALESCE(sum(cantidad_items_afectados),0),
           COALESCE(bool_and(
             cantidad_items_afectados IS NOT NULL
             AND cantidad_items_afectados BETWEEN 1
             AND ensayo.cantidad_cabezales_afectados
           ),true)
      INTO n_tipos,n_distintos,n_suma,detalle_valido
      FROM public.pruebas_fallas WHERE prueba_id=p_prueba_id;
    IF (ensayo.resultado='OK' AND
         (ensayo.cantidad_cabezales_afectados<>0 OR n_tipos<>0))
       OR (ensayo.resultado='RECHAZADO' AND
         (ensayo.cantidad_cabezales_afectados<1 OR n_tipos<1
          OR n_tipos<>n_distintos OR NOT detalle_valido
          OR n_suma<ensayo.cantidad_cabezales_afectados))
    THEN RAISE EXCEPTION 'Detalle de defectos inconsistente'; END IF;
  END IF;

  huella := spc_private.huella_muestra(p_prueba_id);
  INSERT INTO spc_private.validaciones_muestra_eventos (
    prueba_id,protocolo_id,decision,evidencia_ref,motivo,
    actor_uid,ensayo_servidor_utc,huella_datos
  ) VALUES (
    p_prueba_id,p_protocolo_id,p_decision,p_evidencia_ref,p_motivo,
    actor.id,ensayo_utc,huella
  ) RETURNING id INTO nuevo_id;

  RETURN jsonb_build_object('evento_id',nuevo_id,
    'decision',p_decision,'estado_estadistico','SOLO_OBSERVACION');
END
$impl$;

-- Wrapper público invoker; función elevada interna con defensa explícita.
CREATE OR REPLACE FUNCTION public.spc_resolver_validacion_muestra(
  p_prueba_id uuid, p_protocolo_id uuid, p_evidencia_ref text,
  p_decision text, p_motivo text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, spc_private
AS $wrapper$
  SELECT spc_private.resolver_validacion_muestra(
    p_prueba_id,p_protocolo_id,p_evidencia_ref,p_decision,p_motivo
  );
$wrapper$;

REVOKE ALL ON FUNCTION spc_private.huella_muestra(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION spc_private.impedir_edicion_validaciones()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION spc_private.resolver_validacion_muestra(
  uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION spc_private.resolver_validacion_muestra(
  uuid,uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.spc_resolver_validacion_muestra(
  uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spc_resolver_validacion_muestra(
  uuid,uuid,text,text,text) TO authenticated;

-- No se crean protocolos APROBADO por defecto. No existe ruta de
-- actualización directa de aprobaciones para operadores ni clientes.
-- No modificar pruebas.spc_uso_estadistico: el CHECK NO_VALIDADO sigue.
COMMIT;
