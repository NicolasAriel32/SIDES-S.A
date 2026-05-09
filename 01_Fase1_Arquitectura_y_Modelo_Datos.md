# Sistema de Trazabilidad de Pruebas de Estanqueidad
## Fase 1 — Arquitectura General y Modelo de Datos en Airtable

**Documento de diseño técnico**
Versión 1.2 — 2026-04-27
Autor: Arquitectura de Sistemas
Estado: Cerrado con decisiones del cliente — base congelada para Fase 2
Alcance: 10 máquinas de prueba de estanqueidad de cabezales de soda

**Cambios v1.2 vs v1.1:**
- Política de contraseñas definida (rotación, complejidad, bloqueo).
- Turnos confirmados: MAÑANA 06-14, TARDE 14-22, NOCHE 22-06.
- Timeout de prueba PENDIENTE: 90 minutos antes de pasar a EN_REVISION.
- Password inicial: generada por admin, cambio obligatorio en primer login.
- Plazo de verificación de eficacia de NCs: 90 días.
- Backup: esquema dos tiers (Google Drive warm + Backblaze B2 cold).

**Cambios v1.1 vs v1.0:**
- PLC: payload confirmado JSON con `fecha`, `hora`, `maquina` (sin id_ciclo, sin presión, sin duración).
- Foto del contenedor: removida del alcance v1 a pedido del cliente.
- Auth: login propio (no SSO).
- Verificación física: tolerancia cero.
- Liberación de lote: rol Jefe de Calidad.
- Migración: arranque desde cero.
- Turno: derivado del timestamp (no se carga manualmente).

---

## 1. Objetivos del diseño

Este documento define la base técnica sobre la cual se construyen todas las fases siguientes (flujo N8N, interfaz del operario, roles, reportes y checklist ISO). Se diseñó para cumplir simultáneamente con:

- **ISO 9001** — registros inmutables, trazabilidad de inicio a fin, gestión de no conformidades, indicadores.
- **ISO 27001** — control de acceso por roles, log de auditoría, no eliminación, backups.
- **IRAM** — documentación auditable, identificación de responsables, trazabilidad de lote y caja.
- **Requisitos del informe gerencial** — captura desde PLC vía Hostinger, verificación física aleatoria, cadena de hash de integridad, no conformidades con causa raíz y acción correctiva. *Nota v1.1: el control anti-fraude por foto del contenedor mencionado en el informe gerencial fue removido del alcance v1 por decisión del cliente. El control anti-fraude queda exclusivamente sostenido por la verificación física aleatoria (sección 3.5). Se recomienda revisitar este punto antes de auditoría externa.*

Volumen objetivo: ~240 pruebas/día (10 máquinas × 8 pruebas/turno × 3 turnos), ~5.000 pruebas/mes, ~60.000 pruebas/año. Airtable Pro soporta este volumen holgadamente (50.000 registros por base; con archivado anual no se superan los límites).

---

## 2. Arquitectura general del sistema

### 2.1. Capas funcionales

El sistema se estructura en cinco capas, cada una con responsabilidad acotada y desacoplada de las demás:

**Capa 1 — Captura física (PLC + Hostinger).** Cada una de las 10 máquinas tiene un PLC que detecta el final de un ciclo de prueba (20 cabezales) y envía un archivo JSON a un endpoint en Hostinger. **Payload garantizado por el PLC (confirmado por el cliente):** `fecha`, `hora`, `maquina`. No se garantizan otros campos (presión, duración, id de ciclo). Esta capa no debe conocer Airtable ni N8N — es la fuente de verdad de "una prueba ocurrió físicamente". **Estado actual:** validado con una sola máquina; replicación a las 10 es parte del despliegue.

**Implicación de diseño:** sin un `id_ciclo` correlativo del PLC, la unicidad de cada prueba se establece por la combinación `(maquina, fecha, hora)` con resolución a segundo. Si en el futuro el PLC se extiende para enviar un correlativo, se incorpora sin romper compatibilidad.

**Capa 2 — Orquestación (N8N).** N8N es el sistema nervioso. Hace cuatro cosas: (a) recoge las señales de Hostinger y crea el registro `PENDIENTE` en Airtable; (b) recibe los datos del operario desde la interfaz y completa el registro; (c) calcula y verifica la cadena de hash de integridad; (d) ejecuta los flujos programados (verificación aleatoria por turno, backup nocturno, reportes diarios/semanales/mensuales). Toda la lógica de negocio vive acá, no en Airtable.

**Capa 3 — Persistencia (Airtable).** Airtable es la base de datos auditable. Almacena pruebas, fallas, no conformidades, lotes, cajas, usuarios, log de auditoría y la cadena de hash. No contiene lógica más allá de fórmulas simples y reglas de validación de campo. El acceso de escritura está restringido al usuario de servicio de N8N — ningún humano escribe directamente.

