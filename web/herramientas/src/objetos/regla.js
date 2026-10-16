// ─────────────────────────────────────────────────────────────
//  Reglas graduadas.
//
//  · madera: regla escolar de haya de 30 cm (31 × 3 cm, 3,5 mm de
//    espesor), laqueada, con un bisel en el borde de los centímetros.
//    Milímetros, medios centímetros y centímetros de 0 a 30 sobre el
//    bisel; pulgadas en el borde recto.
//  · acero: regla de acero inoxidable cepillado de 20 cm (21 × 2 cm,
//    1 mm de espesor), con el cero en la punta, marcas grabadas y
//    rellenas de negro, y agujero para colgar en el extremo redondeado.
//
//  Geometría (cm; eje largo en x, y arriba): el contorno en planta
//  (rectángulo de esquinas redondeadas, más el agujero en la de acero)
//  se barre con el perfil del canto: un cuarto de círculo abajo, la
//  pared y otro cuarto arriba que termina tangente a la cara de arriba
//  (plana, o inclinada en el bisel). Las tapas se triangulan a partir
//  del anillo interior del canto, cortadas donde hace falta (la costura
//  del atlas en x = 0 y el quiebre suavizado del bisel).
//
//  Texturas: un atlas de 1024 × 512 con tres franjas. Las dos primeras
//  llevan la cara de arriba partida al medio (x ≤ 0 y x ≥ 0): el largo
//  tiene así el doble de píxeles que con una sola tira y las marcas
//  salen nítidas. La tercera, sin marcas y a menos resolución, cubre la
//  cara de abajo y los cantos. Color, ORM (rugosidad y metal) y relieve
//  se calculan en una sola pasada por píxel sobre una máscara dibujada
//  con canvas 2D (tinta en rojo, radios de la madera en verde, golpes y
//  rayones en azul). Todo se cachea por variante.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { hash, ruido, azar, lienzo, texturaDeDatos, recibirSombra, linealASrgb } from '../util.js';
import { PALETA } from '../paleta.js';

export const nombre = 'regla';
export const variantes = ['madera', 'acero'];

const ANCHO_TEX = 1024, ALTO_TEX = 512;
const FUENTE = 'Inter, "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const PULGADA = 2.54;

// ── medidas (cm) ──
const CONF = {
  madera: {
    L: 31, W: 3, T: 0.35,
    rCanto: 0.05,                       // redondeo de las aristas (lijado)
    esquinas: [0.14, 0.14, 0.14, 0.14], // radios en planta: (−x−z), (+x−z), (+x+z), (−x+z)
    cero: -15, cm: 30,                  // x del cero y centímetros útiles
    bisel: { zb: -0.72, caida: 0.2, suave: 0.06 }, // quiebre, bajada en el borde, suavizado
    masa: 25, material: 'madera', semilla: 11,
  },
  acero: {
    L: 21, W: 2, T: 0.1,
    rCanto: 0.022,
    esquinas: [0.04, 0.55, 0.55, 0.04], // el cero en la punta recta; el otro extremo redondeado
    cero: -10.5, cm: 20,
    agujero: { x: 9.98, z: 0, r: 0.225 },
    masa: 22, material: 'metal', semilla: 5,
    mat: { color: 0x959692, envMapIntensity: 0.95, anisotropy: 0.6, rug: 0.1, ond: 0.1 },
  },
};

// ── utilidades ──
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const suave = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lineal = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const TABLA_SRGB = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) TABLA_SRGB[i] = Math.round(linealASrgb(i / 4096) * 255);
const aSrgb = (x) => TABLA_SRGB[(sat(x) * 4096) | 0];
const aByte = (x) => Math.round(sat(x) * 255);

function configurar(variante) {
  const c = { ...CONF[variante], variante };
  // La colisión es una placa de radio = medio espesor, pero no menos de
  // 0,8 mm (la física atraviesa placas más finas). La malla apoya en la
  // cara de abajo de la caja redondeada: y = −radio.
  c.radio = Math.max(c.T / 2, 0.08);
  c.yAbajo = -c.radio;
  c.yArriba = -c.radio + c.T;
  return c;
}

// Altura de la cara de arriba en z y su pendiente dy/dz. El bisel baja
// linealmente desde el quiebre (zb) hasta el borde graduado (−W/2); el
// quiebre se redondea con una parábola de ancho 2·suave.
function alturaArriba(cfg, z) {
  if (!cfg.bisel) return [cfg.yArriba, 0];
  const { zb, caida, suave: e } = cfg.bisel;
  const B = zb + cfg.W / 2;
  const t = zb - z;
  let f, df;
  if (t <= -e) { f = 0; df = 0; } else if (t >= e) { f = t; df = 1; } else { f = (t + e) * (t + e) / (4 * e); df = (t + e) / (2 * e); }
  return [cfg.yArriba - (caida * f) / B, (caida * df) / B];
}

// ── atlas ──
// Franjas: A (x ≤ 0) y B (x ≥ 0) de la cara de arriba a la misma escala
// en los dos ejes; C, la regla entera sin marcas para abajo y los cantos.
function crearMaqueta(L, W) {
  const pX = 0.12, pZ = 0.08;
  const s = ANCHO_TEX / (L / 2 + 2 * pX);
  const h = Math.ceil((W + 2 * pZ) * s);
  const hC = ALTO_TEX - 2 * h;
  if (hC < 40) throw new Error('regla: el atlas no alcanza');
  const z0 = -W / 2 - pZ;
  const franjas = [
    { i: 0, x0: -L / 2 - pX, py0: 0, alto: h, sx: s, sz: s },
    { i: 1, x0: -pX, py0: h, alto: h, sx: s, sz: s },
    { i: 2, x0: -L / 2 - pX, py0: 2 * h, alto: hC, sx: ANCHO_TEX / (L + 2 * pX), sz: hC / (W + 2 * pZ) },
  ];
  const uv = (f, x, z) => [((x - f.x0) * f.sx) / ANCHO_TEX, 1 - (f.py0 + (z - z0) * f.sz) / ALTO_TEX];
  const franjaDeFila = (py) => (py < h ? franjas[0] : py < 2 * h ? franjas[1] : franjas[2]);
  return { s, z0, franjas, uv, franjaDeFila };
}

