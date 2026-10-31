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
    for _ in range(300):  # hasta 60 s, por si la máquina está ocupada
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


def test_modelos_con_nombre(tmp_path):
    torch = pytest.importorskip("torch")  # noqa: F841
    from generalito.agente.red import Red, guardar_snapshot

    corridas = tmp_path / "corridas"
    entrenamiento = corridas / "20260101-000000-entrenar"
    guardar_snapshot(Red(16), entrenamiento / "mejor.pt", {"partidas_entrenadas": 100})
    (entrenamiento / "estado.json").write_text(
        json.dumps({"evaluaciones": [{"partidas": 100, "promedio": 512.5}]})
    )
    servidor = crear_servidor(0, corridas, tmp_path / "modelos")
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{servidor.server_address[1]}"
    try:
        _, r = pedir(url, "/api/modelos")
        assert [m["clave"] for m in r["modelos"]] == ["ultimo"] and r["activo"] == "ultimo"

        codigo, meta = pedir(url, "/api/modelos", {"nombre": "modelo-v1"})
        assert codigo == 200 and meta["promedio"] == 512.5
        assert (tmp_path / "modelos" / "modelo-v1.pt").exists()
        codigo, error = pedir(url, "/api/modelos", {"nombre": "modelo-v1"})
        assert codigo == 400 and "Ya existe" in error["error"]
        codigo, _ = pedir(url, "/api/modelos", {"nombre": "../malo"})
        assert codigo == 400

        _, r = pedir(url, "/api/modelos/activo", {"clave": "modelo-v1"})
        assert r["activo"] == "modelo-v1" and len(r["modelos"]) == 2

        _, p = pedir(url, "/api/partidas", {"semilla": 1})
        _, s = pedir(url, f"/api/partidas/{p['id']}/sugerencia")
        assert s["modelo"] == "modelo-v1" and s["opciones"]
        _, p = pedir(url, f"/api/partidas/{p['id']}/modelo", {"hasta": "fin"})
        assert p["terminada"]

        # Pensando el turno
        _, p = pedir(url, "/api/partidas", {"semilla": 2})
        _, s = pedir(url, f"/api/partidas/{p['id']}/sugerencia?pensar=1")
        assert s["pensando"] and len(s["opciones"]) == 3 and s["unidad"] == "pts"
        _, p = pedir(url, f"/api/partidas/{p['id']}/modelo", {"hasta": "turno", "pensar": True})
        assert p["turno"] == 2
        mismo = {"tipo": "comparar", "modelos": ["modelo-v1", "modelo-v1"]}
        codigo, _ = pedir(url, "/api/analisis", mismo)
        assert codigo == 400  # el mismo modelo, sin pensar en los dos lados

        codigo, r = pedir(
            url, "/api/analisis", {"tipo": "comparar", "modelos": ["ultimo", "ultimo"]}
        )
        assert codigo == 400
        pedido = {"tipo": "analizar", "modelos": ["modelo-v1"], "partidas": 20}
        codigo, r = pedir(url, "/api/analisis", pedido)
        assert codigo == 200
        for _ in range(300):
            _, lista = pedir(url, "/api/corridas")
            c = next(x for x in lista if x["nombre"] == r["nombre"])
            if c["situacion"] == "terminada":
                break
            time.sleep(0.2)
        assert c["config"]["programa"] == "analizar"
        assert c["estado"]["resultado"]["partidas"] == 20

        # "Aprender pensando": solo desde un modelo
        codigo, error = pedir(url, "/api/entrenamientos", {"modo": "aprender", "minutos": 1})
        assert codigo == 400 and "modelo entrenado" in error["error"]
        aprender = {"modo": "aprender", "minutos": 1, "desde": "modelo-v1", "partidas_ciclo": 50}
        codigo, r = pedir(url, "/api/entrenamientos", aprender)
        assert codigo == 200
        proceso = servidor.corridas.procesos[r["nombre"]]
        assert proceso.args[proceso.args.index("-m") + 1] == "generalito.agente.aprender"
        assert proceso.args[proceso.args.index("--partidas-ciclo") + 1] == "50"
        proceso.terminate()
        proceso.wait(timeout=30)
        codigo, _ = pedir(url, "/api/entrenamientos", {**aprender, "alumna_oculta": 300})
        assert codigo == 400
        codigo, r = pedir(url, "/api/entrenamientos", {**aprender, "alumna_oculta": 512})
        assert codigo == 200
        proceso = servidor.corridas.procesos[r["nombre"]]
        assert proceso.args[proceso.args.index("--alumna-oculta") + 1] == "512"
        proceso.terminate()
        proceso.wait(timeout=30)

        # "Superar X" siguiendo un modelo guardado; no se combina con la pista
        objetivo = {"tipo": "superar", "umbral": 900}
        pedido = {"minutos": 1, "desde": "modelo-v1", "objetivo": objetivo}
        con_pista = {**pedido, "pista": {"activa": True, "peso": 0.5, "fin_pct": 50}}
        codigo, _ = pedir(url, "/api/entrenamientos", con_pista)
        assert codigo == 400
        codigo, r = pedir(url, "/api/entrenamientos", pedido)
        assert codigo == 200
        proceso = servidor.corridas.procesos[r["nombre"]]
        assert proceso.args[proceso.args.index("--objetivo") + 1] == "superar"
        assert proceso.args[proceso.args.index("--umbral") + 1] == "900"
        assert proceso.args[proceso.args.index("--calentamiento") + 1] == "5.0"
        assert "--oculta" not in proceso.args  # siguiendo un modelo usa su tamaño
        proceso.terminate()
        proceso.wait(timeout=30)
    finally:
        servidor.shutdown()
        servidor.server_close()


