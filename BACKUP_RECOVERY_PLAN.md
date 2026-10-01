# Plan de backup, recuperación y anclaje externo — SIDES S.A.

Fecha: 2026-10-01  
Estado: diseño listo; ejecución externa pendiente de credenciales/destino.

## Objetivo

Separar tres controles que no deben confundirse:

1. **Auditoría interna:** audit_log + cadena v2.
2. **Anclaje externo:** copia periódica fuera de Supabase de la cabeza/hash de la cadena.
3. **Backup recuperable:** copia cifrada de la base en un almacenamiento independiente y prueba periódica de restauración.

Una cadena de hashes alojada únicamente dentro de la misma base no reemplaza un backup ni una evidencia externa.

## Estado actual

- Supabase: plan Free.
- audit_log: append-only y cadena v2 activa.
- Verificación interna: diaria a las 05:15 UTC mediante pg_cron.
- Backup off-site automatizado: **todavía no activo**.
- Prueba documentada de restore: **todavía no realizada**.

No se habilita una tarea automática de backup hasta verificar manualmente una ejecución y una restauración aislada.

## Diseño recomendado

Destino previsto: almacenamiento separado compatible con S3, por ejemplo Cloudflare R2.

Cada ejecución debe producir:

- `sides-<UTC>.dump.age`: pg_dump en formato custom, cifrado con age.
- `sides-<UTC>.dump.age.sha256`: checksum del archivo cifrado.
- `audit-anchor-<UTC>.json`: chain_version, chain_seq y hash_evento actuales.
- `backup-manifest-<UTC>.json`: fecha UTC, versión PostgreSQL y nombres de artefactos.

## Secretos

Los siguientes valores nunca se versionan:

- `SUPABASE_DB_URL`
- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- clave privada de descifrado age

El recipient/pública de age puede almacenarse como variable del repositorio.

## Flujo de activación

1. Configurar secretos de GitHub Actions.
2. Ejecutar manualmente `.github/workflows/manual-offsite-backup.yml`.
3. Verificar existencia de los artefactos en el destino.
4. Descargar una copia en un entorno aislado.
5. Verificar checksum.
6. Descifrar.
7. Restaurar en una base de prueba, nunca directamente sobre producción.
8. Comparar conteos/constraints y ejecutar controles funcionales.
9. Registrar resultado y responsable.
10. Sólo después habilitar una programación diaria.

## Regla de retención

La duración de conservación todavía no está definida por Calidad/Seguridad.

Hasta tener una decisión formal:
- no implementar eliminación automática;
- no asumir 30/90/365 días;
- conservar los backups generados durante las pruebas de este plan.

## Restore test

Un backup no se considera control verificado hasta completar una restauración de prueba.

La prueba debe registrar como mínimo:
- fecha;
- archivo restaurado;
- checksum;
- entorno de destino;
- hora de inicio/fin;
- resultado;
- diferencias encontradas;
- responsable;
- acción correctiva si falla.

## Evidencia ISO

Este plan busca aportar evidencia verificable de:
- disponibilidad y recuperación;
- protección de registros;
- integridad de evidencia;
- trazabilidad temporal;
- separación entre producción y copia de recuperación.

No convierte por sí mismo al sistema en “certificado”; la evidencia debe integrarse al sistema de gestión de SIDES.
