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
