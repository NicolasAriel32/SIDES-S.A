# SIDES · SPC-003 — Auditoría del control aleatorio del turno anterior

Fecha: 2026-11-06. Estado: análisis técnico y mejora acotada, **sin despliegue**.

## Confirmado por Planta en esta conversación

- Cada operario realiza y registra su prueba de estanqueidad. Nadie revisa
  rutinariamente el resultado de los 20 cabezales ni aprueba cada ensayo.
- Al inicio del turno siguiente, el encargado de sala tendrá una comprobación
  **aleatoria** de la **existencia de un control específico** del turno previo.
- La comprobación de existencia es diferente de validar el resultado técnico
  de los 20 cabezales; **no habilita automáticamente SPC oficial**.

## Confirmación adicional de Planta — contramuestra física

- El objetivo de la revisión aleatoria es **comprobar que existe físicamente
  la contramuestra** correspondiente a una prueba del turno anterior.
- Que aparezca una verificación seleccionada presupone un **registro digital
  preexistente**: no solicitar al encargado una segunda confirmación de
  existencia de ese mismo registro.
- La inspección física no certifica el resultado de estanqueidad ni habilita
  `VALIDADO` estadístico. No modificar ni aprobar el ensayo original.
- Planta confirmó como **obligatorios** cantidad total = 20, caja/lote y
  distribución física de cabezales con y sin defectos según registro.
- La cantidad de selecciones sigue en **2** por conservar el comportamiento
  existente; Planta no fijó una cantidad nueva.
- La selección server-side parte de pruebas digitales no anuladas del
  turno anterior y asigna identificadores de prueba al encargado autenticado.
  La comprobación física queda trazada por VF-001 (borrador de cierre).
  La asignación VF-002 ya está escrita como contrato SQL **no ejecutado**.

## Criterios físicos confirmados por Planta

La revisión de la contramuestra aleatoria debe verificar **todo** lo siguiente
contra el registro digital original de la prueba seleccionada:

1. Existe físicamente la contramuestra correspondiente.
2. Contiene **exactamente 20 cabezales**, no menos ni más.
3. La identificación de **caja y lote** coincide con la registrada.
4. La cantidad de cabezales **con defectos y sin defectos** coincide con lo
   declarado digitalmente. Por ejemplo, 3 defectuosos y 17 sin defectos
   registrados deben corresponder a 3 y 17 físicamente identificados.
5. Se conserva la evidencia de quién revisó, cuándo y cualquier discrepancia.

La verificación es de **concordancia física-documental**, no una repetición
de la prueba de estanqueidad ni una certificación de la existencia real
de una fuga. No cambia el resultado original del operario.

**Corrección de interfaz (sin despliegue):** el formulario exige cantidad
total encontrada y cantidad identificada con defectos; muestra la cantidad
digital esperada de defectuosos/sin defectos y su distribución física.
La función pura `src/domain/concordanciaContramuestra.js` compara:
total = 20, defectuosos físicos = `cantidad_cabezales_afectados` de la
prueba original, sin defectos = 20 - defectuosos, caja, lote y presencia.
Si algún dato digital original es NULL/inconsistente, **no guarda nada**.
Si la inspección es coherente pero hay un desvío físico, queda
`DISCREPANCIA` con `genera_nc=true`. No hay repetición del ensayo.

**Contrato transaccional propuesto (NO APLICADO):**
`sql/VF_001_CIERRE_CONTRAMUESTRA_RPC_NO_APLICAR.sql` crea una RPC de cierre
que obtiene `auth.uid()`, comprueba asignación, bloquea por ID la verificación,
vuelve a leer la prueba digital y **calcula resultado en servidor**.
Registra los dos conteos físicos separados y hora del servidor; admite
reintento idéntico sin duplicar cierre. El borrador incluye revocar
UPDATE directo del navegador, lo que exige inventariar clientes antiguos
antes de migrar. No existe todavía `verificaciones_fisicas` en staging y
NO se aplicó la migración ni se verificó SQL contra PostgreSQL.

**Advertencia de implementación:** el PR nuevo utiliza la RPC; si se
publicara sobre la base actual sin migración coordinada, el cierre fallaría
de forma segura (sin escribir resultado), por lo que **NO debe desplegarse**.
Aún falta probar autorizaciones por rol, interoperabilidad, concurrencia y
respuesta ante corte de red.

## Decisión operativa confirmada: discrepancia sin NC automática (2026-11-06)

Si el encargado detecta discrepancia en una contramuestra, **solo registra
el hallazgo físico**: qué prueba/contramuestra se seleccionó, cantidad
encontrada, defectuosos/no defectuosos, coincidencia de caja/lote,
observaciones, usuario y fecha. No se repite la prueba original,
no se modifica su resultado, **no se abre ni se solicita una NC** y
no se inicia una acción correctiva por este flujo.

En `sql/VF_001_CIERRE_CONTRAMUESTRA_RPC_NO_APLICAR.sql` la RPC de cierre
guarda `resultado='DISCREPANCIA'`, `genera_nc=false` y
`no_conformidad_id=NULL` (también para `OK`). No hay `INSERT`
de NC en la RPC. **No interpretar una discrepancia como NC pendiente**.
La eventual gestión posterior se definirá en otra etapa.

