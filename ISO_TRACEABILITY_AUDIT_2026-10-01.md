# Auditoría de trazabilidad de datos — SIDES S.A.

Fecha: 2026-10-01  
Baseline del proyecto: ISO 9001:2026 + ISO/IEC 27001:2022 según información confirmada para SIDES.

## Objetivo

Comprobar si, partiendo de un registro operativo, puede reconstruirse de forma consistente:

**prueba/control → máquina → producto → lote/caja → defecto → NC → recontrol → merma → cierre**

y distinguir entre:
- evidencia estructural fuerte;
- snapshots de texto;
- anomalías legacy;
- reglas todavía pendientes de definición.

## 1. Control de Calidad — estado actual

Datos actuales:
- 22 controles de Calidad no anulados.
- 22/22 vinculados a una orden de máquina.
- 22/22 con cliente relacional.
- 22/22 con especificación de producto.
- 22/22 con lote y producto snapshot.
- 22/22 tienen exactamente 8 mediciones.
- La especificación define 4 cabezales de muestra; 8 mediciones = 4 APERTURA + 4 LARGO.
- 7 controles no conformes.
- 7/7 tienen rango/cantidad coherente.
- 7/7 tienen al menos un defecto asociado.
- 0 controles no conformes sin vínculo a su NC.

Coherencia orden → control:
- máquina: 0 inconsistencias;
- lote: 0;
- producto: 0;
- especificación: 0;
- cliente: 1 inconsistencia histórica.

La inconsistencia histórica de cliente no se reescribió.

### Remediación aplicada

`guardar_control_calidad()` ya no confía en los valores de máquina, producto, lote, cliente ni especificación enviados por el navegador.

La fuente de verdad es `ordenes_maquina`. El cliente sólo identifica la orden y los datos propios del control.

Esto evita que un payload manipulado produzca un control formalmente válido pero asociado a datos maestros diferentes de la orden.

## 2. No Conformidades

Estado:
- 0 NC con doble origen.
- 0 NC sin origen.
- 5 NC históricas cerradas sin causa raíz.
- 1 NC histórica cerrada sin legajo de cierre.

Las NC legacy no se modificaron.

### Remediación aplicada

La constraint de origen ahora exige XOR:
- prueba de estanqueidad, **o**
- Control de Calidad,
pero nunca ambos y nunca ninguno.

Para cierres nuevos, el trigger ya exige causa raíz y obtiene el legajo de cierre de la sesión autenticada.

## 3. Recontrol y merma

Estado:
- 0 recontroles vinculados a un control distinto del control origen de su NC.
- 1 actor legacy de recontrol no puede resolverse actualmente contra `usuarios`.
- existe al menos un caso histórico cuyo acumulado supera el objetivo original; corresponde al modelo viejo que repetía el total en cada intento.
- 5 mermas.
- 5/5 ligadas a recontrol.
- 5/5 ligadas a NC.
- 0 recontroles con merma duplicada.

### Remediación aplicada

- un recontrol debe apuntar al mismo control de Calidad que su NC;
- un recontrol nuevo no puede superar el pendiente;
- sólo puede marcarse final cuando el acumulado completa el objetivo;
- existe un máximo de una merma por `recontrol_id`;
- una merma de origen RECONTROL debe tener `recontrol_id` y `no_conformidad_id`.

## 4. Pruebas de estanqueidad — gap de trazabilidad

Estado actual:
- 56 pruebas no anuladas.
- 50 tienen número de caja como texto.
- 53 tienen número de lote como texto.
- 3 no tienen producto.
- 6 no tienen caja.
- 3 no tienen lote.
- 35 no tienen `turno_id`.
- 0 pruebas están vinculadas por FK a `cajas`.
- 0 pruebas están vinculadas por FK a `lotes`.
- tablas `cajas` y `lotes`: 0 filas.

Conclusión técnica:

