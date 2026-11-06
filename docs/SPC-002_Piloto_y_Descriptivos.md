# SIDES 2.0 — Estabilización del piloto y SPC descriptivo (SPC-002)

Fecha: 2026-11-06. Máquina piloto: MAQ-010.
Estado: desarrollo aislado. No se autoriza despliegue, migración de la base productiva ni conexión OT.
Base: Fases técnicas 1–5 fusionadas en main; 125 pruebas automatizadas aprobadas en el CI previo.

## Entrega 1: condiciones obligatorias antes de usar en planta

| Gate | Evidencia necesaria | Estado |
| --- | --- | --- |
| PIL-01 | Backup externo cifrado, checksum y restauración aislada contrastados | PENDIENTE |
| PIL-02 | Verificar versión publicada, HTTPS y compatibilidad entre SQL y frontend | PENDIENTE |
| PIL-03 | Auth en staging con identidades reales de ensayo, roles y pruebas negativas RLS/RPC | PENDIENTE |
| PIL-04 | E2E desde Windows Chrome/Edge: dos pestañas, Web Locks y cierre de sesión | PENDIENTE |
| PIL-05 | Corte de red, envío incierto, reintento idempotente y Storage corrupto/bloqueado | PENDIENTE |
| PIL-06 | Inventario de clientes que utilizan INSERT directo y rollback coordinado | PENDIENTE |
| PIL-07 | Política de perfiles Windows compartidos y retención de datos locales | PENDIENTE |
| PIL-08 | Calidad aprueba extracción física de los 20 cabezales cada 10 cajas | PENDIENTE |
| PIL-09 | Metrología/evidencia del equipo y ensayo aprobada por Calidad y Mantenimiento | PENDIENTE |
| PIL-10 | Prueba guiada con operario/supervisor, registro de evidencias y aprobación | PENDIENTE |

CI verde no aprueba ningún gate de planta. Ver Checklist QA Escritorio, Fase 5 Preflight,
BACKUP_RECOVERY_PLAN.md y RESTORE_TEST_TEMPLATE.md.

## Entrega 2: SPC-002 en modo observación

- Motor puro sin escrituras: src/domain/spcDescriptivo.js.
- Panel del supervisor para MAQ-010: src/components/PanelSpcPiloto.jsx.
- Los PENDIENTE no son ensayos. Los históricos y NO_VALIDADO nunca se suman
  a una tasa de defectuosos, aunque posean cantidades aparentemente completas.
- Requisitos de aptitud descriptiva: señal VALIDADO asignada sólo mediante
  un futuro procedimiento autorizado de Calidad, 20 inspeccionados explícitos,
  producto, fecha válida y coherencia de resultados/tipos/cantidades.
- Se separa por producto: no se mezclan líneas base ni porcentajes de códigos distintos.
- Se suman cabezales defectuosos únicos, no tipos de falla como unidades.
- Duplicados del mismo ID son excluidos. Datos incompletos nunca se usan en tasas.
- Sin muestras aptas se muestra No calculable, no cero falso.
- No se generan límites de control, DPU, EWMA, CUSUM, alertas, NC ni acciones en equipos.
- No se alteran históricos ni se ejecuta SQL.

## Entrega 3: lectura paginada de MAQ-010 y estados comprobables

- Se reemplazó en el panel SPC la dependencia de `getTests(desde)` por una
  lectura específica de sólo lectura desde `src/api/spcDescriptivo.js`.
- Filtros por máquina y ventana de 30 días, orden estable por `created_at`
  e `id`, con páginas de hasta 100 registros y límite conservador de 2000.
- `count: exact` para **filas visibles bajo RLS**. No acredita cobertura
  industrial: puede haber registros fuera de la autorización o períodos sin
  conexión. Cada página se compara con el conteo informado.
- Tres estados: `COMPLETO`, `PARCIAL` y `ERROR`. Si cambia el conteo,
  faltan páginas, hay duplicaciones o se alcanza el límite, se deshabilitan
  porcentajes. Un error de consulta **no equivale a cero pruebas**.
- Si la lectura falla, no se publican datos parciales como completos;
  se usa un código genérico sin exponer tokens ni mensajes internos.
- Consultas por páginas no son una transacción de snapshot PostgreSQL;
  el filtro de tiempo y chequeo de IDs/count atenúan riesgos pero no prueban
  invariabilidad simultánea de todos los registros.
- `created_at` actualmente es `timestamp without time zone` en staging.
  La lectura **no inventa UTC**: una marca sin zona explícita no es apta
  para un indicador validado. Antes de habilitar SPC oficial hace falta una
  convención temporal inequívoca del lado servidor.
- `null` de cabezales afectados no se convierte en cero verdadero; ensayos
  anulados se excluyen. Muestra con múltiples tipos conserva conteo único.
- No altera `getTests` usado por paneles operativos ni la decisión de NC.
- La marca `VALIDADO` no se establece en esta entrega. Debe depender de
  protocolo físico aprobado y autorización server-side de Calidad.

### Consulta y autorización: observaciones de 2026-11-06

- Staging: tablas `pruebas` y `pruebas_fallas` con RLS habilitado (2
  políticas en cada una). Producción: RLS habilitado (3 y 2 políticas,
  respectivamente). **No se ejecutaron pruebas Auth HTTP por rol**.
- Staging tiene la RPC y columnas SPC; producción **no**. No desplegar el
  frontend hasta completar migración coordinada, backup y rollback.
- La UI solo se muestra en la vista supervisor por el enrutamiento vigente,
  pero **no se confía en la UI como autorización**. Verificar RLS en staging
  con usuarios reales de ensayo y pruebas negativas antes de operar.
- Los conteos son registros consultables, no una prueba de completitud OT.

## Riesgos de producción aún pendientes

- Restauración aislada y backup externo probado.
- Autoridad para validar estadísticas, evidencia temporal y protocolo de muestra.
- Reglas RLS/RPC probadas con usuarios de cada rol, no sólo metadatos.
- Compatibility de frontend y migración en ventana controlada; no se han
  aplicado SQL ni migraciones a producción.

## Próximas entregas

1. Validar protocolo físico, muestreo, categorías y metrología con Calidad.
2. Implementar contrato server-side de procedencia y validación de muestras.
3. Consulta estadística paginada y de lectura limitada con RLS por rol.
4. Con una línea base representativa, ensayar gráficos de control y falsas alertas.
5. Integrar Kinco/Delta únicamente con autorización y lectura OT pasiva.

Decisión de despliegue: NO-GO hasta completar con evidencia PIL-01 a PIL-10.
