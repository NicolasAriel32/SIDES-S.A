# SPC-001 · Fase 2: recuperación segura de señales manuales (sin deploy)

Esta rama nace de `feature/spc-001-fase1-integridad-ui`, **no de main**. Ningún cambio se aplica a producción.

## Implementado

- `src/domain/senalesManuales.js`: contrato de persistencia local por legajo y máquina, sin acceso remoto.
- No sobrescribir una señal no confirmada con una nueva.
- Guardar primero y recién después abrir el formulario de registro.
- Eliminar una señal sólo si su `requestId` coincide con la solicitud que la RPC confirmó.
- Rechazar señales de máquina distinta, fechas inválidas o futuras inconsistentes; no convertirlas silenciosamente en PENDIENTE.
- Migrar señales antiguas sin UUID únicamente si se puede validar su máquina y fecha, y se confirma la actualización del almacenamiento.
- Errores de almacenamiento se informan y nunca se tratan como éxito.
- `tests/senalesManuales.test.js`: siete pruebas de límite 60 min, aislamiento por legajo, no sobrescritura, ACK condicional, migración y almacenamiento corrupto.

## Límites y siguientes cambios de Fase 2

1. **No existe una cola offline durable completa**. La persistencia de la señal es localStorage, no IndexedDB; el resultado físico y los campos escritos en el formulario aún no tienen un outbox con reintento seguro. No prometer offline-first completo.
2. No hay bloqueo transaccional entre pestañas; se necesita coordinación de múltiples pestañas para impedir duplicidad/colisiones.
3. No hay integración con PLC/HMI: la señal continúa siendo manual simulada.
4. No se cambió Supabase, roles, históricos ni `main`.
5. Debe probarse el circuito completo desde móvil con Auth real y hosting preview antes de producción. Esta fase no autoriza deploy.

## Criterios de aceptación de la siguiente iteración

- Una caída de red después de enviar pero antes del ACK no consume el UUID y el reintento conserva idéntico payload.
- Al volver a abrir el navegador no se pierde el formulario completado.
- Dos pestañas no pueden confirmar dos resultados distintos para la misma señal.
- El operador distingue claramente `pendiente de enviar`, `confirmado` y `requiere intervención`.
- No se crean pruebas OT certificadas ni se modifica el histórico.

## Iteración 2 — Borrador del formulario (commits en esta rama)

- Se agregó `src/domain/borradorEstanqueidad.js`: almacenamiento local por legajo + máquina + `requestId`, versión 1, lectura, escritura y borrado condicional.
- Se restauran resultado, tipos, cantidades, cabezales afectados, producto, caja, lote y observaciones cuando vuelve a abrirse una señal manual.
- El borrador se conserva durante errores de red y se elimina sólo después de confirmación de la RPC. No hay transmisión automática.
- Si hay carga parcial, el vencimiento de 60 minutos **no genera automáticamente un PENDIENTE** ni descarta el borrador. El operador debe revisar la situación.
- Se muestra aviso de errores de persistencia en el formulario.
- Pruebas unitarias adicionales de restauración, aislamiento, borrado condicional, detección de carga parcial y fallo de almacenamiento.

### Riesgos abiertos (no declarar apto para producción)

- El almacenamiento local es `localStorage` y no es una cola transaccional; no garantiza protección frente a eliminación del navegador, falta de espacio o uso simultáneo de pestañas.
- Los datos de prueba pueden ser sensibles y el almacenamiento del navegador no está cifrado por la aplicación; se debe definir política de retención y de dispositivos compartidos antes del deploy.
- El borrador aún no cuenta con reconciliación server-side de estado ambiguo tras timeout de RPC.
- La recuperación automática de un borrador malformado requiere intervención manual; no se elimina silenciosamente.
- No hay sesión real de Supabase Auth validada desde el navegador ni pruebas E2E móviles.
- No se cambió la base productiva ni se desplegó.

## Iteración 3 — Exclusión entre pestañas y ACK ambiguo

- `src/domain/reconciliacionPruebas.js`: bloqueo exclusivo por legajo, máquina y UUID con `navigator.locks`, `ifAvailable`, sin espera indefinida. Si el navegador no soporta Web Locks, **se bloquea el envío** (fail-closed); no se simula exclusión con localStorage.
- La función de guardado del frontend utiliza ese bloqueo para el registro normal y el pendiente automático. El bloqueo cubre el envío y la verificación del resultado, no el tiempo de edición del formulario.
- Ante error de RPC o ACK perdido se consulta `pruebas.spc_request_id` con las credenciales actuales. Si se encuentra la fila, se trata como confirmación y no se repite la escritura. Si falla la lectura o no aparece, se conserva el UUID y el formulario para revisión/reintento manual; **no hay reintentos automáticos**.
- Nuevos tests unitarios de exclusión, bloqueo no disponible y estados de reconciliación.

### Riesgos que impiden desplegar

- Las políticas RLS reales deben permitir a un operario consultar **su propia prueba por UUID**; sin esa política, la lectura puede devolver cero filas y la reconciliación no es concluyente. El servidor mantiene idempotencia por UUID, pero falta un test de autorización real.
- Web Locks cubre pestañas del mismo origen/perfil compatibles; no evita múltiples dispositivos. La idempotencia en PostgreSQL es la defensa global.
- La recuperación del borrador sigue usando localStorage y no existe una outbox IndexedDB cifrada o con retención acordada.
- No se verificó desde navegador real. La compatibilidad con dispositivos móviles requiere prueba E2E.
