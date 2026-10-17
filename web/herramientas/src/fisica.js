// ─────────────────────────────────────────────────────────────
//  Física de las herramientas de dibujo: cuerpos rígidos resueltos
//  con XPBD (Müller et al., "Detailed Rigid Body Simulation with
//  Extended Position Based Dynamics", 2020) con muchos substeps y una
//  sola iteración por substep. Es la física de los dados
//  (../../src/fisica.js) generalizada a cuerpos largos y distintos.
//
//  JS puro, sin three.js: se puede correr y testear en node.
//
//  Unidades: cm, g, s (la gravedad es 981 cm/s²). El piso es y = 0 y
//  el eje y apunta a la cámara. La caja son planos {n:[x,y,z], d} cuyo
//  interior cumple n·p >= d: piso, cuatro paredes y un techo de vidrio.
//
//  Cada cuerpo es una caja redondeada: un núcleo (caja de semiejes
//  `medias`, cualquiera puede ser 0) inflado `radio` en todas
//  direcciones. Un lápiz redondo es un segmento inflado (una cápsula),
//  una regla una placa inflada, una goma una caja con cantos redondos.
//
//  Contactos: esferas de muestra de A (centros sobre las esquinas y las
//  aristas del núcleo de A, de radio rA) contra la SDF del núcleo de B:
//  penetración = rA + rB − distancia(centro, núcleo de B). Contra los
//  planos alcanzan las esquinas: lo más hundido de una caja respecto de
//  un plano siempre es una esquina.
//
//  Lo que cambia respecto de los dados:
//  · inercia de caja maciza propia de cada cuerpo (tensor diagonal en el
//    marco local) y término giroscópico;
//  · fase amplia con cajas envolventes (AABB) en vez de esferas;
//  · fricción, rebote y rodadura por par de materiales;
//  · substeps extra en los golpes violentos y control del lado de llegada
//    (para que nada atraviese una regla de 2 mm);
//  · "anclas" en la fricción estática: sin ellas un cuerpo en reposo
//    camina por el sesgo del orden de resolución;
//  · sin resortes ni imán a una grilla: los cuerpos quedan donde caen.
//
//  Uso:
//    const m = new Mundo();              // opciones: ver el constructor
//    m.ponerCaja(24, 52, 9);              // o m.planos = [{n, d, tipo}, …]
//    const c = m.agregar({ medias, radio, masa, material, x, y, z, qx, qy, qz, qw });
//    m.aExt = [ax, ay, az];               // aceleración de la caja (cm/s²)
//    m.dedos = [{ o, d0, d1 }];           // rayos del dedo (inicio y fin del frame)
//    m.paso(dt);                          // y leer c.x…, c.q…, c.golpe…
//    c.cinematico = true;                 // y el integrador mueve c.x… y c.q…
// ─────────────────────────────────────────────────────────────

// ── materiales ──
// El piso es papel; las paredes, el cartón de la caja (también 'papel');
// el techo, un vidrio invisible.
export const MATERIALES = ['madera', 'metal', 'goma', 'plastico', 'papel', 'vidrio'];

// Por par: [fricción estática, fricción dinámica, rebote, rodadura (cm)].
// La rodadura es el brazo de la resistencia a la rodadura: el par que
// frena a un lápiz que rueda es rodadura · fuerza normal.
// La goma frena y casi no rebota; el metal desliza y rebota algo; la
// madera y el plástico quedan en el medio.
export const PARES = {
  'madera|papel': [0.5, 0.4, 0.55, 0.015],
  'metal|papel': [0.36, 0.28, 0.6, 0.008],
  'goma|papel': [0.95, 0.85, 0.1, 0.04],
  'plastico|papel': [0.42, 0.33, 0.32, 0.012],
  'madera|vidrio': [0.08, 0.06, 0.9, 0.006],
  'metal|vidrio': [0.06, 0.05, 0.92, 0.004],
  'goma|vidrio': [0.8, 0.7, 0.12, 0.03],
  'plastico|vidrio': [0.25, 0.2, 0.4, 0.005],
  'madera|madera': [0.45, 0.35, 0.38, 0.01],
  'madera|metal': [0.36, 0.28, 0.42, 0.008],
  'goma|madera': [0.85, 0.72, 0.12, 0.03],
  'madera|plastico': [0.4, 0.31, 0.38, 0.01],
  'metal|metal': [0.28, 0.2, 0.55, 0.004],
  'goma|metal': [0.8, 0.68, 0.12, 0.03],
  'metal|plastico': [0.3, 0.23, 0.45, 0.006],
  'goma|goma': [1.0, 0.9, 0.08, 0.04],
  'goma|plastico': [0.82, 0.7, 0.12, 0.03],
  'plastico|plastico': [0.35, 0.27, 0.42, 0.008],
};
const POR_DEFECTO = [0.4, 0.32, 0.3, 0.01];
const NM = MATERIALES.length;

function indiceMaterial(m) {
  const i = MATERIALES.indexOf(m);
  return i >= 0 ? i : 0; // desconocido → madera
}

// Tabla plana [NM × NM × 4] para buscar el par sin armar strings.
function tablaMateriales(extra = {}) {
  const T = new Float64Array(NM * NM * 4);
  for (let i = 0; i < NM; i++) for (let j = 0; j < NM; j++) {
    const a = MATERIALES[i], b = MATERIALES[j];
    const k1 = a < b ? `${a}|${b}` : `${b}|${a}`;
    const v = extra[k1] ?? extra[`${a}|${b}`] ?? extra[`${b}|${a}`] ?? PARES[k1] ?? POR_DEFECTO;
    T.set(v, (i * NM + j) * 4);
  }
  return T;
}

// Valores combinados de un par de materiales {muS, muD, e, rodadura}.
export function combinar(a, b, extra) {
  const T = extra ? tablaMateriales(extra) : TABLA;
  const o = (indiceMaterial(a) * NM + indiceMaterial(b)) * 4;
  return { muS: T[o], muD: T[o + 1], e: T[o + 2], rodadura: T[o + 3] };
}
const TABLA = tablaMateriales();

// ── geometría ──
// Separación máxima entre muestras de una arista: con esferas de radio r
// separadas s, la "costura" entre dos esferas vecinas se hunde
// r − √(r² − s²/4) ≈ 0,046 r para s = 0,6 r, y al cruzarse dos aristas
// (lápiz sobre lápiz) el error de penetración es ≈ s²/(8(rA+rB)) < 0,03 r.
export const SEPARACION_RELATIVA = 0.6;
export const SEPARACION_MAXIMA = 0.35; // cm

// Puntos de muestra del núcleo: esquinas (sin repetir cuando hay semiejes
// nulos) y puntos interiores de cada arista. No hace falta una grilla en
// las caras: el punto más hundido entre dos núcleos convexos siempre está
// sobre una esquina o una arista de alguno de los dos. Si dos caras se
// apoyan una en otra, la zona de contacto es un polígono convexo cuyo
// borde está hecho de tramos de aristas de A o de B, y esas aristas tienen
// muestras: la cara grande de una regla sobre una goma la sostienen las
// aristas de la goma, y la goma sobre la regla, sus propias esquinas.
//
// Devuelve {esquinas: Float64Array [x,y,z…], aristas: Float64Array
// [x0,y0,z0, eje, n, paso…] (6 por arista: arranca en (x0,y0,z0), avanza
// sobre el eje local `eje` y sus puntos interiores son k·paso, k = 1…n−1),
// paso}.
export function muestras(medias, radio) {
  const sep = Math.min(SEPARACION_RELATIVA * radio, SEPARACION_MAXIMA);
  const ejes = [0, 1, 2].filter((i) => medias[i] > 0);
  const k = ejes.length;
  const esquinas = [];
  for (let m = 0; m < (1 << k); m++) {
    const p = [0, 0, 0];
    for (let j = 0; j < k; j++) p[ejes[j]] = (m >> j) & 1 ? medias[ejes[j]] : -medias[ejes[j]];
    esquinas.push(p[0], p[1], p[2]);
  }
  const aristas = [];
  for (const i of ejes) {
    const otros = ejes.filter((j) => j !== i);
    const largo = 2 * medias[i];
    const n = Math.max(1, Math.ceil(largo / sep - 1e-9));
    if (n < 2) continue; // la arista es más corta que la separación: alcanzan las esquinas
    for (let m = 0; m < (1 << otros.length); m++) {
      const p = [0, 0, 0];
      p[i] = -medias[i];
      for (let j = 0; j < otros.length; j++) p[otros[j]] = (m >> j) & 1 ? medias[otros[j]] : -medias[otros[j]];
      aristas.push(p[0], p[1], p[2], i, n, largo / n);
    }
  }
  return { esquinas: new Float64Array(esquinas), aristas: new Float64Array(aristas), paso: sep };
}

// Todos los centros de muestra de un cuerpo en una lista [x,y,z…] (para
// tests y depuración; la física recorre las aristas sin armar esta lista).
export function listaMuestras(medias, radio) {
  const { esquinas, aristas } = muestras(medias, radio);
  const p = [...esquinas];
  for (let a = 0; a < aristas.length; a += 6) {
    const eje = aristas[a + 3], n = aristas[a + 4], s = aristas[a + 5];
    for (let k = 1; k < n; k++) {
      const q = [aristas[a], aristas[a + 1], aristas[a + 2]];
      q[eje] += k * s;
      p.push(q[0], q[1], q[2]);
    }
  }
  return p;
}

