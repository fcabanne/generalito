"""Cómo ve el agente una partida: un vector de números, sin pistas de estrategia.

Solo información cruda (PRD, "Sin sesgo humano"):

- dados: 5 posiciones × 6 caras, one-hot (30)
- tiro: one-hot de 1, 2 o 3 (3)
- si el último tiro fue servido (1)
- planilla: por cada una de las 52 casillas, libre / tachada / puntaje ÷ 80 (156)
- turno ÷ 52 (1)

Si esto cambia, hay que subir VERSION_CODIFICACION: los modelos guardados
con otra versión dejan de servir.
"""

import numpy as np

from generalito.motor import Partida
from generalito.motor.planilla import CANTIDAD_CASILLAS, LIBRE, TACHADA

VERSION_CODIFICACION = "1"
TAMANO_ESTADO = 30 + 3 + 1 + 3 * CANTIDAD_CASILLAS + 1  # 191

_INICIO_TIRO = 30
_SERVIDO = 33
_INICIO_PLANILLA = 34
_TURNO = _INICIO_PLANILLA + 3 * CANTIDAD_CASILLAS


def codificar(partida: Partida, destino: np.ndarray | None = None) -> np.ndarray:
    x = destino if destino is not None else np.empty(TAMANO_ESTADO, dtype=np.float32)
    x.fill(0.0)
    for posicion, valor in enumerate(partida.dados):
        x[posicion * 6 + valor - 1] = 1.0
    x[_INICIO_TIRO + partida.tiro - 1] = 1.0
    x[_SERVIDO] = float(partida.ultimo_tiro_servido)
    casillas = np.asarray(partida.planilla.casillas, dtype=np.float32)
    planilla = x[_INICIO_PLANILLA:_TURNO].reshape(CANTIDAD_CASILLAS, 3)
    planilla[:, 0] = casillas == LIBRE
    planilla[:, 1] = casillas == TACHADA
    planilla[:, 2] = np.maximum(casillas, 0) / 80.0
    x[_TURNO] = partida.turno / 52.0
    return x
