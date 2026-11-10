-- SIDES · VF-002 — ASIGNACION ALEATORIA TRANSACCIONAL.
-- BORRADOR: NO APLICAR EN STAGING / PRODUCCION sin backup,
-- esquema verificado, inventario de clientes legados y QA por rol.
--
-- Una llamada RPC por entrada de turno: solo el servidor calcula
-- ventana de turno, selecciona 2 pruebas y asigna al encargado autenticado.
-- No valida el resultado técnico de los 20 cabezales.
-- ATENCION: este script REVOCA INSERT directo a authenticated en VF.
-- Se requiere desplegar cliente compatible en la misma ventana de cambio.
BEGIN;

-- Impedir que una reejecucion silencie tablas ausentes.
DO $preflight$
BEGIN
  IF to_regclass('public.verificaciones_fisicas') IS NULL
     OR to_regclass('public.pruebas') IS NULL
     OR to_regclass('public.turnos') IS NULL
     OR to_regclass('public.usuarios') IS NULL THEN
    RAISE EXCEPTION 'VF-002: faltan tablas requeridas, preparar staging antes';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.verificaciones_fisicas
    GROUP BY prueba_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'VF-002: hay pruebas duplicadas en verificaciones; resolver manualmente';
  END IF;
END
$preflight$;

-- Segunda barrera: la misma prueba digital no puede originar dos VF.
-- Se preserva el indice previo no unico; el nuevo indice no borra datos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vf_prueba_id_una_seleccion
  ON public.verificaciones_fisicas (prueba_id);

-- Libro de asignacion: UNA decision persistida por turno entrante.
-- Si no hubo pruebas, se guarda SIN_PRUEBAS para no cambiar el sorteo
-- por reintentos posteriores del navegador.
CREATE TABLE IF NOT EXISTS public.vf_asignaciones_turno (
  turno_entrante_inicio_utc timestamptz PRIMARY KEY,
  turno_origen_inicio_utc   timestamptz NOT NULL,
  supervisor_asignado_id   uuid NOT NULL REFERENCES public.usuarios(id),
  cantidad                 integer NOT NULL CHECK (cantidad >= 0),
  estado                   text NOT NULL CHECK (
    estado IN ('CREADA', 'SIN_PRUEBAS', 'LEGADO_EXISTENTE')
  ),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (turno_origen_inicio_utc < turno_entrante_inicio_utc)
);

-- Tabla interna: el navegador accede solamente a RPC, no al libro.
ALTER TABLE public.vf_asignaciones_turno ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vf_asignaciones_turno
  FROM PUBLIC, anon, authenticated;

-- Seguridad de funciones SECURITY DEFINER: objetos cualificados,
-- search_path inmutable y verificacion explicita de actor/rol.
CREATE OR REPLACE FUNCTION public.vf_asegurar_verificaciones_turno_anterior()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_hora_local timestamp;
  v_inicio_local timestamp;
  v_inicio_entrante_utc timestamptz;
  v_inicio_origen_utc timestamptz;
  v_turno_origen_codigo text;
  v_turno_origen_id uuid;
  v_existente public.vf_asignaciones_turno%ROWTYPE;
  v_legacy integer;
  v_asignadas integer := 0;
  v_estado text;
