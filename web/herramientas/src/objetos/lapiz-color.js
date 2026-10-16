// ─────────────────────────────────────────────────────────────
//  Lápiz de color redondo, sin goma.
//
//  Piezas, en coords locales (cm, eje largo en x, punta hacia −x):
//  · punta: el cono que deja el sacapuntas. En la parte fina asoma la
//    mina de color (un poco corrida del centro, como pasa en los lápices
//    de verdad) y en la gruesa la madera de cedro con su veta y la
//    pelusa de las fibras cortadas;
//  · cuerpo: cilindro de pintura satinada. Donde el cono lo corta queda
//    el borde pintura/madera, un círculo prolijo con un bisel finito; el
//    corte de las capas (imprimación clara y color) se ve como dos
//    anillos finitos sobre el cono;
//  · capuchón: el extremo de atrás sumergido en pintura, un poco más
//    oscuro y más brillante, con la cabeza redondeada y el borde de la
//    inmersión apenas inclinado y ondulado;
//  · impresión: texto chico a lo largo, en blanco o en foil plateado.
//
//  Todo procedural. Geometrías y campos de las texturas se cachean a
//  nivel de módulo; por variante sólo se compone el color.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { azar, hash, ruido, fbm, lienzo, texturaDeLienzo, texturaDeDatos, recibirSombra, linealASrgb } from '../util.js';
import { PALETA } from '../paleta.js';

export const nombre = 'lapiz-color';
export const variantes = ['petroleo', 'mostaza', 'naranja', 'verde', 'celeste'];

// pintura: laca del cuerpo; mina: color del núcleo (algo más claro y vivo
// que la pintura); impresion: 'plata' (foil) o 'blanco' (tinta)
const VARIANTES = {
  petroleo: { pintura: PALETA.petroleo, mina: 0x1d5154, impresion: 'plata', numero: '157', color: 'PETRÓLEO' },
  mostaza: { pintura: PALETA.mostaza, mina: 0xdca33a, impresion: 'blanco', numero: '183', color: 'MOSTAZA' },
  naranja: { pintura: PALETA.naranja, mina: 0xd25d2f, impresion: 'blanco', numero: '115', color: 'NARANJA' },
  verde: { pintura: PALETA.verde, mina: 0x346b55, impresion: 'plata', numero: '159', color: 'VERDE BOTELLA' },
  celeste: { pintura: PALETA.celeste, mina: 0x98c6c6, impresion: 'plata', numero: '146', color: 'CELESTE' },
};

// ── medidas (cm) ──
const R = 0.357;                  // radio del cuerpo (con el capuchón llega a 0,36)
const X_PUNTA = -8.75;            // punta (roma) de la mina
const X_FIN = 8.75;               // cabeza del capuchón
const TAN_A = 0.2;                // tangente del semiángulo del cono (≈ 11,3°)
const SEN_A = TAN_A / Math.hypot(1, TAN_A);
const COS_A = 1 / Math.hypot(1, TAN_A);
const RHO = 0.024;                // radio de la punta roma de la mina
const R_MINA = 0.165;             // mina de 3,3 mm
const CM = [0.006, -0.005];       // la mina, corrida del eje (y, z)
const X_AP = X_PUNTA + RHO - RHO / SEN_A;  // vértice ideal del cono
const XC_TAPA = X_AP + RHO / SEN_A;        // centro de la esfera de la punta
const X_B = X_AP + R / TAN_A;     // borde pintura/madera (≈ 1,7 cm de cono)
const DB = 0.006;                 // el bisel del borde arranca un poco antes, sobre el cono
const ESP_PINTURA = 0.0042;       // espesor de las capas de color
const ESP_IMPRIMACION = 0.0015;   // y de la imprimación clara de abajo
const LP = X_B - DB - X_PUNTA;    // largo de cono que cubre la textura de la punta
const X_DIP = 7.86;               // borde medio de la inmersión
const T0 = 0.002;                 // espesor de la pintura de la inmersión
const T1 = 0.002;                 // y lo que se acumula hacia la cabeza
const AE = 0.19, PE = 2.7;        // cabeza: superelipse de profundidad AE y exponente PE
const N = 72;                     // segmentos alrededor del eje

// ── utilidades ──
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const suave = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lineal = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const TABLA_SRGB = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) TABLA_SRGB[i] = Math.round(linealASrgb(i / 4096) * 255);
const aSrgb = (x) => TABLA_SRGB[(sat(x) * 4096) | 0];
const aByte = (x) => Math.round(sat(x) * 255);