**Capa 4 — Interfaz de usuario.** Cuatro interfaces distintas:
- Interfaz del **operario** (PC fija por máquina): formulario web minimalista para completar el resultado de la prueba pendiente.
- Interfaz del **supervisor** (web responsive): cola de aprobación de fallas, verificaciones físicas asignadas, dashboard de turno.
- Interfaz del **jefe de calidad** (web responsive): liberación de lotes, revisión de no conformidades, indicadores globales.
- Interfaz del **administrador** (Airtable + dashboards): vista completa, reportes, gestión de usuarios, anulaciones.

La autenticación es propia: cada usuario tiene credenciales en la tabla `Usuarios` con contraseña hasheada (bcrypt o argon2). La sesión se gestiona en N8N con JWT firmado.

**Capa 5 — Reportes y backup.** Google Sheets recibe exportaciones automáticas para reportes históricos y para que la gerencia pueda manipular datos sin tocar la base. Backups encriptados se generan cada noche y se almacenan con retención de 7 años (requisito IRAM/ISO 9001 para registros de calidad).

### 2.2. Flujo de datos end-to-end

```
[PLC máquina] → JSON {fecha, hora, maquina} → [Hostinger]
        ↓ (N8N polling cada 30 s)
[N8N - Workflow "Captura Señal"]
        ├→ valida unicidad (maquina, fecha, hora)
        ├→ deriva turno desde la hora
        └→ crea registro
[Airtable - tabla Pruebas, estado=PENDIENTE]
        ↓ aparece en cola del operario
[Interfaz Operario] → completa: caja, lote, falla S/N, tipos, observaciones
        ↓ POST a webhook N8N
[N8N - Workflow "Cierre Operario"]
        ├→ valida campos obligatorios
        ├→ valida operario autorizado para esa máquina
        ├→ valida coherencia caja-lote
        ├→ calcula hash del registro
        ├→ encadena con hash anterior (hash chain)
        └→ actualiza Airtable estado=OK o RECHAZADO
                ↓ si RECHAZADO
        [N8N - Workflow "Crea No Conformidad"]
                ↓
        [Airtable - tabla NoConformidades] → aprobación supervisor
                ↓ supervisor cierra con causa raíz + acción correctiva
        [N8N - verifica eficacia a los N días]

[N8N - Workflow programado "Inicio de Turno"]
        ↓ cada 8 h
[Selecciona 2 pruebas aleatorias del turno anterior]
        ↓ asigna al supervisor
[Interfaz Supervisor] → confirma muestras físicas en almacén
        ↓
[Airtable - tabla VerificacionesFisicas]

[N8N - Workflow programado "Backup Nocturno"]
        ↓ cada noche 02:00
[Exporta Airtable + verifica hash chain + encripta + almacena]
        ↓
[Google Sheets reporting + Storage cifrado]
```

### 2.3. Decisiones arquitectónicas clave

**¿Por qué N8N como única vía de escritura a Airtable?** Porque garantiza que cada registro pase por el cálculo de hash chain antes de persistirse. Si los operarios escribieran directo en Airtable (o vía formulario nativo), podríamos saltarnos la cadena de integridad y comprometer ISO 27001.

**¿Por qué la PC del operario no escribe directo a Airtable?** Misma razón, más una segunda: la interfaz del operario debe poder operar en modo offline transitorio (caída de internet de minutos) y sincronizar después. N8N actúa como buffer/cola y reintenta.

**¿Por qué hash chain y no firma digital?** La firma digital requiere infraestructura de PKI que excede el stack disponible. La hash chain (cada registro incluye el hash SHA-256 del registro anterior) detecta cualquier modificación retroactiva sin certificados — suficiente para auditoría ISO 27001 en este contexto industrial. Si en el futuro se requiere firma criptográfica fuerte, se agrega sin rediseñar.

**¿Por qué Airtable y no PostgreSQL?** El cliente ya tiene N8N y prefiere bajo costo de mantenimiento. Airtable provee UI nativa, control de acceso, vistas filtradas y API REST — suficiente para el volumen previsto. La limitación es que no soporta triggers/restricciones complejas, por eso N8N hace ese trabajo.

**¿Por qué no eliminar nunca?** ISO 27001 + ISO 9001 exigen no-repudio. Toda anulación se registra como evento (tabla `Anulaciones`) con justificación y autor. La fila original queda intacta con flag `anulada=true`.

---

## 3. Modelo de datos en Airtable

### 3.1. Convenciones generales

- **IDs internos**: cada tabla tiene un `record_id` (autogenerado por Airtable) y un `id_humano` legible (ej: `PRB-2026-04-27-M03-014`) para mostrar en interfaces y reportes.
- **Timestamps**: dos campos en cada tabla transaccional: `creado_en` (auto) y `modificado_en` (auto). Las modificaciones también se loguean en `Auditoria`.
- **Soft delete**: nunca se borra. Campo `anulada` (checkbox) + relación a `Anulaciones`.
- **Campos calculados**: marcados con prefijo `calc_`.
- **Relaciones**: se anotan como `→ Tabla` (one-to-many desde la tabla origen) o `↔ Tabla` (many-to-many vía tabla puente).

