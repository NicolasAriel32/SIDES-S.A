# Auditoría de seguridad — SIDES S.A.

Fecha: 2026-10-01

## Alcance
Repositorio `NicolasAriel32/SIDES-S.A` + proyecto Supabase `SIDES S.A`.

## Reglas de negocio confirmadas
- Control de Calidad: sólo el rol `inspector` puede registrar controles.
- Recontrol: pueden registrar `inspector`, `operario` y `supervisor`.
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
3. Definir alcance de visibilidad para recontrol de operarios: todas las NC de Calidad vs. sólo la máquina asignada.
4. Ejecutar pruebas end-to-end por rol antes de desplegar en Cloudflare.
5. La protección de contraseñas filtradas de Supabase sigue desactivada y depende del plan/configuración disponible.