// Borde de la inmersión en función del ángulo: el lápiz no entró del todo
// derecho en la pintura (inclinación) y el menisco lo ondula apenas.
function xDip(th) {
  return X_DIP + 0.028 * Math.cos(th - 0.9) + 0.004 * Math.sin(2 * th + 0.6)
    + 0.0025 * Math.sin(5 * th + 2.1) + 0.0015 * Math.sin(9 * th + 0.3) + 0.0008 * Math.sin(17 * th + 1.7);
}
// espesor de la pintura de la inmersión a una distancia s del borde: una
// rampa corta, el cordón finito que deja el menisco y lo que se acumula
// hacia la cabeza
const espesorDip = (s) => T0 * suave(0, 0.045, s) + 0.0006 * Math.exp(-(((s - 0.03) / 0.016) ** 2))
  + T1 * suave(0.08, 0.55, s);
// el borde pintura/madera de la punta: un círculo, apenas mellado
const mellaBorde = (th) => 0.0022 * Math.sin(3 * th + 0.5) + 0.0014 * Math.sin(7 * th + 2) + 0.0008 * Math.sin(13 * th + 1);

// radio del cono de la punta en x (con la esfera de la punta roma)
function radioPunta(x) {
  const xT = XC_TAPA - RHO * SEN_A;
  if (x < xT) { const d = x - XC_TAPA; return Math.sqrt(Math.max(0, RHO * RHO - d * d)); }
  return (x - X_AP) * TAN_A;
}

