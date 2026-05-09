# Sistema de Trazabilidad de Pruebas de Estanqueidad
## Fase 2 — Flujo detallado de N8N

**Documento de diseño técnico**
Versión 1.0 — 2026-04-27
Autor: Arquitectura de Sistemas
Estado: Borrador para revisión
Depende de: Fase 1 v1.2 (arquitectura y modelo de datos)

---

## 1. Alcance y principios de diseño

Esta fase define cada uno de los workflows que vivirán en N8N. N8N es la **única vía de escritura a Airtable** (decisión arquitectónica de Fase 1) y el orquestador de toda la lógica de negocio: captura de señal del PLC, validación de cargas, cálculo de hash chain, auditoría, verificación física, no conformidades, backups y reportes.

### 1.1. Principios

**Idempotencia.** Todo workflow debe poder ejecutarse dos veces sobre el mismo input sin producir efectos duplicados. Esto se logra con claves de unicidad en Airtable (ej: `(maquina, timestamp_senal)` para Pruebas) y con verificación previa antes de insertar.

**Atomicidad lógica por workflow.** Cada workflow tiene una única responsabilidad. Si una operación requiere varios pasos (ej: rechazar prueba + crear NC + auditar), se hacen en el mismo workflow con manejo explícito de rollback simulado. Airtable no soporta transacciones, por eso el rollback es lógico (compensación, no rollback real).

**Auditoría obligatoria.** Cualquier escritura a Airtable pasa por un sub-workflow `WF-AUX-Auditoria` que registra el evento en la tabla `Auditoria` antes o después del cambio principal. Si la auditoría falla, el cambio principal se compensa.

**Hash chain inviolable.** Toda inserción o modificación a tablas auditables (Pruebas, NoConformidades, VerificacionesFisicas, Auditoria) recalcula y encadena el hash. Existe un sub-workflow `WF-AUX-HashChain` que centraliza esta lógica.

**Manejo de errores explícito.** N8N tiene un workflow de error global (`WF-ERR-Global`) configurado en cada workflow vía la opción "Error Workflow". Cuando algo falla, ese workflow registra el incidente, notifica al administrador y, si corresponde, encola para reintentar.

**Sin lógica en Airtable.** Airtable solo tiene fórmulas simples y vistas filtradas. Cualquier cálculo, validación cruzada o disparador automático se implementa en N8N.

**Credenciales centralizadas.** Todas las credenciales (Airtable PAT, Google Drive OAuth, B2 keys, SMTP) viven en el credential manager de N8N. Ningún workflow tiene secretos hardcodeados.

### 1.2. Convenciones

**Naming:** `WF-XX-Nombre` donde XX es el código numérico. Subworkflows reutilizables: `WF-AUX-Nombre`. Workflows de error: `WF-ERR-Nombre`.

**Tags en N8N:** cada workflow se taguea con `prod` o `dev` y con la fase a la que pertenece (`captura`, `cierre`, `nc`, `backup`, etc.).

**Variables de entorno:** prefijo `STKZ_` (de "estanqueidad").
- `STKZ_AIRTABLE_PAT` — token Airtable
- `STKZ_AIRTABLE_BASE_ID` — base operativa
- `STKZ_HOSTINGER_API_URL` — endpoint de señales del PLC
- `STKZ_HOSTINGER_TOKEN` — auth contra Hostinger
- `STKZ_BACKUP_AES_KEY` — clave maestra de cifrado de backups
- `STKZ_GDRIVE_FOLDER_ID` — carpeta destino de backups warm
- `STKZ_B2_BUCKET` — bucket de B2 para backups cold
- `STKZ_JWT_SECRET` — firma de JWT de sesiones
- `STKZ_SMTP_*` — credenciales para notificaciones por email

**Credenciales N8N necesarias:**
- Airtable Personal Access Token con scopes `data.records:read`, `data.records:write`, `schema.bases:read`
- Google Drive OAuth2 (cuenta de servicio recomendada para evitar refresh manual)
- Backblaze B2 Application Key (S3-compatible)
- SMTP (servidor saliente para notificaciones)

---

## 2. Catálogo de workflows

