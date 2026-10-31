# Registro de decisiones

Decisiones de diseño tomadas, con el porqué. Una entrada por decisión, la más nueva arriba. Si una decisión se revierte, no se borra: se agrega una nueva que la reemplaza.

Formato:

```
## AAAA-MM-DD · Título corto
**Contexto:** qué problema había.
**Decisión:** qué se eligió.
**Alternativas descartadas:** qué más se consideró y por qué no.
**Consecuencias:** qué implica a futuro.
```

---

## 2026-10-31 · Profesor y alumna en Aprender pensando

- **Contexto:** con v5, la red de 256 llega a coincidir con la búsqueda en el 67% de las decisiones y no sube más. Puede ser que a esa red no le alcance el tamaño para copiar lo que hace la búsqueda.
- **Decisión:** en "Aprender pensando" se puede elegir una **red alumna nueva** (512 o 1024; `--alumna-oculta`). El modelo elegido es el **profesor**: piensa y genera las partidas. La alumna arranca de cero (pesos al azar, 0 partidas) y aprende solo de esas partidas, con los mismos objetivos que antes (política = top 8 de la búsqueda; valor = mezcla de valor de la búsqueda y retorno real).
  - Al arrancar se examina al profesor sin pensar y pensando (mismas partidas fijas). Esa es la vara. La alumna no tiene examen en el ciclo 0.
  - **Relevo:** cuando el examen pensando de la alumna supera al del profesor (con el criterio del objetivo del modelo: promedio, premio o % que supera X), desde el ciclo siguiente piensa la alumna. El relevo es definitivo y queda en el estado y en el modelo (`relevo_ciclo`).
  - Antes del relevo la memoria guarda más ciclos (10 en vez de 3, `--ciclos-memoria-alumna`): las partidas del profesor no se vuelven viejas porque el profesor no cambia, y a una red que empieza de cero le sirven más datos.
  - Hace falta el examen pensando: sin él no hay cómo decidir el relevo.
  - El modelo guardado registra al profesor (`entrenamiento.profesor`). Las `pistas` se heredan del profesor, como linaje.
- **Por qué:** sacar la duda de si el techo es del tamaño de la red. Que la alumna parta de cero evita arrastrar lo que la red chica no pudo aprender. Seguir pensando con el profesor hasta que la alumna lo supere evita que las partidas empeoren mientras ella todavía juega mal.
- **Sin sesgo humano:** todo sale de la búsqueda y de la red del profesor, que también aprendió sola.
- **Interfaz:** Entrenar → modo "Aprender pensando" → "Red que aprende". La tarjeta muestra quién piensa y el examen del profesor, y el gráfico agrega sus dos niveles como líneas de referencia.

## 2026-10-30 · Aprender pensando (fase 2, "expert iteration")

**Contexto:** el examen de v3.0.99 dio 853 sin pensar y 943 pensando (45% llega a 950). Facu quiere que la red aprenda de lo que decide pensando, sin nada humano.

**Decisión:** `generalito/agente/aprender.py` (`generalito-aprender`), en ciclos:

1. **Generar:** el modelo juega N partidas pensando el turno (`--partidas-ciclo`, 500 por defecto), en varios procesos, con dados al azar (no los del examen). De cada decisión se guarda:
   - la situación en crudo (dados, tiro, servido, turno, planilla) y qué jugadas eran legales;
   - las 8 mejores opciones de la búsqueda, como probabilidades: softmax de sus valores con una temperatura de 5 puntos (`--temperatura`);
   - el valor que calculó la búsqueda en esa decisión y, al terminar la partida, lo que realmente se consiguió desde ahí, según el objetivo del modelo.
2. **Variedad controlada:** con probabilidad `--variedad` (0.15 por defecto) no juega la mejor opción, sino que sortea entre las 8 mejores según esas probabilidades. Así la red no ve siempre las mismas situaciones.
3. **Aprender:** con los últimos 3 ciclos (`--ciclos-memoria`):
   - **Política:** imita las probabilidades de la búsqueda. Las formas equivalentes de guardar dados (los mismos valores en distintas posiciones) cuentan como una sola opción; si no, la red aprendería posiciones arbitrarias.
   - **Valor:** aprende una mezcla: 70% el valor que calculó la búsqueda en esa decisión (estable) y 30% lo que realmente se consiguió (`--peso-busqueda`). Con solo lo conseguido, la señal de pocas partidas es muy ruidosa y en las pruebas el valor se deterioraba (bajaba también el promedio pensando).
