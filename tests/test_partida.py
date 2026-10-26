"""Propiedades del motor: legalidad, reproducibilidad y límites de puntaje."""

import random

import pytest

from generalito.motor.categorias import Categoria
from generalito.motor.dados import FuenteAzar, FuenteGuionada, FuenteReservada
from generalito.motor.jugadas import (
    CANTIDAD_JUGADAS,
    PRIMERA_ANOTAR,
    anotar,
    decodificar,
    volver_a_tirar,
)
from generalito.motor.partida import JugadaIlegal, Partida
from generalito.motor.planilla import Columna


def jugar_al_azar(fuente, rng: random.Random) -> Partida:
    partida = Partida(fuente)
    while not partida.terminada:
        partida.aplicar(rng.choice(partida.jugadas_legales()))
    return partida


def test_codificacion_ida_y_vuelta():
    for jugada in range(CANTIDAD_JUGADAS):
        accion = decodificar(jugada)
        if jugada < PRIMERA_ANOTAR:
            assert volver_a_tirar(accion.guardar) == jugada
        else:
            assert anotar(accion.columna, accion.categoria, accion.tachar) == jugada
    with pytest.raises(ValueError):
        volver_a_tirar([0, 1, 2, 3, 4])


@pytest.mark.parametrize("semilla", range(200))
def test_partidas_al_azar_nunca_aceptan_ilegales(semilla):
    rng = random.Random(semilla)
    partida = Partida(FuenteAzar(semilla))
    turnos = 0
    while not partida.terminada:
        legales = set(partida.jugadas_legales())
        assert legales
        # Toda jugada fuera de las legales se rechaza y no cambia el estado
        ilegal = rng.choice([j for j in range(CANTIDAD_JUGADAS) if j not in legales])
        antes = (partida.turno, partida.tiro, partida.dados, list(partida.planilla.casillas))
        with pytest.raises(JugadaIlegal):
            partida.aplicar(ilegal)
        assert antes == (partida.turno, partida.tiro, partida.dados, partida.planilla.casillas)
        turno_antes = partida.turno
        partida.aplicar(rng.choice(sorted(legales)))
        turnos += partida.turno != turno_antes
    assert turnos == 51  # el último anotar termina la partida sin empezar turno
    assert partida.turno == 52
    assert 0 <= partida.total() <= 1704


def test_misma_semilla_misma_partida():
    a = jugar_al_azar(FuenteAzar(7), random.Random(1))
    b = jugar_al_azar(FuenteAzar(7), random.Random(1))
    c = jugar_al_azar(FuenteAzar(8), random.Random(1))
    assert a.planilla.casillas == b.planilla.casillas
    assert a.planilla.casillas != c.planilla.casillas


def test_fuente_reservada_es_fija_por_posicion():
    f = FuenteReservada(semilla=1, partida=3)
    g = FuenteReservada(semilla=1, partida=3)
    assert f.tirar(5, 2, (1, 3)) == [f.valor(5, 2, 1), f.valor(5, 2, 3)]
    assert f.tirar(5, 2, (0, 1, 2, 3, 4)) == g.tirar(5, 2, (0, 1, 2, 3, 4))
    # Distribución razonable de los valores
    valores = [f.valor(t, 1, p) for t in range(1, 2001) for p in range(5)]
    for cara in range(1, 7):
        assert abs(valores.count(cara) / len(valores) - 1 / 6) < 0.02


def test_tercer_tiro_obliga_a_anotar():
    p = Partida(FuenteGuionada([1, 2, 3, 4, 6] + [5] * 10))
    p.aplicar(volver_a_tirar([]))
    p.aplicar(volver_a_tirar([0]))
    assert p.tiro == 3
    assert all(j >= PRIMERA_ANOTAR for j in p.jugadas_legales())
    with pytest.raises(JugadaIlegal):
        p.aplicar(volver_a_tirar([]))


def test_servido_en_tiro_posterior():
    p = Partida(FuenteGuionada([1, 1, 2, 3, 4] + [6, 6, 6] + [5, 5, 5, 5, 5]))
    p.aplicar(volver_a_tirar([0, 1]))
    assert not p.ultimo_tiro_servido
    assert anotar(Columna.SERVIDA, Categoria.UNO) not in p.jugadas_legales()
    p.aplicar(volver_a_tirar([]))
    assert p.ultimo_tiro_servido
    assert anotar(Columna.SERVIDA, Categoria.GENERALA) in p.jugadas_legales()


def test_tachar_aunque_haya_puntaje():
    p = Partida(FuenteGuionada([5, 5, 5, 2, 2]))
    legales = p.jugadas_legales()
    assert anotar(Columna.DESORDENADA, Categoria.FULL) in legales
    assert anotar(Columna.DESORDENADA, Categoria.FULL, tachar=True) in legales