BEGIN
  -- Ningun campo cliente puede cambiar hora, cantidad, prueba ni encargado.
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = v_actor
      AND u.activo IS TRUE
      AND u.rol IN ('supervisor','admin')
  ) THEN
    RAISE EXCEPTION 'VF-002: acceso no autorizado' USING ERRCODE='42501';
  END IF;

  -- Ventanas 06-14, 14-22 y 22-06 hora Argentina.
  -- La referencia SIEMPRE es el reloj de PostgreSQL; nunca el navegador.
  v_hora_local := transaction_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  IF v_hora_local::time >= time '22:00' THEN
    v_inicio_local := date_trunc('day',v_hora_local) + interval '22 hours';
  ELSIF v_hora_local::time >= time '14:00' THEN
    v_inicio_local := date_trunc('day',v_hora_local) + interval '14 hours';
  ELSIF v_hora_local::time >= time '06:00' THEN
    v_inicio_local := date_trunc('day',v_hora_local) + interval '6 hours';
  ELSE
    v_inicio_local := date_trunc('day',v_hora_local) - interval '2 hours';
  END IF;
  v_inicio_entrante_utc := v_inicio_local AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_inicio_origen_utc := v_inicio_entrante_utc - interval '8 hours';

  -- El cierre del turno anterior es exclusivo. Los turnos de noche
  -- comparten la misma clave aunque la llamada llegue tras medianoche.
  -- El bloqueo es de TRANSACCION y se libera en COMMIT/ROLLBACK.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'SIDES_VF_002|' ||
      to_char(v_inicio_entrante_utc AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),
      0
    )
  );

  -- Leido despues del lock: una sola sesion puede decidir por ese turno.
  SELECT * INTO v_existente
  FROM public.vf_asignaciones_turno
  WHERE turno_entrante_inicio_utc = v_inicio_entrante_utc
  FOR UPDATE;

  IF FOUND THEN
    v_estado := CASE
      WHEN v_existente.estado='CREADA' AND v_existente.supervisor_asignado_id=v_actor
        THEN 'YA_ASIGNADA'
      WHEN v_existente.estado='CREADA' THEN 'ASIGNADA_A_OTRO'
      ELSE v_existente.estado
    END;
    RETURN jsonb_build_object(
      'estado',v_estado,
      'cantidad',v_existente.cantidad,
      'asignada_a_mi',v_existente.estado='CREADA'
        AND v_existente.supervisor_asignado_id=v_actor,
      'turno_inicio_utc',v_inicio_entrante_utc
    );
  END IF;

  -- Retener el comportamiento existente: turno anterior = 8 h precedentes.
  v_turno_origen_codigo := CASE
    WHEN (v_inicio_origen_utc AT TIME ZONE 'America/Argentina/Buenos_Aires')::time
         >= time '22:00' THEN 'N'
    WHEN (v_inicio_origen_utc AT TIME ZONE 'America/Argentina/Buenos_Aires')::time
         >= time '14:00' THEN 'T'
    ELSE 'M'
  END;
  SELECT t.id INTO v_turno_origen_id
  FROM public.turnos t WHERE t.codigo = v_turno_origen_codigo;
  IF v_turno_origen_id IS NULL THEN
    RAISE EXCEPTION 'VF-002: catalogo de turnos incompleto';
  END IF;

  -- Migracion sin duplicar controles anteriores creados por clientes legados.
  -- Detecta asignaciones a pruebas del mismo turno aunque sean anuladas.
  SELECT count(*) INTO v_legacy
  FROM public.verificaciones_fisicas vf
  JOIN public.pruebas p ON p.id=vf.prueba_id
  WHERE p.created_at >= (v_inicio_origen_utc AT TIME ZONE 'UTC')
    AND p.created_at <  (v_inicio_entrante_utc AT TIME ZONE 'UTC');

  IF v_legacy > 0 THEN
    INSERT INTO public.vf_asignaciones_turno(
      turno_entrante_inicio_utc,turno_origen_inicio_utc,
      supervisor_asignado_id,cantidad,estado
    ) VALUES (
      v_inicio_entrante_utc,v_inicio_origen_utc,v_actor,
      v_legacy,'LEGADO_EXISTENTE'
    );
    RETURN jsonb_build_object(
      'estado','LEGADO_EXISTENTE','cantidad',v_legacy,
      'asignada_a_mi',false,'turno_inicio_utc',v_inicio_entrante_utc
    );
  END IF;

  -- Sortear sólo ensayos que VF-001 puede contrastar y cerrar.
  -- No truncar el conjunto por los límites de página de PostgREST.
  -- pruebas.created_at es timestamp SIN zona: contrato UTC (DB timezone UTC).
  INSERT INTO public.verificaciones_fisicas (
    codigo, prueba_id, turno_origen_id, supervisor_asignado_id, resultado
  )
  SELECT
    'VF-' ||
      to_char(v_inicio_local,'YYYYMMDD') || '-' ||
      lpad(s.numero_secuencial::text,
        greatest(4,char_length(s.numero_secuencial::text)),'0'),
    s.id, v_turno_origen_id, v_actor, 'PENDIENTE'
  FROM (
    SELECT p.id,p.numero_secuencial
    FROM public.pruebas p
    WHERE p.created_at >= (v_inicio_origen_utc AT TIME ZONE 'UTC')
      AND p.created_at <  (v_inicio_entrante_utc AT TIME ZONE 'UTC')
      AND p.anulada IS FALSE
      AND p.resultado IN ('OK','RECHAZADO')
      AND NULLIF(btrim(p.estado_final::text),'') IS NOT NULL
      AND p.estado_final NOT IN ('ANULADA','ANULADO','PENDIENTE','CANCELADA')
      AND NULLIF(btrim(p.numero_caja),'') IS NOT NULL
      AND NULLIF(btrim(p.numero_lote),'') IS NOT NULL
      AND (
        (p.resultado='OK' AND p.cantidad_cabezales_afectados=0)
        OR (p.resultado='RECHAZADO' AND p.cantidad_cabezales_afectados BETWEEN 1 AND 20)
      )
    ORDER BY pg_catalog.random()
    LIMIT 2
  ) s;
  GET DIAGNOSTICS v_asignadas = ROW_COUNT;

  -- Ledger y verificaciones son la MISMA transaccion: un fallo
  -- revierte todo, sin selecciones parciales ni estado de exito falso.
  v_estado := CASE WHEN v_asignadas=0 THEN 'SIN_PRUEBAS' ELSE 'CREADA' END;
  INSERT INTO public.vf_asignaciones_turno(
    turno_entrante_inicio_utc,turno_origen_inicio_utc,
    supervisor_asignado_id,cantidad,estado
  ) VALUES (
    v_inicio_entrante_utc,v_inicio_origen_utc,
    v_actor,v_asignadas,v_estado
  );

  RETURN jsonb_build_object(
    'estado',v_estado,'cantidad',v_asignadas,
    'asignada_a_mi',v_asignadas>0,
    'turno_inicio_utc',v_inicio_entrante_utc
  );
END;
$function$;

-- REVISAR EN DESPLIEGUE: revocar acceso directo implica dejar de soportar
-- clientes antiguos que insertan verificaciones manualmente.
REVOKE ALL ON FUNCTION public.vf_asegurar_verificaciones_turno_anterior()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vf_asegurar_verificaciones_turno_anterior()
  TO authenticated;
REVOKE INSERT ON TABLE public.verificaciones_fisicas
  FROM PUBLIC, anon, authenticated;

COMMIT;