| # | Workflow | Disparador | Frecuencia |
|---|---|---|---|
| WF-01 | Captura de Señal del PLC | Schedule Trigger | Cada 30 s |
| WF-02 | Cierre por Operario | Webhook | On demand |
| WF-03 | Aprobación de Falla por Supervisor | Webhook | On demand |
| WF-04 | Timeout de Pruebas Pendientes | Schedule Trigger | Cada 5 min |
| WF-05 | Selección Aleatoria de Verificación Física | Schedule Trigger | 06:00, 14:00, 22:00 |
| WF-06 | Cierre de Verificación Física | Webhook | On demand |
| WF-07 | Verificación de Eficacia de NCs | Schedule Trigger | Diario 08:00 |
| WF-08 | Login y Gestión de Sesión | Webhook | On demand |
| WF-09 | Cambio de Contraseña | Webhook | On demand |
| WF-10 | Backup Warm Nocturno | Schedule Trigger | Diario 02:00 |
| WF-11 | Backup Cold Semanal | Schedule Trigger | Domingos 03:00 |
| WF-12 | Liberación de Lote | Webhook | On demand |
| WF-13 | Anulación con Doble Firma | Webhook | On demand |
| WF-14 | Generación de Reportes | Schedule Trigger | Diario 06:00 + semanal + mensual |
| WF-15 | Archivado Anual | Schedule Trigger | 1 de enero 04:00 |
| WF-AUX-HashChain | Sub-workflow | Llamado por otros | — |
| WF-AUX-Auditoria | Sub-workflow | Llamado por otros | — |
| WF-AUX-Notificacion | Sub-workflow | Llamado por otros | — |
| WF-ERR-Global | Error Workflow | Cualquier fallo | — |

---

## 3. Workflows transaccionales (núcleo del sistema)

### 3.1. WF-01 — Captura de Señal del PLC

**Objetivo:** detectar nuevas señales emitidas por los PLCs en Hostinger e insertar el registro inicial en Airtable con estado `PENDIENTE`.

**Disparador:** Schedule Trigger cada 30 segundos.

**Nodos:**

1. **Schedule Trigger** — cada 30 s.
2. **HTTP Request → Hostinger** — `GET {STKZ_HOSTINGER_API_URL}/signals/pending`. Headers: `Authorization: Bearer {STKZ_HOSTINGER_TOKEN}`. Devuelve array de señales no procesadas en formato `[{id, fecha, hora, maquina}, ...]`.
3. **IF** — si el array está vacío, terminar.
4. **Split In Batches** — procesa una señal a la vez para mantener idempotencia.
5. **Function "Build Pruebas Record"** — construye el payload Airtable:
   ```javascript
   const senal = $input.item.json;
   const timestamp_senal = new Date(`${senal.fecha}T${senal.hora}`).toISOString();
   return {
     timestamp_senal,
     maquina_codigo: senal.maquina,
     payload_plc_raw: JSON.stringify(senal),
     estado: 'PENDIENTE',
     senal_id_externo: senal.id  // para acuse a Hostinger
   };
   ```
6. **Airtable "Search Maquinas"** — busca el record_id de la máquina por `id_maquina = senal.maquina`. Si no existe, mandar a `WF-ERR-Global` con `motivo=MAQUINA_DESCONOCIDA`.
7. **Airtable "Search Pruebas existentes"** — query con filtro `AND({maquina} = '{record_id}', {timestamp_senal} = '{timestamp_senal}')`. Si encuentra una, ya fue procesada → terminar (idempotencia).
8. **Function "Calcular Hash"** — invoca sub-workflow `WF-AUX-HashChain` con la tabla `Pruebas` y el payload, obtiene `hash_registro` y `hash_anterior`.
9. **Airtable "Create Pruebas"** — inserta con todos los campos del PLC + estado=PENDIENTE + hash + `creado_en`.
10. **Function "Llamar Auditoría"** — invoca `WF-AUX-Auditoria` con `accion=CREAR`, `tabla=Pruebas`, `usuario=SYSTEM_PLC`.
11. **HTTP Request → Hostinger** — `POST {STKZ_HOSTINGER_API_URL}/signals/{senal.id}/ack` para que Hostinger marque la señal como procesada y no la reenvíe.
12. **Set "Salida"** — payload de respuesta: `{prueba_id, estado, exito}`.

**Manejo de errores:**
- Si Hostinger no responde (503/timeout): no se hace ack, la señal queda pendiente y se retoma en el próximo ciclo. Se loguea pero no se notifica (es transitorio).
- Si Airtable falla en el create: NO se hace ack a Hostinger. La señal vuelve en el próximo ciclo. Se notifica al admin si falla 5 veces seguidas.
- Si el payload del PLC es inválido (ej: máquina inexistente): se mueve la señal a una cola "dead letter" en Hostinger y se notifica.

**Duración esperada:** <2 segundos por señal.

---

### 3.2. WF-02 — Cierre por Operario

**Objetivo:** recibir desde la interfaz del operario el resultado de una prueba pendiente, validar y persistir.

**Disparador:** Webhook `POST /webhook/operario/cierre-prueba`.

**Payload de entrada:**
```json
{
  "session_token": "JWT del operario logueado",
  "prueba_id": "PRB-2026-04-27-M03-014",
  "caja_numero": "C-12345",
  "lote_numero": "L-2026-042",
  "tuvo_falla": "SI",
  "tipos_falla": ["EST", "GAT"],
  "cantidad_cabezales_fallados": 2,
  "observaciones": "Soldadura visible en cabezal 7"
}
```