**Staging:** se actualizó la función interna VF-001 y se verificó con
`pg_get_functiondef` que registra resultado, fuerza `genera_nc=false`,
limpia vínculo NC y no inserta NC. Se comprobó que no existen triggers
de usuario en `verificaciones_fisicas`. Esto es verificación del
contrato instalado, **no prueba end-to-end de un cierre real con JWT**.
Producción no fue modificada.

## Implementación tras VF-002 (todavía SIN DESPLIEGUE)

- `src/App.jsx`: `asegurarVerificacionesTurnoAnterior` **ya no**
  consulta ni inserta pruebas desde el navegador. Invoca el nuevo
  `src/api/asignacionVerificaciones.js`, que llama a la RPC del servidor
  **sin argumentos**; hora, responsable y cantidad son inyectados por el DB.
- `sql/VF_002_ASIGNACION_ATOMICA_NO_APLICAR.sql` fija el turno entrante
  según reloj PostgreSQL + America/Argentina/Buenos_Aires, toma su turno
  anterior (8 h), verifica rol activo supervisor/admin y selecciona
  **2** pruebas sin reposición con `ORDER BY random() LIMIT 2`.
- Serializa las peticiones por turno con `pg_advisory_xact_lock` y
  `SELECT ... FOR UPDATE`; una tabla ledger tiene PK por turno entrante.
  Un índice **UNIQUE(prueba_id)** impide duplicar verificaciones para
  la misma prueba, aun cuando el sorteo elija candidatas diferentes.
- Si dos sesiones compiten, una asigna y otra obtiene `YA_ASIGNADA` o
  `ASIGNADA_A_OTRO` sin crear filas adicionales. Los turnos con
  verificaciones antiguas producen `LEGADO_EXISTENTE` y no se duplican.
- Se almacena `SIN_PRUEBAS` cuando no existen candidatas, para mantener
  idempotencia de la selección por turno y no hacer sorteos tardíos por
  reintento. Este comportamiento debe evaluarse con datos offline reales.
- Al aplicar la migración, se **REVOCA INSERT directo de authenticated**
  para que clientes antiguos no puedan saltarse el lock; exige ventana
  coordinada e inventario de clientes, no publicar frontend antes.
- No se cambió el número de verificaciones ni las condiciones de
  elegibilidad anteriores (`anulada IS FALSE`, turno anterior).
- `getVerificacionesPendientes` ya indica el error de lectura en vez
  de tratarlo como una lista vacía. La UI ahora informa también fallos
  de asignación y los casos `ASIGNADA_A_OTRO` / `LEGADO_EXISTENTE`.
- El formulario `ModalVerificacionFisica` continúa comprobando
  contramuestra física, 20 cabezales, caja, lote y distribución de
  defectuosos/no defectuosos; VF-001 sigue siendo migración separada.

## Riesgos que bloquean todavía el uso en planta

1. **Staging incompleto:** `public.verificaciones_fisicas` falta en
   SIDES-SPC-STAGING; sin ella no puede probarse VF-001/VF-002.
2. **Integración SQL real:** las pruebas CI sólo comprueban el contrato
   de cliente, la presencia de invariantes SQL y la compilación.
   Falta correr la migración en base aislada y realizar concurrencia
   real con dos conexiones (dos responsables, y dos pestañas del mismo).
3. **Hora de origen:** `pruebas.created_at` es timestamp sin zona y
   el script interpreta valores como UTC, coherente con la configuración
   inspeccionada. No hay prueba de procedencia de cada registro histórico.
4. **Roles:** encargado de sala actualmente está modelado como
   `supervisor`; confirmar equivalencia en la configuración real.
   SQL usa permisos `supervisor/admin`, igual que el flujo existente.
5. **Compatibilidad/rollback:** revocar INSERT directo y habilitar
   RPC de cierre requieren inventario de clientes legados, backups,
   rollback y despliegue coordinado. Ningún cambio de esquema aplicado.
6. **Seguridad:** falta QA Auth negativa y restauración aislada.
   No es suficiente inspeccionar políticas RLS.
7. **Turno sin candidatos:** la decisión persistida `SIN_PRUEBAS`
   impide un nuevo sorteo en el mismo turno si llegan registros offline
   después; es una elección técnica conservadora que requiere prueba.

## Siguiente fase verificada

Preparar esquema de staging y pruebas con sesiones reales:
sesiones simultáneas, reintento de red, diferencias entre turnos,
fuente vacía, turnos que cruzan medianoche, RLS/Auth por rol,
verificaciones legadas y datos sin zona horaria. Registrar evidencia
antes de activar SQL y desplegar. Ver `docs/VF-002_ASIGNACION_TRANSACCIONAL.md`.

**Pendiente de confirmación operativa:** número definitivo de controles
(se mantienen dos existentes) y correspondencia entre encargado y
rol supervisor. No agregar aprobación humana de los ensayos.

## Decisiones explícitamente descartadas

Se revirtieron `src/domain/validacionMuestras.js`,
`src/api/validacionMuestras.js` y
`sql/SPC_003_CONTRATO_VALIDACION_MUESTRAS_NO_APLICAR.sql`.
Eran hipótesis no aprobadas: supervisor validando cada ensayo, separación
obligatoria entre autor y validador, selección de protocolo y revocaciones.
No se aplicaron a staging ni a producción.
