// ─────────────────────────────────────────────────────────────
//  Portaminas de dibujo técnico, 0,5 mm, cuerpo petróleo casi negro.
//
//  Piezas, en coords locales (cm, eje largo en x, punta hacia −x como
//  el lápiz, una cara del hexágono apoyada abajo):
//  · mina de grafito que asoma del tubo guía;
//  · punta cromada: tubo guía de 1 mm, cono escalonado de 1,2 cm y un
//    collar que la separa del agarre;
//  · agarre: cilindro anodizado oscuro con moleteado en diamante (mapa
//    normal en mosaico), con bandas lisas en los extremos;
//  · cuerpo: prisma hexagonal de aristas redondeadas, aluminio anodizado
//    petróleo, torneado en cono en las dos puntas (el cono muerde las
//    aristas y deja un festón), con "0.5" impreso en la cara de arriba;
//  · anillo del clip, tapa y pulsador cromado con su anillo;
//  · clip de acero sobre la cara de arriba a la derecha (+z): con el
//    cuerpo apoyado en una cara, el clip queda de costado, inclinado,
//    como en la foto.
//
//  Todo procedural. Geometrías, texturas y materiales se cachean a nivel
//  de módulo: varias instancias comparten todo.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { hash, ruido, azar, lienzo, texturaDeLienzo, texturaDeDatos, normalDesdeAltura, recibirSombra, linealASrgb } from '../util.js';
import { PALETA } from '../paleta.js';

export const nombre = 'portaminas';
export const variantes = ['petroleo'];

// ── medidas (cm) ──
const LARGO = 14.5;
const X0 = -LARGO / 2;           // punta de la mina
const RADIO = 0.42;              // radio de la caja de colisión
const AP = 0.404;                // apotema del hexágono en las aristas de cada cara
const FLECHA = 0.008;            // abombado de cada cara: 0,82 cm entre centros de caras
const Y_EJE = AP + FLECHA - RADIO; // el eje baja un poco: la cara de abajo apoya en −RADIO
const RC = 0.07;                 // redondeo de las aristas del hexágono
const W_CARA = (AP - RC) * Math.tan(Math.PI / 6); // media cara plana
const R_ARISTA = (AP - RC) / Math.cos(Math.PI / 6) + RC;
// tramos, como distancia d desde la punta de la mina
const D_MINA = 0.08;             // asoma 0,8 mm de mina
const D_GUIA = 0.48;             // tubo guía de 4 mm
const D_CONO = 1.68;             // cono de 1,2 cm
const D_COLLAR = 1.95;
const D_MOL0 = 2.05, D_MOL1 = 5.25; // moleteado
const D_AGARRE = 5.35;
const D_CUERPO = 12.4;           // fin del hexágono
const D_ANILLO = 12.6;           // anillo del clip
const D_TAPA = 13.3;
const D_ANILLO_P = 13.42;        // anillo del pulsador
const D_FIN = LARGO;
const R_MINA = 0.028;
const R_MOL = 0.383;             // radio del moleteado
const R_BANDA = 0.39;            // bandas lisas del agarre
const R_CONO0 = 0.37;            // radio donde el cono del torneado corta el hexágono
const T_CORTE = 0.62;            // pendiente de ese cono (dr/dx)
const B_CLIP = (2 * Math.PI) / 3; // ángulo de la cara del clip (0 = abajo, π/2 = +z)
const N_MOL = 26;                // diamantes alrededor del agarre (paso ≈ 0,9 mm)
const OSCURO = 0.42;             // el anodizado refleja menos que la pintura de la paleta
const PASO_MOL = (2 * Math.PI * R_MOL) / N_MOL;

// dirección en la sección (y, z) para el ángulo β: 0 abajo, π/2 hacia +z, π arriba
const dirY = (b) => -Math.cos(b);
const dirZ = (b) => Math.sin(b);

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const suave = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TABLA_SRGB = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) TABLA_SRGB[i] = Math.round(linealASrgb(i / 4096) * 255);
const aSrgb = (x) => TABLA_SRGB[(sat(x) * 4096) | 0];
const aByte = (x) => Math.round(sat(x) * 255);
const lineal = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ─────────────────────────────────────────────────────────────
//  Geometría
// ─────────────────────────────────────────────────────────────

