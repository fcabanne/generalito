// ─────────────────────────────────────────────────────────────
//  La composición ordenada ("knolling"): dónde va cada herramienta
//  cuando la caja está prolija. Coordenadas en cm sobre el piso, para
//  una pantalla vertical de 24 cm de ancho (x a la derecha, z hacia
//  abajo de la pantalla). giro: grados alrededor de la vertical; con
//  giro −90 el eje largo queda vertical y el extremo −x (la punta de
//  los lápices) arriba, como en la foto; las reglas van con +90 para
//  que sus números se lean como en una regla apoyada.
//  En horizontal se usa la misma composición rotada.
//
//  Todo en fila con los mismos espacios y las puntas a la misma altura.
//  Pendientes de modelar: gomas, sacapuntas y pinceles.
// ─────────────────────────────────────────────────────────────

export const ANCHO_CORTO = 24; // cm visibles en el lado corto de la pantalla

const PUNTAS = -13; // z de la línea de las puntas

export const COMPOSICION = [
  { objeto: 'regla', variante: 'madera', x: -6.965, z: 0.5, giro: 90 },
  { objeto: 'lapiz', variante: 'rojo', x: -4.07, z: PUNTAS + 9.25, giro: -90 },
  { objeto: 'lapiz', variante: 'verde', x: -2.73, z: PUNTAS + 9.25, giro: -90 },
  { objeto: 'portaminas', variante: 'petroleo', x: -1.335, z: PUNTAS + 7.25, giro: -90 },
  { objeto: 'lapiz-color', variante: 'petroleo', x: 0.025, z: PUNTAS + 8.75, giro: -90 },
  { objeto: 'lapiz-color', variante: 'verde', x: 1.295, z: PUNTAS + 8.75, giro: -90 },
  { objeto: 'lapiz-color', variante: 'mostaza', x: 2.565, z: PUNTAS + 8.75, giro: -90 },
  { objeto: 'lapiz-color', variante: 'naranja', x: 3.835, z: PUNTAS + 8.75, giro: -90 },
  { objeto: 'lapiz-color', variante: 'celeste', x: 5.105, z: PUNTAS + 8.75, giro: -90 },
  { objeto: 'regla', variante: 'acero', x: 7.465, z: PUNTAS + 10.5, giro: 90 },
];
