# PRD: IA que aprende a jugar a la generala

Oct 6, 2026 · @Facu

## Visión y objetivo

El objetivo es construir, en tu propia máquina y desde cero, una IA que aprenda sola a jugar a la generala de tu familia: simula miles de partidas, evalúa sus resultados y mejora.

- Todo corre local: sin APIs externas ni modelos ya entrenados.
- Las reglas las definís vos. Es una generala de 4 columnas que se juega en tu familia hace 20 años, así que no existe un modelo hecho para ella.
- Lo que más te interesa es ver qué estrategias detecta la máquina, incluso las que nadie de la familia conoce.
- Meta a largo plazo: una máquina que mire los dados de una partida real y sugiera qué guardar y dónde anotar.

## El juego

La generala de tu familia tiene 4 columnas (baja, sube, desordenada y servida) y todos los juegos se anotan en cada una. Se juega entre 2 jugadores con 5 dados y 3 tiros por turno.

Antes de escribir el motor hay que fijar las reglas por escrito, porque cambian la estrategia. Lo que falta definir:

- Qué juegos hay en cada columna y cuánto vale cada uno.
- Cómo funciona cada columna: si hay un orden obligatorio para llenarla o se anota libremente.
- Qué significa exactamente anotar "servida" (se supone que en el primer tiro, a confirmar).
- Si se puede tachar un casillero, y cuándo.
- Si hay reglas especiales de victoria, como una generala servida.
- Cómo se calcula el puntaje final y qué pasa con los empates.

Supuesto de trabajo: la planilla tiene unos 44 casilleros (4 columnas × 11 juegos). Es una estimación mía, a corregir con las reglas reales.

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

**El modelo.** Es una red neuronal chica, de unas pocas capas, que se arma con PyTorch. Recibe el estado del juego (los 5 dados, qué tiro es, qué casilleros están llenos y, en la v2, la planilla del rival) y devuelve una puntuación para cada acción posible: qué dados guardar o dónde anotar. Las acciones ilegales se descartan.

**El ciclo.** Empieza con pesos al azar, así que juega mal. Termina una partida, ve cuánto sacó y ajusta sus pesos un poco: las decisiones de las partidas buenas se vuelven más probables y las de las malas, menos. Se repite millones de veces.

**Qué aporta la librería.** PyTorch hace dos cosas: multiplicar matrices rápido y calcular automáticamente hacia dónde mover cada peso (backpropagation). No sabe nada de generala; todo el conocimiento sale de las partidas que simula tu código.

**La curva de aprendizaje.**

1. Arranque: juega al azar.
2. Mejora rápida: en las primeras miles de partidas aprende lo básico, como guardar pares y no tachar casilleros valiosos.
3. Meseta lenta: mejora poco y de a poco; ahí aparecen las decisiones finas.

**Dificultad central.** Una decisión del turno 3 puede definir el resultado 40 turnos después, y la red tiene que descubrir cuál decisión fue la buena. Por eso hacen falta tantas partidas.

## La recompensa

En la v1 la recompensa es el puntaje final; en la v2 pasa a ser ganar o perder, y eso hace que aparezca solo el comportamiento competitivo que describiste.

**v2: ganar o perder.** Por ejemplo +1 si gana, -1 si pierde y 0 si empatan. Un 300 a 299 vale lo mismo que un 300 a 100. Nadie programa "arriesgate más si vas perdiendo": al importarle solo ganar, aprende a asegurar cuando va arriba y a apostar a la jugada rara cuando va abajo y quedan pocos casilleros. Para eso la red tiene que ver la planilla del rival y cuántos turnos quedan.

**Dos problemas que trae.**

- La señal es escasa: recibe una sola respuesta al final de unas 40 decisiones, y aprende más lento.
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

**Cuánto pesa.** Cuenta aproximada, con el supuesto de 44 casilleros: unas 130 decisiones por partida y unos 400 bytes por decisión.

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

Las reglas son la única etapa que bloquea a las demás. No hay fechas: se ponen cuando decidas arrancar.

## Riesgos y preguntas abiertas

El riesgo que bloquea todo lo demás es que las reglas todavía no están escritas; sin ellas no se puede armar el motor.

**Riesgos.**

- Con 4 columnas el espacio de estados es enorme: el solver exacto probablemente no sea viable y el entrenamiento puede tardar más de lo estimado.
- En la v2 la señal de aprendizaje es escasa y el rival cambia, lo que puede volver inestable el entrenamiento.
- La cámara (v3) es un problema aparte, de visión por computadora, y es la parte más laboriosa.

**Preguntas abiertas.**

- [ ] ¿Cuáles son las reglas exactas de cada columna, el puntaje de cada juego y el significado de servida?
- [ ] ¿Hay reglas especiales, como victoria instantánea o tachado de casilleros?
- [ ] ¿La v1 maximiza el puntaje total de la planilla completa o hay otro criterio?
- [ ] ¿Qué hardware hay disponible (procesador, memoria, si hay placa de video)?
