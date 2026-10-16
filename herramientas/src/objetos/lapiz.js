// ─────────────────────────────────────────────────────────────
//  Lápiz de grafito hexagonal con goma.
//
//  Piezas, en coords locales (cm, eje largo en x, punta hacia −x, una
//  cara del hexágono apoyada abajo):
//  · cuerpo: prisma hexagonal de aristas redondeadas, laqueado;
//  · punta: el cono que deja el sacapuntas, de cedro con la mina de
//    grafito. Donde el cono corta el hexágono queda el festón de seis
//    arcos: en el centro de cada cara la laca llega más cerca de la
//    punta que en las aristas;
//  · estampado: texto en foil dorado sobre la cara de arriba;
//  · virola: chapa de aluminio o latón con anillos, moleteado y
//    marcas de crimpado;
//  · goma: cilindro de canto redondeado, mate y algo translúcido.
//
//  Todo procedural. Las geometrías y texturas se cachean a nivel de
//  módulo: varias instancias comparten todo.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { hash, ruido, fbm, lienzo, texturaDeLienzo, texturaDeDatos, recibirSombra, linealASrgb } from '../util.js';
import { PALETA } from '../paleta.js';

export const nombre = 'lapiz';
export const variantes = ['rojo', 'verde'];

const VARIANTES = {
  rojo: { laca: PALETA.rojo, metal: 'aluminio', goma: PALETA.rosa },
  verde: { laca: PALETA.verde, metal: 'laton', goma: 0xe0928c },
};

// ── medidas (cm) ──
const AP = 0.35;                  // apotema: 0,70 cm entre caras
const RC = 0.06;                  // radio de redondeo de las aristas
const TAN_A = 0.2;                // tangente del semiángulo del cono (≈ 11°)
const SEN_A = TAN_A / Math.hypot(1, TAN_A);
const COS_A = 1 / Math.hypot(1, TAN_A);
const RHO = 0.02;                 // radio de la punta roma de la mina
const R_MINA = 0.1;               // mina de 2 mm
const X_PUNTA = -9.25;            // punta real (roma)
const X_AP = X_PUNTA + RHO - RHO / SEN_A; // vértice ideal del cono
const XC_TAPA = X_AP + RHO / SEN_A;       // centro de la esfera de la punta
const XF0 = 7.6;                  // empieza la virola
const LF = 1.05;                  // largo de la virola
const XF1 = XF0 + LF;
const X_FIN = 9.25;               // fin de la goma
const RF = 0.4;                   // radio exterior de la virola
const RG = 0.338;                 // radio de la goma
const LC = 2.05;                  // largo de cono que cubre la textura de la punta
const TH0 = Math.PI;              // ángulo donde empiezan las uv (la cara de abajo)
const BISEL = 0.012;              // ancho del bisel en el borde laca/madera

// ── utilidades ──
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const suave = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lineal = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
// lineal → byte sRGB con una tabla (pow por texel es lo más caro de las texturas)
const TABLA_SRGB = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) TABLA_SRGB[i] = Math.round(linealASrgb(i / 4096) * 255);
const aSrgb = (x) => TABLA_SRGB[(sat(x) * 4096) | 0];
const aByte = (x) => Math.round(sat(x) * 255);