// ── geometría ──
// Malla de filas × (N + 1) columnas alrededor del eje. fila(th) devuelve
// [x, r, nx, nr, u]: la fila puede no ser plana (el borde de la inmersión).
function torno(filas, { segs = N, th0 = 0, th1 = 2 * Math.PI, vDe = null, radioExtra = 0 } = {}) {
  const NC = segs + 1;
  const pos = new Float32Array(filas.length * NC * 3);
  const nor = new Float32Array(filas.length * NC * 3);
  const uv = new Float32Array(filas.length * NC * 2);
  let p = 0, q = 0;
  for (const fila of filas) for (let j = 0; j < NC; j++) {
    const th = th0 + ((th1 - th0) * j) / segs, c = Math.cos(th), s = Math.sin(th);
    const [x, r0, nx, nr, u] = fila(th);
    const r = r0 + radioExtra;
    pos[p] = x; pos[p + 1] = r * c; pos[p + 2] = r * s;
    nor[p] = nx; nor[p + 1] = nr * c; nor[p + 2] = nr * s;
    p += 3;
    uv[q] = u; uv[q + 1] = vDe ? vDe(th) : j / segs;
    q += 2;
  }
  const idx = [];
  for (let i = 0; i < filas.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * NC + j, b = a + NC;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const normalizar2 = (a, b) => { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; };

function geometriaPunta() {
  const filas = [];
  const uDe = (x) => (x - X_PUNTA) / LP;
  const gMax = Math.PI / 2 - Math.asin(SEN_A);
  const NCAP = 5;
  for (let i = 0; i <= NCAP; i++) {
    const g = (gMax * i) / NCAP;
    const x = XC_TAPA - RHO * Math.cos(g), r = RHO * Math.sin(g);
    filas.push(() => [x, r, -Math.cos(g), Math.sin(g), uDe(x)]);
  }
  const xT = XC_TAPA - RHO * SEN_A, xE = X_B - DB;
  for (const t of [0.1, 0.22, 0.36, 0.5, 0.65, 0.82, 1]) {
    filas.push((th) => {
      const x = xT + (xE - xT) * t + (t === 1 ? mellaBorde(th) : 0), r = (x - X_AP) * TAN_A;
      return [x, r, -SEN_A, COS_A, uDe(x)];
    });
  }
  return torno(filas);
}

function geometriaCuerpo() {
  const uDe = (x) => (x - X_B) / (X_FIN - X_B);
  const x0 = X_B - DB, r0 = (x0 - X_AP) * TAN_A;
  const [bx, br] = normalizar2(-SEN_A, COS_A + 1.4); // bisel: entre el cono y el cilindro
  const filas = [
    (th) => { const x = x0 + mellaBorde(th); return [x, r0 + mellaBorde(th) * TAN_A, bx, br, uDe(x)]; },
    (th) => { const x = X_B + 0.005 + mellaBorde(th); return [x, R, 0, 1, uDe(x)]; },
  ];
  for (const x of [-4, 0, 4, 7.4]) filas.push(() => [x, R, 0, 1, uDe(x)]);
  filas.push((th) => { const x = xDip(th); return [x, R, 0, 1, uDe(x)]; });
  return torno(filas);
}

// Capuchón: filas que siguen el borde de la inmersión (s = distancia al
// borde) y, al final, la cabeza en superelipse.
function geometriaCapuchon() {
  const filas = [];
  const uDe = (x) => (x - (X_DIP - 0.05)) / (X_FIN - X_DIP + 0.05);
  const pendiente = (s) => (espesorDip(s + 0.0005) - espesorDip(s - 0.0005)) / 0.001;
  for (const s of [0, 0.008, 0.016, 0.025, 0.035, 0.048, 0.07, 0.12, 0.25, 0.4]) {
    filas.push((th) => {
      const x = xDip(th) + s;
      const [nx, nr] = normalizar2(-pendiente(s), 1);
      return [x, R + espesorDip(s), nx, nr, uDe(x)];
    });
  }
  const b = R + T0 + T1, x0 = X_FIN - AE;
  const NE = 16;
  for (let i = 0; i <= NE; i++) {
    // más densas cerca del canto
    const t = (Math.PI / 2) * (i / NE) ** 0.85;
    const st = Math.sin(t), ct = Math.cos(t);
    const ex = 2 / PE;
    const dx = AE * Math.pow(st, ex), r = b * Math.pow(ct, ex);
    // normal: gradiente de |dx/AE|^PE + |r/b|^PE
    const gx = Math.pow(dx / AE, PE - 1) / AE, gr = Math.pow(r / b, PE - 1) / b;
    const [nx, nr] = i === NE ? [1, 0] : normalizar2(gx, gr);
    filas.push(() => [x0 + dx, r, nx, nr, uDe(x0 + dx)]);
  }
  return torno(filas);
}

// Tira impresa: un pedazo de cilindro apenas por encima de la pintura,
// alrededor de +y (arriba en la pose de reposo). El texto se lee de la
// punta hacia la cabeza (+x), con la parte de arriba de las letras hacia −z.
const ALTO_TIRA = 0.2;
const TIRAS = [
  { x0: 0.55, x1: 3.75 },  // marca y línea
  { x0: 3.95, x1: 7.15 },  // número, nombre del color y código de barras
];
function geometriaTira({ x0, x1 }) {
  const w = ALTO_TIRA / 2 / R;
  const filas = [() => [x0, R, 0, 1, 0], () => [x1, R, 0, 1, 1]];
  return torno(filas, { segs: 10, th0: -w, th1: w, vDe: (th) => (w - th) / (2 * w), radioExtra: 0.0009 });
}

// ── texturas ──

// f(u, v) evaluada en una grilla gruesa e interpolada a W × H texels.
function campoGrueso(cw, ch, f, W, H) {
  const g = new Float32Array((cw + 1) * (ch + 1));
  for (let j = 0; j <= ch; j++) for (let i = 0; i <= cw; i++) g[j * (cw + 1) + i] = f(i / cw, j / ch);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const py = ((y + 0.5) / H) * ch, j = Math.min(ch - 1, py | 0), fy = py - j;
    for (let x = 0; x < W; x++) {
      const px = ((x + 0.5) / W) * cw, i = Math.min(cw - 1, px | 0), fx = px - i;
      const a = g[j * (cw + 1) + i], b = g[j * (cw + 1) + i + 1];
      const c = g[(j + 1) * (cw + 1) + i], d = g[(j + 1) * (cw + 1) + i + 1];
      out[y * W + x] = a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
    }
  }
  return out;
}

// Mapa normal desde alturas en cm; tu, tv(x): tamaño del texel en cm.
// v envuelve (es el ángulo alrededor del eje).
function normalDeAlturas(alto, W, H, tu, tv, fuerza = 1) {
  const datos = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ya = (y - 1 + H) % H, yb = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - 1), xb = Math.min(W - 1, x + 1);
      const gx = (alto[y * W + xb] - alto[y * W + xa]) / ((xb - xa) * tu);
      const gy = (alto[yb * W + x] - alto[ya * W + x]) / (2 * tv(x));
      const nx = -gx * fuerza, ny = -gy * fuerza;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * W + x) * 4;
      datos[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      datos[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      datos[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      datos[o + 3] = 255;
    }
  }
  return datos;
}