### 3.2. Tablas maestras

#### Tabla `Maquinas`
Catálogo de las 10 máquinas. Casi estática, solo cambia si se agrega/retira una máquina.

| Campo | Tipo | Notas |
|---|---|---|
| `id_maquina` | Single line text | PK humana, ej: `M01`...`M10` |
| `nombre` | Single line text | Nombre interno o ubicación |
| `marca_modelo` | Single line text | Marca y modelo del equipo |
| `serie` | Single line text | Número de serie |
| `endpoint_hostinger` | URL | Path del que N8N lee la señal |
| `activa` | Checkbox | Si la máquina está operativa |
| `fecha_alta` | Date | Cuándo entró al sistema |
| `responsable_mantenimiento` | Link → `Usuarios` | Quién es responsable del equipo |

#### Tabla `Usuarios`
Operarios, supervisores y administradores. Sirve como registro de responsabilidad.

| Campo | Tipo | Notas |
|---|---|---|
| `id_usuario` | Single line text | PK humana, ej: `OP015` |
| `nombre_completo` | Single line text | |
| `email` | Email | Login |
| `legajo` | Single line text | Identificador interno RRHH |
| `rol` | Single select | `OPERARIO` / `SUPERVISOR` / `JEFE_CALIDAD` / `ADMINISTRADOR` / `AUDITOR` |
| `turno_habitual` | Single select | `MAÑANA` / `TARDE` / `NOCHE` / `ROTATIVO` |
| `maquinas_autorizadas` | Link → `Maquinas` | Operario solo puede cargar pruebas en estas |
| `activo` | Checkbox | |
| `fecha_alta` | Date | |
| `fecha_baja` | Date | Si el usuario se da de baja, no se elimina |
| `hash_password` | Long text | Hash bcrypt/argon2 — login propio gestionado por N8N |
| `password_actualizado_en` | Date with time | Para política de rotación de contraseñas |
| `password_temporal` | Checkbox | `true` cuando el admin la genera; obliga cambio en primer login |
| `intentos_fallidos` | Number | Bloqueo automático tras 5 intentos |
| `bloqueado_hasta` | Date with time | 15 minutos de bloqueo tras superar umbral |
| `ultimo_login` | Date with time | Para detectar cuentas inactivas |

**Política de contraseñas (confirmada con el cliente):**
- Longitud mínima: 8 caracteres con al menos una mayúscula, una minúscula y un número.
- Rotación cada 90 días para roles `SUPERVISOR`, `JEFE_CALIDAD` y `ADMINISTRADOR`. Operarios sin rotación obligatoria.
- Bloqueo automático tras 5 intentos fallidos consecutivos, por 15 minutos.
- **Onboarding:** el administrador genera la contraseña inicial, marca `password_temporal=true` y la entrega al usuario por canal seguro (presencial o email corporativo). En el primer login, N8N detecta el flag y fuerza al usuario a definir una contraseña nueva antes de habilitar el resto de la interfaz.
- Las contraseñas anteriores no se almacenan; solo se conserva el último hash.

#### Tabla `Turnos`
Definición de los turnos. Permite calcular indicadores por turno y asignar verificaciones.

| Campo | Tipo | Notas |
|---|---|---|
| `id_turno` | Single line text | `M`, `T`, `N` |
| `nombre` | Single line text | `MAÑANA` / `TARDE` / `NOCHE` |
| `hora_inicio` | Single line text | `06:00` |
| `hora_fin` | Single line text | `14:00` |
| `supervisor_default` | Link → `Usuarios` | Supervisor responsable del turno |

#### Tabla `TiposFalla`
Catálogo cerrado de tipos de falla detectables. Permite estadística normalizada (Pareto).

| Campo | Tipo | Notas |
|---|---|---|
| `codigo` | Single line text | `EST`, `GAT`, `SOL`, `PRE`, `ARO`, `OTR` |
| `descripcion` | Single line text | `Falla de estanqueidad`, `Marcado de gatillo defectuoso`, etc. |
| `criticidad` | Single select | `CRITICA` / `MAYOR` / `MENOR` |
| `requiere_aprobacion_supervisor` | Checkbox | Por defecto `true` |
| `accion_inmediata_sugerida` | Long text | Qué hacer cuando se detecta |
| `activo` | Checkbox | |

Carga inicial:
- `EST` — Falla de estanqueidad — CRITICA
- `GAT` — Marcado de gatillo defectuoso — MAYOR
- `SOL` — Soldado de tubo — CRITICA
- `PRE` — Precinto roto — MAYOR
- `ARO` — Aro deformado — MAYOR
- `OTR` — Otros (requiere observación obligatoria) — MENOR

