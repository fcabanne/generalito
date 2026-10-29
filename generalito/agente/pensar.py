"""Pensar el turno: búsqueda exacta dentro del turno, evaluada con la propia red.

Solo usa las reglas y la red del modelo (nada de heurísticas humanas):

1. En cada decisión del turno se recorren todas las opciones: qué dados guardar
   y dónde anotar, con las probabilidades exactas de los dados (expectimax).
   Los dados se tratan como un multiconjunto: guardar "el primer 5" o "el
   segundo 5" es lo mismo.
2. Al terminar el turno (después de anotar) la planilla que queda se evalúa
   con la estimación de valor de la red, promediando sobre el primer tiro del
   turno siguiente: con K tiradas al azar (siempre las mismas para todas las
   opciones del turno, así se comparan con la misma suerte) o, con K = 0, con
   las 252 combinaciones posibles y sus probabilidades exactas.
3. Lo que vale cada opción = lo que gana en esa anotación (según el objetivo
   con el que se entrenó el modelo) + lo que la red estima que falta.

Solo sirve para jugar y evaluar: no entrena (fase 1, ver DECISIONES.md).
"""

import threading
from collections import Counter
from itertools import combinations, combinations_with_replacement
from math import factorial, prod

import numpy as np
import torch

from generalito.agente.codificacion import TAMANO_ESTADO, codificar_lote
from generalito.agente.entornos import ESCALA_RECOMPENSA
from generalito.motor import Partida
from generalito.motor.categorias import Categoria, puntaje
from generalito.motor.jugadas import anotar, volver_a_tirar
from generalito.motor.planilla import LIBRE, Columna, Planilla, indice_casilla

MUESTRAS_DEFECTO = 32

# --- Tablas fijas de dados (se calculan una vez) ---

MULTICONJUNTOS = list(combinations_with_replacement(range(1, 7), 5))  # 252, ordenados
INDICE = {m: i for i, m in enumerate(MULTICONJUNTOS)}
GUARDADOS = [g for n in range(5) for g in combinations_with_replacement(range(1, 7), n)]  # 210
INDICE_GUARDADO = {g: i for i, g in enumerate(GUARDADOS)}
GUARDAR_NADA = INDICE_GUARDADO[()]


def _probabilidad(valores: tuple[int, ...]) -> float:
    """Probabilidad de sacar exactamente ese multiconjunto tirando len(valores) dados."""
    n = len(valores)
    cuentas = Counter(valores).values()
    return factorial(n) / prod(factorial(c) for c in cuentas) / 6**n


# TRANSICION[g, d]: probabilidad de terminar con los dados d guardando g y tirando el resto
TRANSICION = np.zeros((len(GUARDADOS), len(MULTICONJUNTOS)))
for _g, _guardado in enumerate(GUARDADOS):
    for _resto in combinations_with_replacement(range(1, 7), 5 - len(_guardado)):
        TRANSICION[_g, INDICE[tuple(sorted(_guardado + _resto))]] += _probabilidad(_resto)

PROB_INICIAL = np.array([_probabilidad(m) for m in MULTICONJUNTOS])

# Para cada multiconjunto, qué se puede guardar (sin repetir equivalentes, nunca los 5)
SUBGUARDADOS = [
    np.array(
        sorted(
            {
                INDICE_GUARDADO[tuple(m[i] for i in pos)]
                for n in range(5)
                for pos in combinations(range(5), n)
            }
        )
    )
    for m in MULTICONJUNTOS
]

PUNTAJES = [[puntaje(c, m) for c in Categoria] for m in MULTICONJUNTOS]


def _posiciones(dados: tuple[int, ...], guardado: tuple[int, ...]) -> list[int]:
    """Posiciones de los dados actuales que forman el multiconjunto guardado."""
    libres = list(range(len(dados)))
    posiciones = []
    for valor in guardado:
        p = next(p for p in libres if dados[p] == valor)
        libres.remove(p)
        posiciones.append(p)
    return posiciones


