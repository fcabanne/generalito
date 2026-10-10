# PRD: IA que aprende a jugar a la generala

Oct 6, 2026 · @Facu

## Visión y objetivo

El objetivo es construir, en tu propia máquina y desde cero, una IA que aprenda sola a jugar a la generala de tu familia: simula miles de partidas, evalúa sus resultados y mejora.

- Todo corre local: sin APIs externas ni modelos ya entrenados.
- Las reglas las definís vos. Es una generala de 4 columnas que se juega en tu familia hace 20 años, así que no existe un modelo hecho para ella.
- Lo que más te interesa es ver qué estrategias detecta la máquina, incluso las que nadie de la familia conoce.
- Meta a largo plazo: una máquina que mire los dados de una partida real y sugiera qué guardar y dónde anotar.

## El juego

Las reglas completas están en [`REGLAS.md`](REGLAS.md) (versión 1.0), que es la fuente de verdad del motor. Resumen de lo que más pesa para el aprendizaje:

- **Planilla:** 4 columnas (baja, sube, desordenada y servida) × 13 categorías = 52 casillas, más una fila de Bonus calculada en cada columna. Una partida tiene 52 turnos por jugador.
- **Turno:** 5 dados y hasta 3 tiros. Después de cada tiro se elige entre anotar o guardar dados y volver a tirar. En cada turno se anota exactamente una casilla, con un puntaje o con una X.
- **Columnas:** baja y sube se llenan en un orden fijo (solo la próxima casilla libre). Desordenada se llena en cualquier orden. En servida solo se anota un puntaje si el último tiro fue de los 5 dados juntos, en cualquiera de los 3 tiros; tachar se puede siempre.
- **Interacciones dentro de una columna:**
  - El Bonus suma 30 si los números del 1 al 6 llegan a 60.
  - El Menor tiene que ser estrictamente menor que el Mayor de la misma columna.
- **Tachar** se puede siempre, aunque haya algo para anotar. Es una decisión estratégica, sobre todo para no trabar baja y sube.
- **Fin:** gana el mayor puntaje total y los empates quedan así. No hay victoria instantánea ni premio por servida.
- **Jugadores:** en la familia se juega de a cualquier cantidad de jugadores o equipos. Un equipo comparte planilla, así que para el motor equivale a un jugador. El modelo arranca jugando solo (v1).

Puntaje máximo teórico: 426 por columna y 1704 por planilla.

## Alcance por versiones

El proyecto se hace en tres versiones, cada una apoyada en la anterior: primero un jugador, después dos, y al final la cámara.

| Versión | Qué hace | Recompensa | Para qué sirve |
| --- | --- | --- | --- |
| v1 | Juega sola, un jugador | Maximizar el puntaje final | Validar el motor, las reglas y el entrenamiento; fija una vara de comparación |
| v2 | Juega contra un rival (self-play) | Ganar o perder, sin importar por cuánto | Que aparezca el comportamiento competitivo: asegurar si va ganando, arriesgar si va perdiendo |
| v3 | Sugiere jugadas sobre una partida real | No aplica (usa el agente ya entrenado) | Primero con los dados ingresados a mano, después leídos por cámara |

Fuera de alcance por ahora: nube, APIs externas, modelos preentrenados y cualquier hardware especial.

## Cómo funciona el aprendizaje

No se le enseña a jugar: se le dan las reglas y una recompensa, y descubre la estrategia por su cuenta. Es código escrito desde cero, no un modelo ya hecho.

**El modelo.** Es una red neuronal chica, de unas pocas capas, que se arma con PyTorch. Recibe el estado del juego y devuelve una puntuación para cada acción posible. Las acciones ilegales se descartan (se enmascaran).

- **Estado:**
  - Los 5 dados y qué tiro es (1, 2 o 3).
  - Si el último tiro fue servido.
  - La planilla con sus **valores**, no solo qué casillas están llenas: hacen falta para el Bonus (cuánto falta para 60 en cada columna) y para la restricción entre Menor y Mayor.
  - En la v2, también la planilla del rival.
