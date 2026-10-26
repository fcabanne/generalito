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
