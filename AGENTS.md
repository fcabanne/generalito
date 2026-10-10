# AGENTS.md

Contexto para agentes de código (Claude Code y otros) que arrancan una sesión nueva en este repo. Leer esto primero.

## Qué es el proyecto

**generalito**: una IA que aprende sola, por aprendizaje por refuerzo, a jugar la generala de 4 columnas que se juega en la familia de Facu desde hace 20 años. Al no existir esta variante en ningún lado, no hay modelo hecho: todo se escribe desde cero.

- Documento de producto: [`docs/PRD.md`](docs/PRD.md). Es un **primer disparador**, no un contrato: se ajusta sobre la marcha.
- Reglas del juego: [`docs/REGLAS.md`](docs/REGLAS.md). **Fuente de verdad del motor.**
- Decisiones tomadas: [`docs/DECISIONES.md`](docs/DECISIONES.md).

## Estado actual

> Actualizar esta sección al cerrar cada etapa.

- **Etapa:** 0, definición de reglas (cerrada: reglas 1.0).
- **Código:** todavía no hay. No hay entorno Python armado.
- **Bloqueante:** ninguno. Lo único pendiente de las reglas (orden de turnos con varios bandos) es para la v2.
- **Próximo paso:** el motor del juego con tests. Los casos de `docs/REGLAS.md` §8 y la partida de `docs/PARTIDA_EJEMPLO.md` sirven de base para los tests.

## Reglas de trabajo

1. **No inventar reglas del juego.** Si algo no está marcado como confirmado en `docs/REGLAS.md`, preguntar. Las hipótesis del documento no son reglas. Ante una ambigüedad, frenar y consultar antes que asumir: un supuesto equivocado cambia la estrategia que aprende la red.
2. **Todo local.** Nada de APIs externas, servicios en la nube ni modelos/pesos preentrenados. Las dependencias se instalan una vez y después el proyecto corre sin internet.
3. **CPU primero.** La red es chica; el código tiene que andar bien en una notebook sin GPU. La GPU es opcional, nunca requerida.
4. **Avanzar por versiones y etapas.** v1 (un jugador) → v2 (self-play) → v3 (sugeridor). No adelantar trabajo de una versión que todavía no empezó, salvo que se pida.
5. **Registrar decisiones.** Toda decisión de diseño no trivial (codificación del estado, algoritmo de RL, formato de snapshots, etc.) va a `docs/DECISIONES.md` con su porqué.
6. **Mantener este archivo al día.** Si cambia el estado, la estructura o una convención, actualizar `AGENTS.md` en el mismo commit.
7. **Idioma.** Documentación, commits y conversación en español. Identificadores en el código: a definir al arrancar el código (ver más abajo).

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
README.md          presentación del proyecto
AGENTS.md          este archivo
CLAUDE.md          importa AGENTS.md (para Claude Code)
docs/
  PRD.md           documento de producto
  REGLAS.md        reglas del juego (fuente de verdad)
  PARTIDA_EJEMPLO.md  partida completa de ejemplo, turno por turno
  DECISIONES.md    registro de decisiones
```

Cuando arranque el código, documentar acá la estructura real, cómo instalar, cómo correr los tests y cómo entrenar.

## Pendiente de definir al arrancar el código

- Gestor de entorno/dependencias (por ejemplo `uv` o `venv` + `pip`).
- Herramientas de test y lint (por ejemplo `pytest` + `ruff`).
- Idioma de los identificadores (español o inglés).
- Hardware real de Facu (CPU, RAM, GPU) para calibrar tiempos de entrenamiento.
- Las 7 etapas del plan, que en el PRD original eran un bloque embebido que no se exportó.