4. **Examen por ciclo:** las 500 partidas fijas, sin pensar y pensando, con promedio y % que llega a 950. `mejor.pt` es el de mejor examen pensando (según el objetivo del modelo).

- **Solo desde un modelo entrenado**, y se mantiene su objetivo (puntaje, mixto o "Superar X") porque el valor de la red está en esa escala. No se usa la Pista del Bonus.
- **Recursos:** las partidas se guardan comprimidas en `datos/` (menos de 1 MB cada 100 partidas) y el entrenamiento frena si superarían el límite de disco. Se respetan los mismos límites y el Guardian que en el resto. De las redes de cada ciclo se guardan solo las últimas 2.
- **Interfaz:** en Entrenar, modo "Aprender pensando", con minutos, núcleos, partidas por ciclo y variedad. La tarjeta muestra el ciclo, los exámenes sin pensar y pensando con su gráfico, cuánto coincide la red sola con la búsqueda y los datos guardados.
- **Nada humano:** la búsqueda solo usa las reglas y la propia red; la red imita a la búsqueda, no a personas.

**Prueba de 20 minutos acá** (3 núcleos; modelo de prueba de 643 puntos; 150 partidas por ciclo; 13 ciclos; 2.100 partidas; 12 MB de datos): sin pensar, de 643 a 742; pensando, de 893 (21% llega a 950) a 910 (36%). La red sola coincide con la búsqueda en el 36% de las decisiones al principio y en el 49% al final. En los primeros 2 o 3 ciclos las dos bajan, mientras la red aprende otra forma de guardar dados: al principio coincide con la búsqueda solo en el 18% de esas decisiones, contra 66% a 90% al anotar. Después se recuperan y suben. Con el valor aprendiendo solo de lo conseguido (sin la mezcla), el promedio pensando bajaba de 893 a 865 en 3 ciclos.

---

## 2026-10-30 · Pensar el turno (fase 1: solo para jugar y evaluar)

**Contexto:** los modelos se estancan cerca de 850. Facu quiere que el modelo "piense" antes de jugar usando solo las reglas y su propia red, sin heurísticas humanas.

**Decisión:**

- **Búsqueda exacta dentro del turno (expectimax),** en `generalito/agente/pensar.py`. Se calcula una vez por turno, para la planilla de ese turno:
  - Los dados se tratan como multiconjunto (252 combinaciones de 5 dados; 210 formas de guardar de 0 a 4). Las probabilidades de cada resultado al volver a tirar son exactas (tabla de transición de 210 × 252).
  - Tiro 3: la mejor anotación. Tiros 1 y 2: el máximo entre anotar ya y cada forma de guardar, con su valor esperado exacto. Se distingue si el tiro fue servido (para la columna Servida).
  - **Valor de anotar** = lo que gana esa anotación, según el objetivo con el que se entrenó el modelo (puntos, puntos + premio, o 1/0 en "Superar X"), más la estimación de valor de la red para la planilla que queda. Esa estimación se promedia sobre el primer tiro del turno siguiente.
- **Promedio sobre el turno siguiente:** con K tiradas al azar (`--muestras`, 32 por defecto), las mismas para todas las opciones del turno, así se comparan con la misma suerte. Con K = 0 se usan las 252 combinaciones con sus probabilidades exactas; es unas 9 veces más lento, y cuánto mejora queda por medir. No hizo falta una red de "después de anotar": el promedio con muestras alcanza y no requiere entrenar nada nuevo.
- **Sin heurísticas:** la búsqueda solo conoce las reglas (las jugadas legales y los puntajes del motor) y usa la red ya entrenada. Es la misma idea que la política de la red, pero con un paso de búsqueda exacto en el turno.
- **Dónde está** (siempre opcional):
  - Análisis: "Pensar el turno" en Analizar, "piensa" para cada lado en Comparar (se puede comparar un modelo consigo mismo si un lado piensa), y el botón "Examen: sin pensar vs pensando" (las 500 partidas fijas del examen).
  - Jugar: "Pensar el turno" para las sugerencias (muestran el puntaje final esperado de cada opción) y para que el modelo juegue solo.
  - Entrenar: "Examen pensando: N partidas". En cada examen juega además las primeras N partidas pensando y las compara con las mismas N sin pensar. No cambia cómo se elige `mejor.pt`.