// Mapa normal desde un campo de alturas en cm. tamU(x), tamV(x): tamaño
// físico del texel (cm) en cada columna, para que la pendiente sea real.
function normalDeCampo(H, W, Hh, tamU, tamV, { envolverU = false, envolverV = false, fuerza = 1 } = {}) {
  const datos = new Uint8Array(W * Hh * 4);
  const tu = new Float32Array(W), tv = new Float32Array(W);
  for (let x = 0; x < W; x++) { tu[x] = tamU(x); tv[x] = tamV(x); }
  for (let y = 0; y < Hh; y++) {
    const ya = envolverV ? (y - 1 + Hh) % Hh : Math.max(0, y - 1);
    const yb = envolverV ? (y + 1) % Hh : Math.min(Hh - 1, y + 1);
    const pasosV = envolverV ? 2 : yb - ya;
    for (let x = 0; x < W; x++) {
      const xa = envolverU ? (x - 1 + W) % W : Math.max(0, x - 1);
      const xb = envolverU ? (x + 1) % W : Math.min(W - 1, x + 1);
      const pasosU = envolverU ? 2 : xb - xa;
      const gx = (H[y * W + xb] - H[y * W + xa]) / (pasosU * tu[x]);
      const gy = (H[yb * W + x] - H[ya * W + x]) / (pasosV * tv[x]);
      const nx = -gx * fuerza, ny = -gy * fuerza, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * W + x) * 4;
      datos[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      datos[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      datos[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      datos[o + 3] = 255;
    }
  }
  return datos;
}

// ── perfil del hexágono redondeado ──
// Lista cerrada de puntos de la sección (plano yz), en ángulo creciente
// (de +y hacia +z), empezando en el centro de la cara de abajo. Cada uno
// con su normal, su ángulo desenrollado, el largo de arco (v) y la x
// donde el cono de la punta lo alcanza (el festón).
const PERFIL = (() => {
  const NF = 10, NA = 5; // segmentos por cara plana y por arista
  const w = (AP - RC) * Math.tan(Math.PI / 6);
  const rc = (AP - RC) / Math.cos(Math.PI / 6);
  const p = [];
  for (let k = 0; k < 6; k++) {
    const f = (k * Math.PI) / 3;
    const n = [Math.cos(f), Math.sin(f)], t = [-Math.sin(f), Math.cos(f)];
    for (let i = 0; i < NF; i++) {
      const s = -w + (2 * w * i) / NF;
      p.push({ y: AP * n[0] + s * t[0], z: AP * n[1] + s * t[1], ny: n[0], nz: n[1], cara: k, arista: -1 });
    }
    const c = [rc * Math.cos(f + Math.PI / 6), rc * Math.sin(f + Math.PI / 6)];
    for (let i = 0; i < NA; i++) {
      const b = f + (Math.PI / 3) * (i / NA);
      p.push({ y: c[0] + RC * Math.cos(b), z: c[1] + RC * Math.sin(b), ny: Math.cos(b), nz: Math.sin(b), cara: k, arista: i === 0 ? -1 : k });
    }
  }
  const ini = 3 * (NF + NA) + NF / 2;
  const q = [...p.slice(ini), ...p.slice(0, ini)].map((o) => ({ ...o }));
  q.push({ ...q[0] });
  let largo = 0, previo = null;
  for (const o of q) {
    let a = Math.atan2(o.z, o.y);
    if (previo === null) a = TH0;
    else { while (a < previo.th - 1e-7) a += 2 * Math.PI; largo += Math.hypot(o.y - previo.y, o.z - previo.z); }
    o.th = a;
    o.s = largo;
    o.r = Math.hypot(o.y, o.z);
    o.xb = X_AP + o.r / TAN_A;
    previo = o;
  }
  q[q.length - 1].th = TH0 + 2 * Math.PI;
  for (const o of q) o.v = o.s / largo;
  q.largo = largo;
  return q;
})();

// Radio del hexágono redondeado en la dirección θ (para el festón en las texturas).
function radioHex(th) {
  const sector = Math.PI / 3;
  let d = th - Math.round(th / sector) * sector; // ángulo desde la normal de la cara más cercana
  d = Math.abs(d);
  const w = (AP - RC) * Math.tan(Math.PI / 6);
  if (AP * Math.tan(d) <= w) return AP / Math.cos(d);
  const rc = (AP - RC) / Math.cos(Math.PI / 6);
  const ec = Math.cos(d - Math.PI / 6) * rc; // e·c
  return ec + Math.sqrt(Math.max(0, ec * ec - rc * rc + RC * RC));
}

// ── geometría ──
function grilla(filas, NC, pos, nor, uv) {
  const idx = [];
  for (let i = 0; i < filas - 1; i++) for (let j = 0; j < NC - 1; j++) {
    const a = i * NC + j, b = a + NC;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// normal del bisel en el borde laca/madera: entre la del prisma y la del cono
function normalBisel(o) {
  const c = Math.cos(o.th), s = Math.sin(o.th);
  const n = [-SEN_A, o.ny + COS_A * c, o.nz + COS_A * s];
  const l = Math.hypot(...n);
  return n.map((x) => x / l);
}

const U0 = -7.6, U1 = XF0 + 0.05; // tramo de x que cubre la textura de la laca

function geometriaCuerpo() {
  const pos = [], nor = [], uv = [];
  const filas = [
    (o) => [o.xb, normalBisel(o)],
    (o) => [o.xb + BISEL, [0, o.ny, o.nz]],
    () => [U1, null],
  ];
  for (const f of filas) for (const o of PERFIL) {
    const [x, n] = f(o);
    pos.push(x, o.y, o.z);
    nor.push(...(n || [0, o.ny, o.nz]));
    uv.push((x - U0) / (U1 - U0), o.v);
  }
  return grilla(filas.length, PERFIL.length, pos, nor, uv);
}

function geometriaPunta() {
  const pos = [], nor = [], uv = [];
  const NCAP = 3;
  const gMax = Math.PI / 2 - Math.asin(SEN_A);
  const xT = XC_TAPA - RHO * SEN_A; // donde la esfera toca el cono
  const filas = [];
  for (let i = 0; i <= NCAP; i++) filas.push({ tapa: (gMax * i) / NCAP });
  for (const t of [1 / 3, 2 / 3, 1]) filas.push({ t });
  filas.push({ borde: true });
  for (const f of filas) for (const o of PERFIL) {
    const c = Math.cos(o.th), s = Math.sin(o.th);
    let x, r, n;
    if (f.tapa !== undefined) {
      const g = f.tapa;
      x = XC_TAPA - RHO * Math.cos(g);
      r = RHO * Math.sin(g);
      n = [-Math.cos(g), Math.sin(g) * c, Math.sin(g) * s];
    } else if (f.borde) {
      x = o.xb; r = o.r; n = normalBisel(o);
    } else {
      x = xT + (o.xb - BISEL - xT) * f.t;
      r = (x - X_AP) * TAN_A;
      n = [-SEN_A, COS_A * c, COS_A * s];
    }
    pos.push(x, r * c, r * s);
    nor.push(...n);
    uv.push((x - X_AP) / LC, (o.th - TH0) / (2 * Math.PI));
  }
  return grilla(filas.length, PERFIL.length, pos, nor, uv);
}

// Superficie de revolución alrededor de x. perfil: [{x, r, nx, nr, u}]
function torno(perfil, segs) {
  const pos = [], nor = [], uv = [];
  for (const p of perfil) for (let j = 0; j <= segs; j++) {
    const th = TH0 + (2 * Math.PI * j) / segs, c = Math.cos(th), s = Math.sin(th);
    pos.push(p.x, p.r * c, p.r * s);
    nor.push(p.nx, p.nr * c, p.nr * s);
    uv.push(p.u, j / segs);
  }
  return grilla(perfil.length, segs + 1, pos, nor, uv);
}

// normales de un perfil (x, r) por diferencias centradas
function normalesPerfil(pts) {
  const n = pts.length;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dr = b.r - a.r, l = Math.hypot(dx, dr) || 1;
    p.nx = -dr / l; p.nr = dx / l;
  });
  return pts;
}

// Simplifica un perfil denso (Ramer–Douglas–Peucker) conservando normales.
function simplificar(pts, tol) {
  const marca = new Uint8Array(pts.length);
  marca[0] = marca[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dr = B.r - A.r, l = Math.hypot(dx, dr) || 1;
    let dmax = 0, imax = -1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      let d = Math.abs((P.x - A.x) * dr - (P.r - A.r) * dx) / l;
      // también cuenta el giro de la normal: los reflejos lo delatan
      d = Math.max(d, (1 - (P.nx * A.nx + P.nr * A.nr)) * 0.01, (1 - (P.nx * B.nx + P.nr * B.nr)) * 0.01);
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (dmax > tol && imax > 0) { marca[imax] = 1; pila.push([a, imax], [imax, b]); }
  }
  return pts.filter((_, i) => marca[i]);
}

// Perfil de la virola: s = distancia desde su borde del lado del cuerpo.
const VALLES = [0.175, 0.285, 0.395, 0.655, 0.765, 0.875];
const S_MOLETEADO = [0.445, 0.605];
function radioVirola(s) {
  let r = RF;
  for (const c of VALLES) {
    const t = (s - c) / 0.055;
    if (Math.abs(t) < 1) r -= 0.021 * (1 - t * t) ** 3;
  }
  r -= 0.008 * Math.exp(-(((s - 0.525) / 0.095) ** 8)); // banda moleteada, apenas hundida
  r += 0.004 * Math.exp(-(((s - 0.06) / 0.028) ** 2)) + 0.004 * Math.exp(-(((s - (LF - 0.06)) / 0.028) ** 2));
  // bordes de la chapa doblados hacia adentro, abrazando madera y goma
  const E = 0.03;
  if (s < E) { const t = 1 - s / E; r -= (RF - 0.338) * (1 - Math.sqrt(Math.max(0, 1 - t * t))); }
  if (s > LF - E) { const t = 1 - (LF - s) / E; r -= (RF - (RG - 0.006)) * (1 - Math.sqrt(Math.max(0, 1 - t * t))); }
  return r;
}

function geometriaVirola() {
  // muestreo fino y parejo en largo de arco (los bordes doblados son casi
  // verticales), después se simplifica
  const M = 3000, paso = 0.002, densos = [];
  let previo = null, acum = 0;
  for (let i = 0; i <= M; i++) {
    const s = (LF * i) / M, p = { x: XF0 + s, r: radioVirola(s), u: s / LF };
    if (previo) acum += Math.hypot(p.x - previo.x, p.r - previo.r);
    if (!previo || acum >= paso || i === M) { densos.push(p); acum = 0; }
    previo = p;
  }
  normalesPerfil(densos);
  const pts = simplificar(densos, 0.0005);
  return torno(pts, 64);
}

// Perfil de la goma: lado recto, canto redondeado y la cara del extremo
// apenas abombada. u = largo de arco normalizado.
const PERFIL_GOMA = (() => {
  const x0 = XF1 - 0.1, RFG = 0.1, xe = X_FIN - 0.012;
  const pts = [];
  for (const t of [0, 0.35, 0.7, 1]) pts.push({ x: x0 + (xe - RFG - x0) * t, r: RG });
  for (let i = 1; i <= 7; i++) {
    const b = (i / 7) * (Math.PI / 2);
    pts.push({ x: xe - RFG + RFG * Math.sin(b), r: RG - RFG + RFG * Math.cos(b) });
  }
  const r0 = RG - RFG;
  for (const t of [0.75, 0.5, 0.25, 0]) pts.push({ x: xe + 0.012 * (1 - t * t), r: r0 * t });
  normalesPerfil(pts);
  // los extremos: lado recto y polo del centro
  pts[0].nx = 0; pts[0].nr = 1;
  const ult = pts[pts.length - 1]; ult.nx = 1; ult.nr = 0;
  let largo = 0;
  pts.forEach((p, i) => { if (i) largo += Math.hypot(p.x - pts[i - 1].x, p.r - pts[i - 1].r); p.u = largo; });
  pts.forEach((p) => { p.u /= largo; });
  pts.largo = largo;
  pts.uCara = pts[4 + 6].u; // donde termina el canto y empieza la cara
  return pts;
})();

// (x, r) de la goma en la coordenada u del perfil
function puntoGoma(u) {
  const P = PERFIL_GOMA;
  let i = 0;
  while (i < P.length - 2 && P[i + 1].u < u) i++;
  const t = sat((u - P[i].u) / (P[i + 1].u - P[i].u || 1));
  return [P[i].x + (P[i + 1].x - P[i].x) * t, P[i].r + (P[i + 1].r - P[i].r) * t];
}

function geometriaGoma() {
  return torno(PERFIL_GOMA, 48);
}

// Calcomanía del estampado: un rectángulo apenas encima de la cara de arriba.
// El texto se lee de la virola hacia la punta (−x), con la parte de arriba
// de las letras hacia +z.
const ESTAMPADO = { centro: 4.55, largo: 3.3, alto: 0.27 };
function geometriaEstampado() {
  const { centro, largo, alto } = ESTAMPADO;
  const y = AP + 0.0006;
  const xa = centro + largo / 2, xb = centro - largo / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([xa, y, -alto / 2, xb, y, -alto / 2, xb, y, alto / 2, xa, y, alto / 2], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

// ── texturas ──

// Campo suave: se evalúa f(u, v) en una grilla gruesa de cw × ch celdas y
// se interpola a los centros de los texels de una textura de W × H. El
// ruido de baja frecuencia no necesita calcularse en cada texel.
function campoGrueso(cw, ch, f, W, H) {
  const g = new Float32Array((cw + 1) * (ch + 1));
  for (let j = 0; j <= ch; j++) for (let i = 0; i <= cw; i++) g[j * (cw + 1) + i] = f(i / cw, j / ch);
  const iu = new Int32Array(W), fu = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const p = ((x + 0.5) / W) * cw, i = Math.min(cw - 1, p | 0);
    iu[x] = i; fu[x] = p - i;
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const p = ((y + 0.5) / H) * ch, j = Math.min(ch - 1, p | 0), fy = p - j;
    const f0 = j * (cw + 1), f1 = f0 + cw + 1;
    for (let x = 0; x < W; x++) {
      const i = iu[x], t = fu[x];
      const a = g[f0 + i] + (g[f0 + i + 1] - g[f0 + i]) * t;
      const c = g[f1 + i] + (g[f1 + i + 1] - g[f1 + i]) * t;
      out[y * W + x] = a + (c - a) * fy;
    }
  }
  return out;
}

// Laca: campos compartidos por las variantes (manchas, vetas de la hilera,
// variación de brillo) y a qué cara o arista corresponde cada fila.
const TL = { W: 512, H: 128 };
let camposLaca = null;
function obtenerCamposLaca() {
  if (camposLaca) return camposLaca;
  const { W, H } = TL;
  const largoX = U1 - U0;
  const manchas = campoGrueso(128, 32, (u, v) => fbm(u * largoX * 0.9, v * 5, 3) - 0.5, W, H);
  const vetas = campoGrueso(32, 128, (u, v) => (ruido(v * 60, 3.3) - 0.5) + (ruido(u * largoX * 0.4, v * 60) - 0.5) * 0.6, W, H);
  const rug = campoGrueso(96, 48, (u, v) => fbm(u * largoX * 1.4 + 7, v * 9, 3) - 0.5, W, H);
  const f = new Float32Array(W * H);
  for (let o = 0; o < W * H; o++) f[o] = manchas[o] * 0.06 + vetas[o] * 0.016;
  const cara = new Int8Array(H), arista = new Int8Array(H);
  let k = 0;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    while (k < PERFIL.length - 2 && PERFIL[k + 1].v < v) k++;
    const A = PERFIL[k], B = PERFIL[k + 1];
    cara[y] = A.cara;
    arista[y] = A.arista >= 0 ? A.arista : B.arista;
  }
  // v del centro de cada arista
  const vArista = [];
  for (let a = 0; a < 6; a++) {
    const pts = PERFIL.filter((o) => o.arista === a);
    vArista[a] = pts[Math.floor(pts.length / 2)].v;
  }
  camposLaca = { f, rug, cara, arista, vArista };
  return camposLaca;
}

// Desgaste: un saltadito de laca en una arista (x, arista, largo en cm).
const SALTADOS = [{ x: -3.4, arista: 1, l: 0.045 }];

function texturasLaca(hexLaca) {
  const { W, H } = TL;
  const { f, rug, cara, arista, vArista } = obtenerCamposLaca();
  const [br, bg, bb] = lineal(hexLaca).map((c) => c * 0.9);
  const madera = lineal(0xc39468);
  const color = new Uint8Array(W * H * 4), capa = new Uint8Array(W * H * 4);
  const tintes = [0.01, -0.008, 0.004, -0.01, 0.008, -0.004];
  const xDe = (x) => U0 + ((x + 0.5) / W) * (U1 - U0);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    // en las aristas la laca queda más fina y se gasta con el uso: más clara
    // y menos lustrosa, a manchones a lo largo
    const enArista = arista[y] >= 0;
    const tinte = tintes[cara[y]] + (enArista ? 0.03 : 0);
    for (let x = 0; x < W; x++) {
      const X = xDe(x), o = y * W + x;
      const gasto = enArista ? sat((ruido(X * 3 + arista[y] * 17, 0.5) - 0.45) * 3) * (0.6 + 0.8 * (ruido(X * 18, arista[y] * 5.3) - 0.5)) : 0;
      let k = (1 + f[o] + tinte + gasto * 0.09) * (1 - 0.4 * suave(XF0 - 0.05, XF0 + 0.01, X)); // contacto con la virola
      let r = br * k, g = bg * k, b = bb * k, cc = 1;
      for (let i = 0; i < SALTADOS.length; i++) {
        const sd = SALTADOS[i];
        if (Math.abs(X - sd.x) > sd.l * 1.5) continue;
        const dx = (X - sd.x) / sd.l;
        const dv = ((v - vArista[sd.arista]) * PERFIL.largo) / (sd.l * 0.5);
        const d = dx * dx + dv * dv + (ruido(X * 90, v * 300) - 0.5) * 0.8;
        if (d < 1) {
          const m = suave(1, 0.5, d);
          r += (madera[0] - r) * m; g += (madera[1] - g) * m; b += (madera[2] - b) * m; cc *= 1 - m;
        }
      }
      color[o * 4] = aSrgb(r); color[o * 4 + 1] = aSrgb(g); color[o * 4 + 2] = aSrgb(b); color[o * 4 + 3] = 255;
      capa[o * 4] = aByte(cc);
      capa[o * 4 + 1] = aByte(0.07 + rug[o] * 0.06 + gasto * 0.12 + (1 - cc) * 0.6);
      capa[o * 4 + 3] = 255;
    }
  }
  return { color: texturaDeDatos(color, W, H, { srgb: true }), capa: texturaDeDatos(capa, W, H) };
}

// Punta: madera de cedro con su veta, la mina, y la laca cortada en el festón.
// u: x desde el vértice del cono (LC cm); v: ángulo alrededor del eje.
const TP = { W: 384, H: 192 };
// tipo de cada texel: madera (0, el valor inicial), grafito, o tapado por la laca
const MAT_GRAFITO = 1, MAT_OCULTO = 2;
let camposPunta = null;
function obtenerCamposPunta() {
  if (camposPunta) return camposPunta;
  const { W, H } = TP;
  const tipo = new Uint8Array(W * H);
  const tono = new Float32Array(W * H);
  const alto = new Float32Array(W * H);
  const psi = 0.55, cps = Math.cos(psi), sps = Math.sin(psi);
  const psiG = 1.15, cG = Math.cos(psiG), sG = Math.sin(psiG); // plano del pegado de las dos tablillas
  const lento = campoGrueso(64, 64, (u, v) => {
    const th = TH0 + 2 * Math.PI * v, X = u * LC, r = X * TAN_A;
    return fbm(r * Math.cos(th) * 6 + 11, r * Math.sin(th) * 6 + X * 0.3, 2) - 0.5;
  }, W, H);
  // marcas de traqueteo de la cuchilla: anillos finos, de fase y fuerza variables
  const faseTraq = campoGrueso(64, 32, (u, v) => ruido((TH0 + 2 * Math.PI * v) * 3, u * LC) * 4, W, H);
  const ampTraq = campoGrueso(64, 32, (u, v) => suave(0.2, 0.9, ruido(u * LC * 3, (TH0 + 2 * Math.PI * v) * 2)), W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, th = TH0 + 2 * Math.PI * v;
    const c = Math.cos(th), s = Math.sin(th);
    const xb = X_AP + radioHex(th) / TAN_A;
    const rMina = R_MINA + (ruido(v * 26, 7.7) - 0.5) * 0.008;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, X = X_AP + u * LC, o = y * W + x;
      const r = (X - X_AP) * TAN_A;
      if (r < rMina) {
        tipo[o] = MAT_GRAFITO;
        const rayas = ruido(X * 3, th * 60) - 0.5;
        tono[o] = rayas;
        alto[o] = rayas * 0.0005;
        continue;
      }
      // distancia al festón (el corte de la pintura lo dibuja el shader)
      const d = xb - X;
      if (d < -0.012) { tipo[o] = MAT_OCULTO; continue; } // más allá del festón: no se ve
      const py = r * c, pz = r * s;
      // veta: los anillos son casi paralelos en la sección; el cono los
      // corta en ángulo y quedan arcos alargados
      const q = py * cps + pz * sps + 0.5 * (pz * cps - py * sps) ** 2;
      const fase = q / 0.07 + (ruido(py * 5 + 3, pz * 5 + X * 0.25) - 0.5) * 0.35;
      const dd = fase - Math.floor(fase);
      const tardio = suave(0.55, 0.78, dd) * (1 - suave(0.86, 0.98, dd));
      // fibras: ruido fino en la sección, que el cono estira a lo largo
      const fibra = ruido(py * 70 + X * 0.8, pz * 70) - 0.5;
      const dp = (-py * sG + pz * cG) / 0.0035;
      const pegado = r > 0.12 && dp * dp < 9 ? Math.exp(-dp * dp) : 0;
      const cercaMina = r - rMina < 0.06;
      const polvo = cercaMina ? 1 - suave(rMina, rMina + 0.06, r) : 0; // polvo de grafito junto a la mina
      const da = (r - rMina - 0.004) / 0.004;
      const anillo = cercaMina && da * da < 9 ? Math.exp(-da * da) : 0; // pegamento alrededor de la mina
      tono[o] = -0.11 * tardio + 0.06 * fibra - 0.16 * pegado - 0.28 * polvo - 0.3 * anillo + lento[o] * 0.06;
      const traqueteo = Math.sin(((X - X_AP) * 2 * Math.PI) / 0.045 + faseTraq[o]) * ampTraq[o];
      alto[o] = fibra * 0.0005 - tardio * 0.0003 + traqueteo * 0.00025 + 0.0004 * suave(0.019, 0.012, d);
    }
  }
  const datosNormal = normalDeCampo(alto, W, H, () => LC / W,
    (x) => Math.max(0.03, ((x + 0.5) / W) * LC * TAN_A) * ((2 * Math.PI) / H), { envolverV: true });
  camposPunta = { tipo, tono, normal: texturaDeDatos(datosNormal, W, H) };
  return camposPunta;
}