// Punta: madera con veta y marcas del sacapuntas. u: x desde la punta (LP
// cm); v: ángulo. No depende de la variante: la mina, su borde y el
// pigmento pegado a la madera los pinta el shader (ver conMina), así el
// borde queda nítido a cualquier distancia.
// · color: la madera (también debajo de la mina, no se ve);
// · orm: G rugosidad de la madera, B tono de la mina;
// · normal: fibras, veta, facetas del traqueteo y mellas de la cuchilla.
const TP = { W: 256, H: 128 };
let texPunta = null;
function obtenerTexturasPunta() {
  if (texPunta) return texPunta;
  const { W, H } = TP;
  const alto = new Float32Array(W * H);
  const color = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  const xs = new Float32Array(W), rs = new Float32Array(W), mellas = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const X = X_PUNTA + ((x + 0.5) / W) * LP;
    xs[x] = X; rs[x] = radioPunta(X);
    // mellas de la cuchilla: anillos finos alrededor del cono
    mellas[x] = (ruido(X * 70, 0.5) - 0.5) + 0.5 * (ruido(X * 190, 3.5) - 0.5);
  }
  const psi = 0.75, cps = Math.cos(psi), sps = Math.sin(psi); // dirección de los anillos
  const fiG = 1.95, nGy = Math.cos(fiG), nGz = Math.sin(fiG); // normal del plano de pegado
  // campos lentos: manchas de tono y la ondulación de los anillos
  const lento = campoGrueso(40, 40, (u, v) => {
    const th = 2 * Math.PI * v, X = X_PUNTA + u * LP, r = radioPunta(X);
    return fbm(r * Math.cos(th) * 7 + 11, r * Math.sin(th) * 7 + X * 0.4, 2) - 0.5;
  }, W, H);
  const alabeo = campoGrueso(48, 64, (u, v) => {
    const th = 2 * Math.PI * v, X = X_PUNTA + u * LP, r = radioPunta(X);
    return (fbm(r * Math.cos(th) * 9 + 1, r * Math.sin(th) * 9 + X * 0.3, 2) - 0.5) * 0.03;
  }, W, H);
  const claro = lineal(0xd3a77c), oscuro = lineal(0xa47450), rosado = lineal(0xcd9c7c);
  for (let y = 0; y < H; y++) {
    const th = (2 * Math.PI * (y + 0.5)) / H, c = Math.cos(th), s = Math.sin(th);
    // traqueteo: facetas finas a lo largo de la generatriz
    const faceta = ruido(c * 16 + 2, s * 16 + 7) - 0.5;
    for (let x = 0; x < W; x++) {
      const o = y * W + x, X = xs[x], r = rs[x];
      const py = r * c, pz = r * s;
      const enMina = r < R_MINA + 0.012;
      let h, rug, tonoMina = 0.5, t = 0;
      if (enMina) {
        // la mina: rayas de las mellas y grano fino
        const grano = ruido(py * 160 + 3, pz * 160 + X * 2) - 0.5;
        tonoMina = 0.5 + grano * 0.35 + mellas[x] * 0.3 + faceta * 0.25;
        h = mellas[x] * 0.0004 + faceta * 0.0003 + grano * 0.00012;
        rug = 0.6;
      } else {
        // veta: anillos de crecimiento casi paralelos en la sección; el cono
        // los corta en ángulo y quedan arcos alargados (las "V")
        const a = py * cps + pz * sps, b = pz * cps - py * sps;
        const fase = (a + 0.45 * b * b + alabeo[o]) / 0.05;
        const d = fase - Math.floor(fase);
        // madera tardía: una banda blanda, más nítida del lado de afuera
        const tardio = suave(0.5, 0.74, d) * (1 - suave(0.8, 0.93, d));
        // fibras: las corta el cono casi al ras, quedan rayitas a lo largo
        const fibra = ruido(c * 42 + 5, s * 42 + X * 3.2) - 0.5;
        const dg = ((py - CM[0]) * nGy + (pz - CM[1]) * nGz) / 0.0032;
        const pegado = dg * dg < 9 ? Math.exp(-dg * dg) : 0;
        // pelusa: la punta de las fibras cortadas, rayitas cortas a lo
        // largo de la generatriz que le dan a la madera su aspecto arenoso
        const pelusa = hash(x >> 2, y) + hash((x + 2) >> 2, y + 7) - 1;
        t = -0.11 * tardio - 0.04 * d + 0.08 * fibra + 0.09 * pelusa - 0.1 * pegado + lento[o] * 0.1;
        h = fibra * 0.0005 - tardio * 0.0003 + faceta * 0.0007 + mellas[x] * 0.0002 + pelusa * 0.00025;
        rug = 0.78 - fibra * 0.14 + tardio * 0.05 + pegado * 0.08 + pelusa * 0.06;
      }
      const m = sat(lento[o] * 1.5 + 0.35);
      const k = 1 + t * 0.6, w = sat(-t * 2) * 0.55; // w: hacia el tono de la madera tardía
      const cr = claro[0] + (rosado[0] - claro[0]) * m, cg = claro[1] + (rosado[1] - claro[1]) * m, cb = claro[2] + (rosado[2] - claro[2]) * m;
      color[o * 4] = aSrgb((cr + (oscuro[0] - cr) * w) * k);
      color[o * 4 + 1] = aSrgb((cg + (oscuro[1] - cg) * w) * k);
      color[o * 4 + 2] = aSrgb((cb + (oscuro[2] - cb) * w) * k);
      color[o * 4 + 3] = 255;
      alto[o] = h;
      orm[o * 4] = 255;
      orm[o * 4 + 1] = aByte(rug);
      orm[o * 4 + 2] = aByte(tonoMina);
      orm[o * 4 + 3] = 255;
    }
  }
  const datosN = normalDeAlturas(alto, W, H, LP / W, (x) => Math.max(0.02, rs[x]) * ((2 * Math.PI) / H));
  texPunta = {
    color: texturaDeDatos(color, W, H, { srgb: true }),
    orm: texturaDeDatos(orm, W, H),
    normal: texturaDeDatos(datosN, W, H),
  };
  return texPunta;
}

