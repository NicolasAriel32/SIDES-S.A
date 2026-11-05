# SPC-001 — Reporte verificable de integración inicial en Supabase STAGING

Fecha: 2026-11-05
- Staging: `SIDES-SPC-STAGING` (id `yurjxlxmfbvqviemvtqp`), creado en la misma organización con costo cotizado USD 0/mes.
- Producción SIDES: `rzejddqcjqtxsenbdocz`. **No se ejecutaron migraciones ni sentencias de escritura sobre producción**.
- FORMA: `tdujzupsvzxrrbnhmtoj`, estado `INACTIVE`, pausado para liberar un cupo.
- PR #1: rama `feature/spc-001-fase1-integridad-ui`, sin merge.
- Migración aplicada **únicamente a STAGING**: `sql/spc_001_registrar_prueba_atomica_BORRADOR_NO_APLICAR.sql`. El nombre del archivo indica que **no se debe aplicar en producción por automatismo**.

## Procedimiento realizado

1. Se creó un esquema sintético mínimo en STAGING con `usuarios`, `maquinas`, `tipos_falla`, `turnos`, `pruebas`, `pruebas_fallas`, RLS y políticas de acceso modeladas sobre las existentes. No se copiaron empleados ni registros industriales reales.
2. Se aplicó la función `registrar_prueba_estanqueidad_spc(jsonb)` en ese esquema.
3. Se corrigió en el esquema **sintético de staging**, no en producción, un escape incorrecto de la expresión regular de código de producto que había sido introducido en la preparación de las fixtures. La expresión final equivale a la intención de producción.
4. Se ejecutó como `authenticated` con `request.jwt.claim.sub` sintético una prueba con 2 cabezales únicos, tipos EST=2 y CLV=1. Resultado: una prueba, dos detalles, suma de menciones 3.
5. Se reenvió la misma solicitud: una única prueba lógica y dos detalles, sin duplicados.
6. Se ejecutaron y verificaron **13 pruebas negativas**, cada una con rechazo esperado:
   - OK con un afectado.
   - RECHAZADO con 0 o 21 afectados.
   - Tipo duplicado o inexistente.
   - Cantidad por tipo superior a afectados únicos.
   - Suma por tipo insuficiente.
   - Operario en máquina distinta.
   - Código de producto inválido.
   - PENDIENTE automático con defectos.
   - Sin sesión, auditor, usuario inactivo.
7. Prueba de atomicidad real en staging: constraint temporal que provoca falla al insertar `pruebas_fallas`. Se comprobó que la prueba principal tampoco persiste.
8. Pruebas positivas adicionales: OK, PENDIENTE y una muestra de un cabezal con dos tipos. El campo `operario_legajo` se obtuvo del contexto autenticado aunque el payload intentó suplantar otro.
9. Se comprobó rechazo de reintento con el mismo UUID y payload modificado.
10. Todos los ensayos se hicieron dentro de transacciones `BEGIN ... ROLLBACK`. Consulta posterior: **0 pruebas y 0 detalles** persistidos.
11. Se revocó `EXECUTE` al rol `anon` para `get_my_profile()` en staging tras detectar que el esquema sintético le había otorgado permiso explícito. La RPC nueva tampoco permite `EXECUTE` de `anon`.

## Hallazgos de seguridad y limitaciones

- Supabase Advisors de staging conserva **una advertencia** sobre la función `get_my_profile()`, que es `SECURITY DEFINER` y ejecutable por usuarios autenticados. Procede del patrón del perfil usado por el esquema existente; requiere una revisión específica, no elevar privilegios de la RPC nueva.
- No se ha ensayado con usuarios reales creados mediante Supabase Auth ni mediante la API REST autenticada: se simuló el contexto JWT dentro de SQL.
- La fixture es un **subconjunto** del esquema productivo, sin todos los triggers, FK y funciones de auditoría/calibración, ni la totalidad de pantallas y consumidores.
- No se ensayó concurrencia real entre dos conexiones ni reconexión de una PWA desde un teléfono.
- No se verificó el despliegue Cloudflare ni las variables de entorno de la versión que iría a `main`.
- Los registros históricos reales permanecen intactos y, por mezclar cargas de ensayo y trabajo, **no** integran una línea base SPC válida.

## Puerta de salida antes de main

**NO APROBADO AÚN**. La ejecución de RPC en staging simplificado no equivale a validación de la aplicación completa.

Antes de aprobar merge, se exige:
1. Staging compatible con esquema completo, RLS, Auth y triggers reales (sin copiar datos personales).
2. Pruebas end-to-end de frontend en navegador móvil y Supabase Auth real.
3. Reintentos concurrentes y recuperación del fallo de red con la señal local.
4. Plan de despliegue coordinado de función DB y frontend: hoy la rama llama a una RPC que todavía no existe en producción. Si `main` provoca despliegue, una fusión aislada rompería el guardado.
5. Revisión y cierre documentado del warning `SECURITY DEFINER`; backup, restauración y estrategia de rollback.
6. Aprobar explícitamente cualquier migración que afecte a la base real.

Este archivo registra **resultados obtenidos**, no certificación SPC ni validación de captura de la HMI Kinco/PLC Delta.