#### Tabla `Lotes`
Lotes de producción. Un lote puede abarcar múltiples cajas y múltiples pruebas.

| Campo | Tipo | Notas |
|---|---|---|
| `numero_lote` | Single line text | PK humana, formato definido por producción |
| `fecha_produccion` | Date | |
| `producto` | Single line text | Modelo de cabezal |
| `cantidad_total` | Number | Cabezales producidos en el lote |
| `estado` | Single select | `EN_PRODUCCION` / `LIBERADO` / `RETENIDO` / `RECHAZADO` |
| `calc_pruebas` | Count | Cantidad de pruebas vinculadas |
| `calc_fallas` | Count rollup | Cantidad de pruebas RECHAZADAS |
| `calc_tasa_falla` | Formula | `calc_fallas / calc_pruebas` |
| `responsable_liberacion` | Link → `Usuarios` | Jefe de Calidad que aprueba liberar el lote |
| `fecha_liberacion` | Date with time | Cuándo se liberó |
| `comentario_liberacion` | Long text | Justificación, especialmente si se libera con NCs abiertas |

#### Tabla `Cajas`
Cajas individuales dentro de un lote. Cada caja contiene 336+ cabezales según el informe.

| Campo | Tipo | Notas |
|---|---|---|
| `numero_caja` | Single line text | PK humana |
| `lote` | Link → `Lotes` | |
| `fecha_armado` | Date | |
| `cantidad_cabezales` | Number | Default 336 |
| `estado` | Single select | `OK` / `RETENIDA` / `LIBERADA` / `RECHAZADA` |
| `prueba_asociada` | Link → `Pruebas` | Cuál prueba la representa |
| `ubicacion_almacen` | Single line text | Para verificación física |

### 3.3. Tabla central transaccional

#### Tabla `Pruebas` — núcleo del sistema
Cada fila es una prueba de estanqueidad sobre 20 cabezales. Es la tabla más sensible y la que más volumen acumula.

| Campo | Tipo | Notas |
|---|---|---|
| `id_prueba` | Formula | Calculado: `PRB-{año}-{mes}-{dia}-M{xx}-{secuencial}` |
| **— Datos automáticos del PLC (payload JSON) —** | | |
| `maquina` | Link → `Maquinas` | Mapeado desde el campo `maquina` del JSON |
| `timestamp_senal` | Date with time | Combinación de `fecha` + `hora` del JSON |
| `payload_plc_raw` | Long text | JSON original recibido (para auditoría y debugging) |
| **— Datos derivados —** | | |
| `calc_turno` | Formula | Derivado de `timestamp_senal`: `06:00-13:59` → MAÑANA, `14:00-21:59` → TARDE, `22:00-05:59` → NOCHE |
| `calc_fecha` | Formula | `DATETIME_FORMAT(timestamp_senal, 'YYYY-MM-DD')` para agrupaciones |
| **— Datos cargados por el operario —** | | |
| `operario` | Link → `Usuarios` | Quién cargó el resultado |
| `timestamp_carga` | Date with time | Cuándo se completó la carga |
| `caja` | Link → `Cajas` | |
| `lote` | Link → `Lotes` | (puede ser lookup desde caja) |
| `tuvo_falla` | Single select | `SI` / `NO` |
| `tipos_falla` | Link ↔ `TiposFalla` | Vacío si `tuvo_falla=NO`, ≥1 si `SI` |
| `cantidad_cabezales_fallados` | Number | De los 20, cuántos fallaron |
| `observaciones` | Long text | Opcional salvo si tipo=`OTR` |
| **— Estado y workflow —** | | |
| `estado` | Single select | `PENDIENTE` / `OK` / `RECHAZADO` / `EN_REVISION` / `ANULADA` |
| `aprobada_por_supervisor` | Link → `Usuarios` | Supervisor que aprobó (solo si RECHAZADO) |
| `timestamp_aprobacion` | Date with time | |
| `verificacion_fisica` | Link → `VerificacionesFisicas` | Si esta prueba fue auditada físicamente |
| **— No conformidad asociada —** | | |
| `no_conformidad` | Link → `NoConformidades` | Si RECHAZADO, link a su NC |
| **— Integridad criptográfica —** | | |
| `hash_registro` | Long text | SHA-256 del payload canónico |
| `hash_anterior` | Long text | hash del registro previo en la cadena |
| `hash_verificado_en` | Date with time | Última vez que se validó la cadena |
| **— Anulación —** | | |
| `anulada` | Checkbox | |
| `anulacion` | Link → `Anulaciones` | |
| **— Auditoría heredada —** | | |
| `creado_en` | Created time | |
| `creado_por` | Created by | (será siempre el user de servicio N8N) |
| `modificado_en` | Last modified time | |
| `modificado_por` | Last modified by | |

