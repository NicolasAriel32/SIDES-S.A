# Auditoría de logs y evidencia ISO — SIDES S.A.

Fecha: 2026-10-01  
Alcance: audit_log de aplicación, trazabilidad de cambios en PostgreSQL, logs de plataforma Supabase, autenticación, respaldo y evidencia de Calidad/Recontrol.

## 1. Alcance de conformidad

Este documento evalúa si el sistema aporta evidencia técnica útil para un SGC/SGSI. **No afirma que el software, por sí solo, esté “certificado ISO”**. La certificación corresponde al sistema de gestión y a la organización, y requiere procesos, responsabilidades, políticas, evidencia operativa y auditoría independiente.

El proyecto fue concebido con alineación buscada a ISO 9001 / ISO 27001 / IRAM y con objetivo de ser auditable. La documentación original también vinculó el subsistema de calibraciones con ISO 9001 7.1.5.

Dato de negocio confirmado por Nicolás (2026-10-01): SIDES S.A. está certificada contra ISO 9001:2026. A partir de esta fecha, la auditoría técnica del sistema toma ISO 9001:2026 como referencia de calidad del proyecto. Las menciones históricas a ISO 9001:2015 se conservan sólo como contexto de desarrollo anterior.

## 2. Qué se encontró antes de la remediación actual

### audit_log de aplicación
- 590 eventos históricos.
- 434 eventos legacy sin hash.
- 156 eventos con SHA-256.
- Los 156 hashes individuales recomputan correctamente: 0 hashes inválidos.
- La cadena histórica no era lineal: 8 puntos de bifurcación y 37 hijos adicionales.
- 0 eventos con firma HMAC.
- 0 eventos con ip_origen.
- 428 eventos sin tabla_afectada.
- 431 eventos sin registro_id.
- El servidor PostgreSQL trabaja en UTC, pero el campo histórico timestamp es timestamp without time zone.

### Cobertura automática
Antes de esta auditoría, trg_audit_trail cubría:
- pruebas
- no_conformidades
- usuarios
- verificaciones_fisicas
- calibraciones

No cubría automáticamente el ciclo de Control de Calidad/Recontrol:
- controles_calidad
- mediciones
- controles_defectos
- recontroles
- recontrol_defectos
- mermas
- ordenes_maquina
- sesiones_calidad

### Protección del log
Aunque anon/authenticated no podían escribir audit_log, service_role conservaba INSERT/UPDATE/DELETE/TRUNCATE y RLS no lo limita porque service_role tiene BYPASSRLS.

### Eventos semánticos
registrar_evento_auditoria() obtiene el actor desde auth.uid(), lo cual evita falsificar la identidad, pero el cliente podía elegir libremente accion/descripcion/tabla. Por lo tanto un evento semántico no debe considerarse evidencia autoritativa de que una modificación ocurrió realmente.

### Plataforma / recuperación
La organización Supabase del proyecto está actualmente en plan Free.

Consecuencias operativas a considerar:
- los logs de plataforma accesibles tienen retención corta en Free;
- no hay respaldo diario gestionado comparable a planes pagos;
- no se encontraron scripts de pg_dump/export off-site en el repo;
- auth.audit_log_entries existe pero actualmente contiene 0 filas.

## 3. Remediaciones aplicadas en esta auditoría

### 3.1 audit_log append-only
Aplicado:
- anon: sin privilegios sobre audit_log;
- authenticated: SELECT únicamente, limitado además por RLS;
- service_role: SELECT únicamente;
- triggers DB bloquean UPDATE y DELETE;
- trigger DB bloquea TRUNCATE;
- índice UNIQUE parcial para hash_evento;
- CHECK de longitud SHA-256/HMAC (64 hex chars).

Esto reduce el riesgo de manipulación accidental o por credenciales service_role.

### 3.2 Cadena de auditoría v2
No se reescribieron los 590 registros históricos.

Se creó una nueva cadena v2 con:
- chain_version;
- chain_seq monotónico;
- event_time_utc (timestamptz);
- usuario_id (UUID Auth);
- usuario_rol capturado en el momento del evento;
- origen_evento;
- hash SHA-256 encadenado;
- serialización mediante advisory transaction lock.

Orígenes diferenciados:
- DB_TRIGGER: evidencia automática por cambio real de datos;
- SEMANTIC_RPC: evento contextual solicitado desde aplicación;
- SYSTEM_MIGRATION: evento del sistema/migración.

### 3.3 Checkpoint del legado
El primer evento v2 es CHAIN_V2_START.

Ese checkpoint guarda:
- cantidad total de eventos legacy;
- cantidad de eventos legacy hasheados;
- cantidad de bifurcaciones detectadas;
- SHA-256 determinístico del snapshot completo de los eventos legacy.

Objetivo: preservar la historia real, incluidas sus limitaciones, sin “arreglarla” reescribiendo evidencia.

Verificación posterior, realizada dos veces:
- filas legacy: 590;
- filas v2 iniciales: 1;
- snapshot legacy: OK;
- hashes v2 inválidos: 0;
- cortes de cadena v2: 0;
- campos obligatorios v2 faltantes: 0.

### 3.4 Cobertura automática ampliada
Ahora trg_audit_trail cubre también:
- controles_calidad
- mediciones
- controles_defectos
- recontroles
- recontrol_defectos
- mermas
- ordenes_maquina
- sesiones_calidad

Con las tablas ya cubiertas, el ciclo crítico queda auditado desde prueba/control hasta NC/recontrol/merma.

### 3.5 Verificación de integridad
Se creó audit_integrity_status(), accesible para admin/auditor, para comprobar:
- snapshot legacy;
- cantidad de eventos v2;
- hashes v2 inválidos;
- cortes de cadena;
- eventos firmados;
- momento UTC de verificación.