class Pensador:
    """Elige jugadas pensando el turno con la red `red` (que no se modifica)."""

    def __init__(self, red, objetivo: dict | None = None, muestras: int = MUESTRAS_DEFECTO,
                 semilla: int = 0) -> None:  # fmt: skip
        self.red = red
        self.objetivo = objetivo or {"tipo": "puntaje"}
        self.muestras = muestras
        self.semilla = semilla
        self._clave = None
        self._tablas = None
        self._lock = threading.Lock()  # la interfaz puede pedir desde varios hilos

    # --- Valor de una planilla al terminar el turno ---

    @torch.no_grad()
    def _valor_siguiente(self, casillas: np.ndarray, turno: int) -> np.ndarray:
        """Lo que la red estima que falta, al empezar el turno `turno`, para cada planilla."""
        if self.muestras <= 0:
            dados, pesos = np.array(MULTICONJUNTOS), PROB_INICIAL
        else:
            rng = np.random.default_rng([self.semilla, turno])
            dados = rng.integers(1, 7, size=(self.muestras, 5))
            pesos = np.full(self.muestras, 1 / self.muestras)
        x = codificar_lote(casillas, dados, tiro=1, servido=True, turno=turno)
        lote = torch.from_numpy(x.reshape(-1, TAMANO_ESTADO))
        v = self.red.valor(self.red.tronco(lote)).squeeze(-1).numpy()
        return v.reshape(len(casillas), len(dados)) @ pesos

    def _recompensa(self, total_antes: int, total_despues: int, completa: bool) -> float:
        """Lo que gana con una anotación, en las mismas unidades que la red."""
        tipo = self.objetivo.get("tipo", "puntaje")
        if tipo == "superar":
            return float(completa and total_despues >= self.objetivo["umbral"])
        ganado = total_despues - total_antes
        if tipo == "mixto" and completa and total_despues >= self.objetivo["umbral"]:
            ganado += self.objetivo["premio"]
        return ganado / ESCALA_RECOMPENSA

    # --- Tablas del turno (se calculan una vez por turno) ---

    def _calcular(self, partida: Partida) -> dict:
        planilla = partida.planilla
        total = planilla.total()
        habilitadas = [(col, cat) for col in Columna for cat in planilla.casillas_habilitadas(col)]
        # valores[h, s, d]: lo que se anota en la casilla h con los dados d (s = servido);
        # 0 si solo se puede tachar
        valores = np.zeros((len(habilitadas), 2, len(MULTICONJUNTOS)), dtype=np.int64)
        for h, (col, cat) in enumerate(habilitadas):
            for s in (0, 1):
                if col == Columna.SERVIDA and not s:
                    continue  # sin tiro servido, en Servida solo se tacha
                for d, m in enumerate(MULTICONJUNTOS):
                    v = planilla.puntaje_posible(col, cat, m, bool(s), PUNTAJES[d])
                    if v is not None:
                        valores[h, s, d] = v
        # Hojas: cada planilla distinta que puede quedar al anotar (casilla, valor)
        hojas: dict[tuple[int, int], int] = {}
        for h in range(len(habilitadas)):
            for v in {0, *np.unique(valores[h]).tolist()}:
                hojas[(h, v)] = len(hojas)
        casillas = np.tile(np.array(planilla.casillas), (len(hojas), 1))
        ganado = np.zeros(len(hojas))
        completas = np.zeros(len(hojas), dtype=bool)
        auxiliar = Planilla()
        for (h, v), i in hojas.items():
            col, cat = habilitadas[h]
            casillas[i, indice_casilla(col, cat)] = v
            auxiliar.casillas = casillas[i].tolist()
            completas[i] = LIBRE not in auxiliar.casillas
            ganado[i] = self._recompensa(total, auxiliar.total(), bool(completas[i]))
        valor_hoja = ganado.copy()
        if (~completas).any():
            valor_hoja[~completas] += self._valor_siguiente(casillas[~completas], partida.turno + 1)
        # Mejor anotación para cada dado y servido
        indice_hoja = np.zeros_like(valores)
        for (h, v), i in hojas.items():
            indice_hoja[h][valores[h] == v] = i
        indice_tachar = np.array([hojas[(h, 0)] for h in range(len(habilitadas))])
        con_puntaje = valor_hoja[indice_hoja]  # (H, 2, 252); donde valores == 0 es tachar
        sin_puntaje = valor_hoja[indice_tachar][:, None, None]
        anotar_mejor = np.maximum(con_puntaje, sin_puntaje).max(axis=0)  # (2, 252)
        v3 = anotar_mejor.T  # (252, 2): en el tiro 3 hay que anotar

        def esperado(v_siguiente: np.ndarray) -> np.ndarray:
            """Valor esperado de cada guardado (el de no guardar nada es un tiro servido)."""
            e = TRANSICION @ v_siguiente[:, 0]
            e[GUARDAR_NADA] = TRANSICION[GUARDAR_NADA] @ v_siguiente[:, 1]
            return e

        e2 = esperado(v3)  # guardar en el tiro 2
        mejor_guardado2 = np.array([e2[g].max() for g in SUBGUARDADOS])
        v2 = np.maximum(v3, mejor_guardado2[:, None])
        e1 = esperado(v2)  # guardar en el tiro 1
        return {
            "habilitadas": habilitadas,
            "valores": valores,
            "hojas": hojas,
            "valor_hoja": valor_hoja,
            "esperado": {1: e1, 2: e2},
        }

    def _tablas_del_turno(self, partida: Partida) -> dict:
        clave = (partida.turno, tuple(partida.planilla.casillas))
        if clave != self._clave:
            self._tablas = self._calcular(partida)
            self._clave = clave
        return self._tablas

    # --- Decisiones ---

    def opciones(self, partida: Partida) -> list[tuple[int, float]]:
        """Todas las jugadas que tiene en cuenta, con su valor, de la mejor a la peor."""
        with self._lock:
            t = self._tablas_del_turno(partida)
        dados = partida.dados
        d = INDICE[tuple(sorted(dados))]
        s = int(partida.ultimo_tiro_servido)
        opciones = []
        for h, (col, cat) in enumerate(t["habilitadas"]):
            opciones.append((anotar(col, cat, tachar=True), t["valor_hoja"][t["hojas"][(h, 0)]]))
            v = int(t["valores"][h, s, d])
            if v > 0:
                opciones.append((anotar(col, cat), t["valor_hoja"][t["hojas"][(h, v)]]))
        if partida.tiro < 3:
            e = t["esperado"][partida.tiro]
            for g in SUBGUARDADOS[d]:
                guardado = GUARDADOS[g]
                opciones.append((volver_a_tirar(_posiciones(dados, guardado)), e[g]))
        opciones.sort(key=lambda o: -o[1])
        return opciones

    def elegir(self, partida: Partida) -> int:
        return self.opciones(partida)[0][0]

    def en_puntos(self, partida: Partida, valor: float) -> float:
        """Traduce un valor a lo que se mostraría: puntos esperados al final, o % de chance."""
        if self.objetivo.get("tipo") == "superar":
            return 100 * valor
        return partida.total() + valor * ESCALA_RECOMPENSA


