// Tests de la física de las herramientas. Correr con:
//   node --test web/herramientas/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mundo, muestras, listaMuestras, inercia, combinar, sdfCaja, SEPARACION_RELATIVA, SEPARACION_MAXIMA } from '../src/fisica.js';

// ── utilidades ──
const RAD = Math.PI / 180;
function qEje(ax, ay, az, ang) {
  const s = Math.sin(ang / 2), l = Math.hypot(ax, ay, az);
  return [ax / l * s, ay / l * s, az / l * s, Math.cos(ang / 2)];
}
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function rot(q, v) {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
const qDe = (c) => [c.qx, c.qy, c.qz, c.qw];
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
const pose = (q) => ({ qx: q[0], qy: q[1], qz: q[2], qw: q[3] });
// componente y del eje local y (1 = apoyado "derecho")
const arribaY = (c) => rot(qDe(c), [0, 1, 0])[1];

function semilla(s) {
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function correr(m, seg, dt = 1 / 60, cada) {
  const n = Math.round(seg / dt);
  for (let i = 0; i < n; i++) { if (cada) cada(i * dt); m.paso(dt); }
}

function sano(m) {
  for (const c of m.cuerpos) {
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz']) {
      assert.ok(Number.isFinite(c[k]), `cuerpo ${c.id}: ${k} = ${c[k]}`);
    }
  }
}

// Distancia de un punto (coords locales) al núcleo, con signo (negativa adentro).
function dNucleo(p, h) {
  const q = [Math.abs(p[0]) - h[0], Math.abs(p[1]) - h[1], Math.abs(p[2]) - h[2]];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(...q), 0);
}

// Puntos densos sobre toda la superficie del núcleo (caras cada 0,2 cm y
// aristas cada 0,02 cm), independientes de las muestras que usa la física.
const cacheDensos = new Map();
function densos(h) {
  const k = h.join(',');
  if (cacheDensos.has(k)) return cacheDensos.get(k);
  const P = [];
  const rango = (a, s) => {
    if (a <= 0) return [0];
    const n = Math.max(1, Math.ceil(2 * a / s));
    return Array.from({ length: n + 1 }, (_, i) => -a + 2 * a * i / n);
  };
  for (let ej = 0; ej < 3; ej++) {
    const o1 = (ej + 1) % 3, o2 = (ej + 2) % 3;
    for (const s of h[ej] > 0 ? [-1, 1] : [1]) {
      for (const a of rango(h[o1], 0.2)) for (const b of rango(h[o2], 0.2)) {
        const p = [0, 0, 0]; p[ej] = s * h[ej]; p[o1] = a; p[o2] = b; P.push(p);
      }
      for (const a of rango(h[o1], 0.02)) for (const b of (h[o2] > 0 ? [-h[o2], h[o2]] : [0])) {
        const p = [0, 0, 0]; p[ej] = s * h[ej]; p[o1] = a; p[o2] = b; P.push(p);
      }
    }
  }
  cacheDensos.set(k, P);
  return P;
}

// Penetración entre dos cuerpos: cuánto se meten las cajas redondeadas
// una en otra (negativo: separadas). Muestreo denso, no el de la física.
function penetracion(A, B) {
  let peor = -Infinity;
  for (const [X, Y] of [[A, B], [B, A]]) {
    const lim = X.radio + Y.radio;
    const dx = X.x - Y.x, dy = X.y - Y.y, dz = X.z - Y.z;
    if (Math.hypot(dx, dy, dz) > X.ext + Y.ext + 0.1) return -1;
    const qX = qDe(X), qYi = qInv(qDe(Y));
    for (const p of densos(X.medias)) {
      const w = rot(qX, p);
      const l = rot(qYi, [w[0] + dx, w[1] + dy, w[2] + dz]);
      const pen = lim - dNucleo(l, Y.medias);
      if (pen > peor) peor = pen;
    }
  }
  return peor;
}

function penetracionMaxima(m) {
  let peor = -Infinity, par = null;
  const L = m.cuerpos;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const p = penetracion(L[i], L[j]);
    if (p > peor) { peor = p; par = `${L[i].nombre ?? L[i].id} / ${L[j].nombre ?? L[j].id}`; }
  }
  return { peor, par };
}

