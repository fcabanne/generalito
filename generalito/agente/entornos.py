"""Muchas partidas a la vez, opcionalmente repartidas en varios procesos.

El proceso principal tiene la red; los trabajadores solo juegan (motor en
Python puro, sin PyTorch). En cada paso el principal manda una jugada por
partida y recibe los estados nuevos, las recompensas y qué partidas terminaron.
"""

import multiprocessing as mp
import random
from pathlib import Path

import numpy as np

from generalito.agente.codificacion import TAMANO_ESTADO, codificar
from generalito.agente.pista import potencial_partida
from generalito.motor import CANTIDAD_JUGADAS, FuenteAzar, Partida

ESCALA_RECOMPENSA = (
    50.0  # los puntos se dividen por esto para que la red trabaje con números chicos
)


class _Grupo:
    """Un grupo de partidas jugadas en el mismo proceso."""

    def __init__(
        self,
        n: int,
        semilla: int,
        id_base: int,
        registro_kwargs: dict | None,
        registrar_cada: int,
        peso_pista: float = 0.0,
    ) -> None:
        self.rng = random.Random(semilla)
        # Peso de la pista del Bonus para las partidas que empiezan desde ahora.
        # Cada partida guarda el suyo, fijo hasta que termina (ver pista.py).
        self.peso_pista = peso_pista
        self.pesos: list[float] = []
        self.id_base = id_base
        self.iniciadas = 0
        self.registrar_cada = registrar_cada
        self.registro = None
        if registro_kwargs is not None:
            from generalito.registro import RegistroDecisiones

            self.registro = RegistroDecisiones(**registro_kwargs)
        self.partidas: list[Partida] = []
        self.registrando: list[int | None] = []
        for _ in range(n):
            self._nueva()
        self.estados = np.zeros((n, TAMANO_ESTADO), dtype=np.float32)
        self.mascaras = np.zeros((n, CANTIDAD_JUGADAS), dtype=bool)

    def _nueva(self, i: int | None = None) -> None:
        id_ = self.id_base + self.iniciadas
        registrar = self.registro is not None and self.iniciadas % self.registrar_cada == 0
        self.iniciadas += 1
        partida = Partida(FuenteAzar(self.rng.getrandbits(64)))
        if i is None:
            self.partidas.append(partida)
            self.registrando.append(id_ if registrar else None)
            self.pesos.append(self.peso_pista)
        else:
            self.partidas[i] = partida
            self.registrando[i] = id_ if registrar else None
            self.pesos[i] = self.peso_pista

    def observar(self):
        for i, p in enumerate(self.partidas):
            codificar(p, self.estados[i])
            self.mascaras[i] = p.mascara_legal()
        return self.estados.copy(), self.mascaras.copy()

    def paso(self, acciones: np.ndarray, probs: np.ndarray | None, peso_pista: float | None = None):
        if peso_pista is not None:
            self.peso_pista = peso_pista
        n = len(self.partidas)
        recompensas = np.zeros(n, dtype=np.float32)
        terminadas = np.zeros(n, dtype=np.float32)
        totales = []
        for i, p in enumerate(self.partidas):
            jugada = int(acciones[i])
            if self.registrando[i] is not None and probs is not None:
                self.registro.agregar(self.registrando[i], p, jugada, probs[i])
            antes = p.total()
            peso = self.pesos[i]
            phi_antes = potencial_partida(p) if peso else 0.0
            p.aplicar(jugada)
            recompensa = p.total() - antes
            if peso:
                recompensa += peso * (potencial_partida(p) - phi_antes)
            recompensas[i] = recompensa / ESCALA_RECOMPENSA
            if p.terminada:
                terminadas[i] = 1.0
                totales.append(p.total())
                self._nueva(i)
        estados, mascaras = self.observar()
        return estados, mascaras, recompensas, terminadas, totales

    def cerrar(self) -> str | None:
        """Guarda el registro pendiente. Devuelve un error si no entró en el disco."""
        if self.registro is None:
            return None
        from generalito.registro import LimiteDeDisco

        try:
            self.registro.cerrar()
        except LimiteDeDisco as error:
            return str(error)
        return None