**Nodos:**

1. **Webhook Trigger** — recibe el POST.
2. **Function "Validar JWT"** — decodifica `session_token` con `STKZ_JWT_SECRET`. Extrae `usuario_id` y `rol`. Si inválido o expirado → 401.
3. **IF** — si `rol != 'OPERARIO'` → 403.
4. **Airtable "Get Prueba"** — busca por `id_prueba = payload.prueba_id`.
5. **IF "Validar Estado"** — si `estado != 'PENDIENTE'` y `estado != 'EN_REVISION'` → 409 (ya cerrada).
6. **Airtable "Get Operario"** — busca el usuario por `usuario_id` del JWT.
7. **IF "Validar Máquina Autorizada"** — verifica que la máquina de la prueba esté en `operario.maquinas_autorizadas`. Si no → 403.
8. **Airtable "Search Caja"** — busca por `numero_caja`. Si no existe → 422.
9. **Airtable "Search Lote"** — busca por `numero_lote`. Si no existe → 422.
10. **IF "Coherencia Caja-Lote"** — verifica que `caja.lote == lote.record_id`. Si no → 422.
11. **IF "Validar Tipos Falla"** — si `tuvo_falla=SI` y `tipos_falla=[]` → 422. Si `tuvo_falla=NO` y `tipos_falla=[]` → ok.
12. **IF "Observación obligatoria si OTR"** — si tipos_falla incluye `OTR` y observaciones está vacío → 422.
13. **Function "Construir Update Payload"** — arma el JSON de actualización con todos los campos del operario, `timestamp_carga = NOW()`, `estado = (tuvo_falla=='SI') ? 'RECHAZADO' : 'OK'`.
14. **Function "Recalcular Hash"** — invoca `WF-AUX-HashChain` con el payload completo del registro (campos PLC + campos operario). Obtiene nuevo `hash_registro`. Importante: el hash se calcula sobre el snapshot final, no sobre el delta.
15. **Airtable "Update Prueba"** — escribe los campos.
16. **IF "Es RECHAZADO"** — si sí, dispara `WF-NC-Crear` (sub-flujo) que crea automáticamente la fila en `NoConformidades` con `estado=ABIERTA` y la asigna al supervisor del turno.
17. **Function "Llamar Auditoría"** — `WF-AUX-Auditoria` con `accion=MODIFICAR`, `usuario=operario.id`, valor anterior y nuevo de cada campo.
18. **Function "Notificar Supervisor (si rechazo)"** — `WF-AUX-Notificacion` con email + dashboard alert.
19. **Set "Respuesta"** — `{exito: true, prueba_id, estado_final, mensaje}`.
20. **Webhook Response** — devuelve a la UI.

**Manejo de errores:**
- Falla de Airtable update tras hash calculado: se reintenta hasta 3 veces. Si persiste, se loguea, se devuelve 500 al operario y se alerta admin.
- Falla en `WF-NC-Crear`: la prueba quedó RECHAZADO pero sin NC. Se compensa: se reintenta crear NC asíncronamente y queda en cola. La prueba mantiene estado RECHAZADO. Si la NC no se crea en 1 hora, alerta crítica al admin.

**Duración esperada:** <3 segundos.

---

### 3.3. WF-03 — Aprobación de Falla por Supervisor

**Objetivo:** el supervisor revisa una prueba RECHAZADO y la aprueba (o la deja en revisión por dudas).

**Disparador:** Webhook `POST /webhook/supervisor/aprobar-falla`.

**Payload:**
```json
{
  "session_token": "JWT supervisor",
  "prueba_id": "PRB-...",
  "decision": "APROBAR" | "RECHAZAR_APROBACION",
  "comentario": "..."
}
```

**Lógica:**
- Validar JWT y rol `SUPERVISOR`.
- Buscar prueba; debe estar en `RECHAZADO` sin `aprobada_por_supervisor`.
- Si decisión es `APROBAR`: setear `aprobada_por_supervisor`, `timestamp_aprobacion`. Recalcular hash. Auditar.
- Si `RECHAZAR_APROBACION`: marcar `estado=EN_REVISION` y notificar a Jefe de Calidad.
- En ambos casos: la NC asociada queda abierta y sigue su flujo independiente.

---

### 3.4. WF-04 — Timeout de Pruebas Pendientes

**Objetivo:** mover automáticamente a `EN_REVISION` las pruebas que llevan más de 90 minutos en `PENDIENTE` y notificar al supervisor.

**Disparador:** Schedule Trigger cada 5 minutos.

**Nodos:**

