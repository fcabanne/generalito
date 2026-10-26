"""Codificación de las jugadas como enteros (ver DECISIONES.md).

- 0 a 30: volver a tirar. El número es la máscara de dados guardados: el bit i
  en 1 significa que se guarda el dado de la posición i. 0 es tirar los 5
  (tiro servido). 31 (guardar los 5) no existe: eso es anotar.
- 31 a 134: anotar. 31 + 2 × casilla + (0 = puntaje, 1 = tachar), con
  casilla = columna × 13 + categoría.
"""

from dataclasses import dataclass

from generalito.motor.categorias import CANTIDAD_CATEGORIAS, NOMBRES, Categoria
from generalito.motor.dados import CANTIDAD_DADOS
from generalito.motor.planilla import (
    CANTIDAD_CASILLAS,
    NOMBRES_COLUMNAS,
    Columna,
    indice_casilla,
)

CANTIDAD_VOLVER_A_TIRAR = 2**CANTIDAD_DADOS - 1  # 31
PRIMERA_ANOTAR = CANTIDAD_VOLVER_A_TIRAR
CANTIDAD_JUGADAS = PRIMERA_ANOTAR + 2 * CANTIDAD_CASILLAS  # 135


@dataclass(frozen=True)
class VolverATirar:
    guardar: tuple[int, ...]  # posiciones guardadas


@dataclass(frozen=True)
class Anotar:
    columna: Columna
    categoria: Categoria
    tachar: bool


def volver_a_tirar(guardar: tuple[int, ...] | list[int]) -> int:
    mascara = 0
    for posicion in guardar:
        if not 0 <= posicion < CANTIDAD_DADOS:
            raise ValueError(f"Posición inválida: {posicion}")
        mascara |= 1 << posicion
    if mascara == 2**CANTIDAD_DADOS - 1:
        raise ValueError("No se pueden guardar los 5 dados: eso es anotar")
    return mascara


def anotar(columna: Columna, categoria: Categoria, tachar: bool = False) -> int:
    return PRIMERA_ANOTAR + 2 * indice_casilla(columna, categoria) + int(tachar)


def decodificar(jugada: int) -> VolverATirar | Anotar:
    if not 0 <= jugada < CANTIDAD_JUGADAS:
        raise ValueError(f"Jugada fuera de rango: {jugada}")
    if jugada < PRIMERA_ANOTAR:
        return VolverATirar(tuple(i for i in range(CANTIDAD_DADOS) if jugada >> i & 1))
    casilla, tachar = divmod(jugada - PRIMERA_ANOTAR, 2)
    columna, categoria = divmod(casilla, CANTIDAD_CATEGORIAS)
    return Anotar(Columna(columna), Categoria(categoria), bool(tachar))


def describir(jugada: int) -> str:
    j = decodificar(jugada)
    if isinstance(j, VolverATirar):
        if not j.guardar:
            return "tira los 5"
        return "guarda posiciones " + ",".join(str(p) for p in j.guardar)
    accion = "tacha" if j.tachar else "anota"
    return f"{accion} {NOMBRES_COLUMNAS[j.columna]} · {NOMBRES[j.categoria]}"
