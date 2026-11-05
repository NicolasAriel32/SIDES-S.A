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