**Reglas de validación (aplicadas por N8N, no por Airtable):**
- Estado `PENDIENTE` solo si los campos del operario están vacíos.
- Para pasar a `OK`: `tuvo_falla=NO` + caja y lote informados.
- Para pasar a `RECHAZADO`: `tuvo_falla=SI` + ≥1 tipo de falla + supervisor aprobó.
- Si una prueba lleva más de **90 minutos** en estado `PENDIENTE` desde `timestamp_senal`, N8N la marca automáticamente como `EN_REVISION` y notifica al supervisor del turno. El operario aún puede completarla, pero queda visible en la cola de revisión hasta que el supervisor la cierre.
- Combinación `(maquina, timestamp_senal)` con resolución a segundo debe ser única — previene duplicados si el PLC o Hostinger reenvían la señal.
- Operario que carga debe tener la `maquina` en su lista `maquinas_autorizadas`.

### 3.4. Gestión de no conformidades (ISO 9001)

#### Tabla `NoConformidades`
Una NC se crea automáticamente cuando una prueba pasa a `RECHAZADO`. Sigue el ciclo de mejora continua.

| Campo | Tipo | Notas |
|---|---|---|
| `id_nc` | Formula | `NC-{año}-{secuencial}` |
| `prueba` | Link → `Pruebas` | |
| `fecha_apertura` | Date | Auto |
| `tipos_falla` | Lookup → `Pruebas.tipos_falla` | |
| `criticidad_max` | Lookup | Máxima criticidad de los tipos de falla |
| `estado` | Single select | `ABIERTA` / `EN_ANALISIS` / `ACCION_DEFINIDA` / `EN_VERIFICACION` / `CERRADA` / `RECHAZADA_POR_AUDITOR` |
| **— Análisis de causa raíz —** | | |
| `causa_raiz` | Long text | Obligatorio para cerrar |
| `metodo_analisis` | Single select | `5_PORQUE` / `ISHIKAWA` / `PARETO` / `OTRO` |
| `analizado_por` | Link → `Usuarios` | |
| `fecha_analisis` | Date | |
| **— Acción correctiva —** | | |
| `accion_correctiva` | Long text | |
| `responsable_accion` | Link → `Usuarios` | |
| `fecha_compromiso` | Date | |
| `fecha_implementacion` | Date | |
| **— Verificación de eficacia —** | | |
| `criterio_eficacia` | Long text | Cómo se va a medir si funcionó |
| `fecha_verificacion` | Date | |
| `verificado_por` | Link → `Usuarios` | |
| `eficacia_resultado` | Single select | `EFICAZ` / `INEFICAZ` / `PARCIAL` |
| `comentario_verificacion` | Long text | |
| **— Hash chain —** | | |
| `hash_registro` | Long text | |
| `hash_anterior` | Long text | |

**Workflow:** apertura automática → asignación a analista → análisis (5 porqués u otro) → definición de acción correctiva → implementación → verificación de eficacia a **90 días desde la fecha de implementación** → cierre o reapertura.

**Automatización del ciclo:** N8N ejecuta un workflow diario que (a) detecta NCs con `fecha_implementacion + 90 días <= hoy` y `estado != CERRADA`, (b) las pasa a `EN_VERIFICACION` y notifica al `verificado_por`, (c) si pasados 7 días más no hay verificación, escala al Jefe de Calidad. Esto evita que las NCs queden abiertas indefinidamente, hallazgo común en auditorías ISO 9001.

### 3.5. Verificación física aleatoria (anti-fraude)

#### Tabla `VerificacionesFisicas`
N8N selecciona aleatoriamente 2 pruebas del turno anterior al inicio de cada turno y crea una fila en esta tabla. El supervisor debe ir al almacén, ver físicamente las muestras y completar.

| Campo | Tipo | Notas |
|---|---|---|
| `id_verificacion` | Formula | `VF-{año}-{secuencial}` |
| `prueba` | Link → `Pruebas` | La prueba auditada |
| `turno_origen` | Link → `Turnos` | Turno donde se hizo la prueba |
| `fecha_seleccion` | Date with time | Cuándo el sistema la sorteó |
| `supervisor_asignado` | Link → `Usuarios` | |
| `fecha_verificacion` | Date with time | Cuándo el supervisor fue al almacén |
| `muestras_presentes` | Single select | `SI_TODAS` / `PARCIAL` / `NO` |
| `cantidad_encontrada` | Number | De los 20 cabezales declarados — debe ser exactamente 20 para `OK` |
| `coincide_etiqueta_lote` | Checkbox | Etiqueta del lote en el contenedor |
| `coincide_caja` | Checkbox | Número de caja coincide |
| `foto_almacen` | Attachment | Evidencia física tomada por el supervisor |
| `observaciones` | Long text | |
| `resultado` | Formula | `OK` solo si: `muestras_presentes=SI_TODAS` AND `cantidad_encontrada=20` AND `coincide_etiqueta_lote=true` AND `coincide_caja=true`. Cualquier otra combinación → `DISCREPANCIA` |
| `genera_nc` | Checkbox | Si `DISCREPANCIA`, dispara NC automática |

