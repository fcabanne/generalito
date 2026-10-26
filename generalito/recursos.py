"""Límites de recursos para todo lo que corra partidas o entrene.

Cualquier programa largo (simular, entrenar, evaluar) tiene que:

1. Crear unos `Limites` (con valores por defecto conservadores).
2. Llamar a `aplicar_limites_proceso()` al arrancar, antes de importar PyTorch.
3. Consultar `Guardian.revisar()` entre lotes y frenar si devuelve un motivo.

Formas de frenar una corrida sin perder lo hecho:

- Crear un archivo llamado PARAR en la carpeta de la corrida.
- Ctrl+C (una vez: termina el lote y guarda; dos veces: corta en seco).
- Cualquier límite de los `Limites` que se alcance.
"""

import os
import shutil
import signal
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import psutil

ARCHIVO_PARAR = "PARAR"


@dataclass
class Limites:
    # Cuánto trabajo como máximo
    max_partidas: int | None = None
    max_minutos: float | None = 60.0
    # CPU
    hilos_cpu: int = max(1, (os.cpu_count() or 2) // 2)
    prioridad_baja: bool = True  # la compu sigue respondiendo mientras corre
    max_cpu_sistema: float | None = 90.0  # %; si el sistema entero pasa esto, se pausa
    # Memoria
    max_ram_mb: float | None = 4096
    # Disco
    max_disco_mb: float = 2000  # lo que puede ocupar la carpeta de la corrida
    min_disco_libre_gb: float = 10  # nunca dejar el disco con menos de esto libre
    # GPU (para cuando haya PyTorch; apagada por defecto)
    usar_gpu: bool = False
    max_memoria_gpu: float = 0.5  # fracción de la memoria de la placa
    max_temperatura_gpu: float | None = 80.0  # °C; si pasa, se pausa
    # Pausas
    pausa_maxima_s: float = 300  # si sigue saturado después de esto, se frena

    def como_dict(self) -> dict:
        return asdict(self)


def aplicar_limites_proceso(limites: Limites) -> None:
    """Hilos, prioridad y GPU del proceso actual. Llamar antes de importar torch."""
    hilos = str(limites.hilos_cpu)
    for variable in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[variable] = hilos
    if not limites.usar_gpu:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""  # la placa queda invisible para PyTorch

    if limites.prioridad_baja:
        proceso = psutil.Process()
        try:
            if os.name == "nt":
                proceso.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            else:
                proceso.nice(10)
        except (psutil.AccessDenied, OSError):
            pass

    try:  # Si PyTorch ya está instalado, se configura también
        import torch
    except ImportError:
        return
    torch.set_num_threads(limites.hilos_cpu)
    if limites.usar_gpu and torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(limites.max_memoria_gpu)


def temperatura_gpu() -> float | None:
    """Temperatura de la placa NVIDIA más caliente, o None si no se puede leer."""
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        salida = subprocess.run(
            ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout
        return max(float(x) for x in salida.split())
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


def tamano_carpeta(carpeta: Path) -> int:
    return sum(f.stat().st_size for f in carpeta.rglob("*") if f.is_file())


class Guardian:
    """Vigila los límites durante una corrida."""

    def __init__(
        self,
        limites: Limites,
        carpeta: Path,
        cada_s: float = 2.0,
        atrapar_ctrl_c: bool = True,
    ) -> None:
        self.limites = limites
        self.carpeta = carpeta
        self.cada_s = cada_s
        self.inicio = time.monotonic()
        # La primera medición se hace después de cada_s: una medición de CPU
        # pegada al arranque sale inflada y provocaría una pausa falsa.
        self._ultima_revision = time.monotonic()
        self.pausa: str | None = None  # motivo, mientras está en pausa
        self.al_pausar = None  # función opcional que se llama en cada espera
        self._interrupciones = 0
        self.ultima_medicion: dict = {}
        self.proceso = psutil.Process()
        self.proceso.cpu_percent()  # la primera medición siempre da 0
        psutil.cpu_percent()
        self._handler_anterior = None
        if atrapar_ctrl_c:
            self._handler_anterior = signal.signal(signal.SIGINT, self._al_interrumpir)

    def cerrar(self) -> None:
        """Devuelve el Ctrl+C a su comportamiento normal."""
        if self._handler_anterior is not None:
            signal.signal(signal.SIGINT, self._handler_anterior)
            self._handler_anterior = None

    def _al_interrumpir(self, _signum, _frame) -> None:
        self._interrupciones += 1
        if self._interrupciones >= 2:
            raise KeyboardInterrupt
        print("\nCtrl+C: termino el lote y guardo. Otro Ctrl+C corta en seco.", flush=True)

    def minutos(self) -> float:
        return (time.monotonic() - self.inicio) / 60

    def _ram_bytes(self) -> int:
        """RAM del proceso más la de sus procesos hijos (por ejemplo, los trabajadores)."""
        total = self.proceso.memory_info().rss
        for hijo in self.proceso.children(recursive=True):
            try:
                total += hijo.memory_info().rss
            except psutil.Error:
                pass
        return total

    def medir(self) -> dict:
        disco = shutil.disk_usage(self.carpeta)
        return {
            "minutos": round(self.minutos(), 2),
            "cpu_sistema_pct": psutil.cpu_percent(),
            "cpu_proceso_pct": self.proceso.cpu_percent(),
            "ram_proceso_mb": round(self._ram_bytes() / 2**20, 1),
            "disco_corrida_mb": round(tamano_carpeta(self.carpeta) / 2**20, 2),
            "disco_libre_gb": round(disco.free / 2**30, 2),
            "temperatura_gpu": temperatura_gpu() if self.limites.usar_gpu else None,
        }

    def _motivo_rapido(self, partidas: int) -> str | None:
        """Chequeos baratos: se hacen en cada llamada."""
        lim = self.limites
        if self._interrupciones:
            return "Ctrl+C"
        if lim.max_partidas is not None and partidas >= lim.max_partidas:
            return f"se alcanzó el máximo de partidas ({lim.max_partidas})"
        if lim.max_minutos is not None and self.minutos() >= lim.max_minutos:
            return f"se alcanzó el máximo de minutos ({lim.max_minutos})"
        return None

    def _motivo_medido(self, medicion: dict) -> str | None:
        lim = self.limites
        if (self.carpeta / ARCHIVO_PARAR).exists():
            return f"se encontró el archivo {ARCHIVO_PARAR}"
        if medicion["disco_corrida_mb"] >= lim.max_disco_mb:
            return f"la corrida ocupa más de {lim.max_disco_mb} MB"
        if medicion["disco_libre_gb"] < lim.min_disco_libre_gb:
            return f"quedan menos de {lim.min_disco_libre_gb} GB libres en el disco"
        if lim.max_ram_mb is not None and medicion["ram_proceso_mb"] >= lim.max_ram_mb:
            return f"el proceso usa más de {lim.max_ram_mb} MB de RAM"
        return None

    def _saturado(self, medicion: dict) -> str | None:
        lim = self.limites
        if lim.max_cpu_sistema is not None and medicion["cpu_sistema_pct"] > lim.max_cpu_sistema:
            return f"CPU del sistema al {medicion['cpu_sistema_pct']:.0f}%"
        temp = medicion["temperatura_gpu"]
        if lim.max_temperatura_gpu is not None and temp is not None:
            if temp > lim.max_temperatura_gpu:
                return f"GPU a {temp:.0f} °C"
        return None

    def revisar(self, partidas: int, forzar: bool = False) -> str | None:
        """Devuelve el motivo para frenar, o None para seguir.

        Si el equipo está saturado, espera (pausa) hasta que se libere o hasta
        pausa_maxima_s. Para no gastar recursos midiendo, mide cada cada_s.
        """
        if motivo := self._motivo_rapido(partidas):
            return motivo
        ahora = time.monotonic()
        if not forzar and ahora - self._ultima_revision < self.cada_s:
            return None
        self._ultima_revision = ahora
        self.ultima_medicion = medicion = self.medir()
        if motivo := self._motivo_medido(medicion):
            return motivo
        pausa = 0.0
        while saturacion := self._saturado(medicion):
            if pausa >= self.limites.pausa_maxima_s:
                return f"el equipo siguió saturado {pausa:.0f} s ({saturacion})"
            if pausa == 0:
                print(f"Pausa: {saturacion}. Espero a que se libere...", flush=True)
            self.pausa = saturacion
            if self.al_pausar is not None:
                self.al_pausar()
            time.sleep(5)
            pausa += 5
            self.ultima_medicion = medicion = self.medir()
            if motivo := self._motivo_rapido(partidas) or self._motivo_medido(medicion):
                return motivo
        self.pausa = None
        return None