// ── formas ──
const LAPIZ = { medias: [8.75, 0, 0], radio: 0.375, masa: 6, material: 'madera' };
const HEXAGONAL = { medias: [8, 0.1, 0.1], radio: 0.25, masa: 5, material: 'madera' };
const REGLA = { medias: [15, 0, 1.25], radio: 0.17, masa: 20, material: 'madera' };
const REGLA_METAL = { medias: [10.4, 0, 1.2], radio: 0.1, masa: 25, material: 'metal' };
const GOMA = { medias: [1.5, 0.4, 0.9], radio: 0.15, masa: 10, material: 'goma' };
const SACAPUNTAS = { medias: [1.5, 0.4, 0.9], radio: 0.15, masa: 10, material: 'metal' };

function mundoAbierto() {
  const m = new Mundo();
  m.ponerCaja(80, 80, 30);
  return m;
}

// ── geometría ──
test('muestras: esquinas sin repetir y aristas con separación <= min(0,6 r; 0,35 cm)', () => {
  const casos = [
    { medias: [0, 0, 0], radio: 0.5, esquinas: 1, aristas: 0 },     // esfera
    { medias: [8.75, 0, 0], radio: 0.375, esquinas: 2, aristas: 1 }, // lápiz redondo (cápsula)
    { medias: [15, 0, 1.25], radio: 0.17, esquinas: 4, aristas: 4 }, // regla (placa)
    { medias: [2.4, 0.5, 0.9], radio: 0.1, esquinas: 8, aristas: 12 }, // goma (caja)
    { medias: [8, 0.1, 0.1], radio: 0.25, esquinas: 8, aristas: 12 }, // hexagonal: las aristas cortas (0,2) llevan un punto
    { medias: [8, 0.05, 0.05], radio: 0.3, esquinas: 8, aristas: 4 }, // aristas más cortas que la separación: solo esquinas
    { medias: [4, 0, 0], radio: 1.2, esquinas: 2, aristas: 1 },      // radio grande: manda el tope de 0,35 cm
  ];
  for (const k of casos) {
    const { esquinas, aristas } = muestras(k.medias, k.radio);
    assert.equal(esquinas.length / 3, k.esquinas, `esquinas de ${k.medias}`);
    assert.equal(aristas.length / 6, k.aristas, `aristas de ${k.medias}`);
    const sep = Math.min(SEPARACION_RELATIVA * k.radio, SEPARACION_MAXIMA);
    for (let a = 0; a < aristas.length; a += 6) assert.ok(aristas[a + 5] <= sep + 1e-12, `paso ${aristas[a + 5]} > ${sep}`);
    const P = listaMuestras(k.medias, k.radio);
    const vistos = new Set();
    for (let i = 0; i < P.length; i += 3) {
      const clave = `${P[i].toFixed(6)},${P[i + 1].toFixed(6)},${P[i + 2].toFixed(6)}`;
      assert.ok(!vistos.has(clave), `muestra repetida ${clave} en ${k.medias}`);
      vistos.add(clave);
      // todas sobre las aristas del núcleo: al menos dos coordenadas en ±h
      let enBorde = 0;
      for (let j = 0; j < 3; j++) if (Math.abs(Math.abs(P[i + j]) - k.medias[j]) < 1e-9) enBorde++;
      assert.ok(enBorde >= 2, `muestra fuera de las aristas: ${clave}`);
    }
    // cada arista del núcleo queda cubierta: entre muestras vecinas nunca más que sep
    for (let a = 0; a < aristas.length; a += 6) {
      const n = aristas[a + 4], largo = n * aristas[a + 5];
      assert.ok(Math.abs(largo - 2 * k.medias[aristas[a + 3]]) < 1e-9);
    }
  }
});

test('inercia de caja maciza con las medidas exteriores', () => {
  const [Ix, Iy, Iz] = inercia([1, 0.5, 0], 0.25, 12);
  // exterior 2,5 × 1,5 × 0,5
  assert.ok(Math.abs(Ix - 12 * (1.5 ** 2 + 0.5 ** 2) / 12) < 1e-9);
  assert.ok(Math.abs(Iy - 12 * (2.5 ** 2 + 0.5 ** 2) / 12) < 1e-9);
  assert.ok(Math.abs(Iz - 12 * (2.5 ** 2 + 1.5 ** 2) / 12) < 1e-9);
  const m = new Mundo();
  const c = m.agregar({ ...REGLA, y: 3 });
  assert.ok(Math.abs(c.invM - 1 / 20) < 1e-12);
  assert.ok(Math.abs(c.Iy - 20 * (30.34 ** 2 + 2.84 ** 2) / 12) < 1e-9);
});

