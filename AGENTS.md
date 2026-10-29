# AGENTS.md

Contexto para agentes de código (Claude Code y otros) que arrancan una sesión nueva en este repo. Leer esto primero.

## Qué es el proyecto

**generalito**: una IA que aprende sola, por aprendizaje por refuerzo, a jugar la generala de 4 columnas que se juega en la familia de Facu desde hace 20 años. Al no existir esta variante en ningún lado, no hay modelo hecho: todo se escribe desde cero.

- Documento de producto: [`docs/PRD.md`](docs/PRD.md). Es un **primer disparador**, no un contrato: se ajusta sobre la marcha.
- Reglas del juego: [`docs/REGLAS.md`](docs/REGLAS.md). **Fuente de verdad del motor.**
- Decisiones tomadas: [`docs/DECISIONES.md`](docs/DECISIONES.md).

## Estado actual

> Actualizar esta sección al cerrar cada etapa.

- **Etapa:** 4, v1 agente solitario (las etapas 2 y 3 se dan por cumplidas: Facu prefiere avanzar al modelo antes que revisar partidas a mano).
- **Hecho:**
  - motor (reglas 1.0) con tests, registro, controles de recursos;
  - interfaz en el navegador (Entrenar, Jugar, Simulaciones);
  - agente PPO (`generalito/agente/`), con examen periódico contra jugadores de referencia (azar y codicioso);
  - modelos con nombre desde la interfaz (`modelos/`);
  - pestaña Análisis: qué aprendió un modelo (mapas de calor y estadísticas) y comparación de dos modelos.
  - opciones de entrenamiento: horizonte, exploración, tamaño de la red, Pista del Bonus y objetivo ("Máximo puntaje", "Puntos + premio si llega a X" o "Superar X", este último solo siguiendo un modelo) y calentamiento del valor al cambiar de objetivo.
- **Condición de paso de la etapa 4:** superar al codicioso por 100 puntos de promedio. Meta: 950 a 1050 (nivel familia).
- **Cómo prefiere trabajar Facu:** respuestas cortas, sin jerga, sin tareas manuales de revisión. Quiere ver al modelo aprender, no documentos. Para el análisis prefiere datos (gráficos, estadísticas, mapas de calor), no textos generados ni nada que use APIs de AI.

## Reglas de trabajo

1. **No inventar reglas del juego.** Si algo no está marcado como confirmado en `docs/REGLAS.md`, preguntar. Las hipótesis del documento no son reglas. Ante una ambigüedad, frenar y consultar antes que asumir: un supuesto equivocado cambia la estrategia que aprende la red.
2. **Todo local.** Nada de APIs externas, servicios en la nube ni modelos/pesos preentrenados. Las dependencias se instalan una vez y después el proyecto corre sin internet.
3. **CPU primero.** La red es chica; el código tiene que andar bien en una notebook sin GPU. La GPU es opcional, nunca requerida.
4. **Avanzar por versiones y etapas.** v1 (un jugador) → v2 (self-play) → v3 (sugeridor). No adelantar trabajo de una versión que todavía no empezó, salvo que se pida.
5. **Registrar decisiones.** Toda decisión de diseño no trivial (codificación del estado, algoritmo de RL, formato de snapshots, etc.) va a `docs/DECISIONES.md` con su porqué.
6. **Mantener este archivo al día.** Si cambia el estado, la estructura o una convención, actualizar `AGENTS.md` en el mismo commit.
7. **No sesgar al modelo.** No meter conocimiento humano de cómo jugar en nada que use el entrenamiento:
   - sin *reward shaping*, salvo la única excepción de abajo;
   - sin variables de estado armadas a mano que sugieran estrategias;
   - sin imitar partidas ni heurísticas humanas;
   - sin comentarios de estrategia en `docs/REGLAS.md`.

   **Excepción controlada: la "Pista del Bonus"** (`generalito/agente/pista.py`, DECISIONES 2026-10-28). Es *shaping* basado en potencial: Φ = Σ por columna de 30 × min(suma de números / 60, 1), y cada paso suma peso × (Φ después − Φ antes), con Φ = 0 en el estado final. Sumado en una partida da 0, así que el puntaje final no cambia. Está apagada por defecto; cuando se usa, el peso baja linealmente a 0 en un porcentaje del entrenamiento y después la recompensa es pura. Queda registrada en el modelo (`pistas`). No agregar otra pista ni cambiar esta sin una decisión nueva de Facu en `docs/DECISIONES.md`.

   Los baselines y las metas (por ejemplo, la familia suele hacer entre 950 y 1050 puntos) solo sirven para evaluar. Ver "Sin sesgo humano" en el PRD.
8. **Cuidar el equipo de Facu.** Todo programa que corra muchas partidas o entrene sigue el esqueleto de `generalito/simular.py`:
   - `Limites` + `aplicar_limites_proceso()` al arrancar, antes de importar PyTorch;
   - `Guardian.revisar()` entre lotes;
   - registro con límite de disco;
   - `estado.json` con el progreso.

   Nada corre sin máximo de partidas o de tiempo. La GPU va apagada salvo que se pida.
9. **Facu usa la interfaz, no la terminal.** Toda función nueva que tenga que usar o mirar (entrenar, evaluar, ver un agente jugar, análisis) se expone también en `generalito/interfaz/`, con textos simples en español. Las simulaciones largas se lanzan como subproceso y la interfaz lee su `estado.json`. Solo una a la vez.
10. **Idioma.** Documentación, commits y conversación en español. En el código, los nombres del dominio van en español (`planilla`, `tirada`, `anotar`, `servida`). Los términos técnicos genéricos pueden ir en inglés.

