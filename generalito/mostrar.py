"""Juega una partida al azar y la muestra turno por turno, para revisarla a mano.

La tabla sale en el mismo formato que docs/PARTIDA_EJEMPLO.md.

Uso:
    uv run generalito-mostrar --semilla 5
"""

import argparse
import random

from generalito.motor import FuenteAzar, Partida
from generalito.motor.categorias import NOMBRES
from generalito.motor.jugadas import Anotar, decodificar
from generalito.motor.planilla import NOMBRES_COLUMNAS


def _dados(dados) -> str:
    return "-".join(str(d) for d in dados)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--semilla", type=int, default=0)
    args = p.parse_args(argv)

    rng = random.Random(args.semilla)
    partida = Partida(FuenteAzar(args.semilla))
    print(f"Partida con decisiones al azar, semilla {args.semilla}.\n")
    print("| Turno | Tiro 1 | Tiro 2 | Tiro 3 | Anota en | Puntos |")
    print("| --- | --- | --- | --- | --- | --- |")
    while not partida.terminada:
        turno = partida.turno
        celdas = [_dados(partida.dados)]
        while True:
            jugada = rng.choice(partida.jugadas_legales())
            accion = decodificar(jugada)
            if isinstance(accion, Anotar):
                break
            guardados = [partida.dados[i] for i in accion.guardar]
            partida.aplicar(jugada)
            if guardados:
                nuevos = [partida.dados[i] for i in range(5) if i not in accion.guardar]
                celdas.append(f"guarda {_dados(guardados)} → {_dados(guardados + nuevos)}")
            else:
                celdas.append(f"tira los 5 ★ → {_dados(partida.dados)}")
        partida.aplicar(jugada)
        valor = partida.planilla.valor(accion.columna, accion.categoria)
        celdas += [""] * (3 - len(celdas))
        destino = f"{NOMBRES_COLUMNAS[accion.columna]} · {NOMBRES[accion.categoria]}"
        print(f"| {turno} | " + " | ".join(celdas) + f" | {destino} | {valor or 'X'} |")
    print()
    print(partida.planilla)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