# --- Jugar muchas partidas, pensando o no, en varios procesos ---


class JugadorRed:
    """La red sola, sin pensar: siempre su jugada más probable."""

    def __init__(self, red) -> None:
        self.red = red

    def elegir(self, partida: Partida) -> int:
        from generalito.agente.red import elegir

        return elegir(self.red, partida)


def crear_jugador(spec: dict):
    """spec: {"ruta": modelo .pt, "pensar": bool, "muestras": int}."""
    from generalito.agente.red import cargar_snapshot

    red, metricas = cargar_snapshot(spec["ruta"])
    if not spec.get("pensar"):
        return JugadorRed(red)
    objetivo = (metricas or {}).get("entrenamiento", {}).get("objetivo")
    return Pensador(red, objetivo, muestras=spec.get("muestras", MUESTRAS_DEFECTO))


def _iniciar_trabajador() -> None:
    torch.set_num_threads(1)
    try:
        import psutil

        psutil.Process().nice(getattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS", 10))
    except Exception:  # noqa: BLE001
        pass


_JUGADORES: dict = {}


def _jugador(spec: dict):
    clave = (spec["ruta"], bool(spec.get("pensar")), spec.get("muestras"))
    if clave not in _JUGADORES:
        _JUGADORES[clave] = crear_jugador(spec)
    return _JUGADORES[clave]


def jugar_partida(spec: dict, otra: dict | None, indice: int, semilla: int) -> dict:
    """Una partida con dados reservados. Si hay `otra`, en cada decisión anota qué
    habría elegido ese otro jugador (para Comparar)."""
    import time

    from generalito.motor import FuenteReservada
    from generalito.motor.jugadas import Anotar, decodificar

    jugador = _jugador(spec)
    rival = _jugador(otra) if otra else None
    partida = Partida(FuenteReservada(semilla, indice))
    decisiones, distintas = [], []
    inicio = time.perf_counter()
    while not partida.terminada:
        jugada = jugador.elegir(partida)
        contexto = (partida.turno, partida.tiro, partida.dados)
        if rival is not None:
            alternativa = rival.elegir(partida)
            if alternativa != jugada:
                distintas.append((*contexto, jugada, alternativa))
        partida.aplicar(jugada)
        accion = decodificar(jugada)
        valor = None
        if isinstance(accion, Anotar):
            valor = partida.planilla.valor(accion.columna, accion.categoria)
        decisiones.append((*contexto, jugada, valor))
    return {
        "indice": indice,
        "total": partida.total(),
        "casillas": list(partida.planilla.casillas),
        "decisiones": decisiones,
        "distintas": distintas,
        "segundos": time.perf_counter() - inicio,
    }


def _jugar_varias(datos) -> list[dict]:
    spec, otra, indices, semilla = datos
    return [jugar_partida(spec, otra, i, semilla) for i in indices]


def jugar_en_paralelo(
    spec: dict,
    otra: dict | None,
    partidas: int,
    semilla: int,
    trabajadores: int,
    al_avanzar=None,
) -> list[dict]:
    """Juega `partidas` partidas en `trabajadores` procesos. `al_avanzar(hechas)` se llama
    a medida que terminan; si devuelve un motivo, se corta todo (InterruptedError)."""
    import multiprocessing as mp

    tanda = max(1, min(10, partidas // max(1, trabajadores * 4)))
    lotes = [
        (spec, otra, list(range(i, min(partidas, i + tanda))), semilla)
        for i in range(0, partidas, tanda)
    ]
    resultados: list[dict] = []
    if trabajadores <= 1:
        for lote in lotes:
            resultados.extend(_jugar_varias(lote))
            if al_avanzar and (motivo := al_avanzar(len(resultados))):
                raise InterruptedError(motivo)
        return resultados
    contexto = mp.get_context("spawn")
    with contexto.Pool(trabajadores, initializer=_iniciar_trabajador) as pool:
        try:
            for parte in pool.imap_unordered(_jugar_varias, lotes):
                resultados.extend(parte)
                if al_avanzar and (motivo := al_avanzar(len(resultados))):
                    raise InterruptedError(motivo)
        except BaseException:
            pool.terminate()
            raise
    return sorted(resultados, key=lambda r: r["indice"])
