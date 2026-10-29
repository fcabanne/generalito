"""Jugadores de referencia y evaluación justa.

Todos se evalúan sobre las mismas partidas con dados reservados (FuenteReservada):
si dos jugadores vuelven a tirar el mismo dado en el mismo momento, les sale lo
mismo. Los jugadores de referencia solo sirven para comparar; nunca para entrenar.
"""

import random

import numpy as np
import torch

from generalito.motor import FuenteReservada, Partida
from generalito.motor.jugadas import decodificar

SEMILLA_EVALUACION = 20261026
UMBRAL_REFERENCIA = 950  # nivel de la familia: siempre se informa el % de partidas que lo superan


def porcentaje_que_supera(totales: list[int], umbral: int) -> float:
    """% de partidas cuyo total llega al umbral (total >= umbral)."""
    return round(100 * sum(t >= umbral for t in totales) / max(1, len(totales)), 1)


def jugada_azar(partida: Partida, rng: random.Random) -> int:
    return rng.choice(partida.jugadas_legales())


def jugada_codiciosa(partida: Partida, rng: random.Random) -> int:
    """Nunca vuelve a tirar: anota donde más sube el total ahora mismo."""
    planilla = partida.planilla
    mejor, mejor_total = None, -1
    base = list(planilla.casillas)
    for jugada, valor in partida.anotaciones_legales():
        accion = decodificar(jugada)
        indice = accion.columna * 13 + accion.categoria
        planilla.casillas[indice] = valor
        total = planilla.total()
        planilla.casillas[indice] = base[indice]
        if total > mejor_total:
            mejor, mejor_total = jugada, total
    return mejor


JUGADORES = {"azar": jugada_azar, "codicioso": jugada_codiciosa}


def evaluar_jugador(nombre: str, partidas: int, semilla: int = SEMILLA_EVALUACION) -> list[int]:
    elegir = JUGADORES[nombre]
    rng = random.Random(semilla)
    totales = []
    for i in range(partidas):
        partida = Partida(FuenteReservada(semilla, i))
        while not partida.terminada:
            partida.aplicar(elegir(partida, rng))
        totales.append(partida.total())
    return totales


@torch.no_grad()
def evaluar_agente(red, partidas: int, semilla: int = SEMILLA_EVALUACION) -> list[int]:
    """El agente juega sin azar (siempre su jugada más probable), todas las partidas a la vez."""
    from generalito.agente.codificacion import TAMANO_ESTADO, codificar

    juegos = [Partida(FuenteReservada(semilla, i)) for i in range(partidas)]
    estados = np.zeros((partidas, TAMANO_ESTADO), dtype=np.float32)
    mascaras = np.zeros((partidas, 135), dtype=bool)
    activos = list(range(partidas))
    while activos:
        for k, i in enumerate(activos):
            codificar(juegos[i], estados[k])
            mascaras[k] = juegos[i].mascara_legal()
        n = len(activos)
        logits, _ = red(torch.from_numpy(estados[:n]), torch.from_numpy(mascaras[:n]))
        jugadas = logits.argmax(dim=-1).tolist()
        for i, jugada in zip(activos, jugadas, strict=True):
            juegos[i].aplicar(jugada)
        activos = [i for i in activos if not juegos[i].terminada]
    return [p.total() for p in juegos]