- **Recursos:** como es lento, juega en varios procesos (`--hilos`, por defecto la mitad de los núcleos) con prioridad baja, y el Guardian revisa los límites a medida que terminan las partidas. Se mide y se muestra el tiempo por partida.

**Consecuencias:** pensar no entrena a la red. Si mejora mucho, la fase 2 sería entrenar a la red para que imite lo que decide pensando, a definir con Facu.

---

## 2026-10-29 · Objetivo mixto: puntos + premio por llegar a X

**Contexto:** con "Superar 950" (todo o nada), Facu ve que el modelo se desarma apenas termina el calentamiento: baja de 850 a 760 en un par de minutos. Con una sola señal de 0 o 1 al final, casi todas las partidas valen 0 y la política pierde lo que sabía.

**Decisión:**

- **Objetivo "Puntos + premio si llega a X"** (`--objetivo mixto --umbral X --premio P`; en la interfaz, X = 950 y P = 100 por defecto). La recompensa son los puntos normales de cada anotación y, en la última jugada, P puntos extra si el total llega a X (total ≥ X). Sumado en la partida: total + P × [total ≥ X].
- **Es otro objetivo, no una pista:** cambia qué se optimiza (el promedio más P veces la chance de llegar a X). No adelanta nada ni sugiere cómo jugar. Es el término medio entre "Máximo puntaje" (P = 0) y "Superar X" (solo el premio).
- **Se puede usar desde un modelo entrenado y también desde cero**, porque la señal no es escasa: sigue habiendo puntos en cada anotación. Se combina con la Pista del Bonus, porque los dos están en puntos.
- **Calentamiento sin reinicio:** al pasar de "Máximo puntaje" a mixto, la estimación de valor está en la misma escala (puntos), así que no se reinicia. Solo se recalibra durante el calentamiento, con la política quieta. Regla general: el valor se reinicia solo si cambia la escala (puntos ↔ chance de "Superar X"), y el calentamiento se activa siempre que cambie el objetivo.
- **Mejor modelo:** se elige por lo que se optimiza: promedio + P × % que llega a X (`puntaje_mixto` en cada examen). Los exámenes y Análisis informan también el % que llega a X y a 950.

**Consecuencias:** si P es chico frente a la diferencia de puntos que cuesta arriesgarse, el modelo va a jugar casi igual que con "Máximo puntaje". Si es muy grande, se parece a "Superar X". Conviene probar con varios valores de P.

---

## 2026-10-29 · Calentamiento de la estimación de valor al cambiar de objetivo

**Contexto:** al pasar de "Máximo puntaje" a "Superar X" se reinicia la salida de valor de la red. En una prueba corta, el % de partidas que llegaba a X bajó en los primeros exámenes (25% → 15% → 11%). Mientras la estimación de valor está recién reiniciada, las ventajas que guían a la política son casi ruido, y la política se mueve sin rumbo.

**Decisión:**

- **Calentamiento:** durante las primeras tandas (`--calentamiento`, por defecto 5% del entrenamiento) solo se recalibra la estimación de valor. La política y las capas compartidas (el tronco) no se tocan: el tronco se usa sin gradiente y solo se ajusta la última capa de valor, con su propio optimizador. Después, el entrenamiento sigue normal.
- **Solo al cambiar de objetivo:** se activa únicamente si el objetivo es distinto al del modelo que se sigue (cuando se reinicia el valor). Si se sigue con el mismo objetivo, no hay calentamiento aunque se pida.
- Si calienta o no se decide al empezar cada tanda, según el progreso del entrenamiento (minutos o partidas, lo que llegue primero), igual que la Pista del Bonus.
- **Interfaz:** en Entrenar, el campo "Calentamiento (%)" junto al Objetivo, habilitado solo siguiendo un modelo. La tarjeta muestra el % y si está activo ("ahora: solo recalibra el valor") o terminado, y la curva marca las tandas de calentamiento en el tooltip. Queda en `config.json` (`calentamiento_pct`, 0 si no aplicó) y en el snapshot (`entrenamiento.calentamiento_pct`).
- **No es una pista:** no cambia la recompensa ni le dice nada de cómo jugar. Solo ordena el aprendizaje: primero aprende a estimar, después a decidir.

