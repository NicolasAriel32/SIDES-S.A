-- =====================================================================
-- Seed inicial · usuario administrador (legajo 0001 / password admin)
--
-- Versión corregida contra el schema real de `usuarios`:
--   - password_hash  (no `password`)
--   - fuerza_cambio  (no `force_change`)
--   - email          NOT NULL (faltaba en versión previa)
--
-- DECISIÓN DE DISEÑO (riesgo ISO 27001 conocido):
-- Guardamos el password en TEXTO PLANO dentro de password_hash. El código
-- de App.jsx hoy compara plain-text en el cliente, por lo que NO podemos
-- usar bcrypt todavía sin antes mover la verificación a una Edge Function.
-- Se cerrará al migrar a Supabase Auth o al implementar la Edge Function
-- `verificar_login`. Mientras tanto, queda registrado como deuda explícita.
-- =====================================================================

BEGIN;

-- 1) Diagnóstico previo
SELECT 'Total usuarios' AS metric, count(*) AS valor FROM usuarios
UNION ALL
SELECT 'Existe legajo 0001', count(*) FROM usuarios WHERE legajo = '0001';

-- 2) Insertar admin si no existe
INSERT INTO usuarios (
  legajo,
  nombre,
  apellido,
  email,
  rol,
  password_hash,
  fuerza_cambio,
  maquina_asignada,
  activo
) VALUES (
  '0001',
  'Admin',
  'Sistema',
  'admin@sides.local',     -- placeholder, cambialo cuando configures email real
  'admin',
  'admin',                 -- plain-text temporal — ver nota arriba
  true,
  null,
  true
)
ON CONFLICT (legajo) DO NOTHING;

-- 3) Si ya existía pero quedó inactivo o con password distinto, normalizamos.
-- Comentá este UPDATE si NO querés pisar el password del admin existente.
UPDATE usuarios
   SET password_hash = 'admin',
       fuerza_cambio = true,
       activo        = true
 WHERE legajo = '0001';

-- 4) Estado final visible
SELECT legajo, nombre, apellido, email, rol, activo, fuerza_cambio,
       length(password_hash) AS password_hash_len
FROM   usuarios
WHERE  legajo = '0001';

COMMIT;
