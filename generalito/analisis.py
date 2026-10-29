"""Qué aprendió un modelo y en qué se diferencia de otro. Solo estadísticas de partidas.

El modelo juega partidas de examen (dados reservados, sin azar) y se cuenta
cada decisión. Nada de esto se usa para entrenar.

Uso:
    uv run python -m generalito.analisis analizar --modelo modelos/modelo-v1.pt
    uv run python -m generalito.analisis comparar --modelo a.pt --modelo b.pt
"""

import argparse
import json
import statistics
from collections import Counter
from datetime import datetime
from pathlib import Path

from generalito.recursos import Guardian, Limites, aplicar_limites_proceso

SEMILLA_ANALISIS = 7_777  # distinta de la del examen del entrenamiento
ANCHO_HISTOGRAMA = 25
MAX_EJEMPLOS = 15


def _argumentos(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("tipo", choices=["analizar", "comparar"])
    p.add_argument("--modelo", type=Path, action="append", required=True)
    p.add_argument("--nombre", action="append", default=[], help="nombre para mostrar")
    p.add_argument("--partidas", type=int, default=2000)
    p.add_argument("--carpeta", type=Path, default=None)
    p.add_argument("--max-minutos", type=float, default=30)
    p.add_argument("--max-cpu", type=float, default=Limites().max_cpu_sistema)
    return p.parse_args(argv)


def _histograma(totales: list[int]) -> dict:
    conteos = Counter(t // ANCHO_HISTOGRAMA * ANCHO_HISTOGRAMA for t in totales)
    return {"ancho": ANCHO_HISTOGRAMA, "conteos": dict(sorted(conteos.items()))}


def main(argv: list[str] | None = None) -> int:
    args = _argumentos(argv)
    if args.tipo == "comparar" and len(args.modelo) != 2:
        raise SystemExit("Para comparar hacen falta dos --modelo")
    limites = Limites(max_minutos=args.max_minutos, hilos_cpu=1, max_cpu_sistema=args.max_cpu)
    aplicar_limites_proceso(limites)

    import numpy as np
    import torch

    from generalito.agente.codificacion import TAMANO_ESTADO, codificar
    from generalito.agente.red import cargar_snapshot
    from generalito.motor import CANTIDAD_JUGADAS, FuenteReservada, Partida
    from generalito.motor.categorias import NOMBRES, Categoria
    from generalito.motor.jugadas import Anotar, decodificar
    from generalito.motor.planilla import NOMBRES_COLUMNAS, Columna

    torch.set_num_threads(1)
    nombres = args.nombre + [m.stem for m in args.modelo[len(args.nombre) :]]
    carpeta = args.carpeta or Path("corridas") / datetime.now().strftime(
        f"%Y%m%d-%H%M%S-{args.tipo}"
    )
    carpeta.mkdir(parents=True, exist_ok=True)
    config = {
        "programa": args.tipo,
        "jugador": " vs ".join(nombres),
        "modelos": [str(m) for m in args.modelo],
        "nombres": nombres,
        "partidas": args.partidas,
        "limites": limites.como_dict(),
    }
    (carpeta / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    cargados = [cargar_snapshot(m) for m in args.modelo]
    redes = [red for red, _ in cargados]
    # Umbrales a informar: 950 siempre, más el X de cada modelo entrenado para superarlo
    from generalito.evaluar import UMBRAL_REFERENCIA, porcentaje_que_supera

    umbrales = [UMBRAL_REFERENCIA]
    for _, metricas in cargados:
        objetivo = (metricas or {}).get("entrenamiento", {}).get("objetivo") or {}
        if objetivo.get("tipo") == "superar" and objetivo.get("umbral") not in umbrales:
            umbrales.append(objetivo["umbral"])
    guardian = Guardian(limites, carpeta)

    def escribir(estado: dict) -> None:
        estado["recursos"] = guardian.ultima_medicion or guardian.medir()
        (carpeta / "estado.json").write_text(json.dumps(estado), encoding="utf-8")

    @torch.no_grad()
    def jugar(red, otra=None, al_avanzar=None):
        """Juega todas las partidas a la vez. Devuelve los juegos y, si hay `otra`,
        en cada decisión anota qué habría elegido la otra red."""
        n = args.partidas
        juegos = [Partida(FuenteReservada(SEMILLA_ANALISIS, i)) for i in range(n)]
        decisiones = []  # (partida, turno, tiro, dados, jugada, valor anotado o None)
        distintas = []
        estados = np.zeros((n, TAMANO_ESTADO), dtype=np.float32)
        mascaras = np.zeros((n, CANTIDAD_JUGADAS), dtype=bool)
        activos = list(range(n))
        paso = 0
        while activos:
            k = len(activos)
            for j, i in enumerate(activos):
                codificar(juegos[i], estados[j])
                mascaras[j] = juegos[i].mascara_legal()
            e, m = torch.from_numpy(estados[:k]), torch.from_numpy(mascaras[:k])
            elegidas = red(e, m)[0].argmax(-1).tolist()
            de_la_otra = otra(e, m)[0].argmax(-1).tolist() if otra is not None else None
            for j, i in enumerate(activos):
                p = juegos[i]
                jugada = elegidas[j]
                contexto = (i, p.turno, p.tiro, p.dados)
                if de_la_otra is not None and de_la_otra[j] != jugada:
                    distintas.append((*contexto, jugada, de_la_otra[j]))
                p.aplicar(jugada)
                accion = decodificar(jugada)
                valor = None
                if isinstance(accion, Anotar):
                    valor = p.planilla.valor(accion.columna, accion.categoria)
                decisiones.append((i, contexto[1], contexto[2], contexto[3], jugada, valor))
            activos = [i for i in activos if not juegos[i].terminada]
            paso += 1
            if al_avanzar is not None:
                motivo = al_avanzar(paso)
                if motivo:
                    raise InterruptedError(motivo)
        return juegos, decisiones, distintas

    def progreso(etapa: str, total_pasos: int = 160):
        def al_avanzar(paso: int) -> str | None:
            motivo = guardian.revisar(0)
            if paso % 10 == 0:
                escribir(
                    {
                        "terminado": False,
                        "etapa": etapa,
                        "avance": round(min(paso / total_pasos, 0.99), 2),
                        "pausa": guardian.pausa,
                    }
                )
            return motivo

        return al_avanzar

    def texto(jugada: int, dados) -> str:
        accion = decodificar(jugada)
        if isinstance(accion, Anotar):
            verbo = "Tacha" if accion.tachar else "Anota"
            return f"{verbo} {NOMBRES[accion.categoria]} en {NOMBRES_COLUMNAS[accion.columna]}"
        if not accion.guardar:
            return "Tira los 5"
        return "Guarda " + "-".join(str(dados[i]) for i in accion.guardar)

    motivo = None
    resultado: dict = {}
    try:
        if args.tipo == "analizar":
            juegos, decisiones, _ = jugar(redes[0], al_avanzar=progreso("Jugando partidas"))
            n = len(juegos)
            suma = np.zeros(52)
            tachadas = np.zeros(52)
            tachadas_por_tiro = np.zeros((52, 3), dtype=int)
            turno_suma = np.zeros(52)
            tiro_al_anotar = Counter()
            guardados = Counter()
            servida_con_puntaje = 0
            for _, turno, tiro, _, jugada, valor in decisiones:
                accion = decodificar(jugada)
                if isinstance(accion, Anotar):
                    c = accion.columna * 13 + accion.categoria
                    suma[c] += valor
                    tachadas[c] += valor == 0
                    if valor == 0:
                        tachadas_por_tiro[c, tiro - 1] += 1
                    turno_suma[c] += turno
                    tiro_al_anotar[tiro] += 1
                    servida_con_puntaje += accion.columna == Columna.SERVIDA and valor > 0
                else:
                    guardados[len(accion.guardar)] += 1
            totales = [p.total() for p in juegos]
            columnas = []
            for col in Columna:
                subtotales = [p.planilla.subtotal(col) for p in juegos]
                con_bonus = sum(p.planilla.suma_numeros(col) >= 60 for p in juegos)
                columnas.append(
                    {
                        "nombre": NOMBRES_COLUMNAS[col],
                        "promedio": round(statistics.fmean(subtotales), 1),
                        "bonus_pct": round(100 * con_bonus / n, 1),
                    }
                )
            resultado = {
                "partidas": n,
                "promedio": round(statistics.fmean(totales), 1),
                "desvio": round(statistics.pstdev(totales), 1),
                "maximo": max(totales),
                "minimo": min(totales),
                "histograma": _histograma(totales),
                "columnas_nombres": [NOMBRES_COLUMNAS[c] for c in Columna],
                "categorias": [NOMBRES[c] for c in Categoria],
                # matrices de 13 categorías × 4 columnas
                "puntos": [[round(suma[c * 13 + k] / n, 1) for c in range(4)] for k in range(13)],
                "tachada_pct": [
                    [round(100 * tachadas[c * 13 + k] / n, 1) for c in range(4)] for k in range(13)
                ],
                "turno_medio": [
                    [round(turno_suma[c * 13 + k] / n, 1) for c in range(4)] for k in range(13)
                ],
                # cuántas veces se tachó cada casilla en el tiro 1, 2 y 3
                "tachada_por_tiro": [
                    [tachadas_por_tiro[c * 13 + k].tolist() for c in range(4)] for k in range(13)
                ],
                "columnas": columnas,
                "tiro_al_anotar": [tiro_al_anotar[t] for t in (1, 2, 3)],
                "dados_guardados": [guardados[g] for g in range(5)],
                "servida_con_puntaje_pct": round(100 * servida_con_puntaje / (n * 13), 1),
                "supera": [
                    {"umbral": u, "pct": porcentaje_que_supera(totales, u)} for u in umbrales
                ],
            }
        else:
            juegos_a, _, distintas = jugar(redes[0], redes[1], progreso(f"Juega {nombres[0]}"))
            juegos_b, _, _ = jugar(redes[1], al_avanzar=progreso(f"Juega {nombres[1]}"))
            ta = [p.total() for p in juegos_a]
            tb = [p.total() for p in juegos_b]
            gana_a = sum(a > b for a, b in zip(ta, tb, strict=True))
            gana_b = sum(b > a for a, b in zip(ta, tb, strict=True))
            por_tiro = Counter(d[2] for d in distintas)
            por_tipo = Counter(
                "anotar" if isinstance(decodificar(d[4]), Anotar) else "tirar" for d in distintas
            )
            # Ejemplos repartidos a lo largo de la partida
            ejemplos = []
            if distintas:
                paso = max(1, len(distintas) // MAX_EJEMPLOS)
                for i, turno, tiro, dados, ja, jb in distintas[::paso][:MAX_EJEMPLOS]:
                    ejemplos.append(
                        {
                            "partida": i,
                            "turno": turno,
                            "tiro": tiro,
                            "dados": "-".join(map(str, dados)),
                            "a": texto(ja, dados),
                            "b": texto(jb, dados),
                        }
                    )
            resultado = {
                "partidas": len(ta),
                "nombres": nombres,
                "promedios": [round(statistics.fmean(ta), 1), round(statistics.fmean(tb), 1)],
                "victorias": [gana_a, len(ta) - gana_a - gana_b, gana_b],
                "diferencia_media": round(statistics.fmean(ta) - statistics.fmean(tb), 1),
                "supera": [
                    {
                        "umbral": u,
                        "pct": [porcentaje_que_supera(ta, u), porcentaje_que_supera(tb, u)],
                    }
                    for u in umbrales
                ],
                "histogramas": [_histograma(ta), _histograma(tb)],
                "decisiones_distintas": len(distintas),
                "distintas_por_partida": round(len(distintas) / len(ta), 1),
                "distintas_por_tiro": [por_tiro[t] for t in (1, 2, 3)],
                "distintas_por_tipo": dict(por_tipo),
                "ejemplos": ejemplos,
            }
    except InterruptedError as error:
        motivo = str(error)
    finally:
        guardian.cerrar()

    escribir(
        {
            "terminado": True,
            "motivo": motivo or "terminó el análisis",
            "resultado": resultado if not motivo else None,
            "pausa": None,
        }
    )
    print(f"Fin: {motivo or 'listo'}. Resultado en {carpeta / 'estado.json'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
