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
