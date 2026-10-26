"""Entrenamiento del agente solitario (v1) con PPO.

El agente juega muchas partidas a la vez (repartidas en varios procesos).
Después de cada tanda ajusta la red para que las jugadas que terminaron mejor
de lo esperado sean más probables.

Recompensa: lo que sube el total de la planilla con cada anotación. Sumada en
toda la partida es exactamente el puntaje final, así que no agrega ninguna
idea humana de cómo jugar (ver DECISIONES.md).

Uso:
    uv run generalito-entrenar --minutos 60
    uv run generalito-entrenar --minutos 60 --desde corridas/<anterior>/modelo.pt
"""

import argparse
import json
import statistics
import time
from collections import deque
from datetime import datetime
from pathlib import Path

from generalito.recursos import ARCHIVO_PARAR, Guardian, Limites, aplicar_limites_proceso

PARTIDAS_EVALUACION = 500
MAX_PUNTOS_CURVA = 1500


def _argumentos(argv):
    d = Limites()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--minutos", type=float, default=60, help="tiempo máximo de entrenamiento")
    p.add_argument("--max-partidas", type=int, default=None)
    p.add_argument("--desde", type=Path, default=None, help="seguir entrenando un modelo guardado")
    p.add_argument("--carpeta", type=Path, default=None)
    p.add_argument("--semilla", type=int, default=0)
    p.add_argument("--evaluar-cada-min", type=float, default=10)
    p.add_argument("--registrar-cada", type=int, default=1000, help="0 = no registrar")
    # PPO
    p.add_argument("--entornos", type=int, default=256, help="partidas jugadas en paralelo")
    p.add_argument(
        "--trabajadores",
        type=int,
        default=None,
        help="procesos que juegan (por defecto, los núcleos permitidos menos uno)",
    )
    p.add_argument("--pasos", type=int, default=128, help="pasos por partida en cada tanda")
    p.add_argument("--epocas", type=int, default=4)
    p.add_argument("--minilote", type=int, default=4096)
    p.add_argument("--aprendizaje", type=float, default=3e-4)
    p.add_argument("--lambda-gae", type=float, default=0.95)
    p.add_argument("--recorte", type=float, default=0.2)
    p.add_argument("--entropia", type=float, default=0.01)
    p.add_argument("--oculta", type=int, default=256)
    g = p.add_argument_group("límites de recursos")
    g.add_argument("--hilos", type=int, default=d.hilos_cpu, help="núcleos que puede usar")
    g.add_argument("--max-cpu", type=float, default=d.max_cpu_sistema)
    g.add_argument("--max-ram-mb", type=float, default=d.max_ram_mb)
    g.add_argument("--max-disco-mb", type=float, default=d.max_disco_mb)
    g.add_argument("--min-disco-libre-gb", type=float, default=d.min_disco_libre_gb)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _argumentos(argv)
    limites = Limites(
        max_partidas=args.max_partidas,
        max_minutos=args.minutos,
        hilos_cpu=args.hilos,
        max_cpu_sistema=args.max_cpu,
        max_ram_mb=args.max_ram_mb,
        max_disco_mb=args.max_disco_mb,
        min_disco_libre_gb=args.min_disco_libre_gb,
    )
    aplicar_limites_proceso(limites)  # antes de importar torch

    import numpy as np
    import torch

    from generalito.agente.codificacion import TAMANO_ESTADO, VERSION_CODIFICACION
    from generalito.agente.entornos import Entornos
    from generalito.agente.red import Red, cargar_snapshot, guardar_snapshot
    from generalito.evaluar import evaluar_agente, evaluar_jugador
    from generalito.motor import CANTIDAD_JUGADAS, VERSION_REGLAS

    trabajadores = args.trabajadores or max(1, limites.hilos_cpu - 1)
    # La red usa pocos hilos: lo pesado es jugar, y eso lo hacen los trabajadores
    torch.set_num_threads(max(1, min(4, limites.hilos_cpu - trabajadores + 1)))
    torch.manual_seed(args.semilla)

    carpeta = args.carpeta or Path("corridas") / datetime.now().strftime("%Y%m%d-%H%M%S-entrenar")
    carpeta.mkdir(parents=True, exist_ok=True)
    config = {
        "programa": "entrenar",
        "jugador": "agente",
        "algoritmo": "PPO",
        "desde": str(args.desde) if args.desde else None,
        "trabajadores": trabajadores,
        "version_reglas": VERSION_REGLAS,
        "version_codificacion": VERSION_CODIFICACION,
        "parametros": {k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
        "limites": limites.como_dict(),
    }
    (carpeta / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    # --- Red ---
    partidas_previas = 0
    if args.desde:
        red, metricas_previas = cargar_snapshot(args.desde)
        partidas_previas = metricas_previas.get("partidas_entrenadas", 0)
    else:
        red = Red(args.oculta)
    optimizador = torch.optim.Adam(red.parameters(), lr=args.aprendizaje, eps=1e-5)

    guardian = Guardian(limites, carpeta)
    print(
        f"Entrenando en {carpeta}. Para frenar: Ctrl+C o crear {carpeta / ARCHIVO_PARAR}",
        flush=True,
    )

    # --- Referencias (solo para comparar en los gráficos) ---
    referencias = {
        nombre: round(statistics.fmean(evaluar_jugador(nombre, PARTIDAS_EVALUACION)), 1)
        for nombre in ("azar", "codicioso")
    }

    # --- Entornos ---
    n, t_max = args.entornos, args.pasos
    registrar = args.registrar_cada > 0
    entornos = Entornos(
        n,
        trabajadores,
        args.semilla,
        carpeta_registro=carpeta / "registro" if registrar else None,
        registrar_cada=max(1, args.registrar_cada),
        max_mb=limites.max_disco_mb,
        min_libre_gb=limites.min_disco_libre_gb,
    )

    estados = np.zeros((t_max + 1, n, TAMANO_ESTADO), dtype=np.float32)
    mascaras = np.zeros((t_max + 1, n, CANTIDAD_JUGADAS), dtype=bool)
    acciones = np.zeros((t_max, n), dtype=np.int64)
    logp_viejos = np.zeros((t_max, n), dtype=np.float32)
    valores = np.zeros((t_max + 1, n), dtype=np.float32)
    recompensas = np.zeros((t_max, n), dtype=np.float32)
    terminadas = np.zeros((t_max, n), dtype=np.float32)

    totales_recientes: deque[int] = deque(maxlen=1000)
    partidas_terminadas = 0
    curva: list[dict] = []
    evaluaciones: list[dict] = []
    mejor_eval = -1.0
    ultima_eval = time.monotonic()
    ultimo_reporte = 0.0
    motivo = None

    def metricas() -> dict:
        return {
            "partidas_entrenadas": partidas_previas + partidas_terminadas,
            "minutos": round(guardian.minutos(), 2),
            "evaluaciones": evaluaciones,
            "referencias": referencias,
        }

    def escribir_estado(final: bool) -> None:
        segundos = max(guardian.minutos() * 60, 1e-9)
        estado = {
            "partidas": partidas_terminadas,
            "partidas_totales": partidas_previas + partidas_terminadas,
            "promedio": round(statistics.fmean(totales_recientes), 1)
            if totales_recientes
            else None,
            "maximo": max(totales_recientes, default=None),
            "minimo": min(totales_recientes, default=None),
            "partidas_por_segundo": round(partidas_terminadas / segundos, 1),
            "curva": curva,
            "evaluaciones": evaluaciones,
            "mejor_evaluacion": mejor_eval if mejor_eval >= 0 else None,
            "referencias": referencias,
            "terminado": final,
            "motivo": motivo,
            "pausa": None if final else guardian.pausa,
            "recursos": guardian.medir() if final else guardian.ultima_medicion or guardian.medir(),
        }
        (carpeta / "estado.json").write_text(json.dumps(estado), encoding="utf-8")

    def evaluar() -> None:
        nonlocal mejor_eval
        red.eval()
        promedio = round(statistics.fmean(evaluar_agente(red, PARTIDAS_EVALUACION)), 1)
        evaluaciones.append(
            {
                "partidas": partidas_previas + partidas_terminadas,
                "minutos": round(guardian.minutos(), 2),
                "promedio": promedio,
            }
        )
        guardar_snapshot(red, carpeta / "modelo.pt", metricas())
        if promedio > mejor_eval:
            mejor_eval = promedio
            guardar_snapshot(red, carpeta / "mejor.pt", metricas())
        print(
            f"Examen: {promedio} puntos de promedio en {PARTIDAS_EVALUACION} partidas", flush=True
        )

    guardian.al_pausar = lambda: escribir_estado(final=False)

    try:
        evaluar()  # punto de partida
        escribir_estado(final=False)
        estados[0], mascaras[0] = entornos.observar()
        while motivo is None:
            # --- Jugar una tanda ---
            red.eval()
            with torch.no_grad():
                for t in range(t_max):
                    logits, v = red(torch.from_numpy(estados[t]), torch.from_numpy(mascaras[t]))
                    dist = torch.distributions.Categorical(logits=logits)
                    a = dist.sample()
                    acciones[t] = a.numpy()
                    logp_viejos[t] = dist.log_prob(a).numpy()
                    valores[t] = v.numpy()
                    probs = dist.probs.numpy() if registrar else None
                    (
                        estados[t + 1],
                        mascaras[t + 1],
                        recompensas[t],
                        terminadas[t],
                        totales,
                    ) = entornos.paso(acciones[t], probs)
                    totales_recientes.extend(totales)
                    partidas_terminadas += len(totales)
                _, v = red(torch.from_numpy(estados[t_max]), torch.from_numpy(mascaras[t_max]))
                valores[t_max] = v.numpy()

            # --- Ventajas (GAE, sin descuento: importa el puntaje final) ---
            ventajas = np.zeros((t_max, n), dtype=np.float32)
            acumulada = np.zeros(n, dtype=np.float32)
            for t in reversed(range(t_max)):
                sigue = 1.0 - terminadas[t]
                delta = recompensas[t] + valores[t + 1] * sigue - valores[t]
                acumulada = delta + args.lambda_gae * sigue * acumulada
                ventajas[t] = acumulada
            retornos = ventajas + valores[:t_max]

            # --- Ajustar la red ---
            red.train()
            b_est = torch.from_numpy(estados[:t_max].reshape(-1, TAMANO_ESTADO))
            b_mas = torch.from_numpy(mascaras[:t_max].reshape(-1, CANTIDAD_JUGADAS))
            b_acc = torch.from_numpy(acciones.reshape(-1))
            b_logp = torch.from_numpy(logp_viejos.reshape(-1))
            b_ven = torch.from_numpy(ventajas.reshape(-1))
            b_ret = torch.from_numpy(retornos.reshape(-1))
            muestras = b_acc.shape[0]
            for _ in range(args.epocas):
                orden = torch.randperm(muestras)
                for inicio in range(0, muestras, args.minilote):
                    idx = orden[inicio : inicio + args.minilote]
                    logits, v = red(b_est[idx], b_mas[idx])
                    logp_todas = torch.log_softmax(logits, dim=-1)
                    logp = logp_todas.gather(1, b_acc[idx].unsqueeze(1)).squeeze(1)
                    p_todas = logp_todas.exp()
                    entropia = -(p_todas * logp_todas.masked_fill(~b_mas[idx], 0.0)).sum(-1).mean()
                    ven = b_ven[idx]
                    ven = (ven - ven.mean()) / (ven.std() + 1e-8)
                    razon = (logp - b_logp[idx]).exp()
                    recortada = razon.clamp(1 - args.recorte, 1 + args.recorte)
                    perdida_pol = -torch.min(razon * ven, recortada * ven).mean()
                    perdida_val = 0.5 * ((v - b_ret[idx]) ** 2).mean()
                    perdida = perdida_pol + 0.5 * perdida_val - args.entropia * entropia
                    optimizador.zero_grad()
                    perdida.backward()
                    torch.nn.utils.clip_grad_norm_(red.parameters(), 0.5)
                    optimizador.step()

            estados[0], mascaras[0] = estados[t_max], mascaras[t_max]

            # --- Progreso ---
            if totales_recientes:
                curva.append(
                    {
                        "partidas": partidas_previas + partidas_terminadas,
                        "minutos": round(guardian.minutos(), 2),
                        "promedio": round(statistics.fmean(totales_recientes), 1),
                    }
                )
                if len(curva) > MAX_PUNTOS_CURVA:
                    curva = curva[::2]
            if time.monotonic() - ultima_eval > args.evaluar_cada_min * 60:
                evaluar()
                ultima_eval = time.monotonic()
            motivo = guardian.revisar(partidas_terminadas)
            if time.monotonic() - ultimo_reporte > 10 or motivo:
                ultimo_reporte = time.monotonic()
                reciente = statistics.fmean(totales_recientes) if totales_recientes else 0
                print(
                    f"{partidas_previas + partidas_terminadas:>9} partidas · promedio reciente "
                    f"{reciente:6.1f} · {guardian.minutos():6.1f} min",
                    flush=True,
                )
                escribir_estado(final=False)
        evaluar()
    finally:
        if error := entornos.cerrar():
            motivo = error
        guardian.cerrar()

    escribir_estado(final=True)
    print(f"Fin: {motivo}. Modelo en {carpeta / 'modelo.pt'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
