# Reglas de la generala de 4 columnas

> **Estado: BORRADOR, sin confirmar.** Este documento es la fuente de verdad del motor del juego. Nada del motor se implementa hasta que la sección correspondiente esté marcada como ✅ confirmada.
>
> Lo marcado como *hipótesis* es una suposición razonable para arrancar la conversación, no una regla.

Versión de reglas: `0.0-borrador` (cada cambio confirmado sube la versión; los snapshots de la red guardan con qué versión se entrenaron).

## Básico ✅

- 2 jugadores (en la v1, uno solo).
- 5 dados de 6 caras.
- Hasta 3 tiros por turno. Entre tiros se eligen qué dados guardar.
- La planilla tiene 4 columnas: **baja**, **sube**, **desordenada** y **servida**. Todos los juegos se anotan en cada columna.

## Juegos (filas de la planilla) ❓

*Hipótesis:* las 11 filas de la generala clásica, lo que da 4 × 11 = 44 casilleros.

| Juego | Condición | Puntaje (hipótesis) | Confirmado |
| --- | --- | --- | --- |
| 1 | — | suma de los 1 | ❓ |
| 2 | — | suma de los 2 | ❓ |
| 3 | — | suma de los 3 | ❓ |
| 4 | — | suma de los 4 | ❓ |
| 5 | — | suma de los 5 | ❓ |
| 6 | — | suma de los 6 | ❓ |
| Escalera | 1-2-3-4-5 o 2-3-4-5-6 (¿3-4-5-6-1?) | 20 (¿25 servida?) | ❓ |
| Full | trío + par | 30 (¿35 servido?) | ❓ |
| Póker | 4 iguales | 40 (¿45 servido?) | ❓ |
| Generala | 5 iguales | 50 | ❓ |
| Doble generala | segunda generala | 100 | ❓ |

Preguntas:

- [ ] ¿Son estas las filas? ¿Hay alguna más o alguna menos?
- [ ] ¿Cuánto vale cada juego? ¿Vale distinto según la columna?
- [ ] ¿Hay bonus (por ejemplo, por sumar X en los números)?
- [ ] ¿Qué cuenta como escalera? ¿El 1 hace de "comodín" o de 7?

## Columnas ❓

| Columna | Hipótesis | Confirmado |
| --- | --- | --- |
| Baja | Se llena en orden obligatorio, de arriba hacia abajo (1 → doble generala) | ❓ |
| Sube | Se llena en orden obligatorio, de abajo hacia arriba (doble generala → 1) | ❓ |
| Desordenada | Se anota libremente en cualquier casillero libre | ❓ |
| Servida | Solo se puede anotar con lo que salió en el **primer tiro** | ❓ |

Preguntas:

- [ ] En baja/sube, ¿el orden es estricto (solo el próximo casillero) o hay alguna flexibilidad?
- [ ] En cada turno, ¿se elige libremente en qué columna anotar?
- [ ] Servida: ¿es exactamente "con el primer tiro"? ¿Se puede anotar un número (ej. los 4) en servida aunque no sea un juego?
- [ ] ¿Hay que anunciar antes de tirar en qué columna se va a anotar?

## Tachar ❓

- [ ] ¿Se puede tachar (anotar 0) en cualquier casillero? ¿Hay restricciones por columna?
- [ ] ¿Es obligatorio anotar algo en cada turno? (*hipótesis:* sí; si no hay nada útil, se tacha).

## Victoria, puntaje final y empates ❓

- [ ] ¿El puntaje final es la suma de los 44 casilleros?
- [ ] ¿Hay victoria instantánea (por ejemplo, generala servida)? ¿En qué columna aplica?
- [ ] ¿Cómo se desempata?
- [ ] ¿La partida termina cuando ambos completan la planilla? ¿Juegan la misma cantidad de turnos?

## Casos raros ❓

- [ ] ¿Qué pasa si se saca generala con la casilla de generala ya ocupada (o tachada)?
- [ ] ¿Doble generala requiere tener la generala anotada (no tachada) en esa misma columna?
- [ ] Cualquier otra regla de la casa que se juegue "porque sí" hace 20 años.

## Historial de cambios

| Versión | Fecha | Cambio |
| --- | --- | --- |
| 0.0-borrador | 2026-10-10 | Plantilla inicial con hipótesis y preguntas abiertas. |