- **Acciones:**
  - Guardar: 32 subconjuntos de dados. Guardar ninguno es tirar los 5 juntos, o sea, un tiro servido.
  - Anotar: hasta 52 casillas, cada una con su puntaje o con una X.

**El ciclo.** Empieza con pesos al azar, así que juega mal. Termina una partida, ve cuánto sacó y ajusta sus pesos un poco: las decisiones de las partidas buenas se vuelven más probables y las de las malas, menos. Se repite millones de veces.

**Qué aporta la librería.** PyTorch hace dos cosas: multiplicar matrices rápido y calcular automáticamente hacia dónde mover cada peso (backpropagation). No sabe nada de generala; todo el conocimiento sale de las partidas que simula tu código.

**La curva de aprendizaje.**

1. Arranque: juega al azar.
2. Mejora rápida: en las primeras miles de partidas aprende lo básico, como guardar pares y no tachar casilleros valiosos.
3. Meseta lenta: mejora poco y de a poco; ahí aparecen las decisiones finas.

**Dificultad central.** Una decisión del turno 3 puede definir el resultado 50 turnos después, y la red tiene que descubrir cuál decisión fue la buena. Por eso hacen falta tantas partidas.

## La recompensa

En la v1 la recompensa es el puntaje final; en la v2 pasa a ser ganar o perder, y eso hace que aparezca solo el comportamiento competitivo que describiste.

**v2: ganar o perder.** Por ejemplo +1 si gana, -1 si pierde y 0 si empatan. Un 300 a 299 vale lo mismo que un 300 a 100. Nadie programa "arriesgate más si vas perdiendo": al importarle solo ganar, aprende a asegurar cuando va arriba y a apostar a la jugada rara cuando va abajo y quedan pocos casilleros. Para eso la red tiene que ver la planilla del rival y cuántos turnos quedan.

**Dos problemas que trae.**

- La señal es escasa: recibe una sola respuesta al final de más de 100 decisiones (52 turnos), y aprende más lento.
- El rival cambia: si juega contra una copia de sí mismo, ambos mejoran a la vez y el entrenamiento puede volverse inestable.

**Cómo se manejan.**

- Entrenar por etapas: primero maximizar puntaje, después pasar a ganar o perder.
- Que la red estime su probabilidad de ganar en cada momento, para tener señal antes del final.
- Jugar contra un grupo de versiones viejas de sí misma, no solo la última.

**A evitar.** Premiar la diferencia de puntos. Entrena a un jugador que quiere ganar por mucho, y eso lo vuelve poco conservador justo cuando conviene serlo.

## Piezas técnicas y hardware

Alcanza con Python y una notebook común: no hace falta GPU ni internet una vez instaladas las librerías.

| Pieza | Qué hace |
| --- | --- |
| Motor del juego | Reglas, puntaje y dados al azar |
| Entorno | Conecta el motor con el agente: estado, acción, recompensa |
| Agente | La red neuronal que decide qué guardar y dónde anotar |
| Entrenamiento y evaluación | Simula partidas, ajusta la red y mide puntaje promedio y partidas ganadas |
| Baselines | Jugador al azar, jugador codicioso y, si se puede, un solver exacto para comparar |

**Software.** Python, NumPy y PyTorch (o Stable-Baselines3 si se quiere algo más armado).

**Hardware.** Una CPU de notebook alcanza. Una placa de video acelera el entrenamiento, pero la red es chica y no la necesita. Las estimaciones de tiempo (horas para cientos de miles de partidas) no están medidas y se confirman en la práctica.

**Sobre el solver exacto.** Con 4 columnas el espacio de estados es enorme, así que probablemente sea inviable. Sí se puede hacer sobre una versión reducida, por ejemplo una sola columna, para tener una vara de comparación.

**Claude Code.** Sirve para escribir el motor, los tests y el entrenamiento, y para correr experimentos en tu máquina e iterar viendo resultados. Durante el entrenamiento no participa.

## Registro de decisiones y análisis

La red solo produce números, no razones, pero registrando sus decisiones se puede reconstruir qué hace y cuándo. Conviene diseñar el registro desde el día uno, porque agregarlo después es más molesto.