1. **Schedule Trigger** — cada 5 min.
2. **Function "Calcular umbral"** — `umbral = NOW() - 90 minutos`.
3. **Airtable "Listar pruebas vencidas"** — vista filtrada `Pendientes Vencidas`: `AND({estado}='PENDIENTE', {timestamp_senal} <= '{umbral}')`.
4. **IF** — array vacío → terminar.
5. **Split In Batches** — procesa una a la vez.
6. **Airtable "Update estado=EN_REVISION"** — solo este campo.
7. **Function "Llamar Auditoría"** — `accion=MODIFICAR`, `usuario=SYSTEM_TIMEOUT`.
8. **Function "Determinar supervisor del turno"** — usa `calc_turno` de la prueba y `Turnos.supervisor_default`.
9. **WF-AUX-Notificacion** — email al supervisor + bandera en dashboard.

**Idempotencia:** una vez la prueba pasa a `EN_REVISION` no se vuelve a procesar (filtro excluye).

---

### 3.5. WF-05 — Selección Aleatoria de Verificación Física

**Objetivo:** al inicio de cada turno (06:00, 14:00, 22:00), seleccionar 2 pruebas aleatorias del turno anterior y crear filas en `VerificacionesFisicas` asignadas al supervisor entrante.

**Disparador:** Schedule Trigger con 3 cron jobs: `0 6 * * *`, `0 14 * * *`, `0 22 * * *`.

**Nodos:**

1. **Schedule Trigger** — uno de los tres horarios.
2. **Function "Determinar turno cerrado y turno entrante"**:
   ```javascript
   const ahora = new Date();
   const hora = ahora.getUTCHours() - 3; // ART
   if (hora === 6) { return {cerrado: 'NOCHE', entrante: 'MAÑANA'}; }
   if (hora === 14) { return {cerrado: 'MAÑANA', entrante: 'TARDE'}; }
   if (hora === 22) { return {cerrado: 'TARDE', entrante: 'NOCHE'}; }
   ```
3. **Function "Calcular ventana de timestamps"** — desde inicio del turno cerrado a fin (ej: NOCHE = ayer 22:00 → hoy 06:00).
4. **Airtable "Listar pruebas del turno"** — filtro: `AND({calc_turno}='{cerrado}', IS_AFTER({timestamp_senal}, '{inicio}'), IS_BEFORE({timestamp_senal}, '{fin}'), {estado}!='ANULADA')`.
5. **IF** — si hay menos de 2 pruebas, seleccionar todas las que haya (no fallar).
6. **Function "Selección aleatoria"** — Fisher-Yates shuffle, tomar las primeras 2.
7. **Airtable "Get supervisor entrante"** — de `Turnos`.
8. **Loop sobre las 2 pruebas:**
   - **Function "Build VerificacionesFisicas"** — payload con `prueba`, `turno_origen`, `supervisor_asignado`, `fecha_seleccion=NOW()`.
   - **WF-AUX-HashChain** — hash de la nueva fila.
   - **Airtable "Create VerificacionFisica"**.
   - **WF-AUX-Auditoria** — `accion=CREAR`.
9. **WF-AUX-Notificacion** — email al supervisor entrante con las 2 pruebas a verificar y deadline (fin del turno entrante).

**Importante:** la aleatoriedad se siembra con `crypto.randomBytes` (no `Math.random`) para que un operario no pueda predecir qué pruebas serán auditadas. Esto es crítico para que el control anti-fraude funcione.

---

### 3.6. WF-06 — Cierre de Verificación Física

**Objetivo:** el supervisor completa la verificación en almacén y devuelve el resultado.

**Disparador:** Webhook `POST /webhook/supervisor/verificacion-fisica`.

**Payload:**
```json
{
  "session_token": "JWT supervisor",
  "verificacion_id": "VF-2026-001",
  "muestras_presentes": "SI_TODAS",
  "cantidad_encontrada": 20,
  "coincide_etiqueta_lote": true,
  "coincide_caja": true,
  "foto_almacen_base64": "...",
  "observaciones": ""
}
```

**Lógica:**
- Validar JWT y rol SUPERVISOR.
- Buscar `VerificacionFisica`, validar que esté asignada a este supervisor.
- Subir la foto a Airtable como attachment.
- Calcular `resultado`: si todas las condiciones se cumplen → OK, si no → DISCREPANCIA.
- Recalcular hash, update Airtable, auditar.
- Si `resultado=DISCREPANCIA`:
  - Crear NC automática contra el operario que cargó la prueba original.
  - Notificar al Jefe de Calidad y al Administrador.
  - Marcar la prueba original como `EN_REVISION` y bloquear modificaciones.

---

### 3.7. WF-07 — Verificación de Eficacia de NCs

**Objetivo:** detectar NCs cuya `fecha_implementacion + 90 días` ya pasó y aún no fueron verificadas. Pasarlas a `EN_VERIFICACION` y notificar.

**Disparador:** Schedule Trigger diario a las 08:00.

