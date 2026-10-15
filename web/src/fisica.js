// ─────────────────────────────────────────────────────────────
//  Física de los dados: cuerpos rígidos resueltos con XPBD
//  (Müller et al., "Detailed Rigid Body Simulation with Extended
//  Position Based Dynamics", 2020) con muchos substeps y una sola
//  iteración por substep, como la gelatina de la referencia.
//
//  JS puro, sin three.js: se puede correr y testear en node.
//
//  Unidades: el lado del dado mide 1. El piso es y = 0 y el eje y
//  apunta a la cámara. La caja tiene paredes (los planos laterales
//  del encuadre) y un techo de vidrio invisible.
// ─────────────────────────────────────────────────────────────

const LADO = 1;
const MITAD = LADO / 2;

// Caras: eje local → valor. Opuestas suman 7 y 1-2-3 giran en sentido
// antihorario alrededor de su esquina, como en un dado occidental.
export const CARAS = [
  { eje: [0, 1, 0], valor: 1 },
  { eje: [0, -1, 0], valor: 6 },
  { eje: [0, 0, 1], valor: 2 },
  { eje: [0, 0, -1], valor: 5 },
  { eje: [1, 0, 0], valor: 3 },
  { eje: [-1, 0, 0], valor: 4 },
];

export class Dado {
  constructor(id) {
    this.id = id;
    this.x = 0; this.y = MITAD; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.qx = 0; this.qy = 0; this.qz = 0; this.qw = 1;
    this.wx = 0; this.wy = 0; this.wz = 0;
    // pose al empezar el substep (para velocidades y fricción estática)
    this.px = 0; this.py = 0; this.pz = 0;
    this.pqx = 0; this.pqy = 0; this.pqz = 0; this.pqw = 1;
    // celda de la grilla a la que pertenece
    this.cx = 0; this.cz = 0;
    this.resorte = 1;       // 0 = suelto, 1 = atado a su celda
    this.dormido = false;
    this.quieto = 0;        // segundos seguidos casi sin moverse
    this.apoyado = false;   // tocó algo en el último paso
    this.vuelo = 0;         // segundos que le quedan a un salto dirigido
    this.golpe = 0;         // velocidad del golpe más fuerte del paso (para sonido)
    this.golpeDado = false; // si ese golpe fue contra otro dado
    this.tinte = 1;
  }
}

// Contacto reutilizable (pool) para no generar basura en el bucle.
class Contacto {
  constructor() {
    this.a = null; this.b = null;
    this.nx = 0; this.ny = 0; this.nz = 0;
    this.ax = 0; this.ay = 0; this.az = 0; // punto en A, coords locales de A
    this.bx = 0; this.by = 0; this.bz = 0; // punto en B, coords locales de B (o mundo si B es fijo)
    this.lambda = 0;
    this.vnPre = 0;
    this.muS = 0; this.muD = 0; this.e = 0;
  }
}

// Puntos de muestra del cubo interior (esquinas + 3 por arista). Cada uno
// es el centro de una esfera de radio `radio`: el dado redondeado es la
// suma de Minkowski de ese cubo interior y la esfera.
function puntosMuestra(a) {
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.push(sx * a, sy * a, sz * a);
  const t = [-0.5, 0, 0.5];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) for (const u of t) {
    p.push(u * a, s1 * a, s2 * a);
    p.push(s1 * a, u * a, s2 * a);
    p.push(s1 * a, s2 * a, u * a);
  }
  return new Float64Array(p);
}

const tmp = new Float64Array(12);