function texturasPunta(hexLaca) {
  const { W, H } = TP;
  const { tipo, tono, normal } = obtenerCamposPunta();
  const madera = lineal(0xd5b393), rojiza = lineal(0xc99a7a);
  const grafito = lineal(0x6a6a68);
  const laca = lineal(hexLaca).map((c) => c * 0.9);
  const rojizo = campoGrueso(40, 24, (u, v) => sat(fbm(u * 5 + 3, v * 3, 2) * 1.6 - 0.55) * 0.3, W, H);
  const color = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x, t = tono[o], tp = tipo[o];
      let r, g, b, rug, met = 0;
      if (tp === MAT_GRAFITO) {
        const k = 1 + t * 0.3;
        r = grafito[0] * k; g = grafito[1] * k; b = grafito[2] * k; rug = 0.34 + t * 0.12; met = 0.7;
      } else if (tp === MAT_OCULTO) {
        r = laca[0]; g = laca[1]; b = laca[2]; rug = 0.55;
      } else {
        const m = rojizo[o], k = 1 + t;
        r = (madera[0] + (rojiza[0] - madera[0]) * m) * k;
        g = (madera[1] + (rojiza[1] - madera[1]) * m) * k;
        b = (madera[2] + (rojiza[2] - madera[2]) * m) * k;
        rug = 0.62 - t * 0.2;
      }
      color[o * 4] = aSrgb(r); color[o * 4 + 1] = aSrgb(g); color[o * 4 + 2] = aSrgb(b); color[o * 4 + 3] = 255;
      orm[o * 4] = 255; orm[o * 4 + 1] = aByte(rug); orm[o * 4 + 2] = aByte(met); orm[o * 4 + 3] = 255;
    }
  }
  return { color: texturaDeDatos(color, W, H, { srgb: true }), orm: texturaDeDatos(orm, W, H), normal };
}

