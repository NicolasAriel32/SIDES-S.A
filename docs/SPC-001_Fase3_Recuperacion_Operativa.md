# SIDES · SPC-001 — Fase 3: recuperación operativa segura (escritorio)

**Rama:** `feature/spc-001-fase3-recuperacion-operativa-desktop`. Basada en `feature/spc-001-fase2-recuperacion-senales`, sin fusionar a `main`.

## Objetivo

No perder ni reescribir una prueba manual cuando hay caída de conexión, una pestaña se cierra, falla la limpieza del navegador o quedan señales/borradores/intentos huérfanos. **No implica conexión OT**. Prioridad Windows + Chrome/Edge.

## Alcance implementado

1. `src/domain/borradorEstanqueidad.js`: inspección controlada de borradores huérfanos sin inventar UUID ni borrarlos.
2. `src/domain/intentosRegistro.js`: los valores `null` y JSON inválidos almacenados no se interpretan como ausencia de un intento; fail-closed.
3. `src/domain/recuperacionLocal.js`: conciliación conservadora de señal, borrador e intento con estados explícitos:
   - `LIBRE`: no hay residuos.
   - `ABIERTA`: señal activa sin envío.
   - `ENVIO_PREVIO`: mismo UUID ya intentado, no confirmado por consulta.
   - `HUERFANO`: intento sin señal (requiere consulta).
   - `INCIERTO`: no se pudo obtener confirmación.
   - `INTERVENCION`: datos locales inconsistentes o sin base de recuperación.
   - `CONFIRMADA_LIMPIA`: servidor confirmó y no quedan registros locales.
   - `CONFIRMADA_CON_RESIDUOS`: servidor confirmó, pero no se pudo limpiar completamente el almacenamiento local.
4. Limpieza **sólo después de confirmación explícita** y únicamente de registros con el mismo `requestId`; se elimina primero la señal, después el borrador y **último** el intento. Ante error queda evidencia recuperable.
5. La consulta por UUID también filtra `operario_legajo` e `id_maquina`. La visibilidad de la misma máquina no alcanza para atribuir una confirmación a otro operario.
6. `VistaOperario`: restaura o bloquea el editor según el estado local, impide PENDIENTE automático con un intento previo, permite revisar el servidor desde el banner y no anuncia un registro confirmado como «fallido» sólo porque no pudo limpiar `localStorage`.
7. Antes de «Iniciar registro manual (simulado)» revisa el conjunto señal+borrador+intento. No permite generar una señal nueva si hay estado ambiguo ni borra selectivamente un intento dejando los otros registros atrás.
8. Pruebas Node integradas y unitarias para datos huérfanos, corrupción, identidad, confirmación y limpieza parcial.

## Decisiones conservadoras

- Ningún registro local corrupto se elimina automáticamente.
- La ausencia de una fila en una consulta no equivale a confirmación de fracaso definitivo si la lectura está bloqueada por RLS; errores se reportan `INCIERTO`.
- Si el contenido ya enviado varió, `registroSeguro` lo bloquea; no convierte ese intento en un ensayo nuevo con el mismo UUID.
- No se pretende que `localStorage` sea almacenamiento empresarial seguro o persistencia offline garantizada.
- No se modifican los registros históricos, los equipos industriales ni la base de SIDES.

## Pendiente para QA web posterior al despliegue preview

- Sesión Supabase Auth real en Windows y políticas RLS comprobadas end-to-end.
- Corte de red antes/después del ACK y recuperación de un registro confirmado con residuos.
- Dos pestañas en Chrome/Edge; bloqueo de edición y reconciliación sin pisar un borrador.
- Fallo/agotamiento de espacio de `localStorage` y continuidad en equipos compartidos.
- Revisión de accesibilidad, mensajes y protocolo de soporte para registros `INTERVENCION`.
- Política de retención de borradores locales y borrado al cerrar sesión (requiere consentimiento y procedimiento que no descarte pruebas sin confirmar).
- Backups/restauración y plan de rollback antes de migrar producción.

**No desplegar.** Las pruebas automáticas de código permiten continuar el desarrollo, pero no certifican el uso real en planta.