function rotar(d, vx, vy, vz, o) {
  const qx = d.qx, qy = d.qy, qz = d.qz, qw = d.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  tmp[o] = vx + qw * tx + (qy * tz - qz * ty);
  tmp[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  tmp[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

function rotarPrev(d, vx, vy, vz, o) {
  const qx = d.pqx, qy = d.pqy, qz = d.pqz, qw = d.pqw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  tmp[o] = vx + qw * tx + (qy * tz - qz * ty);
  tmp[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  tmp[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

function rotarInv(d, vx, vy, vz, o) {
  const qx = -d.qx, qy = -d.qy, qz = -d.qz, qw = d.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  tmp[o] = vx + qw * tx + (qy * tz - qz * ty);
  tmp[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  tmp[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

// Matriz de rotación del dado, por filas, en m[o..o+8].
function matriz(d, m, o) {
  const x = d.qx, y = d.qy, z = d.qz, w = d.qw;
  m[o] = 1 - 2 * (y * y + z * z); m[o + 1] = 2 * (x * y - z * w); m[o + 2] = 2 * (x * z + y * w);
  m[o + 3] = 2 * (x * y + z * w); m[o + 4] = 1 - 2 * (x * x + z * z); m[o + 5] = 2 * (y * z - x * w);
  m[o + 6] = 2 * (x * z - y * w); m[o + 7] = 2 * (y * z + x * w); m[o + 8] = 1 - 2 * (x * x + y * y);
}

function normalizarQ(d) {
  const l = Math.hypot(d.qx, d.qy, d.qz, d.qw) || 1;
  d.qx /= l; d.qy /= l; d.qz /= l; d.qw /= l;
}

export class Mundo {
  constructor(p = {}) {
    this.g = p.g ?? 520;
    this.radio = p.radio ?? 0.13;
    this.a = MITAD - this.radio;
    this.invM = 1;
    this.invI = 6 / (LADO * LADO); // cubo macizo: I = m·l²/6
    this.substepMax = p.substepMax ?? 1 / 480;
    this.k = p.k ?? 110;             // resorte horizontal hacia la celda
    this.amortResorte = p.amortResorte ?? 3;
    this.aire = p.aire ?? 0.15;      // arrastre lineal muy leve
    this.piso = { muS: 0.55, muD: 0.38, e: 0.34 };
    this.entreDados = { muS: 0.3, muD: 0.22, e: 0.5 };
    this.pared = { muS: 0.15, muD: 0.1, e: 0.35 };
    this.dados = [];
    // planos {nx, ny, nz, d, tipo}: el interior cumple n·p >= d
    this.planos = [{ nx: 0, ny: 1, nz: 0, d: 0, tipo: 'piso' }];
    this.aExt = [0, 0, 0];   // aceleración de la caja (sacudida), en unidades de dado/s²
    this.dedos = [];          // [{o:[3], d0:[3], d1:[3]}] rayos del dedo al inicio y fin del frame
    this.agarres = new Map(); // id → {d, lx, ly, lz, tx, ty, tz}: dados colgando de un dedo
    this.muestras = puntosMuestra(this.a);
    this.esquinas = this.muestras.subarray(0, 24);
    this.contactos = [];
    this.nContactos = 0;
    this.pares = [];
    this.tiempo = 0;
    this.alineacion = p.alineacion ?? 0.09; // segundos del deslizamiento magnético a la celda
    this.onGolpe = null;
  }

  agregarDado(cx, cz) {
    const d = new Dado(this.dados.length);
    d.cx = cx; d.cz = cz; d.x = cx; d.z = cz;
    d.px = d.x; d.py = d.y; d.pz = d.z;
    this.dados.push(d);
    return d;
  }

  quitarDado(d) {
    const i = this.dados.indexOf(d);
    if (i >= 0) this.dados.splice(i, 1);
  }

  despertar(d) {
    if (!d.dormido) return;
    d.dormido = false;
    d.quieto = 0;
  }

  despertarTodos() {
    for (const d of this.dados) this.despertar(d);
  }

  // ── impulsos ──
  // Impulso J (mundo) aplicado en el punto P (mundo).
  impulso(d, Px, Py, Pz, Jx, Jy, Jz) {
    this.despertar(d);
    const rx = Px - d.x, ry = Py - d.y, rz = Pz - d.z;
    d.vx += Jx * this.invM; d.vy += Jy * this.invM; d.vz += Jz * this.invM;
    d.wx += this.invI * (ry * Jz - rz * Jy);
    d.wy += this.invI * (rz * Jx - rx * Jz);
    d.wz += this.invI * (rx * Jy - ry * Jx);
  }

  // Salto con giro al azar (toque, sacudida suave). `altura` en lados de dado.
  saltar(d, altura, giro, azar = Math.random) {
    this.despertar(d);
    const vy = Math.sqrt(2 * this.g * Math.max(altura, 0.05));
    d.vy = Math.max(d.vy, 0) + vy;
    // giro mayormente horizontal: es lo que cambia la cara de arriba
    const th = azar() * Math.PI * 2;
    d.wx += Math.cos(th) * giro;
    d.wz += Math.sin(th) * giro;
    d.wy += (azar() - 0.5) * giro * 0.6;
    d.vx += (azar() - 0.5) * 1.5;
    d.vz += (azar() - 0.5) * 1.5;
  }

  // Salto balístico que aterriza en (tx, tz) en `T` segundos.
  saltarA(d, tx, tz, T, giro, azar = Math.random) {
    this.despertar(d);
    const h0 = d.y - MITAD;
    d.vx = (tx - d.x) / T;
    d.vz = (tz - d.z) / T;
    // y(T) = h0 + vy T - g T²/2 = 0  →  vy = (g T²/2 - h0) / T
    d.vy = (this.g * T * T / 2 - h0) / T;
    const th = azar() * Math.PI * 2;
    d.wx = Math.cos(th) * giro;
    d.wz = Math.sin(th) * giro;
    d.wy = (azar() - 0.5) * giro * 0.5;
    d.vuelo = T;
  }

  // ── agarre: el dado cuelga del dedo por el punto donde se lo tocó ──
  // Es una unión blanda (XPBD con compliance), como el agarre de la
  // gelatina de la referencia: el dado se balancea y choca con los demás.
  agarrar(id, d, Px, Py, Pz) {
    this.despertar(d);
    rotarInv(d, Px - d.x, Py - d.y, Pz - d.z, 0);
    this.agarres.set(id, { d, lx: tmp[0], ly: tmp[1], lz: tmp[2], tx: Px, ty: Py, tz: Pz });
    d.resorte = 0;
  }

  moverAgarre(id, tx, ty, tz) {
    const g = this.agarres.get(id);
    if (g) { g.tx = tx; g.ty = ty; g.tz = tz; }
  }

  soltarAgarre(id) {
    const g = this.agarres.get(id);
    if (!g) return;
    this.agarres.delete(id);
    g.d.resorte = 1;
  }

  _agarres(h) {
    const alfa = 4e-4 / (h * h); // compliance / h²
    for (const g of this.agarres.values()) {
      const d = g.d;
      d.dormido = false; d.quieto = 0;
      rotar(d, g.lx, g.ly, g.lz, 0);
      const rx = tmp[0], ry = tmp[1], rz = tmp[2];
      let nx = d.x + rx - g.tx, ny = d.y + ry - g.ty, nz = d.z + rz - g.tz;
      const C = Math.hypot(nx, ny, nz);
      if (C < 1e-7) continue;
      nx /= C; ny /= C; nz /= C;
      const w = this._w(d, rx, ry, rz, nx, ny, nz);
      const dl = -C / (w + alfa);
      this._mover(d, rx, ry, rz, nx * dl, ny * dl, nz * dl, 1);
    }
  }

  // ── consultas ──
  valorArriba(d) {
    let mejor = -2, valor = 1;
    for (const c of CARAS) {
      rotar(d, c.eje[0], c.eje[1], c.eje[2], 0);
      if (tmp[1] > mejor) { mejor = tmp[1]; valor = c.valor; }
    }
    return valor;
  }

  // Coseno entre la cara de arriba y la vertical (1 = perfectamente plano).
  planitud(d) {
    let mejor = -2;
    for (const c of CARAS) {
      rotar(d, c.eje[0], c.eje[1], c.eje[2], 0);
      if (tmp[1] > mejor) mejor = tmp[1];
    }
    return mejor;
  }

  // Rayo contra cada dado (caja inflada `margen`). Devuelve {dado, t, x,y,z} o null.
  rayo(ox, oy, oz, dx, dy, dz, margen = 0) {
    let mejor = null, tMejor = Infinity;
    const h = MITAD + margen;
    for (const d of this.dados) {
      // descarte rápido por esfera
      const cx = d.x - ox, cy = d.y - oy, cz = d.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (d2 > (h * 1.74) ** 2) continue;
      rotarInv(d, -cx, -cy, -cz, 0);
      const lox = tmp[0], loy = tmp[1], loz = tmp[2];
      rotarInv(d, dx, dy, dz, 3);
      const ldx = tmp[3], ldy = tmp[4], ldz = tmp[5];
      let t0 = -Infinity, t1 = Infinity;
      const ejes = [[lox, ldx], [loy, ldy], [loz, ldz]];
      let ok = true;
      for (const [o, v] of ejes) {
        if (Math.abs(v) < 1e-9) { if (o < -h || o > h) { ok = false; break; } continue; }
        let ta = (-h - o) / v, tb = (h - o) / v;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || t1 < 0) continue;
      const t = Math.max(t0, 0);
      if (t < tMejor) { tMejor = t; mejor = d; }
    }
    if (!mejor) return null;
    return { dado: mejor, t: tMejor, x: ox + dx * tMejor, y: oy + dy * tMejor, z: oz + dz * tMejor };
  }

  // ── paso de simulación ──
  paso(dt) {
    dt = Math.min(dt, 1 / 30);
    const n = Math.max(1, Math.ceil(dt / this.substepMax));
    const h = dt / n;
    for (const d of this.dados) { d.golpe = 0; d.golpeDado = false; d.apoyado = false; }
    this._amplia(dt);
    for (let i = 0; i < n; i++) this._substep(h, (i + 1) / n, dt);
    this._dormir(dt);
    this.tiempo += dt;
  }

  // Fase amplia: pares de dados que podrían tocarse durante el paso.
  _amplia(dt) {
    const pares = this.pares;
    pares.length = 0;
    const L = this.dados;
    const rCirc = Math.sqrt(3) * MITAD;
    for (let i = 0; i < L.length; i++) {
      const A = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const B = L[j];
        if (A.dormido && B.dormido) continue;
        const dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z;
        const vr = Math.hypot(A.vx - B.vx, A.vy - B.vy, A.vz - B.vz) * dt;
        const lim = 2 * rCirc + vr + 0.05;
        if (dx * dx + dy * dy + dz * dz < lim * lim) pares.push(A, B);
      }
    }
  }

  _contacto() {
    if (this.nContactos >= this.contactos.length) this.contactos.push(new Contacto());
    return this.contactos[this.nContactos++];
  }

  _substep(h, frac, dtFrame) {
    const g = this.g;
    const [ax, ay, az] = this.aExt;
    // 1. integrar
    for (const d of this.dados) {
      if (d.dormido) continue;
      d.px = d.x; d.py = d.y; d.pz = d.z;
      d.pqx = d.qx; d.pqy = d.qy; d.pqz = d.qz; d.pqw = d.qw;
      let fx = ax, fy = ay - g, fz = az;
      const k = this.k * d.resorte * (d.vuelo > 0 ? 0 : 1);
      if (k > 0) {
        const ex = d.x - d.cx, ez = d.z - d.cz;
        // más firme cuanto más lejos, para que nunca se escape de su zona
        const e2 = (ex * ex + ez * ez) / 0.36;
        const kk = k * (1 + e2);
        fx -= kk * ex + this.amortResorte * d.resorte * d.vx;
        fz -= kk * ez + this.amortResorte * d.resorte * d.vz;
      }
      const ar = this.aire;
      fx -= ar * d.vx; fy -= ar * d.vy; fz -= ar * d.vz;
      d.vx += fx * h; d.vy += fy * h; d.vz += fz * h;
      d.x += d.vx * h; d.y += d.vy * h; d.z += d.vz * h;
      const wx = d.wx, wy = d.wy, wz = d.wz;
      const qx = d.qx, qy = d.qy, qz = d.qz, qw = d.qw;
      const s = 0.5 * h;
      d.qx += s * (wx * qw + wy * qz - wz * qy);
      d.qy += s * (wy * qw + wz * qx - wx * qz);
      d.qz += s * (wz * qw + wx * qy - wy * qx);
      d.qw += s * (-wx * qx - wy * qy - wz * qz);
      normalizarQ(d);
      if (d.vuelo > 0) d.vuelo -= h;
    }

    // 2. resolver posiciones (detección + corrección en el mismo recorrido)
    this.nContactos = 0;
    for (const d of this.dados) if (!d.dormido) this._contactosPlanos(d);
    const P = this.pares;
    for (let i = 0; i < P.length; i += 2) {
      const A = P[i], B = P[i + 1];
      if (A.dormido && B.dormido) continue;
      this._contactosDados(A, B);
      this._contactosDados(B, A);
    }

    if (this.agarres.size) this._agarres(h);

    // 3. velocidades a partir de las posiciones
    const ih = 1 / h;
    for (const d of this.dados) {
      if (d.dormido) continue;
      d.vx = (d.x - d.px) * ih; d.vy = (d.y - d.py) * ih; d.vz = (d.z - d.pz) * ih;
      // Δq = q · q_prev⁻¹
      const qx = d.qx, qy = d.qy, qz = d.qz, qw = d.qw;
      const px = -d.pqx, py = -d.pqy, pz = -d.pqz, pw = d.pqw;
      let dx = qw * px + qx * pw + qy * pz - qz * py;
      let dy = qw * py + qy * pw + qz * px - qx * pz;
      let dz = qw * pz + qz * pw + qx * py - qy * px;
      const dw = qw * pw - qx * px - qy * py - qz * pz;
      if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; }
      d.wx = 2 * dx * ih; d.wy = 2 * dy * ih; d.wz = 2 * dz * ih;
    }

    // 4. resolver velocidades: fricción dinámica y rebote
    for (let i = 0; i < this.nContactos; i++) this._velocidadContacto(this.contactos[i], h);

    // 5. el dedo arrastra por fricción el punto que toca
    if (this.dedos.length) this._dedos(h, frac, dtFrame);

    // 6. un dado colgando se amortigua un poco (si no, péndulo eterno)
    for (const g of this.agarres.values()) {
      const d = g.d, k = Math.exp(-h * 6), kw = Math.exp(-h * 3);
      d.vx *= k; d.vy *= k; d.vz *= k;
      d.wx *= kw; d.wy *= kw; d.wz *= kw;
    }
  }

  _contactosPlanos(d) {
    const r = this.radio;
    const E = this.esquinas;
    const lista = this._lista || (this._lista = []);
    for (const pl of this.planos) {
      // descarte rápido: el centro está lejos del plano
      const sc = pl.nx * d.x + pl.ny * d.y + pl.nz * d.z - pl.d;
      if (sc > 0.9) continue;
      // esquinas que penetran, de la más hundida a la menos: resolverlas
      // siempre en el mismo orden fijo deja un sesgo que hace "caminar"
      // al dado en reposo
      lista.length = 0;
      for (let k = 0; k < 24; k += 3) {
        rotar(d, E[k], E[k + 1], E[k + 2], 0);
        const s = pl.nx * (d.x + tmp[0]) + pl.ny * (d.y + tmp[1]) + pl.nz * (d.z + tmp[2]) - pl.d;
        if (s < r) lista.push(r - s, k);
      }
      if (!lista.length) continue;
      const orden = [];
      for (let i = 0; i < lista.length; i += 2) orden.push(i);
      orden.sort((i, j) => lista[j] - lista[i]);
      const mat = pl.tipo === 'piso' ? this.piso : this.pared;
      for (const i of orden) {
        const k = lista[i + 1];
        rotar(d, E[k], E[k + 1], E[k + 2], 0);
        const s = pl.nx * (d.x + tmp[0]) + pl.ny * (d.y + tmp[1]) + pl.nz * (d.z + tmp[2]) - pl.d;
        const pen = r - s;
        if (pen <= 0) continue;
        // punto de contacto en la superficie del dado, en coords locales
        rotarInv(d, pl.nx, pl.ny, pl.nz, 3);
        const c = this._contacto();
        c.a = d; c.b = null;
        c.nx = pl.nx; c.ny = pl.ny; c.nz = pl.nz;
        c.ax = E[k] - tmp[3] * r; c.ay = E[k + 1] - tmp[4] * r; c.az = E[k + 2] - tmp[5] * r;
        c.muS = mat.muS; c.muD = mat.muD; c.e = mat.e;
        // velocidad normal antes de corregir (para el rebote)
        rotar(d, c.ax, c.ay, c.az, 6);
        const rx = tmp[6], ry = tmp[7], rz = tmp[8];
        const vcx = d.vx + d.wy * rz - d.wz * ry;
        const vcy = d.vy + d.wz * rx - d.wx * rz;
        const vcz = d.vz + d.wx * ry - d.wy * rx;
        c.vnPre = vcx * pl.nx + vcy * pl.ny + vcz * pl.nz;
        c.lambda = this._corregir(d, rx, ry, rz, null, 0, 0, 0, pl.nx, pl.ny, pl.nz, pen);
        this._friccionEstatica(c);
        d.apoyado = true;
        if (-c.vnPre > d.golpe) { d.golpe = -c.vnPre; d.golpeDado = false; }
      }
    }
  }

  // Puntos de muestra de A contra la caja redondeada de B.
  _contactosDados(A, B) {
    const r = this.radio, a = this.a, M = this.muestras;
    const lim = 2 * r;
    // descarte rápido por esferas envolventes
    const ex = A.x - B.x, ey = A.y - B.y, ez = A.z - B.z;
    const rr = 2 * (Math.sqrt(3) * this.a + r);
    if (ex * ex + ey * ey + ez * ez > rr * rr) return;
    // transformación de coords de A a coords de B: R = R_Bᵀ R_A, t = R_Bᵀ (x_A − x_B)
    const R = this._rel || (this._rel = new Float64Array(12));
    this._relativa(A, B, R);
    for (let k = 0; k < M.length; k += 3) {
      const sx = M[k], sy = M[k + 1], sz = M[k + 2];
      const lx = R[0] * sx + R[1] * sy + R[2] * sz + R[9];
      const qx = Math.abs(lx) - a;
      if (qx >= lim) continue;
      const ly = R[3] * sx + R[4] * sy + R[5] * sz + R[10];
      const qy = Math.abs(ly) - a;
      if (qy >= lim) continue;
      const lz = R[6] * sx + R[7] * sy + R[8] * sz + R[11];
      const qz = Math.abs(lz) - a;
      if (qz >= lim) continue;
      // punto más cercano del cubo interior de B y normal (coords de B)
      let cx = Math.max(-a, Math.min(a, lx)), cy = Math.max(-a, Math.min(a, ly)), cz = Math.max(-a, Math.min(a, lz));
      let nx = lx - cx, ny = ly - cy, nz = lz - cz;
      let dist = Math.hypot(nx, ny, nz);
      if (dist > 1e-9) { nx /= dist; ny /= dist; nz /= dist; }
      else {
        // el punto quedó dentro del cubo interior: sale por la cara más cercana
        if (qx >= qy && qx >= qz) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; cx = nx * a; dist = qx; }
        else if (qy >= qz) { ny = Math.sign(ly) || 1; nx = 0; nz = 0; cy = ny * a; dist = qy; }
        else { nz = Math.sign(lz) || 1; nx = 0; ny = 0; cz = nz * a; dist = qz; }
      }
      const pen = lim - dist;
      if (pen <= 0) continue;
      // a coordenadas de mundo
      rotar(A, sx, sy, sz, 0);
      rotar(B, nx, ny, nz, 6);
      const Nx = tmp[6], Ny = tmp[7], Nz = tmp[8];
      rotar(B, cx + nx * r, cy + ny * r, cz + nz * r, 9);
      const rbx = tmp[9], rby = tmp[10], rbz = tmp[11];
      const rax = tmp[0] - Nx * r, ray = tmp[1] - Ny * r, raz = tmp[2] - Nz * r;
      // despertar a B si A llega con fuerza; si no, B cuenta como fijo
      const vax = A.vx + A.wy * raz - A.wz * ray;
      const vay = A.vy + A.wz * rax - A.wx * raz;
      const vaz = A.vz + A.wx * ray - A.wy * rax;
      const vbx = B.vx + B.wy * rbz - B.wz * rby;
      const vby = B.vy + B.wz * rbx - B.wx * rbz;
      const vbz = B.vz + B.wx * rby - B.wy * rbx;
      const vn = (vax - vbx) * Nx + (vay - vby) * Ny + (vaz - vbz) * Nz;
      if (B.dormido && (vn < -0.4 || pen > 0.03)) this.despertar(B);
      if (A.dormido && (vn < -0.4 || pen > 0.03)) this.despertar(A);
      const c = this._contacto();
      c.a = A; c.b = B;
      c.nx = Nx; c.ny = Ny; c.nz = Nz;
      rotarInv(A, rax, ray, raz, 0);
      c.ax = tmp[0]; c.ay = tmp[1]; c.az = tmp[2];
      c.bx = cx + nx * r; c.by = cy + ny * r; c.bz = cz + nz * r;
      c.muS = this.entreDados.muS; c.muD = this.entreDados.muD; c.e = this.entreDados.e;
      c.vnPre = vn;
      c.lambda = this._corregir(A, rax, ray, raz, B, rbx, rby, rbz, Nx, Ny, Nz, pen);
      this._friccionEstatica(c);
      A.apoyado = true; B.apoyado = true;
      if (-vn > A.golpe) { A.golpe = -vn; A.golpeDado = true; }
      this._relativa(A, B, R); // la corrección movió a los dos
    }
  }

  _relativa(A, B, R) {
    // matrices de rotación de A y B (por filas)
    const m = this._mats || (this._mats = new Float64Array(18));
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

  _w(d, rx, ry, rz, nx, ny, nz) {
    if (!d || d.dormido) return 0;
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    return this.invM + this.invI * (cx * cx + cy * cy + cz * cz);
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

  _mover(d, rx, ry, rz, px, py, pz, s) {
    const m = this.invM * s, iI = this.invI * s;
    d.x += px * m; d.y += py * m; d.z += pz * m;
    const ax = iI * (ry * pz - rz * py), ay = iI * (rz * px - rx * pz), az = iI * (rx * py - ry * px);
    const qx = d.qx, qy = d.qy, qz = d.qz, qw = d.qw;
    d.qx += 0.5 * (ax * qw + ay * qz - az * qy);
    d.qy += 0.5 * (ay * qw + az * qx - ax * qz);
    d.qz += 0.5 * (az * qw + ax * qy - ay * qx);
    d.qw += 0.5 * (-ax * qx - ay * qy - az * qz);
    normalizarQ(d);
  }

  _friccionEstatica(c) {
    const A = c.a, B = c.b;
    // desplazamiento del punto de contacto en A durante el substep
    rotar(A, c.ax, c.ay, c.az, 0);
    rotarPrev(A, c.ax, c.ay, c.az, 3);
    const rax = tmp[0], ray = tmp[1], raz = tmp[2];
    let dx = (A.x + tmp[0]) - (A.px + tmp[3]);
    let dy = (A.y + tmp[1]) - (A.py + tmp[4]);
    let dz = (A.z + tmp[2]) - (A.pz + tmp[5]);
    let rbx = 0, rby = 0, rbz = 0;
    if (B) {
      rotar(B, c.bx, c.by, c.bz, 6);
      rbx = tmp[6]; rby = tmp[7]; rbz = tmp[8];
      if (!B.dormido) {
        rotarPrev(B, c.bx, c.by, c.bz, 9);
        dx -= (B.x + rbx) - (B.px + tmp[9]);
        dy -= (B.y + rby) - (B.py + tmp[10]);
        dz -= (B.z + rbz) - (B.pz + tmp[11]);
      }
    }
    const dn = dx * c.nx + dy * c.ny + dz * c.nz;
    dx -= dn * c.nx; dy -= dn * c.ny; dz -= dn * c.nz;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return;
    const tx = -dx / L, ty = -dy / L, tz = -dz / L;
    const w = this._w(A, rax, ray, raz, tx, ty, tz) + this._w(B, rbx, rby, rbz, tx, ty, tz);
    if (w <= 0) return;
    const dl = L / w;
    if (dl < c.muS * c.lambda) this._corregir(A, rax, ray, raz, B, rbx, rby, rbz, tx, ty, tz, L);
  }

  _velocidadContacto(c, h) {
    const A = c.a, B = c.b;
    if (c.lambda <= 0) return;
    rotar(A, c.ax, c.ay, c.az, 0);
    const rax = tmp[0], ray = tmp[1], raz = tmp[2];
    let vx = A.vx + A.wy * raz - A.wz * ray;
    let vy = A.vy + A.wz * rax - A.wx * raz;
    let vz = A.vz + A.wx * ray - A.wy * rax;
    let rbx = 0, rby = 0, rbz = 0;
    const bDin = B && !B.dormido;
    if (B) {
      rotar(B, c.bx, c.by, c.bz, 3);
      rbx = tmp[3]; rby = tmp[4]; rbz = tmp[5];
      if (bDin) {
        vx -= B.vx + B.wy * rbz - B.wz * rby;
        vy -= B.vy + B.wz * rbx - B.wx * rbz;
        vz -= B.vz + B.wx * rby - B.wy * rbx;
      }
    }
    const vn = vx * c.nx + vy * c.ny + vz * c.nz;
    let tx = vx - vn * c.nx, ty = vy - vn * c.ny, tz = vz - vn * c.nz;
    const vt = Math.hypot(tx, ty, tz);
    let Dx = 0, Dy = 0, Dz = 0;
    if (vt > 1e-9) {
      const f = Math.min(c.muD * c.lambda / h, vt) / vt;
      Dx -= tx * f; Dy -= ty * f; Dz -= tz * f;
    }
    // rebote: sin rebote en contactos lentos (evita temblores en reposo)
    const e = Math.abs(c.vnPre) <= 2 * this.g * h * 3 ? 0 : c.e;
    const objetivo = Math.max(-e * c.vnPre, 0);
    const dvn = -vn + objetivo;
    Dx += c.nx * dvn; Dy += c.ny * dvn; Dz += c.nz * dvn;
    const D = Math.hypot(Dx, Dy, Dz);
    if (D < 1e-9) return;
    const ux = Dx / D, uy = Dy / D, uz = Dz / D;
    const w = this._w(A, rax, ray, raz, ux, uy, uz) + (bDin ? this._w(B, rbx, rby, rbz, ux, uy, uz) : 0);
    if (w <= 0) return;
    const p = D / w;
    const Jx = ux * p, Jy = uy * p, Jz = uz * p;
    this._impulsoVel(A, rax, ray, raz, Jx, Jy, Jz, 1);
    if (bDin) this._impulsoVel(B, rbx, rby, rbz, Jx, Jy, Jz, -1);
  }

  _impulsoVel(d, rx, ry, rz, Jx, Jy, Jz, s) {
    if (d.dormido) return;
    const m = this.invM * s, iI = this.invI * s;
    d.vx += Jx * m; d.vy += Jy * m; d.vz += Jz * m;
    d.wx += iI * (ry * Jz - rz * Jy);
    d.wy += iI * (rz * Jx - rx * Jz);
    d.wz += iI * (rx * Jy - ry * Jx);
  }

  // El dedo: un rayo desde la cámara que se mueve durante el frame. Donde
  // toca un dado, la fricción de la yema arrastra ese punto hacia la
  // velocidad del dedo (con un tope de fuerza: si el dedo va muy rápido
  // patina). Así un trazo lento lo hace rodar y uno rápido lo hace girar.
  _dedos(h, frac, dtFrame) {
    for (const f of this.dedos) {
      const dx = f.d0[0] + (f.d1[0] - f.d0[0]) * frac;
      const dy = f.d0[1] + (f.d1[1] - f.d0[1]) * frac;
      const dz = f.d0[2] + (f.d1[2] - f.d0[2]) * frac;
      const l = Math.hypot(dx, dy, dz);
      const hit = this.rayo(f.o[0], f.o[1], f.o[2], dx / l, dy / l, dz / l, f.margen ?? 0.1);
      if (!hit) continue;
      const d = hit.dado;
      // velocidad del dedo en el plano horizontal a la altura del toque
      const t0 = (hit.y - f.o[1]) / f.d0[1], t1 = (hit.y - f.o[1]) / f.d1[1];
      const fvx = ((f.o[0] + f.d1[0] * t1) - (f.o[0] + f.d0[0] * t0)) / dtFrame;
      const fvz = ((f.o[2] + f.d1[2] * t1) - (f.o[2] + f.d0[2] * t0)) / dtFrame;
      // punto tocado, llevado a la superficie del dado
      rotarInv(d, hit.x - d.x, hit.y - d.y, hit.z - d.z, 0);
      const lim = MITAD;
      rotar(d, Math.max(-lim, Math.min(lim, tmp[0])), Math.max(-lim, Math.min(lim, tmp[1])), Math.max(-lim, Math.min(lim, tmp[2])), 3);
      const rx = tmp[3], ry = tmp[4], rz = tmp[5];
      if (d.dormido) {
        if (Math.hypot(fvx, fvz) < 0.5) continue; // apoyar el dedo quieto no lo despierta
        this.despertar(d);
      }
      const vcx = d.vx + d.wy * rz - d.wz * ry;
      const vcz = d.vz + d.wx * ry - d.wy * rx;
      let Dx = fvx - vcx, Dz = fvz - vcz;
      const D = Math.hypot(Dx, Dz);
      if (D < 1e-6) continue;
      const ux = Dx / D, uz = Dz / D;
      const w = this._w(d, rx, ry, rz, ux, 0, uz);
      let J = (D / w) * (f.agarre ?? 0.9);
      const Jmax = (f.fuerza ?? 1400) * h;
      if (J > Jmax) J = Jmax;
      // La yema también aprieta el dado contra la mesa: pasa casi todo el
      // giro pero poco desplazamiento, así gira en su lugar en vez de salir
      // disparado. Un trazo rápido además lo levanta un poco: gira en el aire.
      const lin = f.lineal ?? 0.25;
      d.vx += ux * J * lin * this.invM;
      d.vz += uz * J * lin * this.invM;
      const Jx = ux * J, Jz = uz * J;
      d.wx += this.invI * (ry * Jz);
      d.wy += this.invI * (rz * Jx - rx * Jz);
      d.wz += this.invI * (-ry * Jx);
      const vf = Math.hypot(fvx, fvz);
      if (vf > 6) d.vy += J * (f.elevar ?? 1.1) * Math.min(1, (vf - 6) / 25) * this.invM;
      d.tocado = 0.15;
    }
  }

  // Dormir los dados quietos y, ya dormidos, deslizarlos hasta su celda
  // y alinearlos con la grilla (el "imán" que deja todo prolijo).
  _dormir(dt) {
    for (const d of this.dados) {
      if (d.tocado > 0) d.tocado -= dt;
      if (d.dormido) { this._alinear(d, dt); continue; }
      const v2 = d.vx * d.vx + d.vy * d.vy + d.vz * d.vz;
      const w2 = d.wx * d.wx + d.wy * d.wy + d.wz * d.wz;
      if (d.apoyado && v2 < 0.09 && w2 < 0.16 && !(d.tocado > 0)) d.quieto += dt;
      else d.quieto = 0;
      if (d.quieto > 0.12) {
        if (this.planitud(d) < 0.985 || d.y > MITAD + 0.05) {
          // quedó apoyado de canto o encima de otro: un empujoncito
          d.quieto = 0;
          const ex = d.cx - d.x, ez = d.cz - d.z;
          d.vx += ex * 2 + (Math.random() - 0.5); d.vz += ez * 2 + (Math.random() - 0.5);
          d.vy += 6;
          continue;
        }
        const ex = d.cx - d.x, ez = d.cz - d.z;
        if (ex * ex + ez * ez > 0.42 * 0.42) {
          // lejos de su celda: vuelve de un salto
          d.quieto = 0;
          this.saltarA(d, d.cx, d.cz, 0.32, 6);
          continue;
        }
        d.dormido = true;
        d.vx = d.vy = d.vz = 0; d.wx = d.wy = d.wz = 0;
      }
    }
  }

  _alinear(d, dt) {
    const k = 1 - Math.exp(-dt / this.alineacion);
    // posición: hacia el centro de la celda, apoyado en el piso
    d.x += (d.cx - d.x) * k;
    d.z += (d.cz - d.z) * k;
    d.y += (MITAD - d.y) * k;
    // orientación: la cara de arriba exactamente vertical y giro múltiplo de 90°
    let mejor = -2, ux = 0, uy = 1, uz = 0;
    for (const c of CARAS) {
      rotar(d, c.eje[0], c.eje[1], c.eje[2], 0);
      if (tmp[1] > mejor) { mejor = tmp[1]; ux = tmp[0]; uy = tmp[1]; uz = tmp[2]; }
    }
    // inclinación: rotación de u a (0,1,0)
    let rx = -uz, rz = ux; // u × y = (uy·0 − uz·1, uz·0 − ux·0, ux·1 − uy·0) = (−uz, 0, ux)
    const sn = Math.hypot(rx, rz);
    let qx = 0, qy = 0, qz = 0, qw = 1;
    if (sn > 1e-9) {
      const ang = Math.atan2(sn, uy) * k;
      const s = Math.sin(ang / 2) / sn;
      qx = rx * s; qz = rz * s; qw = Math.cos(ang / 2);
    }
    // giro alrededor de la vertical: llevar el eje horizontal más cercano a x
    let psi = 0;
    for (const c of CARAS) {
      rotar(d, c.eje[0], c.eje[1], c.eje[2], 0);
      if (Math.abs(tmp[1]) < 0.5) { psi = Math.atan2(tmp[2], tmp[0]); break; }
    }
    const q90 = Math.PI / 2;
    const resto = psi - Math.round(psi / q90) * q90; // en (−45°, 45°]
    const giro = resto * k; // rotar +θ en y baja el ángulo atan2(z, x) en θ
    const sy = Math.sin(giro / 2), cy = Math.cos(giro / 2);
    // q_total = q_giro ⊗ q_incl
    const tx = cy * qx + sy * qz;
    const ty = cy * qy + sy * qw;
    const tz = cy * qz - sy * qx;
    const tw = cy * qw - sy * qy;
    // d.q = q_total ⊗ d.q
    const ax = d.qx, ay = d.qy, az = d.qz, aw = d.qw;
    d.qx = tw * ax + tx * aw + ty * az - tz * ay;
    d.qy = tw * ay + ty * aw + tz * ax - tx * az;
    d.qz = tw * az + tz * aw + tx * ay - ty * ax;
    d.qw = tw * aw - tx * ax - ty * ay - tz * az;
    normalizarQ(d);
    d.px = d.x; d.py = d.y; d.pz = d.z;
    d.pqx = d.qx; d.pqy = d.qy; d.pqz = d.qz; d.pqw = d.qw;
  }

  // Reparte las celdas libres entre los dados: cada dado va a la celda
  // libre más cercana (codicioso por distancia, alcanza para que se vea
  // natural). Devuelve los dados ordenados por distancia a su celda nueva.
  reasignarCeldas(celdas) {
    const L = this.dados;
    const pares = [];
    for (let i = 0; i < L.length; i++) for (let j = 0; j < celdas.length; j++) {
      const dx = L[i].x - celdas[j][0], dz = L[i].z - celdas[j][1];
      pares.push([dx * dx + dz * dz, i, j]);
    }
    pares.sort((p, q) => p[0] - q[0]);
    const usadoD = new Uint8Array(L.length), usadaC = new Uint8Array(celdas.length);
    for (const [, i, j] of pares) {
      if (usadoD[i] || usadaC[j]) continue;
      usadoD[i] = 1; usadaC[j] = 1;
      L[i].cx = celdas[j][0]; L[i].cz = celdas[j][1];
    }
  }
}
