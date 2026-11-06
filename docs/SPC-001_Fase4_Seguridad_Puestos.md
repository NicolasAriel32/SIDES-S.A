# SPC-001 — Fase 4 · Seguridad de sesión y puestos compartidos

## Rama y política
`feature/spc-001-fase4-sesion-puestos-compartidos`, derivada de `main` tras integrar las Fases 1–3. No desplegar ni alterar la base de datos.

## Cambios
- La identidad del perfil de UI se vincula a `authUserId` devuelto por Supabase Auth en login.
- Al restaurar la sesión se usa `supabase.auth.getUser()`, que valida el usuario ante el servicio Auth; el perfil local se acepta únicamente si su UID coincide. Los perfiles antiguos sin UID requieren nuevo login.
- Cuando el login Auth funciona pero el perfil de usuario falla o está inactivo, se cierra la sesión Auth local y se borra el perfil de UI para no dejar una sesión semiautenticada.
- El cierre utiliza `signOut({scope:'local'})` y retira el perfil UI en `finally`, incluso cuando la red o el log complementario fallan. **Esto no prueba que un token remoto haya sido revocado si falla el servicio**: se bloquea el reuso del perfil en la UI, no se promete revocación remota.
- El puesto inventaría la evidencia local por legajo y avisa antes de cerrar sesión; jamás borra señales, borradores ni intentos sin confirmar.
- `src/domain/seguridadPuesto.js` contiene guardia de identidad e inventario no destructivo con pruebas Node.

## Riesgos abiertos / QA posterior a preview
1. La identidad en el perfil de `usuarios` sigue buscándose por legajo y depende de políticas RLS; verificar el enlace Auth UID ↔ legajo en backend con Auth real. La comparación de `authUserId` evita restauración cruzada, pero no sustituye esta verificación.
2. `localStorage` comparte datos entre usuarios del mismo perfil Chrome/Edge; se aisla por legajo en claves, pero no cifra datos. Para un entorno de planta se recomienda perfiles de navegador o Windows individuales, sesión bloqueada al abandonar el puesto y política de retención acordada.
3. No se debe eliminar evidencia local en logout ni hacer limpieza automática de datos antiguos sin procedimiento y confirmación del servidor.
4. Cierre remoto fallido puede dejar un token de Auth persistido en `sessionStorage`; la UI no restaura perfil sin UID válido, pero hay que validar la invalidación/limpieza del token en QA de navegador.
5. Sesiones simultáneas, cambio de operario, reconexión, múltiples pestañas y cierre de ventana requieren prueba manual.
6. La RPC de Fase 1 todavía no está aplicada a SIDES productivo; no habilitar frontend productivo sin migración coordinada y backup verificado.

## Criterio de aceptación de código
`npm test` y `npm run build` pasan en CI; PR de Fase 4 queda abierto hasta revisión. La certificación de operación real se realizará sobre preview aislado.


## Revisión técnica doble — 2026-11-06

### Pasada 1: identidad y autorización
- Corregida la selección del perfil que antes buscaba sólo `legajo`; ahora exige `usuarios.id = auth.getUser().id`, legajo solicitado y `activo = true`.
- La restauración consulta `auth.getUser()` **y vuelve a leer el perfil actual** con RLS; no reutiliza roles, máquinas ni `fuerza_cambio` del perfil guardado sin validación.
- Corregido el cambio de contraseña que perdía `authUserId` al reescribir `sessionStorage`.
- Login y cambio de contraseña distinguen errores de Auth, metadatos y auditoría; ningún log complementario habilita una identidad no verificada.
- Consultas de sólo lectura en SIDES producción: 7 perfiles, los 7 con UID vinculado a Auth, estado activo definido y roles admitidos. **Sin cambiar tablas ni filas.**
- En el staging sintético los perfiles no están aún enlazados a cuentas Auth reales: el E2E de autenticación sigue bloqueado hasta preparar credenciales de prueba.

