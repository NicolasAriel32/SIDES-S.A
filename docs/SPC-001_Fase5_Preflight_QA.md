# SPC-001 · Fase 5 — Preflight y soporte seguro para despliegue controlado

## Objetivo
Preparar diagnóstico de puesto para la futura validación paso a paso desde Windows, sin realizar todavía E2E, despliegues ni cambios en producción.

## Alcance implementado
- Módulo puro `src/domain/preflightPuesto.js`: verifica disponibilidad de Auth, almacenamiento, exclusividad de máquina, contexto HTTPS/localhost y conectividad reportada por el navegador.
- Distingue `LIBRE`, `ABIERTA`, `ENVIO_PREVIO`, `HUERFANO`, `INCIERTO`, `INTERVENCION` y confirmaciones con/sin residuos.
- En estados de intervención, incertidumbre o evidencia huérfana no habilita nuevas pruebas.
- El botón «Copiar diagnóstico seguro» genera exclusivamente códigos enumerados y booleanos; **no copia** UUID, legajo, payload, contraseñas, tokens ni datos de ensayos.
- Pruebas unitarias de escenarios libres, pendientes, sin red, sin lock, estados desconocidos y sanitización de reportes.

## Limitaciones explícitas
- La indicación `navigator.onLine` no demuestra disponibilidad del servidor Supabase.
- El diagnóstico es informativo: los controles reales de autorización, bloqueo y persistencia permanecen en los módulos de Fases 1–4. **No sustituye** la verificación de RLS ni la confirmación de una RPC.
- No se cifraron los borradores existentes. La privacidad frente a otra persona con acceso al mismo perfil Windows continúa requiriendo perfiles separados y gestión organizacional; no habilitar puestos compartidos sin esa política.
- La fase se apila sobre el PR #4 para no mezclar cambios sin revisión. Ni Fase 4 ni Fase 5 se fusionan automáticamente en `main`.

## Criterios de aceptación previos a la validación final
1. `npm test` y `npm run build` en GitHub Actions.
2. Auditoría del diff y de que no se agregaron migraciones, secretos o escritura de producción.
3. Revisión de condiciones de carrera y preservación de evidencia pendiente.
4. PR de borrador abierto con riesgos pendientes.

## Pruebas desde PC — reservadas para el final
1. Windows + Chrome/Edge, un perfil Windows por operario.
2. Abrir una máquina libre y copiar el diagnóstico: sólo códigos y checks.
3. Abrir dos pestañas en la misma máquina: la segunda no debe obtener lock.
4. Desconectar red y verificar diagnóstico, recuperación conservadora y conservación del intento.
5. Verificar sesión caducada, cambios de rol y revalidación al recuperar foco.
6. No activar producción hasta confirmar RPC transaccional, backup/restore y RLS real.