**Test:** con un cambio de objetivo y el calentamiento cubriendo todo el entrenamiento, todos los pesos de la política y del tronco quedan idénticos y solo cambian los de la salida de valor. Siguiendo con el mismo objetivo no hay calentamiento y la política sí cambia.

---

## 2026-10-29 · Objetivo "Superar X puntos" (otro objetivo, no una pista)

**Contexto:** todos los modelos se estancan cerca de 850 con la misma estrategia: el Bonus casi solo en Desordenada. Facu cree que maximizar el promedio lo lleva a jugar seguro, y quiere probar otro objetivo sin enseñarle cómo jugar.

**Decisión:**

- En Entrenar, "Objetivo": "Máximo puntaje" (como hasta ahora: los puntos de cada anotación) o "Superar X puntos" (X configurable, 950 por defecto). Línea de comandos: `--objetivo puntaje|superar` y `--umbral X`.
- **Con "Superar X", la recompensa es solo al final:** 1 si el total llega a X (total ≥ X) y 0 si no. Nada en el medio de la partida.
- **No es una pista ni *reward shaping*:** cambia qué se optimiza (la probabilidad de llegar a X en vez del promedio) y no sugiere cómo jugar. Es parecido a la recompensa ganar/perder de la v2, contra un rival fijo que siempre hace X puntos. La Pista del Bonus sigue siendo la única excepción de la regla 7, y no se combina con este objetivo: la pista está en puntos y este objetivo no.
- **Solo siguiendo un modelo entrenado**, no desde cero: con una sola señal de 0/1 al final, un modelo que juega al azar casi nunca llegaría a X y no tendría de qué aprender. La interfaz no lo ofrece empezando de cero y el entrenamiento lo rechaza sin `--desde`.
- **Estimación de valor reiniciada:** si el objetivo cambia respecto del modelo que se sigue, se reinicia solo la salida de valor de la red, que estimaba otra cosa (puntos que faltan o la chance de otro X). La política, lo que sabe jugar, se conserva. Queda anotado en `config.json` (`valor_reiniciado`).
- **El mejor modelo se elige por lo que se optimiza:** con "Superar X", `mejor.pt` es el de mayor % de partidas que llegan a X en el examen, no el de mejor promedio. Cada examen marca cuál fue elegido (`mejor`), y "Mis modelos" muestra ese examen.
- **Medición:** todos los exámenes informan el % de partidas que llegan a 950, y con "Superar X" también el % que llega a X. Análisis muestra lo mismo: 950 siempre, más el X de cada modelo que se entrenó con ese objetivo, y en Comparar, para los dos modelos. El modelo guarda su objetivo en `entrenamiento.objetivo`.

**Consecuencias:** el promedio puede bajar aunque el modelo mejore en lo que se le pide. Para comparar contra un modelo de "Máximo puntaje", mirar el % que llega a X con los mismos dados (Comparar en Análisis).

---

## 2026-10-29 · Tamaño de la red configurable (solo desde cero)

**Contexto:** todos los entrenamientos se estancan cerca de 850 puntos, sin importar horizonte, exploración ni pista. Facu quiere probar si el límite es la capacidad de la red.

**Decisión:**

- La pestaña Entrenar suma "Tamaño de la red" (`--oculta`: neuronas por cada una de las dos capas ocultas), con las opciones 256 (por defecto), 512 y 1024.
- Solo se elige empezando de cero. Si se sigue un modelo, se usa el tamaño de ese modelo: la interfaz desactiva el campo y el entrenamiento ignora `--oculta` (lo avisa en la salida).
- El tamaño real queda en `config.json` (`parametros.oculta`), en `estado.json` y en el snapshot (`entrenamiento.oculta`), y de ahí al `.json` de los modelos con nombre. Se muestra en la tarjeta del entrenamiento y en la columna "Red" de "Mis modelos".
- **Hilos:** mientras se ajusta la red, los trabajadores esperan, así que la red usa todos los núcleos permitidos. Mientras se juega, sigue con pocos hilos. Antes la red usaba como máximo 4 hilos todo el tiempo, y con redes grandes el ajuste habría sido el cuello de botella.

**Consecuencias:** una red más grande hace cada ajuste más lento, así que juega menos partidas por minuto. Para ver si el tamaño ayuda hay que comparar por partidas jugadas, no solo por minutos.

---

