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
