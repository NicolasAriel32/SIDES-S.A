-- =====================================================================
-- SEED DE DEMO · Turno de ejemplo en MAQ-001 con 2 pruebas PENDIENTE
-- =====================================================================
-- Inserta 8 pruebas en el TURNO VIGENTE al momento de ejecutarlo,
-- repartidas en las últimas ~2,5 horas (o desde el inicio del turno):
--   5 OK · 1 RECHAZADA ya revisada (no entra en la cola) · 2 PENDIENTE
-- Operario: legajo 42 (Juan Perez) · Lote 25510 · Cajas 41-48.
--
-- USO: pegar y ejecutar en el SQL Editor de Supabase JUSTO ANTES de la
-- demo, así las pruebas aparecen dentro del "turno actual" del tablero.
-- (Si ya lo corriste en un turno anterior, los registros viejos quedan
-- en el historial por día/turno — no molestan.)
-- =====================================================================

DO $$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_ini_local timestamp;
  v_t0 timestamptz; v_fin timestamptz; v_paso interval;
  v_ts timestamptz; v_num bigint; v_id uuid;
  i int;
BEGIN
  -- inicio del turno vigente (hora argentina)
  v_ini_local := CASE
    WHEN v_local::time >= '06:00' AND v_local::time < '14:00' THEN v_local::date + time '06:00'
    WHEN v_local::time >= '14:00' AND v_local::time < '22:00' THEN v_local::date + time '14:00'
    WHEN v_local::time >= '22:00' THEN v_local::date + time '22:00'
    ELSE (v_local::date - 1) + time '22:00'
  END;

  v_t0  := GREATEST(v_ini_local AT TIME ZONE 'America/Argentina/Buenos_Aires', now() - interval '150 min');
  v_fin := now() - interval '5 min';
  v_paso := (v_fin - v_t0) / 8;

  FOR i IN 1..8 LOOP
    v_ts := v_t0 + v_paso * (i - 1);
    SELECT next_numero_secuencial() INTO v_num;

    IF i IN (3, 6) THEN
      -- PENDIENTE: el operario no completó la carga en 60 min
      INSERT INTO pruebas (numero_secuencial, id_maquina, fecha_hora, resultado, estado_final,
                           tuvo_falla, observaciones, operario_legajo,
                           timestamp_recibida, created_at, updated_at)
      VALUES (v_num, 'MAQ-001', v_ts AT TIME ZONE 'utc', 'PENDIENTE', 'PENDIENTE',
              false, 'AUTO: registrada como PENDIENTE por inactividad (60 min sin carga)', '42',
              v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc');
    ELSIF i = 5 THEN
      -- rechazada ya revisada por el supervisor (no entra en la cola)
      INSERT INTO pruebas (numero_secuencial, id_maquina, fecha_hora, codigo_producto, numero_caja, numero_lote,
                           resultado, estado_final, tuvo_falla, cantidad_cabezales_afectados,
                           observaciones, operario_legajo,
                           timestamp_recibida, timestamp_completada, created_at, updated_at)
      VALUES (v_num, 'MAQ-001', v_ts AT TIME ZONE 'utc', 'RCL-336C-AR', (40+i)::text, '25510',
              'RECHAZADO', 'REVISADO', true, 2,
              'Leve polvillo en (2) cabezales', '42',
              v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc' + interval '6 min', v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc')
      RETURNING id INTO v_id;
      INSERT INTO pruebas_fallas (prueba_id, tipo_falla_id) VALUES (v_id, 'PLV');
    ELSE
      INSERT INTO pruebas (numero_secuencial, id_maquina, fecha_hora, codigo_producto, numero_caja, numero_lote,
                           resultado, estado_final, tuvo_falla,
                           operario_legajo, timestamp_recibida, timestamp_completada, created_at, updated_at)
      VALUES (v_num, 'MAQ-001', v_ts AT TIME ZONE 'utc', 'RCL-336C-AR', (40+i)::text, '25510',
              'OK', 'OK', false,
              '42', v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc' + interval '5 min', v_ts AT TIME ZONE 'utc', v_ts AT TIME ZONE 'utc');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- ADEMÁS: una prueba RECHAZADA esperando en la cola de aprobaciones
-- (falla de estanqueidad, hace 8 minutos) para demostrar la cola y el
-- botón "Observar" del supervisor/inspector.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_num bigint; v_id uuid;
BEGIN
  SELECT next_numero_secuencial() INTO v_num;
  INSERT INTO pruebas (numero_secuencial, id_maquina, fecha_hora, codigo_producto, numero_caja, numero_lote,
                       resultado, estado_final, tuvo_falla, cantidad_cabezales_afectados, observaciones,
                       operario_legajo, timestamp_recibida, timestamp_completada, created_at, updated_at)
  VALUES (v_num, 'MAQ-001', now() - interval '8 min', 'RCL-336C-AR', '49', '25510',
          'RECHAZADO', 'PENDIENTE_APROBACION', true, 3, 'Pérdida en válvula detectada en 3 cabezales',
          '42', now() - interval '8 min', now() - interval '5 min', now() - interval '8 min', now() - interval '8 min')
  RETURNING id INTO v_id;
  INSERT INTO pruebas_fallas (prueba_id, tipo_falla_id, cantidad_items_afectados) VALUES (v_id, 'EST', 3);
END $$;

-- ---------------------------------------------------------------------
-- LIMPIEZA (opcional, después de la demo): anula los registros de demo
-- sin borrarlos (conforme a la política de no eliminación):
--
-- UPDATE pruebas SET anulada = true, razon_anulacion = 'Datos de demostración'
-- WHERE id_maquina='MAQ-001' AND operario_legajo='42'
--   AND (numero_lote='25510' OR observaciones LIKE 'AUTO: registrada%')
--   AND created_at > now() - interval '1 day';
-- ---------------------------------------------------------------------