// Virola: moleteado, marcas de crimpado y el pulido circular de la chapa.
// u: s/LF a lo largo; v: ángulo. Color en gris (lo tiñe el material).
const TV = { W: 128, H: 384 };
const CRIMPADOS = [
  ...[0, 1, 2, 3].map((i) => ({ s: 0.1, v: 0.125 + i * 0.25 })),
  ...[0, 1, 2, 3].map((i) => ({ s: 0.96, v: i * 0.25 + 0.03 })),
];
let texVirola = null;
function obtenerTexturasVirola() {
  if (texVirola) return texVirola;
  const { W, H } = TV;
  const alto = new Float32Array(W * H);
  const color = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  const NM = 36; // estrías del moleteado
  const circ = 2 * Math.PI * RF;
  // todo lo que depende sólo de s, por columna
  const pulido = new Float32Array(W), hondo = new Float32Array(W), banda = new Float32Array(W);
  const cerca = [];
  for (let x = 0; x < W; x++) {
    const s = ((x + 0.5) / W) * LF;
    pulido[x] = (hash(x, 17) - 0.5) * 0.6 + (ruido(x * 0.15, 3) - 0.5);
    hondo[x] = sat((RF - radioVirola(s)) / 0.02);
    banda[x] = suave(S_MOLETEADO[0], S_MOLETEADO[0] + 0.02, s) * (1 - suave(S_MOLETEADO[1] - 0.02, S_MOLETEADO[1], s));
    cerca[x] = CRIMPADOS.filter((cp) => Math.abs(s - cp.s) < 0.06);
  }
  const mugre = campoGrueso(32, 64, (u, v) => fbm(u * LF * 9, v * 14, 3) - 0.5, W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const fase = v * NM - Math.floor(v * NM);
    const estria = Math.cos(2 * Math.PI * fase);
    for (let x = 0; x < W; x++) {
      const s = ((x + 0.5) / W) * LF, o = y * W + x;
      let h = pulido[x] * 0.00012 + banda[x] * 0.009 * estria;
      let ao = 1;
      const cs = cerca[x];
      for (let i = 0; i < cs.length; i++) {
        const cp = cs[i];
        let dv = v - cp.v; dv -= Math.round(dv);
        const d2 = ((s - cp.s) / 0.028) ** 2 + ((dv * circ) / 0.022) ** 2;
        if (d2 < 3) { const e = Math.exp(-d2 * 1.6); h -= 0.006 * e; ao -= 0.45 * e; }
      }
      ao *= 1 - 0.45 * hondo[x];
      alto[o] = h;
      const mg = mugre[o];
      const gr = 0.93 + mg * 0.1 - hondo[x] * 0.12;
      color[o * 4] = color[o * 4 + 1] = color[o * 4 + 2] = aSrgb(gr); color[o * 4 + 3] = 255;
      orm[o * 4] = aByte(ao);
      orm[o * 4 + 1] = aByte(0.16 + Math.abs(pulido[x]) * 0.07 + mg * 0.08 + hondo[x] * 0.1);
      orm[o * 4 + 2] = 255;
      orm[o * 4 + 3] = 255;
    }
  }
  const datosN = normalDeCampo(alto, W, H, () => LF / W, () => circ / H, { envolverV: true });
  texVirola = {
    color: texturaDeDatos(color, W, H, { srgb: true }),
    orm: texturaDeDatos(orm, W, H),
    normal: texturaDeDatos(datosN, W, H),
  };
  return texVirola;
}

