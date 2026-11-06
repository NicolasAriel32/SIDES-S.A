# VF-002 · Evidencia de concurrencia en PostgreSQL (2026-11-06)

## Alcance y entorno
- Proyecto: `SIDES-SPC-STAGING` (`yurjxlxmfbvqviemvtqp`).
- **NO se ejecutó** `sql/VF_002_ASIGNACION_ATOMICA_NO_APLICAR.sql` ni
  `sql/VF_001_CIERRE_CONTRAMUESTRA_RPC_NO_APLICAR.sql`.
- No se escribió ni se cambió nada en el proyecto productivo.
- Staging carece de `verificaciones_fisicas`, `cajas` y
  `no_conformidades`. No permite aplicar VF-002 tal cual.
- Se creó un **laboratorio aislado** `vf_concurrency_lab` mediante
  migración `vf_concurrency_lab_isolated`, sin datos de producción.
  Contiene `turno_ledger`, `selecciones` y `asignar`.
  Replica sólo el patrón de `pg_advisory_xact_lock` por turno,
  `PRIMARY KEY` del ledger e inserción de dos registros en una
  transacción. **No replica toda la lógica, RLS, JWT ni reglas de negocio.**

## Ejecución real
Dos llamadas `execute_sql` lanzadas concurrentemente con `Promise.allSettled`:
- `asignar('VF-LAB-20261106-A','encargado_A',2)`:
  `{estado:'CREADA', cantidad:2, actor:'encargado_A'}`.
- `asignar('VF-LAB-20261106-A','encargado_B',0)`:
  `{estado:'YA_ASIGNADA', actor:'encargado_A'}`.
- Lectura de tablas: **1** ledger para ese turno y **2** selecciones.
- En dos turnos distintos `VF-LAB-20261106-B` y `C`,
  ambas solicitudes devolvieron `CREADA`, cantidad **2**.
- No se registraron duplicados en esos turnos.

**Interpretación limitada:** el patrón de bloqueo y ledger resistió
estas llamadas concurrentes de laboratorio. No prueba que las conexiones
se hayan solapado durante todo el periodo de ejecución; no prueba
la RPC real ni ausencia de todos los deadlocks/carreras.

## Hallazgos adicionales antes de aplicar VF-002

1. La RPC de VF-002 autoriza con `auth.uid() = usuarios.id`.
   **Corrección de segunda revisión:** el login real SÍ usa Supabase Auth:
   `src/api/sesionPuesto.js` llama `supabase.auth.signInWithPassword`,
   luego consulta `usuarios.id = authUser.id` y verifica perfil activo.
   La búsqueda previa solo en `App.jsx` produjo una conclusión errónea.
   La estructura de autenticación es compatible, pero staging tiene
   **0 filas en `auth.users`** y 5 perfiles en `usuarios`: no es posible
   probar login real ni una RPC autenticada sin aprovisionar usuarios
   de prueba enlazados correctamente.
2. VF-002 usa `pruebas.created_at` sin zona con interpretación UTC.
   Confirmar procedencia y uso en turno nocturno con datos reales.
3. El script revoca `INSERT` directo en VF; migración y frontend
   requieren corte coordinado y rollback probado.
4. Hay **2** registros de VF en producción, con **0** duplicados por
   `prueba_id` en la lectura efectuada. Eso NO habilita cambios en producción.
5. Se requiere staging representativo, pruebas Auth/RLS negativas,
   dos conexiones de la RPC definitiva, reintentos y rollback.
6. La creación de laboratorio es un cambio en staging y permanece
   aislada bajo `vf_concurrency_lab`. Retirarla sólo después de
   conservar evidencia y validar que no es usada por otras pruebas.

## Estado
- Laboratorio de bloqueo: **PASS limitado**.
- Migración real VF-001/VF-002: **NO APLICADA**.
- Concurrencia end-to-end: **PENDIENTE**.
- Producción: **NO-GO**.

## Pruebas de unicidad y rollback

- Intento de insertar una segunda selección con el mismo ID de prueba:
  PostgreSQL produjo `unique_violation` y se capturó como resultado
  esperado. Conteo posterior de la prueba: **1**.