## 2026-10-28 · Excepción controlada a "sin reward shaping": Pista del Bonus

**Contexto:** los modelos casi nunca llegan al Bonus (entre 0.1% y 1.2% de las partidas), y ahí pierden hasta 120 puntos por partida. Facu decide hacer una excepción acotada a la regla "sin *reward shaping*" (decisión del 2026-10-10), solo para el Bonus.

**Decisión:**

- **Qué:** *shaping* basado en potencial (Ng, Harada y Russell, 1999). El potencial es Φ(estado) = Σ por columna de 30 × min(suma de números / 60, 1). En cada paso la recompensa suma peso × (Φ(después) − Φ(antes)). En el estado final Φ = 0, así que todo lo adelantado se descuenta en la última jugada. Sumado en una partida da exactamente 0 y el puntaje final no cambia. Con γ = 1, la política óptima es la misma que sin pista.
- **Peso fijo por partida:** cada partida toma el peso vigente al empezar y lo mantiene hasta terminar. Si el peso cambiara a mitad de partida, la suma dejaría de ser exactamente 0.
- **Rueditas:** el peso arranca en un valor configurable (por defecto 0.5) y baja linealmente a 0 en un porcentaje configurable del entrenamiento (por defecto 50%), medido por el límite que se alcance primero (minutos o partidas). Después, recompensa pura.
- **Interfaz:** en Entrenar, "Pista del Bonus" apagada por defecto, con peso inicial y porcentaje en que se apaga. Se muestra en la tarjeta del entrenamiento con el peso actual. Línea de comandos: `--pista-bonus` (0 = apagada) y `--pista-fin`.
- **Trazabilidad:** el snapshot guarda `entrenamiento.pista` (la de ese entrenamiento) y `pistas` (todas las del linaje, incluidas las de los modelos de los que siguió). Lo mismo queda en el `.json` de los modelos con nombre y en la tabla "Mis modelos".
- **Tests:** la pista suma 0 en partidas completas, y con la pista activa las recompensas que recibe el agente suman exactamente el puntaje final.

**Alternativas descartadas:**

- Variables de estado como "cuánto falta para 60": cambian lo que ve el modelo para siempre, no solo mientras aprende.
- Premio fijo al llegar al Bonus: cambia el objetivo y el puntaje final que se optimiza.
- Pista permanente: queda como empujón temporal; el modelo final se termina de entrenar con recompensa pura.

**Consecuencias:** la regla 7 de `AGENTS.md` y la sección "Sin sesgo humano" del PRD nombran esta única excepción. Cualquier otra pista requiere una decisión nueva. Para comparar con y sin pista hay que mirar el examen y el % de Bonus en Análisis, no la curva de entrenamiento: con la pista activa, esa curva sigue mostrando el puntaje real de las partidas (no incluye la pista), así que es comparable.

---

## 2026-10-28 · Exploración (entropía) configurable y tachadas por tiro

**Decisión:**

- La pestaña Entrenar suma el campo "Exploración (entropía)", con 0.01 por defecto y valores entre 0 y 0.2. Se pasa como `--entropia` y se muestra en la tarjeta de cada entrenamiento. Igual que λ, no dice nada de cómo jugar: solo cuánto se premia que la política no se cierre en una sola jugada.
- El análisis cuenta en qué tiro (1, 2 o 3) se tachó cada casilla (`tachada_por_tiro`) y la pestaña Análisis lo muestra como una barra apilada por casilla. Los análisis viejos no tienen este dato y la sección no aparece.

---

## 2026-10-27 · Horizonte (lambda-gae) configurable desde la interfaz

**Contexto:** el modelo casi nunca llega al Bonus (entre 0.1% y 1.2% de las partidas). Facu sospecha un problema de asignación de crédito: con λ = 0.95 el agente reparte el mérito sobre unos 20 pasos (unos 7 turnos), y el Bonus se arma a lo largo de muchos más.

**Decisión:**

- La pestaña Entrenar suma el campo "Horizonte (lambda-gae)", con 0.95 por defecto y valores entre 0.5 y 1. Se pasa como `--lambda-gae` y se muestra en la tarjeta de cada entrenamiento, junto a los núcleos.
- No es sesgo humano: λ no dice nada de cómo jugar. Solo cambia cuánto se apoya el aprendizaje en la recompensa real de los pasos siguientes frente a su propia estimación (más λ: menos sesgo y más ruido).

