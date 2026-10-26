"""Partida que va anotando cada turno en el formato de docs/PARTIDA_EJEMPLO.md."""

from generalito.motor import Partida
from generalito.motor.categorias import NOMBRES
from generalito.motor.dados import FuenteDados
from generalito.motor.jugadas import Anotar, decodificar
from generalito.motor.planilla import NOMBRES_COLUMNAS


def texto_dados(dados) -> str:
    return "-".join(str(d) for d in dados)


class PartidaConHistorial:
    def __init__(self, fuente: FuenteDados) -> None:
        self.partida = Partida(fuente)
        self.turnos: list[dict] = []
        self._tiros = [texto_dados(self.partida.dados)]

    def aplicar(self, jugada: int) -> None:
        partida = self.partida
        accion = decodificar(jugada)
        if isinstance(accion, Anotar):
            turno = partida.turno
            partida.aplicar(jugada)  # valida; si es ilegal no cambia nada
            valor = partida.planilla.valor(accion.columna, accion.categoria)
            self.turnos.append(
                {
                    "turno": turno,
                    "tiros": self._tiros,
                    "anota": f"{NOMBRES_COLUMNAS[accion.columna]} · {NOMBRES[accion.categoria]}",
                    "puntos": valor or "X",
                }
            )
            self._tiros = [] if partida.terminada else [texto_dados(partida.dados)]
            return
        guardados = [partida.dados[i] for i in accion.guardar]
        partida.aplicar(jugada)
        if guardados:
            nuevos = [partida.dados[i] for i in range(5) if i not in accion.guardar]
            self._tiros.append(
                f"guarda {texto_dados(guardados)} → {texto_dados(guardados + nuevos)}"
            )
        else:
            self._tiros.append(f"tira los 5 ★ → {texto_dados(partida.dados)}")

    @property
    def tiros_turno_actual(self) -> list[str]:
        return list(self._tiros)

    def tabla_markdown(self) -> str:
        filas = [
            "| Turno | Tiro 1 | Tiro 2 | Tiro 3 | Anota en | Puntos |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for t in self.turnos:
            tiros = t["tiros"] + [""] * (3 - len(t["tiros"]))
            filas.append(
                f"| {t['turno']} | " + " | ".join(tiros) + f" | {t['anota']} | {t['puntos']} |"
            )
        return "\n".join(filas)