**Nodos:**

1. **Schedule Trigger** — `0 8 * * *`.
2. **Airtable "Listar NCs vencidas para verificación"** — vista filtrada: `AND({estado}='ACCION_DEFINIDA', DATEADD({fecha_implementacion}, 90, 'days') <= TODAY())`.
3. **Loop:**
   - Update `estado=EN_VERIFICACION`.
   - Recalcular hash, auditar.
   - Notificar al `verificado_por` asignado.
4. **Segundo barrido — Listar NCs en `EN_VERIFICACION` hace más de 7 días sin cierre** — escala al Jefe de Calidad con prioridad alta.

---

## 4. Workflows de seguridad y sesión

### 4.1. WF-08 — Login y Gestión de Sesión

**Disparador:** Webhook `POST /webhook/auth/login`.

**Lógica:**
1. Recibe `{email, password}`.
2. Buscar usuario en Airtable por email.
3. Verificar `bloqueado_hasta > NOW()` → 423 Locked.
4. Verificar `activo=true` y `fecha_baja=null` → 403.
5. Comparar `password` contra `hash_password` con bcrypt.
6. Si falla:
   - Incrementar `intentos_fallidos`.
   - Si `intentos_fallidos >= 5`, setear `bloqueado_hasta=NOW()+15min`, resetear contador.
   - Auditar `LOGIN_FALLIDO`.
   - Devolver 401.
7. Si OK:
   - Resetear `intentos_fallidos=0`.
   - Setear `ultimo_login=NOW()`.
   - Generar JWT con claims `{usuario_id, rol, exp: NOW()+8h}` firmado con `STKZ_JWT_SECRET`.
   - Si `password_temporal=true`, devolver flag `requiere_cambio_password=true`.
   - Si `password_actualizado_en > 90 días` y rol exige rotación, devolver `requiere_rotacion=true`.
   - Auditar `LOGIN_OK`.
   - Devolver `{token, usuario, requiere_cambio_password, requiere_rotacion}`.

### 4.2. WF-09 — Cambio de Contraseña

**Disparador:** Webhook `POST /webhook/auth/cambiar-password`.

**Lógica:**
1. Validar JWT.
2. Recibir `{password_actual, password_nueva}`.
3. Verificar `password_actual` contra hash.
4. Validar política de password nueva (longitud, complejidad, distinta a la actual).
5. Hashear con bcrypt (cost factor 12).
6. Update `hash_password`, `password_actualizado_en=NOW()`, `password_temporal=false`.
7. Auditar `CAMBIO_PASSWORD`.

---

## 5. Workflows de gestión

### 5.1. WF-12 — Liberación de Lote

**Disparador:** Webhook `POST /webhook/calidad/liberar-lote`.

**Lógica:**
1. Validar JWT, rol debe ser `JEFE_CALIDAD`.
2. Recibir `{lote_id, comentario}`.
3. Buscar lote, validar `estado=EN_PRODUCCION` o `RETENIDO`.
4. Validar que no haya NCs abiertas críticas asociadas al lote (consulta cruzada). Si las hay y el lote se libera igual, exigir comentario explícito y advertir.
5. Update `estado=LIBERADO`, `responsable_liberacion=usuario`, `fecha_liberacion=NOW()`, `comentario_liberacion`.
6. Recalcular hash, auditar.
7. Notificar a Administrador y Supervisores.

### 5.2. WF-13 — Anulación con Doble Firma

**Disparador:** dos webhooks: `POST /webhook/admin/solicitar-anulacion` y `POST /webhook/admin/aprobar-anulacion`.

**Lógica solicitar:**
1. Validar JWT (cualquier rol con permiso de solicitar — típicamente Supervisor o superior).
2. Recibir `{tabla_origen, registro_id, motivo, evidencia_base64}`.
3. Validar `motivo` ≥ 50 caracteres.
4. Crear fila `Anulaciones` con `estado=PENDIENTE_APROBACION`, `solicitada_por=usuario`.
5. Notificar a todos los Administradores activos.

**Lógica aprobar:**
1. Validar JWT, rol `ADMINISTRADOR`.
2. Recibir `{anulacion_id, decision, comentario}`.
3. Validar que `solicitada_por != aprobada_por` (no autoaprobación).
4. Si `decision=APROBAR`:
   - Update `Anulaciones.aprobada_por=usuario`, `fecha_aprobacion=NOW()`.
   - Update registro original con `anulada=true`, `anulacion=link`.
   - Recalcular hash de ambas tablas.
   - Auditar `ANULAR`.
   - Notificar al solicitante.
5. Si `RECHAZAR`: update `Anulaciones.estado=RECHAZADA` con comentario.

---

## 6. Workflows de backup

### 6.1. WF-10 — Backup Warm Nocturno

