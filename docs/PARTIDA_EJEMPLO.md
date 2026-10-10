# Partida de ejemplo (reglas 1.0)

Partida completa de un jugador (v1), con dados al azar (semilla 2026). Sirve para revisar las reglas y, más adelante, como caso de prueba del motor.

Las decisiones de esta partida son arbitrarias. Solo sirve para verificar que cada jugada sea legal y que el puntaje esté bien calculado. **No es una referencia de cómo jugar** y no se usa para entrenar ni para evaluar al modelo.

**Cómo leer la tabla:**

- "guarda X → Y" significa que guardó los dados X, volvió a tirar el resto y el resultado quedó en Y.
- "tira los 5 ★" es un tiro servido: volvió a tirar los 5 dados.
- La columna "Anota en" es la casilla elegida.

**Qué casos muestra:**

- **Servida en un tiro que no es el primero:** turnos 17, 29 y 32.
- **Tachar en Servida sin tiro servido:** turnos 43, 44, 47 y 52.
- **Orden de Sube:** turnos 2, 5, 6, 8, 10, 24, 33 y 34 a 39 (Generala → … → 1).
- **Orden de Baja:** turnos 7, 13, 18, 20 a 22, 31, 40 y 45 a 51 (1 → … → Generala).
- **Menor y Mayor:** en Baja, el Menor de 28 (turno 49) obliga a tachar el Mayor con una suma de 12 (turno 50). En Sube, el Mayor de 25 permite un Menor de 21 (turnos 5 y 6).
- **Bonus:** Desordenada llega a 63 en los números y su Bonus vale 93. Las otras columnas no llegan a 60 y su Bonus vale lo mismo que la suma.

## Turnos