test('sdfCaja: distancia a la caja redondeada', () => {
  assert.ok(Math.abs(sdfCaja(0, 1, 0, [8, 0, 0], 0.4) - 0.6) < 1e-12);
  assert.ok(Math.abs(sdfCaja(9, 0, 0, [8, 0, 0], 0.4) - 0.6) < 1e-12);
  assert.ok(Math.abs(sdfCaja(0, 0, 0, [1, 0.5, 0.5], 0.1) + 0.6) < 1e-12);
});

test('materiales: la goma frena y casi no rebota, el metal desliza y rebota algo', () => {
  const goma = combinar('goma', 'papel'), metal = combinar('metal', 'papel'), madera = combinar('madera', 'papel');
  assert.ok(goma.muD > madera.muD && madera.muD > metal.muD);
  assert.ok(goma.e < 0.15 && metal.e > madera.e);
  assert.deepEqual(combinar('madera', 'metal'), combinar('metal', 'madera'));
  for (const a of ['madera', 'metal', 'goma', 'plastico']) for (const b of ['madera', 'metal', 'goma', 'plastico', 'papel', 'vidrio']) {
    const k = combinar(a, b);
    assert.ok(k.muS >= k.muD && k.muD > 0 && k.e >= 0 && k.e < 1 && k.rodadura > 0, `${a}|${b}`);
  }
});

// ── caídas ──
for (const [nombre, forma, alto] of [['redondo', LAPIZ, 0.375], ['hexagonal', HEXAGONAL, 0.35]]) {
  test(`un lápiz ${nombre} que cae desde 3 cm con giro queda apoyado, quieto y dormido`, () => {
    const az = semilla(nombre.length);
    for (let i = 0; i < 4; i++) {
      const m = mundoAbierto();
      const q = qEje(az() - 0.5, az() - 0.5, az() - 0.5, az() * Math.PI);
      const c = m.agregar({ ...forma, x: 0, y: 3, z: 0, ...pose(q) });
      c.wx = (az() - 0.5) * 20; c.wy = (az() - 0.5) * 10; c.wz = (az() - 0.5) * 20;
      correr(m, 4);
      sano(m);
      assert.ok(c.dormido, `tiro ${i}: no se durmió`);
      assert.ok(Math.abs(c.y - alto) < 0.02, `tiro ${i}: centro a ${c.y.toFixed(4)} (esperado ${alto})`);
      assert.equal(c.vx + c.vy + c.vz + c.wx + c.wy + c.wz, 0);
      // el eje largo queda horizontal
      assert.ok(Math.abs(rot(qDe(c), [1, 0, 0])[1]) < 0.01, `tiro ${i}: eje largo inclinado`);
    }
  });
}

test('una regla (placa) cae plana y queda plana', () => {
  const az = semilla(5);
  for (let i = 0; i < 3; i++) {
    const m = mundoAbierto();
    // casi plana, con un giro cualquiera alrededor de la vertical
    const q = qMul(qEje(0, 1, 0, az() * 6.28), qEje(az() - 0.5, 0, az() - 0.5, 0.05));
    const c = m.agregar({ ...REGLA, x: 0, y: 3, z: 0, ...pose(q) });
    correr(m, 3);
    sano(m);
    assert.ok(c.dormido, `tiro ${i}: no se durmió`);
    assert.ok(arribaY(c) > 0.9999, `tiro ${i}: quedó inclinada (${arribaY(c)})`);
    assert.ok(Math.abs(c.y - 0.17) < 0.02, `tiro ${i}: centro a ${c.y.toFixed(4)}`);
  }
});

test('la goma casi no rebota; la misma forma en metal rebota más', () => {
  const rebote = (forma) => {
    const m = mundoAbierto();
    const c = m.agregar({ ...forma, y: 6 });
    let bajo = false, alto = 0;
    correr(m, 1.5, 1 / 600, () => {
      if (c.vy > 0 && c.y < 1) bajo = true;
      if (bajo) alto = Math.max(alto, c.y - (forma.medias[1] + forma.radio));
    });
    return alto;
  };
  const hGoma = rebote(GOMA), hMetal = rebote(SACAPUNTAS);
  assert.ok(hGoma < 0.12, `la goma rebotó ${hGoma.toFixed(3)} cm`);
  assert.ok(hMetal > 2 * hGoma && hMetal > 0.3, `el metal rebotó ${hMetal.toFixed(3)} cm (goma ${hGoma.toFixed(3)})`);
});