// La mina en el shader: distancia (radial) de cada punto del cono al borde
// de la mina, que está corrida del eje. Con eso se pinta la mina con borde
// nítido, el pigmento que el sacapuntas arrastra sobre la madera y el
// anillo de cola que la rodea. Con el radio, el corte de las capas de
// pintura junto al borde del cuerpo.
function conMina(material, cfg) {
  const u = { uMina: { value: new THREE.Color(cfg.mina) }, uPintura: { value: new THREE.Color(cfg.pintura) } };
  const f = (x) => x.toFixed(5);
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalLC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalLC = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocalLC;
        uniform vec3 uMina;
        uniform vec3 uPintura;
        float gMina = 0.0;
        float gTonoMina = 0.5;
        float distMina() {
          float r = length( vLocalLC.yz );
          float th = atan( vLocalLC.z, vLocalLC.y );
          vec2 cm = vec2( ${f(CM[0])}, ${f(CM[1])} );
          float cd = dot( cm, vec2( cos( th ), sin( th ) ) );
          float rm = ${f(R_MINA)} + 0.0012 * sin( 3.0 * th + 1.3 ) + 0.0006 * sin( 7.0 * th + 0.4 ) + 0.0003 * sin( 19.0 * th + 2.2 );
          return r - ( cd + sqrt( max( 0.0, cd * cd - dot( cm, cm ) + rm * rm ) ) );
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float dm = distMina();
          float aa = max( fwidth( dm ), 1e-5 );
          gMina = 1.0 - smoothstep( -aa, aa, dm );
          vec4 ormMina = texture2D( roughnessMap, vRoughnessMapUv );
          gTonoMina = ormMina.b;
          // pigmento que la cuchilla arrastra sobre la madera: rayitas
          // cortas, más fuertes pegado a la mina
          float thm = atan( vLocalLC.z, vLocalLC.y );
          float raya = 0.5 + 0.5 * sin( thm * 41.0 + 2.0 * sin( thm * 11.0 ) );
          float polvo = exp( -max( dm, 0.0 ) / 0.01 ) * ( 0.3 + 0.7 * raya * raya );
          vec3 madera = mix( diffuseColor.rgb, uMina * 0.7, polvo * 0.38 );
          // la línea de cola entre la mina y la madera
          float dc = ( dm - 0.0012 ) / 0.0022;
          madera *= 1.0 - 0.2 * exp( -dc * dc );
          // del otro lado, el corte de las capas de pintura: el cono las
          // atraviesa en diagonal y quedan como dos anillos finitos, la
          // imprimación clara y encima el color
          float rr = length( vLocalLC.yz );
          float ar = max( fwidth( rr ), 1e-6 );
          float capaColor = smoothstep( ${f(R - ESP_PINTURA)} - ar, ${f(R - ESP_PINTURA)} + ar, rr );
          float capaBase = smoothstep( ${f(R - ESP_PINTURA - ESP_IMPRIMACION)} - ar, ${f(R - ESP_PINTURA - ESP_IMPRIMACION)} + ar, rr );
          madera = mix( madera, vec3( 0.7, 0.6, 0.44 ), capaBase * ( 1.0 - capaColor ) );
          madera = mix( madera, uPintura * 0.92, capaColor );
          vec3 mina = uMina * ( 0.8 + 0.4 * gTonoMina );
          diffuseColor.rgb = mix( madera, mina, gMina );
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.34 + 0.16 * ( gTonoMina - 0.5 ), gMina );`);
  };
  material.customProgramCacheKey = () => 'lapiz-color-mina';
  return material;
}

// Cuerpo: manchas leves, vetas a lo largo (la pintura se aplica pasando el
// lápiz por un anillo), rugosidad, ondulaciones y algún golpecito.
// u: x de X_B a X_FIN; v: ángulo.
const TB = { W: 512, H: 64 };
const ABOLLADURAS = [
  { x: 1.9, th: 0.35, r: 0.05, h: -0.0028 },
  { x: -3.4, th: -0.55, r: 0.035, h: -0.002 },
  { x: 5.6, th: 2.6, r: 0.06, h: -0.003 },
];
const RASPONES = [
  { x: -1.3, th: 0.18, l: 0.45, a: 0.03 },
  { x: 4.9, th: -0.25, l: 0.3, a: 0.02 },
];
let camposCuerpo = null;
function obtenerCamposCuerpo() {
  if (camposCuerpo) return camposCuerpo;
  const { W, H } = TB;
  const LB = X_FIN - X_B;
  const mancha = campoGrueso(160, 16, (u, v) => {
    const th = 2 * Math.PI * v;
    return fbm(u * LB * 0.9, Math.cos(th) * 1.2 + Math.sin(th) * 0.4, 3) - 0.5;
  }, W, H);
  // ondulación de la pintura (y de la madera debajo): hace que el reflejo
  // largo del cilindro no sea una línea perfecta
  const onda = campoGrueso(128, 16, (u, v) => {
    const th = 2 * Math.PI * v;
    return fbm(u * LB * 0.9 + 4, Math.cos(th) * 1.1 + 7, 3) - 0.5 + (fbm(u * LB * 0.9 + 9, Math.sin(th) * 1.1, 2) - 0.5);
  }, W, H);
  const f = new Float32Array(W * H), ru = new Float32Array(W * H), alto = new Float32Array(W * H);
  const tu = LB / W, tv = (2 * Math.PI * R) / H;
  for (let y = 0; y < H; y++) {
    const th = (2 * Math.PI * (y + 0.5)) / H, c = Math.cos(th), s = Math.sin(th);
    const veta = (ruido(c * 28 + 3, s * 28 + 3) - 0.5) + 0.5 * (ruido(c * 70, s * 70) - 0.5);
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      alto[o] = onda[o] * 0.004;
      ru[o] = 0.4 + mancha[o] * 0.08 + veta * 0.02;
      f[o] = mancha[o] * 0.05 + veta * 0.018;
    }
  }
  // golpecitos y raspones: sólo en su entorno
  const columnas = (x0, x1) => [Math.max(0, Math.floor((x0 - X_B) / tu)), Math.min(W - 1, Math.ceil((x1 - X_B) / tu))];
  const angulo = (y) => (2 * Math.PI * (y + 0.5)) / H;
  const difAng = (a, b) => { let d = a - b; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); return d; };
  for (const a of ABOLLADURAS) {
    const [i0, i1] = columnas(a.x - 3 * a.r, a.x + 3 * a.r);
    for (let y = 0; y < H; y++) {
      const dth = difAng(angulo(y), a.th) * R;
      if (Math.abs(dth) > 3 * a.r) continue;
      for (let x = i0; x <= i1; x++) {
        const dx = X_B + (x + 0.5) * tu - a.x;
        alto[y * W + x] += a.h * Math.exp(-(dx * dx + dth * dth) / (a.r * a.r));
      }
    }
  }
  for (const rp of RASPONES) {
    const [i0, i1] = columnas(rp.x - rp.l, rp.x + rp.l);
    for (let y = 0; y < H; y++) {
      const dth = difAng(angulo(y), rp.th) * R;
      if (Math.abs(dth) > rp.a * 3 + 0.03) continue;
      for (let x = i0; x <= i1; x++) {
        const X = X_B + (x + 0.5) * tu, dx = (X - rp.x) / rp.l;
        if (Math.abs(dx) > 1) continue;
        const dv = (dth - dx * 0.02) / rp.a;
        const m = Math.exp(-dv * dv * 4) * (1 - dx * dx) * (0.6 + 0.8 * ruido(X * 60, 1.5));
        ru[y * W + x] += m * 0.18; f[y * W + x] += m * 0.05;
      }
    }
  }
  const orm = new Uint8Array(W * H * 4);
  for (let o = 0; o < W * H; o++) { orm[o * 4] = 255; orm[o * 4 + 1] = aByte(ru[o]); orm[o * 4 + 3] = 255; }
  const datosN = normalDeAlturas(alto, W, H, tu, () => tv);
  camposCuerpo = { f, orm: texturaDeDatos(orm, W, H), normal: texturaDeDatos(datosN, W, H) };
  return camposCuerpo;
}

function texturaColorCuerpo(cfg) {
  const { W, H } = TB;
  const { f } = obtenerCamposCuerpo();
  const [br, bg, bb] = lineal(cfg.pintura);
  const color = new Uint8Array(W * H * 4);
  for (let o = 0; o < W * H; o++) {
    const k = 1 + f[o];
    color[o * 4] = aSrgb(br * k); color[o * 4 + 1] = aSrgb(bg * k); color[o * 4 + 2] = aSrgb(bb * k); color[o * 4 + 3] = 255;
  }
  return texturaDeDatos(color, W, H, { srgb: true });
}

// Impresión: texto blanco sobre negro en un lienzo, que el material usa
// como alphaMap (el color lo pone el material: tinta o foil). Encima, la
// tinta que no agarró: puntitos y alguna zona gastada donde el lápiz roza.
const SERIF = 'Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
function lienzoTira(dibujar, semilla) {
  const W = 1024, H = 64;
  const cv = lienzo(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  dibujar(ctx, W, H);
  const r = azar(semilla);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 900; i++) ctx.fillRect(r() * W, H * (0.25 + 0.55 * r()), 1 + r() * 1.5, 1 + r());
  // desgaste suave: el roce se lleva un poco de tinta en manchones
  for (let i = 0; i < 5; i++) {
    const x = r() * W, y = H * (0.3 + 0.4 * r());
    const g = ctx.createRadialGradient(x, y, 0, x, y, 30 + r() * 50);
    g.addColorStop(0, `rgba(0,0,0,${0.25 + r() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 80, 0, 160, H);
  }
  return texturaDeLienzo(cv, { srgb: false, anisotropia: 8 });
}