| Turno | Tiro 1 | Tiro 2 | Tiro 3 | Anota en | Puntos |
| --- | --- | --- | --- | --- | --- |
| 1 | 1-3-5-5-6 |  |  | Servida · Menor | 20 |
| 2 | 1-2-5-5-5 | guarda 5-5-5 → 5-5-5-4-5 | guarda 5-5-5-5 → 5-5-5-5-5 | Sube · Generala | 75 |
| 3 | 6-4-5-4-2 | guarda 4-4-5-6 → 4-4-5-6-1 | guarda 4-5-6 → 4-5-6-5-1 | Desordenada · Menor | 21 |
| 4 | 1-3-1-4-1 |  |  | Servida · 1 | 3 |
| 5 | 6-4-6-3-2 | guarda 6-6 → 6-6-4-3-3 | guarda 6-6 → 6-6-3-4-6 | Sube · Mayor | 25 |
| 6 | 5-6-1-6-3 |  |  | Sube · Menor | 21 |
| 7 | 1-5-5-3-3 | guarda 3-3-5-5 → 3-3-5-5-4 | guarda 3-3-5-5 → 3-3-5-5-2 | Baja · 1 | X |
| 8 | 6-6-6-5-3 | guarda 6-6-6 → 6-6-6-1-6 | guarda 6-6-6-6 → 6-6-6-6-3 | Sube · Póker | 64 |
| 9 | 3-4-4-1-4 | guarda 3-4-4-4 → 3-4-4-4-5 | guarda 4-4-4 → 4-4-4-5-4 | Desordenada · Póker | 56 |
| 10 | 1-4-5-5-4 | guarda 4-4-5-5 → 4-4-5-5-4 |  | Sube · Full | 42 |
| 11 | 5-3-4-5-4 | guarda 4-4-5-5 → 4-4-5-5-5 |  | Desordenada · Full | 45 |
| 12 | 5-1-5-2-2 |  |  | Servida · 2 | 4 |
| 13 | 1-6-5-6-1 | tira los 5 ★ → 6-5-4-4-2 | tira los 5 ★ → 4-2-1-6-6 | Baja · 2 | 2 |
| 14 | 4-6-4-6-5 |  |  | Servida · Mayor | 25 |
| 15 | 3-5-4-6-3 |  |  | Servida · 3 | 6 |
| 16 | 5-6-5-6-4 |  |  | Desordenada · Mayor | 26 |
| 17 | 4-4-2-3-3 | tira los 5 ★ → 1-1-2-6-5 | tira los 5 ★ → 4-5-4-3-2 | Servida · 4 | 8 |
| 18 | 3-6-4-4-5 | tira los 5 ★ → 4-4-5-6-1 | tira los 5 ★ → 3-3-4-1-4 | Baja · 3 | 6 |
| 19 | 6-6-5-3-4 | tira los 5 ★ → 2-4-6-4-1 | tira los 5 ★ → 6-3-4-3-1 | Desordenada · 1 | 1 |
| 20 | 2-6-4-2-4 | guarda 4-4 → 4-4-1-1-1 | guarda 4-4 → 4-4-4-5-5 | Baja · 4 | 12 |
| 21 | 1-5-2-2-1 | guarda 2-2 → 2-2-5-1-5 | guarda 5-5 → 5-5-3-6-6 | Baja · 5 | 10 |
| 22 | 3-2-1-3-6 | guarda 2 → 2-5-5-4-6 | guarda 2-4-5-6 → 2-4-5-6-6 | Baja · 6 | 12 |
| 23 | 2-5-2-4-5 |  |  | Servida · 5 | 10 |
| 24 | 2-5-6-5-3 | guarda 2-3-5-6 → 2-3-5-6-1 | guarda 2-3-5 → 2-3-5-4-6 | Sube · Escalera 2-6 | 20 |
| 25 | 2-2-5-3-5 | guarda 2-3-5 → 2-3-5-4-4 | guarda 2-3-4-5 → 2-3-4-5-2 | Desordenada · 2 | 4 |
| 26 | 5-2-4-1-1 | guarda 1-2-4-5 → 1-2-4-5-4 | guarda 4-4 → 4-4-1-1-3 | Desordenada · 4 | 8 |
| 27 | 6-3-1-1-5 | guarda 3 → 3-4-3-6-3 | guarda 3-3-3 → 3-3-3-4-3 | Desordenada · 3 | 12 |
| 28 | 1-4-4-5-5 | guarda 5-5 → 5-5-2-2-5 | guarda 5-5-5 → 5-5-5-5-2 | Desordenada · 5 | 20 |
| 29 | 4-5-3-4-5 | tira los 5 ★ → 2-6-6-1-5 |  | Servida · 6 | 12 |
| 30 | 4-1-2-6-2 | tira los 5 ★ → 1-6-5-1-4 | tira los 5 ★ → 6-2-4-6-6 | Desordenada · 6 | 18 |
| 31 | 1-2-6-5-2 | tira los 5 ★ → 5-2-2-6-2 | tira los 5 ★ → 4-3-4-5-4 | Baja · Escalera 1-5 | X |
| 32 | 1-4-3-2-3 | guarda 2-3-4 → 2-3-4-2-3 | tira los 5 ★ → 4-4-4-3-4 | Servida · Póker | 56 |
| 33 | 2-3-5-4-4 | guarda 2-3-4-5 → 2-3-4-5-1 |  | Sube · Escalera 1-5 | 20 |
| 34 | 5-5-3-1-2 | tira los 5 ★ → 2-1-1-4-6 | guarda 4-6 → 4-6-3-4-5 | Sube · 6 | 6 |
| 35 | 6-2-1-3-2 | tira los 5 ★ → 3-5-6-5-5 | guarda 5-5-5 → 5-5-5-2-1 | Sube · 5 | 15 |
| 36 | 5-6-3-5-5 | tira los 5 ★ → 6-2-5-3-5 | tira los 5 ★ → 3-6-5-2-1 | Sube · 4 | X |
| 37 | 3-1-4-2-1 | guarda 3 → 3-6-1-3-6 | guarda 3-3 → 3-3-2-6-6 | Sube · 3 | 6 |
| 38 | 1-5-3-3-5 | tira los 5 ★ → 1-3-3-2-3 | guarda 2 → 2-3-1-1-4 | Sube · 2 | 2 |
| 39 | 3-4-1-1-1 |  |  | Sube · 1 | 3 |
| 40 | 2-1-3-1-1 | tira los 5 ★ → 6-5-5-3-3 | guarda 3 → 3-4-5-6-6 | Baja · Escalera 2-6 | X |
| 41 | 6-5-1-4-3 | guarda 3-4-5-6 → 3-4-5-6-5 | guarda 3-4-5-6 → 3-4-5-6-2 | Desordenada · Escalera 2-6 | 20 |
| 42 | 5-4-4-6-1 | guarda 4-4-6 → 4-4-6-6-3 | guarda 4-4-6-6 → 4-4-6-6-5 | Desordenada · Escalera 1-5 | X |
| 43 | 6-3-4-3-3 | guarda 3-3-3-6 → 3-3-3-6-1 | guarda 1-3-3-3 → 1-3-3-3-6 | Servida · Escalera 1-5 | X |
| 44 | 6-4-1-3-6 | tira los 5 ★ → 3-3-6-1-3 | guarda 3-3-3-6 → 3-3-3-6-4 | Servida · Escalera 2-6 | X |
| 45 | 3-5-1-5-3 | guarda 3-3-5-5 → 3-3-5-5-2 | guarda 3-3-5-5 → 3-3-5-5-5 | Baja · Full | 45 |
| 46 | 1-6-1-2-5 | guarda 1-1 → 1-1-1-1-1 |  | Desordenada · Generala | 55 |
| 47 | 2-5-3-5-6 | guarda 5-5 → 5-5-6-3-1 | tira los 5 ★ → 4-5-2-3-4 | Servida · Full | X |
| 48 | 4-4-2-4-6 | guarda 4-4-4 → 4-4-4-2-2 | guarda 4-4-4 → 4-4-4-2-5 | Baja · Póker | X |
| 49 | 1-6-6-5-6 | guarda 5-6-6-6 → 5-6-6-6-5 |  | Baja · Menor | 28 |
| 50 | 4-3-2-2-1 |  |  | Baja · Mayor | X |
| 51 | 1-3-5-4-4 |  |  | Baja · Generala | X |
| 52 | 3-3-2-6-5 |  |  | Servida · Generala | X |

## Planilla final

| Categoría | Baja | Sube | Desordenada | Servida |
| --- | --- | --- | --- | --- |
| 1 | X | 3 | 1 | 3 |
| 2 | 2 | 2 | 4 | 4 |
| 3 | 6 | 6 | 12 | 6 |
| 4 | 12 | X | 8 | 8 |
| 5 | 10 | 15 | 20 | 10 |
| 6 | 12 | 6 | 18 | 12 |
| **Bonus** | **42** | **32** | **93** (63+30) | **43** |
| Escalera 1-5 | X | 20 | X | X |
| Escalera 2-6 | X | 20 | 20 | X |
| Full | 45 | 42 | 45 | X |
| Póker | X | 64 | 56 | 56 |
| Menor | 28 | 21 | 21 | 20 |
| Mayor | X | 25 | 26 | 25 |
| Generala | X | 75 | 55 | X |
| **Subtotal** | **115** | **299** | **316** | **144** |

**Total: 874**
