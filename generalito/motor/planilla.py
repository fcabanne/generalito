"""Planilla de un bando: 4 columnas × 13 categorías (REGLAS.md §3, §4, §5.1 y §6)."""

from enum import IntEnum

from generalito.motor.categorias import (
    CANTIDAD_CATEGORIAS,
    NOMBRES,
    Categoria,
    puntaje,
)


class Columna(IntEnum):
    BAJA = 0
    SUBE = 1
    DESORDENADA = 2
    SERVIDA = 3


NOMBRES_COLUMNAS = {
    Columna.BAJA: "Baja",
    Columna.SUBE: "Sube",
    Columna.DESORDENADA: "Desordenada",
    Columna.SERVIDA: "Servida",
}

CANTIDAD_COLUMNAS = len(Columna)
CANTIDAD_CASILLAS = CANTIDAD_COLUMNAS * CANTIDAD_CATEGORIAS

# Valores de una casilla. Un puntaje anotado es siempre > 0 (ver DECISIONES.md:
# anotar 0 en un número es tachar), así que una X se guarda como 0.
LIBRE = -1
TACHADA = 0

ORDEN_BAJADA = tuple(Categoria)
ORDEN_SUBIDA = tuple(reversed(ORDEN_BAJADA))
_N = CANTIDAD_CATEGORIAS


def indice_casilla(columna: Columna, categoria: Categoria) -> int:
    return columna * CANTIDAD_CATEGORIAS + categoria


class Planilla:
    """Estado de las 52 casillas. No sabe nada de dados ni de turnos."""

    def __init__(self) -> None:
        self.casillas: list[int] = [LIBRE] * CANTIDAD_CASILLAS

    def valor(self, columna: Columna, categoria: Categoria) -> int:
        return self.casillas[indice_casilla(columna, categoria)]

    def esta_libre(self, columna: Columna, categoria: Categoria) -> bool:
        return self.valor(columna, categoria) == LIBRE

    def completa(self) -> bool:
        return LIBRE not in self.casillas

    def casillas_habilitadas(self, columna: Columna) -> list[Categoria]:
        """Casillas libres donde la columna permite anotar o tachar (§3.2)."""
        base = columna * _N
        fila = self.casillas[base : base + _N]
        if columna == Columna.BAJA:
            orden = ORDEN_BAJADA
        elif columna == Columna.SUBE:
            orden = ORDEN_SUBIDA
        else:
            return [c for c in ORDEN_BAJADA if fila[c] == LIBRE]
        for categoria in orden:
            if fila[categoria] == LIBRE:
                return [categoria]
        return []

    def puntaje_posible(
        self,
        columna: Columna,
        categoria: Categoria,
        dados: tuple[int, ...],
        ultimo_tiro_servido: bool,
        puntajes: list[int | None] | None = None,
    ) -> int | None:
        """Puntaje que se anotaría en la casilla, o None si solo se puede tachar.

        No verifica que la casilla esté habilitada: eso es casillas_habilitadas().
        `puntajes` permite pasar ya calculado puntaje(categoría, dados) de las 13.
        """
        if columna == Columna.SERVIDA and not ultimo_tiro_servido:
            return None
        valor = puntajes[categoria] if puntajes is not None else puntaje(categoria, dados)
        if not valor:  # None, o 0 en un número: solo se puede tachar
            return None
        if categoria == Categoria.MENOR:
            mayor = self.valor(columna, Categoria.MAYOR)
            if mayor > 0 and not valor < mayor:
                return None
        if categoria == Categoria.MAYOR:
            menor = self.valor(columna, Categoria.MENOR)
            if menor > 0 and not valor > menor:
                return None
        return valor

    def anotar(self, columna: Columna, categoria: Categoria, valor: int) -> None:
        """Escribe la casilla sin validar. Las validaciones las hace Partida."""
        indice = indice_casilla(columna, categoria)
        if self.casillas[indice] != LIBRE:
            raise ValueError("La casilla ya está ocupada")
        self.casillas[indice] = valor

    # --- Puntaje (§6) ---

    def suma_numeros(self, columna: Columna) -> int:
        base = columna * _N
        return sum(v for v in self.casillas[base : base + 6] if v > 0)

    def bonus(self, columna: Columna) -> int:
        suma = self.suma_numeros(columna)
        return suma + 30 if suma >= 60 else suma

    def subtotal(self, columna: Columna) -> int:
        base = columna * _N
        resto = sum(v for v in self.casillas[base + 6 : base + _N] if v > 0)
        return self.bonus(columna) + resto

    def total(self) -> int:
        return sum(self.subtotal(col) for col in Columna)

    def __str__(self) -> str:
        filas = ["Categoría".ljust(13) + "".join(NOMBRES_COLUMNAS[c].rjust(12) for c in Columna)]

        def celda(v: int) -> str:
            return ("" if v == LIBRE else "X" if v == TACHADA else str(v)).rjust(12)

        for categoria in Categoria:
            filas.append(
                NOMBRES[categoria].ljust(13)
                + "".join(celda(self.valor(col, categoria)) for col in Columna)
            )
            if categoria == Categoria.SEIS:
                filas.append(
                    "Bonus".ljust(13) + "".join(str(self.bonus(c)).rjust(12) for c in Columna)
                )
        filas.append(
            "Subtotal".ljust(13) + "".join(str(self.subtotal(c)).rjust(12) for c in Columna)
        )
        filas.append(f"Total: {self.total()}")
        return "\n".join(filas)