**Experimento previsto:** desde cero, λ = 0.99, 40 minutos, 12 núcleos (el mismo tiempo que acumuló modelo-v2), comparando contra v2 en promedio y en % de Bonus.

---

## 2026-10-26 · Análisis de estrategias y comparación de modelos

**Contexto:** Facu quiere ver qué estrategias aprendió el modelo. Prefiere gráficos y estadísticas basadas en datos, sin textos generados ni AI.

**Decisión:**

- `generalito/analisis.py` hace jugar al modelo 2.000 partidas con dados reservados (una semilla distinta a la del examen del entrenamiento), sin azar, y cuenta cada decisión.
- **Analizar:** por cada casilla, los puntos promedio, el % de veces tachada y el turno promedio en que se llena (mapa de calor). También en qué tiro anota, cuántos dados guarda al volver a tirar, el promedio por columna, el % de partidas que llega al Bonus y la distribución de puntajes.
- **Comparar:** los dos modelos juegan las mismas partidas. Se muestran las victorias, los empates, los promedios y cuántas veces por partida decidirían distinto. Se cuenta desde las situaciones del primer modelo, preguntándole al segundo qué haría.
- Corre como subproceso, con los mismos límites que el resto: la página lee `estado.json`, y corre uno a la vez.

**Alternativas descartadas:** frases automáticas y laboratorio de situaciones. Facu no los quiere por ahora.

**Consecuencias:** nada de esto toca el entrenamiento: es solo para mirar.

---

## 2026-10-26 · Modelos con nombre

**Contexto:** Facu quiere guardar versiones del modelo ("modelo-v1") y poder volver a ellas.

**Decisión:**

- Desde la pestaña Entrenar se guarda el modelo con un nombre. Se copia el `mejor.pt` del último entrenamiento a `modelos/<nombre>.pt`, junto a un `<nombre>.json` con examen, partidas entrenadas, fecha y origen.
- `modelos/` se versiona en git: cada archivo pesa unos 300 KB y así queda respaldado.
- En Jugar se elige qué modelo juega y sugiere. En Entrenar se elige desde cuál seguir (o desde cero).

**Consecuencias:** si cambian las reglas o la codificación, esos archivos dejan de cargar (el snapshot guarda ambas versiones y lo avisa).

---

## 2026-10-26 · Agente v1: PPO, estado crudo y recompensa por anotación

**Contexto:** Facu quiere ir directo al modelo que aprende. La revisión manual de partidas se da por cumplida con los tests (§8, partida de ejemplo y partidas al azar).

**Decisión:**

- **Algoritmo:** PPO con las jugadas ilegales enmascaradas. Una red chica (dos capas ocultas de 256) con dos salidas: un puntaje por cada una de las 135 jugadas y una estimación del puntaje que falta. Juega 256 partidas en paralelo.
- **Estado (codificación versión 1):** dados one-hot por posición, tiro, servido, las 52 casillas (libre / tachada / puntaje) y turno. No hay variables derivadas como "cuánto falta para el Bonus".
- **Recompensa:** lo que sube el total con cada anotación, sin descuento (γ = 1). Sumada en la partida es exactamente el puntaje final, así que no es *reward shaping*: no agrega ninguna idea de cómo jugar. Solo le da al agente la señal antes del final de la partida.
- **Examen:** cada 10 minutos juega 500 partidas fijas (dados reservados) sin azar, siempre con su jugada más probable. Se guarda `modelo.pt` (el último) y `mejor.pt` (el de mejor examen).
- **Jugador codicioso de referencia:** nunca vuelve a tirar y anota donde más sube el total. Solo sirve para comparar.
- **PyTorch en CPU.** La red es chica y el cuello de botella es el motor en Python, no la red. En Windows, el PyTorch de PyPI ya es solo CPU.

**Alternativas descartadas:**

- Recompensa solo al final: es lo mismo en esperanza, pero aprende mucho más lento.
- DQN: con 135 jugadas y máscaras, PPO es más simple y estable.
- Red en NumPy hecha a mano: evitaría la dependencia, pero el PRD ya eligió PyTorch y en la v2 hace falta.

**Consecuencias:** si el motor resulta lento para entrenar millones de partidas, el próximo paso es jugar en varios procesos o pasar el motor a NumPy vectorizado.

---

## 2026-10-26 · Interfaz local en el navegador

