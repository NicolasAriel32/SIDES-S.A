# SPC-001 · Fase 5 — preflight y soporte seguro

**Estado:** implementación y pruebas automatizadas; validación real desde Windows reservada para la etapa final. **Sin despliegue ni migraciones de base de datos.**

## Alcance entregado

1. `src/domain/preflightPuesto.js` define un diagnóstico **informativo**. No autoriza accesos, no confirma pruebas ni reemplaza RLS y los Web Locks operativos de Fases 1–4.
2. La evaluación contempla el estado local de la máquina **identificada**, autenticación comprobada al ingresar o restaurar sesión (no verificación remota en cada render), capacidad de lectura/escritura/limpieza de una clave efímera de Storage, Web Lock, contexto seguro y `navigator.onLine` (sólo indicativo).
3. En `SIN_VERIFICAR`, estado inesperado o evidencia huérfana/incierta se informa bloqueo. Nunca se muestra «sin evidencia» antes de inspeccionar los registros de esa máquina.
4. El informe de soporte tiene **lista blanca cerrada**: sólo versión, códigos conocidos y valores booleanos. Sin legajo, máquinas, UUID, tokens, contraseñas, payload industrial, observaciones ni mensajes de error crudos.
5. La UI del operario presenta el panel **plegado** en «Soporte técnico · diagnóstico del puesto (piloto)». No ocupa un panel técnico abierto constantemente.
6. Eventos `online/offline` actualizan el estado reportado de red; **la señal no prueba conectividad con Supabase** y el test de Storage tampoco garantiza capacidad suficiente para un ensayo real.
7. Las respuestas asincrónicas de reconciliación de otra máquina nunca se usan para presentar ni reintentar estados de la actual.
8. `recuperarEstadoLocal` incorpora una guarda opcional `puedeModificar` que se vuelve a verificar **después de la consulta remota, antes de eliminar registros confirmados**. Si se perdió el lock mientras llegaba la confirmación, el resultado es incierto y la evidencia no se toca.

## Registro explícito de posproducción

**UX-POST-001**: después del despliegue controlado y de recibir feedback de los operarios, **quitar el diagnóstico y el botón de la pantalla del operario** y mover la funcionalidad a un módulo restringido de Soporte técnico/Mantenimiento. No hacerlo antes del piloto. Requisitos completos en:

- `docs/BACKLOG_POSTPRODUCCION_UX.md`
- [Issue #6 — UX-POST-001](https://github.com/NicolasAriel32/SIDES-S.A/issues/6)
- Referencia en `src/App.jsx` con el mismo ID.

## Doble revisión de ingeniería

### Pasada 1 — integridad y exactitud

- Corregido el estado por defecto que antes se mostraba como `LIBRE` sin inspección.
- Corregida la comprobación superficial de disponibilidad de `localStorage`: ahora se prueba escritura y eliminación de un marcador aleatorio, sin sobrescribir evidencia.
- Modo red reactivo; las descripciones no confunden `navigator.onLine` con disponibilidad de Supabase.
- Actualizado CI para cubrir **todos los PR** y **cada push a `main`**, no solo una selección de archivos. El workflow de CI sólo prueba y compila; no despliega.

### Pasada 2 — concurrencia, privacidad y UX

- Diagnóstico y reintentos ligados a la máquina actual, ignorando respuestas tardías de otra máquina.
- Consulta remota con guarda de permiso vigente antes de limpiar una prueba ya confirmada.
- Tests de pérdida de lock durante una consulta y de conservación de señal, borrador e intento.
- Contrato de sanitización por lista blanca; tests con entradas inesperadas, intentos de incluir credenciales y estados inválidos.
- Panel plegado durante el piloto; tarea posproducción registrada en documento y issue.

## Criterios verificables de salida técnica

- `npm ci`, `npm test` y `npm run build` aprobados en GitHub Actions sobre **el último SHA**.
- El diff no incluye claves, despliegues, escrituras a Supabase, migraciones SQL ni borrado masivo de Storage.
- Fase 4 fusionada a `main` después de su CI; Fase 5 tiene PR separado y pruebas propias.
- El código de Fase 5 puede fusionarse tras satisfacer los criterios técnicos; **esto no equivale a autorizar puesta en producción**.

## Riesgos no resueltos por esta fase

- Los ensayos antiguos en `localStorage` **no están cifrados** contra usuarios del mismo perfil Windows. El piloto debe utilizar perfiles Windows segregados; el cifrado/migración exige diseño específico de claves y recuperación offline.
- La confirmación end-to-end de Auth, RLS, RPC, múltiples pestañas, corte de red y restauración local requiere Windows con Chrome/Edge, en el momento que acordamos.
- Antes de habilitar planta también deben revisarse backup/restore, contrato RPC del entorno objetivo y permisos reales de producción. Ningún CI sustituye esa comprobación.

## Guion para el final desde tu PC

1. Confirmar navegador, perfil Windows del operario y conexión al entorno **de prueba**.
2. Probar inicio de sesión y perfil activo; diagnóstico en estado `SIN_VERIFICAR` antes de recuperar, y después resultado correcto.
3. Comprobar almacenamiento y recuperación con señal, borrador e intento de ejemplo.
4. Abrir la misma máquina en dos pestañas: una sola puede escribir. Probar además dos máquinas independientes.
5. Simular cambio de máquina mientras llega una consulta confirmada: no eliminar evidencia después de perder el lock.
6. Cortar y restaurar la red; diferenciar el estado reportado por navegador de la confirmación remota.
7. Copiar diagnóstico: no contiene campos personales ni industriales.
8. Verificar cierre de sesión, vencimiento, contraseña obligatoria, cambios de rol y revocación.
9. Documentar el resultado de cada prueba antes de considerar cualquier despliegue; no tocar producción hasta aprobación explícita.