La trazabilidad de estanqueidad actual usa principalmente **snapshots textuales** de caja/lote. Aunque esos valores permiten búsquedas, todavía no existe una cadena relacional prueba → caja → lote para los datos existentes.

No se auto-crearon lotes/cajas porque primero hay que confirmar las reglas reales de numeración, reutilización y ciclo de vida.

## 5. Rechazos de estanqueidad y NC — decisión pendiente

De las pruebas RECHAZADAS actuales:
- 7 quedaron APROBADAS; 6 tienen NC y 1 histórica no tiene NC.
- 6 están PENDIENTE_APROBACION sin NC.
- 6 están REVISADO sin NC.

El frontend actual contiene una decisión explícita de versión anterior: los rechazos de estanqueidad pueden marcarse `REVISADO` sin abrir NC porque la gestión de rechazos fue trasladada al módulo de Control de Calidad.

Esto crea una bifurcación funcional:
- los rechazos de Calidad tienen NC/recontrol/merma;
- una prueba de estanqueidad rechazada puede terminar como REVISADO sin NC.

No se cambió esta regla porque requiere confirmar el proceso real con Producción/Calidad.

## 6. Mediciones — hallazgo crítico a validar

Los 22 controles tienen el número correcto de mediciones esperado por la configuración actual: 4 cabezales × 2 tipos = 8.

Sin embargo:
- 176 mediciones totales;
- 76 tienen una inconsistencia entre el flag histórico `fuera_rango` y los límites **actuales** de la especificación;
- las 76 corresponden a mediciones de LARGO;
- todas están guardadas como `fuera_rango=false` pero quedan fuera del rango configurado actualmente.

Ejemplos observados:
- control con LARGO 145–149 mm frente a especificación actual 298–302 mm;
- control con LARGO 124 mm frente a especificación actual 308–312 mm.

Esto NO demuestra por sí solo que las mediciones históricas fueran evaluadas mal.

Puede significar, entre otras posibilidades:
- el significado del campo LARGO cambió;
- los límites de especificación fueron modificados después;
- la medición histórica correspondía a otra dimensión;
- existió un error de configuración.

### Gap estructural

El control histórico guarda `especifc_producto_id`, pero no guarda un snapshot inmutable de:
- apertura mínima/máxima;
- largo mínimo/máximo;
- cantidad de muestra;
- versión de especificación.

Por eso hoy no es posible demostrar sólo con la base cuáles eran exactamente los límites aprobados **en el momento del control**.

No se recalcularon ni alteraron los 176 resultados históricos.

## 7. Calibración / medición

Estado:
- 0 registros en `calibraciones`.
- 56/56 pruebas tienen `calibracion_estado = SIN_CALIBRACION`.

El esquema permite registrar calibraciones y su auditoría ya está activa, pero los datos actuales no aportan evidencia de un proceso de calibración/verificación ejecutado.

No se inventaron ni completaron calibraciones retrospectivas.

## 8. Controles técnicos agregados

Se creó `traceability_integrity_status()`, restringida a admin/auditor.

Reporta de forma repetible:
- faltantes de producto/caja/lote/turno;
- rechazos aprobados sin NC;
- inconsistencias orden/control;
- NC con origen/cierre anómalo;
- recontroles inconsistentes o sobre objetivo;
- mermas sin vínculo o duplicadas;
- uso real de lotes/cajas normalizados.

## 9. Pendientes que requieren confirmación del proceso

No bloquean el avance técnico general, pero no deben resolverse inventando reglas:

1. Semántica real y límites aprobados de la medición **LARGO**.
2. Si una prueba de estanqueidad RECHAZADA puede cerrarse como REVISADO sin NC, o si requiere otro registro formal.
3. Reglas de identidad de `lote` y `caja` para migrar de snapshots de texto a relaciones fuertes.
4. Proceso real de calibración/verificación de los equipos de medición.
5. Plazo de retención de registros.

## 10. Regla

