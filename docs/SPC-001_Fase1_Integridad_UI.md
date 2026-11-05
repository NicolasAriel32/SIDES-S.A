# SIDES — SPC-001 | Fase 1 (rama de trabajo)

Fecha de revisión: 2026-11-05. Piloto MAQ-010. **No fusionar a `main` ni desplegar.**
PR: https://github.com/NicolasAriel32/SIDES-S.A/pull/1

## Decisión explícita del responsable del proyecto

El histórico actual contiene **cargas manuales de prueba**, algunas con valores inventados y otras realizadas durante trabajo normal. Se mantiene **íntegro**, sin correcciones, bajas ni clasificaciones retroactivas. El histórico se considera **de procedencia no verificada para fines SPC**, no una línea base estadística oficial.

Esto no significa que todas las pruebas antiguas fueran falsas; significa que no podemos discriminar cuáles son representativas sin evidencia.

## Ya implementado en esta rama — pendiente de validación integral

1. Reutilización de `VistaOperario`, `VistaSupervisor` y `dataService`, sin reemplazar la aplicación.
2. Validación de 20 cabezales por muestra; `OK` exige 0 defectuosos y ninguna falla. `RECHAZADO` exige entre 1 y 20 cabezales **únicos** afectados, tipos de falla y conteos por tipo.
3. Cada cantidad por tipo significa **cantidad de cabezales afectados por ese tipo**, no necesariamente cantidad de ocurrencias individuales de defectos. Un mismo cabezal puede figurar en dos o más tipos; la suma por tipo puede exceder los defectuosos únicos. Se exige que la suma sea al menos el número de afectados únicos (condición necesaria, no suficiente para probar consistencia cabeza a cabeza).
4. Se mantiene el tablero existente y se rotula el KPI como **porcentaje de pruebas con falla**. El listado de tipos refleja menciones por prueba, no cantidades físicas históricas.
5. La acción de iniciar registro se rotula como **simulación manual**. No corresponde a una captura real de la HMI Kinco ni a una marca temporal OT certificada.
6. El inicio manual recibe un UUID persistente en el navegador para soportar reintentos idempotentes; las señales anteriores en almacenamiento local reciben uno sólo al recuperarse.
7. En caso de error al registrar automáticamente un `PENDIENTE`, **no se borra la señal local**: se conserva y se ofrece reintento.
8. La capa de datos llama sólo a la RPC `registrar_prueba_estanqueidad_spc`; no cae en el flujo inseguro de dos `INSERT` directos.
9. Los nuevos registros que cree la futura RPC se etiquetarán `spc_origen_evento=MANUAL_NO_OT`, `spc_uso_estadistico=NO_VALIDADO` y `spc_cabezales_inspeccionados=20` (NULL para pendientes). **Ningún histórico se modifica**.
10. Pruebas unitarias y verificación de build por GitHub Actions, sin despliegue.

## Migración no aplicada

`sql/spc_001_registrar_prueba_atomica_BORRADOR_NO_APLICAR.sql`

- Añade columnas nuevas opcionales y un índice único de `spc_request_id`; conserva filas históricas con NULL.
- Instala una función `SECURITY INVOKER` (las RLS actuales siguen rigiendo).
- Deriva actor, legajo y máquina autorizada desde `auth.uid()`/perfil server-side.
- Valida los rangos y cantidades tanto del resumen como de los detalles.
- Inserta `pruebas` y `pruebas_fallas` en una sola transacción. Una falla en un detalle revierte el registro principal.
- Trata reintentos de la misma solicitud como duplicados sólo si coinciden el actor y el contenido.
- No crea no conformidades: la decisión oficial sigue en manos del supervisor.
- Restringe la procedencia declarable y la aptitud SPC en esta fase.

**Advertencia:** el SQL es un borrador guardado en GitHub, **no ejecutado contra ningún Postgres**. Un `npm run build` exitoso no valida la función SQL.

## Riesgos y tareas pendientes

- Probar la migración y RPC en una **base de ensayo aislada**, con datos sintéticos, permisos de operario/supervisor/inspector/admin/auditor y casos de error forzado.
- Verificar triggers de calibración y auditoría, RLS, secuencia y turno AR; comprobar reversión completa y reintentos concurrentes.
- Confirmar que no existan consumidores externos del antiguo INSERT directo antes de un eventual despliegue.
- Revisar experiencia móvil del formulario de cantidades por tipo, mensajes, reconexión y pendientes.
- Preparar backup/restauración verificable y rollback coordinado para una aprobación futura.
- Identificar origen real del aviso en Kinco/Delta mediante inspección OT autorizada, fuera del alcance de este cambio.
- Definir y aprobar protocolo de muestreo representativo antes de calcular límites de control.
- No calcular DPU histórico ni convertir el Pareto histórico en Pareto cuantitativo.

## Pruebas negativas obligatorias de staging

| ID | Prueba | Resultado |
|---|---|---|
| S-01 | OK con un cabezal afectado | Rechazado, sin inserciones |
| S-02 | Falla con 0, 21 o cantidad fraccionaria | Rechazado |
| S-03 | Tipos repetidos, inexistentes o sin cantidad | Rechazado |
| S-04 | Un cabezal con dos tipos de falla | Dos categorías, un afectado único |
| S-05 | Suma por tipo menor que únicos | Rechazado |
| S-06 | Usuario inactivo, auditor o no autenticado | Rechazado |
| S-07 | Operario registra máquina no asignada | Rechazado |
| S-08 | Error inducido en INSERT de detalle | Rollback de la prueba principal |
| S-09 | Misma solicitud dos veces | Un único registro lógico |
| S-10 | Igual UUID con diferente contenido o actor | Rechazado |
| S-11 | Falla de red antes de confirmación | Solicitud local recuperable |
| S-12 | Históricos después de aplicar en staging | Ningún dato antiguo modificado |
| S-13 | Señal manual | Nunca marcada como OT verificada ni apta SPC |
| S-14 | Flujo NC del supervisor | Sin regresiones ni NC automáticas |

**Estado:** código y migración propuestos y versionados. `main`, la base Supabase real, el PLC Delta, la HMI Kinco y el flujo productivo permanecen sin modificaciones.