**Disparador:** Schedule Trigger `0 2 * * *` (diario 02:00).

**Pasos:**

1. **Verificar integridad pre-backup** — invoca `WF-AUX-VerificarHashChain` que recorre todas las tablas auditables y confirma que cada `hash_registro` coincide con su payload y que `hash_anterior` apunta correctamente. Si falla:
   - Crear fila `Backups` con `estado=INTEGRIDAD_COMPROMETIDA`.
   - Alerta crítica al administrador.
   - **NO sobrescribir el backup anterior.**
   - Terminar.
2. **Exportar Airtable** — para cada tabla, paginar con la API de Airtable y construir un JSON de export. Tablas: Maquinas, Usuarios, Turnos, TiposFalla, Lotes, Cajas, Pruebas, NoConformidades, VerificacionesFisicas, Auditoria, Anulaciones, HashChain, Backups (excepto el registro actual).
3. **Adjuntos** — descargar attachments (fotos del supervisor) y empaquetar.
4. **Construir ZIP** — Function node con biblioteca `archiver` o nativa de N8N. Estructura:
   ```
   stkz-backup-{fecha}.zip
   ├── manifest.json (versión, hash_global, fecha, contador de registros)
   ├── tables/
   │   ├── pruebas.json
   │   ├── nc.json
   │   └── ...
   └── attachments/
       └── {record_id}_{filename}
   ```
5. **Cifrar** — AES-256-GCM con `STKZ_BACKUP_AES_KEY`. Output: `stkz-backup-{fecha}.zip.enc`.
6. **Calcular hash global** — SHA-256 del archivo cifrado.
7. **Subir a Google Drive** — Google Drive node, carpeta `STKZ_GDRIVE_FOLDER_ID`. Drive maneja versionado automáticamente.
8. **Rotación de retención warm** — listar archivos en la carpeta, borrar los de más de 30 días.
9. **Crear fila en Airtable Backups** — `tier=WARM_GDRIVE`, estado, hash_global, ubicación, tamaño.
10. **Notificar admin** — solo si hubo error o warning. Backup OK no notifica (anti-fatiga).

**Tiempo estimado:** ~5 minutos para una base con 60.000 pruebas.

### 6.2. WF-11 — Backup Cold Semanal

**Disparador:** Schedule Trigger `0 3 * * 0` (domingo 03:00, después del warm).

**Pasos:**

1. **Tomar el backup warm más reciente** desde Google Drive (no regenerar, replicar).
2. **Subir a Backblaze B2** — usando la API S3-compatible. Bucket `STKZ_B2_BUCKET` con object lock activado en modo `compliance` y retención 7 años. Esto significa que NI el administrador puede borrar el archivo antes de 7 años (cumplimiento IRAM).
3. **Verificar la subida** — descargar checksum y compararlo con el local.
4. **Crear fila Backups** — `tier=COLD_B2`.
5. **Notificar admin** — solo en error.

**Costo estimado:** con ~10 GB acumulados a 7 años, ~USD 0,50/mes. Negligible.

---

## 7. Workflows de reportes

### 7.1. WF-14 — Generación de Reportes

**Disparador:** tres Schedule Triggers:
- `0 6 * * *` — reporte diario del día anterior.
- `0 6 * * 1` — reporte semanal lunes.
- `0 6 1 * *` — reporte mensual día 1.

**Lógica común:**
1. Calcular ventana temporal según frecuencia.
2. Ejecutar consultas a Airtable:
   - **Productividad:** pruebas/máquina/turno.
   - **Tasa de fallas:** pruebas RECHAZADAS / pruebas totales por máquina y por tipo de falla.
   - **Tiempo entre pruebas:** delta promedio entre `timestamp_senal` consecutivos por máquina.
   - **NCs abiertas:** cantidad por estado y antigüedad.
   - **Verificaciones físicas:** cumplimiento de la cantidad esperada (2 por turno) y % de discrepancias.
   - **Pareto de fallas:** top 5 tipos de falla por frecuencia.
3. Construir hojas en Google Sheets (una por reporte, con tabs).
4. Generar PDF resumen para gerencia (en mensual usar Google Docs o pandoc en n8n con Function node).
5. Distribuir por email a destinatarios configurados.
6. Auditar `EXPORTAR`.

**KPIs incluidos en el reporte mensual de gerencia:**
- Tasa de fallas global y por máquina (vs mes anterior y vs meta).
- Pareto de tipos de falla con interpretación automática del top 3.
- Tiempo medio de cierre de NC (apertura → cierre) y % cerradas a término.
- % verificaciones físicas con discrepancia.
- Pruebas que pasaron por `EN_REVISION` (señal de saturación operativa).
- Disponibilidad del sistema (downtime de N8N o Airtable, si lo hubo).

### 7.2. WF-15 — Archivado Anual

