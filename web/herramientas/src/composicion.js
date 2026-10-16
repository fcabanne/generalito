// ─────────────────────────────────────────────────────────────
//  La composición ordenada ("knolling"): dónde va cada herramienta
//  cuando la caja está prolija. Coordenadas en cm sobre el piso, para
//  una pantalla vertical de 24 cm de ancho (x a la derecha, z hacia
//  abajo de la pantalla). giro: grados alrededor de la vertical; con
//  giro −90 el eje largo del objeto queda vertical en la pantalla y su
//  extremo −x (la punta de los lápices) arriba, como en la foto.
//  En horizontal se usa la misma composición rotada.
// ─────────────────────────────────────────────────────────────

export const ANCHO_CORTO = 24; // cm visibles en el lado corto de la pantalla

export const COMPOSICION = [
  { objeto: 'regla', variante: 'madera', x: -8.6, z: -1.5, giro: -90 },
  { objeto: 'lapiz', variante: 'rojo', x: -5.2, z: -8.5, giro: -90 },
  { objeto: 'lapiz', variante: 'verde', x: -4.0, z: -7.2, giro: -90 },
  { objeto: 'portaminas', variante: 'petroleo', x: -2.5, z: -10.2, giro: -90 },
  { objeto: 'pincel', variante: 'natural', x: -0.6, z: -8.0, giro: -90 },
  { objeto: 'lapiz-color', variante: 'petroleo', x: 1.4, z: -9.0, giro: -90 },
  { objeto: 'lapiz-color', variante: 'verde', x: 2.5, z: -8.6, giro: -90 },
  { objeto: 'lapiz-color', variante: 'mostaza', x: 3.6, z: -8.2, giro: -90 },
  { objeto: 'lapiz-color', variante: 'naranja', x: 4.7, z: -7.8, giro: -90 },
  { objeto: 'lapiz-color', variante: 'celeste', x: 5.8, z: -7.4, giro: -90 },
  { objeto: 'pincel', variante: 'verde', x: 8.6, z: -6.6, giro: -90 },
  { objeto: 'goma', variante: 'manga', x: 3.4, z: 8.2, giro: 0 },
  { objeto: 'goma', variante: 'rosa', x: 3.4, z: 12.2, giro: 0 },
  { objeto: 'sacapuntas', variante: 'rojo', x: 8.4, z: 8.4, giro: -90 },
  { objeto: 'sacapuntas', variante: 'metal', x: 8.4, z: 12.4, giro: -90 },
  { objeto: 'regla', variante: 'acero', x: 0.6, z: 19.5, giro: 0 },
];
