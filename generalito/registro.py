"""Registro de decisiones (PRD, "Registro de decisiones y análisis").

Por cada decisión guarda: partida, turno, tiro, si el último tiro fue servido,
los dados, la planilla (52 casillas), la jugada elegida y el valor que el
agente le asignó a cada una de las 135 jugadas (NaN si no hay valores, por
ejemplo con el jugador al azar, o para jugadas ilegales).

Se escribe en archivos .npz comprimidos de a bloques. Antes de escribir cada
bloque se verifica el límite de disco: si se pasaría, se lanza LimiteDeDisco
y no se escribe nada.
"""

import json
import shutil
from pathlib import Path

import numpy as np

from generalito.motor import CANTIDAD_JUGADAS, VERSION_REGLAS, Partida
from generalito.recursos import tamano_carpeta

VERSION_REGISTRO = "1"


class LimiteDeDisco(RuntimeError):
    pass


class RegistroDecisiones:
    def __init__(
        self,
        carpeta: Path,
        max_mb: float,
        min_libre_gb: float = 0.0,
        decisiones_por_archivo: int = 50_000,
    ) -> None:
        self.carpeta = Path(carpeta)
        self.carpeta.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_mb * 2**20
        self.min_libre_bytes = min_libre_gb * 2**30
        self.decisiones_por_archivo = decisiones_por_archivo
        self._archivos = len(list(self.carpeta.glob("registro_*.npz")))  # para continuar
        self._vaciar_buffer()
        meta = {"version_registro": VERSION_REGISTRO, "version_reglas": VERSION_REGLAS}
        (self.carpeta / "registro.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def _vaciar_buffer(self) -> None:
        self._partida: list[int] = []
        self._turno: list[int] = []
        self._tiro: list[int] = []
        self._servido: list[bool] = []
        self._dados: list[tuple[int, ...]] = []
        self._planilla: list[list[int]] = []
        self._jugada: list[int] = []
        self._valores: list[np.ndarray] = []

    def agregar(
        self,
        id_partida: int,
        partida: Partida,
        jugada: int,
        valores: np.ndarray | None = None,
    ) -> None:
        """Registra la decisión `jugada` tomada en el estado actual de `partida`.

        Llamar ANTES de partida.aplicar(jugada).
        """
        self._partida.append(id_partida)
        self._turno.append(partida.turno)
        self._tiro.append(partida.tiro)
        self._servido.append(partida.ultimo_tiro_servido)
        self._dados.append(partida.dados)
        self._planilla.append(list(partida.planilla.casillas))
        self._jugada.append(jugada)
        if valores is None:
            valores = np.full(CANTIDAD_JUGADAS, np.nan, dtype=np.float32)
        self._valores.append(np.asarray(valores, dtype=np.float32))
        if len(self._jugada) >= self.decisiones_por_archivo:
            self.guardar()

    def guardar(self) -> None:
        if not self._jugada:
            return
        datos = {
            "partida": np.array(self._partida, dtype=np.int64),
            "turno": np.array(self._turno, dtype=np.int8),
            "tiro": np.array(self._tiro, dtype=np.int8),
            "servido": np.array(self._servido, dtype=bool),
            "dados": np.array(self._dados, dtype=np.int8),
            # LIBRE = -1, TACHADA = 0, puntaje > 0 (máximo 80, entra en int8)
            "planilla": np.array(self._planilla, dtype=np.int8),
            "jugada": np.array(self._jugada, dtype=np.int16),
            "valores": np.stack(self._valores),
        }
        destino = self.carpeta / f"registro_{self._archivos:05d}.npz"
        temporal = self.carpeta / f"parcial_{self._archivos:05d}.npz"
        np.savez_compressed(temporal, **datos)
        nuevo = temporal.stat().st_size
        libre = shutil.disk_usage(self.carpeta).free
        if tamano_carpeta(self.carpeta) > self.max_bytes or libre < self.min_libre_bytes:
            temporal.unlink()
            raise LimiteDeDisco(
                f"El registro superaría {self.max_bytes / 2**20:.0f} MB "
                f"o dejaría el disco con menos de {self.min_libre_bytes / 2**30:.1f} GB libres "
                f"(bloque de {nuevo / 2**20:.1f} MB descartado)"
            )
        temporal.rename(destino)
        self._archivos += 1
        self._vaciar_buffer()

    def cerrar(self) -> None:
        self.guardar()


def leer_registro(carpeta: Path) -> dict[str, np.ndarray]:
    """Junta todos los bloques de una carpeta (y sus subcarpetas) en un diccionario de arrays."""
    archivos = sorted(Path(carpeta).rglob("registro_[0-9]*.npz"))  # incluye subcarpetas
    if not archivos:
        return {}
    bloques = [dict(np.load(a)) for a in archivos]
    return {clave: np.concatenate([b[clave] for b in bloques]) for clave in bloques[0]}
