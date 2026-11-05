# SPC-001 — Plan de aceptación en escritorio (Windows)

**Estado:** preparación de QA. Este checklist NO equivale a una prueba E2E ejecutada. No desplegar ni modificar la base de SIDES hasta completar los bloqueos. Fecha: 2026-11-05.

## Alcance prioritario
- Windows 10/11, Google Chrome y Microsoft Edge actualizados.
- Una única máquina de prueba y datos **sintéticos** de SIDES-SPC-STAGING.
- HTTPS o `localhost`, requisito para Web Locks; `navigator.locks` ausente debe deshabilitar la edición/envío de forma segura.
- Dos sesiones reales de Supabase Auth de ensayo con permisos correctos, sin usar usuarios históricos reales.
- Sin PLC/HMI ni datos OT reales.

## Casos de aceptación manual pendientes

| ID | Escenario | Resultado esperado |
| --- | --- | --- |
| D-01 | Abrir un registro manual y recargar F5 | Se conserva UUID, máquina, hora de inicio y formulario |
| D-02 | Escribir resultado con falla, tipos/cantidades, caja/lote/producto y observación; cerrar y reabrir | Se recuperan todos los campos, sin escribir en la BD |
| D-03 | Abrir la misma solicitud en dos pestañas | La primera reserva el editor; la segunda queda bloqueada/solo lectura |
| D-04 | Cerrar la pestaña editora y pulsar «Volver a intentar editar» en la segunda | La segunda adquiere bloqueo y puede modificar el formulario |
| D-05 | Pulsar «Iniciar registro manual» casi simultáneamente en dos pestañas | Sólo se conserva una señal, sin sobrescritura |
| D-06 | Interrumpir conexión justo después del envío | Se conserva el UUID y snapshot; al reintentar se verifica si la BD registró la prueba |
| D-07 | Cambiar una cantidad o resultado después de un envío incierto | Se bloquea el envío de payload diferente con UUID anterior |
| D-08 | Repetir la solicitud sin cambiar contenido | La RPC mantiene una sola prueba y sus detalles |
| D-09 | Simular un error de almacenamiento local | No se envía ningún registro sin snapshot persistido |
| D-10 | Dejar un formulario parcialmente cargado más de 60 minutos | No se convierte automáticamente en PENDIENTE ni se descarta el formulario |
| D-11 | Dejar una señal sin campos cargados más de 60 minutos | Se registra PENDIENTE por RPC sólo si el actor está autorizado; no se duplica |
| D-12 | Cerrar sesión y entrar con otro legajo | No se mezclan borradores/solicitudes de distinta identidad |
| D-13 | Iniciar sesión con una cuenta inactiva o sin permisos | No puede guardar pruebas ni leer datos no autorizados |
| D-14 | Error entre INSERT principal y detalle | No quedan filas parciales ni eventos de auditoría de una transacción revertida |
| D-15 | Fallo al almacenar luego de un registro confirmado | Se conserva evidencia de servidor, pero debe mostrarse una advertencia de limpieza local |
| D-16 | Abrir la página en un contexto sin Web Locks | Se impide el envío; no se finge exclusión |
| D-17 | Revisar la consola y red del navegador | Ninguna clave secreta, contraseña ni token aparece en logs de diagnóstico |

## Evidencia de automatización, no E2E
- Tests unitarios: `npm test` en GitHub Actions (módulos de borrador, reserva de edición, intento inmutable, reconciliación y API).
- Build: `npm run build` en GitHub Actions.
- SQL en SIDES-SPC-STAGING: RLS de lectura por UUID para operario, atomicidad, auditoría e idempotencia.
- No hay aún un navegador automatizado ni pruebas de interacción real sobre una web desplegada.

## Bloqueos
1. Un origen de prueba aislado con credenciales **sólo de STAGING** y sesiones de Auth reales.
2. Política y procedimiento para equipos compartidos: los borradores permanecen en `localStorage` hasta confirmar.
3. Confirmación de hosting real, backup/restauración productiva y coexistencia con otros consumidores de INSERT directo.
4. QA de accesibilidad, errores y flujos operativos con una persona responsable de Planta/Calidad.

El cierre de Fase 2 requiere evidencias de D-01 a D-17, sin declarar resultados «PASS» por anticipado.