test('un lápiz redondo rueda y la resistencia a la rodadura lo frena', () => {
  const m = mundoAbierto();
  const c = m.agregar({ ...LAPIZ });
  c.vz = 30; // perpendicular a su eje, sin girar: primero patina
  correr(m, 0.1);
  // al pasar de patinar a rodar se conserva el momento angular respecto del
  // punto de apoyo: v = v0 · m r² / (m r² + I) = 0,6 v0 (inercia de caja)
  assert.ok(c.vz > 15 && c.vz < 18.5, `vz = ${c.vz}`);
  // y rueda sin deslizar: v = ω r (alrededor de x)
  assert.ok(Math.abs(c.wx * c.radio - c.vz) < 0.03 * c.vz, `desliza: ω r = ${c.wx * c.radio}, v = ${c.vz}`);
  correr(m, 5);
  sano(m);
  assert.ok(c.dormido, 'no frenó');
  assert.ok(c.z > 3 && c.z < 40, `recorrió ${c.z.toFixed(1)} cm`);
  assert.ok(Math.abs(c.y - 0.375) < 0.02);
});

// ── cuerpos largos contra cuerpos largos ──
// Deja `arriba` caer sobre `abajo` (apoyado) y controla en cada substep que
// no se atraviesen: mientras sus proyecciones se cruzan, el de arriba
// sigue arriba.
function caerSobre(abajo, arriba, { giro = 90, y = 3, vy = 0, x = 0, z = 0, seg = 3 } = {}) {
  const m = mundoAbierto();
  const A = m.agregar({ ...abajo });
  const B = m.agregar({ ...arriba, x, y, z, ...pose(qEje(0, 1, 0, giro * RAD)) });
  B.vy = vy;
  let peor = -Infinity, abajoDeA = false;
  correr(m, seg, 1 / 600, () => {
    if (!A.dormido || !B.dormido) peor = Math.max(peor, penetracion(A, B));
    if (Math.hypot(B.x - A.x, B.z - A.z) < 0.5 && B.y < A.y) abajoDeA = true;
  });
  sano(m);
  return { m, A, B, peor, abajoDeA };
}

test('un lápiz que cae sobre una regla apoyada no la atraviesa', () => {
  for (const [giro, vy] of [[90, 0], [0, 0], [60, -250], [0, -250]]) {
    const { A, B, peor, abajoDeA } = caerSobre(REGLA, LAPIZ, { giro, vy, y: 4 });
    assert.ok(!abajoDeA, `giro ${giro}, vy ${vy}: el lápiz pasó por debajo de la regla`);
    assert.ok(peor < 0.03, `giro ${giro}, vy ${vy}: penetración ${peor.toFixed(4)}`);
    if (vy === 0) assert.ok(B.y > A.y + 0.4, `giro ${giro}: el lápiz no quedó encima (${B.y.toFixed(3)})`);
    assert.ok(A.dormido && B.dormido);
  }
});

test('cuerpos largos cruzados no se atraviesan: dos reglas en X, lápiz sobre lápiz en cruz', () => {
  const casos = [
    ['regla sobre regla en X', REGLA, REGLA, { giro: 90 }],
    ['regla sobre regla a 35°', REGLA, REGLA, { giro: 35 }],
    ['regla sobre regla en X, rápida', REGLA, REGLA, { giro: 90, vy: -250 }],
    ['reglas de metal en X, rápida', REGLA_METAL, REGLA_METAL, { giro: 90, vy: -250 }],
    ['lápiz sobre lápiz en cruz', LAPIZ, LAPIZ, { giro: 90 }],
    ['lápiz sobre lápiz en cruz, rápido', LAPIZ, LAPIZ, { giro: 80, vy: -250 }],
    ['hexagonal sobre hexagonal en cruz', HEXAGONAL, HEXAGONAL, { giro: 90 }],
  ];
  for (const [nombre, abajo, arriba, op] of casos) {
    const { A, B, peor, abajoDeA } = caerSobre(abajo, arriba, op);
    assert.ok(!abajoDeA, `${nombre}: el de arriba pasó por debajo`);
    assert.ok(peor < 0.03, `${nombre}: penetración ${peor.toFixed(4)}`);
    if (!op.vy) assert.ok(B.y > A.y + abajo.radio + arriba.radio - 0.05, `${nombre}: no quedó encima (${A.y.toFixed(3)} / ${B.y.toFixed(3)})`);
    assert.ok(A.dormido && B.dormido, `${nombre}: no se durmieron`);
  }
});

