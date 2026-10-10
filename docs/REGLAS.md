# Reglas de la generala de 4 columnas

> **Estado: ✅ confirmadas por Facu.** Este documento es la fuente de verdad del motor del juego. Lo único pendiente es el orden de turnos con varios bandos, que no afecta a la v1 (ver [Pendiente para la v2](#pendiente-para-la-v2)).
>
> Está escrito para que el motor se pueda implementar sin interpretar nada. Si algo no está acá, no es regla: hay que preguntar.

Versión de reglas: `1.0`.

## 1. Jugadores

- Juegan N "bandos" (N ≥ 1). Un bando es un jugador solo o un equipo. Formatos habituales: solo, 1v1, 2v2, 1v1v1, 2v2v2, 1v1v1v1v1.
- Cada bando tiene **una sola planilla**. En un equipo, los integrantes comparten la planilla y se turnan para tirar. Quién decide la jugada dentro del equipo no importa para las reglas: para el motor, **un equipo es igual a un jugador**.
- Para elegir quién empieza, cada bando tira 1 dado y empieza el más alto.
- Los bandos juegan por turnos alternados, de a un turno completo por vez.
- La v1 del modelo juega sola (1 bando), así que el orden de turnos no aplica todavía.

## 2. Dados y turno

- Se juega con 5 dados de 6 caras.
- Un turno tiene entre 1 y 3 tiros:
  1. **Tiro 1:** se tiran los 5 dados.
  2. Después de cada tiro, el jugador elige entre:
     - **Anotar:** terminar el turno y anotar (ver §4).
     - **Volver a tirar** (solo si hizo menos de 3 tiros): elige qué subconjunto de dados guardar (de 0 a 4) y tira el resto. Los dados guardados en un tiro **no quedan fijos**: en el tiro siguiente se puede volver a tirar cualquiera de ellos.
  3. Después del tiro 3, el jugador tiene que anotar.
- **En cada turno se anota exactamente una casilla**, con un puntaje o con una X (tachar).

### 2.1 Tiro servido

Un tiro es **servido** si en ese tiro se tiraron los 5 dados juntos (o sea, no se guardó ninguno). El tiro 1 siempre es servido. El tiro 2 o el 3 son servidos si se volvieron a tirar los 5, sin importar qué se guardó antes.

Lo que importa para anotar en la columna Servida es si **el último tiro del turno** (el que dejó los dados que se anotan) fue servido.

Ejemplo: en el tiro 1 guardo 2 dados. En el tiro 2 no sale lo que buscaba. En el tiro 3 tiro los 5 y anoto ese resultado: es servido.

## 3. Planilla

### 3.1 Categorías (filas), en orden de bajada

| # | Categoría | Se anota con dados | Se puede tachar |
| --- | --- | --- | --- |
| 1 | 1 | sí | sí |
| 2 | 2 | sí | sí |
| 3 | 3 | sí | sí |
| 4 | 4 | sí | sí |
| 5 | 5 | sí | sí |
| 6 | 6 | sí | sí |
| — | **Bonus** | no (se calcula) | no |
| 7 | Escalera 1-5 | sí | sí |
| 8 | Escalera 2-6 | sí | sí |
| 9 | Full | sí | sí |
| 10 | Póker | sí | sí |
| 11 | Menor | sí | sí |
| 12 | Mayor | sí | sí |
| 13 | Generala | sí | sí |

Hay 13 categorías anotables más el Bonus, que es una fila calculada y no una casilla.

### 3.2 Columnas

| Columna | Restricción para anotar |
| --- | --- |
| **Baja** | Solo la próxima casilla libre en el orden de bajada: 1, 2, 3, 4, 5, 6, Escalera 1-5, Escalera 2-6, Full, Póker, Menor, Mayor, Generala. |
| **Sube** | Solo la próxima casilla libre en el orden inverso: Generala, Mayor, Menor, Póker, Full, Escalera 2-6, Escalera 1-5, 6, 5, 4, 3, 2, 1. |
| **Desordenada** | Cualquier casilla libre. |
| **Servida** | Cualquier casilla libre. Para anotar un **puntaje**, el último tiro del turno tiene que haber sido servido (§2.1). Para **tachar** no hace falta. |

- El Bonus no ocupa lugar en el orden de Baja ni de Sube: se saltea.
- En cada turno se puede anotar en **cualquier columna**, siempre que se cumpla su restricción.
- Una planilla tiene 13 × 4 = **52 casillas**. Cada bando juega exactamente 52 turnos.

## 4. Anotar

Al terminar el turno, el jugador elige una casilla libre que cumpla la restricción de su columna (§3.2) y le asigna:

- **Un puntaje**, si los dados cumplen la condición de la categoría (§5). Ese puntaje es el que dice la tabla; no se elige el valor.
- **Una X (tachar)**, en cualquier caso. Una X vale 0 a todos los efectos.

Tachar también ocupa la casilla, así que respeta la restricción de cada columna:

- En Baja y Sube solo se puede tachar la próxima casilla libre.
- En Desordenada se puede tachar cualquier casilla libre.
- En Servida se puede tachar cualquier casilla libre, **aunque el último tiro no haya sido servido**.

Reglas:

- El jugador elige **libremente** dónde anotar entre todas las opciones legales. Por ejemplo, con 5-5-5-2-2 puede anotar Full (45), 5 (15), 2 (4), Menor o Mayor (19, si se cumple la restricción) o tachar cualquier casilla habilitada.
- Se puede tachar **aunque haya algo para anotar**. Es parte de la estrategia (por ejemplo, para destrabar Baja o Sube).
- Anotar 0 en una categoría de números (por ejemplo, en "1" sin ningún 1) es equivalente a tachar. Por costumbre se pone X.
- Los dados no se pueden anotar en una categoría cuya condición no cumplen. En ese caso la única opción para esa casilla es tachar.

## 5. Puntaje de cada categoría

Notación: `dados` son los 5 valores finales del turno y `cuenta(v)` es cuántos dados muestran el valor `v`.

| Categoría | Condición | Puntaje |
| --- | --- | --- |
| 1 a 6 (valor `v`) | ninguna | `v × cuenta(v)` (puede ser 0) |
| Escalera 1-5 | los dados son exactamente {1, 2, 3, 4, 5}, en cualquier orden | 20 |
| Escalera 2-6 | los dados son exactamente {2, 3, 4, 5, 6}, en cualquier orden | 20 |
| Full | existe `a` con `cuenta(a) = 3` y existe `b ≠ a` con `cuenta(b) = 2` | `30 + 3 × a` |
| Póker | existe `a` con `cuenta(a) = 4` (el quinto dado es distinto) | `40 + 4 × a` |
| Menor | la suma cumple la restricción Menor/Mayor (§5.1) | suma de los 5 dados |
| Mayor | la suma cumple la restricción Menor/Mayor (§5.1) | suma de los 5 dados |
| Generala | `cuenta(a) = 5` para algún `a` | `50 + 5 × a` |

- **Cinco iguales no son Full ni Póker**, solo Generala (y sirven para un número, Menor o Mayor).
- Sacar algo servido **no da puntos extra**.
- La generala servida se anota como cualquier otra y **no gana la partida**.

### 5.1 Restricción Menor / Mayor

Se aplica **dentro de cada columna** por separado:

- Si la casilla Mayor de esa columna tiene un **puntaje**, el Menor tiene que ser **estrictamente menor** que ese puntaje.
- Si la casilla Menor de esa columna tiene un **puntaje**, el Mayor tiene que ser **estrictamente mayor** que ese puntaje.
- Si la otra casilla está libre o tachada, no hay restricción.
- Si la restricción no se cumple, esa casilla solo se puede tachar.

Ejemplo: en Desordenada se anota Menor = 18. Después, Mayor solo admite sumas de 19 a 30. Si en cambio el Menor se hubiera tachado, el Mayor admitiría cualquier suma.

## 6. Puntaje de la planilla

Para cada columna:

1. `suma_numeros` = suma de las casillas 1 a 6 (cada X vale 0).
2. `bonus` = `suma_numeros + 30` si `suma_numeros ≥ 60`; si no, `bonus = suma_numeros`.
3. `subtotal_columna` = `bonus` + Escalera 1-5 + Escalera 2-6 + Full + Póker + Menor + Mayor + Generala (cada X vale 0).

Las casillas 1 a 6 **no se suman aparte**: ya están dentro del Bonus.

`total` = suma de los subtotales de las 4 columnas.

Ejemplos de Bonus: si de 1 a 6 se suma 62, el Bonus vale 92. Si se suma 60, vale 90. Si se suma 59, vale 59.

### 6.1 Máximos teóricos (útiles para normalizar recompensas)

| Concepto | Máximo |
| --- | --- |
| Bonus | 105 + 30 = 135 (cinco de cada número) |
| Escaleras | 20 + 20 = 40 |
| Full | 48 (6-6-6-5-5) |
| Póker | 64 (cuatro 6) |
| Menor + Mayor | 29 + 30 = 59 |
| Generala | 80 (cinco 6) |
| **Columna** | **426** |
| **Planilla** | **1704** |

## 7. Fin de la partida

- La partida termina cuando todos los bandos completaron sus 52 casillas.
- Gana el bando con mayor `total`.
- Si hay empate en el primer puesto, **queda empatado**: no hay desempate.
- No hay victoria instantánea.

## 8. Casos de prueba

Hay una partida completa de ejemplo en [`PARTIDA_EJEMPLO.md`](PARTIDA_EJEMPLO.md).

Casos para los tests del motor. "—" significa que la categoría no se cumple (solo se puede tachar).

| Dados | 1 | 2 | 3 | 4 | 5 | 6 | Esc 1-5 | Esc 2-6 | Full | Póker | Suma (Menor/Mayor) | Generala |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5-5-5-2-2 | 0 | 4 | 0 | 0 | 15 | 0 | — | — | 45 | — | 19 | — |
| 2-2-2-2-6 | 0 | 8 | 0 | 0 | 0 | 6 | — | — | — | 48 | 14 | — |
| 2-2-2-2-2 | 0 | 10 | 0 | 0 | 0 | 0 | — | — | — | — | 10 | 60 |
| 3-1-4-5-2 | 1 | 2 | 3 | 4 | 5 | 0 | 20 | — | — | — | 15 | — |
| 6-2-5-3-4 | 0 | 2 | 3 | 4 | 5 | 6 | — | 20 | — | — | 20 | — |
| 1-2-3-4-6 | 1 | 2 | 3 | 4 | 0 | 6 | — | — | — | — | 16 | — |
| 6-6-6-5-5 | 0 | 0 | 0 | 0 | 10 | 18 | — | — | 48 | — | 28 | — |

## Pendiente para la v2

No afecta a la v1 (un solo bando). Hay que definirlo antes de la v2:

- [ ] Si al tirar el dado para elegir quién empieza hay empate en el número más alto, ¿cómo se desempata?
- [ ] Con más de 2 bandos, ¿cómo sigue el orden de turnos después del primero?

## Historial de cambios

| Versión | Fecha | Cambio |
| --- | --- | --- |
| 0.0-borrador | 2026-10-10 | Plantilla inicial con hipótesis y preguntas abiertas. |
| 1.0-rc | 2026-10-10 | Reglas confirmadas por Facu: 4 columnas, 13 categorías + Bonus, definición de servida, Menor/Mayor, tachado, puntaje y fin de partida. Quedan 3 preguntas abiertas. |
| 1.0 | 2026-10-10 | Se puede tachar en Servida sin tiro servido. Tachar en Baja y Sube respeta el orden. El orden de turnos con varios bandos queda pendiente para la v2. |