// texto con espaciado y compresión horizontal; devuelve dónde termina
function escribir(ctx, texto, x, linea, { tam, fuente, peso = '400', espacio = 0, ancho = 1 }) {
  ctx.save();
  ctx.font = `${peso} ${tam}px ${fuente}`;
  ctx.translate(x, linea);
  ctx.scale(ancho, 1);
  let cx = 0;
  for (const ch of texto) { ctx.fillText(ch, cx, 0); cx += ctx.measureText(ch).width + espacio; }
  ctx.restore();
  return x + (cx - espacio) * ancho;
}

let texMarca = null;
function texturaMarca() {
  if (texMarca) return texMarca;
  texMarca = lienzoTira((ctx, W, H) => {
    const linea = H * 0.69;
    let x = escribir(ctx, 'GENERALITO', 6, linea, { tam: 34, fuente: SERIF, peso: '700', espacio: 4.5 });
    // rombo separador
    const cx = x + 22, cy = linea - 11;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy);
    ctx.closePath(); ctx.fill();
    x = escribir(ctx, 'POLICROMÍA', cx + 22, linea, { tam: 27, fuente: SANS, peso: '400', espacio: 5, ancho: 0.9 });
    x = escribir(ctx, 'ARTISTAS', x + 30, linea, { tam: 20, fuente: SANS, peso: '700', espacio: 6, ancho: 0.9 });
  }, 31);
  return texMarca;
}

