# Auditoría de seguridad — SIDES S.A.

Fecha: 2026-10-01

## Alcance
Repositorio `NicolasAriel32/SIDES-S.A` + proyecto Supabase `SIDES S.A`.

## Reglas de negocio confirmadas
- Control de Calidad: sólo el rol `inspector` puede registrar controles.
- Recontrol: pueden registrar `inspector`, `operario` y `supervisor`. Todos ven los rechazos pendientes generados por Calidad, sin filtrar por máquina. Cualquiera de esos roles puede marcar un recontrol como definitivo, pero ese marcado no cierra la NC.
- Alta/reset de usuarios: contraseña temporal aleatoria, distinta por usuario, mostrada una sola vez y con cambio obligatorio al primer ingreso.

## Correcciones aplicadas
- Eliminado `.env` versionado. Se conserva sólo `.env.example` sin credenciales.
- Eliminado `usuarios_supabase.csv` del árbol actual del repo.
- Eliminado el seed legacy con contraseña admin en texto plano.
- Eliminada la política `usuarios_self_update`; el usuario ya no puede actualizar directamente campos sensibles de su perfil.
- Agregada RPC acotada `marcar_password_cambiada()` para marcar el cambio de contraseña del usuario autenticado.
- Revocado acceso público/autenticado a `debug_my_rls()`.
- `guardar_control_calidad(jsonb)`: valida usuario activo + rol inspector y deriva identidad desde `auth.uid()`.
- `guardar_recontrol(jsonb)`: valida rol operativo permitido, deriva identidad desde `auth.uid()`, deriva resultado y relación con NC/control en servidor y bloquea la NC durante el cálculo del intento.
- `admin_create_auth_user(text,text)`: sin contraseña universal; exige contraseña temporal explícita de al menos 12 caracteres y fuerza cambio al primer ingreso.
- `admin_update_maquina(text,text)`: exige admin activo y valida que la máquina exista.
- `next_numero_secuencial()`: restringida a roles operativos/admin activos.
- `get_my_profile()`: ya no es ejecutable por `anon` ni `PUBLIC`.
- Frontend de recontrol: el responsable ya no se selecciona manualmente; se muestra el usuario autenticado.
- Capa API: ya no envía identidad del inspector ni resultado/merma de recontrol como datos confiables del cliente.

## OWASP Top 10:2025 relacionado
- A01 Broken Access Control: controles por rol y actor resuelto server-side.
- A02 Security Misconfiguration: retiro de archivos de entorno/datos del árbol público y revocación de RPCs de diagnóstico.
- A07 Authentication Failures: eliminación de contraseña temporal universal.
- A08 Software or Data Integrity Failures: campos críticos de actor/resultado derivados en servidor.
- A09 Security Logging & Alerting Failures: queda pendiente corregir la cadena de auditoría y agregar alertas.

## Pendientes importantes
1. El repositorio sigue siendo público. Los archivos eliminados pueden permanecer en el historial Git; poner el repo privado o reescribir historia antes de una publicación formal.
2. Cadena de auditoría: hay bifurcaciones históricas y no hay firmas HMAC. No modificar registros históricos para ocultarlo; diseñar una migración v2 con secuencia monotónica/checkpoint.
3. Regla cerrada: sólo `supervisor` o `inspector` pueden cerrar definitivamente una NC. Un recontrol definitivo deja la NC en `EN ANALISIS` y pendiente de cierre; para NC de Calidad, la base impide cerrar sin un recontrol definitivo registrado.
4. Ejecutar pruebas end-to-end por rol antes de desplegar en Cloudflare.
5. La protección de contraseñas filtradas de Supabase sigue desactivada y depende del plan/configuración disponible.


## Decisión de visibilidad de recontrol
Se eligió la opción B: todo operario o supervisor habilitado para recontrol puede consultar la cola completa de rechazos pendientes originados por Control de Calidad. Esto se implementa mediante la RPC server-side `recontrol_pendientes()`, sin ampliar el SELECT general de `controles_calidad` ni `no_conformidades` para operarios. El historial amplio sigue restringido para operarios.


## Flujo final de recontrol y cierre de NC
- Los recontroles pueden extenderse durante varias jornadas y generar varios intentos.
- El formulario inicia con "recontrol terminado" desactivado para evitar cierres lógicos accidentales.
- Cuando el operario/supervisor/inspector marca el último intento como definitivo, no se admiten más intentos y la NC queda en EN ANALISIS.
- El recontrol definitivo desaparece de la cola operativa de recontrol y queda pendiente de decisión de cierre.
- Sólo supervisor o inspector pueden cambiar la NC a CERRADA.
- La identidad de quien cierra se deriva de la sesión autenticada en la base; no se confía en un legajo escrito desde el navegador.


## Recontrol por jornada
Se confirmó que cada registro de recontrol debe capturar únicamente la cantidad realmente reinspeccionada durante esa jornada/turno, no el total acumulado manualmente. Supabase calcula el acumulado y el pendiente. No permite superar el objetivo original del rechazo y sólo acepta marcar un recontrol como definitivo cuando el acumulado alcanza exactamente el total a recontrolar. La merma, recuperados y resultado se calculan sobre la cantidad de esa jornada.