### Pasada 2: seguridad y concurrencia de estación compartida
- Extraído `src/api/sesionPuesto.js` para probar las rutas de login, recarga, password y logout con dobles de Auth y PostgREST; `src/domain/seguridadPuesto.js` define el contrato de perfil/UID.
- En logout, se descartan el perfil de UI y el token persistido local; se emplea la clave de sesión predeterminada por el proyecto Supabase para no dejar una sesión legada sin limpiar. Si falla el cierre remoto, se recarga el navegador para descartar también el estado de Auth que pudiera quedar en memoria.
- La eliminación local del token **no revoca por sí sola los access tokens existentes**, que siguen válidos hasta su vencimiento en servidor. El resultado remoto sigue siendo un riesgo que requiere validación en navegador.
- La UI escucha `SIGNED_OUT` y se oculta; el regreso al foco revalida el perfil contra Supabase. Una revisión de sesión tardía no puede reabrir una identidad después de logout o de otro login.
- Durante el logout se oculta la UI inmediatamente y el siguiente login queda bloqueado hasta completar el cierre. La evidencia de pruebas continúa intacta.
- Se mantienen las advertencias antes de cerrar sesión si hay señales, borradores o intentos locales pendientes; no se realiza borrado general de `localStorage`.

### Evidencia automatizada
- GitHub Actions: `npm test` **99 pruebas aprobadas, 0 fallos** y `npm run build` completo sobre la rama de Fase 4, ejecución [42161206752](https://github.com/NicolasAriel32/SIDES-S.A/actions/runs/42161206752).
- Las pruebas con dobles verifican UID, legajo, rol, estado activo, almacenamiento denegado, revocación lógica en recarga, cambio de contraseña, cierre offline y preservación de trazabilidad.
- Estas ejecuciones **no sustituyen** pruebas E2E reales de Chrome/Edge, Auth HTTP, múltiples pestañas ni corte físico de conexión.

### Riesgos que siguen abiertos
1. La persistencia en `localStorage` sigue siendo compartida por el mismo perfil Windows/navegador y no está cifrada; **no** se garantiza privacidad frente a otra persona con acceso al mismo perfil de Windows ni a DevTools.
2. No hay revocación inmediata de access tokens emitidos ni una política de inactividad aprobada por Planta; deberá acordarse con seguridad/operaciones.
3. La revalidación al recuperar foco puede bloquear a un operario durante una desconexión: se conserva la evidencia local y será necesario reautenticar al volver la red.
4. En caso de falla entre Auth y `marcar_password_cambiada`, la contraseña pudo cambiar sin actualizar `fuerza_cambio`; la UI informa de esa incertidumbre, sin afirmar éxito.
5. Antes de desplegar se deberá verificar en navegador real que el logout con red caída no conserva una sesión reutilizable en memoria, ni reabre pantallas por respuestas tardías.
6. Cambios Fase 4 permanecen sólo en rama/PR de borrador. No se ejecutó despliegue ni migración de BD.

## Decisión
**No fusionar Fase 4 a `main` todavía.** Completar revisión y ejecutar QA de navegador al preparar un preview aislado; la compilación y los tests de CI no equivalen a certificación de planta.

### Validaciones adicionales de PR
- El diff de PR #4 contiene sólo cambios frontend, módulos JavaScript, pruebas y documentación (sin ficheros SQL ni claves de producción).
- Se comprobó que el commit de `main` sigue en `bc45f089d6ebb404bbab7b5e4102378116378107` y que el PR #4 permanece sin fusionar.
- Riesgo a validar en preview: el BroadcastChannel de Auth podría generar eventos entre pestañas aunque las sesiones estén en `sessionStorage`. La prueba E2E debe verificar que el logout de una pestaña no exponga ni modifique el usuario de otra.


## Endurecimiento adicional — bloqueo por máquina y aislamiento de legajos

- `reservarPuestoMaquina()` obtiene Web Lock exclusivo por código de máquina (no por UUID ni por legajo). Sin lock, el formulario no puede enviar, iniciar señales, registrar vencimientos automáticos ni reconciliar el estado local.
- El lock se libera al desmontar la vista o cambiar de máquina. Si otra pestaña lo ocupa, la segunda queda bloqueada con acción explícita para reintentar.
- Login y restauración verifican que no existan `senal_plc_`, `spc_borrador_v1_` o `spc_intento_v1_` pertenecientes a otro legajo en el mismo perfil de navegador. Se rechaza la sesión sin eliminar esos datos.
- Esta medida evita la mezcla **accidental** de usuarios, pero no protege contra acceso deliberado al `localStorage` desde DevTools o desde el mismo perfil Windows. **No se declara resuelta la confidencialidad**: se requiere cifrado de evidencia con llave fuera del almacenamiento compartido o aislamiento de perfiles Windows gestionados.
- El cifrado de los datos existentes debe diseñarse con migración reversible y prueba de recuperación offline. No borrar ni convertir automáticamente los registros históricos locales sin una estrategia de recuperación.
- No se aplicaron cambios a Supabase producción ni a `main`. Continúa prohibido el deploy hasta QA E2E.
