"""Aprender pensando (fase 2, "expert iteration"): la red aprende de lo que decide pensando.

Ciclo:
1. El modelo juega partidas pensando el turno (en varios procesos), con dados al azar
   y algo de variedad: a veces sortea entre las mejores opciones según sus valores.
2. La red se entrena con esas partidas: la política imita las mejores opciones de la
   búsqueda (como probabilidades) y el valor aprende lo que realmente se consiguió
   desde cada decisión hasta el final, según el objetivo del modelo.
3. Examen sin pensar y pensando, y se repite con la red nueva.

Nada humano: la búsqueda solo usa las reglas y la propia red (ver pensar.py).

Uso:
    uv run python -m generalito.agente.aprender --desde modelos/v3.0.99.pt --minutos 60
"""

import argparse
import json
import shutil
import statistics
import time
from datetime import datetime
from pathlib import Path

from generalito.recursos import ARCHIVO_PARAR, Guardian, Limites, aplicar_limites_proceso


def _argumentos(argv):
    d = Limites()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--desde", type=Path, required=True, help="modelo entrenado del que se parte")
    p.add_argument("--minutos", type=float, default=60)
    p.add_argument("--carpeta", type=Path, default=None)
    p.add_argument("--semilla", type=int, default=0)
    p.add_argument("--partidas-ciclo", type=int, default=500, help="partidas pensando por ciclo")
    p.add_argument("--max-ciclos", type=int, default=0, help="0 = hasta que se acabe el tiempo")
    p.add_argument(
        "--variedad",
        type=float,
        default=0.15,
        help="probabilidad de sortear entre las mejores opciones en vez de jugar la mejor",
    )
    p.add_argument(
        "--temperatura",
        type=float,
        default=5,
        help="cuánto se parecen las opciones para la búsqueda: en puntos"
        " (o puntos porcentuales de chance en 'Superar X')",
    )
    p.add_argument("--muestras", type=int, default=32, help="tiradas para promediar al pensar")
    p.add_argument("--examen-partidas", type=int, default=500)
    p.add_argument("--examen-pensando", type=int, default=500)
    p.add_argument("--ciclos-memoria", type=int, default=3, help="ciclos con los que se entrena")
    p.add_argument("--epocas", type=int, default=2)
    p.add_argument("--minilote", type=int, default=2048)
    p.add_argument("--aprendizaje", type=float, default=3e-4)
    p.add_argument("--peso-valor", type=float, default=1.0)
    p.add_argument(
        "--peso-busqueda",
        type=float,
        default=0.7,
        help="el valor aprende una mezcla: este peso al valor que calculó la búsqueda en cada"
        " decisión (estable) y el resto a lo que realmente se consiguió (ruidoso)",
    )
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

    from generalito.agente.codificacion import VERSION_CODIFICACION, codificar_crudo
    from generalito.agente.entornos import ESCALA_RECOMPENSA
    from generalito.agente.pensar import generar_en_paralelo, jugar_en_paralelo
    from generalito.agente.red import cargar_snapshot, guardar_snapshot
    from generalito.evaluar import (
        SEMILLA_EVALUACION,
        UMBRAL_REFERENCIA,
        evaluar_agente,
        porcentaje_que_supera,
    )
    from generalito.motor import CANTIDAD_JUGADAS, VERSION_REGLAS
    from generalito.recursos import tamano_carpeta

    torch.set_num_threads(max(1, limites.hilos_cpu))
    torch.manual_seed(args.semilla)

    red, metricas_previas = cargar_snapshot(args.desde)
    previo = metricas_previas.get("entrenamiento", {})
    objetivo = previo.get("objetivo") or {"tipo": "puntaje"}
    partidas_previas = metricas_previas.get("partidas_entrenadas", 0)
    pistas = list(metricas_previas.get("pistas", []))
    # La temperatura se da en puntos; la búsqueda trabaja en las unidades de la red
    if objetivo.get("tipo") == "superar":
        temperatura = args.temperatura / 100
    else:
        temperatura = args.temperatura / ESCALA_RECOMPENSA

    carpeta = args.carpeta or Path("corridas") / datetime.now().strftime("%Y%m%d-%H%M%S-aprender")
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "datos").mkdir(exist_ok=True)
    (carpeta / "redes").mkdir(exist_ok=True)
    config = {
        "programa": "aprender",
        "jugador": "agente",
        "modo": "aprender_pensando",
        "desde": str(args.desde),
        "objetivo": objetivo,
        "version_reglas": VERSION_REGLAS,
        "version_codificacion": VERSION_CODIFICACION,
        "parametros": {
            **{k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
            "oculta": red.oculta,
        },
        "limites": limites.como_dict(),
    }
    (carpeta / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    guardian = Guardian(limites, carpeta)
    optimizador = torch.optim.Adam(red.parameters(), lr=args.aprendizaje, eps=1e-5)
    print(f"Aprendiendo pensando en {carpeta}. Para frenar: crear {carpeta / ARCHIVO_PARAR}")

    estado: dict = {
        "ciclo": 0,
        "partidas": 0,
        "partidas_totales": partidas_previas,
        "evaluaciones": [],
        "aprendizaje": [],
        "terminado": False,
        "motivo": None,
        "etapa": "Examen inicial",
    }
    memoria: list[dict] = []
    mejor = -float("inf")
    motivo = None

    def escribir(final: bool = False) -> None:
        segundos = max(guardian.minutos() * 60, 1e-9)
        estado.update(
            {
                "terminado": final,
                "motivo": motivo,
                "pausa": None if final else guardian.pausa,
                "partidas_por_minuto": round(60 * estado["partidas"] / segundos, 1),
                "datos_mb": round(tamano_carpeta(carpeta / "datos") / 2**20, 2),
                "recursos": guardian.medir()
                if final
                else guardian.ultima_medicion or guardian.medir(),
                "entrenamiento": {
                    "modo": "aprender_pensando",
                    "objetivo": objetivo,
                    "oculta": red.oculta,
                },
                "pistas": pistas,
            }
        )
        (carpeta / "estado.json").write_text(json.dumps(estado), encoding="utf-8")

    def metricas() -> dict:
        return {
            "partidas_entrenadas": partidas_previas + estado["partidas"],
            "minutos": round(guardian.minutos(), 2),
            "evaluaciones": estado["evaluaciones"],
            "entrenamiento": {
                "modo": "aprender_pensando",
                "objetivo": objetivo,
                "oculta": red.oculta,
                "lambda_gae": previo.get("lambda_gae"),
                "entropia": previo.get("entropia"),
                "variedad": args.variedad,
                "muestras": args.muestras,
                "pista": None,
            },
            "pistas": pistas,
        }

    def puntaje_objetivo(totales: list[int]) -> float:
        """Lo que optimiza el objetivo del modelo, para elegir el mejor."""
        if objetivo.get("tipo") == "superar":
            return porcentaje_que_supera(totales, objetivo["umbral"])
        valor = statistics.fmean(totales)
        if objetivo.get("tipo") == "mixto":
            valor += objetivo["premio"] * porcentaje_que_supera(totales, objetivo["umbral"]) / 100
        return valor

    def progreso_generando(etapa: str, total: int):
        def al_avanzar(hechas: int) -> str | None:
            estado["etapa"] = f"{etapa} ({hechas}/{total})"
            motivo_ = guardian.revisar(estado["partidas"])
            escribir()
            return motivo_

        return al_avanzar

    def examen() -> None:
        nonlocal mejor
        estado["etapa"] = "Examen sin pensar"
        escribir()
        red.eval()
        sin_pensar = evaluar_agente(red, args.examen_partidas)
        ruta = carpeta / "modelo.pt"
        guardar_snapshot(red, ruta, metricas())
        entrada = {
            "ciclo": estado["ciclo"],
            "partidas": partidas_previas + estado["partidas"],
            "minutos": round(guardian.minutos(), 2),
            "promedio": round(statistics.fmean(sin_pensar), 1),
            "supera_950_pct": porcentaje_que_supera(sin_pensar, UMBRAL_REFERENCIA),
        }
        if args.examen_pensando > 0:
            spec = {"ruta": str(ruta), "pensar": True, "muestras": args.muestras}
            n = args.examen_pensando
            resultados = jugar_en_paralelo(
                spec, None, n, SEMILLA_EVALUACION, limites.hilos_cpu,
                progreso_generando("Examen pensando", n),
            )  # fmt: skip
            pensando = [r["total"] for r in resultados]
            entrada["pensando"] = {
                "partidas": n,
                "promedio": round(statistics.fmean(pensando), 1),
                "supera_950_pct": porcentaje_que_supera(pensando, UMBRAL_REFERENCIA),
                "segundos_por_partida": round(
                    statistics.fmean(r["segundos"] for r in resultados), 3
                ),
            }
            valor = puntaje_objetivo(pensando)
        else:
            valor = puntaje_objetivo(sin_pensar)
        entrada["mejor"] = valor > mejor
        estado["evaluaciones"].append(entrada)
        guardar_snapshot(red, ruta, metricas())
        if entrada["mejor"]:
            mejor = valor
            guardar_snapshot(red, carpeta / "mejor.pt", metricas())
        pens = entrada.get("pensando", {})
        print(
            f"Ciclo {estado['ciclo']}: sin pensar {entrada['promedio']}"
            f" ({entrada['supera_950_pct']}% llega a 950) · pensando {pens.get('promedio')}"
            f" ({pens.get('supera_950_pct')}%)",
            flush=True,
        )

    def guardar_datos(partidas: list[dict]) -> dict:
        """Junta las partidas del ciclo, calcula lo que se consiguió desde cada decisión y
        lo guarda comprimido, respetando el límite de disco."""
        claves = [k for k in partidas[0] if k not in ("indice", "total")]
        bloques = {k: np.concatenate([p[k] for p in partidas]) for k in claves}
        finales = np.concatenate(
            [np.full(len(p["tiro"]), p["total"], dtype=np.int32) for p in partidas]
        )
        antes = bloques["total_antes"].astype(np.int32)
        if objetivo.get("tipo") == "superar":
            retorno = (finales >= objetivo["umbral"]).astype(np.float32)
        else:
            retorno = (finales - antes).astype(np.float32)
            if objetivo.get("tipo") == "mixto":
                retorno += objetivo["premio"] * (finales >= objetivo["umbral"])
            retorno /= ESCALA_RECOMPENSA
        bloques["retorno"] = retorno
        # Lo que aprende el valor: mezcla del valor de la búsqueda y lo que se consiguió
        bloques["valor_objetivo"] = (
            args.peso_busqueda * bloques["valor_busqueda"] + (1 - args.peso_busqueda) * retorno
        ).astype(np.float32)
        destino = carpeta / "datos" / f"ciclo_{estado['ciclo']:04d}.npz"
        temporal = carpeta / "datos" / "parcial.npz"
        np.savez_compressed(temporal, **bloques)
        libre = shutil.disk_usage(carpeta).free / 2**30
        lleno = tamano_carpeta(carpeta) > limites.max_disco_mb * 2**20
        if lleno or libre < limites.min_disco_libre_gb:
            temporal.unlink()
            raise InterruptedError("las partidas guardadas superarían el límite de disco")
        temporal.replace(destino)
        return bloques

    def _miembros(jugadas, equivalentes) -> "torch.Tensor":
        """(B, 8, 135): qué jugadas de la red representan cada opción de la búsqueda."""
        b, k = jugadas.shape
        miembros = torch.zeros(b, k, CANTIDAD_JUGADAS)
        bits = torch.from_numpy(
            ((equivalentes[:, :, None].astype(np.int64) >> np.arange(31)) & 1).astype(np.float32)
        )
        miembros[:, :, :31] = bits
        es_anotar = (jugadas >= 31).float()
        miembros.scatter_add_(2, jugadas.clamp(min=0).unsqueeze(-1), es_anotar.unsqueeze(-1))
        return miembros * (jugadas >= 0).float().unsqueeze(-1)

    def aprender() -> dict:
        """Entrena la red con los últimos ciclos guardados en memoria."""
        datos = {k: np.concatenate([m[k] for m in memoria]) for k in memoria[0]}
        n = len(datos["tiro"])
        mascaras = np.unpackbits(datos["mascara"], axis=1, count=CANTIDAD_JUGADAS).astype(bool)
        red.train()
        sumas = {"politica": 0.0, "valor": 0.0, "coincide": 0.0, "lotes": 0}
        for _ in range(args.epocas):
            orden = np.random.permutation(n)
            for inicio in range(0, n, args.minilote):
                idx = orden[inicio : inicio + args.minilote]
                x = torch.from_numpy(
                    codificar_crudo(
                        datos["dados"][idx],
                        datos["tiro"][idx],
                        datos["servido"][idx],
                        datos["turno"][idx],
                        datos["casillas"][idx],
                    )
                )
                mascara = torch.from_numpy(mascaras[idx])
                jugadas = torch.from_numpy(datos["jugadas"][idx].astype(np.int64))
                pesos = torch.from_numpy(datos["objetivo"][idx].astype(np.float32))
                miembros = _miembros(jugadas, datos["equivalentes"][idx])  # (B, 8, 135)
                logits, v = red(x, mascara)
                probs = torch.softmax(logits, dim=-1)
                # Probabilidad de cada opción de la búsqueda = suma de sus jugadas
                # equivalentes (las mismas formas de guardar en distintas posiciones)
                prob_opcion = (probs.unsqueeze(1) * miembros).sum(-1)
                perdida_pol = -(pesos * torch.log(prob_opcion + 1e-8)).sum(-1).mean()
                retorno = torch.from_numpy(datos["valor_objetivo"][idx])
                perdida_val = 0.5 * ((v - retorno) ** 2).mean()
                perdida = perdida_pol + args.peso_valor * perdida_val
                optimizador.zero_grad()
                perdida.backward()
                torch.nn.utils.clip_grad_norm_(red.parameters(), 0.5)
                optimizador.step()
                sumas["politica"] += perdida_pol.item()
                sumas["valor"] += perdida_val.item()
                elegida = logits.argmax(-1)
                coincide = miembros[torch.arange(len(idx)), 0, elegida] > 0
                sumas["coincide"] += coincide.float().mean().item()
                sumas["lotes"] += 1
        lotes = max(1, sumas["lotes"])
        return {
            "ciclo": estado["ciclo"],
            "decisiones": n,
            "perdida_politica": round(sumas["politica"] / lotes, 4),
            "perdida_valor": round(sumas["valor"] / lotes, 4),
            # % de decisiones en que la red sola ya elige lo mismo que la búsqueda
            "coincide_pct": round(100 * sumas["coincide"] / lotes, 1),
        }

    try:
        examen()  # punto de partida (ciclo 0)
        escribir()
        motivo = guardian.revisar(0)
        while motivo is None:
            estado["ciclo"] += 1
            inicio = time.perf_counter()
            ruta_ciclo = carpeta / "redes" / f"ciclo_{estado['ciclo']:04d}.pt"
            guardar_snapshot(red, ruta_ciclo, metricas())
            spec = {"ruta": str(ruta_ciclo), "pensar": True, "muestras": args.muestras}
            partidas = generar_en_paralelo(
                spec,
                args.partidas_ciclo,
                args.semilla * 100_000 + estado["ciclo"],
                limites.hilos_cpu,
                args.variedad,
                temperatura,
                progreso_generando("Jugando pensando", args.partidas_ciclo),
            )
            estado["partidas"] += len(partidas)
            estado["partidas_totales"] = partidas_previas + estado["partidas"]
            estado["promedio_generadas"] = round(statistics.fmean(p["total"] for p in partidas), 1)
            memoria.append(guardar_datos(partidas))
            del memoria[: -args.ciclos_memoria]
            estado["etapa"] = "Aprendiendo de lo que pensó"
            escribir()
            resumen = aprender()
            resumen["segundos"] = round(time.perf_counter() - inicio, 1)
            resumen["promedio_generadas"] = estado["promedio_generadas"]
            estado["aprendizaje"].append(resumen)
            examen()
            # Solo se guardan las redes de los últimos 2 ciclos (las otras ya no hacen falta)
            for vieja in sorted((carpeta / "redes").glob("ciclo_*.pt"))[:-2]:
                vieja.unlink()
            escribir()
            motivo = guardian.revisar(estado["partidas"], forzar=True)
            if motivo is None and args.max_ciclos and estado["ciclo"] >= args.max_ciclos:
                motivo = f"se hicieron los {args.max_ciclos} ciclos pedidos"
    except InterruptedError as error:
        motivo = str(error)
    finally:
        guardian.cerrar()

    estado["etapa"] = "Terminado"
    escribir(final=True)
    print(f"Fin: {motivo}. Modelo en {carpeta / 'mejor.pt'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