// ── tinta: lista de primitivas en cm, se dibuja igual en cada franja ──
function tintaMadera(cfg) {
  const P = [];
  const b = -cfg.W / 2, a = cfg.W / 2;
  // escala métrica sobre el bisel (borde −z)
  for (let mm = 0; mm <= cfg.cm * 10; mm++) {
    const x = cfg.cero + mm / 10;
    const cm = mm % 10 === 0, medio = mm % 5 === 0;
    P.push({ t: 'raya', x, z0: b - 0.1, z1: b + (cm ? 0.6 : medio ? 0.42 : 0.27), w: cm ? 0.036 : medio ? 0.031 : 0.026 });
  }
  for (let n = 0; n <= cfg.cm; n++) P.push({ t: 'texto', s: String(n), x: cfg.cero + n, base: -0.34, alto: 0.28, peso: 600 });
  P.push({ t: 'texto', s: 'cm', x: cfg.cero + 0.5, base: -0.34, alto: 0.14, peso: 600, minus: true });
  // pulgadas en el borde recto (+z), en dieciseisavos
  for (let k = 0; ; k++) {
    const x = cfg.cero + (k * PULGADA) / 16;
    if (x > cfg.L / 2 - 0.3) break;
    const l = k % 16 === 0 ? 0.5 : k % 8 === 0 ? 0.38 : k % 4 === 0 ? 0.29 : k % 2 === 0 ? 0.21 : 0.14;
    P.push({ t: 'raya', x, z0: a - l, z1: a + 0.1, w: k % 16 === 0 ? 0.034 : 0.025 });
    if (k % 16 === 0) P.push({ t: 'texto', s: String(k / 16), x, base: a - 0.6, alto: 0.22, peso: 600 });
  }
  P.push({ t: 'texto', s: 'pulg.', x: cfg.cero + PULGADA / 2, base: a - 0.6, alto: 0.12, peso: 600, minus: true });
  // marca
  P.push({ t: 'texto', s: 'GENERALITO', x: 0, base: 0.2, alto: 0.15, peso: 600, espacio: 0.07 });
  P.push({ t: 'texto', s: 'HAYA MACIZA', x: -11.5, base: 0.2, alto: 0.1, peso: 500, espacio: 0.04 });
  P.push({ t: 'texto', s: 'N.º 30', x: 11.5, base: 0.2, alto: 0.1, peso: 500, espacio: 0.04 });
  return P;
}

function tintaAcero(cfg) {
  const P = [];
  const b = -cfg.W / 2, a = cfg.W / 2;
  for (let mm = 0; mm <= cfg.cm * 10; mm++) {
    const x = cfg.cero + mm / 10;
    const cm = mm % 10 === 0, medio = mm % 5 === 0;
    // la raya del cero es la punta misma
    if (mm > 0) P.push({ t: 'raya', x, z0: b - 0.1, z1: b + (cm ? 0.42 : medio ? 0.3 : 0.19), w: cm ? 0.028 : medio ? 0.024 : 0.02 });
  }
  for (let n = 0; n <= cfg.cm; n++) {
    if (n === 0) P.push({ t: 'texto', s: '0', x: cfg.cero + 0.07, base: -0.29, alto: 0.2, peso: 600, alinear: 'left' });
    else P.push({ t: 'texto', s: String(n), x: cfg.cero + n, base: -0.29, alto: 0.2, peso: 600 });
  }
  P.push({ t: 'texto', s: 'cm', x: cfg.cero + 0.5, base: -0.29, alto: 0.1, peso: 600, minus: true });
  for (let k = 1; ; k++) {
    const x = cfg.cero + (k * PULGADA) / 16;
    if (x > cfg.L / 2 - 0.62) break;
    const l = k % 16 === 0 ? 0.4 : k % 8 === 0 ? 0.3 : k % 4 === 0 ? 0.23 : k % 2 === 0 ? 0.17 : 0.12;
    P.push({ t: 'raya', x, z0: a - l, z1: a + 0.1, w: k % 16 === 0 ? 0.026 : 0.02 });
    if (k % 16 === 0) P.push({ t: 'texto', s: String(k / 16), x, base: a - 0.47, alto: 0.17, peso: 600 });
  }
  P.push({ t: 'texto', s: 'pulg.', x: cfg.cero + PULGADA / 2, base: a - 0.47, alto: 0.09, peso: 500, minus: true });
  P.push({ t: 'texto', s: 'GENERALITO', x: -0.5, base: 0.02, alto: 0.11, peso: 600, espacio: 0.055 });
  P.push({ t: 'texto', s: 'ACERO INOXIDABLE · 20 cm', x: -0.5, base: 0.19, alto: 0.07, peso: 500, espacio: 0.03 });
  return P;
}

// Relación alto de los dígitos / tamaño de fuente (se mide una vez).
let ALTO_DIGITO = 0;
function altoDigito(ctx) {
  if (ALTO_DIGITO) return ALTO_DIGITO;
  ctx.save();
  ctx.font = `500 100px ${FUENTE}`;
  const m = ctx.measureText('0123456789');
  ALTO_DIGITO = (m.actualBoundingBoxAscent || 72) / 100;
  ctx.restore();
  return ALTO_DIGITO;
}

