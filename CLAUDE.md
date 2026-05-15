Actuá como arquitecto de sistemas de trazabilidad industrial con experiencia en normativas ISO 9001, ISO 27001 e IRAM. Voy a describirte el proceso de mi empresa y necesito que me ayudes a diseñar un sistema completo, profesional y auditable.

— CONTEXTO DEL PROCESO —

Mi empresa realiza pruebas de estanqueidad sobre cabezales de soda. Actualmente contamos con aproximadamente 10 maquinas las cuales se manejan con un operario por maquina que realiza esta prueba en 20 cabezales cada 10 cajas producidas de 336 cabezales o mas, cada uno realiza una prueba por hora aproximadamente es lo que se demora en producir 10 cajas, lo que genera alrededor de 24 registros diarios por maquina. Cada prueba emite una señal automática con: fecha, hora y número de máquina.

Luego de la señal, un operario debe completar manualmente el resultado de la prueba con los siguientes campos:

-fecha:

- ¿Tuvo falla? (Sí / No)

- Número de caja y número de lote de la muestra

- Observaciones opcionales

deberia quedar en el registro un - Estado final: OK / RECHAZADO / PENDIENTE (en caso de demorar hasta la proxima prueba sin haber completado el registro)

— STACK TECNOLÓGICO DISPONIBLE —


-next js programacion
- Supabase (base de datos principal)

- vercel (plataforma)

- Interfaz web simple para el operario (puede ser una form de Airtable, un formulario web embebido o una interfaz custom en HTML/JS)

— REQUISITOS OBLIGATORIOS —

El sistema debe cumplir con las siguientes normativas:

ISO 9001 (Gestión de Calidad):

- Registro completo e inmutable de cada prueba

- Trazabilidad de la muestra de inicio a fin

- Control de no conformidades (fallas registradas y gestionadas)

- Reportes de indicadores: tasa de fallas, tiempo entre pruebas, productividad por turno

ISO 27001 (Seguridad de la Información):

- Acceso por roles: operario (solo carga datos), supervisor (visualiza + aprueba), administrador (acceso total)

- Registro de auditoría (log de quién modificó qué y cuándo)

- Los datos no deben poder eliminarse, solo marcarse como anulados con justificación

- Backup automático o exportación programada

IRAM (normas argentinas aplicables):

- Documentación del procedimiento en formato auditable

- Identificación de responsables por registro

- Trazabilidad de número de lote y caja conforme a requerimientos de rastreabilidad

— LO QUE NECESITO DE VOS —

1. Diseño de la arquitectura del sistema (qué hace cada componente)

2. Estructura de la base de datos en Airtable (tablas, campos, relaciones)

3. Flujo detallado en N8N (nodos necesarios, lógica de cada etapa)

4. Diseño de la interfaz del operario (qué campos ve, en qué orden, con qué validaciones)

5. Lógica de roles y permisos

6. Plan de reportes para auditoría

7. Checklist de cumplimiento ISO que el sistema debe poder demostrar

Empezá por la arquitectura general del sistema y la estructura de la base de datos en Airtable. Luego avanzamos etapa por etapa.