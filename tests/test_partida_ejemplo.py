"""Reproduce docs/PARTIDA_EJEMPLO.md turno por turno, leyendo la tabla del documento."""

import re
from pathlib import Path

from generalito.motor.categorias import NOMBRES, Categoria
from generalito.motor.jugadas import anotar, volver_a_tirar
from generalito.motor.partida import Partida
from generalito.motor.planilla import NOMBRES_COLUMNAS, Columna

DOC = Path(__file__).parent.parent / "docs" / "PARTIDA_EJEMPLO.md"
CATEGORIA_POR_NOMBRE = {v: k for k, v in NOMBRES.items()}
COLUMNA_POR_NOMBRE = {v: k for k, v in NOMBRES_COLUMNAS.items()}


def _dados(texto: str) -> list[int]:
    return [int(x) for x in texto.strip().split("-")]


def _leer_turnos():
    texto = DOC.read_text(encoding="utf-8")
    seccion = texto.split("## Turnos", 1)[1].split("## Planilla final", 1)[0]
    turnos = []
    for linea in seccion.splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if not celdas or not celdas[0].isdigit():
            continue
        numero, tiro1, tiro2, tiro3, anota, puntos = celdas
        tiros = [(None, _dados(tiro1))]
        for t in (tiro2, tiro3):
            if not t:
                continue
            accion, resultado = (s.strip() for s in t.split("→"))
            guardados = (
                [] if accion.startswith("tira los 5") else _dados(accion.removeprefix("guarda "))
            )
            tiros.append((guardados, _dados(resultado)))
        columna, categoria = (s.strip() for s in anota.split("·"))
        turnos.append(
            (
                int(numero),
                tiros,
                COLUMNA_POR_NOMBRE[columna],
                CATEGORIA_POR_NOMBRE[categoria],
                puntos,
            )
        )
    return turnos


def _leer_subtotales() -> list[int]:
    texto = DOC.read_text(encoding="utf-8")
    fila = re.search(r"^\| \*\*Subtotal\*\* \|(.*)$", texto, re.MULTILINE).group(1)
    return [int(x.strip(" *|")) for x in fila.split("|") if x.strip()]


class FuenteManual:
    def __init__(self):
        self.proximos: list[int] = []

    def tirar(self, turno, tiro, posiciones):
        assert len(self.proximos) == len(posiciones), (turno, tiro, posiciones, self.proximos)
        valores, self.proximos = self.proximos, []
        return valores


def test_partida_ejemplo_completa():
    turnos = _leer_turnos()
    assert len(turnos) == 52
    fuente = FuenteManual()
    fuente.proximos = turnos[0][1][0][1]
    partida = Partida(fuente)

    for i, (numero, tiros, columna, categoria, puntos) in enumerate(turnos):
        assert partida.turno == numero
        for guardados, resultado in tiros[1:]:
            # Ubicar en qué posiciones están los dados guardados
            libres = list(range(5))
            posiciones = []
            for valor in guardados:
                p = next(p for p in libres if partida.dados[p] == valor)
                libres.remove(p)
                posiciones.append(p)
            assert resultado[: len(guardados)] == guardados
            fuente.proximos = resultado[len(guardados) :]
            partida.aplicar(volver_a_tirar(posiciones))
            assert sorted(partida.dados) == sorted(resultado)
        assert partida.ultimo_tiro_servido == (len(tiros) == 1 or tiros[-1][0] == [])

        if i + 1 < len(turnos):
            fuente.proximos = turnos[i + 1][1][0][1]
        tachar = puntos == "X"
        jugada = anotar(Columna(columna), Categoria(categoria), tachar=tachar)
        assert jugada in partida.jugadas_legales(), (numero, partida.dados)
        partida.aplicar(jugada)
        esperado = 0 if tachar else int(puntos)
        assert partida.planilla.valor(columna, categoria) == esperado, numero

    assert partida.terminada
    assert [partida.planilla.subtotal(c) for c in Columna] == _leer_subtotales()
    assert partida.total() == 874


def test_baja_mayor_obligado_a_tachar():
    """Turno 50 de la partida de ejemplo: con Menor 28 en Baja, el Mayor de 12 no entra."""
    from generalito.motor.dados import FuenteGuionada
    from generalito.motor.planilla import Planilla

    planilla = Planilla()
    for categoria in Categoria:
        if categoria < Categoria.MENOR:
            planilla.anotar(Columna.BAJA, categoria, 0)
    planilla.anotar(Columna.BAJA, Categoria.MENOR, 28)
    partida = Partida(FuenteGuionada([4, 3, 2, 2, 1]))
    partida.planilla = planilla
    legales = partida.jugadas_legales()
    assert anotar(Columna.BAJA, Categoria.MAYOR) not in legales
    assert anotar(Columna.BAJA, Categoria.MAYOR, tachar=True) in legales
