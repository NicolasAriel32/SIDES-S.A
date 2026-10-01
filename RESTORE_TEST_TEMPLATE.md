# Registro de prueba de restauración — SIDES S.A.

Usar una copia por cada prueba. No restaurar nunca sobre producción para validar un backup.

## Identificación

- Fecha/hora UTC:
- Responsable:
- Backup:
- Checksum esperado:
- Checksum verificado:
- Audit anchor asociado:
- Entorno aislado de restauración:

## Ejecución

- Inicio:
- Fin:
- Duración:
- Versión PostgreSQL origen:
- Versión PostgreSQL destino:
- Comando/procedimiento utilizado:

## Verificaciones mínimas

- [ ] El archivo cifrado pudo descargarse.
- [ ] El checksum coincide.
- [ ] El archivo pudo descifrarse.
- [ ] El dump pudo restaurarse sin errores críticos.
- [ ] Tablas principales presentes.
- [ ] Conteos razonables comparados con manifiesto/origen.
- [ ] Constraints e índices presentes.
- [ ] RLS presente en tablas protegidas.
- [ ] Funciones/RPC críticas presentes.
- [ ] audit_log presente.
- [ ] CHAIN_V2_START presente.
- [ ] Último audit anchor coincide con la evidencia guardada.
- [ ] audit_integrity_status / validación equivalente sin rupturas inesperadas.
- [ ] Login/prueba funcional mínima realizada en ambiente aislado.

## Resultado

- Estado: APROBADO / RECHAZADO
- Diferencias encontradas:
- Impacto:
- Acción correctiva:
- Fecha objetivo de corrección:
- Evidencia adjunta:

## Cierre

Un backup sólo se considera **verificado** cuando esta prueba termina APROBADA. La existencia de un archivo de backup por sí sola no demuestra recuperabilidad.
