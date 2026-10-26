"""Motor del juego: reglas puras, sin NumPy ni PyTorch.

La versión de reglas tiene que coincidir con docs/REGLAS.md. Si cambian las
reglas, se sube y los snapshots entrenados con la versión anterior dejan de servir.
"""

from generalito.motor.categorias import Categoria, puntaje
from generalito.motor.dados import FuenteAzar, FuenteGuionada, FuenteReservada
from generalito.motor.jugadas import (
    CANTIDAD_JUGADAS,
    anotar,
    decodificar,
    describir,
    volver_a_tirar,
)
from generalito.motor.partida import JugadaIlegal, Partida
from generalito.motor.planilla import Columna, Planilla

VERSION_REGLAS = "1.0"

__all__ = [
    "CANTIDAD_JUGADAS",
    "VERSION_REGLAS",
    "Categoria",
    "Columna",
    "FuenteAzar",
    "FuenteGuionada",
    "FuenteReservada",
    "JugadaIlegal",
    "Partida",
    "Planilla",
    "anotar",
    "decodificar",
    "describir",
    "puntaje",
    "volver_a_tirar",
]
