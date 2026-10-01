# Constitución del proyecto — SIDES S.A.

> Fuente persistente de intención, reglas de negocio e invariantes del sistema de trazabilidad.
> Última actualización: 2026-10-01.

## 1. Propósito

El sistema debe registrar y hacer trazables las pruebas de estanqueidad, los controles de calidad, las no conformidades y sus recontroles, preservando quién hizo qué, cuándo, sobre qué material y bajo qué estado.

Esta Constitución expresa **qué debe ser verdad en el sistema**. Si una pantalla, función, migración o documento contradice estas reglas, la implementación debe revisarse: la contradicción no se resuelve inventando una nueva regla.

## 1.1 Base normativa confirmada

- Dato de negocio confirmado por Nicolás el 2026-10-01: SIDES S.A. está certificada contra **ISO 9001:2026**.
- Dato de negocio confirmado por Nicolás el 2026-10-01: SIDES S.A. está certificada contra **ISO/IEC 27001:2022**.
- Las decisiones de trazabilidad, registros, no conformidades, medición, evidencia y auditoría del sistema deben evaluarse contra ISO 9001:2026 como baseline de calidad.
- Las decisiones de acceso, logging, monitoreo, integridad, respaldo y preservación de evidencia deben evaluarse contra ISO/IEC 27001:2022 como baseline de seguridad de la información.
- Las referencias anteriores a ISO 9001:2015 quedan como contexto histórico y no como baseline vigente del proyecto.

## 2. Principios globales

1. **Las reglas críticas viven en infraestructura, no sólo en la UI.** Roles, permisos, identidad, validaciones y transiciones sensibles deben controlarse en Supabase/PostgreSQL además del frontend.
2. **El cliente no es una fuente confiable de identidad.** El actor de una acción sensible se deriva de la sesión autenticada (`auth.uid()`).
3. **Mínimo privilegio.** Cada rol accede sólo a las capacidades necesarias para su trabajo.
4. **Trazabilidad antes que conveniencia.** Los registros históricos no se reescriben para “hacerlos quedar bien”. Los errores se corrigen hacia adelante y se documentan.
5. **Las reglas de negocio críticas deben ser verificables.** Deben poder probarse mediante RLS, funciones, constraints, triggers o pruebas de aceptación.
6. **Una conversación no es memoria del proyecto.** Las decisiones que cambian comportamiento deben quedar versionadas en este archivo o en una spec relacionada.

## 3. Roles

### Operario
- Registra el trabajo operativo autorizado.
- Puede registrar recontroles.
- Puede ver **todos los rechazos pendientes generados por Control de Calidad**, sin filtrar por máquina.
- No puede registrar controles de calidad.
- No puede cerrar una No Conformidad.

### Supervisor
- Puede registrar recontroles.
- Puede ver todos los rechazos pendientes generados por Control de Calidad.
- Puede gestionar y cerrar No Conformidades.
- No registra controles de calidad salvo que además posea rol de inspector; el rol `supervisor` por sí solo no habilita esa acción.

### Inspector
- Es el único rol autorizado para registrar un **Control de Calidad**.
- Puede registrar recontroles.
- Puede ver todos los rechazos pendientes de Calidad.
- Puede cerrar No Conformidades.

### Admin
- Administra configuración, usuarios y asignaciones autorizadas.
- El rol admin **no reemplaza automáticamente** a los roles operativos para acciones reguladas por proceso.
- No puede cerrar una NC sólo por ser admin: el cierre definitivo corresponde a supervisor o inspector.

### Auditor
- Lectura y evidencia.
- No modifica registros operativos.

## 4. Control de Calidad

1. Sólo un usuario activo con rol `inspector` puede registrar un control de calidad.
2. La identidad del inspector se obtiene de la sesión autenticada; el navegador no puede elegir ni enviar una identidad confiable distinta.
3. Un control no conforme puede originar una No Conformidad de Calidad.
4. Las NC originadas en Calidad deben conservar su vínculo con el control que las generó.

## 5. Recontrol de rechazos

### 5.1 Quién puede hacerlo

Pueden registrar recontroles:
- `operario`
- `supervisor`
- `inspector`

El usuario debe estar activo.

### 5.2 Visibilidad de la cola

Los tres roles anteriores ven **todos los rechazos pendientes generados por Control de Calidad**, independientemente de la máquina asignada.

Esta visibilidad especial no implica acceso general a todas las tablas o al historial completo de Calidad.

### 5.3 Registro por jornada/turno

Cada intento de recontrol registra **la cantidad realmente reinspeccionada durante esa jornada/turno**, no el total del rechazo ni un acumulado escrito manualmente.

Ejemplo:

- Objetivo original: 2.016 cabezales.
- Jornada 1: 600 recontrolados.
- Jornada 2: 800 recontrolados.
- Jornada 3: 616 recontrolados.
- Acumulado final: 2.016.

El sistema calcula automáticamente:
- objetivo total;
- acumulado ya recontrolado;
- cantidad pendiente;
- recuperados de la jornada;
- descartados de la jornada;
- merma de la jornada;
- resultado de la jornada.

### 5.4 Invariantes cuantitativos

1. `recontrolados_jornada > 0`.
2. `descartados_jornada >= 0`.
3. `descartados_jornada <= recontrolados_jornada`.
4. El acumulado no puede superar el objetivo original.
5. Recuperados de la jornada = recontrolados de la jornada − descartados de la jornada.
6. Merma de la jornada = descartados × 0,0184 kg.
7. El objetivo actual se deriva del rechazo original: `cantidad_rechazo × 336` cabezales.

