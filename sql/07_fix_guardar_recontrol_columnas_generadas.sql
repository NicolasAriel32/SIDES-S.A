-- =====================================================================
-- Trazabilidad — Migración 07 (APLICADA el 2026-06-09 vía MCP)
-- Fix: guardar_recontrol no debe escribir columnas generadas
--   recontroles.kg_merma              = cabezales_descartados × 0.0184
--   recontroles.cabezales_recuperados = reinspeccionados − descartados
--   no_conformidades.dias_para_cierre = generada a partir de timestamps
-- Probado end-to-end: control NC → 8 mediciones + defecto + NC →
-- recontrol final → NC CERRADA con merma autocalculada.
-- =====================================================================

CREATE OR REPLACE FUNCTION guardar_recontrol(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id      uuid;
  v_num     bigint;
  v_intento int;
  v_merma   numeric;
  d         text;
  v_nc      uuid    := (p->>'no_conformidad_id')::uuid;
  v_reinsp  int     := (p->>'cabezales_reinspeccionados')::int;
  v_desc    int     := (p->>'cabezales_descartados')::int;
  v_final   boolean := coalesce((p->>'es_recontrol_final')::boolean, false);
BEGIN
  SELECT coalesce(max(numero_intento),0)+1 INTO v_intento
  FROM recontroles WHERE no_conformidad_id = v_nc;

  INSERT INTO recontroles (
    no_conformidad_id, control_calidad_id, numero_intento,
    inspector_legajo, inspector_nombre, accion_previa,
    cabezales_reinspeccionados, cabezales_descartados,
    resultado, es_recontrol_final, observaciones
  ) VALUES (
    v_nc, NULLIF(p->>'control_calidad_id','')::uuid, v_intento,
    p->>'inspector_legajo', p->>'inspector_nombre', p->>'accion_previa',
    v_reinsp, v_desc,
    p->>'resultado', v_final, NULLIF(p->>'observaciones','')
  )
  RETURNING id, numero_secuencial, kg_merma INTO v_id, v_num, v_merma;

  FOR d IN SELECT jsonb_array_elements_text(coalesce(p->'defectos','[]'::jsonb)) LOOP
    INSERT INTO recontrol_defectos (recontrol_id, tipo_falla_id) VALUES (v_id, d);
  END LOOP;

  IF v_final THEN
    UPDATE no_conformidades SET
      estado = 'CERRADA',
      timestamp_cierre = now(),
      cabezales_verificados = v_reinsp,
      kg_merma = v_merma,
      legajo_cierre = p->>'inspector_legajo'
    WHERE id = v_nc;
  ELSE
    UPDATE no_conformidades SET
      estado = 'EN ANALISIS',
      timestamp_analisis = coalesce(timestamp_analisis, now())
    WHERE id = v_nc;
  END IF;

  RETURN jsonb_build_object('recontrol_id', v_id, 'numero_secuencial', v_num,
                            'numero_intento', v_intento, 'kg_merma', v_merma);
END $$;
