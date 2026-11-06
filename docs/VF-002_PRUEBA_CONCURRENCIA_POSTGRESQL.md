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
   El frontend actual tiene login propio basado en `legajo` y no se
   observó `supabase.auth.signInWithPassword` en `src/App.jsx`.
   **Hay que verificar identidad Auth de extremo a extremo**; no
   reemplazarla por un `legajo` enviado por el navegador.
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
