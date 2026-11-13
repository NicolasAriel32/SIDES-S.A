-- SIDES-SPC-001 | BORRADOR DE MIGRACIÓN - NO EJECUTAR SOBRE PRODUCCIÓN
-- Los registros anteriores permanecen intactos: columnas nuevas NULL para históricos.
-- Requiere backup verificado, ambiente aislado, revisión OT/Calidad/Seguridad y autorización.

ALTER TABLE public.pruebas
  ADD COLUMN IF NOT EXISTS spc_request_id uuid,
  ADD COLUMN IF NOT EXISTS spc_payload_hash text,
  ADD COLUMN IF NOT EXISTS spc_origen_evento text,
  ADD COLUMN IF NOT EXISTS spc_cabezales_inspeccionados integer,
  ADD COLUMN IF NOT EXISTS spc_uso_estadistico text;

-- En esta fase no se acepta ninguna atribucion de origen OT ni aptitud SPC.
-- NOT VALID evita revalidar filas historicas; aplica a escrituras nuevas.
ALTER TABLE public.pruebas
  ADD CONSTRAINT pruebas_spc_origen_manual_chk
    CHECK (spc_origen_evento IS NULL OR spc_origen_evento = 'MANUAL_NO_OT') NOT VALID,
  ADD CONSTRAINT pruebas_spc_no_validado_chk
    CHECK (spc_uso_estadistico IS NULL OR spc_uso_estadistico = 'NO_VALIDADO') NOT VALID,
  ADD CONSTRAINT pruebas_spc_n20_chk
    CHECK (spc_cabezales_inspeccionados IS NULL OR spc_cabezales_inspeccionados = 20) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pruebas_spc_request
  ON public.pruebas (spc_request_id);
-- PostgreSQL permite múltiples NULL en este índice: no afecta las filas históricas.

-- Evita el acceso INSERT directo de clientes: todas las pruebas nuevas
-- ingresan por una funcion interna con privilegios acotados y validacion
-- explicita de auth.uid, rol, maquina y contenido.
-- La funcion con SECURITY DEFINER vive en un esquema NO expuesto por PostgREST;
-- el wrapper publico conserva SECURITY INVOKER.
CREATE SCHEMA IF NOT EXISTS spc_private;
REVOKE ALL ON SCHEMA spc_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA spc_private TO authenticated;