function dibujarTinta(ctx, F, prims) {
  ctx.fillStyle = 'rgb(255,0,0)';
  const ad = altoDigito(ctx);
  for (const p of prims) {
    if (p.t === 'raya') {
      const za = Math.min(p.z0, p.z1), zb = Math.max(p.z0, p.z1);
      ctx.fillRect(F.X(p.x - p.w / 2), F.Y(za), p.w * F.sx, (zb - za) * F.sz);
    } else {
      // minúsculas: el alto pedido es el de la x; se agranda la fuente
      const tam = (p.alto / (p.minus ? ad * 0.75 : ad)) * F.sz;
      ctx.font = `${p.peso} ${tam.toFixed(2)}px ${FUENTE}`;
      ctx.textBaseline = 'alphabetic';
      const esp = (p.espacio || 0) * F.sx;
      const cond = 0.9; // apenas condensada, como en las reglas
      const anchos = [...p.s].map((ch) => ctx.measureText(ch).width * cond);
      const total = anchos.reduce((s, w) => s + w, 0) + esp * (anchos.length - 1);
      let x = F.X(p.x) - (p.alinear === 'left' ? 0 : total / 2);
      const y = F.Y(p.base);
      [...p.s].forEach((ch, i) => {
        ctx.setTransform(cond, 0, 0, 1, x, y);
        ctx.fillText(ch, 0, 0);
        x += anchos[i] + esp;
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
}

function enFranja(ctx, f, mq, dibujar) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, f.py0, ANCHO_TEX, f.alto);
  ctx.clip();
  dibujar({ X: (x) => (x - f.x0) * f.sx, Y: (z) => f.py0 + (z - mq.z0) * f.sz, sx: f.sx, sz: f.sz, f });
  ctx.restore();
}

// Máscara RGB: tinta (R), radios de la madera (G), golpes y rayones (B).
function dibujarMascara(cfg, mq) {
  const c = lienzo(ANCHO_TEX, ALTO_TEX);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ANCHO_TEX, ALTO_TEX);
  ctx.globalCompositeOperation = 'lighter';
  const rnd = azar(cfg.semilla);
  const madera = cfg.material === 'madera';
  const prims = madera ? tintaMadera(cfg) : tintaAcero(cfg);

  // radios de la haya: manchitas fusiformes rojizas a lo largo de la veta
  const vetas = [];
  if (madera) {
    const n = Math.round(cfg.L * cfg.W * 7);
    for (let i = 0; i < n; i++) {
      vetas.push({
        x: -cfg.L / 2 + rnd() * cfg.L, z: -cfg.W / 2 - 0.05 + rnd() * (cfg.W + 0.1),
        rx: 0.03 + rnd() * rnd() * 0.12, rz: 0.006 + rnd() * 0.012, a: 0.25 + rnd() * 0.6, g: (rnd() - 0.5) * 0.06,
      });
    }
  }
  // golpes (madera) y rayones finos (los dos)
  const golpes = [], rayones = [];
  if (madera) {
    for (let i = 0; i < 9; i++) golpes.push({ x: -cfg.L / 2 + rnd() * cfg.L, z: (rnd() - 0.5) * cfg.W, r: 0.04 + rnd() * 0.1, a: 0.3 + rnd() * 0.5 });
    // dos golpes en el borde graduado, donde más se usa
    golpes.push({ x: -6.2, z: -cfg.W / 2 + 0.02, r: 0.07, a: 0.8 }, { x: 8.7, z: -cfg.W / 2 + 0.01, r: 0.05, a: 0.7 });
    for (let i = 0; i < 14; i++) {
      const ang = (rnd() - 0.5) * (rnd() < 0.7 ? 0.3 : 3);
      rayones.push({ x: -cfg.L / 2 + rnd() * cfg.L, z: (rnd() - 0.5) * cfg.W, l: 0.3 + rnd() * 2.2, ang, w: 0.006 + rnd() * 0.01, a: 0.15 + rnd() * 0.3 });
    }
  } else {
    for (let i = 0; i < 70; i++) {
      const ang = (rnd() - 0.5) * (rnd() < 0.75 ? 0.25 : 3.1);
      rayones.push({ x: -cfg.L / 2 + rnd() * cfg.L, z: (rnd() - 0.5) * cfg.W, l: 0.2 + rnd() * rnd() * 4, ang, w: 0.004 + rnd() * 0.008, a: 0.2 + rnd() * 0.5 });
    }
  }

  for (const f of mq.franjas) {
    enFranja(ctx, f, mq, (F) => {
      if (f.i < 2) dibujarTinta(ctx, F, prims);
      for (const v of vetas) {
        ctx.fillStyle = `rgba(0,255,0,${v.a.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(F.X(v.x), F.Y(v.z), Math.max(0.6, v.rx * F.sx), Math.max(0.5, v.rz * F.sz), v.g, 0, 2 * Math.PI);
        ctx.fill();
      }
      for (const g of golpes) {
        const gr = ctx.createRadialGradient(F.X(g.x), F.Y(g.z), 0, F.X(g.x), F.Y(g.z), g.r * F.sx);
        gr.addColorStop(0, `rgba(0,0,255,${g.a})`);
        gr.addColorStop(1, 'rgba(0,0,255,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(F.X(g.x - g.r), F.Y(g.z - g.r), 2 * g.r * F.sx, 2 * g.r * F.sz);
      }
      ctx.lineCap = 'round';
      for (const r of rayones) {
        ctx.strokeStyle = `rgba(0,0,255,${r.a.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.5, r.w * F.sx);
        const dx = Math.cos(r.ang) * r.l / 2, dz = Math.sin(r.ang) * r.l / 2;
        ctx.beginPath();
        ctx.moveTo(F.X(r.x - dx), F.Y(r.z - dz));
        ctx.lineTo(F.X(r.x + dx), F.Y(r.z + dz));
        ctx.stroke();
      }
    });
  }
  return ctx.getImageData(0, 0, ANCHO_TEX, ALTO_TEX).data;
}

// Campo suave en una rejilla gruesa. Por fila se interpola en z una sola
// vez y por texel sólo en x, con índices por columna precalculados por
// franja (mucho más barato que ruido() por texel).
function rejilla(mq, nx, nz, x0, x1, z0, z1, fn) {
  const v = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) v[j * (nx + 1) + i] = fn(x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz);
  const fila = new Float32Array(nx + 2);
  const ci = [], cu = [];
  for (const f of mq.franjas) {
    const I = new Int32Array(ANCHO_TEX), U = new Float32Array(ANCHO_TEX);
    for (let px = 0; px < ANCHO_TEX; px++) {
      let t = ((f.x0 + (px + 0.5) / f.sx - x0) / (x1 - x0)) * nx;
      t = t < 0 ? 0 : t > nx - 1e-4 ? nx - 1e-4 : t;
      I[px] = t | 0;
      U[px] = t - (t | 0);
    }
    ci.push(I); cu.push(U);
  }
  return {
    fila, ci, cu,
    preparar(z) {
      let t = ((z - z0) / (z1 - z0)) * nz;
      t = t < 0 ? 0 : t > nz - 1e-4 ? nz - 1e-4 : t;
      const j = t | 0, w = t - j, a = j * (nx + 1), b = a + nx + 1;
      for (let i = 0; i <= nx; i++) fila[i] = v[a + i] + (v[b + i] - v[a + i]) * w;
    },
  };
}

// Mapa normal desde alturas en cm (fila 0 = v 0), con el tamaño físico
// del texel de cada fila (las franjas tienen escalas distintas). Las
// filas `planas` (la franja C) quedan sin relieve: en los cantos las uv
// casi no cambian a lo largo del perfil y la base tangente que three
// deduce de sus derivadas no sirve.
function normalDeAlturas(H, tamU, tamV, planas) {
  const W = ANCHO_TEX, N = ALTO_TEX;
  const d = new Uint8Array(W * N * 4);
  for (let y = 0; y < N; y++) {
    const o0 = y * W * 4;
    if (planas[y]) {
      for (let x = 0; x < W; x++) { const o = o0 + x * 4; d[o] = 128; d[o + 1] = 128; d[o + 2] = 255; d[o + 3] = 255; }
      continue;
    }
    const ya = y > 0 ? y - 1 : 0, yb = y < N - 1 ? y + 1 : N - 1;
    const ku = 1 / (2 * tamU[y]), kv = 1 / ((yb - ya) * tamV[y]);
    const fa = ya * W, fb = yb * W, f = y * W;
    for (let x = 0; x < W; x++) {
      const xa = x > 0 ? x - 1 : 0, xb = x < W - 1 ? x + 1 : W - 1;
      const gx = (H[f + xb] - H[f + xa]) * ku * (2 / (xb - xa));
      const gy = (H[fb + x] - H[fa + x]) * kv;
      const l = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const o = o0 + x * 4;
      d[o] = (-gx * l * 127.5 + 128) | 0;
      d[o + 1] = (-gy * l * 127.5 + 128) | 0;
      d[o + 2] = (l * 127.5 + 128) | 0;
      d[o + 3] = 255;
    }
  }
  return d;
}

function xDeColumnas(mq) {
  return mq.franjas.map((f) => {
    const x = new Float32Array(ANCHO_TEX);
    for (let px = 0; px < ANCHO_TEX; px++) x[px] = f.x0 + (px + 0.5) / f.sx;
    return x;
  });
}

function tamanos(mq) {
  const tu = new Float32Array(ALTO_TEX), tv = new Float32Array(ALTO_TEX), planas = new Uint8Array(ALTO_TEX);
  for (let py = 0; py < ALTO_TEX; py++) {
    const f = mq.franjaDeFila(py);
    tu[ALTO_TEX - 1 - py] = 1 / f.sx;
    tv[ALTO_TEX - 1 - py] = 1 / f.sz;
    planas[ALTO_TEX - 1 - py] = f.i === 2 ? 1 : 0;
  }
  return [tu, tv, planas];
}

function texturas(color, orm, alt, mq) {
  const [tu, tv, planas] = tamanos(mq);
  return {
    color: texturaDeDatos(color, ANCHO_TEX, ALTO_TEX, { srgb: true, anisotropia: 8 }),
    orm: texturaDeDatos(orm, ANCHO_TEX, ALTO_TEX, { anisotropia: 8 }),
    normal: texturaDeDatos(normalDeAlturas(alt, tu, tv, planas), ANCHO_TEX, ALTO_TEX, { anisotropia: 8 }),
  };
}

// ── madera de haya ──
function texturasMadera(cfg, mq, mascara) {
  const rnd = azar(cfg.semilla * 31 + 7);
  // anillos de crecimiento y fibras, en función de la coordenada de veta t
  const NA = 16384, T0 = -4, T1 = 4, kA = NA / (T1 - T0);
  const anillos = new Float32Array(NA), fibras = new Float32Array(NA);
  for (let i = 0; i < NA;) {
    const w = 0.12 + 0.24 * rnd(), k = 0.25 + 0.75 * rnd() * rnd();
    const n = Math.max(1, Math.round(w * kA));
    for (let j = 0; j < n && i < NA; j++, i++) {
      const p = j / n;
      anillos[i] = k * suave(0.5, 0.88, p) * (1 - suave(0.93, 1, p));
    }
  }
  for (let i = 0; i < NA; i++) {
    const t = T0 + i / kA;
    fibras[i] = (ruido(t * 95, 3.7) - 0.5) * 1.4 + (ruido(t * 260, 9.1) - 0.5) * 0.8;
  }
  const L2 = cfg.L / 2 + 0.3, W2 = cfg.W / 2 + 0.2, Wm = cfg.W / 2, Lm = cfg.L / 2;
  const onda = rejilla(mq, 90, 24, -L2, L2, -W2, W2, (x, z) => ruido(x * 1.1 + 4, z * 3.5 + 1) - 0.5);
  const manchas = rejilla(mq, 60, 10, -L2, L2, -W2, W2, (x, z) => ruido(x * 0.35 + 9, z * 0.9 + 5) * 0.6 + ruido(x * 1.3, z * 2.6 + 3) * 0.4);
  const fibraMod = rejilla(mq, 120, 30, -L2, L2, -W2, W2, (x, z) => 0.6 + 0.8 * ruido(x * 2.2 + 1, z * 6 + 8));
  // grafito: el roce del lápiz contra el borde graduado, entre 2 y 13 cm
  const grafito = rejilla(mq, 124, 30, -L2, L2, -W2, W2, (x, z) => {
    const e = z + Wm;
    const largo = suave(-13.4, -12.2, x) * (1 - suave(-4.5, -2.6, x));
    const ancho = suave(-0.02, 0.03, e) * (1 - suave(0.06, 0.26 + 0.1 * ruido(x * 0.8, 2), e));
    return largo * ancho * (0.4 + 0.6 * ruido(x * 1.7 + 3, z * 9 + 1));
  });
  const X = xDeColumnas(mq);
  const colA = [], colB = [], colTono = [];
  for (const x of X) {
    const a = new Float32Array(ANCHO_TEX), b = new Float32Array(ANCHO_TEX), t = new Float32Array(ANCHO_TEX);
    for (let px = 0; px < ANCHO_TEX; px++) {
      const xx = x[px];
      a[px] = 0.5 * (ruido(xx * 0.07 + 2, 0.3) - 0.5) + 0.08 * (ruido(xx * 0.5 + 5, 1.7) - 0.5);
      b[px] = 0.18 * (ruido(xx * 0.05 + 7, 2.9) - 0.5);
      t[px] = (1 + 0.07 * (ruido(xx * 0.09 + 1, 4.4) - 0.5) + 0.03 * (ruido(xx * 0.6, 6.1) - 0.5)) * (1 - 0.06 * suave(Lm - 0.6, Lm, Math.abs(xx)));
    }
    colA.push(a); colB.push(b); colTono.push(t);
  }

  const base = lineal(0xd0bc9f);           // haya clara
  const radio = lineal(0xa8704e);          // radios: rojizos
  const tinta = lineal(0x1b1917);
  const gris = lineal(0x6f6d6a);           // grafito frotado
  const n = ANCHO_TEX * ALTO_TEX;
  const color = new Uint8Array(n * 4), orm = new Uint8Array(n * 4), alt = new Float32Array(n);

  for (let py = 0; py < ALTO_TEX; py++) {
    const f = mq.franjaDeFila(py);
    const z = mq.z0 + (py + 0.5 - f.py0) / f.sz;
    const d0 = (ALTO_TEX - 1 - py) * ANCHO_TEX, o0 = py * ANCHO_TEX * 4;
    const x = X[f.i], ca = colA[f.i], cb = colB[f.i], ct = colTono[f.i];
    onda.preparar(z); manchas.preparar(z); fibraMod.preparar(z); grafito.preparar(z);
    const On = onda.fila, Oi = onda.ci[f.i], Ou = onda.cu[f.i];
    const Mn = manchas.fila, Mi = manchas.ci[f.i], Mu = manchas.cu[f.i];
    const Fn = fibraMod.fila, Fi = fibraMod.ci[f.i], Fu = fibraMod.cu[f.i];
    const Gn = grafito.fila, Gi = grafito.ci[f.i], Gu = grafito.cu[f.i];
    // mugre de las manos cerca de los bordes largos
    const bordeZ = suave(Wm - 0.35, Wm + 0.02, Math.abs(z));
    const enC = f.i === 2;
    for (let px = 0; px < ANCHO_TEX; px++) {
      let i = Oi[px];
      const on = On[i] + (On[i + 1] - On[i]) * Ou[px];
      const t = z * (1 + cb[px]) + ca[px] + 0.07 * on;
      let it = ((t - T0) * kA) | 0;
      it = it < 0 ? 0 : it >= NA ? NA - 1 : it;
      i = Fi[px];
      const an = anillos[it], fi = fibras[it] * (Fn[i] + (Fn[i + 1] - Fn[i]) * Fu[px]);
      i = Mi[px];
      const m = Mn[i] + (Mn[i + 1] - Mn[i]) * Mu[px];
      const osc = (1 - 0.15 * an - 0.035 * fi) * ct[px] * (1 + 0.07 * (m - 0.5)) * (1 - 0.06 * bordeZ);
      let r = base[0] * osc, g = base[1] * osc * (1 - 0.03 * an), b = base[2] * osc * (1 - 0.07 * an);
      const o = o0 + px * 4;
      const ve = mascara[o + 1] / 255;
      const kv = 0.5 * ve;
      r += (radio[0] - r) * kv; g += (radio[1] - g) * kv; b += (radio[2] - b) * kv;
      const golpe = mascara[o + 2] / 255;
      r *= 1 - 0.1 * golpe; g *= 1 - 0.12 * golpe; b *= 1 - 0.14 * golpe;
      let gr = 0;
      if (!enC) {
        i = Gi[px];
        gr = 0.3 * (Gn[i] + (Gn[i + 1] - Gn[i]) * Gu[px]);
        r += (gris[0] - r) * gr; g += (gris[1] - g) * gr; b += (gris[2] - b) * gr;
      }
      // tinta impresa: casi opaca, con poros y gastada donde más se usa
      let a = mascara[o] / 255;
      if (a > 0) {
        a *= 0.94 - 0.25 * bordeZ * suave(0.5, 0.75, m) - 0.12 * hash(px, py + 7919) * hash(px + 31, py);
        r += (tinta[0] - r) * a; g += (tinta[1] - g) * a; b += (tinta[2] - b) * a;
      }
      const k = (d0 + px) * 4;
      color[k] = aSrgb(r); color[k + 1] = aSrgb(g); color[k + 2] = aSrgb(b); color[k + 3] = 255;
      orm[k] = 255;
      orm[k + 1] = aByte(0.52 + 0.06 * fi + 0.08 * (m - 0.5) + 0.1 * golpe - 0.06 * a - 0.15 * gr);
      orm[k + 2] = 0; orm[k + 3] = 255;
      alt[d0 + px] = -0.0011 * an - 0.0005 * fi + 0.0003 * ve - 0.006 * golpe + 0.0004 * a;
    }
  }
  return texturas(color, orm, alt, mq);
}

// ── acero inoxidable cepillado ──
function texturasAcero(cfg, mq, mascara) {
  // estrías del cepillado: una función de z casi pura, con tramos que
  // cambian a lo largo de x
  const NZ = 8192, Z0 = -1.5, Z1 = 1.5, kZ = NZ / (Z1 - Z0);
  const estrias = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    const z = Z0 + i / kZ;
    estrias[i] = (ruido(z * 420, 1.3) - 0.5) * 1.2 + (ruido(z * 1300, 7.7) - 0.5) * 0.8 + (ruido(z * 90, 2.2) - 0.5) * 0.6;
  }
  const L2 = cfg.L / 2 + 0.3, W2 = cfg.W / 2 + 0.2, Wm = cfg.W / 2;
  const tramos = rejilla(mq, 70, 700, -L2, L2, -W2, W2, (x, z) => (hash(Math.floor(x * 3 + 1000), Math.floor(z * 350 + 1000)) - 0.5));
  const manchas = rejilla(mq, 80, 14, -L2, L2, -W2, W2, (x, z) => ruido(x * 0.5 + 3, z * 1.4 + 2) * 0.6 + ruido(x * 1.8 + 9, z * 3.1) * 0.4);
  // ondulación larga de la chapa (fracciones de grado): mueve el reflejo
  // del softbox a lo largo de la regla, como en una foto
  const A = cfg.mat.ond || 0;
  const ondas = rejilla(mq, 84, 8, -L2, L2, -W2, W2, (x, z) => A * (ruido(x * 0.11 + 2, z * 0.18 + 5) - 0.5));
  const X = xDeColumnas(mq);

  const tinta = lineal(0x161617);
  const n = ANCHO_TEX * ALTO_TEX;
  const color = new Uint8Array(n * 4), orm = new Uint8Array(n * 4), alt = new Float32Array(n);
  const rug0 = 0.2 + (cfg.mat.rug || 0);

  for (let py = 0; py < ALTO_TEX; py++) {
    const f = mq.franjaDeFila(py);
    const z = mq.z0 + (py + 0.5 - f.py0) / f.sz;
    const d0 = (ALTO_TEX - 1 - py) * ANCHO_TEX, o0 = py * ANCHO_TEX * 4;
    let iz = ((z - Z0) * kZ) | 0;
    iz = iz < 0 ? 0 : iz >= NZ ? NZ - 1 : iz;
    const es = estrias[iz] * 0.7;
    tramos.preparar(z); manchas.preparar(z); ondas.preparar(z);
    const Tn = tramos.fila, Ti = tramos.ci[f.i], Tu = tramos.cu[f.i];
    const Mn = manchas.fila, Mi = manchas.ci[f.i], Mu = manchas.cu[f.i];
    const On = ondas.fila, Oi = ondas.ci[f.i], Ou = ondas.cu[f.i];
    const borde = suave(Wm - 0.25, Wm + 0.02, Math.abs(z));
    for (let px = 0; px < ANCHO_TEX; px++) {
      let i = Ti[px];
      const e = es + 0.9 * (Tn[i] + (Tn[i + 1] - Tn[i]) * Tu[px]);
      i = Mi[px];
      const m = Mn[i] + (Mn[i + 1] - Mn[i]) * Mu[px];
      const huella = suave(0.55, 0.85, m);           // manchas de dedos: más mate
      const o = o0 + px * 4;
      const raya = mascara[o + 2] / 255;
      const ti = mascara[o] / 255;
      const a = ti > 0 ? ti * (0.96 - 0.08 * hash(px + 3, py + 11)) : 0;
      const v = 0.985 + 0.02 * e - 0.025 * huella - 0.03 * raya - 0.02 * borde;
      const k = (d0 + px) * 4;
      color[k] = aSrgb(v + (tinta[0] - v) * a);
      color[k + 1] = aSrgb(v + (tinta[1] - v) * a);
      color[k + 2] = aSrgb(v * 0.995 + (tinta[2] - v * 0.995) * a);
      color[k + 3] = 255;
      orm[k] = 255;
      const rug = rug0 + 0.05 * e + 0.12 * huella + 0.1 * raya + 0.05 * borde;
      orm[k + 1] = aByte(rug + (0.5 - rug) * a);
      orm[k + 2] = aByte(1 - a);
      orm[k + 3] = 255;
      i = Oi[px];
      alt[d0 + px] = On[i] + (On[i + 1] - On[i]) * Ou[px] + 0.00018 * e - 0.0008 * raya - 0.0012 * ti;
    }
  }
  return texturas(color, orm, alt, mq);
}

