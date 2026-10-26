"""Restricciones de columnas, Menor/Mayor y puntaje (REGLAS.md §3 a §6)."""

from generalito.motor.categorias import Categoria as C
from generalito.motor.planilla import LIBRE, TACHADA, Columna, Planilla


def test_baja_y_sube_respetan_el_orden():
    p = Planilla()
    assert p.casillas_habilitadas(Columna.BAJA) == [C.UNO]
    assert p.casillas_habilitadas(Columna.SUBE) == [C.GENERALA]
    p.anotar(Columna.BAJA, C.UNO, TACHADA)
    p.anotar(Columna.SUBE, C.GENERALA, 60)
    assert p.casillas_habilitadas(Columna.BAJA) == [C.DOS]
    assert p.casillas_habilitadas(Columna.SUBE) == [C.MAYOR]


def test_bonus_se_saltea_en_el_orden():
    p = Planilla()
    for categoria in (C.UNO, C.DOS, C.TRES, C.CUATRO, C.CINCO, C.SEIS):
        p.anotar(Columna.BAJA, categoria, TACHADA)
    assert p.casillas_habilitadas(Columna.BAJA) == [C.ESCALERA_1_5]


def test_desordenada_y_servida_cualquier_libre():
    p = Planilla()
    p.anotar(Columna.DESORDENADA, C.FULL, 45)
    habilitadas = p.casillas_habilitadas(Columna.DESORDENADA)
    assert C.FULL not in habilitadas and len(habilitadas) == 12
    assert len(p.casillas_habilitadas(Columna.SERVIDA)) == 13


def test_servida_requiere_tiro_servido_para_puntaje():
    p = Planilla()
    dados = (5, 5, 5, 2, 2)
    assert p.puntaje_posible(Columna.SERVIDA, C.FULL, dados, True) == 45
    assert p.puntaje_posible(Columna.SERVIDA, C.FULL, dados, False) is None
    assert p.puntaje_posible(Columna.DESORDENADA, C.FULL, dados, False) == 45


def test_numero_en_cero_solo_se_tacha():
    p = Planilla()
    assert p.puntaje_posible(Columna.DESORDENADA, C.UNO, (2, 3, 4, 5, 6), True) is None


def test_menor_mayor():
    p = Planilla()
    p.anotar(Columna.DESORDENADA, C.MENOR, 18)
    assert p.puntaje_posible(Columna.DESORDENADA, C.MAYOR, (3, 3, 4, 4, 4), True) is None  # 18
    assert p.puntaje_posible(Columna.DESORDENADA, C.MAYOR, (3, 4, 4, 4, 4), True) == 19
    # Otra columna no se ve afectada
    assert p.puntaje_posible(Columna.SERVIDA, C.MAYOR, (1, 1, 1, 1, 2), True) == 6

    q = Planilla()
    q.anotar(Columna.DESORDENADA, C.MAYOR, 25)
    assert q.puntaje_posible(Columna.DESORDENADA, C.MENOR, (5, 5, 5, 5, 5), True) is None  # 25
    assert q.puntaje_posible(Columna.DESORDENADA, C.MENOR, (4, 5, 5, 5, 5), True) == 24

    r = Planilla()
    r.anotar(Columna.DESORDENADA, C.MENOR, TACHADA)
    assert r.puntaje_posible(Columna.DESORDENADA, C.MAYOR, (1, 1, 1, 1, 1), True) == 5


def test_bonus():
    for suma, esperado in ((62, 92), (60, 90), (59, 59)):
        p = Planilla()
        # Repartir la suma en las casillas de números sin pasarse de 5 dados por número
        restante = suma
        for categoria in reversed((C.UNO, C.DOS, C.TRES, C.CUATRO, C.CINCO, C.SEIS)):
            valor = categoria + 1
            cuantos = min(5, restante // valor)
            if cuantos:
                p.anotar(Columna.BAJA, categoria, valor * cuantos)
                restante -= valor * cuantos
        assert restante == 0
        assert p.bonus(Columna.BAJA) == esperado


def test_planilla_vacia_vale_cero():
    p = Planilla()
    assert p.total() == 0
    assert all(v == LIBRE for v in p.casillas)
