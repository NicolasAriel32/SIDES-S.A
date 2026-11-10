# SIDES · VF-002 — Asignación aleatoria transaccional por turno

Fecha: 2026-11-06. Estado: **IMPLEMENTADO EN CÓDIGO; SQL NO APLICADO**.
PR: #7, rama `feature/sides20-piloto-spc-descriptivo-20261106`.
Máquina piloto MAQ-010 no implica que las asignaciones se filtren por
máquina: se preserva el alcance **todas las pruebas del turno anterior**
que usaba el código anterior.

## Decisiones de proceso preservadas

- Encargado revisa una contramuestra física elegida aleatoriamente del
  turno anterior, comprobando exactamente 20 cabezales, caja, lote y
  distribución de defectuosos/no defectuosos según registro digital.
- No se repite ensayo de estanqueidad ni se autoriza cada resultado
  individualmente; este control no concede estado SPC.
- La aplicación previa sorteaba **2** controles. VF-002 conserva 2.
  Planta confirmó aleatoriedad, pero no fijó número definitivo.
- El responsable es el usuario autenticado con rol `supervisor/admin`,
  igual que en el cierre VF-001; requiere cotejar el cargo *encargado de
  sala* con los roles reales antes de usar en planta.

## Invariante transaccional

El cliente hace **una llamada RPC sin parámetros**:
`vf_asegurar_verificaciones_turno_anterior()`.

La función PostgreSQL con privilegios controlados:

1. Identifica al usuario por `auth.uid()`, exige rol autorizado y cuenta
   activa; ignora hora, cantidad, identidad y candidatos del navegador.
2. Calcula el turno entrante con reloj PostgreSQL y horario argentino:
   mañana 06–14, tarde 14–22, noche 22–06; selecciona el turno anterior.
3. Toma `pg_advisory_xact_lock` **de transacción** para esa clave de
   turno, antes de consultar estado previo. Las sesiones con el mismo
   turno esperan su turno en el mismo lock.
4. Lee `vf_asignaciones_turno`, cuya **PK = inicio del turno entrante UTC**.
   Si ya existe, no genera otra asignación: responde
   `YA_ASIGNADA`, `ASIGNADA_A_OTRO`, `LEGADO_EXISTENTE` o `SIN_PRUEBAS`.
5. Si no hay ledger pero ya hay verificaciones para pruebas del turno
   anterior, registra `LEGADO_EXISTENTE` y **no agrega otras**, evitando
   duplicar el sorteo de versiones antiguas.
6. Si no hay previas, elige aleatoriamente hasta 2 ensayos no anulados y evaluables según VF-001
   del turno anterior desde **todas las filas de la base** (sin límite
   de paginación del navegador), `ORDER BY random() LIMIT 2`, e inserta.
7. Persiste en la misma transacción el ledger con cantidad/estado.
   Un error provoca rollback de ambos pasos.
8. `UNIQUE (prueba_id)` evita dos verificaciones de la misma prueba.
   La migración **REVOCA INSERT** directo a `authenticated`,
   `anon` y `PUBLIC`, para cerrar el bypass de clientes viejos.

El ledger nunca es modificable por `authenticated` directamente; tiene RLS
activada y los permisos de tabla revocados. La RPC usa `SECURITY DEFINER`,
`search_path` fijo y validación explícita de roles.

## Estados y comportamiento del cliente

| Estado | Qué muestra y qué hace |
| --- | --- |
| CREADA | Se generó una asignación nueva del turno al responsable actual. |
| YA_ASIGNADA | Mismo encargado; la selección ya existía. No se recrea. |
| ASIGNADA_A_OTRO | El turno ya tiene encargado asignado; informar sin reasignar. |
| LEGADO_EXISTENTE | Hay verificaciones previas del flujo viejo; no duplicar. |
| SIN_PRUEBAS | El turno anterior no aportó candidatas. Se conserva la decisión. |
| ERROR | La RPC falló/no existe/respuesta incoherente: UI lo anuncia, no lo trata como cero ni crea filas locales. |

`src/api/asignacionVerificaciones.js` rechaza respuestas inesperadas sin
declarar éxito; la consulta posterior de pendientes es independiente y
sigue sujetándose a RLS.

## Supuestos técnicos y deuda abierta

- `pruebas.created_at` es `timestamp without time zone`, almacenado
  con convención UTC en el esquema actual: se filtra comparándolo con
  los límites del turno convertidos **explícitamente a UTC sin zona**.
  Metadatos verificaron timezone UTC en la base productiva en esta fecha.
  Es indispensable verificar valores históricos y el entorno de staging.
