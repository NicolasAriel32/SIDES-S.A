-- =====================================================================
-- FIX · Error 409 al registrar pruebas (unique_violation numero_secuencial)
-- Trazabilidad pruebas de estanqueidad — SIDES S.A.
-- Aplicado en producción (proyecto rzejddqcjqtxsenbdocz) el 2026-06-03.
--
-- SÍNTOMA
--   POST /rest/v1/pruebas -> 409. Ningún operario podía registrar pruebas.
--
-- CAUSA RAÍZ
--   El último commit cambió createTest para tomar numero_secuencial desde la
--   secuencia `pruebas_secuencial_seq` (RPC next_numero_secuencial). Pero las
--   24 filas previas se habían cargado con la lógica vieja (MAX+1), así que la
--   secuencia quedó DETRÁS del max real de la columna. nextval() devolvía un
--   numero_secuencial ya existente -> choca con el UNIQUE
--   `pruebas_numero_secuencial_key` -> 23505 -> HTTP 409.
--   Cada intento sólo avanzaba la secuencia en 1, por eso el sistema parecía
--   "muerto": había que agotar todos los números ya usados antes de acertar.
--
-- IMPACTO COLATERAL
--   Como ninguna prueba se insertaba, tampoco se creaban pruebas con falla,
--   así que el supervisor dejó de recibir la notificación de falla. Al
--   destrabar el alta de pruebas, esa notificación vuelve a funcionar sola.
--
-- Idempotente y no destructivo. No toca datos existentes.
-- =====================================================================

BEGIN;

-- 1) Realineación inmediata de la secuencia con el max real.
SELECT setval(
  'pruebas_secuencial_seq',
  GREATEST(
    (SELECT last_value FROM pruebas_secuencial_seq),
    COALESCE((SELECT max(numero_secuencial) FROM pruebas), 0)
  ),
  true
);

-- 2) Endurecimiento: la función se autocorrige si la secuencia vuelve a
--    quedar detrás del max (p. ej. tras sembrar datos sin usar la secuencia).
CREATE OR REPLACE FUNCTION public.next_numero_secuencial()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max  bigint;
  v_next bigint;
BEGIN
  SELECT COALESCE(max(numero_secuencial), 0) INTO v_max FROM pruebas;
  IF (SELECT last_value FROM pruebas_secuencial_seq) < v_max THEN
    PERFORM setval('pruebas_secuencial_seq', v_max, true);
  END IF;
  v_next := nextval('pruebas_secuencial_seq');
  RETURN v_next;
END;
$$;

-- 3) Verificación: el próximo número debe ser > max actual.
SELECT
  (SELECT max(numero_secuencial) FROM pruebas)        AS max_actual,
  (SELECT last_value FROM pruebas_secuencial_seq)      AS seq_actual;

COMMIT;