Si en el futuro cambia la cantidad de cabezales por caja según producto, esta regla debe cambiar primero en la spec/Constitución antes de modificar la implementación.

## 6. Recontrol definitivo y cierre de NC

1. Un recontrol puede extenderse durante varias jornadas y generar múltiples intentos.
2. El campo **“Recontrol terminado”** debe iniciar desactivado.
3. Un intento sólo puede marcarse como definitivo cuando el acumulado alcanza exactamente el objetivo total.
4. Una vez registrado un recontrol definitivo no se admiten nuevos intentos, salvo que exista un flujo explícito de anulación/corrección aprobado.
5. Marcar el recontrol como definitivo **NO cierra la No Conformidad**.
6. La NC permanece en `EN ANALISIS` hasta la decisión de cierre.
7. Sólo un usuario activo con rol `supervisor` o `inspector` puede pasar la NC a `CERRADA`.
8. Para una NC originada en Control de Calidad debe existir al menos un recontrol definitivo no anulado antes del cierre.
9. La identidad de quien cierra se deriva de la sesión autenticada; no se escribe manualmente desde el navegador.
10. El cierre requiere causa raíz.

## 7. Identidad y altas de usuarios

1. No existe una contraseña inicial universal.
2. Al crear o resetear una cuenta, el administrador genera una contraseña temporal aleatoria y distinta por usuario.
3. La contraseña temporal se muestra una sola vez al administrador.
4. Debe tener al menos 12 caracteres.
5. El usuario queda obligado a cambiarla en el primer ingreso.
6. Las contraseñas viven en Supabase Auth; no se guardan en la tabla `usuarios`.
7. Un usuario no puede modificar directamente su propia fila para cambiar rol, estado o máquina asignada.
8. Las acciones administrativas sensibles deben validar en servidor que el actor sea un admin activo.

## 8. Datos sensibles y repositorio

1. No versionar archivos `.env` reales.
2. No versionar listados de usuarios reales, correos o datos personales que no sean necesarios para el código.
3. Usar archivos `.example` saneados para documentar configuración.
4. No incorporar `service_role`, claves privadas ni secretos equivalentes al frontend.
5. Los archivos eliminados de `main` pueden seguir existiendo en el historial Git; la limpieza del historial o la privacidad del repositorio se tratan como controles separados.

## 9. Auditoría e integridad

1. Los eventos relevantes deben quedar registrados con actor, acción, entidad afectada y momento.
2. Los registros históricos no deben eliminarse para corregir inconsistencias; se anulan o se corrigen con trazabilidad cuando exista un flujo definido.
3. La cadena criptográfica del `audit_log` está en revisión: se detectaron bifurcaciones históricas y la solución debe preservar la evidencia existente.
4. No se considera resuelto un control de integridad hasta que exista una prueba que demuestre su comportamiento.



## 9.1 Reglas canónicas de auditoría

1. `audit_log` es append-only: la aplicación, usuarios autenticados y `service_role` no modifican ni eliminan eventos existentes.
2. Los cambios reales en entidades críticas deben generar evidencia automática con origen `DB_TRIGGER`; un evento solicitado por el frontend se marca `SEMANTIC_RPC` y no sustituye esa evidencia.
3. Los eventos nuevos usan cadena v2 con `chain_seq`, `event_time_utc`, UUID del actor, rol capturado al momento del evento y SHA-256 encadenado.
4. Los 590 registros legacy no se reescriben. Su estado quedó anclado por el checkpoint `CHAIN_V2_START`.
5. Control de Calidad, mediciones, defectos, recontroles, mermas, órdenes y sesiones de Calidad deben estar incluidos en auditoría automática.
6. Toda evidencia temporal nueva se registra explícitamente en UTC. Las marcas históricas sin zona se conservan como legado.
7. La integridad debe ser verificable de forma repetible; `audit_integrity_status()` es el control técnico actual para admin/auditor.
8. Una cadena dentro de la misma base no reemplaza backup ni evidencia externa. Antes de considerar el esquema maduro para auditoría formal debe existir una política de retención, respaldo recuperable y un mecanismo de monitoreo/alerta.

## 10. Regla de cambio

Cuando cambie una regla de negocio:

**DECISIÓN HUMANA → ACTUALIZAR CONSTITUCIÓN/SPEC → ANALIZAR DEPENDENCIAS → CAMBIAR DB/CÓDIGO/TESTS → VERIFICAR → DOCUMENTAR RESULTADO**

No se debe parchear primero el código y decidir después cuál era la regla.

## 11. Estado conocido / excepciones históricas

Existen registros históricos creados bajo comportamientos anteriores. Por ejemplo, se detectó al menos un caso donde distintos intentos de recontrol registraron nuevamente el total completo y el acumulado histórico supera el objetivo original.

Esos registros **no deben modificarse automáticamente**. Primero deben clasificarse como demo/prueba o dato operativo real y luego definir el tratamiento con trazabilidad.

## 12. Relación con otros documentos

- `SECURITY_AUDIT_2026-10-01.md`: hallazgos, mitigaciones aplicadas y riesgos pendientes.
- `sql/`: evidencia versionada de cambios y migraciones.
- Specs futuras: describen requisitos y criterios de aceptación de features concretas.
- Esta Constitución: principios e invariantes globales que aplican a múltiples features.
