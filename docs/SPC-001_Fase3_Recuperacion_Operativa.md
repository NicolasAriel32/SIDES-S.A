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


## Iteración de revisión de ingeniería (continuación)

- Se detectó y cerró un caso de `JSON null` en los intentos persistidos: antes podía tratarse como ausencia y ser sobrescrito. Ahora se considera corrupción que requiere intervención.
- Los borradores huérfanos que conservan un UUID ahora se consultan contra el servidor: **se eliminan sólo si la prueba está confirmada**. Si no se puede verificar, se conservan.
- `src/api/registroSeguro.js` incorpora `reintentarIntentoGuardado`: el operador puede pulsar **Reintentar exactamente el envío anterior** y se retransmite el JSON persistido, sin regenerarlo desde la interfaz. Esto también recupera un `PENDIENTE` automático fallido, que no posee datos físicos.
- El reintento explícito consulta antes por UUID, legajo y máquina, se ejecuta bajo Web Lock y vuelve a reconciliar si se pierde su ACK. Nunca es automático.
- La pantalla ofrece revisión del servidor y reenvío manual sólo cuando el estado local permite esa acción (`ENVIO_PREVIO`).
- Se incorporaron tests de reintento manual, `PENDIENTE`, ACK previo, ausencia de intento, caída de red y recuperación de borradores huérfanos.

### Pruebas diferidas hasta la web de ensayo

Los tests Node y la compilación Vite **sí se ejecutan en CI para evitar integrar código que no compila**. Las pruebas manuales de escritorio con dos pestañas, sesiones reales y cortes de red se efectuarán **después de habilitar un despliegue preview aislado**, nunca directamente sobre la base productiva.

### Bloqueos vigentes

1. No existe una certificación end-to-end en un navegador real de Windows.
2. `localStorage` no garantiza persistencia corporativa ni protege datos en un equipo compartido sin políticas de privacidad/retención.
3. No se ha validado en staging con Auth HTTP real la restricción completa por actor.
4. La migración de Fase 1 no está en SIDES productivo; sin despliegue coordinado backend+frontend el formulario nuevo no podría grabar allí.
5. Sin backup productivo restaurado y probado no se debe modificar la base principal.
