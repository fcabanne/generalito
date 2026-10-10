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