// ── geometría ──
// Contorno en planta: lista cerrada de {x, z, nx, nz} (normal hacia
// afuera del material), con puntos extra en los lados rectos donde las
// tapas se cortan (para que canto y tapa compartan vértices).
function contorno(cfg, cortesX, cortesZ) {
  const hx = cfg.L / 2, hz = cfg.W / 2, R = cfg.esquinas;
  const esq = [
    [-hx + R[0], -hz + R[0], Math.PI],
    [hx - R[1], -hz + R[1], 1.5 * Math.PI],
    [hx - R[2], hz - R[2], 0],
    [-hx + R[3], hz - R[3], 0.5 * Math.PI],
  ];
  const pts = [];
  for (let k = 0; k < 4; k++) {
    const [cx, cz, th0] = esq[k], r = R[k];
    const n = Math.max(3, Math.min(18, Math.round(3 + r * 26)));
    for (let j = 0; j <= n; j++) {
      const th = th0 + (Math.PI / 2) * (j / n);
      const c = Math.cos(th), s = Math.sin(th);
      pts.push({ x: cx + r * c, z: cz + r * s, nx: Math.abs(c) < 1e-12 ? 0 : c, nz: Math.abs(s) < 1e-12 ? 0 : s });
    }
    const a = pts[pts.length - 1];
    const [sx, sz, sth] = esq[(k + 1) % 4], rs = R[(k + 1) % 4];
    const b = { x: sx + rs * Math.cos(sth), z: sz + rs * Math.sin(sth) };
    const porX = k % 2 === 0;
    const va = porX ? a.x : a.z, vb = porX ? b.x : b.z;
    const cortes = (porX ? cortesX : cortesZ)
      .filter((v) => (v - va) * (v - vb) < 0 && Math.abs(v - va) > 1e-4 && Math.abs(v - vb) > 1e-4)
      .sort((p, q) => (vb > va ? p - q : q - p));
    for (const v of cortes) pts.push({ x: porX ? v : a.x, z: porX ? a.z : v, nx: a.nx, nz: a.nz });
  }
  return pts;
}