// Sin grilla en las caras: lo sostienen las aristas del otro cuerpo.
test('caras grandes sin muestras interiores: regla sobre goma, goma sobre regla, reglas alineadas', () => {
  // la cara de abajo de la regla cubre por completo la cara de arriba de la goma
  let r = caerSobre(GOMA, REGLA, { giro: 0 });
  assert.ok(!r.abajoDeA && r.peor < 0.03, `regla sobre goma: ${r.peor}`);
  assert.ok(r.B.y > 2 * (0.4 + 0.15) + 0.17 - 0.3, `regla sobre goma: quedó a ${r.B.y}`);
  // la goma apoyada en el medio de la cara de la regla (ninguna arista de la regla debajo)
  r = caerSobre(REGLA, GOMA, { giro: 30 });
  assert.ok(!r.abajoDeA && r.peor < 0.03, `goma sobre regla: ${r.peor}`);
  assert.ok(Math.abs(r.B.y - (0.34 + 0.55)) < 0.03, `goma sobre regla: quedó a ${r.B.y}`);
  // dos reglas iguales, una exactamente encima de la otra: cara contra cara
  r = caerSobre(REGLA, REGLA, { giro: 0 });
  assert.ok(r.peor < 0.03, `reglas alineadas: ${r.peor}`);
  assert.ok(Math.abs(r.B.y - 0.51) < 0.03 && arribaY(r.B) > 0.999, `reglas alineadas: quedó a ${r.B.y}`);
});

// ── la caja sacudida ──
const HERRAMIENTAS = [
  { nombre: 'lápiz rojo', medias: [8.75, 0, 0], radio: 0.375, masa: 6, material: 'madera', x: -6, y: 1, z: -16, giro: 90 },
  { nombre: 'lápiz verde', medias: [8.75, 0, 0], radio: 0.375, masa: 6, material: 'madera', x: -3, y: 1.5, z: -15, giro: 90 },
  { nombre: 'lápiz hexagonal', medias: [8, 0.1, 0.1], radio: 0.25, masa: 5, material: 'madera', x: 0, y: 1, z: -16, giro: 90 },
  { nombre: 'lápiz corto', medias: [4.5, 0, 0], radio: 0.37, masa: 3, material: 'madera', x: 3, y: 1, z: -20, giro: 90 },
  { nombre: 'lápiz de color', medias: [8.75, 0.08, 0.08], radio: 0.28, masa: 5, material: 'madera', x: 6, y: 1, z: -16, giro: 90 },
  { nombre: 'portaminas', medias: [7, 0, 0], radio: 0.45, masa: 11, material: 'plastico', x: 9, y: 1, z: -16, giro: 90 },
  { nombre: 'regla de 31 cm', medias: [15.33, 0, 1.4], radio: 0.17, masa: 20, material: 'madera', x: -9, y: 1, z: 5, giro: 90 },
  { nombre: 'regla de 21 cm', medias: [10.4, 0, 1.2], radio: 0.1, masa: 25, material: 'metal', x: 0, y: 3, z: 8, giro: 90 },
  { nombre: 'goma', medias: [2.4, 0.5, 0.9], radio: 0.12, masa: 20, material: 'goma', x: 6, y: 1, z: 2, giro: 0 },
  { nombre: 'goma chica', medias: [1.5, 0.4, 0.9], radio: 0.15, masa: 10, material: 'goma', x: 6, y: 1, z: 8, giro: 0 },
  { nombre: 'sacapuntas', medias: [1.0, 0.55, 0.75], radio: 0.15, masa: 9, material: 'metal', x: 6, y: 1, z: 14, giro: 0 },
  { nombre: 'pincel', medias: [9.5, 0, 0], radio: 0.3, masa: 5, material: 'madera', x: 3, y: 2, z: 8, giro: 90 },
  { nombre: 'marcador', medias: [6.5, 0, 0], radio: 0.55, masa: 10, material: 'plastico', x: 0, y: 1, z: -5, giro: 0 },
];
const CAJA = { ancho: 24, largo: 52, alto: 9 };

function llenarCaja() {
  const m = new Mundo();
  m.ponerCaja(CAJA.ancho, CAJA.largo, CAJA.alto);
  for (const h of HERRAMIENTAS) {
    const c = m.agregar({ ...h, ...pose(qEje(0, 1, 0, h.giro * RAD)) });
    c.nombre = h.nombre;
  }
  return m;
}

