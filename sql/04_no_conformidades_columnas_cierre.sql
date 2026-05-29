-- =====================================================================
-- Trazabilidad — Migración 04
-- Agrega columnas de cierre a no_conformidades
--
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- Pegá esto en el SQL Editor de Supabase y ejecutá.
-- =====================================================================

BEGIN;

ALTER TABLE no_conformidades
  ADD COLUMN IF NOT EXISTS causa_raiz             varchar(30),
  ADD COLUMN IF NOT EXISTS acciones_tomadas       text[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notas_cierre           text,
  ADD COLUMN IF NOT EXISTS timestamp_analisis     timestamptz,
  ADD COLUMN IF NOT EXISTS timestamp_cierre       timestamptz,
  ADD COLUMN IF NOT EXISTS legajo_cierre          varchar(4),
  ADD COLUMN IF NOT EXISTS cabezales_verificados  integer,
  ADD COLUMN IF NOT EXISTS kg_merma               numeric(8,3),
  ADD COLUMN IF NOT EXISTS dias_para_cierre       numeric(10,2);

-- Verificación
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'no_conformidades'
ORDER  BY ordinal_position;

COMMIT;