// Distancia con signo de un punto (coords locales) a la caja redondeada.
export function sdfCaja(px, py, pz, medias, radio) {
  const qx = Math.abs(px) - medias[0], qy = Math.abs(py) - medias[1], qz = Math.abs(pz) - medias[2];
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0), az = Math.max(qz, 0);
  return Math.hypot(ax, ay, az) + Math.min(Math.max(qx, qy, qz), 0) - radio;
}

// Inercia de una caja maciza con las medidas exteriores (núcleo + radio):
// tensor diagonal en el marco local, en g·cm².
export function inercia(medias, radio, masa) {
  const lx = 2 * (medias[0] + radio), ly = 2 * (medias[1] + radio), lz = 2 * (medias[2] + radio);
  return [masa * (ly * ly + lz * lz) / 12, masa * (lx * lx + lz * lz) / 12, masa * (lx * lx + ly * ly) / 12];
}

// Identificador único de cada cuerpo (entre todos los mundos): sirve de
// clave estable para el sonido y las anclas, aunque se quiten cuerpos.
let siguienteId = 1;

export class Cuerpo {
  constructor({ medias = [0, 0, 0], radio = 0.2, masa = 5, material = 'madera' } = {}) {
    if (!(radio > 0) || !(masa > 0)) throw new Error(`cuerpo inválido: radio ${radio} cm, masa ${masa} g (tienen que ser > 0)`);
    this.id = siguienteId++;
    this.medias = [Math.max(0, medias[0]), Math.max(0, medias[1]), Math.max(0, medias[2])];
    this.radio = radio;
    this.masa = masa;
    this.material = material;
    this.mat = indiceMaterial(material);
    this.x = 0; this.y = 0; this.z = 0;
    this.qx = 0; this.qy = 0; this.qz = 0; this.qw = 1;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.wx = 0; this.wy = 0; this.wz = 0;
    // pose al empezar el substep (para velocidades y fricción estática)
    this.px = 0; this.py = 0; this.pz = 0;
    this.pqx = 0; this.pqy = 0; this.pqz = 0; this.pqw = 1;
    // pose al terminar el último paso (para interpolar a los cinemáticos)
    this.ex = 0; this.ey = 0; this.ez = 0;
    this.eqx = 0; this.eqy = 0; this.eqz = 0; this.eqw = 1;
    // pose objetivo de un cinemático durante el paso
    this.kx = 0; this.ky = 0; this.kz = 0;
    this.kqx = 0; this.kqy = 0; this.kqz = 0; this.kqw = 1;
    this.dormido = false;
    this.cinematico = false;
    this._cin = false;      // si fue cinemático en el paso anterior
    this.quieto = 0;        // segundos seguidos casi sin moverse
    this.apoyado = false;   // tocó algo en el último paso
    this.tocado = 0;        // segundos que el dedo lo mantiene despierto
    this.golpe = 0;         // velocidad del golpe más fuerte del paso (cm/s, para sonido; 0 si no hubo)
    this.golpeContra = null;   // 'piso' (piso, pared o techo) | 'cuerpo'
    this.golpeMaterial = null; // material de lo que golpeó
    // masa e inercia (marco local, diagonal)
    this.invM = 1 / masa;
    const I = inercia(this.medias, radio, masa);
    this.Ix = I[0]; this.Iy = I[1]; this.Iz = I[2];
    this.iIx = 1 / I[0]; this.iIy = 1 / I[1]; this.iIz = 1 / I[2];
    // radio de la esfera envolvente (desde el centro)
    this.ext = Math.hypot(this.medias[0], this.medias[1], this.medias[2]) + radio;
    const m = muestras(this.medias, radio);
    this.esquinas = m.esquinas;
    this.aristas = m.aristas;
    // índice de cada muestra: esquinas 0…nE−1, después los puntos interiores
    // de cada arista en orden (para reconocer un contacto de un substep al otro)
    const nE = m.esquinas.length / 3;
    this.baseArista = new Int32Array(m.aristas.length / 6);
    let j = nE;
    for (let a = 0; a < m.aristas.length; a += 6) { this.baseArista[a / 6] = j - 1; j += m.aristas[a + 4] - 1; }
    this.nMuestras = j;
    // deslizamiento residual de los contactos pegados (ver _anclas)
    this.anclasPlanos = null;
    this.anclasPares = new Map();
    // caja envolvente alineada a los ejes del mundo (fase amplia)
    this.min = new Float64Array(3);
    this.max = new Float64Array(3);
    // matriz de rotación e I⁻¹ en mundo, para la pasada de velocidades
    this.M = new Float64Array(9);
    this.J = new Float64Array(6);
    this.rapidez = 0;   // cota de la velocidad del punto más rápido en el paso (cm/s)
    this.velocidad = 0; // velocidad del punto más rápido al empezar el paso (cm/s)
  }
}

// Contacto reutilizable (pool) para no generar basura en el bucle.
class Contacto {
  constructor() {
    this.a = null; this.b = null;
    this.nx = 0; this.ny = 0; this.nz = 0;
    this.ax = 0; this.ay = 0; this.az = 0; // punto en A, coords locales de A
    this.bx = 0; this.by = 0; this.bz = 0; // punto en B, coords locales de B
    this.lambda = 0;
    this.vnPre = 0;
    this.muS = 0; this.muD = 0; this.e = 0; this.rod = 0;
    this.arr = null; this.slot = 0; // dónde se guarda su deslizamiento residual
    this.pegado = false;            // si la fricción estática lo sostuvo
  }
}

// ── cuaterniones (sin alocar: escriben en un arreglo de salida) ──
const tmp = new Float64Array(12);
const tw = new Float64Array(6); // aparte, para las cuentas de inercia

