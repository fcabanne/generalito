"""Aprender pensando (fase 2): datos generados, objetivos y un ciclo completo."""

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from generalito.agente.codificacion import codificar, codificar_crudo  # noqa: E402
from generalito.agente.pensar import equivalentes, generar_partida  # noqa: E402
from generalito.agente.red import Red, cargar_snapshot, guardar_snapshot  # noqa: E402
from generalito.motor import FuenteAzar, Partida  # noqa: E402
from generalito.motor.jugadas import volver_a_tirar  # noqa: E402


def test_equivalentes():
    dados = (5, 2, 5, 3, 5)
    # Guardar un 5: cualquiera de las tres posiciones con 5
    bits = equivalentes(dados, volver_a_tirar([0]))
    assert bits == sum(1 << volver_a_tirar([p]) for p in (0, 2, 4))
    assert equivalentes(dados, 31 + 5) == 0  # anotar: no tiene equivalentes


def test_generar_partida(tmp_path):
    ruta = tmp_path / "m.pt"
    guardar_snapshot(Red(16), ruta, {})
    spec = {"ruta": str(ruta), "pensar": True, "muestras": 4}
    p = generar_partida(spec, indice=3, semilla=1, variedad=0.5, temperatura=0.1)
    n = len(p["tiro"])
    assert 52 <= n <= 156 and p["dados"].shape == (n, 5) and p["casillas"].shape == (n, 52)
    assert np.allclose(p["objetivo"].astype(np.float32).sum(axis=1), 1, atol=1e-2)
    assert (p["jugadas"][:, 0] >= 0).all()
    # Lo guardado alcanza para rehacer la entrada de la red (la primera decisión)
    primera = Partida(FuenteAzar(0))
    primera.dados = tuple(int(d) for d in p["dados"][0])
    x = codificar_crudo(p["dados"][:1], p["tiro"][:1], p["servido"][:1], p["turno"][:1],
                        p["casillas"][:1])  # fmt: skip
    assert np.array_equal(x[0], codificar(primera))
    # Las jugadas de la búsqueda son legales en su situación
    mascaras = np.unpackbits(p["mascara"], axis=1, count=135).astype(bool)
    filas = np.arange(n)
    assert mascaras[filas, p["jugadas"][:, 0]].all()
    # Reproducible
    q = generar_partida(spec, indice=3, semilla=1, variedad=0.5, temperatura=0.1)
    assert q["total"] == p["total"] and np.array_equal(q["jugadas"], p["jugadas"])


@pytest.mark.parametrize("objetivo", [None, {"tipo": "mixto", "umbral": 200, "premio": 50}])
def test_un_ciclo_completo(tmp_path, objetivo):
    from generalito.agente.aprender import main as aprender

    base = tmp_path / "base.pt"
    metricas = {"partidas_entrenadas": 10, "pistas": [{"peso_inicial": 0.5, "fin_pct": 50}]}
    if objetivo:
        metricas["entrenamiento"] = {"objetivo": objetivo}
    guardar_snapshot(Red(16), base, metricas)
    carpeta = tmp_path / "a"
    aprender(["--desde", str(base), "--carpeta", str(carpeta), "--minutos", "10",
              "--max-ciclos", "2", "--partidas-ciclo", "4", "--examen-partidas", "6",
              "--examen-pensando", "3", "--muestras", "4", "--hilos", "2",
              "--max-cpu", "100"])  # fmt: skip
    estado = json.loads((carpeta / "estado.json").read_text())
    assert estado["terminado"] and estado["ciclo"] == 2
    assert len(estado["evaluaciones"]) == estado["ciclo"] + 1  # examen inicial + uno por ciclo
    examen = estado["evaluaciones"][-1]
    assert "promedio" in examen and "supera_950_pct" in examen
    assert examen["pensando"]["partidas"] == 3
    assert estado["aprendizaje"][0]["decisiones"] > 0
    datos = np.load(sorted((carpeta / "datos").glob("ciclo_*.npz"))[0])
    if objetivo:
        assert estado["entrenamiento"]["objetivo"]["tipo"] == "mixto"
    assert len(datos["retorno"]) == len(datos["tiro"])
    red, m = cargar_snapshot(carpeta / "mejor.pt")
    assert m["entrenamiento"]["modo"] == "aprender_pensando"
    assert m["pistas"] == metricas["pistas"]  # conserva el linaje
    _, ultimo = cargar_snapshot(carpeta / "modelo.pt")
    assert ultimo["partidas_entrenadas"] == 10 + 2 * 4


def test_retorno_desde_cada_decision(tmp_path):
    """El valor aprende lo que se consiguió desde cada decisión hasta el final."""
    from generalito.agente.aprender import main as aprender

    base = tmp_path / "base.pt"
    guardar_snapshot(Red(16), base, {})
    carpeta = tmp_path / "a"
    aprender(["--desde", str(base), "--carpeta", str(carpeta), "--minutos", "10",
              "--max-ciclos", "1", "--partidas-ciclo", "2", "--examen-partidas", "2",
              "--examen-pensando", "0", "--muestras", "4", "--hilos", "1",
              "--max-cpu", "100"])  # fmt: skip
    datos = np.load(sorted((carpeta / "datos").glob("ciclo_*.npz"))[0])
    # Primera partida: desde la primera decisión hasta la última (la del turno 52)
    turno = datos["turno"]
    ultima = next(i for i in range(len(turno)) if turno[i] == 52 and turno[i + 1] != 52)
    total_final = datos["retorno"][0] * 50 + datos["total_antes"][0]
    assert datos["total_antes"][0] == 0
    # En cada decisión: lo que ya tenía + lo que consiguió después = el total final
    for i in range(ultima + 1):
        assert datos["retorno"][i] * 50 + datos["total_antes"][i] == pytest.approx(total_final)
