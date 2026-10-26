"""Juega una partida al azar y la muestra turno por turno, para revisarla a mano.

La tabla sale en el mismo formato que docs/PARTIDA_EJEMPLO.md.

Uso:
    uv run generalito-mostrar --semilla 5
"""

import argparse
import random

from generalito.historial import PartidaConHistorial
from generalito.motor import FuenteAzar


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--semilla", type=int, default=0)
    args = p.parse_args(argv)

    rng = random.Random(args.semilla)
    juego = PartidaConHistorial(FuenteAzar(args.semilla))
    while not juego.partida.terminada:
        juego.aplicar(rng.choice(juego.partida.jugadas_legales()))
    print(f"Partida con decisiones al azar, semilla {args.semilla}.\n")
    print(juego.tabla_markdown())
    print()
    print(juego.partida.planilla)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
