"""Casos de REGLAS.md §8."""

import pytest

from generalito.motor.categorias import Categoria as C
from generalito.motor.categorias import puntaje

# Dados: (1, 2, 3, 4, 5, 6, Esc 1-5, Esc 2-6, Full, Póker, Suma, Generala)
CASOS = {
    (5, 5, 5, 2, 2): (0, 4, 0, 0, 15, 0, None, None, 45, None, 19, None),
    (2, 2, 2, 2, 6): (0, 8, 0, 0, 0, 6, None, None, None, 48, 14, None),
    (2, 2, 2, 2, 2): (0, 10, 0, 0, 0, 0, None, None, None, None, 10, 60),
    (3, 1, 4, 5, 2): (1, 2, 3, 4, 5, 0, 20, None, None, None, 15, None),
    (6, 2, 5, 3, 4): (0, 2, 3, 4, 5, 6, None, 20, None, None, 20, None),
    (1, 2, 3, 4, 6): (1, 2, 3, 4, 0, 6, None, None, None, None, 16, None),
    (6, 6, 6, 5, 5): (0, 0, 0, 0, 10, 18, None, None, 48, None, 28, None),
}

COLUMNAS_TABLA = [
    C.UNO, C.DOS, C.TRES, C.CUATRO, C.CINCO, C.SEIS,
    C.ESCALERA_1_5, C.ESCALERA_2_6, C.FULL, C.POKER, C.MENOR, C.GENERALA,
]  # fmt: skip


@pytest.mark.parametrize("dados", list(CASOS))
def test_tabla_reglas(dados):
    for categoria, esperado in zip(COLUMNAS_TABLA, CASOS[dados], strict=True):
        assert puntaje(categoria, dados) == esperado, (dados, categoria)
    assert puntaje(C.MAYOR, dados) == puntaje(C.MENOR, dados)


def test_cinco_iguales_no_son_full_ni_poker():
    assert puntaje(C.FULL, (4, 4, 4, 4, 4)) is None
    assert puntaje(C.POKER, (4, 4, 4, 4, 4)) is None
    assert puntaje(C.GENERALA, (4, 4, 4, 4, 4)) == 70


def test_maximos():
    assert puntaje(C.FULL, (6, 6, 6, 5, 5)) == 48
    assert puntaje(C.POKER, (6, 6, 6, 6, 1)) == 64
    assert puntaje(C.GENERALA, (6,) * 5) == 80