// Aceleración de la caja: vaivenes de 4 a 6 Hz en varias direcciones, de
// hasta 2500 cm/s², con subida y bajada suaves en los extremos.
function sacudida(t, T = 2) {
  const env = Math.min(1, t / 0.15) * Math.min(1, (T - t) / 0.15);
  const ax = 2500 * Math.sin(2 * Math.PI * 5 * t + 0.3) * Math.cos(1.7 * t);
  const az = 2500 * Math.sin(2 * Math.PI * 4.2 * t) * Math.sin(1.7 * t + 0.5);
  const ay = 900 * Math.sin(2 * Math.PI * 5.8 * t);
  const l = Math.hypot(ax, ay, az), k = l > 2500 ? 2500 / l : 1;
  return [ax * k * env, ay * k * env, az * k * env];
}

// ¿Está todo el cuerpo (su caja redondeada) adentro de la caja? Con
// tolerancia `tol` en las paredes y el techo y `tolPiso` en el piso (que no
// se ve desde arriba: en la sacudida un cuerpo apretado por otros se hunde
// apenas un instante).
function adentro(c, tol, tolPiso = tol) {
  const q = qDe(c);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = rot(q, [sx * c.medias[0], sy * c.medias[1], sz * c.medias[2]]);
    const x = c.x + p[0], y = c.y + p[1], z = c.z + p[2];
    if (Math.abs(x) > CAJA.ancho / 2 - c.radio + tol) return false;
    if (Math.abs(z) > CAJA.largo / 2 - c.radio + tol) return false;
    if (y < c.radio - tolPiso || y > CAJA.alto - c.radio + tol) return false;
  }
  return true;
}

test('caja sacudida: 13 herramientas, sin escaparse ni atravesarse, y después se duermen', () => {
  const m = llenarCaja();
  assert.ok(penetracionMaxima(m).peor < 0, 'la disposición inicial ya se tocaba');
  const dt = 1 / 60;
  let peorAfuera = null, peorDurante = -Infinity;
  correr(m, 2, dt, (t) => {
    const a = sacudida(t);
    m.aExt[0] = a[0]; m.aExt[1] = a[1]; m.aExt[2] = a[2];
    for (const c of m.cuerpos) if (!peorAfuera && !adentro(c, 0.03, 0.15)) peorAfuera = `${c.nombre} en t = ${t.toFixed(2)}`;
    if (Math.round(t * 60) % 6 === 0) peorDurante = Math.max(peorDurante, penetracionMaxima(m).peor);
  });
  sano(m);
  m.aExt[0] = m.aExt[1] = m.aExt[2] = 0;
  assert.equal(peorAfuera, null, `se escapó de la caja: ${peorAfuera}`);
  const alFinal = penetracionMaxima(m);
  assert.ok(alFinal.peor < 0.08, `penetración al final de la sacudida: ${alFinal.peor.toFixed(4)} (${alFinal.par})`);
  // se movieron de verdad
  const corridos = m.cuerpos.filter((c, i) => Math.hypot(c.x - HERRAMIENTAS[i].x, c.z - HERRAMIENTAS[i].z) > 2).length;
  assert.ok(corridos >= 8, `solo ${corridos} herramientas se corrieron más de 2 cm`);
  // calma: en 4 s todo quieto y dormido
  correr(m, 4, dt);
  sano(m);
  const despiertos = m.cuerpos.filter((c) => !c.dormido).map((c) => c.nombre);
  assert.deepEqual(despiertos, [], `siguen despiertos: ${despiertos}`);
  for (const c of m.cuerpos) assert.ok(adentro(c, 0.02), `${c.nombre} quedó afuera`);
  const reposo = penetracionMaxima(m);
  assert.ok(reposo.peor < 0.08, `penetración en reposo: ${reposo.peor.toFixed(4)} (${reposo.par})`);
  console.log(`  penetración máx.: durante ${peorDurante.toFixed(4)} cm, al final de la sacudida ${alFinal.peor.toFixed(4)} cm, en reposo ${reposo.peor.toFixed(4)} cm`);
});

test('rendimiento: ms por paso de 1/60 s en la caja sacudida (13 cuerpos)', () => {
  const dt = 1 / 60;
  const tiempos = [];
  for (let rep = 0; rep < 4; rep++) {
    const m = llenarCaja();
    let total = 0, peor = 0, substeps = 0;
    for (let i = 0; i < 120; i++) {
      const a = sacudida(i * dt);
      m.aExt[0] = a[0]; m.aExt[1] = a[1]; m.aExt[2] = a[2];
      const t0 = performance.now();
      m.paso(dt);
      const ms = performance.now() - t0;
      total += ms; peor = Math.max(peor, ms); substeps += m.substeps;
    }
    // la primera corrida calienta el JIT y se descarta
    if (rep > 0) tiempos.push({ medio: total / 120, peor, substeps: substeps / 120 });
  }
  const medio = tiempos.reduce((s, t) => s + t.medio, 0) / tiempos.length;
  const peor = Math.max(...tiempos.map((t) => t.peor));
  console.log(`  caja sacudida: ${medio.toFixed(2)} ms por paso de 1/60 s (peor ${peor.toFixed(2)} ms), ${tiempos[0].substeps.toFixed(1)} substeps por paso`);
  assert.ok(medio <= 4, `${medio.toFixed(2)} ms por paso`);
});