**Contexto:** Facu prefiere no usar la terminal. Necesita jugar, lanzar simulaciones, pararlas y ver resultados de forma "normal".

**Decisión:**

- Una página web servida por un servidor local escrito con la biblioteca estándar de Python. Escucha solo en `127.0.0.1` y se abre con `uv run generalito` o con doble clic en `Abrir generalito.bat` / `.command`.
- La página es un solo HTML con JavaScript, sin librerías externas: anda sin internet.
- Las simulaciones corren como subproceso de `generalito-simular`. La página lee su `estado.json` y las para creando el archivo `PARAR`. Corre una sola simulación por vez.

**Alternativas descartadas:**

- Tkinter: se ve viejo y cuesta hacerlo cómodo.
- Streamlit o Gradio: más dependencias, y el modelo de "rehacer toda la página" no se lleva bien con partidas interactivas.
- Una app de escritorio con Electron: demasiado pesada para esto.

**Consecuencias:** cada etapa nueva (entrenar, evaluar, analizar) suma su pestaña o sección en la misma página.

---

## 2026-10-26 · Controles de recursos en todo programa largo

**Contexto:** Facu quiere que simular o entrenar nunca sature la compu (CPU, GPU, RAM o disco) y poder frenarlo cuando quiera.

**Decisión:** todo programa largo usa `generalito/recursos.py`:

- `Limites` con valores conservadores por defecto: máximo de partidas y de minutos (60), la mitad de los núcleos, prioridad baja, RAM máxima del proceso (4 GB), disco máximo de la corrida (2 GB) y disco libre mínimo (10 GB). La GPU va apagada por defecto, y cuando se use, con la mitad de su memoria y pausa a más de 80 °C.
- `Guardian` revisa los límites entre lotes. Si el sistema está saturado (CPU o temperatura de la GPU), pausa. Si se alcanza un límite, se crea el archivo `PARAR` o se aprieta Ctrl+C, frena prolijo y guarda lo hecho.
- El registro verifica el límite de disco antes de escribir cada bloque y no deja archivos a medias.
- Cada corrida escribe `estado.json` con progreso y recursos, para mirarlo sin interrumpir.

**Alternativas descartadas:** confiar en mirar el administrador de tareas, porque no frena nada solo; contenedores o cgroups, porque son demasiado para una notebook y dependen del sistema operativo.

**Consecuencias:** el entrenamiento (etapa 4) tiene que seguir el mismo esqueleto que `generalito/simular.py`.

---

## 2026-10-26 · Motor: fuente de dados inyectable y 135 jugadas

**Contexto:** había que fijar cómo se representan los dados y las jugadas antes de escribir el motor.

**Decisión:**

- **Fuente de dados.** El motor no tira por su cuenta: le pide a una fuente el valor de cada dado según turno, tiro y posición. Hay tres: al azar con semilla (entrenar), reservada por partida, turno, tiro y posición (evaluar con suerte pareja) y guionada (tests). Los dados no se reordenan, así cada posición es estable.
- **135 jugadas.** 0 a 30 son volver a tirar: el número es la máscara de posiciones guardadas y 0 es tirar los 5. 31 a 134 son anotar: `31 + 2 × casilla + (0 puntaje, 1 tachar)`, con `casilla = columna × 13 + categoría`. Las ilegales se enmascaran.
- **Guardar por posición, no por valor.** Es lo más simple y no le sugiere nada al modelo. A cambio hay jugadas equivalentes (guardar "el primer 5" o "el segundo 5").
- **Un número en 0 es solo tachar.** "Anotar 0" y "tachar" son la misma jugada (REGLAS.md §4), así que anotar con puntaje solo es legal si el puntaje es mayor que 0. Por eso en la planilla una X se guarda como 0 y una casilla libre como -1.

**Alternativas descartadas:** guardar por valor (menos jugadas, pero más lógica y más difícil de reservar dados por posición); que el motor use su propio `random` (no permitiría la evaluación con dados reservados).

**Consecuencias:** si la redundancia de guardar por posición frena el aprendizaje, se puede pasar a guardar por valor en la etapa 3, cambiando la versión de la codificación.

---

## 2026-10-11 · Plan por etapas con condiciones de paso medibles

**Contexto:** el plan de 7 etapas del PRD original no se había exportado. Facu lo transcribió y se revisó.

**Decisión:**

