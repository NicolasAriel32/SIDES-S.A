# Excepciones y advertencias de seguridad — SIDES S.A.

Fecha: 2026-10-01  
Objetivo: documentar advertencias que permanecen visibles en Supabase Security Advisor y su tratamiento.

## Principio

Una advertencia del linter no se ignora ni se considera automáticamente una vulnerabilidad. Cada caso debe tener:
- motivo técnico;
- necesidad de negocio;
- control compensatorio;
- evidencia de revisión;
- condición para revisarlo nuevamente.

## 1. pasillo_kpis() — SECURITY DEFINER accesible por anon

**Estado:** aceptado de forma intencional, con controles.

Motivo de negocio:
- la pantalla de pasillo funciona sin login;
- necesita KPIs agregados de producción/calidad.

Revisión técnica:
- no devuelve filas crudas;
- no devuelve operario, legajo, lote, caja ni información personal;
- devuelve conteos, tasas, NC abiertas, máquinas, tendencia y top de fallas;
- anon no tiene SELECT directo sobre las tablas de origen.

Riesgo residual:
- consumo abusivo de la RPC y exposición pública de indicadores operativos agregados.

Revisar si:
- la pantalla deja de ser pública;
- se incorporan datos personales o comerciales sensibles;
- aumenta el costo/volumen de las consultas.

## 2. SECURITY DEFINER ejecutables por authenticated

Supabase advierte genéricamente sobre estas RPC porque SECURITY DEFINER puede superar RLS. En SIDES varias son deliberadamente endpoints de negocio y por eso el control crítico está dentro de la función.

Revisadas:
- admin_create_auth_user: exige admin activo.
- admin_update_maquina: exige admin activo y valida máquina.
- audit_integrity_status: exige admin/auditor.
- get_my_profile: devuelve únicamente el perfil activo de auth.uid().
- guardar_control_calidad: exige inspector activo.
- guardar_recontrol: exige operario/supervisor/inspector activo y valida invariantes.
- marcar_password_cambiada: sólo modifica metadata del propio auth.uid().
- recontrol_pendientes: exige rol operativo permitido y devuelve una vista acotada.
- registrar_evento_auditoria: identidad server-side, allowlist y rate limit.
- pasillo_kpis: excepción pública documentada arriba.

**Regla:** una función SECURITY DEFINER no se considera aceptable sólo porque el frontend oculte un botón. La autorización debe permanecer en PostgreSQL.

## 3. next_numero_secuencial()

**Estado:** advertencia eliminada.

El frontend dejó de llamar esta RPC. La columna pruebas.numero_secuencial usa su DEFAULT nextval(...) dentro del INSERT, por lo que no hace falta exponer una función que permita consumir la secuencia sin crear una prueba.

EXECUTE fue revocado a anon/authenticated.

## 4. Leaked Password Protection

Supabase Security Advisor informa que la protección contra contraseñas filtradas está desactivada.

Estado:
- pendiente de configuración/plan;
- no se oculta la advertencia;
- el proyecto actualmente usa contraseñas temporales aleatorias y cambio obligatorio, pero eso no sustituye la detección de contraseñas comprometidas.

Acción futura:
- verificar disponibilidad en el plan utilizado para producción;
- activar la protección cuando esté disponible;
- registrar evidencia de la configuración.

## 5. Regla de revisión

Revisar este documento cuando:
- cambie una RPC SECURITY DEFINER;
- cambien roles o permisos;
- se agregue un endpoint anónimo;
- cambie el plan de Supabase;
- Security Advisor agregue un hallazgo nuevo.