function texturaCodigo(cfg) {
  return lienzoTira((ctx, W, H) => {
    const linea = H * 0.69;
    let x = escribir(ctx, cfg.numero, 6, linea, { tam: 30, fuente: SANS, peso: '700', espacio: 2, ancho: 0.95 });
    x = escribir(ctx, cfg.color, x + 18, linea, { tam: 24, fuente: SANS, peso: '400', espacio: 4.5, ancho: 0.92 });
    x = escribir(ctx, 'AR · 7,2 mm', x + 34, linea, { tam: 17, fuente: SANS, peso: '400', espacio: 2.5, ancho: 0.9 });
    // código de barras, chiquito, al final
    let bx = x + 38;
    const alto = 22, top = linea - alto;
    let semilla = Number(cfg.numero) * 7919;
    for (let i = 0; i < 31 && bx < W - 10; i++) {
      semilla = (semilla * 1103515245 + 12345) >>> 0;
      const anchoBarra = 1.6 + ((semilla >>> 16) % 3) * 1.3;
      const hueco = 1.6 + ((semilla >>> 20) % 3) * 1.2;
      const largo = i === 0 || i === 15 || i === 30 ? 5 : 0;
      ctx.fillRect(bx, top, anchoBarra, alto + largo);
      bx += anchoBarra + hueco;
    }
  }, Number(cfg.numero));
}