function rotar(c, vx, vy, vz, out, o) {
  const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

function rotarPrev(c, vx, vy, vz, out, o) {
  const qx = c.pqx, qy = c.pqy, qz = c.pqz, qw = c.pqw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

function rotarInv(c, vx, vy, vz, out, o) {
  const qx = -c.qx, qy = -c.qy, qz = -c.qz, qw = c.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

function rotarInvPrev(c, vx, vy, vz, out, o) {
  const qx = -c.pqx, qy = -c.pqy, qz = -c.pqz, qw = c.pqw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

// I⁻¹ en coords de mundo aplicado a v: R · diag(I⁻¹) · Rᵀ · v → tw[0..2]
function invIMundo(c, vx, vy, vz) {
  rotarInv(c, vx, vy, vz, tw, 3);
  rotar(c, tw[3] * c.iIx, tw[4] * c.iIy, tw[5] * c.iIz, tw, 0);
}

// Matriz de rotación del cuerpo, por filas, en m[o..o+8].
function matriz(c, m, o) {
  const x = c.qx, y = c.qy, z = c.qz, w = c.qw;
  m[o] = 1 - 2 * (y * y + z * z); m[o + 1] = 2 * (x * y - z * w); m[o + 2] = 2 * (x * z + y * w);
  m[o + 3] = 2 * (x * y + z * w); m[o + 4] = 1 - 2 * (x * x + z * z); m[o + 5] = 2 * (y * z - x * w);
  m[o + 6] = 2 * (x * z - y * w); m[o + 7] = 2 * (y * z + x * w); m[o + 8] = 1 - 2 * (x * x + y * y);
}

function normalizarQ(c) {
  const l2 = c.qx * c.qx + c.qy * c.qy + c.qz * c.qz + c.qw * c.qw;
  if (l2 > 0) { const k = 1 / Math.sqrt(l2); c.qx *= k; c.qy *= k; c.qz *= k; c.qw *= k; }
}

function guardarPrevia(c) {
  c.px = c.x; c.py = c.y; c.pz = c.z;
  c.pqx = c.qx; c.pqy = c.qy; c.pqz = c.qz; c.pqw = c.qw;
}

// Caja envolvente de un cuerpo en su pose actual, inflada `margen`.
function cajaEnvolvente(c, margen, m) {
  matriz(c, m, 0);
  const hx = c.medias[0], hy = c.medias[1], hz = c.medias[2], r = c.radio + margen;
  const ex = Math.abs(m[0]) * hx + Math.abs(m[1]) * hy + Math.abs(m[2]) * hz + r;
  const ey = Math.abs(m[3]) * hx + Math.abs(m[4]) * hy + Math.abs(m[5]) * hz + r;
  const ez = Math.abs(m[6]) * hx + Math.abs(m[7]) * hy + Math.abs(m[8]) * hz + r;
  c.min[0] = c.x - ex; c.min[1] = c.y - ey; c.min[2] = c.z - ez;
  c.max[0] = c.x + ex; c.max[1] = c.y + ey; c.max[2] = c.z + ez;
}

export class Mundo {
  constructor(p = {}) {
    this.g = p.g ?? 981;
    this.substepMax = Math.min(p.substepMax ?? 1 / 600, 1 / 600);
    this.aire = p.aire ?? 0.1;               // arrastre lineal muy leve (1/s)
    this.aireAngular = p.aireAngular ?? 0.2; // ídem para el giro (1/s)
    this.vMax = p.vMax ?? 350;               // tope de velocidad de cualquier punto (cm/s)
    this.umbralDormir = p.umbralDormir ?? 1.2;   // cm/s: velocidad del punto más rápido
    this.tiempoDormir = p.tiempoDormir ?? 0.3;   // s quieto para dormirse
    this.umbralSacudida = p.umbralSacudida ?? 150; // cm/s²: una sacudida así despierta a todos
    this.umbralDespertar = p.umbralDespertar ?? 3; // cm/s: un vecino así de rápido despierta
    this.giroRodadura = p.giroRodadura ?? 2;       // rad/s: debajo de esto la rodadura frena menos
    this.substepsExtra = p.substepsExtra ?? 4;     // tope de substeps en un golpe violento (× el mínimo)…
    this.substepsTope = p.substepsTope ?? 40;      // …y en total por paso (si no, un frame lento se encadena)
    this.substeps = 0;                             // substeps del último paso
    this._nSub = 0;                                // contador global de substeps
    this._golpeMin = 0;
    this.tabla = p.materiales ? tablaMateriales(p.materiales) : TABLA;
    this.cuerpos = [];
    // planos {n:[x,y,z], d, tipo?, material?}: el interior cumple n·p >= d
    const alto = p.alto ?? 9;
    this.planos = [
      { n: [0, 1, 0], d: 0, tipo: 'piso' },
      { n: [0, -1, 0], d: -alto, tipo: 'techo' },
    ];
    this.aExt = [0, 0, 0];   // aceleración de la caja (cm/s²); los cuerpos sienten −aExt
    this.dedos = [];         // [{o:[3], d0:[3], d1:[3]}] rayos del dedo al inicio y fin del frame
    this.contactos = [];
    this.nContactos = 0;
    this.pares = [];
    this.tiempo = 0;
    this._pl = new Float64Array(40); // planos preparados: nx, ny, nz, d, material
    this._nPl = 0;
    this._rel = new Float64Array(12);
    this._mats = new Float64Array(18);
    this._m9 = new Float64Array(9);
  }

  // Caja centrada en el origen: ancho en x, largo en z, alto en y.
  ponerCaja(ancho, largo, alto = 9) {
    this.planos = [
      { n: [0, 1, 0], d: 0, tipo: 'piso' },
      { n: [1, 0, 0], d: -ancho / 2, tipo: 'pared' },
      { n: [-1, 0, 0], d: -ancho / 2, tipo: 'pared' },
      { n: [0, 0, 1], d: -largo / 2, tipo: 'pared' },
      { n: [0, 0, -1], d: -largo / 2, tipo: 'pared' },
      { n: [0, -1, 0], d: -alto, tipo: 'techo' },
    ];
  }

  agregar({ medias, radio, masa, material, x = 0, y, z = 0, qx = 0, qy = 0, qz = 0, qw = 1 } = {}) {
    const c = new Cuerpo({ medias, radio, masa, material });
    c.x = x; c.y = y ?? c.medias[1] + c.radio; c.z = z;
    c.qx = qx; c.qy = qy; c.qz = qz; c.qw = qw;
    normalizarQ(c);
    guardarPrevia(c);
    c.ex = c.x; c.ey = c.y; c.ez = c.z;
    c.eqx = c.qx; c.eqy = c.qy; c.eqz = c.qz; c.eqw = c.qw;
    this.cuerpos.push(c);
    return c;
  }

  quitar(c) {
    const i = this.cuerpos.indexOf(c);
    if (i >= 0) this.cuerpos.splice(i, 1);
    for (const o of this.cuerpos) o.anclasPares.delete(c.id);
    this.despertarTodos(); // alguno podía estar apoyado en él
  }

  despertar(c) {
    if (!c.dormido) return;
    c.dormido = false;
    c.quieto = 0;
  }

  despertarTodos() {
    for (const c of this.cuerpos) this.despertar(c);
  }

  // ── impulsos ──
  // Impulso J (mundo, g·cm/s) aplicado en el punto P (mundo).
  impulso(c, Px, Py, Pz, Jx, Jy, Jz) {
    if (c.cinematico) return;
    this.despertar(c);
    const rx = Px - c.x, ry = Py - c.y, rz = Pz - c.z;
    c.vx += Jx * c.invM; c.vy += Jy * c.invM; c.vz += Jz * c.invM;
    invIMundo(c, ry * Jz - rz * Jy, rz * Jx - rx * Jz, rx * Jy - ry * Jx);
    c.wx += tw[0]; c.wy += tw[1]; c.wz += tw[2];
  }

  // ── consultas ──
  // Rayo (dirección cualquiera, se normaliza) contra cada cuerpo, inflado
  // `margen`. Devuelve {cuerpo, t, x, y, z} con el primer toque, o null.
  rayo(ox, oy, oz, dx, dy, dz, margen = 0) {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let mejor = null, tMejor = Infinity;
    for (const c of this.cuerpos) {
      // descarte rápido por esfera envolvente
      const cx = c.x - ox, cy = c.y - oy, cz = c.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      const R = c.ext + margen;
      if (tc < -R) continue;
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (d2 > R * R) continue;
      rotarInv(c, -cx, -cy, -cz, tmp, 0);
      const lox = tmp[0], loy = tmp[1], loz = tmp[2];
      rotarInv(c, dx, dy, dz, tmp, 3);
      const ldx = tmp[3], ldy = tmp[4], ldz = tmp[5];
      // tramo dentro de la caja exterior
      const rr = c.radio + margen;
      let t0 = 0, t1 = tMejor;
      let ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        const o = i === 0 ? lox : i === 1 ? loy : loz;
        const v = i === 0 ? ldx : i === 1 ? ldy : ldz;
        const e = c.medias[i] + rr;
        if (Math.abs(v) < 1e-12) { if (o < -e || o > e) ok = false; continue; }
        let ta = (-e - o) / v, tb = (e - o) / v;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
      if (!ok) continue;
      // y adentro, avanzar por la SDF hasta la superficie redondeada
      let t = t0, toca = false;
      for (let it = 0; it < 48 && t <= t1; it++) {
        const s = sdfCaja(lox + ldx * t, loy + ldy * t, loz + ldz * t, c.medias, rr);
        if (s < 1e-4) { toca = true; break; }
        t += s;
      }
      if (toca && t < tMejor) { tMejor = t; mejor = c; }
    }
    if (!mejor) return null;
    return { cuerpo: mejor, t: tMejor, x: ox + dx * tMejor, y: oy + dy * tMejor, z: oz + dz * tMejor };
  }

  // ── paso de simulación ──
  paso(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 30);
    this._prepararPlanos();
    const a = this.aExt;
    if (a[0] * a[0] + a[1] * a[1] + a[2] * a[2] > this.umbralSacudida * this.umbralSacudida) this.despertarTodos();
    for (const c of this.cuerpos) {
      c.golpe = 0; c.golpeContra = null; c.golpeMaterial = null; c.apoyado = false;
      if (c.cinematico) {
        // va de la pose del final del paso anterior a la que le puso el integrador
        c.dormido = false;
        c.kx = c.x; c.ky = c.y; c.kz = c.z;
        let s = 1;
        if (c.qx * c.eqx + c.qy * c.eqy + c.qz * c.eqz + c.qw * c.eqw < 0) s = -1;
        c.kqx = c.qx * s; c.kqy = c.qy * s; c.kqz = c.qz * s; c.kqw = c.qw * s;
        c.x = c.ex; c.y = c.ey; c.z = c.ez;
        c.qx = c.eqx; c.qy = c.eqy; c.qz = c.eqz; c.qw = c.eqw;
        guardarPrevia(c);
        c._cin = true;
      } else if (c._cin) {
        // dejó de ser cinemático: sigue con la velocidad que traía
        c._cin = false;
        c.dormido = false; c.quieto = 0;
        guardarPrevia(c);
      }
    }
    this._amplia(dt);
    // Substeps: al menos dt / substepMax. En un golpe violento, más: entre
    // dos cuerpos que se acercan a velocidad v, una muestra avanza v·h por
    // substep y no puede cruzar más de 1,5 (rA + rB) de una vez (con el
    // control del lado de llegada, ver _muestra, alcanzaría con 2).
    const n0 = Math.max(1, Math.ceil(dt / this.substepMax - 1e-9));
    let n = n0;
    const P = this.pares;
    for (let i = 0; i < P.length; i += 2) {
      const A = P[i], B = P[i + 1];
      const k = Math.ceil(dt * (A.rapidez + B.rapidez) / (1.5 * (A.radio + B.radio)) - 1e-9);
      if (k > n) n = k;
    }
    const nMax = Math.max(n0, Math.min(n0 * this.substepsExtra, this.substepsTope));
    if (n > nMax) n = nMax;
    this.substeps = n;
    const h = dt / n;
    for (let i = 0; i < n; i++) this._substep(h, (i + 1) / n, dt);
    for (const c of this.cuerpos) {
      if (c.cinematico) {
        // velocidad media del frame (la usa el que lo suelte)
        c.vx = (c.kx - c.ex) / dt; c.vy = (c.ky - c.ey) / dt; c.vz = (c.kz - c.ez) / dt;
        this._velocidadAngular(c, c.eqx, c.eqy, c.eqz, c.eqw, 1 / dt);
      }
    }
    this._dormir(dt);
    for (const c of this.cuerpos) {
      c.ex = c.x; c.ey = c.y; c.ez = c.z;
      c.eqx = c.qx; c.eqy = c.qy; c.eqz = c.qz; c.eqw = c.qw;
    }
    this.tiempo += dt;
  }

  // ω a partir de q · q0⁻¹, escalado por `ih` (1/tiempo).
  _velocidadAngular(c, px, py, pz, pw, ih) {
    const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
    px = -px; py = -py; pz = -pz;
    let dx = qw * px + qx * pw + qy * pz - qz * py;
    let dy = qw * py + qy * pw + qz * px - qx * pz;
    let dz = qw * pz + qz * pw + qx * py - qy * px;
    const dw = qw * pw - qx * px - qy * py - qz * pz;
    if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; }
    c.wx = 2 * dx * ih; c.wy = 2 * dy * ih; c.wz = 2 * dz * ih;
  }

  _prepararPlanos() {
    const P = this.planos;
    if (this._pl.length < P.length * 5) this._pl = new Float64Array(P.length * 5 + 20);
    const F = this._pl;
    for (let i = 0; i < P.length; i++) {
      const pl = P[i];
      let nx, ny, nz;
      if (pl.n) { nx = pl.n[0]; ny = pl.n[1]; nz = pl.n[2]; } else { nx = pl.nx; ny = pl.ny; nz = pl.nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      F[i * 5] = nx / l; F[i * 5 + 1] = ny / l; F[i * 5 + 2] = nz / l; F[i * 5 + 3] = pl.d / l;
      // material: el que diga el plano; si no, papel abajo y en las paredes, vidrio arriba
      let m = pl.material ? MATERIALES.indexOf(pl.material) : -1;
      if (m < 0) m = pl.tipo === 'techo' || ny / l < -0.7 ? 5 : 4;
      F[i * 5 + 4] = m;
    }
    this._nPl = P.length;
  }

  // Fase amplia: cajas envolventes alineadas a los ejes, infladas con lo
  // que cada cuerpo puede moverse durante el paso.
  _amplia(dt) {
    const L = this.cuerpos;
    const aE = Math.hypot(this.aExt[0], this.aExt[1], this.aExt[2]);
    const m9 = this._m9;
    for (const c of L) {
      c.rapidez = 0; c.velocidad = 0;
      if (c.dormido) { cajaEnvolvente(c, 0.02, m9); continue; }
      if (c.cinematico) {
        c.rapidez = c.velocidad = Math.hypot(c.kx - c.x, c.ky - c.y, c.kz - c.z) / dt +
          2 * Math.acos(Math.min(1, Math.abs(c.kqx * c.qx + c.kqy * c.qy + c.kqz * c.qz + c.kqw * c.qw))) * c.ext / dt;
        // une la caja al principio y al final del recorrido del frame
        cajaEnvolvente(c, 0.02, m9);
        const x0 = c.min[0], y0 = c.min[1], z0 = c.min[2], x1 = c.max[0], y1 = c.max[1], z1 = c.max[2];
        const sx = c.x, sy = c.y, sz = c.z, sqx = c.qx, sqy = c.qy, sqz = c.qz, sqw = c.qw;
        c.x = c.kx; c.y = c.ky; c.z = c.kz; c.qx = c.kqx; c.qy = c.kqy; c.qz = c.kqz; c.qw = c.kqw;
        cajaEnvolvente(c, 0.02, m9);
        c.x = sx; c.y = sy; c.z = sz; c.qx = sqx; c.qy = sqy; c.qz = sqz; c.qw = sqw;
        c.min[0] = Math.min(c.min[0], x0); c.min[1] = Math.min(c.min[1], y0); c.min[2] = Math.min(c.min[2], z0);
        c.max[0] = Math.max(c.max[0], x1); c.max[1] = Math.max(c.max[1], y1); c.max[2] = Math.max(c.max[2], z1);
        continue;
      }
      // velocidad del punto más rápido (para despertar vecinos y contar
      // substeps) y lo que puede ganar en promedio durante el paso
      const v = Math.sqrt(c.vx * c.vx + c.vy * c.vy + c.vz * c.vz) + this._giroPunta(c, c.wx, c.wy, c.wz);
      c.velocidad = v;
      c.rapidez = v + 0.5 * (this.g + aE) * dt;
      cajaEnvolvente(c, v * dt + 0.5 * (this.g + aE) * dt * dt + 0.03, m9);
    }
    const pares = this.pares;
    pares.length = 0;
    for (let i = 0; i < L.length; i++) {
      const A = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const B = L[j];
        const fijoA = A.dormido || A.cinematico, fijoB = B.dormido || B.cinematico;
        if (fijoA && fijoB && !(A.cinematico !== B.cinematico && (A.dormido || B.dormido))) continue;
        if (A.max[0] < B.min[0] || B.max[0] < A.min[0]) continue;
        if (A.max[1] < B.min[1] || B.max[1] < A.min[1]) continue;
        if (A.max[2] < B.min[2] || B.max[2] < A.min[2]) continue;
        // un vecino que se mueve rápido despierta al que duerme
        if (A.dormido) this._despertarSiRapido(A, B);
        else if (B.dormido) this._despertarSiRapido(B, A);
        if (A.cinematico && B.cinematico) continue;
        if ((A.dormido || A.cinematico) && (B.dormido || B.cinematico)) continue;
        pares.push(A, B);
      }
    }
  }

  // (un cinemático que se mueve, aunque sea despacio, despierta a lo que toca)
  _despertarSiRapido(dormido, otro) {
    if (otro.velocidad > (otro.cinematico ? 0.01 : this.umbralDespertar)) this.despertar(dormido);
  }

  _contacto() {
    if (this.nContactos >= this.contactos.length) this.contactos.push(new Contacto());
    return this.contactos[this.nContactos++];
  }

  _substep(h, frac, dtFrame) {
    const g = this.g;
    const fx = -this.aExt[0], fy = -this.aExt[1] - g, fz = -this.aExt[2];
    const L = this.cuerpos;
    const ar = this.aire, arW = 1 - this.aireAngular * h;
    // 1. integrar
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (c.cinematico) { this._moverCinematico(c, frac); continue; }
      if (c.dormido) continue;
      guardarPrevia(c);
      c.vx += (fx - ar * c.vx) * h; c.vy += (fy - ar * c.vy) * h; c.vz += (fz - ar * c.vz) * h;
      c.x += c.vx * h; c.y += c.vy * h; c.z += c.vz * h;
      // giro: ω += h I⁻¹ (τ − ω × Iω), en coords locales (τ = 0: la gravedad
      // y la sacudida actúan en el centro de masa). El término giroscópico
      // no cambia la energía de rotación: se reescala para conservarla.
      let wx = c.wx * arW, wy = c.wy * arW, wz = c.wz * arW;
      const w2 = wx * wx + wy * wy + wz * wz;
      if (w2 > 1e-10) {
        rotarInv(c, wx, wy, wz, tw, 0);
        let lx = tw[0], ly = tw[1], lz = tw[2];
        const Lx = c.Ix * lx, Ly = c.Iy * ly, Lz = c.Iz * lz;
        const E0 = lx * Lx + ly * Ly + lz * Lz;
        const gx = ly * Lz - lz * Ly, gy = lz * Lx - lx * Lz, gz = lx * Ly - ly * Lx;
        lx -= h * c.iIx * gx; ly -= h * c.iIy * gy; lz -= h * c.iIz * gz;
        const E1 = c.Ix * lx * lx + c.Iy * ly * ly + c.Iz * lz * lz;
        const s = E1 > 1e-14 ? Math.sqrt(E0 / E1) : 1;
        rotar(c, lx * s, ly * s, lz * s, tw, 0);
        wx = tw[0]; wy = tw[1]; wz = tw[2];
      }
      c.wx = wx; c.wy = wy; c.wz = wz;
      const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
      const s = 0.5 * h;
      c.qx += s * (wx * qw + wy * qz - wz * qy);
      c.qy += s * (wy * qw + wz * qx - wx * qz);
      c.qz += s * (wz * qw + wx * qy - wy * qx);
      c.qw += s * (-wx * qx - wy * qy - wz * qz);
      normalizarQ(c);
    }

    // 2. resolver posiciones (detección + corrección en el mismo recorrido)
    this._nSub++;
    // un contacto en reposo llega con la gravedad de un substep (g·h): eso
    // no es un golpe
    this._golpeMin = 3 * g * h;
    this.nContactos = 0;
    // Con una sola iteración, lo que se resuelve último queda exacto. Los
    // planos van primero: así un cuerpo que cae sobre otro apoyado no lo
    // hunde en el piso y una pila en reposo queda sin penetración. Después
    // de los pares, otra pasada solo con las paredes y el techo, para que la
    // caja tenga la última palabra: si no, un lápiz apretado contra la pared
    // por los demás en una sacudida de 2,5 g la atraviesa un poco. (El piso
    // no se repite: hundirse un poco en él no se ve desde arriba y repetirlo
    // empuja al de abajo de una pila contra el de arriba.)
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (!c.dormido && !c.cinematico) this._contactosPlanos(c, false);
    }
    // Entre cuerpos, en un orden fijo: alternarlo en cada substep deja un
    // vaivén de período 2 (dos soluciones que se turnan) que no deja dormir
    // a dos reglas cruzadas y las hace caminar.
    const P = this.pares;
    for (let i = 0; i < P.length; i += 2) {
      const A = P[i], B = P[i + 1];
      if ((A.dormido || A.cinematico) && (B.dormido || B.cinematico)) continue;
      this._contactosPar(A, B);
      this._contactosPar(B, A);
    }
    if (P.length) {
      for (let i = 0; i < L.length; i++) {
        const c = L[i];
        if (!c.dormido && !c.cinematico) this._contactosPlanos(c, true);
      }
    }
    this._anclas();

    // 3. velocidades a partir de las posiciones
    const ih = 1 / h, vMax = this.vMax;
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (c.dormido) continue;
      c.vx = (c.x - c.px) * ih; c.vy = (c.y - c.py) * ih; c.vz = (c.z - c.pz) * ih;
      this._velocidadAngular(c, c.pqx, c.pqy, c.pqz, c.pqw, ih);
      if (c.cinematico) continue;
      // tope de seguridad: ningún punto más rápido que vMax
      const v2 = c.vx * c.vx + c.vy * c.vy + c.vz * c.vz;
      if (v2 > vMax * vMax) { const k = vMax / Math.sqrt(v2); c.vx *= k; c.vy *= k; c.vz *= k; }
      if ((c.wx * c.wx + c.wy * c.wy + c.wz * c.wz) * c.ext * c.ext > vMax * vMax) {
        const w = this._giroPunta(c, c.wx, c.wy, c.wz);
        if (w > vMax) { const k = vMax / w; c.wx *= k; c.wy *= k; c.wz *= k; }
      }
    }

    // 4. resolver velocidades: rebote, fricción dinámica y rodadura
    if (this.nContactos) {
      this._matrices();
      for (let i = 0; i < this.nContactos; i++) this._velocidadContacto(this.contactos[i], h);
    }

    // 5. el dedo arrastra por fricción el punto que toca
    if (this.dedos.length) this._dedos(h, frac, dtFrame);
  }

  _moverCinematico(c, frac) {
    guardarPrevia(c);
    const x0 = c.ex, y0 = c.ey, z0 = c.ez;
    c.x = x0 + (c.kx - x0) * frac; c.y = y0 + (c.ky - y0) * frac; c.z = z0 + (c.kz - z0) * frac;
    // nlerp alcanza: el recorrido de un frame es chico
    c.qx = c.eqx + (c.kqx - c.eqx) * frac; c.qy = c.eqy + (c.kqy - c.eqy) * frac;
    c.qz = c.eqz + (c.kqz - c.eqz) * frac; c.qw = c.eqw + (c.kqw - c.eqw) * frac;
    normalizarQ(c);
  }

  // Esquinas contra los planos, en orden fijo. (Resolverlas de la más
  // hundida a la menos, como en los dados, hace que un cuerpo de base
  // angosta como el lápiz hexagonal se meza de un lado al otro en cada
  // substep; el sesgo que deja el orden fijo lo corrigen las anclas de la
  // fricción estática.) `soloParedes`: la segunda pasada, sin el piso.
  _contactosPlanos(c, soloParedes) {
    const r = c.radio;
    const E = c.esquinas, nE = E.length / 3;
    const F = this._pl;
    for (let p = 0; p < this._nPl; p++) {
      const o = p * 5;
      const nx = F[o], ny = F[o + 1], nz = F[o + 2], d = F[o + 3];
      if (soloParedes && ny > 0.7) continue;
      // descarte rápido: el centro está lejos del plano
      if (nx * c.x + ny * c.y + nz * c.z - d > c.ext) continue;
      const mat = F[o + 4];
      const T = this.tabla, to = (c.mat * NM + mat) * 4;
      for (let k = 0; k < nE; k++) {
        const k3 = k * 3;
        rotar(c, E[k3], E[k3 + 1], E[k3 + 2], tmp, 0);
        const pen = r - (nx * (c.x + tmp[0]) + ny * (c.y + tmp[1]) + nz * (c.z + tmp[2]) - d);
        if (pen <= 0) continue;
        if (!c.anclasPlanos || c.anclasPlanos.length < this._nPl * nE * 4) c.anclasPlanos = new Float64Array(this._nPl * nE * 4).fill(-10);
        // punto de contacto en la superficie del cuerpo, en coords locales
        rotarInv(c, nx, ny, nz, tmp, 3);
        const cn = this._contacto();
        cn.a = c; cn.b = null;
        cn.arr = c.anclasPlanos; cn.slot = p * nE + k;
        cn.nx = nx; cn.ny = ny; cn.nz = nz;
        cn.ax = E[k3] - tmp[3] * r; cn.ay = E[k3 + 1] - tmp[4] * r; cn.az = E[k3 + 2] - tmp[5] * r;
        cn.muS = T[to]; cn.muD = T[to + 1]; cn.e = T[to + 2]; cn.rod = T[to + 3];
        // velocidad normal antes de corregir (para el rebote)
        rotar(c, cn.ax, cn.ay, cn.az, tmp, 6);
        const rx = tmp[6], ry = tmp[7], rz = tmp[8];
        const vcx = c.vx + c.wy * rz - c.wz * ry;
        const vcy = c.vy + c.wz * rx - c.wx * rz;
        const vcz = c.vz + c.wx * ry - c.wy * rx;
        cn.vnPre = vcx * nx + vcy * ny + vcz * nz;
        cn.lambda = this._corregir(c, rx, ry, rz, null, 0, 0, 0, nx, ny, nz, pen);
        this._friccionEstatica(cn);
        c.apoyado = true;
        if (-cn.vnPre > c.golpe && -cn.vnPre > this._golpeMin) { c.golpe = -cn.vnPre; c.golpeContra = 'piso'; c.golpeMaterial = MATERIALES[mat]; }
      }
    }
  }

  // Esferas de muestra de A (esquinas y aristas de su núcleo, radio rA)
  // contra la caja redondeada de B.
  _contactosPar(A, B) {
    const R = this._rel;
    this._relativa(A, B, R);
    const hB = B.medias;
    const lim = A.radio + B.radio;
    const ex = hB[0] + lim, ey = hB[1] + lim, ez = hB[2] + lim;
    // descarte rápido: el centro de A en coords de B, lejos de la caja de B
    const ea = A.ext - A.radio;
    if (Math.abs(R[9]) - ea > ex || Math.abs(R[10]) - ea > ey || Math.abs(R[11]) - ea > ez) return;
    let arr = A.anclasPares.get(B.id);
    if (!arr) { arr = new Float64Array(A.nMuestras * 4).fill(-10); A.anclasPares.set(B.id, arr); }
    this._arrPar = arr;
    const E = A.esquinas;
    for (let k = 0; k < E.length; k += 3) this._muestra(A, B, E[k], E[k + 1], E[k + 2], R, lim, k / 3);
    const Ar = A.aristas;
    for (let a = 0; a < Ar.length; a += 6) {
      const x0 = Ar[a], y0 = Ar[a + 1], z0 = Ar[a + 2], eje = Ar[a + 3], n = Ar[a + 4], s = Ar[a + 5];
      // la arista en coords de B: S + D·u, u ∈ [0, n·s]; se recorta contra
      // la caja de B inflada (rechazo temprano: solo se miran las muestras
      // que pueden tocar)
      const Sx = R[0] * x0 + R[1] * y0 + R[2] * z0 + R[9];
      const Sy = R[3] * x0 + R[4] * y0 + R[5] * z0 + R[10];
      const Sz = R[6] * x0 + R[7] * y0 + R[8] * z0 + R[11];
      const Dx = R[eje], Dy = R[3 + eje], Dz = R[6 + eje];
      let u0 = 0, u1 = n * s;
      if (Math.abs(Dx) < 1e-12) { if (Sx < -ex || Sx > ex) continue; }
      else {
        let ta = (-ex - Sx) / Dx, tb = (ex - Sx) / Dx;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > u0) u0 = ta;
        if (tb < u1) u1 = tb;
      }
      if (Math.abs(Dy) < 1e-12) { if (Sy < -ey || Sy > ey) continue; }
      else {
        let ta = (-ey - Sy) / Dy, tb = (ey - Sy) / Dy;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > u0) u0 = ta;
        if (tb < u1) u1 = tb;
      }
      if (Math.abs(Dz) < 1e-12) { if (Sz < -ez || Sz > ez) continue; }
      else {
        let ta = (-ez - Sz) / Dz, tb = (ez - Sz) / Dz;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > u0) u0 = ta;
        if (tb < u1) u1 = tb;
      }
      if (u0 > u1) continue;
      const k0 = Math.max(1, Math.ceil(u0 / s)), k1 = Math.min(n - 1, Math.floor(u1 / s));
      if (k0 > k1) continue;
      const base = A.baseArista[a / 6];
      for (let k = k0; k <= k1; k++) {
        const u = k * s;
        this._muestra(A, B, eje === 0 ? x0 + u : x0, eje === 1 ? y0 + u : y0, eje === 2 ? z0 + u : z0, R, lim, base + k);
      }
    }
  }

  // Una esfera de muestra de A (centro (sx,sy,sz) en coords de A) contra
  // la caja redondeada de B. R: transformación de coords de A a las de B.
  _muestra(A, B, sx, sy, sz, R, lim, j) {
    const hx = B.medias[0], hy = B.medias[1], hz = B.medias[2];
    const lx = R[0] * sx + R[1] * sy + R[2] * sz + R[9];
    const qx = Math.abs(lx) - hx;
    if (qx >= lim) return;
    const ly = R[3] * sx + R[4] * sy + R[5] * sz + R[10];
    const qy = Math.abs(ly) - hy;
    if (qy >= lim) return;
    const lz = R[6] * sx + R[7] * sy + R[8] * sz + R[11];
    const qz = Math.abs(lz) - hz;
    if (qz >= lim) return;
    // punto más cercano del núcleo de B y normal (coords de B)
    let cx = lx < -hx ? -hx : lx > hx ? hx : lx;
    let cy = ly < -hy ? -hy : ly > hy ? hy : ly;
    let cz = lz < -hz ? -hz : lz > hz ? hz : lz;
    let nx = lx - cx, ny = ly - cy, nz = lz - cz;
    let dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (dist >= lim) return;
    if (dist > 1e-9) { nx /= dist; ny /= dist; nz /= dist; }
    else {
      // el centro quedó dentro del núcleo: sale por la cara más cercana
      if (qx >= qy && qx >= qz) { nx = lx < 0 ? -1 : 1; ny = 0; nz = 0; cx = nx * hx; dist = qx; }
      else if (qy >= qz) { ny = ly < 0 ? -1 : 1; nx = 0; nz = 0; cy = ny * hy; dist = qy; }
      else { nz = lz < 0 ? -1 : 1; nx = 0; ny = 0; cz = nz * hz; dist = qz; }
    }
    let pen = lim - dist;
    if (pen <= 0) return;
    // ¿Cruzó el núcleo en este substep? (una placa o un segmento no tienen
    // "adentro": si la muestra pasó al otro lado, la normal se da vuelta y
    // la empujaría a atravesarlo). Se mira de qué lado estaba al empezar el
    // substep y, si era el opuesto, se la devuelve por donde vino.
    if (dist > 1e-9) {
      rotarPrev(A, sx, sy, sz, tmp, 0);
      rotarInvPrev(B, A.px + tmp[0] - B.px, A.py + tmp[1] - B.py, A.pz + tmp[2] - B.pz, tmp, 3);
      const px = tmp[3], py = tmp[4], pz = tmp[5];
      let mx = px - (px < -hx ? -hx : px > hx ? hx : px);
      let my = py - (py < -hy ? -hy : py > hy ? hy : py);
      let mz = pz - (pz < -hz ? -hz : pz > hz ? hz : pz);
      if (mx * nx + my * ny + mz * nz < 0) {
        const dp = Math.sqrt(mx * mx + my * my + mz * mz);
        mx /= dp; my /= dp; mz /= dp;
        pen = lim - ((lx - cx) * mx + (ly - cy) * my + (lz - cz) * mz);
        nx = mx; ny = my; nz = mz;
      }
    }
    const rA = A.radio, rB = B.radio;
    // a coordenadas de mundo
    rotar(A, sx, sy, sz, tmp, 0);
    rotar(B, nx, ny, nz, tmp, 3);
    const Nx = tmp[3], Ny = tmp[4], Nz = tmp[5];
    const bx = cx + nx * rB, by = cy + ny * rB, bz = cz + nz * rB;
    rotar(B, bx, by, bz, tmp, 6);
    const rbx = tmp[6], rby = tmp[7], rbz = tmp[8];
    const rax = tmp[0] - Nx * rA, ray = tmp[1] - Ny * rA, raz = tmp[2] - Nz * rA;
    // velocidad normal relativa antes de corregir
    const vax = A.vx + A.wy * raz - A.wz * ray;
    const vay = A.vy + A.wz * rax - A.wx * raz;
    const vaz = A.vz + A.wx * ray - A.wy * rax;
    const vbx = B.vx + B.wy * rbz - B.wz * rby;
    const vby = B.vy + B.wz * rbx - B.wx * rbz;
    const vbz = B.vz + B.wx * rby - B.wy * rbx;
    const vn = (vax - vbx) * Nx + (vay - vby) * Ny + (vaz - vbz) * Nz;
    // un golpe fuerte (o una penetración grande) despierta al que dormía;
    // si no, el dormido cuenta como fijo
    if (B.dormido && (vn < -5 || pen > 0.05)) this.despertar(B);
    if (A.dormido && (vn < -5 || pen > 0.05)) this.despertar(A);
    const c = this._contacto();
    c.a = A; c.b = B;
    c.arr = this._arrPar; c.slot = j;
    c.nx = Nx; c.ny = Ny; c.nz = Nz;
    rotarInv(A, rax, ray, raz, tmp, 9);
    c.ax = tmp[9]; c.ay = tmp[10]; c.az = tmp[11];
    c.bx = bx; c.by = by; c.bz = bz;
    const T = this.tabla, to = (A.mat * NM + B.mat) * 4;
    c.muS = T[to]; c.muD = T[to + 1]; c.e = T[to + 2]; c.rod = T[to + 3];
    c.vnPre = vn;
    c.lambda = this._corregir(A, rax, ray, raz, B, rbx, rby, rbz, Nx, Ny, Nz, pen);
    this._friccionEstatica(c);
    A.apoyado = true; B.apoyado = true;
    if (-vn > this._golpeMin) {
      if (-vn > A.golpe) { A.golpe = -vn; A.golpeContra = 'cuerpo'; A.golpeMaterial = B.material; }
      if (-vn > B.golpe) { B.golpe = -vn; B.golpeContra = 'cuerpo'; B.golpeMaterial = A.material; }
    }
    this._relativa(A, B, R); // la corrección movió a los dos
  }

  // Transformación de coords de A a coords de B: R = R_Bᵀ R_A, t = R_Bᵀ (x_A − x_B).
  _relativa(A, B, R) {
    const m = this._mats;
    matriz(A, m, 0); matriz(B, m, 9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      // (R_Bᵀ R_A)_ij = Σ_k B_ki A_kj
      R[i * 3 + j] = m[9 + i] * m[j] + m[12 + i] * m[3 + j] + m[15 + i] * m[6 + j];
    }
    const ex = A.x - B.x, ey = A.y - B.y, ez = A.z - B.z;
    R[9] = m[9] * ex + m[12] * ey + m[15] * ez;
    R[10] = m[10] * ex + m[13] * ey + m[16] * ez;
    R[11] = m[11] * ex + m[14] * ey + m[17] * ez;
  }

  // Masa generalizada inversa en el punto r (relativo al centro) y la
  // dirección n: 1/m + (r×n)ᵀ I⁻¹ (r×n), con I⁻¹ en el marco local.
  _w(c, rx, ry, rz, nx, ny, nz) {
    if (!c || c.dormido || c.cinematico) return 0;
    rotarInv(c, ry * nz - rz * ny, rz * nx - rx * nz, rx * ny - ry * nx, tw, 0);
    return c.invM + c.iIx * tw[0] * tw[0] + c.iIy * tw[1] * tw[1] + c.iIz * tw[2] * tw[2];
  }

  // Corrección posicional XPBD: empuja A según +n y B según −n, `C` en total.
  _corregir(A, rax, ray, raz, B, rbx, rby, rbz, nx, ny, nz, C) {
    const wA = this._w(A, rax, ray, raz, nx, ny, nz);
    const wB = this._w(B, rbx, rby, rbz, nx, ny, nz);
    const w = wA + wB;
    if (w <= 0) return 0;
    const dl = C / w;
    const px = dl * nx, py = dl * ny, pz = dl * nz;
    if (wA > 0) this._mover(A, rax, ray, raz, px, py, pz, 1);
    if (wB > 0) this._mover(B, rbx, rby, rbz, px, py, pz, -1);
    return dl;
  }

  // Desplazamiento posicional p (g·cm) aplicado en r, con signo s.
  _mover(c, rx, ry, rz, px, py, pz, s) {
    const m = c.invM * s;
    c.x += px * m; c.y += py * m; c.z += pz * m;
    invIMundo(c, ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px);
    const ax = tw[0] * s, ay = tw[1] * s, az = tw[2] * s;
    const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
    c.qx += 0.5 * (ax * qw + ay * qz - az * qy);
    c.qy += 0.5 * (ay * qw + az * qx - ax * qz);
    c.qz += 0.5 * (az * qw + ax * qy - ay * qx);
    c.qw += 0.5 * (-ax * qx - ay * qy - az * qz);
    normalizarQ(c);
  }

  // Deslizamiento tangencial del contacto desde el principio del substep:
  // lo que se movió el punto de A menos lo que se movió el de B. Si el
  // contacto ya estaba pegado en el substep anterior, se le suma lo que
  // quedó sin corregir ahí (ver _anclas). Deja el vector en tmp[0..2] y
  // los brazos rA, rB en tmp[3..8].
  _deslizamiento(c) {
    const A = c.a, B = c.b;
    rotar(A, c.ax, c.ay, c.az, tmp, 0);
    rotarPrev(A, c.ax, c.ay, c.az, tmp, 3);
    const rax = tmp[0], ray = tmp[1], raz = tmp[2];
    let dx = (A.x + rax) - (A.px + tmp[3]);
    let dy = (A.y + ray) - (A.py + tmp[4]);
    let dz = (A.z + raz) - (A.pz + tmp[5]);
    let rbx = 0, rby = 0, rbz = 0;
    if (B) {
      rotar(B, c.bx, c.by, c.bz, tmp, 6);
      rbx = tmp[6]; rby = tmp[7]; rbz = tmp[8];
      if (!B.dormido) {
        rotarPrev(B, c.bx, c.by, c.bz, tmp, 9);
        dx -= (B.x + rbx) - (B.px + tmp[9]);
        dy -= (B.y + rby) - (B.py + tmp[10]);
        dz -= (B.z + rbz) - (B.pz + tmp[11]);
      }
    }
    const arr = c.arr, o = c.slot * 4;
    if (arr && arr[o + 3] === this._nSub - 1) { dx += arr[o]; dy += arr[o + 1]; dz += arr[o + 2]; }
    const dn = dx * c.nx + dy * c.ny + dz * c.nz;
    tmp[0] = dx - dn * c.nx; tmp[1] = dy - dn * c.ny; tmp[2] = dz - dn * c.nz;
    tmp[3] = rax; tmp[4] = ray; tmp[5] = raz;
    tmp[6] = rbx; tmp[7] = rby; tmp[8] = rbz;
  }

  _friccionEstatica(c) {
    c.pegado = false;
    this._deslizamiento(c);
    const dx = tmp[0], dy = tmp[1], dz = tmp[2];
    const rax = tmp[3], ray = tmp[4], raz = tmp[5], rbx = tmp[6], rby = tmp[7], rbz = tmp[8];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-9) { c.pegado = true; return; }
    const tx = -dx / L, ty = -dy / L, tz = -dz / L;
    const w = this._w(c.a, rax, ray, raz, tx, ty, tz) + this._w(c.b, rbx, rby, rbz, tx, ty, tz);
    if (w <= 0) return;
    if (L / w < c.muS * c.lambda) {
      this._corregir(c.a, rax, ray, raz, c.b, rbx, rby, rbz, tx, ty, tz, L);
      c.pegado = true;
    }
  }

  // Con una sola iteración por substep, cada corrección mueve un poco los
  // puntos de los contactos que ya se resolvieron: a un cuerpo apoyado en
  // varios puntos le queda un deslizamiento residual chico y siempre para
  // el mismo lado (según el orden), y en reposo "camina". Se guarda ese
  // residuo de cada contacto pegado y en el substep siguiente la fricción
  // estática lo corrige junto con lo nuevo. Se recorren de atrás para
  // adelante: si un contacto aparece dos veces en el substep (las dos
  // pasadas de los planos), manda el último.
  _anclas() {
    const s = this._nSub;
    for (let i = this.nContactos - 1; i >= 0; i--) {
      const c = this.contactos[i];
      const arr = c.arr;
      if (!arr) continue;
      const o = c.slot * 4;
      if (arr[o + 3] === s) continue;
      if (!c.pegado) { arr[o + 3] = -10; continue; }
      this._deslizamiento(c);
      arr[o] = tmp[0]; arr[o + 1] = tmp[1]; arr[o + 2] = tmp[2]; arr[o + 3] = s;
    }
  }

  // Matriz de rotación (por filas) e inversa de la inercia en coords de
  // mundo (simétrica: xx, yy, zz, xy, xz, yz) de cada cuerpo, para la pasada
  // de velocidades: ahí las orientaciones ya no cambian.
  _matrices() {
    for (const c of this.cuerpos) {
      if (c.dormido) continue;
      const M = c.M;
      matriz(c, M, 0);
      const J = c.J;
      if (c.cinematico) { J[0] = J[1] = J[2] = J[3] = J[4] = J[5] = 0; continue; }
      const a = c.iIx, b = c.iIy, d = c.iIz;
      J[0] = M[0] * M[0] * a + M[1] * M[1] * b + M[2] * M[2] * d;
      J[1] = M[3] * M[3] * a + M[4] * M[4] * b + M[5] * M[5] * d;
      J[2] = M[6] * M[6] * a + M[7] * M[7] * b + M[8] * M[8] * d;
      J[3] = M[0] * M[3] * a + M[1] * M[4] * b + M[2] * M[5] * d;
      J[4] = M[0] * M[6] * a + M[1] * M[7] * b + M[2] * M[8] * d;
      J[5] = M[3] * M[6] * a + M[4] * M[7] * b + M[5] * M[8] * d;
    }
  }

  _velocidadContacto(c, h) {
    if (c.lambda <= 0) return;
    const A = c.a, B = c.b;
    const nx = c.nx, ny = c.ny, nz = c.nz;
    const MA = A.M, JA = A.J, mA = A.invM;
    const rax = MA[0] * c.ax + MA[1] * c.ay + MA[2] * c.az;
    const ray = MA[3] * c.ax + MA[4] * c.ay + MA[5] * c.az;
    const raz = MA[6] * c.ax + MA[7] * c.ay + MA[8] * c.az;
    // B: dinámico (recibe impulsos), cinemático (se mueve pero no los
    // recibe), dormido o el plano (quietos)
    const bMov = B !== null && !B.dormido;
    const bDin = bMov && !B.cinematico;
    let rbx = 0, rby = 0, rbz = 0, mB = 0;
    let JB = A.J; // (no se usa si B no es dinámico)
    if (bMov) {
      const MB = B.M;
      rbx = MB[0] * c.bx + MB[1] * c.by + MB[2] * c.bz;
      rby = MB[3] * c.bx + MB[4] * c.by + MB[5] * c.bz;
      rbz = MB[6] * c.bx + MB[7] * c.by + MB[8] * c.bz;
      if (bDin) { JB = B.J; mB = B.invM; }
    }
    // velocidad relativa del punto de contacto
    let vx = A.vx + A.wy * raz - A.wz * ray;
    let vy = A.vy + A.wz * rax - A.wx * raz;
    let vz = A.vz + A.wx * ray - A.wy * rax;
    if (bMov) {
      vx -= B.vx + B.wy * rbz - B.wz * rby;
      vy -= B.vy + B.wz * rbx - B.wx * rbz;
      vz -= B.vz + B.wx * rby - B.wy * rbx;
    }
    const vn = vx * nx + vy * ny + vz * nz;
    // rebote: sin rebote en contactos lentos (evita temblores en reposo)
    const e = Math.abs(c.vnPre) <= 6 * this.g * h ? 0 : c.e;
    const dvn = -vn + Math.max(-e * c.vnPre, 0);
    // masa generalizada inversa en la normal: 1/m + (r×n)ᵀ I⁻¹ (r×n)
    let ux = ray * nz - raz * ny, uy = raz * nx - rax * nz, uz = rax * ny - ray * nx;
    // I⁻¹ (r×n) de A y de B (para aplicar el impulso sin volver a multiplicar)
    let iax = JA[0] * ux + JA[3] * uy + JA[4] * uz;
    let iay = JA[3] * ux + JA[1] * uy + JA[5] * uz;
    let iaz = JA[4] * ux + JA[5] * uy + JA[2] * uz;
    let w = mA + ux * iax + uy * iay + uz * iaz;
    let ibx = 0, iby = 0, ibz = 0;
    if (bDin) {
      ux = rby * nz - rbz * ny; uy = rbz * nx - rbx * nz; uz = rbx * ny - rby * nx;
      ibx = JB[0] * ux + JB[3] * uy + JB[4] * uz;
      iby = JB[3] * ux + JB[1] * uy + JB[5] * uz;
      ibz = JB[4] * ux + JB[5] * uy + JB[2] * uz;
      w += mB + ux * ibx + uy * iby + uz * ibz;
    }
    const pn = dvn / w;
    A.vx += nx * pn * mA; A.vy += ny * pn * mA; A.vz += nz * pn * mA;
    A.wx += iax * pn; A.wy += iay * pn; A.wz += iaz * pn;
    if (bDin) {
      B.vx -= nx * pn * mB; B.vy -= ny * pn * mB; B.vz -= nz * pn * mB;
      B.wx -= ibx * pn; B.wy -= iby * pn; B.wz -= ibz * pn;
    }
    // fricción dinámica: el impulso tangencial no pasa de μd · (impulso normal λ/h)
    vx = A.vx + A.wy * raz - A.wz * ray;
    vy = A.vy + A.wz * rax - A.wx * raz;
    vz = A.vz + A.wx * ray - A.wy * rax;
    if (bMov) {
      vx -= B.vx + B.wy * rbz - B.wz * rby;
      vy -= B.vy + B.wz * rbx - B.wx * rbz;
      vz -= B.vz + B.wx * rby - B.wy * rbx;
    }
    const vn2 = vx * nx + vy * ny + vz * nz;
    let tx = vx - vn2 * nx, ty = vy - vn2 * ny, tz = vz - vn2 * nz;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt > 1e-9) {
      tx /= vt; ty /= vt; tz /= vt;
      ux = ray * tz - raz * ty; uy = raz * tx - rax * tz; uz = rax * ty - ray * tx;
      iax = JA[0] * ux + JA[3] * uy + JA[4] * uz;
      iay = JA[3] * ux + JA[1] * uy + JA[5] * uz;
      iaz = JA[4] * ux + JA[5] * uy + JA[2] * uz;
      w = mA + ux * iax + uy * iay + uz * iaz;
      if (bDin) {
        ux = rby * tz - rbz * ty; uy = rbz * tx - rbx * tz; uz = rbx * ty - rby * tx;
        ibx = JB[0] * ux + JB[3] * uy + JB[4] * uz;
        iby = JB[3] * ux + JB[1] * uy + JB[5] * uz;
        ibz = JB[4] * ux + JB[5] * uy + JB[2] * uz;
        w += mB + ux * ibx + uy * iby + uz * ibz;
      }
      const pt = -Math.min(c.muD * c.lambda / h, vt / w);
      A.vx += tx * pt * mA; A.vy += ty * pt * mA; A.vz += tz * pt * mA;
      A.wx += iax * pt; A.wy += iay * pt; A.wz += iaz * pt;
      if (bDin) {
        B.vx -= tx * pt * mB; B.vy -= ty * pt * mB; B.vz -= tz * pt * mB;
        B.wx -= ibx * pt; B.wy -= iby * pt; B.wz -= ibz * pt;
      }
    }
    // resistencia a la rodadura: un par que se opone al giro relativo
    // tangente al contacto, de a lo sumo rodadura · (impulso normal). Por
    // debajo de giroRodadura se desvanece: así no sostiene en equilibrio a
    // un cuerpo apoyado en un canto (un lápiz hexagonal termina sobre una
    // cara) y lo que rueda muy despacio lo frena el umbral de dormir.
    if (c.rod > 0) {
      let ox = A.wx, oy = A.wy, oz = A.wz;
      if (bMov) { ox -= B.wx; oy -= B.wy; oz -= B.wz; }
      const on = ox * nx + oy * ny + oz * nz;
      ox -= on * nx; oy -= on * ny; oz -= on * nz;
      const om = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (om > 1e-9) {
        ux = ox / om; uy = oy / om; uz = oz / om;
        iax = JA[0] * ux + JA[3] * uy + JA[4] * uz;
        iay = JA[3] * ux + JA[1] * uy + JA[5] * uz;
        iaz = JA[4] * ux + JA[5] * uy + JA[2] * uz;
        let k = ux * iax + uy * iay + uz * iaz;
        if (bDin) {
          ibx = JB[0] * ux + JB[3] * uy + JB[4] * uz;
          iby = JB[3] * ux + JB[1] * uy + JB[5] * uz;
          ibz = JB[4] * ux + JB[5] * uy + JB[2] * uz;
          k += ux * ibx + uy * iby + uz * ibz;
        }
        if (k > 0) {
          const Lr = Math.min(c.rod * c.lambda / h * Math.min(1, om / this.giroRodadura), om / k);
          A.wx -= iax * Lr; A.wy -= iay * Lr; A.wz -= iaz * Lr;
          if (bDin) { B.wx += ibx * Lr; B.wy += iby * Lr; B.wz += ibz * Lr; }
        }
      }
    }
  }

  // El dedo: un rayo desde la cámara que se mueve durante el frame. Donde
  // toca un cuerpo, la fricción de la yema arrastra ese punto hacia la
  // velocidad del dedo (con un tope de fuerza: si el dedo va muy rápido
  // patina). Un lápiz redondo rueda bajo el dedo; una regla se arrastra.
  // Opciones por dedo: margen (cm), agarre (0–1), fuerza (dyn), lineal
  // (fracción del impulso que traslada; 1 = físico), elevar.
  _dedos(h, frac, dtFrame) {
    for (const f of this.dedos) {
      const dx = f.d0[0] + (f.d1[0] - f.d0[0]) * frac;
      const dy = f.d0[1] + (f.d1[1] - f.d0[1]) * frac;
      const dz = f.d0[2] + (f.d1[2] - f.d0[2]) * frac;
      const hit = this.rayo(f.o[0], f.o[1], f.o[2], dx, dy, dz, f.margen ?? 0.1);
      if (!hit) continue;
      const c = hit.cuerpo;
      if (c.cinematico) continue;
      // velocidad del dedo en el plano horizontal a la altura del toque
      const t0 = (hit.y - f.o[1]) / f.d0[1], t1 = (hit.y - f.o[1]) / f.d1[1];
      const fvx = ((f.o[0] + f.d1[0] * t1) - (f.o[0] + f.d0[0] * t0)) / dtFrame;
      const fvz = ((f.o[2] + f.d1[2] * t1) - (f.o[2] + f.d0[2] * t0)) / dtFrame;
      if (!Number.isFinite(fvx) || !Number.isFinite(fvz)) continue;
      const rx = hit.x - c.x, ry = hit.y - c.y, rz = hit.z - c.z;
      if (c.dormido) {
        if (Math.hypot(fvx, fvz) < 1) continue; // apoyar el dedo quieto no lo despierta
        this.despertar(c);
      }
      const vcx = c.vx + c.wy * rz - c.wz * ry;
      const vcz = c.vz + c.wx * ry - c.wy * rx;
      const Dx = fvx - vcx, Dz = fvz - vcz;
      const D = Math.hypot(Dx, Dz);
      if (D < 1e-6) continue;
      const ux = Dx / D, uz = Dz / D;
      const w = this._w(c, rx, ry, rz, ux, 0, uz);
      if (w <= 0) continue;
      let J = (D / w) * (f.agarre ?? 0.9);
      const Jmax = (f.fuerza ?? 60000) * h;
      if (J > Jmax) J = Jmax;
      const lin = f.lineal ?? 1;
      c.vx += ux * J * lin * c.invM;
      c.vz += uz * J * lin * c.invM;
      const Jx = ux * J, Jz = uz * J;
      invIMundo(c, ry * Jz, rz * Jx - rx * Jz, -ry * Jx);
      c.wx += tw[0]; c.wy += tw[1]; c.wz += tw[2];
      if (f.elevar) {
        const vf = Math.hypot(fvx, fvz);
        if (vf > 10) c.vy += J * f.elevar * Math.min(1, (vf - 10) / 40) * c.invM;
      }
      c.tocado = 0.15;
    }
  }

  // Dormir a los cuerpos quietos (quedan donde cayeron: no hay grilla).
  // La medida es la velocidad media del frame (de la pose al principio a
  // la del final: un temblor de ida y vuelta entre substeps no cuenta) del
  // punto más rápido del cuerpo, así una regla larga que gira despacio no
  // se duerme antes de tiempo y un lápiz que rueda sobre su eje, sí.
  _dormir(dt) {
    const ih = 1 / dt;
    for (const c of this.cuerpos) {
      if (c.tocado > 0) c.tocado -= dt;
      if (c.dormido || c.cinematico) continue;
      const vx = (c.x - c.ex) * ih, vy = (c.y - c.ey) * ih, vz = (c.z - c.ez) * ih;
      // ω media: 2 · vec(q · q0⁻¹) / dt, llevada a coords locales
      const px = -c.eqx, py = -c.eqy, pz = -c.eqz, pw = c.eqw;
      const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
      let dx = qw * px + qx * pw + qy * pz - qz * py;
      let dy = qw * py + qy * pw + qz * px - qx * pz;
      let dz = qw * pz + qz * pw + qx * py - qy * px;
      if (qw * pw - qx * px - qy * py - qz * pz < 0) { dx = -dx; dy = -dy; dz = -dz; }
      const v = Math.hypot(vx, vy, vz) + this._giroPunta(c, 2 * dx * ih, 2 * dy * ih, 2 * dz * ih);
      if (c.apoyado && v < this.umbralDormir && !(c.tocado > 0)) c.quieto += dt;
      else c.quieto = 0;
      if (c.quieto > this.tiempoDormir) {
        c.dormido = true;
        c.vx = c.vy = c.vz = 0; c.wx = c.wy = c.wz = 0;
        guardarPrevia(c);
      }
    }
  }

  // Velocidad (por el giro ω, mundo) del punto más rápido de la caja exterior.
  _giroPunta(c, wx, wy, wz) {
    rotarInv(c, wx, wy, wz, tw, 0);
    const ox = tw[0], oy = tw[1], oz = tw[2];
    const ex = c.medias[0] + c.radio, ey = c.medias[1] + c.radio, ez = c.medias[2] + c.radio;
    let m = 0;
    for (let s = 0; s < 4; s++) {
      const py = s & 1 ? ey : -ey, pz = s & 2 ? ez : -ez;
      const vx = oy * pz - oz * py, vy = oz * ex - ox * pz, vz = ox * py - oy * ex;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > m) m = v2;
    }
    return Math.sqrt(m);
  }
}
