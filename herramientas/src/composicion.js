// ─────────────────────────────────────────────────────────────
//  La composición de la foto de referencia (flat-lay vertical): mismo
//  encuadre, misma escala, mismos lugares y la misma luz, con los
//  objetos que existen. Medidas tomadas de la foto con el largo del
//  lápiz rojo (18,5 cm) como escala.
//
//  Coordenadas en cm con el origen en el centro de la foto: x a la
//  derecha, z hacia abajo. En pantallas más angostas que la foto se
//  alinea el borde derecho (donde está la columna de útiles) y se
//  recorta papel de la izquierda.
//
//  giro: grados alrededor de la vertical. −90: eje largo vertical con
//  el extremo −x (la punta) arriba; 180: horizontal con la cola (goma
//  o capuchón) a la izquierda.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const ALTO_VISIBLE = 34;     // cm que entran en el alto de la pantalla
export const BORDE_ABAJO = 22.6;    // cm del centro de la foto a su borde de abajo
export const BORDE_DERECHO = 12.65; // cm del centro de la foto a su borde derecho

// Luz de la foto: de la izquierda y un poco de arriba, a unos 49° de altura.
export const LUZ = new THREE.Vector3(-0.88, 1.1, -0.36).normalize();

// La luz de la foto es más dura que la del estudio de los dados: sombras
// marrones muy oscuras pegadas a cada lápiz, que se abren hacia la derecha.
export const AMBIENTE = {
  fondo: 0xc5c7b1,           // el salvia de la foto, compensando la viñeta
  sombra: [0.19, 0.15, 0.1],  // color de la sombra plena (factor del piso)
  oclusion: 0.75,
  tamLuz: 0.05,
  intensidad: 2.0,
};

// La hoja crema de la tabla de dibujo (sólo el color del fondo, sin física).
export const PAPEL = {
  x1: 7.6,        // borde derecho
  z0: -11.55,     // borde de arriba
  r: 0.6,
  color: 0xdad0b6,
  pliegue: [2.8, -10.95, 0.16], // borde de la hoja de adelante: x fin, z, intensidad
};

export const COMPOSICION = [
  // los dos verticales sobre el papel: los únicos que se mueven (ruedan)
  { objeto: 'lapiz', variante: 'rojo', x: 4.09, z: 7.07, giro: -90, movil: true, rueda: 0.37 },
  { objeto: 'portaminas', variante: 'petroleo', x: 5.45, z: 6.78, giro: -90, movil: true },
  // la pila de abajo a la derecha, cortada por el borde (fija)
  { objeto: 'lapiz-color', variante: 'celeste', x: 7.28 + 8.75, z: 15.8, giro: 180 },
  { objeto: 'lapiz', variante: 'rojo', x: 7.31 + 9.25, z: 16.6, giro: 180 },
  { objeto: 'lapiz', variante: 'verde', x: 7.42 + 9.25, z: 17.4, giro: 180 },
  { objeto: 'lapiz-color', variante: 'mostaza', x: 7.77 + 8.75, z: 18.2, giro: 180 },
];
