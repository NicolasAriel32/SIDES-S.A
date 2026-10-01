-- =====================================================================
-- Security hardening — role guards for SECURITY DEFINER quality RPCs
-- Applied 2026-10-01
--
-- These RPCs bypass table RLS by design, so authentication alone is not
-- sufficient. The caller must also be an active admin, supervisor or
-- inspector. This closes a direct-call path for operario/auditor users.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guardar_control_calidad(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control_id uuid;
  v_num        bigint;
  v_nc_id      uuid;
  v_nc_num     bigint;
  v_cliente_id uuid;
  v_caller_rol text;
  m            jsonb;
  d            text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT rol INTO v_caller_rol
  FROM public.usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_caller_rol IS NULL OR v_caller_rol NOT IN ('admin','supervisor','inspector') THEN
    RAISE EXCEPTION 'No autorizado para guardar controles de calidad';
  END IF;

  v_cliente_id := (
    SELECT cliente_id
    FROM ordenes_maquina
    WHERE id = NULLIF(p->>'orden_maquina_id','')::uuid
  );

  IF v_cliente_id IS NULL AND NULLIF(p->>'cliente','') IS NOT NULL THEN
    v_cliente_id := (
      SELECT id FROM clientes
      WHERE nombre = p->>'cliente' AND activo = true
      LIMIT 1
    );
  END IF;

  INSERT INTO controles_calidad (
    id_maquina, orden_maquina_id, sesion_calidad_id, especifc_producto_id,
    inspector_legajo, inspector_nombre, numero_caja, numero_lote,
    nombre_producto, cliente, cliente_id, orden_id, sesion_id,
    resultado, no_conforme, observacion_libre,
    cantidad_rechazo, caja_desde, caja_hasta
  ) VALUES (
    p->>'id_maquina',
    NULLIF(p->>'orden_maquina_id','')::uuid,
    NULLIF(p->>'sesion_calidad_id','')::uuid,
    NULLIF(p->>'especifc_producto_id','')::uuid,
    p->>'inspector_legajo', p->>'inspector_nombre',
    p->>'numero_caja', p->>'numero_lote',
    p->>'nombre_producto', NULL, v_cliente_id,
    NULLIF(p->>'orden_id',''), p->>'sesion_id',
    CASE WHEN (p->>'no_conforme')::boolean THEN 'RECHAZADO' ELSE 'OK' END,
    (p->>'no_conforme')::boolean,
    NULLIF(p->>'observacion_libre',''),
    NULLIF(p->>'cantidad_rechazo','')::int,
    NULLIF(p->>'caja_desde','')::int,
    NULLIF(p->>'caja_hasta','')::int
  )
  RETURNING id, numero_secuencial INTO v_control_id, v_num;

  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p->'mediciones','[]'::jsonb)) LOOP
    INSERT INTO mediciones (control_id, posicion_cabezal, tipo_medicion, valor, unidad, fuera_rango)
    VALUES (v_control_id, (m->>'posicion')::int, m->>'tipo',
            (m->>'valor')::numeric, m->>'unidad',
            coalesce((m->>'fuera_rango')::boolean, false));
  END LOOP;

  FOR d IN SELECT jsonb_array_elements_text(coalesce(p->'defectos','[]'::jsonb)) LOOP
    INSERT INTO controles_defectos (control_id, tipo_falla_id)
    VALUES (v_control_id, d);
  END LOOP;

  IF (p->>'no_conforme')::boolean THEN
    INSERT INTO no_conformidades (control_calidad_id, estado)
    VALUES (v_control_id, 'ABIERTA')
    RETURNING id, numero_nc INTO v_nc_id, v_nc_num;

    UPDATE controles_calidad
    SET no_conformidad_id = v_nc_id
    WHERE id = v_control_id;
  END IF;

  RETURN jsonb_build_object(
    'control_id', v_control_id,
    'numero_secuencial', v_num,
    'no_conformidad_id', v_nc_id,
    'numero_nc', v_nc_num
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_recontrol(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_num     bigint;
  v_intento int;
  v_merma   numeric;
  v_turno   varchar(1);
  v_caller_rol text;
  d         text;
  v_nc      uuid    := (p->>'no_conformidad_id')::uuid;
  v_reinsp  int     := (p->>'cabezales_reinspeccionados')::int;
  v_desc    int     := (p->>'cabezales_descartados')::int;
  v_final   boolean := coalesce((p->>'es_recontrol_final')::boolean, false);
  v_hora    time    := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::time;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT rol INTO v_caller_rol
  FROM public.usuarios
  WHERE id = auth.uid() AND activo = true;

  IF v_caller_rol IS NULL OR v_caller_rol NOT IN ('admin','supervisor','inspector') THEN
    RAISE EXCEPTION 'No autorizado para guardar recontroles';
  END IF;

  v_turno := CASE
    WHEN v_hora >= '06:00' AND v_hora < '14:00' THEN 'M'
    WHEN v_hora >= '14:00' AND v_hora < '22:00' THEN 'T'
    ELSE 'N'
  END;

  SELECT coalesce(max(numero_intento),0)+1
  INTO v_intento
  FROM recontroles
  WHERE no_conformidad_id = v_nc;

  INSERT INTO recontroles (
    no_conformidad_id, control_calidad_id, numero_intento,
    inspector_legajo, inspector_nombre, accion_previa,
    cabezales_reinspeccionados, cabezales_descartados,
    resultado, es_recontrol_final, observaciones, turno_codigo
  ) VALUES (
    v_nc,
    NULLIF(p->>'control_calidad_id','')::uuid,
    v_intento,
    p->>'inspector_legajo',
    p->>'inspector_nombre',
    p->>'accion_previa',
    v_reinsp,
    v_desc,
    p->>'resultado',
    v_final,
    NULLIF(p->>'observaciones',''),
    v_turno
  )
  RETURNING id, numero_secuencial, kg_merma
  INTO v_id, v_num, v_merma;

  FOR d IN SELECT jsonb_array_elements_text(coalesce(p->'defectos','[]'::jsonb)) LOOP
    INSERT INTO recontrol_defectos (recontrol_id, tipo_falla_id)
    VALUES (v_id, d);
  END LOOP;

  IF v_final THEN
    UPDATE no_conformidades
    SET estado = 'CERRADA',
        timestamp_cierre = now(),
        cabezales_verificados = v_reinsp,
        kg_merma = v_merma,
        legajo_cierre = p->>'inspector_legajo'
    WHERE id = v_nc;
  ELSE
    UPDATE no_conformidades
    SET estado = 'EN ANALISIS',
        timestamp_analisis = coalesce(timestamp_analisis, now())
    WHERE id = v_nc;
  END IF;

  RETURN jsonb_build_object(
    'recontrol_id', v_id,
    'numero_secuencial', v_num,
    'numero_intento', v_intento,
    'kg_merma', v_merma,
    'turno_codigo', v_turno
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guardar_control_calidad(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guardar_recontrol(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_control_calidad(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_recontrol(jsonb) TO authenticated;