**Disparador:** Schedule Trigger `0 4 1 1 *` (1 de enero 04:00).

**Pasos:**
1. Crear nueva base Airtable `Estanqueidad_Historico_{año-1}`.
2. Copiar registros del año cerrado.
3. Calcular hash de cierre de año (hash_global del estado final).
4. Anclar el hash de cierre como primer registro de la base operativa del nuevo año (continuidad de la cadena).
5. Marcar registros viejos en la base operativa como archivados (no borrarlos por 30 días, por seguridad).
6. Pasados los 30 días, depurar de la base operativa.
7. Generar reporte anual y enviarlo a gerencia.

---

## 8. Sub-workflows transversales

### 8.1. WF-AUX-HashChain

**Función:** dado `{tabla, registro_id, payload}`, calcular `hash_registro` y `hash_anterior` y devolverlos.

**Lógica:**
1. Canonicalizar el payload (orden alfabético de claves, fechas en ISO, sin nulls).
2. Buscar último eslabón en `HashChain` para esa tabla → `hash_anterior`.
3. Calcular `hash_registro = SHA256(hash_anterior + canonical_payload)`.
4. Insertar fila en `HashChain` con `secuencia` autoincrementada.
5. Devolver al workflow llamador.

**Por qué fila separada en `HashChain`:** permite que el verificador recorra la cadena en orden estricto sin depender del orden de inserción en cada tabla.

### 8.2. WF-AUX-Auditoria

**Función:** dado `{usuario_id, accion, tabla, registro_id, valor_anterior, valor_nuevo, ip, user_agent}`, persistir evento en `Auditoria` y encadenarlo en su propia hash chain.

**Importante:** el log de auditoría también está en hash chain. Esto significa que para alterar el log, el atacante tendría que rehashar toda la cadena, lo cual es detectable en el backup nocturno.

### 8.3. WF-AUX-Notificacion

**Función:** dado `{tipo, destinatarios, asunto, cuerpo, prioridad}`, despachar por:
- Email (SMTP).
- Bandera en dashboard (escribe en una tabla `Notificaciones` que la UI consume).
- Opcional futuro: Telegram/WhatsApp para alertas críticas (no en v1).

### 8.4. WF-ERR-Global

**Configurado como Error Workflow en cada workflow productivo.**

**Lógica:**
1. Recibe el contexto del error (workflow, nodo, payload, mensaje).
2. Loguea en una tabla `Errores` (no en Airtable principal — puede ser un archivo en N8N o tabla separada).
3. Si la prioridad es alta (caída de Airtable, hash chain inconsistente, fallo de backup): notifica al admin por email + dashboard.
4. Si es transitoria (timeout HTTP, 503): encola para reintento con backoff exponencial (1 min → 5 min → 15 min, máx 3 intentos).
5. Auditar el incidente.

---

## 9. Manejo de errores y reintentos

### 9.1. Política por tipo de error

| Tipo | Ejemplo | Política |
|---|---|---|
| Transitorio de red | Timeout Hostinger, 503 Airtable | Retry con backoff exponencial: 1 min, 5 min, 15 min |
| Validación de datos | Caja inexistente, lote inválido | Error 422 al usuario, sin reintento |
| Autorización | JWT vencido, rol insuficiente | Error 401/403, sin reintento |
| Integridad | Hash chain rota | Alerta crítica, NO reintento, NO sobrescritura |
| Lógica de negocio | Estado inválido (cierre de prueba ya cerrada) | Error 409, sin reintento |
| Sistema externo | Google Drive sin cuota | Notifica admin, encola backup en local hasta resolver |

### 9.2. Backoff y rate limits

Airtable Pro permite 5 requests/segundo por base. N8N tiene un nodo "Wait" que se usa para no saturar. Para procesos masivos (backup, archivado), las consultas se paginan a 100 registros y se espera 250ms entre páginas.

### 9.3. Dead letter queue

Para señales del PLC que no se pueden procesar (máquina inexistente, payload corrupto), Hostinger expone un endpoint `/signals/dead-letter` donde N8N las mueve. El admin las revisa periódicamente vía interfaz.

---

## 10. Ambientes y deployment

### 10.1. Ambientes

- **dev** — instancia N8N local del implementador, base Airtable `Estanqueidad_DEV`. Datos sintéticos.
- **stg** — opcional, instancia compartida con datos reales anonimizados para pruebas de aceptación.
- **prod** — instancia N8N productiva (servidor dedicado o N8N Cloud), base `Estanqueidad`. Datos reales.

Los workflows se exportan/importan vía JSON entre ambientes. Las credenciales se reconfiguran en cada ambiente (no se exportan).

### 10.2. Versionado

Cada workflow se versiona en N8N (built-in). Adicionalmente se exporta semanalmente a un repositorio Git (puede ser privado en GitHub o GitLab) para tener historial fuera del N8N. Esto cubre el requisito ISO 27001 de control de cambios.