// Perfil (d, r) con esquinas redondeadas: [[d, r, f]], f = radio del
// redondeo de esa esquina (0: esquina viva).
function perfil(esquinas) {
  const out = [];
  for (let i = 0; i < esquinas.length; i++) {
    const [d, r, f = 0] = esquinas[i];
    if (i === 0 || i === esquinas.length - 1 || f <= 0) { out.push({ d, r }); continue; }
    const [d0, r0] = esquinas[i - 1], [d1, r1] = esquinas[i + 1];
    let ux = d - d0, uy = r - r0; const l1 = Math.hypot(ux, uy); ux /= l1; uy /= l1;
    let vx = d1 - d, vy = r1 - r; const l2 = Math.hypot(vx, vy); vx /= l2; vy /= l2;
    const giro = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (giro < 1e-4) { out.push({ d, r }); continue; }
    const t = Math.min(f * Math.tan(giro / 2), l1 * 0.5, l2 * 0.5);
    const A = [d - ux * t, r - uy * t], B = [d + vx * t, r + vy * t];
    // arco circular tangente a los dos tramos
    const rr = t / Math.tan(giro / 2);
    const lado = ux * vy - uy * vx > 0 ? 1 : -1; // giro a la izquierda o a la derecha
    const cx = A[0] - uy * rr * lado, cy = A[1] + ux * rr * lado;
    const a0 = Math.atan2(A[1] - cy, A[0] - cx);
    let a1 = Math.atan2(B[1] - cy, B[0] - cx);
    while (lado > 0 && a1 < a0) a1 += 2 * Math.PI;
    while (lado < 0 && a1 > a0) a1 -= 2 * Math.PI;
    const n = Math.max(1, Math.min(Math.ceil(giro / 0.24), Math.ceil((rr * giro) / 0.006)));
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      out.push({ d: cx + rr * Math.cos(a), r: cy + rr * Math.sin(a) });
    }
  }
  return out;
}