function circuloHueco(h) {
  const pts = [], n = 28;
  for (let j = 0; j < n; j++) {
    const th = (2 * Math.PI * j) / n;
    const c = Math.cos(th), s = Math.sin(th);
    pts.push({ x: h.x + h.r * c, z: h.z + h.r * s, nx: -c, nz: -s });
  }
  return pts;
}

// perfil del canto: φ de −90° (abajo) a +90° (arriba); dos anillos en 0°
// (arriba y abajo de la pared)
const PERFIL = [
  ...[-90, -60, -30, 0].map((g) => ({ phi: (g * Math.PI) / 180, arriba: false })),
  ...[0, 20, 40, 60, 78, 90].map((g) => ({ phi: (g * Math.PI) / 180, arriba: true })),
];

function colorCanto(cfg, o, phi) {
  if (cfg.material !== 'madera') return [1, 1, 1];
  // la testa (veta de punta) es más oscura; los cantos, apenas manoseados
  const pared = Math.cos(phi);
  const k = 1 - 0.2 * o.nx * o.nx * Math.sqrt(pared) - 0.04 * pared;
  return [k, k * 0.98, k * 0.96];
}

function agregarCanto(G, pts, cfg, mq) {
  const r = cfg.rCanto, N = pts.length, C = mq.franjas[2];
  const base = G.pos.length / 3;
  for (const p of PERFIL) {
    const cp = Math.cos(p.phi), sp = Math.sin(p.phi);
    for (const o of pts) {
      const dIn = r * (1 - cp);
      const x = o.x - o.nx * dIn, z = o.z - o.nz * dIn;
      let y, nx, ny, nz;
      if (!p.arriba) {
        y = cfg.yAbajo + r + r * sp;
        nx = o.nx * cp; ny = sp; nz = o.nz * cp;
      } else {
        const [yt, dy] = alturaArriba(cfg, z);
        y = yt - r + r * sp;
        const l = Math.hypot(1, dy);
        nx = o.nx * cp; ny = sp / l; nz = o.nz * cp - (sp * dy) / l;
      }
      const ln = Math.hypot(nx, ny, nz);
      G.pos.push(x, y, z);
      G.nor.push(nx / ln, ny / ln, nz / ln);
      G.uv.push(...mq.uv(C, x, z));
      G.col.push(...colorCanto(cfg, o, p.phi));
    }
  }
  for (let i = 0; i < PERFIL.length - 1; i++) for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const a = base + i * N + j, b = base + i * N + j2, c = base + (i + 1) * N + j, d = base + (i + 1) * N + j2;
    G.idx.push(a, b, d, a, d, c);
  }
}

