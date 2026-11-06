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
BEGIN;

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
    OR v_prueba.estado_final IS NULL
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

-- Cierre antiguo: impedir que navegadores antiguos graben OK falsos
-- mediante UPDATE directo. Coordinar en despliegue una vez inventariados
-- clientes legados; este borrador NO se ejecuta automáticamente.
REVOKE UPDATE ON TABLE public.verificaciones_fisicas FROM authenticated;

COMMIT;
