"""Pensar el turno: la búsqueda es exacta, legal y reproducible."""

import itertools
import json
import random

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from generalito.agente.pensar import (  # noqa: E402
    GUARDADOS,
    INDICE_GUARDADO,
    TRANSICION,
    Pensador,
    jugar_en_paralelo,
    jugar_partida,
)
from generalito.agente.red import Red, guardar_snapshot  # noqa: E402
from generalito.motor import FuenteAzar, FuenteGuionada, Partida  # noqa: E402
from generalito.motor.jugadas import Anotar, decodificar  # noqa: E402


def _red_sin_futuro(oculta=16):
    """Una red que estima 0 para todo: pensar = maximizar los puntos de este turno."""
    red = Red(oculta)
    with torch.no_grad():
        red.valor.weight.zero_()
        red.valor.bias.zero_()
    return red


def test_tablas_de_dados():
    assert len(GUARDADOS) == 210
    assert np.allclose(TRANSICION.sum(axis=1), 1)  # cada guardado lleva a algún resultado


@pytest.mark.parametrize("guardado", [(6, 6), (), (1, 2, 3, 6), (5,)])
def test_el_esperado_coincide_con_la_fuerza_bruta(guardado):
    partida = Partida(FuenteGuionada([6, 6, 3, 2, 1]))
    pensador = Pensador(_red_sin_futuro())
    esperado = pensador._tablas_del_turno(partida)["esperado"][2][INDICE_GUARDADO[guardado]]
    # Fuerza bruta: todos los resultados posibles (con orden), y en el tiro 3 la mejor anotación
    valores = []
    for resto in itertools.product(range(1, 7), repeat=5 - len(guardado)):
        q = Partida(FuenteGuionada(list(guardado + resto)))
        q.ultimo_tiro_servido = len(guardado) == 0
        valores.append(max(v for _, v in q.anotaciones_legales()) / 50)
    assert esperado == pytest.approx(np.mean(valores), abs=1e-9)


def test_en_el_tiro_3_anota_lo_que_mas_suma():
    p = Partida(FuenteAzar(4))
    p.aplicar(0)
    p.aplicar(0)  # tiro 3
    pensador = Pensador(_red_sin_futuro())
    jugada = pensador.elegir(p)
    mejor = max(v for _, v in p.anotaciones_legales())
    accion = decodificar(jugada)
    assert isinstance(accion, Anotar)
    antes = p.total()
    p.aplicar(jugada)
    assert p.total() - antes == mejor


@pytest.mark.parametrize("semilla", range(3))
def test_partidas_completas_legales(semilla):
    pensador = Pensador(Red(16), muestras=4)
    rng = random.Random(semilla)
    p = Partida(FuenteAzar(semilla))
    while not p.terminada:
        opciones = pensador.opciones(p)
        legales = set(p.jugadas_legales())
        assert all(j in legales for j, _ in opciones)
        assert [v for _, v in opciones] == sorted((v for _, v in opciones), reverse=True)
        # a veces sigue la mejor, a veces otra (para recorrer más situaciones)
        p.aplicar(opciones[0][0] if rng.random() < 0.7 else rng.choice(opciones)[0])
    assert 0 <= p.total() <= 1704


def test_objetivo_superar_da_chances():
    p = Partida(FuenteAzar(2))
    pensador = Pensador(Red(16), {"tipo": "superar", "umbral": 300}, muestras=4)
    for _, v in pensador.opciones(p):
        assert np.isfinite(v)
    assert pensador.en_puntos(p, 0.25) == 25  # se muestra como % de chance


def test_jugar_en_paralelo_es_reproducible(tmp_path):
    ruta = tmp_path / "m.pt"
    guardar_snapshot(Red(16), ruta, {})
    spec = {"ruta": str(ruta), "pensar": True, "muestras": 4}
    en_serie = [jugar_partida(spec, None, i, 11)["total"] for i in range(4)]
    paralelo = jugar_en_paralelo(spec, None, 4, 11, trabajadores=2)
    assert [r["indice"] for r in paralelo] == [0, 1, 2, 3]
    assert [r["total"] for r in paralelo] == en_serie
    assert all(r["segundos"] > 0 and len(r["casillas"]) == 52 for r in paralelo)


