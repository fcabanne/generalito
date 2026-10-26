"""Simula partidas con un jugador al azar, respetando los límites de recursos.

Sirve para probar el motor, el registro y los controles de recursos de punta a
punta. Es el esqueleto que van a seguir el entrenamiento y la evaluación.

Uso:
    uv run generalito-simular --partidas 10000
    uv run generalito-simular --partidas 100000 --max-minutos 10 --registrar-cada 100

Mientras corre:
    - En la terminal se ve el progreso cada pocos segundos.
    - corridas/<nombre>/estado.json tiene el último estado (progreso y recursos).
    - Para frenar: Ctrl+C, o crear un archivo PARAR en la carpeta de la corrida.
"""

import argparse
import json
import random
import statistics
import time
from datetime import datetime
from pathlib import Path

from generalito.motor import VERSION_REGLAS, FuenteAzar, Partida
from generalito.recursos import ARCHIVO_PARAR, Guardian, Limites, aplicar_limites_proceso
from generalito.registro import LimiteDeDisco, RegistroDecisiones


def _argumentos(argv: list[str] | None) -> argparse.Namespace:
    d = Limites()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--partidas", type=int, required=True, help="máximo de partidas a jugar")
    p.add_argument("--semilla", type=int, default=0)
    p.add_argument(
        "--registrar-cada",
        type=int,
        default=1000,
        help="registrar 1 de cada N partidas (0 = no registrar)",
    )
    p.add_argument(
        "--carpeta", type=Path, default=None, help="por defecto corridas/<fecha>-simular"
    )
    g = p.add_argument_group("límites de recursos")
    g.add_argument("--max-minutos", type=float, default=d.max_minutos)
    g.add_argument("--hilos", type=int, default=d.hilos_cpu)
    g.add_argument("--max-cpu", type=float, default=d.max_cpu_sistema, help="%% del sistema")
    g.add_argument("--max-ram-mb", type=float, default=d.max_ram_mb)
    g.add_argument("--max-disco-mb", type=float, default=d.max_disco_mb)
    g.add_argument("--min-disco-libre-gb", type=float, default=d.min_disco_libre_gb)
    g.add_argument(
        "--prioridad-normal",
        action="store_true",
        help="no bajar la prioridad del proceso",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _argumentos(argv)
    limites = Limites(
        max_partidas=args.partidas,
        max_minutos=args.max_minutos,
        hilos_cpu=args.hilos,
        prioridad_baja=not args.prioridad_normal,
        max_cpu_sistema=args.max_cpu,
        max_ram_mb=args.max_ram_mb,
        max_disco_mb=args.max_disco_mb,
        min_disco_libre_gb=args.min_disco_libre_gb,
    )
    aplicar_limites_proceso(limites)

    carpeta = args.carpeta or Path("corridas") / datetime.now().strftime("%Y%m%d-%H%M%S-simular")
    carpeta.mkdir(parents=True, exist_ok=True)
    config = {
        "programa": "simular",
        "jugador": "azar",
        "semilla": args.semilla,
        "registrar_cada": args.registrar_cada,
        "version_reglas": VERSION_REGLAS,
        "limites": limites.como_dict(),
    }
    (carpeta / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    guardian = Guardian(limites, carpeta)
    registro = None
    if args.registrar_cada > 0:
        registro = RegistroDecisiones(
            carpeta / "registro",
            max_mb=limites.max_disco_mb,
            min_libre_gb=limites.min_disco_libre_gb,
        )

    print(f"Corrida en {carpeta}. Para frenar: Ctrl+C o crear {carpeta / ARCHIVO_PARAR}")
    rng = random.Random(args.semilla)
    totales: list[int] = []
    motivo = None
    ultimo_reporte = 0.0

    def escribir_estado(final: bool) -> None:
        estado = {
            "partidas": len(totales),
            "promedio": round(statistics.fmean(totales), 2) if totales else None,
            "maximo": max(totales, default=None),
            "terminado": final,
            "motivo": motivo,
            "recursos": guardian.ultima_medicion or guardian.medir(),
        }
        (carpeta / "estado.json").write_text(json.dumps(estado, indent=2), encoding="utf-8")

    try:
        while motivo is None:
            id_partida = len(totales)
            partida = Partida(FuenteAzar(rng.getrandbits(64)))
            registrar = registro is not None and id_partida % args.registrar_cada == 0
            while not partida.terminada:
                jugada = rng.choice(partida.jugadas_legales())
                if registrar:
                    registro.agregar(id_partida, partida, jugada)
                partida.aplicar(jugada)
            totales.append(partida.total())

            motivo = guardian.revisar(len(totales))
            if time.monotonic() - ultimo_reporte > 5 or motivo:
                ultimo_reporte = time.monotonic()
                r = guardian.ultima_medicion
                print(
                    f"{len(totales):>8} partidas · promedio {statistics.fmean(totales):7.1f}"
                    f" · {guardian.minutos():5.1f} min"
                    f" · CPU proceso {r.get('cpu_proceso_pct', 0):.0f}%"
                    f" · RAM {r.get('ram_proceso_mb', 0):.0f} MB"
                    f" · disco corrida {r.get('disco_corrida_mb', 0):.1f} MB",
                    flush=True,
                )
                escribir_estado(final=False)
        if registro is not None:
            registro.cerrar()
    except LimiteDeDisco as error:
        motivo = str(error)
    finally:
        guardian.cerrar()

    escribir_estado(final=True)
    print(f"Fin: {motivo}. Resumen en {carpeta / 'estado.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
