"""Partida de un bando (v1): turnos, tiros y anotación (REGLAS.md §2 y §4)."""

from generalito.motor.categorias import Categoria, puntaje
from generalito.motor.dados import CANTIDAD_DADOS, FuenteDados
from generalito.motor.jugadas import (
    CANTIDAD_JUGADAS,
    PRIMERA_ANOTAR,
    Anotar,
    anotar,
    decodificar,
)
from generalito.motor.planilla import TACHADA, Columna, Planilla

MAX_TIROS = 3


class JugadaIlegal(ValueError):
    pass


class Partida:
    """Un bando jugando sus 52 turnos.

    Al crearla ya se hizo el tiro 1 del turno 1. En cada momento se pide
    jugadas_legales() y se elige una con aplicar().
    """

    def __init__(self, fuente: FuenteDados) -> None:
        self.fuente = fuente
        self.planilla = Planilla()
        self.turno = 0  # se incrementa a 1 en _empezar_turno
        self.tiro = 0
        self.dados: tuple[int, ...] = ()
        self.ultimo_tiro_servido = False
        self.terminada = False
        self._empezar_turno()

    def _tirar(self, posiciones: tuple[int, ...]) -> None:
        self.tiro += 1
        valores = self.fuente.tirar(self.turno, self.tiro, posiciones)
        if len(valores) != len(posiciones) or any(not 1 <= v <= 6 for v in valores):
            raise RuntimeError(f"La fuente de dados devolvió valores inválidos: {valores}")
        dados = list(self.dados) if self.dados else [0] * CANTIDAD_DADOS
        for posicion, valor in zip(posiciones, valores, strict=True):
            dados[posicion] = valor
        self.dados = tuple(dados)
        self.ultimo_tiro_servido = len(posiciones) == CANTIDAD_DADOS

    def _empezar_turno(self) -> None:
        self.turno += 1
        self.tiro = 0
        self.dados = ()
        self._tirar(tuple(range(CANTIDAD_DADOS)))

    def anotaciones_legales(self) -> list[tuple[int, int]]:
        """Pares (jugada, valor que quedaría en la casilla) de anotar o tachar."""
        opciones = []
        puntajes = [puntaje(c, self.dados) for c in Categoria]  # una vez por turno, no por casilla
        for columna in Columna:
            for categoria in self.planilla.casillas_habilitadas(columna):
                valor = self.planilla.puntaje_posible(
                    columna, categoria, self.dados, self.ultimo_tiro_servido, puntajes
                )
                if valor is not None:
                    opciones.append((anotar(columna, categoria), valor))
                opciones.append((anotar(columna, categoria, tachar=True), TACHADA))
        return opciones

    def jugadas_legales(self) -> list[int]:
        if self.terminada:
            return []
        legales = list(range(PRIMERA_ANOTAR)) if self.tiro < MAX_TIROS else []
        legales.extend(j for j, _ in self.anotaciones_legales())
        return legales

    def mascara_legal(self) -> list[bool]:
        mascara = [False] * CANTIDAD_JUGADAS
        for jugada in self.jugadas_legales():
            mascara[jugada] = True
        return mascara

    def aplicar(self, jugada: int) -> None:
        if self.terminada:
            raise JugadaIlegal("La partida ya terminó")
        if not 0 <= jugada < CANTIDAD_JUGADAS:
            raise JugadaIlegal(f"Jugada fuera de rango: {jugada}")
        accion = decodificar(jugada)
        if isinstance(accion, Anotar):
            valores = dict(self.anotaciones_legales())
            if jugada not in valores:
                raise JugadaIlegal(f"No se puede anotar {accion} con {self.dados}")
            self.planilla.anotar(accion.columna, accion.categoria, valores[jugada])
            if self.planilla.completa():
                self.terminada = True
            else:
                self._empezar_turno()
            return
        if self.tiro >= MAX_TIROS:
            raise JugadaIlegal("Ya se hicieron los 3 tiros: hay que anotar")
        tirar = tuple(p for p in range(CANTIDAD_DADOS) if p not in accion.guardar)
        self._tirar(tirar)

    def total(self) -> int:
        return self.planilla.total()