- En una subtransacción se insertó un ledger nuevo y se provocó una
  violación de unicidad al insertar una selección. El bloque de excepción
  revirtió ambos pasos: **0** ledgers parciales y **0** selecciones
  parciales para `VF-LAB-20261106-ROLLBACK`.
- Estas pruebas usan la estructura aislada `vf_concurrency_lab` y no
  sustituyen las pruebas de VF-002 definitiva con datos de staging.

## Segunda revisión: RPC VF-002 definitiva aplicada en staging (2026-11-06)

### Preparación del entorno
Se ejecutaron **solo en SIDES-SPC-STAGING** las migraciones:
- `vf_staging_nc_fk_placeholder`: crea `public.no_conformidades`
  **únicamente como placeholder de FK**, con RLS habilitado y
  privilegios revocados. **NO es el modelo completo de NC**.
- `vf_staging_turnos_alignment`: agrega columnas faltantes y
  completa las franjas M/T/N en el catálogo staging.
- `vf_staging_traceability_schema`: ejecuta el esquema de
  `sql/01_schema_lotes_cajas_verificaciones.sql` (lotes, cajas,
  verificaciones y referencias de pruebas).
- `vf_staging_contramuestra_cierre`: instala VF-001 en staging.
- `vf_staging_asignacion_transaccional`: instala VF-002 en staging.

**Producción no recibió ninguna migración.** El placeholder NC impide
considerar staging completamente representativo del circuito NC.

### Inspección de privilegios y objetos (PASS)
- RPC `vf_asegurar_verificaciones_turno_anterior` existe, `SECURITY DEFINER`.
- `vf_completar_contramuestra_segura` existe, `SECURITY INVOKER`.
- `anon` sin `EXECUTE` en asignación; `authenticated` con `EXECUTE`.
- `authenticated` sin `INSERT` ni `UPDATE` directo en VF.
- Índice único `ux_vf_prueba_id_una_seleccion` presente.
- Staging contiene **0 usuarios en `auth.users`**. La app usa
  **Supabase Auth real**: `src/api/sesionPuesto.js` ejecuta
  `signInWithPassword` y valida `usuarios.id = authUser.id`.

### Prueba sobre la RPC real (PASS limitado a contexto SQL simulado)
- Se crearon tres pruebas de **ensayo** en el turno anterior,
  con marcador `VF-E2E-STAGING-20261106`.
- Se ejecutaron dos transacciones simultáneas con
  `SET LOCAL ROLE authenticated` y
  `set_config('request.jwt.claim.sub', id_supervisor, true)`.
  **Esto simula claims PostgreSQL; no emite ni valida JWT real.**
- Primera RPC: `CREADA`, cantidad 2, asignada_a_mi true.
- Segunda RPC: `YA_ASIGNADA`, cantidad 2, asignada_a_mi true.
- Conteo final antes de limpieza: **1 ledger y 2 verificaciones**.
- Prueba negativa de actor ausente: `insufficient_privilege`;
  ledger continuó en 0.
- Prueba negativa de rol operario simulada: rechazada por la RPC.
- Se borraron únicamente los registros de prueba y su ledger;
  comprobación posterior: **0 VF, 0 ledger, 0 fixtures**.

### Revisión crítica: pendientes NO resueltos
1. Crear usuarios **de prueba** mediante el flujo soportado de Supabase
   Auth (sin contraseñas en SQL ni creación directa en `auth.users`),
   enlazados a `public.usuarios.id`; validar tokens JWT y sesión de
   navegador reales, más roles denegados y supervisor concurrente.
2. Staging aún tiene una **tabla NC placeholder**, no el esquema NC
   productivo. Antes de QA integral de NC, migrar el esquema auténtico
   con backup y validar las dependencias.
3. Probar VF-001: OK, discrepancias, exactamente 20 cabezales,
   identidad del asignado, doble cierre y reintento.
4. Pruebas Windows E2E, fallas de red, reintentos y rollback de despliegue.
5. Revisar aviso del asesor de seguridad sobre funciones
   `SECURITY DEFINER` expuestas y su alcance efectivo.
6. Los fixtures temporales se eliminaron; el esquema y funciones
   staging **sí permanecen** para siguientes pruebas.

**Estado: migración VF-001/VF-002 en staging aplicada; concurrencia de
RPC real con claims SQL simulados PASS; Auth/JWT real y NC completo
PENDIENTES; producción NO-GO.**
