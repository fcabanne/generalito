"""La API de la interfaz local, contra un servidor real en un puerto libre."""

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from generalito.interfaz.servidor import crear_servidor


@pytest.fixture
def url(tmp_path):
    servidor = crear_servidor(0, tmp_path / "corridas")
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    yield f"http://127.0.0.1:{servidor.server_address[1]}"
    servidor.shutdown()
    servidor.server_close()


def pedir(url, ruta, cuerpo=None):
    datos = None if cuerpo is None else json.dumps(cuerpo).encode()
    req = urllib.request.Request(url + ruta, data=datos, method="POST" if datos else "GET")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_pagina(url):
    with urllib.request.urlopen(url + "/", timeout=10) as r:
        assert b"generalito" in r.read()


def test_jugar_una_partida(url):
    codigo, p = pedir(url, "/api/partidas", {"semilla": 3})
    assert codigo == 200 and p["turno"] == 1 and p["tiro"] == 1 and p["servido"]
    # Baja y Sube: una casilla habilitada cada una; Desordenada y Servida: las 13
    assert len(p["opciones"]) == 1 + 1 + 13 + 13

    _, p = pedir(url, f"/api/partidas/{p['id']}/jugada", {"jugada": 0b00011})
    assert p["tiro"] == 2 and not p["servido"]

    # Casilla no habilitada: Baja · Generala
    codigo, error = pedir(url, f"/api/partidas/{p['id']}/jugada", {"jugada": 31 + 2 * 12})
    assert codigo == 400 and "no permitida" in error["error"]

    _, p = pedir(url, f"/api/partidas/{p['id']}/azar", {"hasta": "turno"})
    assert p["turno"] == 2 and len(p["historial"]) == 1
    _, p = pedir(url, f"/api/partidas/{p['id']}/azar", {"hasta": "fin"})
    assert p["terminada"] and len(p["historial"]) == 52 and p["opciones"] == []
    assert p["total"] == sum(p["planilla"]["subtotales"])


def test_partida_inexistente(url):
    codigo, _ = pedir(url, "/api/partidas/999")
    assert codigo == 404


def test_simulacion_desde_la_interfaz(url):
    codigo, r = pedir(url, "/api/corridas", {"partidas": 50, "registrar_cada": 10, "max_cpu": 100})
    assert codigo == 200
    # Solo una a la vez
    codigo, error = pedir(url, "/api/corridas", {"partidas": 50})
    assert codigo == 400 and "corriendo" in error["error"]
    for _ in range(100):
        _, corridas = pedir(url, "/api/corridas")
        if corridas[0]["situacion"] == "terminada":
            break
        time.sleep(0.2)
    c = corridas[0]
    assert c["nombre"] == r["nombre"] and c["situacion"] == "terminada"
    assert c["estado"]["partidas"] == 50
    assert sum(c["estado"]["histograma"]["conteos"].values()) == 50

    codigo, s = pedir(url, "/api/sistema")
    assert codigo == 200 and s["nucleos"] >= 1
