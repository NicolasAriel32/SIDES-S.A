# Guía para la reunión con el Jefe de Planta
**Sistema de trazabilidad de estanqueidad + control de calidad — SIDES S.A.**

> Objetivo: que entienda el valor, dé luz verde a un **piloto sin riesgo**, y abrir la conversación de un **rol formal**. Mentalidad: no vas a pedir, vas a **proponer valor** para la planta.

---

## 1. Apertura (30-45 segundos, decilo tranquilo)

> "Gracias por el tiempo. Trabajo en la línea [X], máquina [10]. Desde ahí veo todos los días dos cosas que se repiten: el registro de las pruebas de estanqueidad es manual y se puede perder, y el control de calidad se hace con macros que van lentas y se prestan a error. Por mi cuenta armé un sistema que resuelve las dos, y ya lo revisé con [jefa de calidad] y [jefe de producción]. En 10 minutos te muestro cómo funciona y por qué creo que es una buena oportunidad para la planta."

Por qué funciona: empezás desde la planta (credibilidad), sos breve, y ya traés respaldo.

---

## 2. Recorrido de la demo (mostrá 3-4 cosas potentes, no todo)

1. **Control de calidad (reemplazo de las macros):** mostrá la carga rápida — "antes ~14 datos por registro, ahora 3 + las mediciones" — y el cálculo automático de merma/recuperados. *Mensaje: más rápido y con menos error que la macro.*
2. **Tablero / supervisor en tiempo real:** mostrá el turno con las máquinas, las pendientes en amarillo y la falla en rojo. *Mensaje: cualquiera ve el estado del turno en vivo, sin pedir planillas.*
3. **Trazabilidad y seguridad:** cada prueba queda ligada a lote, caja, máquina y operario, y el registro no se puede modificar ni borrar sin dejar rastro. *Mensaje: esto es lo que mira un auditor ISO/IRAM.*
4. **Cierre del recorrido:** "el núcleo ya funciona, se puede pilotear sin frenar la producción, y tiene el visto bueno de Calidad y Producción."

---

## 3. Preguntas probables y mejores respuestas

### Riesgo y operación
**"¿Esto frena la producción mientras lo probamos?"**
*(Le preocupa parar la línea.)* No. El piloto corre en paralelo: el operario sigue trabajando igual y el sistema registra por debajo. Arrancamos con 1 o 2 máquinas; si algo no anda, la línea no se ve afectada.

**"¿Qué pasa si se cae el sistema o se corta internet?"**
*(Continuidad operativa.)* La máquina nunca depende del sistema para seguir produciendo; el sistema acompaña, no bloquea. Para el piloto dejamos un registro de respaldo simple por si hay corte, y después sincroniza. Lo importante: no se pierde trazabilidad.

**"¿Y si el operario carga mal un dato?"**
Hay campos acotados y validaciones, así que se equivoca menos que con la macro. Y si pasa, queda auditado: se ve quién, qué y cuándo, y se corrige con trazabilidad.

### Costo, mantenimiento y dependencia
**"¿Cuánto cuesta esto?"**
*(El número.)* El desarrollo ya está hecho, sin costo de consultora externa. La infraestructura (base de datos y hosting) es de bajo costo. El retorno es tiempo de carga, menos errores y retrabajo, y quedar listos para auditoría.

**"¿Esto depende solo de vos? ¿Si no estás, qué pasa?"**
*(El "bus factor" — pregunta clave, respondela maduro.)* Hoy lo hice yo, pero está sobre **tecnología estándar de la industria**, no algo casero, y con el código documentado. Justamente formalizarlo sirve para que **no dependa de una sola persona**: se puede documentar, acompañar y transferir. No quiero que sea "mi juguete", quiero que sea un activo de la empresa.

**"¿Quién lo mantiene y lo mejora?"**
Puedo hacerlo yo, y parte de la propuesta es dejar todo documentado para que el conocimiento quede en la empresa.

### Seguridad y datos
**"¿Los datos están seguros? ¿Se pueden adulterar?"**
Fue un foco central. Cada registro queda **sellado y encadenado**: no se puede modificar ni borrar sin dejar rastro. Se hizo una **revisión de seguridad a fondo** y se corrigieron todos los puntos. Eso es justamente lo que da confianza ante un cliente o un auditor.

**"¿Quién puede ver o cambiar qué?"**
Acceso por rol: el operario ve solo lo de su máquina; supervisor e inspector gestionan calidad; el admin configura; el auditor solo mira. Las contraseñas están cifradas.

### Cumplimiento y Calidad
**"¿Calidad está de acuerdo con esto?"**
Sí. Lo vimos en dos reuniones con [jefa de calidad] y dio el visto bueno, igual que [jefe de producción]. No es una idea suelta: ya pasó por ellos.

**"¿Esto nos sirve para las auditorías ISO / IRAM?"**
Sí: trazabilidad de punta a punta (lote, caja, máquina, operario), registros que no se alteran y control de no conformidades. Cubre lo que más miran en este proceso.

