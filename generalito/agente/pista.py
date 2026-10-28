"""Pista del Bonus: la única excepción a "sin reward shaping" (ver DECISIONES.md).

Es reward shaping basado en potencial. El potencial de una planilla es

    Φ = Σ por columna de 30 × min(suma_de_números / 60, 1)

y en cada paso la recompensa suma peso × (Φ(después) − Φ(antes)). En el estado
final Φ vale 0, así que todo lo que la pista adelantó se descuenta en la última
jugada: sumada en una partida completa da exactamente 0 y el puntaje final que
optimiza el agente no cambia. El peso es fijo durante cada partida (se toma al
empezarla) para que esa suma sea exacta.

El peso arranca en un valor configurable y baja linealmente a 0 en un
porcentaje del entrenamiento; después la recompensa es pura.
"""

from generalito.motor import Partida
from generalito.motor.planilla import Columna, Planilla

BONUS = 30
UMBRAL_BONUS = 60


def potencial(planilla: Planilla) -> float:
    return sum(BONUS * min(planilla.suma_numeros(col) / UMBRAL_BONUS, 1.0) for col in Columna)


def potencial_partida(partida: Partida) -> float:
    """Φ del estado: 0 si la partida terminó."""
    return 0.0 if partida.terminada else potencial(partida.planilla)


def peso_actual(peso_inicial: float, fin: float, progreso: float) -> float:
    """Peso de la pista con `progreso` (0 a 1) del entrenamiento hecho.

    Baja linealmente de `peso_inicial` a 0 cuando el progreso llega a `fin` (0 a 1).
    """
    if peso_inicial <= 0 or fin <= 0:
        return 0.0
    return peso_inicial * max(0.0, 1.0 - progreso / fin)