def test_examen_sin_pensar_vs_pensando(tmp_path):
    from generalito.analisis import main as analisis

    ruta = tmp_path / "m.pt"
    guardar_snapshot(Red(16), ruta, {})
    carpeta = tmp_path / "x"
    analisis(["comparar", "--modelo", str(ruta), "--modelo", str(ruta), "--pensar", "no",
              "--pensar", "si", "--examen", "--partidas", "4", "--muestras", "0", "--hilos", "2",
              "--carpeta", str(carpeta), "--max-cpu", "100"])  # fmt: skip
    estado = json.loads((carpeta / "estado.json").read_text())
    r = estado["resultado"]
    assert r["pensar"] == [False, True] and sum(r["victorias"]) == 4
    assert r["segundos_por_partida"][1] > r["segundos_por_partida"][0]  # pensar es más lento
    assert json.loads((carpeta / "config.json").read_text())["examen"] is True

    analisis(["analizar", "--modelo", str(ruta), "--pensar", "si", "--partidas", "3",
              "--muestras", "4", "--hilos", "1", "--carpeta", str(tmp_path / "y"),
              "--max-cpu", "100"])  # fmt: skip
    r = json.loads((tmp_path / "y" / "estado.json").read_text())["resultado"]
    assert r["pensar"] is True and sum(r["tiro_al_anotar"]) == 3 * 52


def test_examen_pensando_en_el_entrenamiento(tmp_path):
    from generalito.agente.entrenar import main as entrenar

    carpeta = tmp_path / "e"
    entrenar(["--carpeta", str(carpeta), "--max-partidas", "20", "--entornos", "12",
              "--pasos", "64", "--minilote", "256", "--oculta", "16", "--registrar-cada", "0",
              "--max-cpu", "100", "--examen-pensando", "3", "--muestras", "4",
              "--hilos", "2"])  # fmt: skip
    examen = json.loads((carpeta / "estado.json").read_text())["evaluaciones"][-1]
    assert examen["pensando"]["partidas"] == 3
    assert "sin_pensar_mismas" in examen["pensando"]


def test_red_numpy_igual_a_la_de_pytorch():
    from generalito.agente.codificacion import codificar
    from generalito.agente.pensar import RedNumpy

    red = Red(32)
    partida = Partida(FuenteAzar(3))
    x = codificar(partida)
    mascara = torch.tensor(partida.mascara_legal()).unsqueeze(0)
    with torch.no_grad():
        logits, v = red(torch.from_numpy(x).unsqueeze(0), mascara)
    rn = RedNumpy.desde(red)
    h = rn.tronco(x[None])
    assert np.allclose(rn.valor(h), v.numpy(), atol=1e-5)
    legal = mascara[0].numpy()
    assert np.allclose(rn.logits(h)[0][legal], logits[0].numpy()[legal], atol=1e-5)


def test_los_trabajadores_no_cargan_pytorch(tmp_path):
    """Cada proceso con PyTorch ocupa ~500 MB: los que juegan en paralelo no lo cargan."""
    import psutil

    ruta = tmp_path / "m.pt"
    guardar_snapshot(Red(16), ruta, {})
    con_torch = []

    def al_avanzar(_hechas):
        for hijo in psutil.Process().children(recursive=True):
            try:
                mapas = hijo.memory_maps()
            except psutil.Error:
                continue
            con_torch.append(any("torch" in m.path for m in mapas))

    spec = {"ruta": str(ruta), "pensar": False}
    jugar_en_paralelo(spec, None, 8, 1, trabajadores=2, al_avanzar=al_avanzar)
    assert con_torch and not any(con_torch)


@pytest.mark.parametrize("muestras", [0, 32])
def test_valor_por_bloques_igual_al_directo(monkeypatch, muestras):
    """El valor de las planillas por partes y por bloques da lo mismo que armarlo todo junto."""
    import generalito.agente.pensar as pensar
    from generalito.agente.codificacion import TAMANO_ESTADO, codificar_lote

    pensador = Pensador(Red(32), muestras=muestras)
    partida = Partida(FuenteAzar(4))
    casillas = np.tile(np.array(partida.planilla.casillas), (40, 1))
    casillas[np.arange(40), np.arange(40)] = np.arange(40) % 7
    monkeypatch.setattr(pensar, "FILAS_POR_BLOQUE", 1000)  # varios bloques
    por_bloques = pensador._valor_siguiente(casillas, 2)
    if muestras <= 0:
        dados, pesos = np.array(pensar.MULTICONJUNTOS), pensar.PROB_INICIAL
    else:
        rng = np.random.default_rng([pensador.semilla, 2])
        dados = rng.integers(1, 7, size=(muestras, 5))
        pesos = np.full(muestras, 1 / muestras)
    x = codificar_lote(casillas, dados, tiro=1, servido=True, turno=2)
    with torch.no_grad():
        red = pensador.red
        v = red.valor(red.tronco(torch.from_numpy(x.reshape(-1, TAMANO_ESTADO)))).numpy()
    directo = v.reshape(len(casillas), len(dados)) @ pesos
    assert np.allclose(por_bloques, directo, atol=1e-5)
