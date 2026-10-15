# generalito

Una IA que aprende sola a jugar a la **generala de 4 columnas** de la familia (baja, sube, desordenada y servida), entrenada desde cero con aprendizaje por refuerzo, 100% local.

No se le enseñan estrategias: se le dan las reglas y una recompensa, simula miles de partidas y mejora. Lo que más interesa es **ver qué estrategias descubre**, incluso las que nadie de la familia conoce.

## Estado

🟢 **Reglas cerradas (versión 1.0).** Todavía no hay código. El próximo paso es el motor del juego. Ver [`docs/REGLAS.md`](docs/REGLAS.md). Ver [`docs/REGLAS.md`](docs/REGLAS.md).

## Hoja de ruta

| Versión | Qué hace | Recompensa |
| --- | --- | --- |
| v1 | Juega sola (un jugador) | Puntaje final |
| v2 | Juega contra un rival (self-play contra versiones viejas) | Ganar / perder |
| v3 | Sugiere jugadas en una partida real (dados a mano, después cámara) | — usa el agente entrenado |

## Recursos visuales

[Dados 3D interactivos](https://fcabanne.github.io/generalito/) para la presentación: pasá el dedo, tocá o sacudí el celular. El código está en [`web/`](web/README.md).

## Documentación

- [`docs/PRD.md`](docs/PRD.md): el documento de producto original (visión, alcance, aprendizaje, registro, snapshots, riesgos).
- [`docs/REGLAS.md`](docs/REGLAS.md): las reglas del juego. Fuente de verdad del motor.
- [`docs/PARTIDA_EJEMPLO.md`](docs/PARTIDA_EJEMPLO.md): una partida completa de ejemplo, turno por turno.
- [`docs/DECISIONES.md`](docs/DECISIONES.md): registro de decisiones tomadas (y por qué).
- [`AGENTS.md`](AGENTS.md): contexto y convenciones para sesiones de agentes de código (Claude Code y otros).

## Stack previsto

Python, NumPy y PyTorch. Corre en CPU de notebook; sin GPU, sin nube, sin APIs externas, sin modelos preentrenados.
