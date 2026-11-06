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

Limitaciones importantes: el método getTests(desde) existente podría truncar por
paginación y devuelve lista vacía en ciertos errores. Los conteos son solo de
registros recuperados, no prueban cobertura ni ausencia de fallas.
La marca VALIDADO no se establece en esta entrega. Antes de mostrar datos
operativos como representativos, Calidad debe autorizar muestreo y procedencia.

## Próximas entregas

1. Validar protocolo físico, muestreo, categorías y metrología con Calidad.
2. Implementar contrato server-side de procedencia y validación de muestras.
3. Consulta estadística paginada y de lectura limitada con RLS por rol.
4. Con una línea base representativa, ensayar gráficos de control y falsas alertas.
5. Integrar Kinco/Delta únicamente con autorización y lectura OT pasiva.

Decisión de despliegue: NO-GO hasta completar con evidencia PIL-01 a PIL-10.