### Adopción y cambio
**"¿Los operarios lo van a saber usar? ¿No se van a resistir?"**
Está pensado para que sea **más fácil que hoy**: menos campos que la macro. Por eso proponemos un piloto chico: mostramos que les **ahorra** tiempo, no que les agrega trabajo, y ajustamos con su feedback.

### Estado y qué falta
**"¿Está terminado?"**
El núcleo funciona y se puede pilotear. Quedan dos mejoras que estoy cerrando: la **lectura automática de la señal del PLC** y **etiquetas con QR** para identificar muestras en el almacén. Ninguna bloquea el piloto.
*(No prometas fecha exacta; "lo estoy cerrando".)*

**"¿Cómo sé que funciona?"**
Ya está probado. El piloto es justamente para validarlo en planta con datos reales, en chico y sin riesgo.

### Tu rol (manejá esto con calma y sin exigir)
**"¿Por qué lo hiciste vos, que sos operario?"**
Porque veo los problemas todos los días desde la máquina y me apasiona resolverlos con tecnología. Lo hice por iniciativa propia, para aportar y para crecer dentro de la empresa.

**"¿Lo hiciste en horario de trabajo?"**
No, en mi tiempo libre, en casa y en los descansos. Por eso lo traigo formalmente: para que avance bien y deje de depender de mis ratos libres.

**"¿Y qué querés a cambio?"**
Poder aportar este tipo de valor de forma más formal: liderar proyectos de optimización, automatización y digitalización de procesos —como un analista de procesos— y no únicamente desde la máquina. Que las horas que hoy pongo de mi tiempo pasen a ser trabajo reconocido.

### Próximos pasos
**"¿Qué necesitás de mí?"**
Tu luz verde para un **piloto controlado en 1-2 máquinas**, coordinando con Calidad y Producción cómo medimos el resultado. Y abrir la conversación sobre cómo formalizar mi aporte.

---

## 4. Frases ancla (repetilas a lo largo de la charla)
- "Lo veo todos los días desde la máquina."
- "Reemplaza un sistema lento y propenso a error por uno más rápido y confiable."
- "Se puede probar **sin frenar la producción** y con tu autorización."
- "Ya tiene el **visto bueno de Calidad y Producción**."
- "Desarrollado internamente: **menos costo y tiempo** que algo externo."

## 5. Qué evitar
- No hablar mal de las macros ni de quienes las usan: hablá de **evolución**, no de culpa.
- No prometer **fechas exactas** del PLC/QR.
- No ponerte técnico: hablá de **tiempo, error, costo y auditoría**, no de código.
- No **exigir** el rol: **proponelo** como valor.
- No decir "esto es mío": decí "es un **activo para la empresa**".
- No abrumar con todas las funciones: 3-4 cosas potentes y listo.
- No usar que tu papá es jefe de calidad como argumento.

## 6. Cómo cerrar
> "Te propongo arrancar con un piloto chico, sin riesgo, en una o dos máquinas, y lo evaluamos juntos con Calidad y Producción. Si funciona como creo, hablamos de cómo seguir — y de cómo puedo aportar más allá de la máquina. ¿Te parece que demos ese primer paso?"

Terminá con una pregunta concreta: que la respuesta natural sea "sí, probemos".

---

## 7. Cómo pedir el tiempo en horario (después del "sí" al piloto)

> Reencuadre clave: **decir que sí al piloto es decir que sí al tiempo para hacerlo.** Operando la máquina e implementando a la vez no se puede hacer bien. No es un favor: es lo que el piloto necesita para existir. Y nunca lo plantees como "me quiero bajar de la máquina", sino como "no puedo hacer las dos cosas a la vez bien".

**Puente (apenas acepta el piloto):**
> "Perfecto. Para que el piloto salga bien hay algo concreto que necesito plantearte: implementarlo y acompañarlo no lo puedo hacer operando la máquina al mismo tiempo. Necesitaría dedicarle unas horas **fuera de la línea, en horario**, durante el piloto."

**El pedido concreto (llevá un número, no lo dejes abierto):**
> "Mi idea es arrancar acotado —por ejemplo [medio turno un par de días por semana, o las horas que veas]— y lo **coordino con [supervisor] para cubrir la máquina** en esos ratos. Es por el período del piloto y lo ajustamos según cómo venga."

**Tres cosas que le bajan el riesgo a él:**
- Inversión chica: "esas horas se recuperan rápido con el tiempo que el sistema ahorra después en cada turno."
- Medible y reversible: "definimos las horas y qué entrego; lo revisás. Si no ves valor, lo frenamos."
- Ordenado: "no quiero dejar un hueco en la línea; lo planificamos con el supervisor o uso las ventanas de menor carga."

**Si te dice que es mucho (tené un mínimo listo):**
> "Si te parece mucho para empezar, arranquemos con menos —aunque sean unas pocas horas por semana— y lo vamos viendo."

**La conexión con el rol (solo al final, atada a resultados):**
> "Si el piloto funciona como creo, ahí sí tiene sentido hablar de formalizar esto en un rol, para que deje de depender de mis ratos libres."

**Evitar:** "no quiero operar más la máquina" · pedir tiempo indefinido · dejarlo abierto sin número ni cobertura.
