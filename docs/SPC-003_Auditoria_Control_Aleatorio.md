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
- El formulario existente solicita además cantidad encontrada, coincidencia
  de etiqueta/lote y caja; son controles ya codificados, pero su alcance
  obligatorio sigue pendiente de confirmación. No se cambian en esta etapa.
- La cantidad de selecciones sigue en **2** por conservar el comportamiento
  existente; Planta no fijó una cantidad nueva.
- La selección server-side debe partir de pruebas digitales elegibles del
  turno anterior, persistir identificadores de prueba y contramuestra y
  registrar la comprobación física de forma trazable e idempotente.

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

**Revisión pendiente de código:** el formulario actual comprueba presencia,
cantidad, etiqueta/lote y caja, pero la condición `OK` inspeccionada en
`completarVerificacion` sólo exige presencia y coincidencia de etiqueta/lote
y caja; no compara explícitamente `cantidad_encontrada === 20` ni la
distribución defectuosos/no defectuosos con el registro digital. **No declarar
este criterio implementado hasta corregirlo con validación en servidor,
pruebas y manejo seguro de datos históricos incompletos.** No crear un
resultado ficticio cuando falten cantidades.

## Implementación existente que se preserva

- `src/App.jsx`: `asegurarVerificacionesTurnoAnterior` selecciona pruebas del
  turno anterior y asigna verificaciones al responsable que ingresa.
- Cantidad actualmente codificada = **2** verificaciones por ingreso/turno;
  Planta **no confirmó en esta conversación** si esa cantidad debe ser 1 o 2.
  Se conserva el valor existente en esta entrega.
- Formulario `ModalVerificacionFisica` pide comprobar contramuestras en almacén,
  cantidad y coincidencia de etiqueta/lote/caja; puede emitir `DISCREPANCIA`.
  El nuevo procedimiento explicado por Planta habla de *existencia del control*.
  La inspección física de existencia está confirmada; aún falta precisar\n  si cantidad, etiqueta/lote y caja son criterios obligatorios.
  No se modificó ni se presentó como regla aprobada.
- No se vuelve a medir ni se exige aprobar el resultado del ensayo para
  registrarlo o incluirlo en conteos descriptivos de pruebas registradas.
- Este control nunca debe escribir `spc_uso_estadistico='VALIDADO'` ni
  interpretar un registro manual como evento OT certificado.

## Corrección técnica incorporada

- Nuevo `src/domain/seleccionVerificaciones.js`: muestreo sin reposición por
  Fisher–Yates parcial, con entradas verificadas.
- Reemplaza el sesgado `sort(() => Math.random() - 0.5)` sin alterar la
  cantidad de verificaciones, las condiciones de elegibilidad existentes,
  los destinatarios, el formulario ni los estados almacenados.
- `tests/seleccionVerificaciones.test.js`: no duplicación, conservación de
  lista original, ausencias, cantidad insuficiente y fuentes inválidas.
- **Advertencia:** selección al azar en el navegador NO asegura aleatoriedad
  auditable ni impide manipulación por un usuario privilegiado.

## Hallazgos no resueltos (bloqueo al piloto)

1. **Falta tabla en STAGING:** `public.verificaciones_fisicas` existe en
   la base SIDES S.A productiva, pero NO aparece en SIDES-SPC-STAGING. No
   se puede completar QA end-to-end de este flujo en staging actualmente.
2. **Carrera entre dos sesiones:** el frontend consulta si existen
   verificaciones y luego las inserta, sin una operación transaccional que
   reserve el turno. Puede generar asignaciones duplicadas.
3. **Idempotencia incompleta:** detectar una verificación previa por
   cualquier `prueba_id` no equivale a comprobar la existencia de la
   asignación para exactamente el turno/encargado previsto.
4. **Tiempos:** el filtro usa `created_at`, timestamp sin zona horaria
   explícita, comparado con cadenas ISO UTC; no hay contrato verificado para
   todos los registros históricos.
5. **Cobertura:** lectura de pruebas sin paginación declarada; si supera
   la configuración de límite de filas de la API, no se elige entre todas.
6. **Errores silenciosos:** si falla `getVerificacionesPendientes` devuelve
   `[]`, que en algunos lugares se interpreta como «no hay verificaciones».
7. **Políticas y roles:** confirmar que *encargado de sala* corresponde
   al rol de aplicación `supervisor` o a otro. En producción hay políticas
   `vf_insert/vf_select/vf_update`; en staging la tabla no existe.
   Falta prueba negativa con sesiones Auth de ensayo.

## Recomendación de implementación siguiente

Antes de operar en planta, diseñar una selección **server-side** idempotente,
atómica, autorizada, por ventana de turno y responsable, sin depender de
`Math.random` del cliente. Preparar estructura de staging con procedimiento
revisado y ejecutar QA en Windows, dejando producción sin modificaciones.

**Requiere confirmación antes de cambiar negocios:** cantidad de controles
(1 o 2), si se verifica sólo registro o también contramuestra física,
y el rol exacto de quien ingresa a revisar.

## Decisiones explícitamente descartadas

Se revirtieron `src/domain/validacionMuestras.js`,
`src/api/validacionMuestras.js` y
`sql/SPC_003_CONTRATO_VALIDACION_MUESTRAS_NO_APLICAR.sql`.
Eran hipótesis no aprobadas: supervisor validando cada ensayo, separación
obligatoria entre autor y validador, selección de protocolo y revocaciones.
No se aplicaron a staging ni a producción.