- Las condiciones de paso pasan a ser medibles, sobre 10.000 partidas de evaluación con semillas fijas.
- El motor rápido (partidas en paralelo) entra en la etapa 3.
- La v2 se mide contra el agente de la v1, no contra el codicioso.
- La v3 se divide en dados a mano (7a) y cámara (7b).
- En las evaluaciones se usan dados reservados por partida, turno, tiro y posición del dado.

**Alternativas descartadas:**

- Condiciones subjetivas, como "supera claramente" o "se entiende", porque generan discusión sobre si se cumplieron.
- Usar una sola secuencia de azar para comparar modelos: como cada modelo vuelve a tirar dados distintos, los dados se desfasan apenas sus decisiones difieren.

**Consecuencias:** cada etapa tiene un criterio objetivo para avanzar. Los números concretos son una propuesta inicial ajustable.

---

## 2026-10-11 · Herramientas: uv, pytest, ruff; nombres del dominio en español

**Contexto:** había que elegir herramientas antes de escribir código.

**Decisión:**

- `uv` para el entorno y las dependencias.
- `pytest` para los tests.
- `ruff` para lint y formato.
- En el código, los nombres del dominio van en español.

**Alternativas descartadas:**

- `venv` + `pip`: anda, pero es más lento y requiere más pasos manuales.
- Nombres en inglés: es lo habitual, pero términos como "servida", "generala" o "tachar" no tienen buena traducción y el código se alejaría de las reglas.

**Consecuencias:** el código se lee con el mismo vocabulario que `REGLAS.md`.

---

## 2026-10-10 · El modelo aprende sin sesgo humano

**Contexto:** el objetivo es ver qué estrategias descubre el modelo por su cuenta y compararlas con las de la familia. Facu no quiere sesgarlo de ninguna forma.

**Decisión:**

- La recompensa es solo el resultado final.
- El estado es crudo.
- No hay imitación ni heurísticas humanas en el entrenamiento.
- Las reglas no llevan comentarios de estrategia.
- La referencia de la familia (entre 950 y 1050 puntos por partida) es solo una meta de evaluación.

**Alternativas descartadas:**

- *Reward shaping* (por ejemplo, premiar acercarse al Bonus).
- Un jugador "estilo familia" como rival o maestro.
- Variables derivadas como "cuánto falta para 60".

Todas aceleran el aprendizaje, pero le meten la estrategia humana al modelo.

**Consecuencias:**

- El aprendizaje puede ser más lento.
- Las estrategias que aparezcan van a ser propias del modelo, que es lo que interesa.
- Si el entrenamiento no avanza, cualquier ayuda que se agregue se registra acá como una excepción explícita.

---

## 2026-10-10 · Reglas 1.0 cerradas; el orden de turnos multijugador queda para la v2

**Contexto:** las reglas bloqueaban el motor. Facu confirmó todas las que afectan a un jugador solo.

**Decisión:** [`REGLAS.md`](REGLAS.md) pasa a la versión 1.0. El desempate para elegir quién empieza y el orden de turnos con más de 2 bandos se definen antes de la v2, porque la v1 juega sola.

**Alternativas descartadas:** esperar a definir todo antes de empezar el motor. Se descartó porque esas reglas no cambian nada en la v1.

**Consecuencias:**

- El motor se puede empezar.
- Cuando se definan esas reglas, la versión sube a 1.1. Como no cambian el juego de un bando solo, no deberían invalidar los snapshots de la v1.

---

## 2026-10-10 · Decisiones de arranque (heredadas del PRD)

**Contexto:** arranque del repo a partir de [`PRD.md`](PRD.md).

**Decisión:**

- Todo corre local: sin APIs externas, sin nube, sin modelos preentrenados.
- Python + NumPy + PyTorch. CPU alcanza.
- Tres versiones incrementales: v1 un jugador (recompensa = puntaje), v2 self-play (recompensa = ganar/perder), v3 sugeridor sobre partidas reales.
- No se premia la diferencia de puntos en la v2.
- El registro de decisiones del agente se diseña desde el día uno.
- Los snapshots guardan pesos + codificación del estado + versión de reglas + métricas de evaluación.
- Las reglas se escriben y confirman en [`REGLAS.md`](REGLAS.md) antes de escribir el motor.

**Consecuencias:** el motor no se empieza hasta cerrar las preguntas abiertas de las reglas.