// Recorte de un polígono contra el semiplano signo·(p[eje] − v) ≥ 0.
function recortar(poli, eje, v, signo) {
  const out = [];
  for (let i = 0; i < poli.length; i++) {
    const a = poli[i], b = poli[(i + 1) % poli.length];
    const da = signo * (a[eje] - v), db = signo * (b[eje] - v);
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      p[eje] = v;
      out.push(p);
    }
  }
  // sin vértices repetidos
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return out.length < 2 || Math.hypot(p.x - q.x, p.z - q.z) > 1e-7;
  });
}

function area(poli) {
  let s = 0;
  for (let i = 0; i < poli.length; i++) { const a = poli[i], b = poli[(i + 1) % poli.length]; s += a.x * b.z - b.x * a.z; }
  return s / 2;
}

function agregarTapa(G, anillo, huecos, arriba, cfg, mq, cortes) {
  let piezas = [anillo];
  for (const [eje, v] of cortes) {
    const sig = [];
    for (const p of piezas) for (const s of [1, -1]) {
      const q = recortar(p, eje, v, s);
      if (q.length >= 3 && Math.abs(area(q)) > 1e-8) sig.push(q);
    }
    piezas = sig;
  }
  for (const pieza of piezas) {
    let cx = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pieza) { cx += p.x; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    cx /= pieza.length;
    const f = arriba ? mq.franjas[cx < 0 ? 0 : 1] : mq.franjas[2];
    const adentro = huecos.filter((h) => {
      const hx = h.reduce((s, p) => s + p.x, 0) / h.length, hz = h.reduce((s, p) => s + p.z, 0) / h.length;
      return hx > minX && hx < maxX && hz > minZ && hz < maxZ;
    });
    const contorno2 = pieza.map((p) => new THREE.Vector2(p.x, p.z));
    const huecos2 = adentro.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
    const tris = THREE.ShapeUtils.triangulateShape(contorno2, huecos2);
    const verts = contorno2.concat(...huecos2);
    const base = G.pos.length / 3;
    for (const v of verts) {
      let y, n;
      if (arriba) {
        const [yt, dy] = alturaArriba(cfg, v.y);
        const l = Math.hypot(1, dy);
        y = yt; n = [0, 1 / l, -dy / l];
      } else { y = cfg.yAbajo; n = [0, -1, 0]; }
      G.pos.push(v.x, y, v.y);
      G.nor.push(...n);
      G.uv.push(...mq.uv(f, v.x, v.y));
      G.col.push(1, 1, 1);
    }
    for (const t of tris) G.idx.push(base + t[0], base + t[1], base + t[2]);
  }
}

