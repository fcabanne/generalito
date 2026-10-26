"""Registro de decisiones, límites de recursos y simulador."""

import json
import random

import numpy as np
import pytest

from generalito.motor import FuenteAzar, Partida
from generalito.recursos import ARCHIVO_PARAR, Guardian, Limites
from generalito.registro import LimiteDeDisco, RegistroDecisiones, leer_registro
from generalito.simular import main as simular


def _jugar_y_registrar(registro, id_partida, semilla):
    rng = random.Random(semilla)
    partida = Partida(FuenteAzar(semilla))
    decisiones = []
    while not partida.terminada:
        jugada = rng.choice(partida.jugadas_legales())
        valores = np.arange(135, dtype=np.float32) if rng.random() < 0.5 else None
        registro.agregar(id_partida, partida, jugada, valores)
        decisiones.append((partida.turno, partida.tiro, partida.dados, jugada))
        partida.aplicar(jugada)
    return decisiones


def test_registro_ida_y_vuelta(tmp_path):
    registro = RegistroDecisiones(tmp_path, max_mb=100, decisiones_por_archivo=50)
    esperadas = _jugar_y_registrar(registro, 0, 1) + _jugar_y_registrar(registro, 1, 2)
    registro.cerrar()

    datos = leer_registro(tmp_path)
    assert len(datos["jugada"]) == len(esperadas)
    assert len(list(tmp_path.glob("registro_*.npz"))) > 1  # se partió en bloques
    for i, (turno, tiro, dados, jugada) in enumerate(esperadas):
        assert datos["turno"][i] == turno
        assert datos["tiro"][i] == tiro
        assert tuple(datos["dados"][i]) == dados
        assert datos["jugada"][i] == jugada
    assert datos["planilla"].shape == (len(esperadas), 52)
    assert datos["valores"].shape == (len(esperadas), 135)
    assert (datos["planilla"][0] == -1).all()  # la primera decisión es con la planilla vacía
    assert json.loads((tmp_path / "registro.json").read_text())["version_reglas"] == "1.0"


def test_registro_respeta_limite_de_disco(tmp_path):
    registro = RegistroDecisiones(tmp_path, max_mb=0.01, decisiones_por_archivo=10_000)
    for i in range(20):
        _jugar_y_registrar(registro, i, i)
    with pytest.raises(LimiteDeDisco):
        registro.cerrar()
    assert not list(tmp_path.glob("*.npz"))  # no quedó nada escrito a medias


def test_guardian_frena_por_partidas_y_archivo(tmp_path):
    guardian = Guardian(
        Limites(max_partidas=10, max_cpu_sistema=None), tmp_path, cada_s=0, atrapar_ctrl_c=False
    )
    assert guardian.revisar(5) is None
    assert "partidas" in guardian.revisar(10)
    (tmp_path / ARCHIVO_PARAR).touch()
    assert ARCHIVO_PARAR in guardian.revisar(1)


def test_guardian_frena_por_disco_de_la_corrida(tmp_path):
    (tmp_path / "grande.bin").write_bytes(b"\0" * 2**20)
    limites = Limites(max_disco_mb=0.5, max_cpu_sistema=None)
    guardian = Guardian(limites, tmp_path, cada_s=0, atrapar_ctrl_c=False)
    assert "MB" in guardian.revisar(0)


def test_simular_de_punta_a_punta(tmp_path):
    carpeta = tmp_path / "corrida"
    simular(
        [
            "--partidas",
            "30",
            "--registrar-cada",
            "10",
            "--carpeta",
            str(carpeta),
            "--max-cpu",
            "100",
        ]
    )
    estado = json.loads((carpeta / "estado.json").read_text())
    assert estado["terminado"] and estado["partidas"] == 30
    assert 0 < estado["promedio"] <= 1704
    datos = leer_registro(carpeta / "registro")
    assert set(datos["partida"].tolist()) == {0, 10, 20}