// Goma: grano, poros, variación de tono y un poco de grafito en la cara
// del extremo. El ruido se evalúa en la posición 3D de cada texel, así la
// cara del extremo (donde las uv convergen al centro) no queda rayada.
let texGoma = null;
function obtenerTexturasGoma() {
  if (texGoma) return texGoma;
  const W = 96, H = 192;
  const alto = new Float32Array(W * H);
  const color = new Uint8Array(W * H * 4);
  const cols = [];
  for (let x = 0; x < W; x++) cols.push(puntoGoma((x + 0.5) / W));
  for (let y = 0; y < H; y++) {
    const th = TH0 + (2 * Math.PI * (y + 0.5)) / H, c = Math.cos(th), sn = Math.sin(th);
    for (let x = 0; x < W; x++) {
      const [X, R] = cols[x], o = y * W + x;
      const py = R * c, pz = R * sn, k = X - XF1;
      const grano = ruido(py * 55 + k * 31, pz * 55 - k * 17) - 0.5;
      const poro = ruido(py * 150 + k * 70 + 5, pz * 150 + 9) > 0.86;
      const lento = fbm(py * 4 + k * 3, pz * 4 + 2, 2) - 0.5;
      const cara = suave(PERFIL_GOMA.uCara - 0.12, PERFIL_GOMA.uCara + 0.02, (x + 0.5) / W);
      const tizne = cara * sat(fbm(py * 6 + 3, pz * 6 - 1, 2) * 1.8 - 0.7);
      // la cara del extremo es un corte liso: sin grano ni poros (además, cerca
      // del centro los texels se afinan y el detalle fino quedaría radial)
      const fino = 1 - suave(PERFIL_GOMA.uCara - 0.04, PERFIL_GOMA.uCara + 0.06, (x + 0.5) / W);
      const p = poro && fino > 0.5;
      alto[o] = (grano * 0.0012 - (p ? 0.0025 : 0)) * fino;
      const g = (1 + grano * 0.06 * fino + lento * 0.08) * (1 - 0.2 * tizne) * (p ? 0.86 : 1);
      color[o * 4] = color[o * 4 + 1] = color[o * 4 + 2] = aSrgb(g * 0.98); color[o * 4 + 3] = 255;
    }
  }
  const datosN = normalDeCampo(alto, W, H, () => PERFIL_GOMA.largo / W,
    (x) => (2 * Math.PI * Math.max(0.03, cols[x][1])) / H, { envolverV: true });
  texGoma = { color: texturaDeDatos(color, W, H, { srgb: true }), normal: texturaDeDatos(datosN, W, H) };
  return texGoma;
}