**Qué guardar por decisión:** los dados, el número de tiro, el estado de la planilla, lo que eligió y el valor que le asignó a cada alternativa.

**Cómo analizarlo.**

- Valores por opción: ver cuán clara fue cada decisión y cuánto pierde con la segunda mejor.
- Patrones en el registro: por ejemplo, qué anota casi nunca al principio de una columna.
- Situaciones de prueba: armar una mano, cambiar un solo detalle y ver cómo cambia la decisión.
- Comparación con humanos: mirar solo los momentos donde difiere de lo que harían ustedes.

**Cuánto pesa.** Cuenta aproximada: con 52 turnos y hasta 3 decisiones por turno (2 de guardar y 1 de anotar), una partida tiene entre 52 y 156 decisiones, unas 130 en la práctica. Cada decisión pesa unos 400 bytes.

| Partidas guardadas | Peso aproximado |
| --- | --- |
| 1 | 50 KB |
| 1.000 | 50 MB |
| 1.000.000 | 50 GB |

Por eso no se guarda todo. Durante el entrenamiento se guarda una de cada mil partidas, o solo estadísticas resumidas. Cada cierto tiempo se congela la red, se la hace jugar unas mil partidas y se guardan completas; ahí se analiza su lógica y se compara cómo jugaba al principio y al final. Formato binario comprimido (NumPy o Parquet), no texto. Total esperado: cientos de MB.

## Snapshots y versiones

Cada cierto tiempo el entrenamiento guarda en un archivo los pesos de la red; ese archivo es un snapshot que juega sin aprender nada nuevo. Para una red de este tamaño se estima de unos KB a pocos MB.

**Qué se guarda junto con los pesos.**

- La codificación del estado: cómo se convierten los dados y la planilla en números.
- La versión de las reglas con las que se entrenó.
- El puntaje medido en la evaluación de esa versión.

**Para qué sirven las versiones.**

- Comparar la versión temprana contra la final y ver cómo cambió su juego.
- Ser el grupo de rivales viejos de la v2.
- Volver atrás si un entrenamiento empeora.

**Cuidado.** Si cambian las reglas o la codificación, los snapshots viejos dejan de servir.

**Llevarlo a otro lado (opciones para más adelante).** Copiar el archivo y el código a otra computadora. Exportarlo a ONNX, un formato estándar que corre sin PyTorch, incluso en un navegador o un celular. Competir online con el modelo en el navegador o con un servidor chico que responde cada jugada.

## Plan por etapas

> **Pendiente:** en el documento original esta sección era un bloque embebido ("plan por etapas · 7 etapas, cada una con su condición de paso") que no se exportó. Hay que transcribir acá las 7 etapas y sus condiciones de paso.

Las reglas eran la única etapa que bloqueaba a las demás, y ya están cerradas. No hay fechas: se ponen cuando decidas arrancar.

## Riesgos y preguntas abiertas

Las reglas ya están escritas y confirmadas ([`REGLAS.md`](REGLAS.md), versión 1.0), así que el motor se puede empezar.

**Riesgos.**

- Con 4 columnas el espacio de estados es enorme: el solver exacto probablemente no sea viable y el entrenamiento puede tardar más de lo estimado.
- En la v2 la señal de aprendizaje es escasa y el rival cambia, lo que puede volver inestable el entrenamiento.
- La cámara (v3) es un problema aparte, de visión por computadora, y es la parte más laboriosa.

**Preguntas abiertas.**

- [x] ¿Cuáles son las reglas exactas de cada columna, el puntaje de cada juego y el significado de servida? Ver [`REGLAS.md`](REGLAS.md).
- [x] ¿Hay reglas especiales, como victoria instantánea o tachado de casilleros? No hay victoria instantánea. Se puede tachar cualquier casilla salvo el Bonus.
- [ ] ¿La v1 maximiza el puntaje total de la planilla completa o hay otro criterio?
- [ ] ¿Qué hardware hay disponible (procesador, memoria, si hay placa de video)?