**Política de tolerancia: CERO.** Cualquier desvío (un cabezal de menos, etiqueta dañada, caja confundida) se registra como `DISCREPANCIA` y dispara una no conformidad automática contra el operario y la prueba original. Esta política fue confirmada por el cliente y es lo que sostiene el control anti-fraude en ausencia de la foto del contenedor.

### 3.6. Auditoría e integridad (ISO 27001)

#### Tabla `Auditoria`
Log de cada modificación a cualquier registro del sistema. Append-only.

| Campo | Tipo | Notas |
|---|---|---|
| `id_evento` | Formula | `AUD-{timestamp}-{secuencial}` |
| `timestamp` | Date with time | |
| `usuario` | Link → `Usuarios` | Quién hizo la acción |
| `accion` | Single select | `CREAR` / `MODIFICAR` / `ANULAR` / `LOGIN` / `LOGOUT` / `EXPORTAR` / `BACKUP` |
| `tabla_afectada` | Single line text | |
| `registro_id` | Single line text | record_id de Airtable |
| `campo_modificado` | Single line text | (vacío si CREAR) |
| `valor_anterior` | Long text | |
| `valor_nuevo` | Long text | |
| `ip_origen` | Single line text | |
| `user_agent` | Single line text | |
| `hash_evento` | Long text | Hash del evento |
| `hash_anterior` | Long text | Cadena de integridad del log |

**Importante:** Airtable no permite truly append-only por design. La protección viene de: (a) solo el usuario de servicio N8N puede escribir; (b) hash chain hace detectable cualquier alteración retroactiva; (c) backup nocturno encriptado preserva el estado histórico.

#### Tabla `Anulaciones`
Cuando un registro se "borra", en realidad se anula. Esta tabla guarda la justificación.

| Campo | Tipo | Notas |
|---|---|---|
| `id_anulacion` | Formula | `ANU-{año}-{secuencial}` |
| `tabla_origen` | Single select | `Pruebas` / `NoConformidades` / etc. |
| `registro_anulado` | Single line text | record_id |
| `solicitada_por` | Link → `Usuarios` | |
| `aprobada_por` | Link → `Usuarios` | (debe ser ADMINISTRADOR) |
| `fecha_solicitud` | Date with time | |
| `fecha_aprobacion` | Date with time | |
| `motivo` | Long text | Obligatorio, mínimo 50 caracteres |
| `evidencia` | Attachment | Documento que respalda la anulación |

#### Tabla `HashChain`
Cabecera de la cadena de hash. Cada noche el backup verifica integridad recorriendo esta cadena.

| Campo | Tipo | Notas |
|---|---|---|
| `secuencia` | Autonumber | Orden estricto |
| `tabla` | Single line text | A qué tabla pertenece este eslabón |
| `registro_id` | Single line text | |
| `hash` | Long text | SHA-256 del registro |
| `hash_anterior` | Long text | |
| `timestamp` | Date with time | |
| `verificada_ultima_vez` | Date with time | Cuándo el backup la validó |

#### Tabla `Backups`
Registro de backups ejecutados.

| Campo | Tipo | Notas |
|---|---|---|
| `id_backup` | Formula | `BKP-{tier}-{fecha}` |
| `tier` | Single select | `WARM_GDRIVE` / `COLD_B2` |
| `fecha_ejecucion` | Date with time | |
| `estado` | Single select | `OK` / `FALLIDO` / `INTEGRIDAD_COMPROMETIDA` |
| `cantidad_registros` | Number | |
| `hash_global` | Long text | SHA-256 del payload del backup |
| `tamaño_mb` | Number | |
| `ubicacion` | URL | Path en Google Drive o B2 |
| `cifrado` | Checkbox | AES-256, clave en N8N (no en el destino) |
| `verificacion_chain_ok` | Checkbox | Si la cadena de hash de Airtable se validó pre-backup |
| `observaciones` | Long text | |
| `disparado_por` | Single select | `AUTOMATICO_NOCTURNO` / `AUTOMATICO_SEMANAL` / `MANUAL` |

**Esquema dos tiers (decisión confirmada):**

- **Tier 1 — Warm (Google Drive en Google Workspace):** ejecutado por N8N cada noche a las 02:00. Genera ZIP con el dump completo de Airtable (tablas + adjuntos), cifra con AES-256, sube a una carpeta versionada en Drive. Retención: 30 días en línea, luego se reemplaza por el más reciente. Restore: minutos. Aprovecha la cuenta de Google ya usada para reportes en Sheets.
- **Tier 2 — Cold (Backblaze B2):** ejecutado los domingos. N8N toma el ZIP del último backup warm y lo replica a un bucket B2 con object lock activado (write-once, no se puede sobrescribir ni borrar antes de la fecha de retención). Retención: 7 años. Costo estimado: ~USD 0,005/GB/mes.

