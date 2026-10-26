"""Categorías de la planilla y su puntaje (REGLAS.md §3.1 y §5)."""

from collections import Counter
from enum import IntEnum


class Categoria(IntEnum):
    """Categorías anotables, en orden de bajada. El Bonus no es una casilla."""

    UNO = 0
    DOS = 1
    TRES = 2
    CUATRO = 3
    CINCO = 4
    SEIS = 5
    ESCALERA_1_5 = 6
    ESCALERA_2_6 = 7
    FULL = 8
    POKER = 9
    MENOR = 10
    MAYOR = 11
    GENERALA = 12


NOMBRES = {
    Categoria.UNO: "1",
    Categoria.DOS: "2",
    Categoria.TRES: "3",
    Categoria.CUATRO: "4",
    Categoria.CINCO: "5",
    Categoria.SEIS: "6",
    Categoria.ESCALERA_1_5: "Escalera 1-5",
    Categoria.ESCALERA_2_6: "Escalera 2-6",
    Categoria.FULL: "Full",
    Categoria.POKER: "Póker",
    Categoria.MENOR: "Menor",
    Categoria.MAYOR: "Mayor",
    Categoria.GENERALA: "Generala",
}

NUMEROS = tuple(Categoria(i) for i in range(6))
CANTIDAD_CATEGORIAS = len(Categoria)


def puntaje(categoria: Categoria, dados: tuple[int, ...]) -> int | None:
    """Puntaje de los dados en la categoría, o None si no cumplen la condición.

    No tiene en cuenta la restricción Menor/Mayor (depende de la planilla, §5.1):
    para Menor y Mayor devuelve siempre la suma.
    """
    cuenta = Counter(dados)
    if categoria in NUMEROS:
        valor = categoria + 1
        return valor * cuenta[valor]
    if categoria == Categoria.ESCALERA_1_5:
        return 20 if sorted(dados) == [1, 2, 3, 4, 5] else None
    if categoria == Categoria.ESCALERA_2_6:
        return 20 if sorted(dados) == [2, 3, 4, 5, 6] else None
    if categoria == Categoria.FULL:
        if sorted(cuenta.values()) == [2, 3]:
            trio = next(v for v, c in cuenta.items() if c == 3)
            return 30 + 3 * trio
        return None
    if categoria == Categoria.POKER:
        for valor, c in cuenta.items():
            if c == 4:
                return 40 + 4 * valor
        return None
    if categoria in (Categoria.MENOR, Categoria.MAYOR):
        return sum(dados)
    if categoria == Categoria.GENERALA:
        if len(cuenta) == 1:
            return 50 + 5 * dados[0]
        return None
    raise ValueError(f"Categoría desconocida: {categoria}")