## Principios de diseño (del PRD, aplican cuando haya código)

- **Motor puro y determinístico.** El motor del juego no sabe nada de redes ni de PyTorch. Recibe un RNG con semilla, para poder reproducir cualquier partida.
- **Reglas versionadas.** El motor expone una versión de reglas. Cambiarlas invalida los snapshots viejos, y eso tiene que ser explícito.
- **Codificación del estado versionada.** Igual que las reglas: el snapshot guarda con qué codificación se entrenó.
- **Acciones ilegales enmascaradas**, no penalizadas.
- **Registro de decisiones desde el día uno:** dados, número de tiro, planilla, acción elegida y valor de cada alternativa. Formato binario comprimido (NumPy/Parquet), muestreado durante el entrenamiento (≈1 de cada 1000 partidas) y completo en las evaluaciones periódicas.
- **Snapshots** = pesos + versión de reglas + versión de codificación + métricas de evaluación.
- **Baselines antes que RL:** jugador al azar y codicioso (y un solver exacto sobre una versión reducida, si es viable) para tener una vara.
- **v2:** recompensa ganar/perder (+1/0/-1). **Nunca** premiar la diferencia de puntos.

## Estructura del repo

```
README.md               presentación y cómo usarlo
AGENTS.md               este archivo
CLAUDE.md               importa AGENTS.md (para Claude Code)
pyproject.toml          proyecto uv: dependencias, comandos, pytest y ruff
docs/
  PRD.md                documento de producto
  REGLAS.md             reglas del juego (fuente de verdad)
  PARTIDA_EJEMPLO.md    partida completa de ejemplo (se usa en los tests)
  DECISIONES.md         registro de decisiones
generalito/
  motor/                reglas puras, sin NumPy ni PyTorch
    categorias.py       categorías y puntaje (§5)
    planilla.py         columnas, restricciones, Menor/Mayor, Bonus y total
    dados.py            fuentes de dados: azar, reservada, guionada
    jugadas.py          codificación de las 135 jugadas
    partida.py          turnos, tiros y jugadas legales de un bando
  registro.py           registro de decisiones en .npz con límite de disco
  recursos.py           Limites y Guardian (CPU, RAM, disco, GPU, PARAR, Ctrl+C)
  simular.py            comando generalito-simular (jugador al azar)
  mostrar.py            comando generalito-mostrar (una partida para revisar)
  historial.py          partida que anota cada turno (lo usan mostrar y la interfaz)
  evaluar.py            jugadores de referencia (azar, codicioso) y examen con dados reservados
  analisis.py           estadísticas de un modelo y comparación de dos (solo para mirar)
  agente/
    codificacion.py     estado → vector (versión 1)
    red.py              red PPO, snapshots, probabilidades y elegir
    entrenar.py         comando generalito-entrenar (PPO)
    entornos.py         partidas en paralelo (varios procesos) y recompensa por paso
    pista.py            Pista del Bonus (única excepción de shaping, apagada por defecto)
  interfaz/             interfaz local en el navegador (comando generalito)
    servidor.py         servidor HTTP de la biblioteca estándar, solo en 127.0.0.1
    pagina.html         la página: HTML + JS sin librerías ni internet
Abrir generalito.bat    doble clic en Windows
Abrir generalito.command  doble clic en Mac/Linux
tests/
corridas/               salidas de las corridas (no se versiona)
modelos/                modelos con nombre (<nombre>.pt + <nombre>.json); sí se versiona
```

## Comandos

```bash
uv sync                       # instalar
uv run generalito             # interfaz en el navegador
uv run pytest                 # tests
uv run ruff format . && uv run ruff check .
uv run generalito-mostrar --semilla 5
uv run generalito-simular --partidas 10000 --registrar-cada 1000
uv run generalito-entrenar --minutos 60 [--desde corridas/<x>/modelo.pt]
```

Antes de cada commit: `ruff format`, `ruff check` y `pytest` sin errores.

## API del motor (resumen)

- `Partida(fuente)` arranca con el tiro 1 del turno 1 ya hecho.
- `partida.jugadas_legales()` devuelve una lista de enteros de 0 a 134. `partida.mascara_legal()` devuelve 135 booleanos.
- `partida.aplicar(jugada)` ejecuta la jugada y lanza `JugadaIlegal` si no está permitida.
- El estado se lee de `partida.dados`, `partida.tiro`, `partida.ultimo_tiro_servido`, `partida.turno` y `partida.planilla.casillas`. Las casillas son 52 enteros: -1 libre, 0 tachada, mayor que 0 puntaje.
- `VERSION_REGLAS` está en `generalito/motor/__init__.py` y tiene que coincidir con `docs/REGLAS.md`.

## Herramientas

- **Entorno y dependencias:** `uv`.
- **Tests:** `pytest`.
- **Lint y formato:** `ruff`.

## Pendiente de definir

- Sistema operativo de Facu (por las capturas parece Windows; falta confirmarlo).

## Hardware de Facu

- CPU de 24 núcleos lógicos, 31.7 GB de RAM, GPU NVIDIA RTX 5080 (`nvidia-smi` responde: la temperatura se lee bien).
- Referencia medida: el simulador con jugador al azar hace unas 340 partidas por segundo con un solo núcleo.
