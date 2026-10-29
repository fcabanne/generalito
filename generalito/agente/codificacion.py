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


def codificar_lote(
    casillas: np.ndarray, dados: np.ndarray, tiro: int, servido: bool, turno: int
) -> np.ndarray:
    """Todas las combinaciones de L planillas × K tiradas, igual que `codificar`.

    `casillas` es (L, 52) y `dados` es (K, 5). Devuelve (L, K, TAMANO_ESTADO).
    Lo usa "pensar el turno" para evaluar muchas planillas posibles de una vez.
    """
    casillas = np.asarray(casillas, dtype=np.float32)
    dados = np.asarray(dados, dtype=np.int64)
    n_l, n_k = casillas.shape[0], dados.shape[0]
    x = np.zeros((n_l, n_k, TAMANO_ESTADO), dtype=np.float32)
    parte_dados = np.zeros((n_k, 30), dtype=np.float32)
    filas = np.arange(n_k)[:, None]
    parte_dados[filas, np.arange(5)[None, :] * 6 + dados - 1] = 1.0
    x[:, :, :30] = parte_dados[None, :, :]
    x[:, :, _INICIO_TIRO + tiro - 1] = 1.0
    x[:, :, _SERVIDO] = float(servido)
    planilla = np.zeros((n_l, CANTIDAD_CASILLAS, 3), dtype=np.float32)
    planilla[:, :, 0] = casillas == LIBRE
    planilla[:, :, 1] = casillas == TACHADA
    planilla[:, :, 2] = np.maximum(casillas, 0) / 80.0
    x[:, :, _INICIO_PLANILLA:_TURNO] = planilla.reshape(n_l, 1, -1)
    x[:, :, _TURNO] = turno / 52.0
    return x


def codificar_crudo(
    dados: np.ndarray,
    tiro: np.ndarray,
    servido: np.ndarray,
    turno: np.ndarray,
    casillas: np.ndarray,
) -> np.ndarray:
    """N estados guardados como datos crudos (dados (N,5), tiro, servido, turno (N,),
    casillas (N,52)) → (N, TAMANO_ESTADO), igual que `codificar` uno por uno.

    Lo usa "Aprender pensando" para no guardar el vector entero de cada decisión.
    """
    dados = np.asarray(dados, dtype=np.int64)
    n = dados.shape[0]
    x = np.zeros((n, TAMANO_ESTADO), dtype=np.float32)
    filas = np.arange(n)[:, None]
    x[filas, np.arange(5)[None, :] * 6 + dados - 1] = 1.0
    x[np.arange(n), _INICIO_TIRO + np.asarray(tiro, dtype=np.int64) - 1] = 1.0
    x[:, _SERVIDO] = np.asarray(servido, dtype=np.float32)
    casillas = np.asarray(casillas, dtype=np.float32)
    planilla = x[:, _INICIO_PLANILLA:_TURNO].reshape(n, CANTIDAD_CASILLAS, 3)
    planilla[:, :, 0] = casillas == LIBRE
    planilla[:, :, 1] = casillas == TACHADA
    planilla[:, :, 2] = np.maximum(casillas, 0) / 80.0
    x[:, _TURNO] = np.asarray(turno, dtype=np.float32) / 52.0
    return x