// ── sacudida, golpes, cinemático, dedo ──
test('una sacudida fuerte despierta a todos; una suave no', () => {
  const m = mundoAbierto();
  const a = m.agregar({ ...LAPIZ, z: -3 });
  const b = m.agregar({ ...GOMA, z: 3 });
  correr(m, 1);
  assert.ok(a.dormido && b.dormido);
  m.aExt[0] = 100;
  correr(m, 0.1);
  assert.ok(a.dormido && b.dormido, 'una sacudida suave los despertó');
  m.aExt[0] = 1200;
  m.paso(1 / 60);
  assert.ok(!a.dormido && !b.dormido, 'no se despertaron');
  correr(m, 0.2);
  // los cuerpos sienten −aExt: la caja acelera hacia +x, ellos se van hacia −x
  assert.ok(a.vx < -5 && b.vx < -5, `vx ${a.vx}, ${b.vx}`);
});

test('golpes: velocidad de impacto y contra qué fue', () => {
  const m = mundoAbierto();
  const r = m.agregar({ ...REGLA });
  correr(m, 1);
  const c = m.agregar({ ...SACAPUNTAS, y: 8 });
  let piso = null, cuerpo = null;
  correr(m, 1.2, 1 / 60, () => {
    if (c.golpe > 20 && c.golpeContra === 'cuerpo' && !cuerpo) cuerpo = { v: c.golpe, mat: c.golpeMaterial, otro: r.golpe };
  });
  assert.ok(cuerpo, 'no registró el golpe contra la regla');
  // cae ~7 cm: v = √(2 g h) ≈ 117 cm/s
  assert.ok(cuerpo.v > 90 && cuerpo.v < 130, `velocidad de impacto ${cuerpo.v}`);
  assert.equal(cuerpo.mat, 'madera');
  // ahora contra el piso
  const d = m.agregar({ ...GOMA, x: 0, y: 5, z: 12 });
  correr(m, 1, 1 / 60, () => {
    if (d.golpe > 20 && !piso) piso = { v: d.golpe, contra: d.golpeContra, mat: d.golpeMaterial };
  });
  assert.ok(piso && piso.contra === 'piso' && piso.mat === 'papel', JSON.stringify(piso));
  // apoyado y quieto (aunque esté despierto) no hay golpes
  correr(m, 2);
  m.despertarTodos();
  m.paso(1 / 60);
  for (const k of m.cuerpos) assert.equal(k.golpe, 0, `golpe en reposo: ${k.golpe}`);
});

test('cinemático: empuja a los demás sin que lo empujen y al soltarlo se despierta', () => {
  const m = mundoAbierto();
  const lapiz = m.agregar({ ...LAPIZ, z: 0 });
  const goma = m.agregar({ ...GOMA, x: 0, z: -6 });
  correr(m, 1);
  assert.ok(lapiz.dormido && goma.dormido);
  goma.cinematico = true;
  // la goma barre hacia +z a 20 cm/s, pegada al piso
  const y0 = goma.y, z0 = goma.z;
  for (let i = 0; i < 60; i++) {
    goma.z += 20 / 60;
    goma.vz = 20;
    m.paso(1 / 60);
    assert.ok(Math.abs(goma.y - y0) < 1e-9, 'al cinemático lo movió la física');
  }
  assert.ok(Math.abs(goma.z - (z0 + 20)) < 1e-9, `z = ${goma.z}`);
  sano(m);
  assert.ok(lapiz.z > 2, `el lápiz no fue empujado: z = ${lapiz.z}`);
  assert.ok(penetracion(lapiz, goma) < 0.03, `se atravesaron: ${penetracion(lapiz, goma)}`);
  // la física le deja la velocidad con la que se movía
  assert.ok(Math.abs(goma.vz - 20) < 1e-6 && Math.abs(goma.vx) < 1e-6, `vz = ${goma.vz}`);
  goma.cinematico = false;
  const z1 = goma.z;
  m.paso(1 / 60);
  assert.ok(!goma.dormido);
  // sigue de largo (y la fricción de la goma la frena enseguida)
  assert.ok(goma.z - z1 > 0.15, `al soltarla se frenó en seco: avanzó ${goma.z - z1}`);
  correr(m, 4);
  assert.ok(goma.dormido && lapiz.dormido);
});

