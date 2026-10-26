"""Interfaz local en el navegador: jugar partidas y manejar simulaciones.

Uso:
    uv run generalito            (abre el navegador solo)

Solo escucha en 127.0.0.1: no se puede acceder desde otra compu.
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from collections import OrderedDict
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psutil

from generalito.historial import PartidaConHistorial
from generalito.motor import FuenteAzar, JugadaIlegal
from generalito.motor.categorias import NOMBRES, Categoria
from generalito.motor.jugadas import anotar
from generalito.motor.planilla import LIBRE, NOMBRES_COLUMNAS, TACHADA, Columna
from generalito.recursos import ARCHIVO_PARAR, Limites, temperatura_gpu

PAGINA = Path(__file__).with_name("pagina.html")
MAX_PARTIDAS_EN_MEMORIA = 50


# --- Partidas interactivas ---


class Mesa:
    """Una partida que se juega desde la página."""

    def __init__(self, id_: str, semilla: int) -> None:
        self.id = id_
        self.semilla = semilla
        self.rng = random.Random(semilla)  # para las jugadas "al azar"
        self.juego = PartidaConHistorial(FuenteAzar(semilla))
        self.lock = threading.Lock()

    def jugar_al_azar(self, hasta: str) -> None:
        self.jugar_con(lambda p: self.rng.choice(p.jugadas_legales()), hasta)

    def jugar_con(self, elegir, hasta: str) -> None:
        """Juega con `elegir(partida) -> jugada` una jugada, el turno o hasta el final."""
        partida = self.juego.partida
        turno = partida.turno
        while not partida.terminada:
            self.juego.aplicar(elegir(partida))
            if hasta == "jugada" or (hasta == "turno" and partida.turno != turno):
                break

    def estado(self) -> dict:
        partida = self.juego.partida
        planilla = partida.planilla

        def celda(columna, categoria):
            v = planilla.valor(columna, categoria)
            return None if v == LIBRE else "X" if v == TACHADA else v

        opciones = []
        if not partida.terminada:
            puntajes = dict(partida.anotaciones_legales())
            for columna in Columna:
                for categoria in planilla.casillas_habilitadas(columna):
                    j_puntaje = anotar(columna, categoria)
                    opciones.append(
                        {
                            "columna": int(columna),
                            "categoria": int(categoria),
                            "puntaje": puntajes.get(j_puntaje),
                            "jugada_puntaje": j_puntaje if j_puntaje in puntajes else None,
                            "jugada_tachar": anotar(columna, categoria, tachar=True),
                        }
                    )
        return {
            "id": self.id,
            "semilla": self.semilla,
            "turno": partida.turno,
            "tiro": partida.tiro,
            "dados": list(partida.dados),
            "servido": partida.ultimo_tiro_servido,
            "terminada": partida.terminada,
            "puede_tirar": not partida.terminada and partida.tiro < 3,
            "total": partida.total(),
            "planilla": {
                "columnas": [NOMBRES_COLUMNAS[c] for c in Columna],
                "categorias": [NOMBRES[c] for c in Categoria],
                "valores": [[celda(col, cat) for col in Columna] for cat in Categoria],
                "bonus": [planilla.bonus(c) for c in Columna],
                "suma_numeros": [planilla.suma_numeros(c) for c in Columna],
                "subtotales": [planilla.subtotal(c) for c in Columna],
            },
            "opciones": opciones,
            "historial": self.juego.turnos,
            "tiros_turno_actual": self.juego.tiros_turno_actual,
        }


class Mesas:
    def __init__(self) -> None:
        self._mesas: OrderedDict[str, Mesa] = OrderedDict()
        self._lock = threading.Lock()
        self._siguiente = 1

    def nueva(self, semilla: int | None) -> Mesa:
        with self._lock:
            if semilla is None:
                semilla = random.randrange(1_000_000)
            mesa = Mesa(str(self._siguiente), semilla)
            self._siguiente += 1
            self._mesas[mesa.id] = mesa
            while len(self._mesas) > MAX_PARTIDAS_EN_MEMORIA:
                self._mesas.popitem(last=False)
            return mesa

    def get(self, id_: str) -> Mesa | None:
        return self._mesas.get(id_)


# --- Simulaciones ---


class Corridas:
    def __init__(self, carpeta: Path) -> None:
        self.carpeta = carpeta
        self.procesos: dict[str, subprocess.Popen] = {}

    def _corriendo(self, nombre: str, estado: dict | None, ruta: Path) -> bool:
        proceso = self.procesos.get(nombre)
        if proceso is not None:
            return proceso.poll() is None
        # Lanzada desde otra ventana o terminal: se considera viva si se actualizó hace poco
        archivo = ruta / "estado.json"
        recien = archivo.exists() and time.time() - archivo.stat().st_mtime < 30
        return bool(estado) and not estado.get("terminado") and recien

    def listar(self) -> list[dict]:
        if not self.carpeta.exists():
            return []
        resultado = []
        for ruta in sorted(self.carpeta.iterdir(), reverse=True):
            if not ruta.is_dir() or not (ruta / "config.json").exists():
                continue
            config = _leer_json(ruta / "config.json")
            estado = _leer_json(ruta / "estado.json")
            corriendo = self._corriendo(ruta.name, estado, ruta)
            if corriendo:
                situacion = "parando" if (ruta / ARCHIVO_PARAR).exists() else "corriendo"
            elif estado and estado.get("terminado"):
                situacion = "terminada"
            else:
                situacion = "interrumpida"
            resultado.append(
                {"nombre": ruta.name, "config": config, "estado": estado, "situacion": situacion}
            )
        return resultado

    def alguna_corriendo(self) -> bool:
        if any(p.poll() is None for p in self.procesos.values()):
            return True
        return any(c["situacion"] in ("corriendo", "parando") for c in self.listar())

    def _ejecutar(self, nombre: str, provisoria: dict, modulo: str, args: list[str]) -> str:
        if self.alguna_corriendo():
            raise ValueError("Ya hay algo corriendo. Esperá a que termine o paralo.")
        ruta = self.carpeta / nombre
        ruta.mkdir(parents=True, exist_ok=True)
        # Configuración provisoria para que aparezca en la lista enseguida;
        # el programa la reemplaza por la completa al arrancar.
        (ruta / "config.json").write_text(json.dumps(provisoria), encoding="utf-8")
        salida = open(ruta / "salida.log", "w", encoding="utf-8")  # noqa: SIM115
        self.procesos[nombre] = subprocess.Popen(
            [sys.executable, "-m", modulo, "--carpeta", str(ruta), *args],
            stdout=salida,
            stderr=subprocess.STDOUT,
            env=os.environ | {"PYTHONUTF8": "1"},
        )
        return nombre

    def lanzar(self, pedido: dict) -> str:
        partidas = int(pedido.get("partidas", 10_000))
        if not 1 <= partidas <= 100_000_000:
            raise ValueError("La cantidad de partidas tiene que estar entre 1 y 100.000.000")
        d = Limites()
        minutos = float(pedido.get("max_minutos", d.max_minutos))
        provisoria = {
            "programa": "simular",
            "jugador": "azar",
            "limites": {"max_partidas": partidas, "max_minutos": minutos},
        }
        args = [
            "--partidas", str(partidas),
            "--semilla", str(int(pedido.get("semilla", 0))),
            "--registrar-cada", str(int(pedido.get("registrar_cada", 1000))),
            "--max-minutos", str(minutos),
            "--hilos", str(int(pedido.get("hilos", d.hilos_cpu))),
            "--max-cpu", str(float(pedido.get("max_cpu", d.max_cpu_sistema))),
            "--max-ram-mb", str(float(pedido.get("max_ram_mb", d.max_ram_mb))),
            "--max-disco-mb", str(float(pedido.get("max_disco_mb", d.max_disco_mb))),
            "--min-disco-libre-gb",
            str(float(pedido.get("min_disco_libre_gb", d.min_disco_libre_gb))),
        ]  # fmt: skip
        nombre = datetime.now().strftime("%Y%m%d-%H%M%S-simular")
        return self._ejecutar(nombre, provisoria, "generalito.simular", args)

    def entrenar(self, pedido: dict) -> str:
        d = Limites()
        minutos = float(pedido.get("minutos", 60))
        if not 0 < minutos <= 7 * 24 * 60:
            raise ValueError("Los minutos tienen que estar entre 1 y una semana")
        args = [
            "--minutos", str(minutos),
            "--hilos", str(int(pedido.get("hilos", d.hilos_cpu))),
            "--max-cpu", str(float(pedido.get("max_cpu", d.max_cpu_sistema))),
        ]  # fmt: skip
        desde = None
        if pedido.get("continuar"):
            modelos = self.modelos()
            if modelos:
                desde = modelos[0]["ruta"]
                args += ["--desde", desde]
        provisoria = {
            "programa": "entrenar",
            "jugador": "agente",
            "desde": desde,
            "limites": {"max_partidas": None, "max_minutos": minutos},
        }
        nombre = datetime.now().strftime("%Y%m%d-%H%M%S-entrenar")
        return self._ejecutar(nombre, provisoria, "generalito.agente.entrenar", args)

    def modelos(self) -> list[dict]:
        """Modelos guardados, del más nuevo al más viejo."""
        resultado = []
        if not self.carpeta.exists():
            return resultado
        for ruta in sorted(self.carpeta.iterdir(), reverse=True):
            modelo = ruta / "modelo.pt"
            if not modelo.exists():
                continue
            estado = _leer_json(ruta / "estado.json") or {}
            evaluaciones = estado.get("evaluaciones") or []
            resultado.append(
                {
                    "nombre": ruta.name,
                    "ruta": str(modelo),
                    "promedio": evaluaciones[-1]["promedio"] if evaluaciones else None,
                    "partidas": estado.get("partidas_totales"),
                }
            )
        return resultado

    def parar(self, nombre: str) -> None:
        ruta = self.carpeta / nombre
        if not (ruta / "config.json").exists():
            raise ValueError(f"No existe {nombre}")
        (ruta / ARCHIVO_PARAR).touch()


def _leer_json(ruta: Path) -> dict | None:
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None  # todavía no existe o se está escribiendo


def estado_sistema(carpeta: Path) -> dict:
    memoria = psutil.virtual_memory()
    carpeta.mkdir(parents=True, exist_ok=True)
    return {
        "cpu_pct": psutil.cpu_percent(),
        "nucleos": os.cpu_count(),
        "ram_usada_gb": round(memoria.used / 2**30, 1),
        "ram_total_gb": round(memoria.total / 2**30, 1),
        "disco_libre_gb": round(shutil.disk_usage(carpeta).free / 2**30, 1),
        "temperatura_gpu": temperatura_gpu(),
        "defectos": Limites().como_dict(),
    }


# --- Modelo entrenado ---

_cache_red: dict = {}


def _red_actual(corridas: Corridas):
    """La red del modelo más nuevo.

    PyTorch se importa recién acá, para que la página abra rápido.
    """
    modelos = corridas.modelos()
    if not modelos:
        raise ValueError(
            "Todavía no hay ningún modelo entrenado. Entrenalo en la pestaña Entrenar."
        )
    ruta = Path(modelos[0]["ruta"])
    clave = (str(ruta), ruta.stat().st_mtime)
    if _cache_red.get("clave") != clave:
        from generalito.agente.red import cargar_snapshot

        red, _ = cargar_snapshot(ruta)
        _cache_red.update(clave=clave, red=red, nombre=modelos[0]["nombre"])
    return _cache_red["red"]


def _elegir(red, partida) -> int:
    from generalito.agente.red import elegir

    return elegir(red, partida)


def sugerencia(mesa: Mesa, corridas: Corridas) -> dict:
    partida = mesa.juego.partida
    if partida.terminada or not corridas.modelos():
        return {"opciones": []}
    from generalito.agente.red import probabilidades

    probs = probabilidades(_red_actual(corridas), partida)
    mejores = sorted(range(len(probs)), key=lambda j: -probs[j])[:3]
    return {
        "modelo": _cache_red.get("nombre"),
        "opciones": [
            {"jugada": j, "texto": _texto_jugada(partida, j), "prob": round(float(probs[j]), 3)}
            for j in mejores
            if probs[j] > 0.001
        ],
    }


def _texto_jugada(partida, jugada: int) -> str:
    from generalito.motor.jugadas import VolverATirar, decodificar

    accion = decodificar(jugada)
    if isinstance(accion, VolverATirar):
        if not accion.guardar:
            return "Tirar los 5"
        guardados = "-".join(str(partida.dados[i]) for i in accion.guardar)
        return f"Guardar {guardados} y tirar el resto"
    casilla = f"{NOMBRES[accion.categoria]} en {NOMBRES_COLUMNAS[accion.columna]}"
    if accion.tachar:
        return f"Tachar {casilla}"
    valor = dict(partida.anotaciones_legales())[jugada]
    return f"Anotar {valor} en {casilla}"


# --- HTTP ---


def crear_servidor(puerto: int, carpeta_corridas: Path) -> ThreadingHTTPServer:
    mesas = Mesas()
    corridas = Corridas(carpeta_corridas)

    class Manejador(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:  # silencio en la terminal
            pass

        def _responder(self, datos, codigo=HTTPStatus.OK) -> None:
            cuerpo = json.dumps(datos).encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def _error(self, mensaje: str, codigo=HTTPStatus.BAD_REQUEST) -> None:
            self._responder({"error": mensaje}, codigo)

        def _cuerpo(self) -> dict:
            largo = int(self.headers.get("Content-Length") or 0)
            if not largo:
                return {}
            return json.loads(self.rfile.read(largo).decode("utf-8"))

        def _mesa(self, id_: str) -> Mesa | None:
            mesa = mesas.get(id_)
            if mesa is None:
                self._error("Esa partida ya no existe. Empezá una nueva.", HTTPStatus.NOT_FOUND)
            return mesa

        def do_GET(self) -> None:
            partes = self.path.split("?")[0].strip("/").split("/")
            if partes == [""]:
                cuerpo = PAGINA.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)
            elif partes == ["api", "sistema"]:
                self._responder(estado_sistema(carpeta_corridas))
            elif partes == ["api", "corridas"]:
                self._responder(corridas.listar())
            elif partes == ["api", "modelos"]:
                self._responder(corridas.modelos())
            elif (
                len(partes) == 4 and partes[:2] == ["api", "partidas"] and partes[3] == "sugerencia"
            ):
                if mesa := self._mesa(partes[2]):
                    with mesa.lock:
                        self._responder(sugerencia(mesa, corridas))
            elif len(partes) == 3 and partes[:2] == ["api", "partidas"]:
                if mesa := self._mesa(partes[2]):
                    self._responder(mesa.estado())
            else:
                self._error("No encontrado", HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:
            partes = self.path.split("?")[0].strip("/").split("/")
            try:
                pedido = self._cuerpo()
                if partes == ["api", "partidas"]:
                    semilla = pedido.get("semilla")
                    mesa = mesas.nueva(None if semilla in (None, "") else int(semilla))
                    self._responder(mesa.estado())
                elif len(partes) == 4 and partes[:2] == ["api", "partidas"]:
                    if not (mesa := self._mesa(partes[2])):
                        return
                    with mesa.lock:
                        if partes[3] == "jugada":
                            mesa.juego.aplicar(int(pedido["jugada"]))
                        elif partes[3] == "azar":
                            mesa.jugar_al_azar(pedido.get("hasta", "jugada"))
                        elif partes[3] == "modelo":
                            red = _red_actual(corridas)
                            mesa.jugar_con(lambda p: _elegir(red, p), pedido.get("hasta", "jugada"))
                        else:
                            return self._error("Acción desconocida", HTTPStatus.NOT_FOUND)
                        self._responder(mesa.estado())
                elif partes == ["api", "corridas"]:
                    self._responder({"nombre": corridas.lanzar(pedido)})
                elif partes == ["api", "entrenamientos"]:
                    self._responder({"nombre": corridas.entrenar(pedido)})
                elif (
                    len(partes) == 4 and partes[:2] == ["api", "corridas"] and partes[3] == "parar"
                ):
                    corridas.parar(partes[2])
                    self._responder({"ok": True})
                else:
                    self._error("No encontrado", HTTPStatus.NOT_FOUND)
            except JugadaIlegal as error:
                self._error(f"Jugada no permitida: {error}")
            except (ValueError, KeyError, json.JSONDecodeError) as error:
                self._error(str(error))

    return ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--puerto", type=int, default=8765)
    p.add_argument("--carpeta", type=Path, default=Path("corridas"))
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    args = p.parse_args(argv)

    servidor = crear_servidor(args.puerto, args.carpeta)
    url = f"http://127.0.0.1:{args.puerto}/"
    print(f"generalito está abierto en {url}")
    print("Dejá esta ventana abierta mientras lo usás. Para cerrarlo: Ctrl+C o cerrar la ventana.")
    if not args.no_abrir:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrado.")
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