### 10.3. Disponibilidad

N8N debe estar en alta disponibilidad o tener procedimiento documentado de recuperación (<1 hora). Si N8N cae:
- Las señales del PLC se acumulan en Hostinger sin perderse.
- La interfaz del operario muestra un banner "sistema en mantenimiento" y permite cargar offline en localStorage; al recuperarse, sincroniza.
- Los workflows programados (timeout, verificación, backup) se reanudan en el próximo ciclo.

---

## 11. Diagrama de interacción de workflows

```
                    [PLC en planta]
                           │ JSON
                           ▼
                    [Hostinger]
                           │ poll cada 30s
                           ▼
                  [WF-01 Captura Señal] ──────► [Airtable Pruebas: PENDIENTE]
                                                         │
                                                         │ aparece en cola
                                                         ▼
[Operario carga] ──► [WF-02 Cierre Operario] ──► [Airtable Pruebas: OK/RECHAZADO]
                                │
                                ├─ si RECHAZADO ──► [WF-NC-Crear] ──► [NoConformidades]
                                │                                          │
                                │                                          ▼
                                │                            [WF-07 Verifica Eficacia]
                                │
                                └─ siempre ──► [WF-AUX-HashChain] ──► [HashChain]
                                              [WF-AUX-Auditoria] ──► [Auditoria]

[Schedule cada 5 min] ──► [WF-04 Timeout] ──► [Pruebas: EN_REVISION + Notif]

[Schedule 06:00/14:00/22:00] ──► [WF-05 Selecciona Verificación] ──► [VerificacionesFisicas]
                                                                              │
[Supervisor verifica almacén] ──► [WF-06 Cierre Verificación] ◄────────────────┘
                                          │ si DISCREPANCIA
                                          ▼
                                   [WF-NC-Crear]

[Schedule 02:00 diario] ──► [WF-10 Backup Warm] ──► [Google Drive]
[Schedule domingo 03:00] ──► [WF-11 Backup Cold] ──► [Backblaze B2]
[Schedule diario/sem/mes 06:00] ──► [WF-14 Reportes] ──► [Google Sheets + email]
[Schedule 1 enero] ──► [WF-15 Archivado] ──► [Estanqueidad_Historico_YYYY]

[UI Auth] ──► [WF-08 Login / WF-09 Cambio Pass]
[UI Calidad] ──► [WF-12 Liberación Lote]
[UI Admin] ──► [WF-13 Anulación]

Cualquier error ──► [WF-ERR-Global] ──► Notificación + retry/dead-letter
```

---

## 12. Próximos pasos

Una vez validada esta Fase 2, las fases siguientes son:

- **Fase 3** — Diseño detallado de la interfaz del operario (mockups, validaciones front, flujo offline).
- **Fase 4** — Matriz de roles y permisos (qué endpoints expone cada rol, qué vistas de Airtable ve cada uno).
- **Fase 5** — Especificación de reportes (KPIs, layout en Sheets, plantilla del PDF mensual de gerencia).
- **Fase 6** — Checklist ISO con mapeo de cada cláusula a evidencia generada por el sistema.
- **Fase 7** — Plan de implementación y capacitación.

---

## 13. Puntos abiertos para validar

1. **Capacidad de Hostinger** — el endpoint `/signals/pending` y `/signals/{id}/ack` debe construirse o ya existe? Si no existe, hay que desarrollar un microservicio mínimo (PHP simple) en Hostinger que reciba los archivos del PLC, los almacene en una tabla y los exponga a N8N. Estimar 2-4 horas de desarrollo.

2. **Volumen de la cola del PLC** — si el PLC envía cada hora por máquina, son 240 señales/día. El polling de 30s genera ~2880 calls/día a Hostinger. Verificar que el plan de Hostinger lo soporte.

3. **Decidir el alojamiento productivo de N8N** — la licencia activa que mencionaste, ¿es self-hosted o N8N Cloud? Si es self-hosted, definir servidor (puede ser un VPS de Hostinger o DigitalOcean) con HTTPS, certificados, backup del propio N8N.

4. **Email transaccional** — ¿qué SMTP se usa para notificaciones? Si es Gmail con cuenta corporativa, hay que configurar app password o OAuth. Alternativa: SendGrid o Mailgun para mayor confiabilidad.

5. **Política de retención de logs de N8N** — los logs de ejecución de N8N (no los de auditoría de Airtable) ¿cuánto se guardan? Recomendación: 90 días en N8N, 7 años exportados al backup junto con Airtable.

6. **Notificaciones móviles** — ¿hace falta WhatsApp/Telegram para alertas críticas (hash chain rota, backup fallido)? No es bloqueante para v1, pero conviene definir si se planifica.