test('rayo: devuelve el cuerpo tocado y el punto sobre su superficie', () => {
  const m = mundoAbierto();
  const lapiz = m.agregar({ ...LAPIZ, z: 0 });
  const regla = m.agregar({ ...REGLA, z: 5 });
  const h = m.rayo(3, 30, 0, 0, -1, 0);
  assert.equal(h.cuerpo, lapiz);
  assert.ok(Math.abs(h.y - 0.75) < 1e-3, `y = ${h.y}`);
  // un poco al costado del eje: toca la superficie redonda, más abajo
  const h2 = m.rayo(3, 30, 0.3, 0, -1, 0);
  assert.ok(Math.abs(h2.y - (0.375 + Math.sqrt(0.375 ** 2 - 0.09))) < 1e-3, `y = ${h2.y}`);
  assert.equal(m.rayo(3, 30, 0.45, 0, -1, 0), null);
  assert.equal(m.rayo(3, 30, 0.45, 0, -1, 0, 0.1).cuerpo, lapiz);
  assert.equal(m.rayo(-10, 30, 5, 0, -1, 0).cuerpo, regla);
  // en diagonal desde una cámara
  const o = [0, 40, 30];
  const d = [3 - o[0], 0.5 - o[1], 5 - o[2]];
  assert.equal(m.rayo(...o, ...d).cuerpo, regla);
});

test('el dedo hace rodar un lápiz en la dirección del trazo y arrastra una regla', () => {
  const m = mundoAbierto();
  const lapiz = m.agregar({ ...LAPIZ, z: 0 });
  const regla = m.agregar({ ...REGLA, z: 10 });
  correr(m, 1);
  const cam = [0, 40, 0];
  const dir = (x, y, z) => { const v = [x - cam[0], y - cam[1], z - cam[2]]; const l = Math.hypot(...v); return v.map((c) => c / l); };
  // trazo a lo ancho del lápiz (+z), a 30 cm/s, durante 0,1 s
  let z = -0.5;
  for (let i = 0; i < 6; i++) {
    const z1 = z + 30 / 60;
    m.dedos = [{ o: cam, d0: dir(2, 0, z), d1: dir(2, 0, z1) }];
    m.paso(1 / 60);
    z = z1;
  }
  m.dedos = [];
  // rodar hacia +z es girar alrededor de +x
  assert.ok(lapiz.wx > 5, `wx = ${lapiz.wx}`);
  assert.ok(lapiz.z > 0.1, `z = ${lapiz.z}`);
  // trazo sobre la regla, a lo largo de x
  let x = -3;
  for (let i = 0; i < 12; i++) {
    const x1 = x + 20 / 60;
    m.dedos = [{ o: cam, d0: dir(x, 0, 10), d1: dir(x1, 0, 10) }];
    m.paso(1 / 60);
    x = x1;
  }
  m.dedos = [];
  assert.ok(regla.x > 0.5, `la regla no se arrastró: x = ${regla.x}`);
  correr(m, 4);
  sano(m);
  assert.ok(lapiz.dormido && regla.dormido);
  // apoyar el dedo quieto no despierta
  m.dedos = [{ o: cam, d0: dir(regla.x, 0, 10), d1: dir(regla.x, 0, 10) }];
  m.paso(1 / 60);
  m.dedos = [];
  assert.ok(regla.dormido);
});

test('impulso y quitar: un golpecito hace saltar; quitar el de abajo despierta al de arriba', () => {
  const m = mundoAbierto();
  const regla = m.agregar({ ...REGLA });
  const goma = m.agregar({ ...GOMA, y: 2 });
  correr(m, 2);
  assert.ok(regla.dormido && goma.dormido);
  assert.ok(goma.y > 0.8);
  m.quitar(regla);
  assert.ok(!goma.dormido);
  correr(m, 2);
  assert.ok(Math.abs(goma.y - 0.55) < 0.02, `la goma no bajó al piso: ${goma.y}`);
  m.impulso(goma, goma.x, goma.y, goma.z, 0, goma.masa * 60, 0);
  let alto = 0;
  correr(m, 1, 1 / 60, () => { alto = Math.max(alto, goma.y); });
  assert.ok(alto > 2, `no saltó: ${alto}`);
  assert.ok(goma.dormido);
});
