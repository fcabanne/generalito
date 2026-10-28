"""Pista del Bonus (reward shaping basado en potencial): no cambia el puntaje final."""

import json
import random

import numpy as np
import pytest

from generalito.agente.pista import peso_actual, potencial, potencial_partida
from generalito.motor import FuenteAzar, Partida
from generalito.motor.categorias import Categoria
from generalito.motor.planilla import Columna, Planilla


def test_potencial():
    p = Planilla()
    assert potencial(p) == 0
    p.anotar(Columna.DESORDENADA, Categoria.SEIS, 30)  # 30 de 60 en Desordenada
    assert potencial(p) == pytest.approx(15)
    p.anotar(Columna.DESORDENADA, Categoria.CINCO, 25)
    p.anotar(Columna.DESORDENADA, Categoria.CUATRO, 20)  # 75: pasa de 60, tope 30
    assert potencial(p) == pytest.approx(30)
    p.anotar(Columna.BAJA, Categoria.UNO, 0)  # una X no suma
    assert potencial(p) == pytest.approx(30)


@pytest.mark.parametrize("semilla", range(30))
def test_la_pista_suma_cero_en_una_partida_completa(semilla):
    rng = random.Random(semilla)
    partida = Partida(FuenteAzar(semilla))
    peso = 0.5
    suma = 0.0
    while not partida.terminada:
        antes = potencial_partida(partida)
        partida.aplicar(rng.choice(partida.jugadas_legales()))
        suma += peso * (potencial_partida(partida) - antes)
    assert suma == pytest.approx(0, abs=1e-9)
    assert potencial_partida(partida) == 0  # en el estado final Φ = 0


def test_con_pista_las_recompensas_suman_el_puntaje_final():
    """De punta a punta en los entornos de entrenamiento: con pista, lo que recibe
    el agente en una partida suma exactamente su puntaje final."""
    from generalito.agente.entornos import ESCALA_RECOMPENSA, _Grupo

    grupo = _Grupo(1, semilla=3, id_base=0, registro_kwargs=None, registrar_cada=1, peso_pista=0.5)
    rng = random.Random(0)
    partida = grupo.partidas[0]
    recibido, hubo_pista = 0.0, False
    while True:
        jugada = rng.choice(partida.jugadas_legales())
        antes = partida.total()
        _, _, recompensas, terminadas, totales = grupo.paso(np.array([jugada]), None)
        r = float(recompensas[0]) * ESCALA_RECOMPENSA
        recibido += r
        hubo_pista |= abs(r - (partida.total() - antes)) > 1e-6 and not terminadas[0]
        if terminadas[0]:
            break
    assert hubo_pista  # la pista sí movió algunas recompensas en el medio
    assert recibido == pytest.approx(totales[0], abs=1e-2)


def test_el_peso_baja_linealmente():
    assert peso_actual(0.5, 0.5, 0.0) == 0.5
    assert peso_actual(0.5, 0.5, 0.25) == pytest.approx(0.25)
    assert peso_actual(0.5, 0.5, 0.5) == 0
    assert peso_actual(0.5, 0.5, 0.9) == 0
    assert peso_actual(0.0, 0.5, 0.0) == 0


def test_entrenamiento_con_pista(tmp_path):
    pytest.importorskip("torch")
    from generalito.agente.entrenar import main as entrenar
    from generalito.agente.red import cargar_snapshot

    comunes = ["--max-partidas", "30", "--entornos", "12", "--pasos", "64", "--minilote", "256",
               "--oculta", "32", "--registrar-cada", "0", "--max-cpu", "100"]  # fmt: skip
    a = tmp_path / "a"
    entrenar(["--carpeta", str(a), "--pista-bonus", "0.5", "--pista-fin", "50", *comunes])
    estado = json.loads((a / "estado.json").read_text())
    assert estado["pista"]["peso_inicial"] == 0.5 and estado["pista"]["fin_pct"] == 50
    assert estado["pista"]["peso_actual"] == 0  # pasó el 50%: ya está apagada
    _, metricas = cargar_snapshot(a / "modelo.pt")
    assert metricas["entrenamiento"]["pista"] == {"peso_inicial": 0.5, "fin_pct": 50}
    assert metricas["pistas"] == [{"peso_inicial": 0.5, "fin_pct": 50}]

    # Seguir sin pista: el modelo recuerda que en su historia hubo una
    b = tmp_path / "b"
    entrenar(["--carpeta", str(b), "--desde", str(a / "modelo.pt"), *comunes])
    _, metricas = cargar_snapshot(b / "modelo.pt")
    assert metricas["entrenamiento"]["pista"] is None
    assert metricas["pistas"] == [{"peso_inicial": 0.5, "fin_pct": 50}]
