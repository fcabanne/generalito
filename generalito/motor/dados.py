"""Fuentes de dados.

El motor no tira dados por su cuenta: le pide a una fuente el valor de cada dado
que se vuelve a tirar, identificado por turno, tiro y posición. Así:

- FuenteAzar: dados al azar con semilla, para entrenar.
- FuenteReservada: cada (partida, turno, tiro, posición) tiene un valor fijo.
  Dos agentes que vuelven a tirar el mismo dado en el mismo momento sacan lo
  mismo, y la suerte queda pareja al comparar (PRD, "Evaluación justa").
- FuenteGuionada: valores dados de antemano, para tests.
"""

import random
from collections.abc import Iterable
from typing import Protocol

CANTIDAD_DADOS = 5
CARAS = 6


class FuenteDados(Protocol):
    def tirar(self, turno: int, tiro: int, posiciones: tuple[int, ...]) -> list[int]:
        """Devuelve un valor (1 a 6) por cada posición tirada, en el mismo orden."""
        ...


class FuenteAzar:
    def __init__(self, semilla: int) -> None:
        self._rng = random.Random(semilla)

    def tirar(self, turno: int, tiro: int, posiciones: tuple[int, ...]) -> list[int]:
        return [self._rng.randint(1, CARAS) for _ in posiciones]


_MASCARA_64 = (1 << 64) - 1


def _mezclar(x: int) -> int:
    """Paso de splitmix64: mezcla bien los bits de un entero de 64 bits."""
    x = (x + 0x9E3779B97F4A7C15) & _MASCARA_64
    x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & _MASCARA_64
    x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & _MASCARA_64
    return x ^ (x >> 31)


class FuenteReservada:
    def __init__(self, semilla: int, partida: int) -> None:
        self._base = _mezclar(_mezclar(semilla) ^ partida)

    def valor(self, turno: int, tiro: int, posicion: int) -> int:
        clave = self._base
        for parte in (turno, tiro, posicion):
            clave = _mezclar(clave ^ parte)
        return clave % CARAS + 1

    def tirar(self, turno: int, tiro: int, posiciones: tuple[int, ...]) -> list[int]:
        return [self.valor(turno, tiro, p) for p in posiciones]


class FuenteGuionada:
    """Entrega los valores en el orden dado. Falla si se acaban."""

    def __init__(self, valores: Iterable[int]) -> None:
        self._valores = list(valores)
        self._siguiente = 0

    def tirar(self, turno: int, tiro: int, posiciones: tuple[int, ...]) -> list[int]:
        fin = self._siguiente + len(posiciones)
        if fin > len(self._valores):
            raise RuntimeError("La fuente guionada se quedó sin valores")
        tirados = self._valores[self._siguiente : fin]
        self._siguiente = fin
        return tirados