// ── materiales ──
const DESPLAZ = 0.1;
function crearMateriales(cfg) {
  const cc = obtenerCamposCuerpo();
  const pintura = recibirSombra(new THREE.MeshPhysicalMaterial({
    map: texturaColorCuerpo(cfg),
    roughness: 1,
    roughnessMap: cc.orm,
    normalMap: cc.normal,
    normalScale: new THREE.Vector2(1, 1),
    clearcoat: 0.3,
    clearcoatRoughness: 0.32,
    specularIntensity: 0.6,
    dithering: true,
  }), { envoltura: 0.05, colorSSS: [0.8, 0.5, 0.35], desplazamiento: DESPLAZ });

  // el capuchón: la misma pintura, más espesa, más oscura y más brillante
  const capuchon = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(cfg.pintura).multiplyScalar(0.86),
    roughness: 0.26,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    specularIntensity: 0.6,
    dithering: true,
  }), { envoltura: 0.05, colorSSS: [0.8, 0.5, 0.35], desplazamiento: DESPLAZ });

  const tp = obtenerTexturasPunta();
  const punta = recibirSombra(conMina(new THREE.MeshPhysicalMaterial({
    map: tp.color,
    roughness: 1,
    roughnessMap: tp.orm,
    normalMap: tp.normal,
    normalScale: new THREE.Vector2(1, 1),
    specularIntensity: 0.45,
    dithering: true,
  }), cfg), { envoltura: 0.12, colorSSS: [1, 0.72, 0.5], desplazamiento: DESPLAZ });

  const plata = cfg.impresion === 'plata';
  const opcionesTexto = {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...(plata
      ? { color: 0xc9c9c3, metalness: 1, roughness: 0.28, envMapIntensity: 1.3 }
      : { color: 0xf1eee6, metalness: 0, roughness: 0.5 }),
  };
  const marca = recibirSombra(new THREE.MeshPhysicalMaterial({ ...opcionesTexto, alphaMap: texturaMarca() }), { desplazamiento: DESPLAZ, clave: 'texto' });
  const codigo = recibirSombra(new THREE.MeshPhysicalMaterial({ ...opcionesTexto, alphaMap: texturaCodigo(cfg) }), { desplazamiento: DESPLAZ, clave: 'texto' });
  return { pintura, capuchon, punta, marca, codigo };
}

let geometrias = null;
const materiales = new Map();

export function crear(variante = variantes[0]) {
  const cfg = VARIANTES[variante] || VARIANTES[variantes[0]];
  if (!geometrias) {
    geometrias = {
      punta: geometriaPunta(),
      cuerpo: geometriaCuerpo(),
      capuchon: geometriaCapuchon(),
      marca: geometriaTira(TIRAS[0]),
      codigo: geometriaTira(TIRAS[1]),
    };
  }
  if (!materiales.has(variante)) materiales.set(variante, crearMateriales(cfg));
  const m = materiales.get(variante);
  const malla = new THREE.Group();
  malla.name = `lapiz-color-${variante}`;
  for (const [parte, mat] of [['punta', m.punta], ['cuerpo', m.pintura], ['capuchon', m.capuchon], ['marca', m.marca], ['codigo', m.codigo]]) {
    const me = new THREE.Mesh(geometrias[parte], mat);
    me.name = parte;
    if (parte === 'marca' || parte === 'codigo') me.renderOrder = 1;
    malla.add(me);
  }
  return {
    malla,
    cuerpo: {
      // cápsula: rueda como un lápiz redondo de verdad
      medias: [X_FIN - 0.36, 0, 0],
      radio: 0.36,
      masa: 4.5,
      material: 'madera',
    },
  };
}
