# Informe de estado — Sistema de Trazabilidad de Pruebas de Estanqueidad (SIDES S.A.)

**De:** Nicolás Giménez · **Para:** Supervisión · **Fecha:** 26/06/2026 · **Tipo:** Reporte técnico de avance

---

## 1. Resumen ejecutivo

El sistema de trazabilidad para pruebas de estanqueidad de cabezales de soda está **funcionalmente operativo y en producción** (Supabase + Next/React sobre Vercel). El núcleo de trazabilidad —captura de prueba, carga del operario, estados OK/RECHAZADO/PENDIENTE, no conformidades y log de auditoría inmutable— está construido y con datos reales cargados.

Durante junio se completó una **auditoría de seguridad y cumplimiento ISO** y su remediación. Los hallazgos críticos y altos (no-repudio, control de acceso por rol, inmutabilidad de datos, calibración) ya están **cerrados a nivel base de datos**. Queda **un único paso operativo bloqueante: redeploy del frontend en Vercel** para que los cambios de no-repudio (C1) y pantalla de pasillo (A4) tomen efecto en la capa cliente.

**Veredicto:** listo para piloto del módulo de Calidad una vez ejecutado el redeploy pendiente.

---

## 2. Estado por componente

**Base de datos (Supabase, proyecto `rzejddqcjqtxsenbdocz` "SIDES S.A.") — En producción.** 25 tablas, todas con Row Level Security activo. Datos reales en operación: 48 pruebas registradas, 545 eventos en el log de auditoría, 13 no conformidades, 15 controles de calidad, 120 mediciones, 6 recontroles, 5 mermas. Autenticación migrada 100% a Supabase Auth (bcrypt); la columna legacy `password_hash` fue eliminada.

**Frontend (React/Vite sobre Vercel) — En producción, con cambios pendientes de desplegar.** Interfaces de operario, supervisor, administrador, inspector, auditor y pantalla de pasillo construidas. El código local de `App.jsx` ya incluye la reescritura de `logEvent` (no-repudio vía RPC) y de la pantalla de pasillo (KPIs sin PII), **pero estos cambios aún no están desplegados**.

**Módulo de Control de Calidad — Construido, en validación.** Reemplaza el sistema actual basado en macros (lento y propenso a error de carga según Calidad). Incluye control de cajas, recontroles, mermas y sesiones de calidad por turno.

**Subsistema de Calibración (ISO 9001 7.1.5) — Backend listo, UI no construida (por decisión).** Tabla `calibraciones` ligada a máquina, inmutable y auditada. Queda como evidencia de cumplimiento; la UI de carga no se desarrolló porque no se usará por ahora.

---

## 3. Cumplimiento normativo (ISO 9001 / 27001 / IRAM)

**Registro inmutable e identificación de responsables (ISO 9001 / IRAM).** Logrado. Se revocaron permisos DELETE/TRUNCATE a los roles `anon` y `authenticated` en las 25 tablas: la aplicación no borra, solo anula con justificación. Cada registro lleva responsable identificado.

**No-repudio del log de auditoría (C1 — crítico).** Implementado en base de datos. El `audit_log` usa cadena de hash SHA-256 encadenado (cada evento referencia el hash del anterior), con triggers en pruebas, no conformidades, usuarios y verificaciones físicas. El actor se resuelve server-side vía RPC `registrar_evento_auditoria` (no es falsificable desde el cliente). Se eliminó la política de inserción forjable. *Pendiente: redeploy del frontend para que la app emita eventos por la RPC.*

**Control de acceso por rol (ISO 27001) — A2.** Cerrado. Las 8 tablas de calidad pasaron de RLS permisivo a políticas por rol: operario solo ve sus pruebas y su máquina; supervisor/inspector ven pruebas y gestionan controles y NC; administrador acceso total; auditor solo lectura. Sin DELETE para ningún rol.

**Cierre de la vía anónima — A4.** Cerrado. El rol `anon` quedó sin INSERT/UPDATE/SELECT. La pantalla de pasillo se alimenta de la RPC `pasillo_kpis()` (solo agregados, sin datos personales). *Pendiente: redeploy del frontend.*

**Trazabilidad de muestra, lote y caja (ISO 9001 / IRAM).** Implementada de inicio a fin, con numeración secuencial atómica e idempotencia por restricción única en la señal de máquina.

---

## 4. Riesgos abiertos y observaciones de auditoría

El escaneo de seguridad de Supabase **no reporta hallazgos críticos ni de nivel ERROR**. Quedan únicamente advertencias (WARN) esperables:

- **Funciones SECURITY DEFINER expuestas:** `get_my_profile` y `pasillo_kpis` son accesibles por `anon` de forma **intencional** (perfil propio y KPIs públicos sin PII). El resto (creación de usuarios, control de calidad, recontrol, auditoría) está restringido a `authenticated`. Son advertencias informativas, no vulnerabilidades.
- **Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada — B4.** Requiere plan Pro de Supabase; en el plan Free no es accionable. Se activa con un clic si se sube de plan.

---

## 5. Pendientes

**Bloqueante (operativo, ~minutos):** commit y **redeploy del frontend en Vercel**. Habilita en cliente el no-repudio (C1) y la pantalla de pasillo segura (A4). Es el único paso que separa al sistema de estar listo para piloto.

**Desarrollo pendiente (roadmap):** automatización de la señal del PLC (hoy la señal de máquina se gestiona manualmente) y un generador de QR para etiquetas de prueba, que permitiría diferenciar muestras en el almacén cuando están agrupadas por máquina.

**Opcional:** UI de carga de calibraciones (backend ya listo); activar B4 si se migra a plan Pro.

---

## 6. Próximos pasos sugeridos

1. Ejecutar el redeploy pendiente y verificar emisión de eventos vía RPC en el log de auditoría.
2. Iniciar piloto controlado del módulo de Calidad en una línea, con la Jefatura de Calidad.
3. Priorizar automatización de señal PLC + QR de etiquetas como siguiente bloque de desarrollo.