// Da vuelta los triángulos cuya cara no mira hacia donde apuntan sus normales.
function orientar(G) {
  const P = G.pos, N = G.nor, I = G.idx;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const s = gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1]) + gz * (N[a + 2] + N[b + 2] + N[c + 2]);
    if (s < 0) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  }
}

function construirGeometria(cfg, mq) {
  const G = { pos: [], nor: [], uv: [], col: [], idx: [] };
  const cortesTapa = [['x', 0]];
  const cortesZ = [];
  if (cfg.bisel) {
    const { zb, suave: e } = cfg.bisel;
    for (const k of [-1, -0.5, 0, 0.5, 1]) { cortesTapa.push(['z', zb + k * e]); cortesZ.push(zb + k * e); }
  }
  const ext = contorno(cfg, [0], cortesZ);
  agregarCanto(G, ext, cfg, mq);
  const huecos = [];
  if (cfg.agujero) {
    const h = circuloHueco(cfg.agujero);
    agregarCanto(G, h, cfg, mq);
    huecos.push(h.map((o) => ({ x: o.x - o.nx * cfg.rCanto, z: o.z - o.nz * cfg.rCanto })));
  }
  const anillo = ext.map((o) => ({ x: o.x - o.nx * cfg.rCanto, z: o.z - o.nz * cfg.rCanto }));
  agregarTapa(G, anillo, huecos, true, cfg, mq, cortesTapa);
  agregarTapa(G, anillo, huecos, false, cfg, mq, []);
  orientar(G);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
  g.setIndex(G.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ── materiales ──
function crearMaterial(cfg, tex) {
  const M = cfg.mat || {};
  if (cfg.material === 'madera') {
    return recibirSombra(new THREE.MeshPhysicalMaterial({
      map: tex.color,
      vertexColors: true,
      roughness: 1,
      roughnessMap: tex.orm,
      metalness: 0,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(1, 1),
      // laca satinada: refleja los softboxes sin tapar la veta
      clearcoat: 0.55,
      clearcoatRoughness: 0.3,
      specularIntensity: 0.45,
      dithering: true,
    }), { envoltura: 0.35, colorSSS: [1, 0.74, 0.52], difusaEnv: 0.45, clave: 'regla-madera' });
  }
  return recibirSombra(new THREE.MeshPhysicalMaterial({
    color: M.color,
    map: tex.color,
    vertexColors: true,
    roughness: 1,
    roughnessMap: tex.orm,
    metalness: 1,
    metalnessMap: tex.orm,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(1, 1),
    // cepillado a lo largo (u = x): brillos estirados de través
    anisotropy: M.anisotropy,
    envMapIntensity: M.envMapIntensity,
    dithering: true,
  }), { clave: 'regla-acero' });
}

const CACHE = new Map();
function recursos(variante) {
  if (CACHE.has(variante)) return CACHE.get(variante);
  const T = [performance.now()];
  const cfg = configurar(variante);
  const mq = crearMaqueta(cfg.L, cfg.W);
  const mascara = dibujarMascara(cfg, mq);
  T.push(performance.now());
  const tex = cfg.material === 'madera' ? texturasMadera(cfg, mq, mascara) : texturasAcero(cfg, mq, mascara);
  T.push(performance.now());
  const r = { cfg, geo: construirGeometria(cfg, mq), mat: crearMaterial(cfg, tex) };
  T.push(performance.now());
  CACHE.set(variante, r);
  return r;
}

export function crear(variante = variantes[0]) {
  if (!CONF[variante]) variante = variantes[0];
  const { cfg, geo, mat } = recursos(variante);
  const malla = new THREE.Mesh(geo, mat);
  malla.name = `regla-${variante}`;
  return {
    malla,
    cuerpo: {
      medias: [cfg.L / 2 - cfg.radio, 0, cfg.W / 2 - cfg.radio],
      radio: cfg.radio,
      masa: cfg.masa,
      material: cfg.material,
    },
  };
}