- Se documenta `SIN_PRUEBAS` incluso si llegan ensayos offline
  tardíamente; no hay reasignación automática dentro de ese turno.
  Requiere simulación de datos tardíos y aprobación operativa para liberar.
- Si dos usuarios distintos ingresan, el primero que consigue la
  transacción asigna; el segundo recibe `ASIGNADA_A_OTRO`.
  No se incorpora transferencia de encargado sin regla de Planta.
- Una conexión de administrador con permisos superiores podría generar
  filas fuera de la RPC; esta garantía abarca las llamadas autenticadas
  y el contrato de migración. No se ofrece invulnerabilidad absoluta.
- `ORDER BY random()` es muestreo uniforme desde el DB, no selección
  criptográficamente reproducible. El ledger persiste el resultado.
- La tabla `verificaciones_fisicas` **no existe en staging** y
  **sí existe en producción**. Se consultó únicamente metadatos y
  agregados: producción tenía 2 verificaciones y 0 duplicados
  por `prueba_id` al momento de revisar.
- Crear el índice UNIQUE puede bloquear escrituras. Evaluar volumen
  y ventana de mantenimiento antes de cualquier migración.
- VF-001 (cierre físico seguro) es una migración separada, también
  pendiente. **No ejecutar ni desplegar VF-002 por separado**.

## Plan de ensayo aislado (NO EJECUTADO)

0. Backup y restauración aislada probados. Preparar `turnos`,
   `usuarios`, `pruebas` y `verificaciones_fisicas` en staging;
   inspeccionar RLS, datos históricos y clientes viejos.
1. Aplicar ambas migraciones con revisión SQL/VF-001/VF-002 en entorno
   aislado. Verificar catálogo de turnos M/T/N y timezone/created_at.
2. Crear al menos 3 pruebas no anuladas del turno anterior, con usuarios
   `supervisor`, `admin` y `operario` de prueba. No usar datos reales.
3. Lanzar **dos sesiones simultáneas del mismo encargado**. Debe haber
   exactamente un ledger para el turno, máximo 2 VF y una única selección.
   Respuestas esperadas: CREADA + YA_ASIGNADA (orden no importa).
4. Repetir con **dos encargados diferentes** en un turno fresco:
   CREADA + ASIGNADA_A_OTRO. Sin doble selección.
5. Reintentar RPC tras timeout/corte de red: misma selección, sin inserts.
6. Usar turno sin pruebas: SIN_PRUEBAS estable. Turno con 1 prueba:
   una única verificación; turno con pruebas previamente seleccionadas:
   LEGADO_EXISTENTE sin agregados.
7. Probar pasos temporales 05:59→06:00, 13:59→14:00,
   21:59→22:00 y 23:59→00:00, conservando zona argentina.
8. Con sesión `operario` y sin sesión: acceso denegado. Intentar
   `INSERT` directo desde `authenticated`: denegado. Acceso directo
   al ledger: denegado.
9. Probar duplicación forzada de `prueba_id`: violación de índice.
   Verificar que un error transaccional deja **0 filas parciales**.
10. Probar con fuente grande para comprobar índice/tiempo y sin
    cortes silenciosos a 1000 registros.
11. Con el cierre VF-001, probar resultados físicos positivos, negativos,
    dos cierres simultáneos, reintentos idénticos y discrepancia que
    genera NC; comprobar que no se modifica `pruebas.resultado`.
12. Ejecutar navegador Windows (Chrome/Edge), reconexión, dos pestañas,
    chequeos RLS e inventario de versiones legadas. Recién después
    decidir GO/NO-GO del piloto.

SQL de diagnóstico **solo lectura** previo a aplicar:

```sql
SELECT current_setting('TimeZone') AS zona_db;
SELECT count(*) AS verificaciones,
       count(*) - count(DISTINCT prueba_id) AS duplicaciones
FROM public.verificaciones_fisicas;
SELECT codigo, hora_inicio, hora_fin FROM public.turnos ORDER BY codigo;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='verificaciones_fisicas';
```

## Despliegue y reversión

El cambio es incompatible con clientes que inserten VF directamente.
Planificar congelamiento del frontend antiguo, backup, migración conjunta
VF-001/VF-002, despliegue del frontend nuevo, pruebas de lectura/escritura
y retorno coordinado. No revertir solamente el frontend manteniendo
`INSERT` revocado; se bloquearía el flujo legado. Tampoco habilitar
INSERT para usuarios comunes sin revisar concurrencia y RLS.

**Decisión actual: NO-GO**. Código y CI no reemplazan el ensayo en PostgreSQL
ni constituyen aprobación de Planta.