Hasta confirmar esos puntos:
- no modificar evidencia histórica;
- no recalcular `fuera_rango` retroactivamente;
- no crear automáticamente lotes/cajas históricos;
- no inventar calibraciones;
- impedir nuevas inconsistencias cuando la regla ya está confirmada.


## 11. Reglas de proceso confirmadas posteriormente

### LARGO
Se confirmó que LARGO es el largo del cabezal y que el criterio dimensional del producto es nominal ±2 mm.

Se detectó un dato maestro inconsistente:
- `RCL-300C-AZ`: nominal figuraba 310 mm mientras sus límites eran 298–302 mm.

Se corrigió exclusivamente el nominal a 300 mm. El cambio quedó registrado en `audit_log` como `DB_TRIGGER`, conservando before/after. No se alteraron mediciones históricas.

Para controles futuros se implementó snapshot de especificación y evaluación server-side de rango.

### Orden impresa y lote
El encargado entrega una orden de trabajo impresa. El lote se lee de esa orden y se carga una sola vez al iniciar/cambiar la orden. Permanece vigente hasta terminar/cambiar la orden.

La arquitectura futura de estanqueidad debe reflejar esta fuente de verdad en vez de pedir el lote libremente en cada prueba.

### Caja
La caja sí cambia durante producción. Para la prueba de estanqueidad, el operario consulta la etiqueta de la caja actual y carga ese número para relacionar la prueba con el material físico presente.

### Rechazo de estanqueidad
El proceso físico real incluye:
- supervisor identifica desde qué caja hacia atrás considera que comenzó la falla;
- el extremo final es la caja actual tomada para control;
- se separa físicamente el pallet;
- se completa una manila en papel con falla, responsable, máquina, turno y cantidad de cajas, entre otros datos.

Se confirmó posteriormente que la manila es oficialmente la **No Conformidad** cuando el supervisor determina que corresponde rechazar/segregar material.

También se confirmó que una falla informada por el operario no equivale automáticamente a una NC. El supervisor puede:
- determinar que no corresponde rechazo;
- pedir revisión al 100% de la caja actual mientras la línea continúa;
- o generar la NC oficial y segregar el tramo afectado.

Por lo tanto, el problema del flujo legacy no era la existencia de un resultado “sin NC”, sino que `REVISADO` no expresaba de forma estructurada **qué decisión tomó el supervisor**.


## 12. Flujo estructurado de evaluación de fallas de estanqueidad

Se implementó `evaluaciones_estanqueidad` como registro append-only y auditado.

Decisiones permitidas:
- `SIN_RECHAZO`;
- `REVISION_100_CAJA`;
- `GENERAR_NC`.

Sólo el rol `supervisor` puede ejecutar `evaluar_falla_estanqueidad()`.

### SIN_RECHAZO
La prueba pasa a `REVISADO_SIN_NC`. Se conserva que existió una falla reportada por el operario, quién la evaluó y que el supervisor decidió que no correspondía rechazo.

### REVISION_100_CAJA
La prueba pasa a `REVISION_100_CAJA`, permanece pendiente y se genera automáticamente una observación para el operario: `REVISAR UNA CAJA AL 100%`. La producción puede continuar en paralelo según el proceso confirmado.

Una evaluación posterior debe resolver el caso como `SIN_RECHAZO` o `GENERAR_NC`.

### GENERAR_NC
La caja actual de la prueba se toma server-side como `caja_hasta`. El supervisor debe indicar `caja_desde`, cantidad de cajas y confirmar que el material quedó segregado.

La NC creada conserva snapshots de máquina, turno, lote, producto y fallas disponibles de la prueba origen, además del rango de cajas y fecha de segregación.

El estado de la prueba pasa a `NC_ABIERTA`.

### Anti-bypass
- Las NC nuevas ya no admiten INSERT directo desde roles API.
- Un trigger impide pasar una prueba rechazada a estados de decisión sin una evaluación estructurada reciente.
- Los registros legacy quedan fuera de esta exigencia mediante versionado del flujo, para no impedir su consulta/cierre ni reescribir historia.
