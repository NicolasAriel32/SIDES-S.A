# SIDES SPC-001 — mejoras de UX para posproducción

## UX-POST-001 · Mover «Copiar diagnóstico seguro» fuera de la pantalla del operario

**Estado:** pendiente, documentado durante el cierre técnico de la Fase 5 (2026-11-06).

**Cuándo hacerlo:** después de la primera puesta en producción controlada y la validación operativa en Windows, no antes de las pruebas piloto.

### Contexto y decisión

La Fase 5 incorpora un diagnóstico del puesto para facilitar soporte, recuperación de registros e identificación de problemas de autenticación, bloqueo de máquina, almacenamiento y red. Durante la etapa de validación puede ser conveniente acceder rápidamente a él desde la vista del operario.

**Recomendación aprobada para el backlog:** retirar el diagnóstico permanente y el botón «Copiar diagnóstico seguro» de la pantalla principal del operario **después de la puesta en producción**. Reubicarlo en un panel discreto de **Soporte técnico / Mantenimiento** con permisos apropiados. No borrar el módulo diagnóstico ni su batería de pruebas.

### Criterios de aceptación

1. La pantalla principal del operario muestra sólo acciones relevantes para la prueba de estanqueidad y advertencias operativas; el diagnóstico técnico no ocupa espacio permanente.
2. Un usuario autorizado puede acceder a Soporte técnico y copiar un reporte con lista blanca de códigos/booleanos, sin legajo, UUID, credenciales, datos de ensayos ni información sobre otros operarios.
3. El área de soporte registra versiones y eventos de diagnóstico sin imprimir tokens ni payloads industriales; no se envía telemetría automáticamente.
4. Se conserva el comportamiento de fail-closed ante falta de bloqueo, autenticación o almacenamiento. La mudanza de UI no altera permisos de servidor ni reglas de recuperación.
5. Se valida nuevamente en Chrome/Edge y pantalla Windows de Planta. Las pruebas unitarias y CI pasan.
6. Antes de empezar la modificación posterior al despliegue, recabar observaciones reales de los operarios y del responsable de Mantenimiento.

### Dependencias y restricciones

- Depende del cierre del piloto y de la definición de roles autorizados a soporte.
- **No ejecutar ahora:** esta tarea es para la etapa de posproducción y no forma parte del alcance de Fase 5.
- Referencia actual: `src/App.jsx`, componente `VistaOperario`, texto «Diagnóstico del puesto»; lógica reutilizable en `src/domain/preflightPuesto.js`.