// Estampado en foil: texto en lienzo, con bordes y huecos irregulares.
let texEstampado = null;
function obtenerTexturaEstampado() {
  if (texEstampado) return texEstampado;
  const W = 768, H = 64; // 3,3 cm × 0,27 cm
  const c = lienzo(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const linea = H * 0.74;
  const escribir = (texto, x0, tam, espacio, peso = '700') => {
    ctx.font = `${peso} ${tam}px Georgia, "Times New Roman", serif`;
    let x = x0;
    for (const ch of texto) { ctx.fillText(ch, x, linea); x += ctx.measureText(ch).width + espacio; }
    return x;
  };
  let x = escribir('GENERALITO', 5, 41, 5.2);
  // rombo separador
  ctx.beginPath();
  const cx = x + 16, cy = linea - 14;
  ctx.moveTo(cx, cy - 5.2); ctx.lineTo(cx + 5.2, cy); ctx.lineTo(cx, cy + 5.2); ctx.lineTo(cx - 5.2, cy); ctx.closePath(); ctx.fill();
  x = escribir('HB', cx + 19, 41, 4.5);
  ctx.fillRect(x + 13, linea - 2, 105, 2); // filete fino al final
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const oro = [0xec, 0xc8, 0x7a];
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const o = (y * W + xx) * 4;
    let a = d[o + 3] / 255;
    if (a > 0) {
      // foil: bordes apenas comidos y algún hueco
      const n = ruido(xx * 0.45, y * 0.45) - 0.5;
      a = sat((a - 0.5 + n * 0.5) * 2.4 + 0.5);
      if (hash(xx >> 1, y >> 1) > 0.992) a *= 0.2;
    }
    const g = 0.9 + 0.1 * ((xx * 7 + y * 3) % 11) / 11;
    d[o] = oro[0] * g; d[o + 1] = oro[1] * g; d[o + 2] = oro[2] * g;
    d[o + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  texEstampado = texturaDeLienzo(c, { anisotropia: 8 });
  return texEstampado;
}

// ── materiales ──

// El corte de la pintura en el festón se dibuja en el shader, con la
// distancia exacta al borde (la x donde el cono alcanza el hexágono en
// ese ángulo): una banda de laca que se aclara hacia adentro y, contra la
// madera, una línea fina de imprimación. Así queda nítida de cerca.
function conCortePintura(material, hexLaca) {
  const u = {
    uLacaCorte: { value: new THREE.Color(hexLaca).multiplyScalar(0.9) },
    uImprimacion: { value: new THREE.Color(0xe3d2b4) },
  };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalLapiz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalLapiz = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocalLapiz;
        uniform vec3 uLacaCorte;
        uniform vec3 uImprimacion;
        float gPintura = 0.0;
        float distFeston() {
          float th = atan( vLocalLapiz.z, vLocalLapiz.y );
          const float SECT = PI / 3.0;
          float d = abs( th - SECT * floor( th / SECT + 0.5 ) );
          const float AP = ${AP.toFixed(5)}, RC = ${RC.toFixed(5)};
          float w = ( AP - RC ) * tan( PI / 6.0 );
          float rh;
          if ( AP * tan( d ) <= w ) rh = AP / cos( d );
          else {
            float rc = ( AP - RC ) / cos( PI / 6.0 );
            float ec = cos( d - PI / 6.0 ) * rc;
            rh = ec + sqrt( max( 0.0, ec * ec - rc * rc + RC * RC ) );
          }
          float xb = ${X_AP.toFixed(5)} + rh / ${TAN_A.toFixed(5)};
          // borde apenas irregular, como lo deja la cuchilla
          float j = 0.0014 * sin( th * 37.0 + 0.7 ) + 0.0009 * sin( th * 83.0 + 2.1 ) + 0.0006 * sin( th * 151.0 );
          return xb - vLocalLapiz.x + j;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float d = distFeston();
          float aa = max( fwidth( d ), 1e-4 );
          float imp = 0.85 * ( smoothstep( 0.0165 - aa, 0.0175 + aa, d ) - smoothstep( 0.021 - aa, 0.0225 + aa, d ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, uImprimacion, imp );
          gPintura = 1.0 - smoothstep( 0.016 - aa, 0.017 + aa, d );
          diffuseColor.rgb = mix( diffuseColor.rgb, uLacaCorte * ( 0.8 + 0.2 * clamp( d / 0.016, 0.0, 1.0 ) ), gPintura );
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.5, gPintura );`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= 1.0 - gPintura;`);
  };
  material.customProgramCacheKey = () => 'lapiz-feston';
  return material;
}

// Desplazamiento de la muestra de sombra a lo largo de la normal (cm): las
// caras del hexágono casi paralelas a la luz hacían acné con el valor común.
const DESPLAZ = 0.16;
function crearMateriales(variante) {
  const cfg = VARIANTES[variante] || VARIANTES.rojo;
  const tl = texturasLaca(cfg.laca);
  const laca = recibirSombra(new THREE.MeshPhysicalMaterial({
    map: tl.color,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.2,
    clearcoatMap: tl.capa,
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: tl.capa,
    specularIntensity: 0.2,
    dithering: true,
  }), { envoltura: 0.08, colorSSS: [0.9, 0.35, 0.2], desplazamiento: DESPLAZ });

  const tp = texturasPunta(cfg.laca);
  const punta = recibirSombra(conCortePintura(new THREE.MeshPhysicalMaterial({
    map: tp.color,
    roughness: 1,
    roughnessMap: tp.orm,
    metalness: 1,
    metalnessMap: tp.orm,
    normalMap: tp.normal,
    normalScale: new THREE.Vector2(1, 1),
    specularIntensity: 0.7,
    dithering: true,
  }), cfg.laca), { envoltura: 0.25, colorSSS: [1, 0.72, 0.5], desplazamiento: DESPLAZ });

  const tv = obtenerTexturasVirola();
  const esLaton = cfg.metal === 'laton';
  const virola = recibirSombra(new THREE.MeshPhysicalMaterial({
    // latón apenas menos saturado que el de la paleta: si no parece oro
    color: esLaton ? new THREE.Color(PALETA.laton).lerp(new THREE.Color(0xd8d2c0), 0.25) : 0xdedfdb,
    envMapIntensity: 1.25,
    map: tv.color,
    roughness: 1,
    roughnessMap: tv.orm,
    metalness: 1,
    aoMap: tv.orm,
    aoMapIntensity: 1,
    normalMap: tv.normal,
    normalScale: new THREE.Vector2(1, 1),
    dithering: true,
  }), { desplazamiento: DESPLAZ });

  const tg = obtenerTexturasGoma();
  const goma = recibirSombra(new THREE.MeshPhysicalMaterial({
    // más profunda que la paleta: la luz principal le pega de lleno arriba
    color: new THREE.Color(cfg.goma).multiplyScalar(0.72),
    map: tg.color,
    roughness: 0.8,
    normalMap: tg.normal,
    normalScale: new THREE.Vector2(1, 1),
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0xffd6cc),
    specularIntensity: 0.5,
    dithering: true,
  }), { envoltura: 0.4, colorSSS: [1, 0.45, 0.38], desplazamiento: DESPLAZ });

  const estampado = recibirSombra(new THREE.MeshPhysicalMaterial({
    map: obtenerTexturaEstampado(),
    metalness: 1,
    roughness: 0.36,
    envMapIntensity: 1.4,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }), { desplazamiento: DESPLAZ });
  return { laca, punta, virola, goma, estampado };
}

let geometrias = null;
const materiales = new Map();

export function crear(variante = variantes[0]) {
  if (!geometrias) {
    geometrias = {
      cuerpo: geometriaCuerpo(),
      punta: geometriaPunta(),
      virola: geometriaVirola(),
      goma: geometriaGoma(),
      estampado: geometriaEstampado(),
    };
  }
  if (!materiales.has(variante)) materiales.set(variante, crearMateriales(variante));
  const m = materiales.get(variante);
  const malla = new THREE.Group();
  malla.name = `lapiz-${variante}`;
  for (const parte of ['cuerpo', 'punta', 'virola', 'goma', 'estampado']) {
    const mat = parte === 'cuerpo' ? m.laca : m[parte];
    const me = new THREE.Mesh(geometrias[parte], mat);
    me.name = parte;
    if (parte === 'estampado') me.renderOrder = 1;
    malla.add(me);
  }
  return {
    malla,
    cuerpo: {
      // sección: cuadrado muy redondeado de 0,70 de alto (apoya plano como el
      // hexágono) y 0,79 de ancho (cubre las aristas de los costados)
      medias: [X_FIN - 0.25, 0.1, 0.145],
      radio: 0.25,
      masa: 5,
      material: 'madera',
    },
  };
}