CREATE OR REPLACE FUNCTION spc_private.registrar_prueba_estanqueidad_internal(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_request_id uuid;
  v_hash text;
  v_actor_rol text;
  v_actor_legajo text;
  v_actor_maquina text;
  v_maquina text;
  v_producto text;
  v_caja text;
  v_lote text;
  v_estado text;
  v_auto boolean;
  v_n int;
  v_tipos jsonb;
  v_cantidades jsonb;
  v_claves int;
  v_tipo text;
  v_valor text;
  v_cantidad int;
  v_suma int := 0;
  v_lista text[] := ARRAY[]::text[];
  v_hora time;
  v_turno_codigo text;
  v_turno_id uuid;
  v_inicio timestamp without time zone;
  v_fin timestamp without time zone;
  v_prueba_id uuid;
  v_secuencial bigint;
  v_existente record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  SELECT u.rol, u.legajo, u.maquina_asignada
    INTO v_actor_rol, v_actor_legajo, v_actor_maquina
    FROM public.usuarios u
   WHERE u.id = auth.uid() AND u.activo = true;
  IF NOT FOUND OR v_actor_rol IS NULL OR v_actor_rol NOT IN ('operario','supervisor','inspector','admin') THEN
    RAISE EXCEPTION 'Usuario no autorizado para registrar pruebas de estanqueidad';
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Payload inválido';
  END IF;
  v_request_id := NULLIF(p->>'request_id','')::uuid;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Identificador de solicitud obligatorio';
  END IF;
  v_hash := encode(extensions.digest(p::text,'sha256'),'hex');
  v_maquina := NULLIF(btrim(p->>'id_maquina'),'');
  v_producto := NULLIF(btrim(p->>'codigo_producto'),'');
  v_caja := NULLIF(btrim(p->>'numero_caja'),'');
  v_lote := NULLIF(btrim(p->>'numero_lote'),'');
  v_estado := p->>'resultado';
  v_auto := COALESCE((p->>'auto_pendiente')::boolean, false);
  v_n := COALESCE((p->>'cabezales_afectados')::int, 0);
  v_tipos := COALESCE(p->'tipos','[]'::jsonb);
  v_cantidades := COALESCE(p->'cantidades_por_tipo','{}'::jsonb);

  IF v_maquina IS NULL OR NOT EXISTS (SELECT 1 FROM public.maquinas m WHERE m.id = v_maquina AND m.activa IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Máquina inexistente o inactiva';
  END IF;
  IF v_actor_rol = 'operario' AND v_actor_maquina IS DISTINCT FROM v_maquina THEN
    RAISE EXCEPTION 'El operario sólo puede registrar su máquina asignada';
  END IF;
  IF jsonb_typeof(v_tipos) <> 'array' OR jsonb_typeof(v_cantidades) <> 'object' THEN
    RAISE EXCEPTION 'Estructura inválida de tipos o cantidades';
  END IF;
  SELECT count(*) INTO v_claves FROM jsonb_object_keys(v_cantidades);
  IF v_n < 0 OR v_n > 20 THEN
    RAISE EXCEPTION 'Los cabezales afectados deben estar entre 0 y 20';
  END IF;
  -- Alineado con el catálogo del formulario: formato, tamaño y color.
  -- No se recalculan productos históricos.
  IF NOT v_auto AND v_producto IS NOT NULL AND
     v_producto !~ '^RC[LE]-(284|294|300|310|320|336)[CA]-(RO|NE|BL|CE|AZ|VE|AM|NA|GR|RS|VI|MA)$' THEN
    RAISE EXCEPTION 'Código de producto no admitido';
  END IF;

  IF v_auto THEN
    IF v_estado IS DISTINCT FROM 'PENDIENTE' OR v_n <> 0
       OR jsonb_array_length(v_tipos) <> 0 OR v_claves <> 0
       OR v_producto IS NOT NULL OR v_caja IS NOT NULL OR v_lote IS NOT NULL THEN
      RAISE EXCEPTION 'Un pendiente automático no contiene datos de un ensayo realizado';
    END IF;
  ELSIF v_estado = 'OK' THEN
    IF v_producto IS NULL OR v_caja IS NULL OR v_lote IS NULL THEN
      RAISE EXCEPTION 'Producto, caja y lote son obligatorios en una prueba realizada';
    END IF;
    IF v_n <> 0 OR jsonb_array_length(v_tipos) <> 0 OR v_claves <> 0 THEN
      RAISE EXCEPTION 'Una prueba OK debe tener cero cabezales y tipos de falla';
    END IF;
  ELSIF v_estado = 'RECHAZADO' THEN
    IF v_producto IS NULL OR v_caja IS NULL OR v_lote IS NULL THEN
      RAISE EXCEPTION 'Producto, caja y lote son obligatorios en una prueba realizada';
    END IF;
    IF v_n < 1 OR jsonb_array_length(v_tipos) = 0 OR v_claves <> jsonb_array_length(v_tipos) THEN
      RAISE EXCEPTION 'Una prueba con falla requiere cabezales y cantidades por tipo';
    END IF;
    FOR v_tipo IN SELECT jsonb_array_elements_text(v_tipos) LOOP
      IF v_tipo IS NULL OR v_tipo = '' OR v_tipo = ANY(v_lista) THEN
        RAISE EXCEPTION 'Tipo de falla vacío o duplicado';
      END IF;
      v_lista := array_append(v_lista,v_tipo);
      IF NOT EXISTS (SELECT 1 FROM public.tipos_falla f WHERE f.id = v_tipo) THEN
        RAISE EXCEPTION 'Tipo de falla no registrado';
      END IF;
      v_valor := v_cantidades->>v_tipo;
      IF v_valor IS NULL OR v_valor !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Cantidad por tipo ausente o inválida';
      END IF;
      v_cantidad := v_valor::int;
      IF v_cantidad < 1 OR v_cantidad > v_n THEN
        RAISE EXCEPTION 'Cada cantidad por tipo debe estar entre 1 y el total de cabezales afectados';
      END IF;
      v_suma := v_suma + v_cantidad;
    END LOOP;
    IF v_suma < v_n THEN
      RAISE EXCEPTION 'La suma por tipo no cubre todos los cabezales afectados';
    END IF;
  ELSE
    RAISE EXCEPTION 'Resultado de prueba inválido';
  END IF;

  -- La marca temporal del cliente es MANUAL y nunca se declara como aviso Kinco.
  v_inicio := COALESCE(NULLIF(p->>'fecha_inicio_manual','')::timestamptz AT TIME ZONE 'UTC',
                       clock_timestamp() AT TIME ZONE 'UTC');
  v_fin := clock_timestamp() AT TIME ZONE 'UTC';
  v_hora := (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')::time;
  v_turno_codigo := CASE WHEN v_hora >= time '06:00' AND v_hora < time '14:00' THEN 'M'
                         WHEN v_hora >= time '14:00' AND v_hora < time '22:00' THEN 'T'
                         ELSE 'N' END;
  SELECT id INTO v_turno_id FROM public.turnos
   WHERE codigo = v_turno_codigo ORDER BY id LIMIT 1;

  -- Mismo request_id y contenido: respuesta repetida idempotente.
  -- Request_id reusado con datos distintos: error, nunca se reescribe lo anterior.
  SELECT id, numero_secuencial, spc_payload_hash, operario_legajo
    INTO v_existente
    FROM public.pruebas
   WHERE spc_request_id = v_request_id;
  IF FOUND THEN
    IF v_existente.spc_payload_hash IS DISTINCT FROM v_hash OR
       v_existente.operario_legajo IS DISTINCT FROM v_actor_legajo THEN
      RAISE EXCEPTION 'Solicitud duplicada con contenido o autor diferente';
    END IF;
    RETURN jsonb_build_object('prueba_id',v_existente.id,
                              'numero_secuencial',v_existente.numero_secuencial,
                              'duplicado',true);
  END IF;

  INSERT INTO public.pruebas (
    id_maquina, fecha_hora, codigo_producto, numero_caja, numero_lote,
    resultado, tuvo_falla, cantidad_cabezales_afectados, observaciones,
    operario_legajo, estado_final, timestamp_recibida, timestamp_completada,
    turno_id, spc_request_id, spc_payload_hash, spc_origen_evento,
    spc_cabezales_inspeccionados, spc_uso_estadistico
  ) VALUES (
    v_maquina, v_inicio, v_producto, v_caja, v_lote,
    v_estado, v_estado = 'RECHAZADO', v_n, NULLIF(p->>'observaciones',''),
    v_actor_legajo,
    CASE WHEN v_auto THEN 'PENDIENTE'
         WHEN v_estado = 'RECHAZADO' THEN 'PENDIENTE_APROBACION'
         ELSE 'OK' END,
    v_inicio, v_fin, v_turno_id, v_request_id, v_hash, 'MANUAL_NO_OT',
    CASE WHEN v_auto THEN NULL ELSE 20 END, 'NO_VALIDADO'
  )
  ON CONFLICT (spc_request_id) DO NOTHING
  RETURNING id, numero_secuencial INTO v_prueba_id, v_secuencial;

  IF v_prueba_id IS NULL THEN
    SELECT id, numero_secuencial, spc_payload_hash, operario_legajo
      INTO v_existente FROM public.pruebas
     WHERE spc_request_id = v_request_id;
    IF NOT FOUND OR v_existente.spc_payload_hash IS DISTINCT FROM v_hash OR
       v_existente.operario_legajo IS DISTINCT FROM v_actor_legajo THEN
      RAISE EXCEPTION 'Conflicto de solicitud: verificar duplicados';
    END IF;
    RETURN jsonb_build_object('prueba_id',v_existente.id,
                              'numero_secuencial',v_existente.numero_secuencial,
                              'duplicado',true);
  END IF;

  IF v_estado = 'RECHAZADO' THEN
    FOR v_tipo IN SELECT jsonb_array_elements_text(v_tipos) LOOP
      INSERT INTO public.pruebas_fallas (prueba_id,tipo_falla_id,cantidad_items_afectados)
      VALUES (v_prueba_id,v_tipo,(v_cantidades->>v_tipo)::int);
    END LOOP;
  END IF;

  -- Se ejecuta como una transacción de base: cualquier falla en el detalle
  -- revierte también el INSERT principal. Los triggers auditables existentes
  -- siguen actuando. No crea ninguna no conformidad automáticamente.
  RETURN jsonb_build_object('prueba_id',v_prueba_id,
                            'numero_secuencial',v_secuencial,
                            'duplicado',false);
END
$function$;

-- No se puede llamar a la funcion interna como un RPC publico:
-- spc_private no forma parte de los schemas expuestos.
REVOKE ALL ON FUNCTION spc_private.registrar_prueba_estanqueidad_internal(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION spc_private.registrar_prueba_estanqueidad_internal(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_prueba_estanqueidad_spc(p jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, spc_private
AS $wrapper$
  SELECT spc_private.registrar_prueba_estanqueidad_internal(p)
$wrapper$;

REVOKE ALL ON FUNCTION public.registrar_prueba_estanqueidad_spc(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_prueba_estanqueidad_spc(jsonb) TO authenticated;

-- Defer legacy direct INSERT revocation until coordinated frontend cutover.

-- SIDES · VF-001 — BORRADOR DE MIGRACION, NO APLICAR EN STAGING NI PRODUCCION.
-- REQUISITOS: backup probado, tabla verificaciones_fisicas en staging,
-- pruebas por rol, revisión conjunta del contrato RPC y despliegue coordinado.
-- El frontend de PR #7 NO es compatible con DB sin esta RPC.
-- Contramuestra física: presencia, exactamente 20, caja/lote y mismos
-- cabezales defectuosos/no defectuosos del registro de ensayo original.
-- No vuelve a ensayar ni modifica pruebas.resultado ni spc_uso_estadistico.
-- DECISION PLANTA 2026-11-06: DISCREPANCIA se registra solamente como
-- hallazgo fisico del encargado; NO crea ni señala NC automatica.
-- Se mantiene genera_nc=false y no_conformidad_id=NULL.

ALTER TABLE public.verificaciones_fisicas
  ADD COLUMN IF NOT EXISTS cantidad_defectuosos_encontrada integer,
  ADD COLUMN IF NOT EXISTS cantidad_sin_defectos_encontrada integer;

-- PostgreSQL no ofrece ADD CONSTRAINT IF NOT EXISTS: evitar fallo al
-- reintentar una migración parcialmente aplicada sin relajar controles.
DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.verificaciones_fisicas'::regclass
      AND conname='vf_defectuosos_no_negativos_chk'
  ) THEN
    ALTER TABLE public.verificaciones_fisicas
      ADD CONSTRAINT vf_defectuosos_no_negativos_chk
      CHECK (cantidad_defectuosos_encontrada IS NULL
        OR cantidad_defectuosos_encontrada >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.verificaciones_fisicas'::regclass
      AND conname='vf_sin_defectos_no_negativos_chk'
  ) THEN
    ALTER TABLE public.verificaciones_fisicas
      ADD CONSTRAINT vf_sin_defectos_no_negativos_chk
      CHECK (cantidad_sin_defectos_encontrada IS NULL
        OR cantidad_sin_defectos_encontrada >= 0) NOT VALID;
  END IF;
END
$constraints$;

CREATE SCHEMA IF NOT EXISTS spc_private;
REVOKE ALL ON SCHEMA spc_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA spc_private TO authenticated;

CREATE OR REPLACE FUNCTION spc_private.vf_completar_contramuestra_interna(
  p_verificacion_id uuid,
  p_muestras_presentes text,
  p_cantidad_encontrada integer,
  p_defectuosos_encontrados integer,
  p_coincide_etiqueta_lote boolean,
  p_coincide_caja boolean,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, spc_private
AS $func$
DECLARE
  v_actor record;
  v_vf record;
  v_prueba record;
  v_resultado text;
  v_sin_defectos integer;
  v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  SELECT u.id,u.rol,u.activo INTO v_actor
    FROM public.usuarios u WHERE u.id=auth.uid() AND u.activo=true;
  IF NOT FOUND OR v_actor.rol IS NULL OR
     v_actor.rol NOT IN ('supervisor','admin') THEN
    RAISE EXCEPTION 'Rol sin permiso para verificar contramuestra';
  END IF;

  IF p_verificacion_id IS NULL OR p_muestras_presentes IS NULL
     OR p_muestras_presentes NOT IN ('si_todas','parcial','no')
     OR p_cantidad_encontrada IS NULL OR p_cantidad_encontrada < 0
     OR p_defectuosos_encontrados IS NULL OR p_defectuosos_encontrados < 0
     OR p_defectuosos_encontrados > p_cantidad_encontrada
     OR p_coincide_etiqueta_lote IS NULL OR p_coincide_caja IS NULL
  THEN
    RAISE EXCEPTION 'Formulario fisico incompleto o inconsistente';
  END IF;

  IF (p_muestras_presentes='no' AND p_cantidad_encontrada <> 0)
     OR (p_muestras_presentes='parcial' AND
         (p_cantidad_encontrada=0 OR p_cantidad_encontrada >= 20))
     OR (p_muestras_presentes='si_todas' AND p_cantidad_encontrada < 20)
  THEN
    RAISE EXCEPTION 'Presencia y cantidad fisica contradictorias';
  END IF;

  -- Bloqueo de una sola verificación: evita doble cierre concurrente.
  SELECT * INTO v_vf FROM public.verificaciones_fisicas
    WHERE id=p_verificacion_id FOR UPDATE;
  IF NOT FOUND OR v_vf.supervisor_asignado_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Verificacion no existente o no asignada';
  END IF;
  -- Idempotencia frente a reintento por respuesta de red perdida:
  -- sólo devuelve el resultado anterior si el MISMO usuario asignado
  -- envía EXACTAMENTE el mismo hallazgo físico, sin reescritura ni auditoría duplicada.
  IF v_vf.resultado IS DISTINCT FROM 'PENDIENTE' THEN
    IF v_vf.resultado IN ('OK','DISCREPANCIA')
       AND v_vf.muestras_presentes IS NOT DISTINCT FROM p_muestras_presentes
       AND v_vf.cantidad_encontrada IS NOT DISTINCT FROM p_cantidad_encontrada
       AND v_vf.cantidad_defectuosos_encontrada IS NOT DISTINCT FROM p_defectuosos_encontrados
       AND v_vf.coincide_etiqueta_lote IS NOT DISTINCT FROM p_coincide_etiqueta_lote
       AND v_vf.coincide_caja IS NOT DISTINCT FROM p_coincide_caja
       AND v_vf.observaciones IS NOT DISTINCT FROM NULLIF(btrim(p_observaciones),'')
    THEN
      RETURN jsonb_build_object('verificacion_id', v_vf.id,
        'resultado', v_vf.resultado, 'duplicado', true,
        'cantidad_encontrada', v_vf.cantidad_encontrada,
        'defectuosos_encontrados', v_vf.cantidad_defectuosos_encontrada,
        'sin_defectos_encontrados', v_vf.cantidad_sin_defectos_encontrada);
    END IF;
    RAISE EXCEPTION 'Verificacion ya finalizada con otro contenido';
  END IF;

  -- Relectura y bloqueo de la prueba original; no aceptar totales
  -- defectuosos proporcionados por el cliente.
  SELECT id, resultado, estado_final, anulada,
         numero_caja,numero_lote,cantidad_cabezales_afectados
    INTO v_prueba FROM public.pruebas
    WHERE id=v_vf.prueba_id FOR SHARE;
  IF NOT FOUND OR v_prueba.anulada IS DISTINCT FROM false
    OR v_prueba.resultado IS NULL
    OR v_prueba.resultado NOT IN ('OK','RECHAZADO')
    OR NULLIF(btrim(v_prueba.estado_final::text),'') IS NULL
    OR v_prueba.estado_final IN ('ANULADA','ANULADO','PENDIENTE','CANCELADA')
    OR v_prueba.numero_caja IS NULL OR btrim(v_prueba.numero_caja)=''
    OR v_prueba.numero_lote IS NULL OR btrim(v_prueba.numero_lote)=''
    OR v_prueba.cantidad_cabezales_afectados IS NULL
    OR v_prueba.cantidad_cabezales_afectados NOT BETWEEN 0 AND 20
    OR (v_prueba.resultado='OK' AND v_prueba.cantidad_cabezales_afectados<>0)
    OR (v_prueba.resultado='RECHAZADO' AND v_prueba.cantidad_cabezales_afectados=0)
  THEN
    RAISE EXCEPTION 'Registro de ensayo incompleto o no evaluable';
  END IF;

  v_sin_defectos := p_cantidad_encontrada-p_defectuosos_encontrados;
  v_ok := p_muestras_presentes='si_todas'
    AND p_cantidad_encontrada=20
    AND p_defectuosos_encontrados=v_prueba.cantidad_cabezales_afectados
    AND v_sin_defectos=20-v_prueba.cantidad_cabezales_afectados
    AND p_coincide_etiqueta_lote=true AND p_coincide_caja=true;
  v_resultado := CASE WHEN v_ok THEN 'OK' ELSE 'DISCREPANCIA' END;

  UPDATE public.verificaciones_fisicas
     SET fecha_verificacion=clock_timestamp(),
         muestras_presentes=p_muestras_presentes,
         cantidad_encontrada=p_cantidad_encontrada,
         cantidad_defectuosos_encontrada=p_defectuosos_encontrados,
         cantidad_sin_defectos_encontrada=v_sin_defectos,
         coincide_etiqueta_lote=p_coincide_etiqueta_lote,
         coincide_caja=p_coincide_caja,
         observaciones=NULLIF(btrim(p_observaciones),''),
         resultado=v_resultado,
         genera_nc=false,
         no_conformidad_id=NULL,
         updated_at=clock_timestamp()
   WHERE id=v_vf.id AND resultado='PENDIENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verificacion modificada concurrentemente';
  END IF;

  RETURN jsonb_build_object(
    'verificacion_id',v_vf.id, 'resultado',v_resultado,
    'duplicado', false,
    'cantidad_encontrada',p_cantidad_encontrada,
    'defectuosos_encontrados',p_defectuosos_encontrados,
    'sin_defectos_encontrados',v_sin_defectos
  );
END;
$func$;

CREATE OR REPLACE FUNCTION public.vf_completar_contramuestra_segura(
  p_verificacion_id uuid,
  p_muestras_presentes text,
  p_cantidad_encontrada integer,
  p_defectuosos_encontrados integer,
  p_coincide_etiqueta_lote boolean,
  p_coincide_caja boolean,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, spc_private
AS $wrapper$
  SELECT spc_private.vf_completar_contramuestra_interna(
    p_verificacion_id, p_muestras_presentes, p_cantidad_encontrada,
    p_defectuosos_encontrados, p_coincide_etiqueta_lote,
    p_coincide_caja, p_observaciones
  );
$wrapper$;

REVOKE ALL ON FUNCTION spc_private.vf_completar_contramuestra_interna(
  uuid,text,integer,integer,boolean,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION spc_private.vf_completar_contramuestra_interna(
  uuid,text,integer,integer,boolean,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.vf_completar_contramuestra_segura(
  uuid,text,integer,integer,boolean,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vf_completar_contramuestra_segura(
  uuid,text,integer,integer,boolean,boolean,text) TO authenticated;

-- Defer legacy direct UPDATE revocation until coordinated frontend cutover.

-- SIDES · VF-002 — ASIGNACION ALEATORIA TRANSACCIONAL.
-- BORRADOR: NO APLICAR EN STAGING / PRODUCCION sin backup,
-- esquema verificado, inventario de clientes legados y QA por rol.
--
-- Una llamada RPC por entrada de turno: solo el servidor calcula
-- ventana de turno, selecciona 2 pruebas y asigna al encargado autenticado.
-- No valida el resultado técnico de los 20 cabezales.
-- ATENCION: este script REVOCA INSERT directo a authenticated en VF.
-- Se requiere desplegar cliente compatible en la misma ventana de cambio.

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

-- Defer legacy direct INSERT revocation until coordinated frontend cutover.