**Clave de cifrado:** AES-256 con clave maestra almacenada únicamente en variables de entorno del servidor de N8N. La clave NO se sube nunca a Drive ni a B2. Procedimiento de rotación de clave: cada 12 meses; los backups previos quedan accesibles con la clave anterior, archivada en un sobre cerrado en la sede física (procedimiento IRAM clásico de gestión de claves).

**Verificación de integridad:** antes de generar cada backup, N8N recorre la cadena de hash completa de la tabla `Pruebas` y verifica que cada eslabón coincida. Si falla, marca `estado=INTEGRIDAD_COMPROMETIDA`, alerta al administrador y NO sobrescribe el backup anterior.

### 3.7. Diagrama de relaciones (resumen)

```
Maquinas ─┬─< Pruebas >─┬─→ Cajas ─→ Lotes
          │             │
          │             ├─→ Usuarios (operario, supervisor)
          │             ├─↔ TiposFalla
          │             ├─→ NoConformidades ─→ Usuarios (analista, responsable, verificador)
          │             ├─→ VerificacionesFisicas ─→ Turnos
          │             ├─→ Anulaciones ─→ Usuarios
          │             └─→ HashChain
          │
          └─→ Usuarios (responsable mantenimiento)

Auditoria (todas las tablas) ─→ Usuarios
Backups (referencia HashChain global)
Turnos ─→ Usuarios (supervisor default)
```

---

## 4. Vistas en Airtable (preconfiguración)

Cada tabla principal tendrá vistas filtradas que las distintas interfaces consumen vía API. Esto reemplaza la necesidad de queries complejas.

**Tabla `Pruebas`:**
- `Cola Operario M{xx}` — una vista por máquina, filtra `estado=PENDIENTE` y `maquina={xx}`. Es lo que consume la PC del operario.
- `Aprobaciones Pendientes Supervisor` — `estado=RECHAZADO` y `aprobada_por_supervisor=vacío`.
- `En Revisión` — `estado=EN_REVISION` (pendientes de turno anterior).
- `Hoy` — pruebas del día actual, ordenadas por máquina y hora.
- `Histórico Anulado` — solo `anulada=true`.

**Tabla `NoConformidades`:**
- `Abiertas` — `estado IN [ABIERTA, EN_ANALISIS, ACCION_DEFINIDA, EN_VERIFICACION]`.
- `Vencidas` — `fecha_compromiso < hoy` y no cerradas.
- `Cerradas año actual` — para reportes.

**Tabla `VerificacionesFisicas`:**
- `Pendientes turno actual` — sin completar.
- `Discrepancias` — `resultado=DISCREPANCIA`.

---

## 5. Reglas de integridad y consistencia

Las siguientes reglas se implementan en N8N (Airtable no las puede garantizar nativamente):

1. **Unicidad de prueba por máquina:** combinación `(maquina, timestamp_senal)` con resolución a segundo debe ser única. Si el PLC o Hostinger reenvían la señal, N8N detecta y descarta el duplicado.
2. **Lote-Caja consistencia:** la caja referenciada debe pertenecer al lote referenciado.
3. **Operario autorizado:** el operario que carga debe tener la máquina en `maquinas_autorizadas`.
4. **Supervisor obligatorio para fallas:** una prueba `RECHAZADO` no se cierra sin `aprobada_por_supervisor`.
5. **NC obligatoria para rechazos:** al pasar a `RECHAZADO`, automáticamente se crea `NoConformidades`.
6. **Liberación de lote restringida a Jefe de Calidad:** solo usuarios con `rol=JEFE_CALIDAD` pueden marcar `Lotes.estado=LIBERADO`.
7. **Hash chain inviolable:** al insertar/modificar, N8N recalcula el hash; en backup se verifica que la cadena entera sea coherente.
8. **Anulación con doble firma:** solicitada por usuario, aprobada por administrador diferente.
9. **Verificación física inviolable:** una prueba marcada para verificación no puede modificarse hasta que la verificación se complete.
10. **No edición retroactiva post-aprobación:** una vez una prueba pasa a `OK` o una NC se cierra, solo el rol `ADMINISTRADOR` puede modificar y solo vía proceso de anulación.
11. **Tolerancia cero en verificación física:** cualquier desvío genera `DISCREPANCIA` automática.

---

## 6. Capacidad y escalabilidad

| Métrica | Valor estimado año 1 | Holgura Airtable Pro |
|---|---|---|
| Pruebas | ~60.000 | 50.000 por base → archivado anual a base histórica |
| No conformidades | ~3.000 (asumiendo 5% rechazo) | sin problema |
| Verificaciones físicas | ~2.190 (2 × 3 turnos × 365 días) | sin problema |
| Eventos auditoría | ~600.000 | requiere base separada `Auditoria_2026` |
| Adjuntos (fotos almacén supervisor) | ~2.190 × 300 KB ≈ 660 MB | sin problema, holgura amplia |

