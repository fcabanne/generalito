"""Objetivo mixto: puntos normales + premio P al final si el total llega a X."""

import json
import random

import numpy as np
import pytest

from generalito.agente.entornos import ESCALA_RECOMPENSA, _Grupo


def _jugar_una(umbral, premio):
    grupo = _Grupo(1, semilla=5, id_base=0, registro_kwargs=None, registrar_cada=1,
                   umbral=umbral, premio=premio)  # fmt: skip
    rng = random.Random(1)
    recibido = []
    while True:
        jugada = rng.choice(grupo.partidas[0].jugadas_legales())
        _, _, r, terminadas, totales = grupo.paso(np.array([jugada]), None)
        recibido.append(float(r[0]) * ESCALA_RECOMPENSA)
        if terminadas[0]:
            return recibido, totales[0]


@pytest.mark.parametrize("umbral", [1, 1704])
def test_puntos_mas_premio_si_llega(umbral):
    recibido, total = _jugar_una(umbral, premio=100)
    esperado = total + (100 if total >= umbral else 0)
    assert sum(recibido) == pytest.approx(esperado, abs=1e-2)
    # El premio llega solo en la última jugada
    sin_premio, _ = _jugar_una(umbral=1704, premio=100)
    assert recibido[:-1] == pytest.approx(sin_premio[:-1], abs=1e-4)


def test_entrenar_mixto(tmp_path):
    torch = pytest.importorskip("torch")
    from generalito.agente.entrenar import main as entrenar
    from generalito.agente.red import cargar_snapshot

    comunes = ["--max-partidas", "30", "--entornos", "12", "--pasos", "64", "--minilote", "256",
               "--oculta", "32", "--registrar-cada", "0", "--max-cpu", "100"]  # fmt: skip
    base = tmp_path / "base"
    entrenar(["--carpeta", str(base), *comunes])
    modelo = base / "modelo.pt"

    # Desde un modelo de "Máximo puntaje": calienta, pero no reinicia el valor (misma escala)
    a = tmp_path / "a"
    entrenar(["--carpeta", str(a), "--desde", str(modelo), "--objetivo", "mixto", "--umbral",
              "300", "--premio", "100", "--calentamiento", "100", *comunes])  # fmt: skip
    config = json.loads((a / "config.json").read_text())
    assert config["objetivo"] == {"tipo": "mixto", "umbral": 300, "premio": 100}
    assert config["valor_reiniciado"] is False and config["calentamiento_pct"] == 100
    antes = torch.load(modelo, weights_only=False)["pesos"]
    despues = torch.load(a / "modelo.pt", weights_only=False)["pesos"]
    assert torch.equal(antes["politica.weight"], despues["politica.weight"])  # calentando
    assert not torch.equal(antes["valor.weight"], despues["valor.weight"])
    estado = json.loads((a / "estado.json").read_text())
    examen = estado["evaluaciones"][-1]
    assert estado["criterio_mejor"] == "mixto"
    esperado = round(examen["promedio"] + 100 * examen["supera_umbral_pct"] / 100, 1)
    assert examen["puntaje_mixto"] == pytest.approx(esperado, abs=0.11)
    _, metricas = cargar_snapshot(a / "mejor.pt")
    assert metricas["entrenamiento"]["objetivo"]["tipo"] == "mixto"

    # También desde cero (la recompensa no es escasa) y se combina con la pista
    b = tmp_path / "b"
    entrenar(["--carpeta", str(b), "--objetivo", "mixto", "--pista-bonus", "0.5", *comunes])
    assert json.loads((b / "config.json").read_text())["objetivo"]["tipo"] == "mixto"

    # De mixto a "Superar X": cambia la escala, se reinicia el valor
    c = tmp_path / "c"
    entrenar(["--carpeta", str(c), "--desde", str(a / "modelo.pt"), "--objetivo", "superar",
              "--umbral", "300", *comunes])  # fmt: skip
    assert json.loads((c / "config.json").read_text())["valor_reiniciado"] is True