def _trabajador(conexion, n, semilla, id_base, registro_kwargs, registrar_cada, peso_pista) -> None:
    try:  # prioridad baja también en los trabajadores
        import psutil

        psutil.Process().nice(getattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS", 10))
    except Exception:  # noqa: BLE001
        pass
    grupo = _Grupo(n, semilla, id_base, registro_kwargs, registrar_cada, peso_pista)
    while True:
        orden, datos = conexion.recv()
        if orden == "observar":
            conexion.send(grupo.observar())
        elif orden == "paso":
            conexion.send(grupo.paso(*datos))
        elif orden == "cerrar":
            conexion.send(grupo.cerrar())
            conexion.close()
            return


class Entornos:
    """`n` partidas en `trabajadores` procesos (1 = todo en este proceso)."""

    def __init__(
        self,
        n: int,
        trabajadores: int,
        semilla: int,
        carpeta_registro: Path | None = None,
        registrar_cada: int = 1000,
        max_mb: float = 2000,
        min_libre_gb: float = 0,
        peso_pista: float = 0.0,
    ) -> None:
        self.n = n
        trabajadores = max(1, min(trabajadores, n))
        tamanos = [n // trabajadores + (k < n % trabajadores) for k in range(trabajadores)]
        self.cortes = np.cumsum([0, *tamanos])
        self.grupo_local = None
        self.conexiones = []
        self.procesos = []

        def kwargs_registro(k: int) -> dict | None:
            if carpeta_registro is None:
                return None
            return {
                "carpeta": Path(carpeta_registro) / f"trabajador_{k:02d}",
                "max_mb": max_mb / trabajadores,
                "min_libre_gb": min_libre_gb,
            }

        if trabajadores == 1:
            self.grupo_local = _Grupo(n, semilla, 0, kwargs_registro(0), registrar_cada, peso_pista)
            return
        contexto = mp.get_context("spawn")  # igual en Windows, Mac y Linux
        for k, tamano in enumerate(tamanos):
            local, remota = contexto.Pipe()
            proceso = contexto.Process(
                target=_trabajador,
                args=(
                    remota,
                    tamano,
                    semilla * 1000 + k,
                    k * 10**9,
                    kwargs_registro(k),
                    registrar_cada,
                    peso_pista,
                ),
                daemon=True,
            )
            proceso.start()
            self.conexiones.append(local)
            self.procesos.append(proceso)

    def observar(self):
        if self.grupo_local is not None:
            return self.grupo_local.observar()
        for c in self.conexiones:
            c.send(("observar", None))
        partes = [c.recv() for c in self.conexiones]
        return np.concatenate([p[0] for p in partes]), np.concatenate([p[1] for p in partes])

    def paso(
        self,
        acciones: np.ndarray,
        probs: np.ndarray | None = None,
        peso_pista: float | None = None,
    ):
        """`peso_pista`: peso de la pista del Bonus para las partidas que empiecen ahora."""
        if self.grupo_local is not None:
            return self.grupo_local.paso(acciones, probs, peso_pista)
        for k, c in enumerate(self.conexiones):
            a, b = self.cortes[k], self.cortes[k + 1]
            datos = (acciones[a:b], None if probs is None else probs[a:b], peso_pista)
            c.send(("paso", datos))
        partes = [c.recv() for c in self.conexiones]
        totales = [t for p in partes for t in p[4]]
        return (
            *(np.concatenate([p[j] for p in partes]) for j in range(4)),
            totales,
        )

    def cerrar(self) -> str | None:
        if self.grupo_local is not None:
            return self.grupo_local.cerrar()
        errores = []
        for c in self.conexiones:
            try:
                c.send(("cerrar", None))
                if error := c.recv():
                    errores.append(error)
            except (EOFError, OSError):
                pass
        for p in self.procesos:
            p.join(timeout=10)
            if p.is_alive():
                p.terminate()
        return errores[0] if errores else None
