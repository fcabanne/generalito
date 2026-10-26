"""Agente: codificación, red, evaluación y un entrenamiento cortito de punta a punta."""

import json
import statistics

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from generalito.agente.codificacion import TAMANO_ESTADO, codificar  # noqa: E402
from generalito.agente.entrenar import main as entrenar  # noqa: E402
from generalito.agente.red import (  # noqa: E402
    Red,
    cargar_snapshot,
    elegir,
    guardar_snapshot,
    probabilidades,
)
from generalito.evaluar import evaluar_agente, evaluar_jugador  # noqa: E402
from generalito.motor import FuenteAzar, FuenteGuionada, Partida  # noqa: E402
from generalito.registro import leer_registro  # noqa: E402


def test_codificacion():
    p = Partida(FuenteGuionada([1, 2, 3, 4, 6]))
    x = codificar(p)
    assert x.shape == (TAMANO_ESTADO,) and x.dtype == np.float32
    assert x[:30].sum() == 5 and x[0] == 1 and x[6 + 1] == 1  # dado 0 = 1, dado 1 = 2
    assert x[30] == 1  # tiro 1
    assert x[33] == 1  # servido


def test_red_respeta_las_jugadas_legales(tmp_path):
    red = Red(32)
    p = Partida(FuenteAzar(1))
    while not p.terminada:
        probs = probabilidades(red, p)
        legales = set(p.jugadas_legales())
        assert all(probs[j] == 0 for j in range(135) if j not in legales)
        assert abs(probs.sum() - 1) < 1e-5
        p.aplicar(elegir(red, p))

    guardar_snapshot(red, tmp_path / "m.pt", {"partidas_entrenadas": 7})
    otra, metricas = cargar_snapshot(tmp_path / "m.pt")
    assert metricas["partidas_entrenadas"] == 7
    q = Partida(FuenteAzar(1))
    assert np.allclose(probabilidades(red, q), probabilidades(otra, q))


def test_evaluacion_es_justa_y_reproducible():
    assert evaluar_jugador("codicioso", 20) == evaluar_jugador("codicioso", 20)
    assert statistics.fmean(evaluar_jugador("codicioso", 50)) > statistics.fmean(
        evaluar_jugador("azar", 50)
    )
    red = Red(32)
    assert evaluar_agente(red, 10) == evaluar_agente(red, 10)


def test_entrenamiento_corto(tmp_path):
    carpeta = tmp_path / "e"
    entrenar(
        [
            "--carpeta", str(carpeta),
            "--max-partidas", "40",
            "--minutos", "5",
            "--entornos", "16",
            "--pasos", "64",
            "--minilote", "256",
            "--oculta", "32",
            "--registrar-cada", "10",
            "--max-cpu", "100",
        ]
    )  # fmt: skip
    estado = json.loads((carpeta / "estado.json").read_text())
    assert estado["terminado"] and estado["partidas"] >= 40
    assert len(estado["evaluaciones"]) >= 2 and estado["curva"]
    assert set(estado["referencias"]) == {"azar", "codicioso"}
    red, metricas = cargar_snapshot(carpeta / "modelo.pt")
    assert metricas["partidas_entrenadas"] == estado["partidas"]

    # Seguir entrenando desde ese modelo
    otra = tmp_path / "f"
    entrenar(
        [
            "--carpeta", str(otra),
            "--desde", str(carpeta / "modelo.pt"),
            "--max-partidas", "20",
            "--entornos", "16",
            "--pasos", "64",
            "--minilote", "256",
            "--max-cpu", "100",
        ]
    )  # fmt: skip
    _, metricas = cargar_snapshot(otra / "modelo.pt")
    assert metricas["partidas_entrenadas"] >= estado["partidas"] + 20


def test_entrenamiento_con_varios_procesos(tmp_path):
    carpeta = tmp_path / "p"
    entrenar(
        [
            "--carpeta", str(carpeta),
            "--max-partidas", "30",
            "--entornos", "12",
            "--trabajadores", "3",
            "--pasos", "64",
            "--minilote", "256",
            "--oculta", "32",
            "--registrar-cada", "5",
            "--max-cpu", "100",
        ]
    )  # fmt: skip
    estado = json.loads((carpeta / "estado.json").read_text())
    assert estado["terminado"] and estado["partidas"] >= 30
    datos = leer_registro(carpeta / "registro")
    assert len(set(datos["partida"].tolist())) >= 3  # registró partidas de varios trabajadores
    assert np.allclose(datos["valores"].sum(axis=1), 1, atol=1e-4)  # probabilidades
