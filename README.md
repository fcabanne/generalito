# generalito

Una IA que aprende sola a jugar a la **generala de 4 columnas** de la familia (baja, sube, desordenada y servida), entrenada desde cero con aprendizaje por refuerzo, 100% local.

No se le enseñan estrategias: se le dan las reglas y una recompensa, simula miles de partidas y mejora. Lo que más interesa es **ver qué estrategias descubre**, incluso las que nadie de la familia conoce.

## Estado

🟢 **Etapa 2: motor del juego y registro.** El motor, el registro de decisiones y los controles de recursos están hechos y testeados. Falta que Facu revise algunas partidas nuevas. Ver [`docs/REGLAS.md`](docs/REGLAS.md).

## Hoja de ruta

| Versión | Qué hace | Recompensa |
| --- | --- | --- |
| v1 | Juega sola (un jugador) | Puntaje final |
| v2 | Juega contra un rival (self-play contra versiones viejas) | Ganar / perder |
| v3 | Sugiere jugadas en una partida real (dados a mano, después cámara) | — usa el agente entrenado |

## Documentación

- [`docs/PRD.md`](docs/PRD.md): el documento de producto original (visión, alcance, aprendizaje, registro, snapshots, riesgos).
- [`docs/REGLAS.md`](docs/REGLAS.md): las reglas del juego. Fuente de verdad del motor.
- [`docs/PARTIDA_EJEMPLO.md`](docs/PARTIDA_EJEMPLO.md): una partida completa de ejemplo, turno por turno.
- [`docs/DECISIONES.md`](docs/DECISIONES.md): registro de decisiones tomadas (y por qué).
- [`AGENTS.md`](AGENTS.md): contexto y convenciones para sesiones de agentes de código (Claude Code y otros).

## Cómo usarlo

La primera vez hay que instalar [`uv`](https://docs.astral.sh/uv/getting-started/installation/) (un instalador de Python). Después:

- **Windows:** doble clic en `Abrir generalito.bat`.
- **Mac o Linux:** doble clic en `Abrir generalito.command` (o `uv run generalito` en una terminal).

Se abre una página en el navegador con tres pestañas:

- **Jugar:** jugás una partida vos, o dejás que juegue el azar, con la planilla y el historial a la vista.
- **Simulaciones:** lanzás muchas partidas con límites de tiempo, CPU y disco; ves el progreso en vivo, el uso de tu compu, los resultados y un histograma de puntajes; y las podés parar con un botón.
- **¿Cómo funciona?:** explicación corta de todo.

Todo corre en tu compu: la página la sirve un programa local que solo atiende a tu navegador. Para cerrarlo, cerrá la ventana negra que se abre junto con la página.

### Desde la terminal

```bash
uv sync                                       # instala todo (una sola vez)
uv run pytest                                 # tests
uv run generalito-mostrar --semilla 5         # una partida al azar, turno por turno
uv run generalito-simular --partidas 10000    # muchas partidas, con límites de recursos
```

Cada simulación deja en `corridas/<fecha>-simular/` la configuración (`config.json`), el estado (`estado.json`) y el registro de decisiones. Para frenarla: el botón Parar, Ctrl+C o crear un archivo `PARAR` en esa carpeta.

## Stack

Python, NumPy y (desde la etapa 4) PyTorch. Alcanza con la CPU; la GPU es opcional y acelera. Sin nube, sin APIs externas, sin modelos preentrenados.