Un control de integridad deja de depender de revisión manual ad-hoc y pasa a poder comprobarse repetidamente.

## 4. Lectura frente a ISO 9001

### Información documentada / evidencia objetiva
Mejora fuerte:
- cambios críticos quedan asociados a actor, fecha, objeto y antes/después;
- los registros de Calidad/Recontrol ahora tienen evidencia automática;
- el log queda protegido contra modificación ordinaria.

### No conformidades
Mejora fuerte:
- NC, recontroles y merma tienen trazabilidad técnica;
- el cierre de una NC está protegido por reglas de rol en DB;
- los intentos de recontrol pueden abarcar varias jornadas sin perder continuidad.

### Seguimiento y medición
Gap operativo:
- existe infraestructura de calibraciones y la tabla está auditada;
- actualmente calibraciones contiene 0 registros.
Por lo tanto el sistema puede soportar evidencia de calibración, pero hoy no demuestra que el proceso de calibración haya sido ejecutado.

### Estado
El software aporta evidencia más sólida para auditoría de calidad, pero la conformidad ISO 9001 depende también de procedimientos, responsables, competencia, criterios de aceptación, registros reales y auditorías del SGC.

## 5. Lectura frente a ISO/IEC 27001

Áreas especialmente relacionadas con esta auditoría:
- logging de actividad relevante;
- protección de logs contra manipulación;
- monitoreo de actividad;
- sincronización de relojes;
- recopilación/preservación de evidencia;
- backup y recuperación.

### Logging
Mejora fuerte con cadena v2, actor UUID, rol, origen y cobertura automática.

### Protección contra manipulación
Mejora fuerte:
- append-only por privilegios;
- triggers anti UPDATE/DELETE/TRUNCATE;
- cadena de hashes;
- checkpoint del legado.

Limitación:
- un administrador de base con privilegios máximos sigue siendo un trust boundary. Para evidencia más fuerte se recomienda anclaje/export externo.

### Monitoring
Pendiente:
- no existe todavía alerta automática cuando audit_integrity_status() detecta una ruptura;
- no existe alerta centralizada de intentos fallidos, cambios de configuración o anomalías en logs de plataforma.

### Clock synchronization
Parcialmente cubierto:
- PostgreSQL está en UTC;
- v2 registra event_time_utc como timestamptz y usa clock_timestamp();
- los registros legacy conservan timestamps sin zona y no se reescriben.

### Authentication/security events
Pendiente:
- el audit log de aplicación puede registrar actividad autenticada;
- los intentos de autenticación fallidos dependen de los logs de Supabase;
- auth.audit_log_entries está vacío;
- en plan Free la retención de plataforma no es suficiente como archivo histórico de seguridad.

### Backup y preservación
Gap relevante:
- el proyecto está en plan Free;
- no se encontró un backup/export off-site automatizado;
- una cadena de auditoría dentro de la misma base no reemplaza un respaldo independiente.

## 6. Pendientes prioritarios

P1 — Respaldo fuera de Supabase
Definir y automatizar export diario de datos/audit_log a almacenamiento separado o migrar a un plan con backups adecuados. Probar restauración; un backup nunca probado es sólo una hipótesis.

P1 — Anclaje externo de integridad
Guardar periódicamente fuera de la base un hash/checkpoint de la cabeza de la cadena v2 (por ejemplo en almacenamiento de objetos separado). Esto reduce la posibilidad de que un actor con control total de la DB pueda reescribir datos y hashes sin dejar evidencia externa.

P1 — Monitoreo
Ejecutar audit_integrity_status() en forma programada y alertar sólo cuando:
- legacy_snapshot_ok=false;
- v2_invalid_hashes>0;
- v2_chain_breaks>0.

P2 — Política de retención
Definir por cuánto tiempo SIDES conserva:
- trazabilidad de producción/calidad;
- NC/recontroles;
- logs de seguridad;
- backups.
No implementar borrado automático hasta que esa decisión exista por escrito.

P2 — Eventos de autenticación
Definir cómo conservar intentos fallidos y eventos de seguridad más allá de la retención del plan Free.

P2 — Origen de conexión
ip_origen está vacío. Antes de empezar a guardar IP/device/user-agent debe existir una decisión de privacidad y retención; no se incorpora sólo “porque se puede”.

P2 — HMAC
La cadena v2 actualmente tiene SHA-256 pero no HMAC. HMAC no es requisito universal para certificación, pero puede aportar una capa adicional si la clave se almacena fuera del código y se administra correctamente.

P2 — Evidencia de calibración
Cargar y validar registros reales cuando el proceso formal de calibración/verificación sea definido por Calidad/Mantenimiento.

## 7. Decisiones de negocio todavía necesarias

Confirmado: SIDES S.A. está certificada contra ISO 9001:2026.

Pendientes:
1. ¿SIDES tiene certificación ISO/IEC 27001:2022, o este sistema sólo busca alineación con ese marco?
2. ¿Cuál es el plazo formal de conservación de registros de calidad/trazabilidad en SIDES? Si no existe, debe definirlo Calidad antes de crear una política automática de retención.

## 8. Regla de evidencia

Para auditoría se considera de mayor fuerza:
1. cambio real capturado como DB_TRIGGER;
2. registro asociado a actor Auth, objeto, estado anterior/nuevo y UTC;
3. evento incluido en cadena v2 íntegra;
4. checkpoint/anclaje externo y backup recuperable.

Los eventos SEMANTIC_RPC son contexto útil, pero no sustituyen la evidencia automática de una modificación real.
