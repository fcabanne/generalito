"""La red neuronal del agente y cómo se guarda (snapshots)."""

from pathlib import Path

import numpy as np
import torch
from torch import nn

from generalito.agente.codificacion import TAMANO_ESTADO, VERSION_CODIFICACION, codificar
from generalito.motor import CANTIDAD_JUGADAS, VERSION_REGLAS, Partida


class Red(nn.Module):
    """Dos capas ocultas compartidas; una salida de puntaje por jugada y una de valor."""

    def __init__(self, oculta: int = 256) -> None:
        super().__init__()
        self.oculta = oculta
        self.tronco = nn.Sequential(
            nn.Linear(TAMANO_ESTADO, oculta),
            nn.ReLU(),
            nn.Linear(oculta, oculta),
            nn.ReLU(),
        )
        self.politica = nn.Linear(oculta, CANTIDAD_JUGADAS)
        self.valor = nn.Linear(oculta, 1)

    def forward(self, estado: torch.Tensor, mascara: torch.Tensor):
        h = self.tronco(estado)
        logits = self.politica(h).masked_fill(~mascara, float("-inf"))
        return logits, self.valor(h).squeeze(-1)


def guardar_snapshot(red: Red, ruta: Path, metricas: dict) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_suffix(".parcial")
    torch.save(
        {
            "pesos": red.state_dict(),
            "oculta": red.oculta,
            "version_reglas": VERSION_REGLAS,
            "version_codificacion": VERSION_CODIFICACION,
            "metricas": metricas,
        },
        temporal,
    )
    temporal.replace(ruta)


def cargar_snapshot(ruta: Path) -> tuple[Red, dict]:
    datos = torch.load(ruta, map_location="cpu", weights_only=False)
    if datos["version_reglas"] != VERSION_REGLAS:
        raise ValueError(
            f"El modelo se entrenó con reglas {datos['version_reglas']}"
            f" y ahora son {VERSION_REGLAS}"
        )
    if datos["version_codificacion"] != VERSION_CODIFICACION:
        raise ValueError("El modelo usa otra codificación del estado")
    red = Red(datos["oculta"])
    red.load_state_dict(datos["pesos"])
    red.eval()
    return red, datos["metricas"]


@torch.no_grad()
def probabilidades(red: Red, partida: Partida) -> np.ndarray:
    """Probabilidad que el agente le da a cada una de las 135 jugadas (0 si es ilegal)."""
    estado = torch.from_numpy(codificar(partida)).unsqueeze(0)
    mascara = torch.tensor(partida.mascara_legal()).unsqueeze(0)
    logits, _ = red(estado, mascara)
    return torch.softmax(logits, dim=-1)[0].numpy()


def elegir(red: Red, partida: Partida) -> int:
    """La jugada más probable para el agente (sin azar)."""
    return int(np.argmax(probabilidades(red, partida)))