def test_entrenar_con_horizonte(tmp_path):
    pytest.importorskip("torch")
    servidor = crear_servidor(0, tmp_path / "corridas", tmp_path / "modelos")
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{servidor.server_address[1]}"
    try:
        codigo, _ = pedir(url, "/api/entrenamientos", {"minutos": 1, "lambda_gae": 1.5})
        assert codigo == 400
        codigo, _ = pedir(url, "/api/entrenamientos", {"minutos": 1, "entropia": 0.5})
        assert codigo == 400
        malo = {"minutos": 1, "pista": {"activa": True, "peso": 5}}
        codigo, _ = pedir(url, "/api/entrenamientos", malo)
        assert codigo == 400
        pista = {"activa": True, "peso": 0.5, "fin_pct": 40}
        codigo, _ = pedir(url, "/api/entrenamientos", {"minutos": 1, "oculta": 300})
        assert codigo == 400
        malo = {"minutos": 1, "objetivo": {"tipo": "mixto", "umbral": 950, "premio": 5000}}
        codigo, _ = pedir(url, "/api/entrenamientos", malo)
        assert codigo == 400
        superar = {"minutos": 1, "objetivo": {"tipo": "superar", "umbral": 900}}
        codigo, error = pedir(url, "/api/entrenamientos", superar)  # desde cero: no
        assert codigo == 400 and "siguiendo un modelo" in error["error"]
        pedido = {
            "objetivo": {"tipo": "mixto", "umbral": 950, "premio": 100},
            "minutos": 1,
            "lambda_gae": 0.99,
            "entropia": 0.02,
            "pista": pista,
            "oculta": 512,
        }
        codigo, r = pedir(url, "/api/entrenamientos", pedido)
        assert codigo == 200
        config = json.loads((tmp_path / "corridas" / r["nombre"] / "config.json").read_text())
        assert config["parametros"]["lambda_gae"] == 0.99
        proceso = servidor.corridas.procesos[r["nombre"]]
        assert proceso.args[proceso.args.index("--lambda-gae") + 1] == "0.99"
        assert proceso.args[proceso.args.index("--entropia") + 1] == "0.02"
        assert config["parametros"]["entropia"] == 0.02
        assert config["parametros"]["pista_bonus"] == 0.5
        assert proceso.args[proceso.args.index("--pista-bonus") + 1] == "0.5"
        assert proceso.args[proceso.args.index("--pista-fin") + 1] == "40.0"
        assert proceso.args[proceso.args.index("--oculta") + 1] == "512"
        assert config["parametros"]["oculta"] == 512
        assert config["objetivo"] == {"tipo": "mixto", "umbral": 950, "premio": 100}
        assert proceso.args[proceso.args.index("--objetivo") + 1] == "mixto"
        assert proceso.args[proceso.args.index("--premio") + 1] == "100"
        proceso.terminate()
        proceso.wait(timeout=30)
    finally:
        servidor.shutdown()
        servidor.server_close()