// Superficie de revolución alrededor del eje (x). Normales del perfil
// suavizadas, salvo donde quiebra más de ~40° (se duplica el anillo).
// uv: u alrededor (0..escalaU), v a lo largo del perfil en cm · escalaV.
function torno(pts, segs, { escalaU = 1, escalaV = 1, v0 = 0, uvD = false } = {}) {
  const n = pts.length;
  const segN = [], largos = [0];
  for (let i = 0; i < n - 1; i++) {
    const dd = pts[i + 1].d - pts[i].d, dr = pts[i + 1].r - pts[i].r, l = Math.hypot(dd, dr) || 1e-9;
    segN.push([-dr / l, dd / l]);
    largos.push(largos[i] + l);
  }
  const anillos = [];
  for (let i = 0; i < n; i++) {
    const a = segN[i - 1], b = segN[i];
    const p = pts[i], v = uvD ? p.d : largos[i];
    if (!a) anillos.push({ ...p, n: b, v, unir: false });
    else if (!b) anillos.push({ ...p, n: a, v, unir: true });
    else if (a[0] * b[0] + a[1] * b[1] < 0.77) {
      anillos.push({ ...p, n: a, v, unir: true });
      anillos.push({ ...p, n: b, v, unir: false });
    } else {
      const m = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(m[0], m[1]);
      anillos.push({ ...p, n: [m[0] / l, m[1] / l], v, unir: true });
    }
  }
  const nv = anillos.length * (segs + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  let k = 0;
  for (const a of anillos) for (let j = 0; j <= segs; j++) {
    const b = (2 * Math.PI * j) / segs, cy = dirY(b), cz = dirZ(b);
    pos[k * 3] = X0 + a.d; pos[k * 3 + 1] = Y_EJE + a.r * cy; pos[k * 3 + 2] = a.r * cz;
    nor[k * 3] = a.n[0]; nor[k * 3 + 1] = a.n[1] * cy; nor[k * 3 + 2] = a.n[1] * cz;
    uv[k * 2] = (j / segs) * escalaU; uv[k * 2 + 1] = (a.v - v0) * escalaV;
    k++;
  }
  const idx = [];
  for (let i = 0; i < anillos.length - 1; i++) {
    if (!anillos[i + 1].unir) continue;
    const f0 = i * (segs + 1), f1 = (i + 1) * (segs + 1);
    for (let j = 0; j < segs; j++) {
      const a = f0 + j, b = f1 + j, c = f0 + j + 1, d = f1 + j + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ── sección del hexágono redondeado ──
// Puntos de la sección en β creciente, empezando en el centro de la cara
// de abajo. Cada uno con dirección radial, radio, normal 2D y v (largo de
// arco normalizado: 0,5 es el centro de la cara de arriba).
const SECCION = (() => {
  const NF = 4, NA = 6;
  const rc = (AP - RC) / Math.cos(Math.PI / 6);
  const p = [];
  for (let k = 0; k < 6; k++) {
    const f = (k * Math.PI) / 3;
    const n = [dirY(f), dirZ(f)], t = [Math.sin(f), Math.cos(f)];
    for (let i = 0; i < NF; i++) {
      // cara apenas abombada (flecha FLECHA): un degradado suave de lado a lado
      const s = -W_CARA + (2 * W_CARA * i) / NF, q = s / W_CARA;
      const e = FLECHA * (1 - q * q), pend = (2 * FLECHA * q) / W_CARA;
      const ln = Math.hypot(1, pend);
      p.push({
        y: (AP + e) * n[0] + s * t[0], z: (AP + e) * n[1] + s * t[1],
        ny: (n[0] + pend * t[0]) / ln, nz: (n[1] + pend * t[1]) / ln,
      });
    }
    const c = [rc * dirY(f + Math.PI / 6), rc * dirZ(f + Math.PI / 6)];
    for (let i = 0; i < NA; i++) {
      const b = f + (Math.PI / 3) * (i / NA);
      p.push({ y: c[0] + RC * dirY(b), z: c[1] + RC * dirZ(b), ny: dirY(b), nz: dirZ(b) });
    }
  }
  // arrancar en el centro de la cara de abajo
  const q = [...p.slice(NF / 2), ...p.slice(0, NF / 2)].map((o) => ({ ...o }));
  q.push({ ...q[0] });
  let largo = 0;
  for (let i = 0; i < q.length; i++) {
    if (i > 0) largo += Math.hypot(q[i].y - q[i - 1].y, q[i].z - q[i - 1].z);
    q[i].s = largo;
    q[i].r = Math.hypot(q[i].y, q[i].z);
  }
  for (const o of q) o.v = o.s / largo;
  q.perimetro = largo;
  return q;
})();

// mínimo suave (polinómico): devuelve valor y peso de a
function smin(a, b, k) {
  const h = sat(0.5 + (0.5 * (b - a)) / k);
  return [b + (a - b) * h - k * h * (1 - h), h];
}

// Cuerpo hexagonal, torneado en cono en los dos extremos.
function geometriaCuerpo() {
  const xa = D_AGARRE, xb = D_CUERPO;
  const largoCorte = (R_ARISTA + 0.02 - R_CONO0) / T_CORTE;
  const filas = [{ d: xa, tapa: true }];
  const NC = 11;
  for (let i = 0; i <= NC; i++) filas.push({ d: xa + (largoCorte * i) / NC });
  for (const t of [0.25, 0.5, 0.75]) filas.push({ d: xa + largoCorte + (xb - xa - 2 * largoCorte) * t });
  for (let i = NC; i >= 0; i--) filas.push({ d: xb - (largoCorte * i) / NC });
  filas.push({ d: xb, tapa: true });
  const K = 0.012;
  const cols = SECCION.length;
  const nv = filas.length * cols;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  let k = 0;
  for (const f of filas) {
    const rc = R_CONO0 + T_CORTE * Math.min(f.d - xa, xb - f.d);
    const sentido = f.d - xa < xb - f.d ? -1 : 1; // hacia dónde mira el cono
    for (const o of SECCION) {
      const ey = o.y / o.r, ez = o.z / o.r;
      let r, n;
      if (f.tapa) {
        r = R_CONO0 - 0.03;
        n = [sentido, 0, 0];
      } else {
        const [v, h] = smin(o.r, rc, K);
        r = v;
        // normal: mezcla de la del hexágono y la del cono
        const lc = Math.hypot(T_CORTE, 1);
        const nc = [(sentido * T_CORTE) / lc, ey / lc, ez / lc];
        const nh = [0, o.ny, o.nz];
        n = [nh[0] * h + nc[0] * (1 - h), nh[1] * h + nc[1] * (1 - h), nh[2] * h + nc[2] * (1 - h)];
        const l = Math.hypot(n[0], n[1], n[2]);
        n = [n[0] / l, n[1] / l, n[2] / l];
      }
      pos[k * 3] = X0 + f.d; pos[k * 3 + 1] = Y_EJE + ey * r; pos[k * 3 + 2] = ez * r;
      nor.set(n, k * 3);
      uv[k * 2] = (f.d - xa) / (xb - xa); uv[k * 2 + 1] = o.v;
      k++;
    }
  }
  const idx = [];
  for (let i = 0; i < filas.length - 1; i++) {
    const f0 = i * cols, f1 = (i + 1) * cols;
    for (let j = 0; j < cols - 1; j++) {
      const a = f0 + j, b = f1 + j, c = f0 + j + 1, d = f1 + j + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Clip: fleje de acero de sección rectangular redondeada, barrido a lo
// largo de x sobre la cara β = B_CLIP. a = altura sobre el eje en la
// dirección de la normal de la cara, b = posición a lo ancho.
const D_CLIP0 = 7.75, D_CLIP1 = 12.56;
function geometriaClip() {
  const ESP = 0.042;                // espesor del fleje
  const RHO0 = 0.12, RHO1 = 0.14;   // redondeo de la cola y de la cabeza (en planta)
  // altura de la cara interna sobre el eje
  const altura = (d) => {
    const t = sat((d - D_CLIP0) / (D_CUERPO - D_CLIP0));
    const cara = AP + FLECHA;
    let a = cara + 0.012 + 0.012 * t + 0.008 * Math.sin(Math.PI * t); // apenas arqueado
    a -= 0.011 * (1 - suave(D_CLIP0, D_CLIP0 + 1.1, d));         // la cola pisa el cuerpo
    a -= 0.022 * suave(D_CUERPO + 0.02, D_CLIP1, d);             // la cabeza se mete en el anillo
    a += 0.008 * Math.pow(sat(1 - (d - D_CLIP0) / 0.1), 2);      // labio de la cola
    return a;
  };
  const ancho = (d) => {
    let w = 0.135 + 0.025 * sat((d - D_CLIP0) / (D_CLIP1 - D_CLIP0)); // se angosta hacia la cola
    if (d < D_CLIP0 + RHO0) { const q = (D_CLIP0 + RHO0 - d) / RHO0; w *= Math.sqrt(Math.max(0, 1 - q * q)); }
    if (d > D_CLIP1 - RHO1) { const q = (d - (D_CLIP1 - RHO1)) / RHO1; w *= Math.sqrt(Math.max(0, 1 - q * q)); }
    return w;
  };
  const estaciones = [];
  for (let i = 0; i <= 8; i++) estaciones.push(D_CLIP0 + RHO0 * (1 - Math.cos((Math.PI / 2) * (i / 8))));
  const medio = [D_CLIP0 + 0.2, D_CLIP0 + 0.3, D_CLIP0 + 0.45, D_CLIP0 + 0.65, D_CLIP0 + 0.9, D_CLIP0 + 1.3];
  for (let x = D_CLIP0 + 1.75; x < D_CUERPO - 0.3; x += 0.45) medio.push(x);
  medio.push(D_CUERPO - 0.2, D_CUERPO - 0.1, D_CUERPO - 0.05, D_CUERPO, D_CUERPO + 0.05);
  for (const x of medio) if (x > estaciones[estaciones.length - 1] + 0.02 && x < D_CLIP1 - RHO1) estaciones.push(x);
  for (let i = 0; i <= 8; i++) estaciones.push(D_CLIP1 - RHO1 * Math.cos((Math.PI / 2) * (i / 8)));
  // sección: superelipse (rectángulo de cantos redondeados), con la cara
  // de afuera apenas abombada. La costura queda en la cara de adentro.
  const NS = 20;
  const sec = [];
  for (let j = 0; j <= NS; j++) {
    const f = -Math.PI / 2 + (2 * Math.PI * j) / NS;
    const c = Math.cos(f), s = Math.sin(f);
    const pw = 0.42;
    sec.push([Math.sign(c) * Math.pow(Math.abs(c), pw), Math.sign(s) * Math.pow(Math.abs(s), pw)]);
  }
  const ny = dirY(B_CLIP), nz = dirZ(B_CLIP), ty = Math.sin(B_CLIP), tz = Math.cos(B_CLIP);
  const pos = [], uv = [];
  for (const d of estaciones) {
    const a0 = altura(d), w = ancho(d);
    for (let j = 0; j <= NS; j++) {
      const [cb, ca] = sec[j];
      const b = cb * w;
      const corona = 0.024 * (1 - (cb * cb)); // abombado de la cara de afuera
      const a = a0 + ESP * (0.5 + 0.5 * ca) + (ca > 0 ? corona * ca : 0);
      pos.push(X0 + d, Y_EJE + a * ny + b * ty, a * nz + b * tz);
      uv.push(d / 5, j / NS);
    }
  }
  const idx = [];
  const cols = NS + 1;
  for (let i = 0; i < estaciones.length - 1; i++) {
    for (let j = 0; j < NS; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j, c = i * cols + j + 1, d = (i + 1) * cols + j + 1;
      idx.push(a, c, b, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let GEOM = null;
function geometrias() {
  if (GEOM) return GEOM;
  // mina: punta apenas gastada en bisel
  const mina = torno(perfil([
    [0, 0], [0.004, 0.018, 0.006], [0.016, R_MINA, 0.004], [D_MINA + 0.03, R_MINA],
  ]), 16, { escalaV: 1 });
  // tubo guía (fino, menos segmentos)
  const guia = torno(perfil([
    [D_MINA, R_MINA + 0.002], [D_MINA, 0.044, 0.004], [D_MINA + 0.012, 0.05, 0.01], [D_GUIA + 0.01, 0.05],
  ]), 20, { escalaV: 0.5 });
  // cono escalonado y collar
  const cono = torno(perfil([
    [D_GUIA - 0.01, 0.05],
    [D_GUIA, 0.05, 0.004], [D_GUIA, 0.072, 0.008], [D_GUIA + 0.09, 0.085, 0.02],  // nariz
    [D_GUIA + 0.11, 0.09, 0.01],
    [1.02, 0.19, 0.03],                              // primer cono
    [1.02, 0.212, 0.008], [1.1, 0.216, 0.02],        // escalón
    [1.13, 0.226, 0.03],
    [1.5, 0.326, 0.06],                              // segundo cono
    [D_CONO - 0.08, 0.336, 0.02], [D_CONO - 0.06, 0.322, 0.006],                  // ranura
    [D_CONO - 0.03, 0.322, 0.006], [D_CONO - 0.01, 0.34, 0.01],
    [D_CONO + 0.01, 0.355, 0.01], [D_CONO + 0.02, 0.392, 0.012],                   // collar
    [1.8, 0.396, 0.02], [D_COLLAR - 0.01, 0.392, 0.012], [D_COLLAR, 0.36],
  ]), 40, { escalaV: 0.5 });
  // bandas lisas del agarre (una geometría con las dos, salteando el moleteado)
  const banda0 = perfil([
    [D_COLLAR, 0.355], [D_COLLAR + 0.005, R_BANDA, 0.012], [D_MOL0, R_BANDA, 0.01], [D_MOL0, R_MOL - 0.01],
  ]);
  const banda1 = perfil([
    [D_MOL1, R_MOL - 0.01], [D_MOL1, R_BANDA, 0.01], [D_AGARRE - 0.005, R_BANDA, 0.012], [D_AGARRE, 0.355],
  ]);
  const bandas = juntar([torno(banda0, 40, { escalaV: 0.5 }), torno(banda1, 40, { escalaV: 0.5 })]);
  // moleteado: uv en unidades de diamante (mosaico repetido)
  const moleteado = torno([{ d: D_MOL0 - 0.002, r: R_MOL }, { d: D_MOL1 + 0.002, r: R_MOL }], 64, {
    escalaU: N_MOL, uvD: true, v0: D_MOL0, escalaV: 1 / PASO_MOL,
  });
  const cuerpo = geometriaCuerpo();
  // anillo del clip
  const anillo = torno(perfil([
    [D_CUERPO, 0.36], [D_CUERPO, 0.406, 0.02], [D_CUERPO + 0.07, 0.41, 0.05],
    [D_ANILLO - 0.03, 0.406, 0.02], [D_ANILLO, 0.38],
  ]), 40, { escalaV: 0.5 });
  // tapa, del color del cuerpo
  const tapa = torno(perfil([
    [D_ANILLO, 0.38], [D_ANILLO, 0.392, 0.008], [D_ANILLO + 0.4, 0.384, 0.3],
    [D_TAPA - 0.02, 0.36, 0.08], [D_TAPA - 0.02, 0.26, 0.02], [D_TAPA, 0.25],
  ]), 40, { escalaV: 0.5 });
  // anillo y pulsador cromados
  const pulsador = torno(perfil([
    [D_TAPA - 0.02, 0.24], [D_TAPA - 0.02, 0.262, 0.01], [D_ANILLO_P - 0.01, 0.262, 0.015],
    [D_ANILLO_P, 0.205, 0.006], [D_ANILLO_P + 0.02, 0.203, 0.006],
    [D_ANILLO_P + 0.22, 0.203, 0.005], [D_ANILLO_P + 0.23, 0.196, 0.003], [D_ANILLO_P + 0.25, 0.203, 0.005], // ranura
    [D_FIN - 0.03, 0.203, 0.13], [D_FIN, 0.06, 0.08], [D_FIN, 0],
  ]), 32, { escalaV: 0.5 });
  const clip = geometriaClip();
  GEOM = { mina, guia, cono, bandas, moleteado, cuerpo, anillo, tapa, pulsador, clip };
  return GEOM;
}

// Junta geometrías indexadas con los mismos atributos.
function juntar(lista) {
  const attrs = ['position', 'normal', 'uv'];
  const tot = lista.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const a of attrs) {
    const tam = lista[0].attributes[a].itemSize;
    const arr = new Float32Array(tot * tam);
    let o = 0;
    for (const g of lista) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
    out.setAttribute(a, new THREE.BufferAttribute(arr, tam));
  }
  const idx = [];
  let base = 0;
  for (const g of lista) { for (const i of g.index.array) idx.push(i + base); base += g.attributes.position.count; }
  out.setIndex(idx);
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Texturas
// ─────────────────────────────────────────────────────────────

// Cromo torneado: rayas finas circunferenciales (varían a lo largo del
// perfil, v). Mosaico de 2 cm; u apenas varía.
function texturaTorneado() {
  const W = 8, H = 512;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const linea = 0.5 * hash(y, 7) + 0.3 * ruido(y * 0.11, 3.1) + 0.2 * ruido(y * 0.031, 9.7);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      d[o] = 255;
      d[o + 1] = aByte(0.1 + 0.11 * linea + 0.02 * hash(x, y));
      d[o + 2] = 255;
      d[o + 3] = 255;
    }
  }
  return texturaDeDatos(d, W, H, { repetir: true });
}

// Acero del clip: cepillado a lo largo (varía a lo ancho, v).
function texturaCepillado() {
  const W = 8, H = 256;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const linea = 0.75 * hash(y, 21) + 0.25 * ruido(y * 0.37, 1.3);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      d[o] = 255;
      d[o + 1] = aByte(0.15 + 0.08 * linea);
      d[o + 2] = 255;
      d[o + 3] = 255;
    }
  }
  return texturaDeDatos(d, W, H, { repetir: true });
}

// Moleteado en diamante: pirámides de punta gastada en un mosaico que
// cubre un diamante. Normal, ORM (oclusión en los surcos, puntas más
// lisas por el uso) y color (puntas un poco más claras).
function texturasMoleteado() {
  const N = 64;
  const fr = (x) => x - Math.floor(x);
  const alto = (u, v) => {
    const a = fr(u + v), b = fr(u - v);
    const h = 1 - 2 * Math.max(Math.abs(a - 0.5), Math.abs(b - 0.5));
    return Math.min(h, 0.78) / 0.78;
  };
  const normal = normalDesdeAltura(N, N, alto, { fuerza: 0.16, repetir: true });
  const orm = new Uint8Array(N * N * 4), col = new Uint8Array(N * N * 4);
  const base = lineal(0x262e2e);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = alto((x + 0.5) / N, (y + 0.5) / N);
    const o = (y * N + x) * 4;
    orm[o] = aByte(0.45 + 0.55 * Math.sqrt(h));
    orm[o + 1] = aByte(h >= 0.999 ? 0.22 : 0.55 - 0.18 * h);
    orm[o + 2] = 255;
    orm[o + 3] = 255;
    const k = h >= 0.999 ? 2.1 : 0.75 + 0.35 * h;
    col[o] = aSrgb(base[0] * k); col[o + 1] = aSrgb(base[1] * k); col[o + 2] = aSrgb(base[2] * k); col[o + 3] = 255;
  }
  return {
    normal,
    orm: texturaDeDatos(orm, N, N, { repetir: true }),
    color: texturaDeDatos(col, N, N, { srgb: true, repetir: true }),
  };
}

// Cuerpo: dos lienzos pintados con las mismas pasadas (mismo azar):
// · color: anodizado petróleo con variación a lo largo y vetas finas
//   alrededor, desgaste claro en las aristas cerca de las puntas e
//   impresión "0.5 mm · GENERALITO" (como el lápiz) con la tinta algo
//   gastada; rayones finos de uso y huellas más lisas cerca del agarre;
// · ORM: rugosidad (G) cepillada; la tinta no es metálica (B = 0).
// u (x del lienzo) va a lo largo del cuerpo; v (alrededor) va hacia
// arriba en el lienzo, con la cara de arriba en el medio (v = 0,5).
function texturasCuerpo() {
  const W = 1024, H = 512;
  const largo = D_CUERPO - D_AGARRE;
  const per = SECCION.perimetro;
  const pxU = W / largo, pxV = H / per; // píxeles por cm
  const lf = 2 * W_CARA, la = (RC * Math.PI) / 3;
  const aristas = [];
  for (let k = 0; k < 6; k++) aristas.push(H * (1 - (lf / 2 + k * (lf + la) + la / 2) / per));
  const base = lineal(PALETA.petroleo).map((c) => c * OSCURO);
  const escV = pxV / pxU; // un cm alrededor, en píxeles, por cada píxel a lo largo
  const rgb = (l, k = 1) => `rgb(${l.map((c) => aSrgb(c * k)).join(',')})`;
  const pintar = (modo) => {
    const al = azar(925);
    const c = lienzo(W, H);
    const g = c.getContext('2d');
    const color = modo === 'color';
    // a lo largo: variación lenta del anodizado (y de la rugosidad)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = 0.07 * (ruido(u * 9, 2.5) - 0.5) + 0.03 * (ruido(u * 40, 7.1) - 0.5);
      g.fillStyle = color ? rgb(base, 1 + v) : `rgb(255,${aByte(0.38 + v * 0.5)},255)`;
      g.fillRect(x, 0, 1, H);
    }
    // alrededor: vetas finas del cepillado
    for (let y = 0; y < H; y++) {
      const f = 0.5 * hash(y, 3) + 0.5 * ruido(y * 0.3, 5.5) - 0.5;
      if (color) g.fillStyle = f > 0 ? `rgba(255,255,255,${(f * 0.035).toFixed(4)})` : `rgba(0,0,0,${(-f * 0.08).toFixed(4)})`;
      else g.fillStyle = `rgba(255,${f > 0 ? 255 : 0},255,${(Math.abs(f) * 0.16).toFixed(4)})`;
      g.fillRect(0, y, W, 1);
    }
    // desgaste: el anodizado se pela en las aristas, cerca de las dos
    // puntas (donde se agarra y donde roza el clip)
    g.fillStyle = color ? rgb(lineal(0x8e9c98)) : 'rgb(255,66,255)';
    for (const ya of aristas) for (let i = 0; i < 70; i++) {
      const lado = al() < 0.5;
      const u = Math.pow(al(), 2.2) * 0.16;
      const x = (lado ? u : 1 - u) * W;
      const y = ya + (al() - 0.5) * la * pxV * 0.9;
      g.globalAlpha = 0.25 + 0.6 * al() * (1 - u / 0.16);
      g.beginPath();
      g.ellipse(x, y, 0.6 + 4 * al() * al(), 0.5 + 1.2 * al(), 0, 0, 2 * Math.PI);
      g.fill();
    }
    // rayones finos de uso, casi todos a lo largo
    g.strokeStyle = color ? 'rgb(150,170,168)' : 'rgb(255,60,255)';
    for (let i = 0; i < 46; i++) {
      const x = al() * W, y = al() * H, l = (0.15 + 0.8 * al() * al()) * pxU;
      const ang = (al() - 0.5) * (al() < 0.8 ? 0.12 : 1.2);
      g.globalAlpha = 0.06 + 0.16 * al();
      g.lineWidth = 0.5 + 0.7 * al();
      g.beginPath();
      g.moveTo(x, y);
      const curva = (al() - 0.5) * 3;
      g.quadraticCurveTo(x + (l / 2) * Math.cos(ang), y + (l / 2) * Math.sin(ang) * escV + curva, x + l * Math.cos(ang), y + l * Math.sin(ang) * escV);
      g.stroke();
    }
    // huellas de dedos cerca del agarre: manchas más lisas
    for (let i = 0; i < 7; i++) {
      const x = (0.03 + 0.2 * al()) * W, y = H * (0.25 + 0.5 * al()), rx = (0.25 + 0.3 * al()) * pxU;
      const gr = g.createRadialGradient(x, y, 0, x, y, rx);
      const a = 0.25 + 0.3 * al();
      gr.addColorStop(0, color ? `rgba(120,150,150,${(a * 0.08).toFixed(3)})` : `rgba(255,40,255,${a.toFixed(3)})`);
      gr.addColorStop(1, color ? 'rgba(120,150,150,0)' : 'rgba(255,40,255,0)');
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.save();
      g.translate(x, y);
      g.scale(1, (0.6 + 0.6 * al()) * escV);
      g.translate(-x, -y);
      g.fillRect(x - rx, y - rx, 2 * rx, 2 * rx);
      g.restore();
    }
    g.globalAlpha = 1;
    // impresión sobre la cara de arriba
    g.fillStyle = color ? rgb(lineal(0xc4c0b4)) : 'rgb(255,128,0)';
    g.textBaseline = 'middle';
    const escX = pxU / pxV;
    const texto = (str, dCm, alturaCm, peso, espaciado = 0) => {
      g.save();
      g.translate(dCm * pxU, H / 2);
      g.scale(escX, 1);
      g.font = `${peso} ${Math.round((alturaCm * pxV) / 0.72)}px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`;
      if ('letterSpacing' in g) g.letterSpacing = `${espaciado}px`;
      g.fillText(str, 0, 0);
      const ancho = g.measureText(str).width;
      g.restore();
      return (ancho * escX) / pxU;
    };
    let d = 0.42;
    d += texto('0.5', d, 0.15, 600, 1) + 0.05;
    const fin = d + texto('mm', d, 0.085, 500, 1);
    const fin2 = 1.55 + texto('GENERALITO', 1.55, 0.075, 500, 4);
    // tinta gastada: puntitos del color de fondo sobre la impresión
    g.fillStyle = color ? rgb(base) : 'rgb(255,97,255)';
    const alto = 0.17 * pxV;
    for (let i = 0; i < 260; i++) {
      const x = (0.42 + al() * (fin2 - 0.42)) * pxU;
      if (x > fin * pxU && x < 1.55 * pxU) { al(); al(); al(); continue; }
      g.globalAlpha = 0.35 + 0.5 * al();
      g.beginPath();
      g.ellipse(x, H / 2 + (al() - 0.5) * alto, 0.5 + 1.4 * al(), 0.5 + 1.2 * al(), 0, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;
    return texturaDeLienzo(c, { srgb: color });
  };
  return { color: pintar('color'), orm: pintar('orm') };
}

// ─────────────────────────────────────────────────────────────
//  Materiales
// ─────────────────────────────────────────────────────────────
let MAT = null;
function materiales() {
  if (MAT) return MAT;
  const torneado = texturaTorneado();
  const cepillado = texturaCepillado();
  const mol = texturasMoleteado();
  const cu = texturasCuerpo();
  const cromo = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0xd2d0c9, metalness: 1, roughness: 1, roughnessMap: torneado,
  }));
  const acero = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0xb4b3ac, metalness: 1, roughness: 1, roughnessMap: cepillado,
  }));
  const grafito = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0x3b3b39, metalness: 0.4, roughness: 0.45,
  }));
  const cuerpo = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: cu.color,
    metalness: 1, metalnessMap: cu.orm, roughness: 1, roughnessMap: cu.orm,
    clearcoat: 0.1, clearcoatRoughness: 0.3,
  }));
  const anodizado = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(...lineal(PALETA.petroleo).map((c) => c * OSCURO)), metalness: 1, roughness: 0.38,
    clearcoat: 0.1, clearcoatRoughness: 0.3,
  }));
  const oscuro = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0x263030, metalness: 1, roughness: 0.34,
  }));
  const moleteado = recibirSombra(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: mol.color, metalness: 1, metalnessMap: mol.orm,
    roughness: 1, roughnessMap: mol.orm, aoMap: mol.orm, aoMapIntensity: 1,
    normalMap: mol.normal,
  }));
  MAT = { cromo, acero, grafito, cuerpo, anodizado, oscuro, moleteado };
  return MAT;
}

// ─────────────────────────────────────────────────────────────
export function crear(variante = variantes[0]) {
  const g = geometrias();
  const m = materiales();
  const malla = new THREE.Group();
  malla.name = `portaminas-${variante}`;
  const piezas = [
    [g.mina, m.grafito], [g.guia, m.cromo], [g.cono, m.cromo], [g.bandas, m.oscuro],
    [g.moleteado, m.moleteado], [g.cuerpo, m.cuerpo], [g.anillo, m.cromo], [g.tapa, m.anodizado],
    [g.pulsador, m.cromo], [g.clip, m.acero],
  ];
  for (const [geo, mat] of piezas) malla.add(new THREE.Mesh(geo, mat));
  return {
    malla,
    cuerpo: { medias: [LARGO / 2 - RADIO, 0, 0], radio: RADIO, masa: 16, material: 'metal' },
  };
}
