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
