# SPC-001 — Fase 1: validación y semántica de indicadores

Fecha: 2026-11-05. Piloto MAQ-010. **Rama de revisión: no desplegar ni fusionar sin pruebas.**

## Alcance implementado en esta rama

- Se reutilizan `VistaOperario` y `VistaSupervisor` en `src/App.jsx`, sin reemplazar componentes.
- Las pruebas `OK` deben tener cero cabezales afectados y ningún tipo de falla; una prueba con falla debe tener entre 1 y 20 cabezales únicos afectados y al menos un tipo.
- El guardado queda bloqueado en UI y vuelve a validarse antes de la operación de datos. **Es defensa de cliente, no una restricción de servidor**.
- El indicador del supervisor se identifica como **porcentaje de pruebas con falla**, y excluye registros `PENDIENTE` del denominador.
- El Pareto existente se rotula como **menciones de tipos por prueba** (no cantidades de defectos).
- La señal manual/simulada se identifica como tal; su hora no es el momento verificado del aviso Kinco.
- La referencia de ocho pruebas por turno se rotula orientativa, no cumplimiento industrial demostrado.
- Pruebas unitarias puras con `node --test` (no afectan la base de datos).

## Riesgos abiertos: NO resueltos por esta primera fase

1. **La persistencia de `createTest` continúa no atómica**: se insertan `pruebas` y después `pruebas_fallas`. Debe implementarse una RPC transaccional, idempotente y autorizada server-side, con pruebas negativas y despliegue coordinado de migración + frontend.
2. **`cantidad_items_afectados` sigue guardándose como 1 por tipo**: no utilizar este campo histórico para DPU ni Pareto cuantitativo. El cambio de semántica/captura requiere validación de Calidad.
3. **La regla `PENDIENTE` de 60 minutos se ejecuta en navegador/localStorage**. No es evidencia de aviso OT; requiere modelo persistente y política de excepción.
4. **No se obtuvo señal industrial**. El adaptador Kinco/Delta se diseñará y ensayará separado, con autorización OT.
5. Los indicadores SPC oficiales requieren protocolo de muestreo aprobado y línea base por producto.
6. No se ha validado aquí la versión desplegada ni restauración de backup.

## Verificación previa a merge

- Ejecutar `npm test` y `npm run build` en un clon de esta rama.
- Ensayar en entorno aislado con datos sintéticos: OK, falla, 0/1/20/21, tipos ausentes/duplicados, prueba pendiente, sesión expirada, errores de Supabase, permisos y compatibilidad del supervisor.
- Verificar que la rama no dispare despliegue a producción y que `main` no haya cambiado durante el trabajo.
- Aprobar en una revisión separada la RPC de escritura atómica y la semántica de cantidades por tipo.

No se requiere ni autoriza escritura en Supabase para esta fase.
