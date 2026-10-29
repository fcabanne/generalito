"""Objetivo "Superar X": recompensa solo al final, 1 si el total llega a X."""

import json
import random

import numpy as np
import pytest

from generalito.agente.entornos import _Grupo
from generalito.evaluar import porcentaje_que_supera


def _jugar_una(umbral):
    grupo = _Grupo(1, semilla=5, id_base=0, registro_kwargs=None, registrar_cada=1, umbral=umbral)
    rng = random.Random(1)
    recompensas = []
    while True:
        jugada = rng.choice(grupo.partidas[0].jugadas_legales())
        _, _, r, terminadas, totales = grupo.paso(np.array([jugada]), None)
        recompensas.append(float(r[0]))
        if terminadas[0]:
            return recompensas, totales[0]


@pytest.mark.parametrize("umbral", [1, 100, 1704])
def test_recompensa_solo_al_final(umbral):
    recompensas, total = _jugar_una(umbral)
    assert all(r == 0 for r in recompensas[:-1])  # nada en el medio
    assert recompensas[-1] == (1.0 if total >= umbral else 0.0)


def test_porcentaje_que_supera():
    assert porcentaje_que_supera([949, 950, 951, 1000], 950) == 75.0
    assert porcentaje_que_supera([], 950) == 0


def test_entrenar_para_superar(tmp_path):
    pytest.importorskip("torch")
    from generalito.agente.entrenar import main as entrenar
    from generalito.agente.red import cargar_snapshot
    from generalito.analisis import main as analisis

    comunes = ["--max-partidas", "20", "--entornos", "12", "--pasos", "64", "--minilote", "256",
               "--oculta", "32", "--registrar-cada", "0", "--max-cpu", "100"]  # fmt: skip
    with pytest.raises(SystemExit, match="siguiendo un modelo"):
        entrenar(["--carpeta", str(tmp_path / "x"), "--objetivo", "superar", *comunes])

    base = tmp_path / "base"
    entrenar(["--carpeta", str(base), *comunes])
    modelo = str(base / "modelo.pt")
    with pytest.raises(SystemExit, match="pista"):
        entrenar(["--carpeta", str(tmp_path / "y"), "--desde", modelo, "--objetivo", "superar",
                  "--pista-bonus", "0.5", *comunes])  # fmt: skip

    a = tmp_path / "a"
    entrenar(["--carpeta", str(a), "--desde", modelo, "--objetivo", "superar", "--umbral", "300",
              *comunes])  # fmt: skip
    config = json.loads((a / "config.json").read_text())
    assert config["objetivo"] == {"tipo": "superar", "umbral": 300}
    assert config["valor_reiniciado"] is True  # cambió el objetivo
    estado = json.loads((a / "estado.json").read_text())
    examen = estado["evaluaciones"][-1]
    assert examen["umbral"] == 300 and 0 <= examen["supera_umbral_pct"] <= 100
    assert "supera_950_pct" in examen and estado["criterio_mejor"] == "supera"
    assert any(e["mejor"] for e in estado["evaluaciones"])
    _, metricas = cargar_snapshot(a / "mejor.pt")
    assert metricas["entrenamiento"]["objetivo"] == {"tipo": "superar", "umbral": 300}

    # Siguiendo con el mismo objetivo, la estimación de valor no se reinicia
    b = tmp_path / "b"
    entrenar(["--carpeta", str(b), "--desde", str(a / "modelo.pt"), "--objetivo", "superar",
              "--umbral", "300", *comunes])  # fmt: skip
    assert json.loads((b / "config.json").read_text())["valor_reiniciado"] is False

    # Análisis: % que llega a 950 y a su X
    analisis(["analizar", "--modelo", str(a / "mejor.pt"), "--partidas", "20",
              "--carpeta", str(tmp_path / "an"), "--max-cpu", "100"])  # fmt: skip
    r = json.loads((tmp_path / "an" / "estado.json").read_text())["resultado"]
    assert [u["umbral"] for u in r["supera"]] == [950, 300]