*Nota: el cálculo de adjuntos cambió respecto a v1.0 al removerse la foto del contenedor por parte del operario. Solo el supervisor toma fotos durante la verificación física aleatoria.*

**Plan de archivado:** N8N ejecuta el 1° de cada año un workflow que mueve registros del año cerrado a una base `Historico_{año}` y mantiene la base operativa liviana. La base histórica conserva la cadena de hash anclada por hash de cierre de año.

---

## 7. Próximos pasos

Una vez aprobada esta Fase 1, las siguientes fases son:

- **Fase 2** — Diseño detallado del flujo N8N (workflows, nodos, lógica de hash chain, manejo de errores).
- **Fase 3** — Diseño de la interfaz del operario (campos, validaciones, mockups).
- **Fase 4** — Lógica de roles y permisos (matriz de permisos, integración con Airtable shares + filtros por vista).
- **Fase 5** — Plan de reportes (KPIs, dashboards, exportación a Google Sheets, formato auditable).
- **Fase 6** — Checklist de cumplimiento ISO 9001 / 27001 / IRAM con mapeo a evidencia generada por el sistema.
- **Fase 7** — Plan de implementación (10 semanas, hitos, capacitación, criterios de aceptación).

---

## 8. Decisiones registradas y puntos abiertos

### 8.1. Decisiones tomadas (input del cliente, 2026-04-27)

| Punto | Decisión |
|---|---|
| Formato del archivo PLC | JSON con `fecha`, `hora`, `maquina` (sin id de ciclo, sin presión, sin duración) |
| Estado de validación PLC | Probado con una máquina; replicar a las 9 restantes en el despliegue |
| Foto del contenedor | Removida del alcance v1 — el control anti-fraude queda solo en la verificación física |
| Modelo de autenticación | Login propio (no SSO), gestionado por N8N con JWT |
| Tolerancia en verificación física | Cero — cualquier desvío genera DISCREPANCIA |
| Liberación de lote | Rol JEFE_CALIDAD |
| Migración de datos | Arranque desde cero |
| Turno | Derivado del timestamp por fórmula, no se carga manualmente |

### 8.2. Riesgos asumidos por el cliente

- **Pérdida de control anti-fraude por foto:** el informe gerencial planteaba la foto como mecanismo principal anti-fraude. Al removerla, el control descansa exclusivamente en la verificación física aleatoria (2 muestras por turno, ~0,8% de cobertura sobre el universo). Esto es defendible ante auditoría siempre que la verificación se ejecute con disciplina y sus resultados sean trazables.
- **PLC con payload mínimo:** sin id de ciclo del PLC, dependemos del timestamp para unicidad. Si dos pruebas distintas llegan con el mismo segundo (improbable pero posible), N8N las trata como duplicado. La probabilidad real es muy baja con 240 pruebas/día distribuidas en 10 máquinas, pero conviene tenerlo registrado.

### 8.3. Decisiones de cierre de Fase 1 (input cliente, 2026-04-27)

| # | Punto | Decisión |
|---|---|---|
| 1 | Política de contraseñas | ≥8 caracteres con mayús+minús+número; rotación cada 90 días para SUPERVISOR/JEFE_CALIDAD/ADMINISTRADOR (operarios sin rotación obligatoria); bloqueo 15 min tras 5 intentos fallidos |
| 2 | Horarios de turno | MAÑANA 06:00–14:00, TARDE 14:00–22:00, NOCHE 22:00–06:00 |
| 3 | Timeout de prueba PENDIENTE | 90 minutos desde `timestamp_senal` antes de pasar a EN_REVISION + notificación al supervisor |
| 4 | Onboarding de password | Admin genera password inicial con flag `password_temporal=true`; usuario la cambia obligatoriamente en primer login |
| 5 | Verificación de eficacia NC | 90 días desde `fecha_implementacion` |
| 6 | Almacenamiento de backup | Dos tiers: Tier 1 Google Drive (warm, retención 30 días, restore en minutos) + Tier 2 Backblaze B2 (cold, retención 7 años, object lock, ~USD 0,005/GB/mes) |

### 8.4. Estado de Fase 1

**Cerrada.** Todas las decisiones de arquitectura y modelo de datos fueron validadas con el cliente. La base está lista para servir de fundamento a:
- Fase 2 — Diseño detallado del flujo N8N
- Fase 3 — Diseño de la interfaz del operario
- Fase 4 — Lógica de roles y permisos
- Fase 5 — Plan de reportes
- Fase 6 — Checklist ISO 9001 / 27001 / IRAM
- Fase 7 — Plan de implementación

Cualquier cambio posterior a esta versión debe versionarse explícitamente y ser propagado a las fases subsiguientes que ya estén cerradas.
