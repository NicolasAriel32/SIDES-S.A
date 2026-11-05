-- SIDES-SPC-001 | BORRADOR DE MIGRACIÓN - NO EJECUTAR SOBRE PRODUCCIÓN
-- Esta migración sólo existe en feature/spc-001-fase1-integridad-ui.
-- Los registros anteriores permanecen intactos: columnas nuevas NULL para históricos.
-- Requiere backup verificado, ambiente aislado, revisión OT/Calidad/Seguridad y autorización.
BEGIN;

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
  IF NOT FOUND OR v_actor_rol NOT IN ('operario','supervisor','inspector','admin') THEN
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
     v_producto !~ '^RC[LE]-(284|294|300|310|320|336)[CA]-(RO|NE|BL|CE|AZ|VE|AM|NA|GR|RS|VI|MA)
    IF v_estado <> 'PENDIENTE' OR v_n <> 0 OR jsonb_array_length(v_tipos) <> 0 OR v_claves <> 0 THEN
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

-- Operarios/supervisores ya no pueden saltarse validacion y transaccion
-- mediante INSERT directo a tablas de pruebas. No revoca SELECT/UPDATE;
-- por seguridad, antes de desplegar hay que certificar otros clientes.
REVOKE INSERT ON TABLE public.pruebas, public.pruebas_fallas FROM authenticated;

COMMIT;
 THEN
    RAISE EXCEPTION 'Código de producto no admitido';
  END IF;

  IF v_auto THEN
    IF v_estado <> 'PENDIENTE' OR v_n <> 0 OR jsonb_array_length(v_tipos) <> 0 OR v_claves <> 0 THEN
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

-- Operarios/supervisores ya no pueden saltarse validacion y transaccion
-- mediante INSERT directo a tablas de pruebas. No revoca SELECT/UPDATE;
-- por seguridad, antes de desplegar hay que certificar otros clientes.
REVOKE INSERT ON TABLE public.pruebas, public.pruebas_fallas FROM authenticated;

COMMIT;
