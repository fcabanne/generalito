// Tests de la física de los dados. Correr con: node --test web/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mundo } from '../src/fisica.js';

function semilla(s) {
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grilla(m, cols, filas, paso) {
  const celdas = [];
  for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) {
    celdas.push([(c - (cols - 1) / 2) * paso, (f - (filas - 1) / 2) * paso]);
  }
  for (const [x, z] of celdas) m.agregarDado(x, z);
  const W = cols * paso / 2, D = filas * paso / 2;
  m.planos.push(
    { nx: 1, ny: 0, nz: 0, d: -W, tipo: 'pared' },
    { nx: -1, ny: 0, nz: 0, d: -W, tipo: 'pared' },
    { nx: 0, ny: 0, nz: 1, d: -D, tipo: 'pared' },
    { nx: 0, ny: 0, nz: -1, d: -D, tipo: 'pared' },
    { nx: 0, ny: -1, nz: 0, d: -5, tipo: 'pared' },
  );
  return celdas;
}

function correr(m, seg, dt = 1 / 60, cada) {
  const n = Math.round(seg / dt);
  for (let i = 0; i < n; i++) { if (cada) cada(i * dt); m.paso(dt); }
}

function sano(m) {
  for (const d of m.dados) {
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz']) {
      assert.ok(Number.isFinite(d[k]), `dado ${d.id}: ${k} = ${d[k]}`);
    }
  }
}

test('un dado que cae queda plano, quieto y en su celda', () => {
  const m = new Mundo();
  const d = m.agregarDado(0, 0);
  d.y = 2.5;
  const az = semilla(1);
  // orientación cualquiera
  d.qx = az() - 0.5; d.qy = az() - 0.5; d.qz = az() - 0.5; d.qw = az();
  const l = Math.hypot(d.qx, d.qy, d.qz, d.qw);
  d.qx /= l; d.qy /= l; d.qz /= l; d.qw /= l;
  d.wx = 8; d.wz = -5;
  correr(m, 3);
  sano(m);
  assert.ok(d.dormido, 'debería dormirse');
  assert.ok(m.planitud(d) > 0.9999, `planitud ${m.planitud(d)}`);
  assert.ok(Math.abs(d.y - 0.5) < 0.005, `altura ${d.y}`);
  assert.ok(Math.hypot(d.x, d.z) < 0.01, `lejos de la celda: ${d.x}, ${d.z}`);
});

test('nunca atraviesa el piso, ni con un golpe fuerte hacia abajo', () => {
  const m = new Mundo();
  const d = m.agregarDado(0, 0);
  d.y = 3; d.vy = -120; d.wx = 40;
  let minY = Infinity;
  correr(m, 1.5, 1 / 60, () => { minY = Math.min(minY, d.y); });
  sano(m);
  assert.ok(minY > 0.3, `bajó hasta ${minY}`);
});

test('toque: salta, cambia de cara alguna vez y vuelve a su lugar', () => {
  const m = new Mundo();
  const d = m.agregarDado(0, 0);
  const az = semilla(7);
  const vistas = new Set([m.valorArriba(d)]);
  for (let i = 0; i < 12; i++) {
    m.saltar(d, 1.2, 22, az);
    correr(m, 2.2);
    sano(m);
    vistas.add(m.valorArriba(d));
    assert.ok(d.dormido, `tiro ${i}: no se durmió`);
    assert.ok(Math.hypot(d.x, d.z) < 0.02, `tiro ${i}: quedó en ${d.x.toFixed(2)}, ${d.z.toFixed(2)}`);
  }
  assert.ok(vistas.size >= 4, `solo salieron ${[...vistas]}`);
});

test('grilla de 55 dados: sacudida fuerte, reacomodo y todo prolijo', () => {
  const m = new Mundo();
  const paso = 1.45;
  const celdas = grilla(m, 5, 11, paso);
  const az = semilla(3);
  // caos: resortes sueltos, aceleración de la caja que cambia de sentido
  for (const d of m.dados) { d.resorte = 0; m.saltar(d, 1.5, 25, az); }
  const t0 = performance.now();
  correr(m, 1.2, 1 / 60, (t) => {
    const f = Math.sin(t * 2 * Math.PI * 4);
    m.aExt[0] = f * 900; m.aExt[2] = Math.cos(t * 2 * Math.PI * 3) * 700;
    m.despertarTodos();
  });
  const ms = (performance.now() - t0) / 72;
  m.aExt[0] = m.aExt[2] = 0;
  sano(m);
  // ningún dado se escapó de la caja ni quedó dentro de otro
  for (const d of m.dados) {
    assert.ok(Math.abs(d.x) < 5 * paso / 2 + 0.1 && Math.abs(d.z) < 11 * paso / 2 + 0.1, `dado ${d.id} afuera: ${d.x}, ${d.z}`);
    assert.ok(d.y > 0.3 && d.y < 5, `dado ${d.id} altura ${d.y}`);
  }
  // reasignar y volver
  correr(m, 0.6);
  m.reasignarCeldas(celdas);
  for (const d of m.dados) { d.resorte = 1; m.saltarA(d, d.cx, d.cz, 0.4, 8, az); }
  correr(m, 5);
  sano(m);
  let lejos = 0, torcidos = 0, despiertos = 0;
  for (const d of m.dados) {
    if (Math.hypot(d.x - d.cx, d.z - d.cz) > 0.03) lejos++;
    if (m.planitud(d) < 0.999) torcidos++;
    if (!d.dormido) despiertos++;
  }
  // cada celda con un solo dado
  const claves = new Set(m.dados.map((d) => `${d.cx.toFixed(3)},${d.cz.toFixed(3)}`));
  assert.equal(claves.size, m.dados.length);
  assert.equal(lejos, 0, `${lejos} dados lejos de su celda`);
  assert.equal(torcidos, 0, `${torcidos} dados torcidos`);
  assert.equal(despiertos, 0, `${despiertos} dados sin dormirse`);
  console.log(`  caos: ${ms.toFixed(2)} ms por frame de física (55 dados)`);
});

test('el dedo hace rodar un dado en la dirección del trazo', () => {
  const m = new Mundo();
  const d = m.agregarDado(0, 0);
  // cámara arriba, el dedo cruza el dado de izquierda a derecha (+x) en 60 ms
  const cam = [0, 30, 0];
  const dir = (x, z) => { const v = [x - cam[0], 1 - cam[1], z - cam[2]]; const l = Math.hypot(...v); return v.map((c) => c / l); };
  let x = -1;
  const v = 25; // lados por segundo
  let wzMin = 0, xMax = 0;
  for (let i = 0; i < 6; i++) {
    const x1 = x + v / 60;
    m.dedos = [{ o: cam, d0: dir(x, 0), d1: dir(x1, 0) }];
    m.paso(1 / 60);
    wzMin = Math.min(wzMin, d.wz); xMax = Math.max(xMax, d.x);
    x = x1;
  }
  m.dedos = [];
  // rodar hacia +x es girar alrededor de −z, y avanzar un poco hacia +x
  assert.ok(wzMin < -10, `wz mínimo = ${wzMin}`);
  assert.ok(xMax > 0.1, `x máximo = ${xMax}`);
  correr(m, 3);
  sano(m);
  assert.ok(d.dormido);
  assert.ok(Math.hypot(d.x, d.z) < 0.02);
});

test('agarre: el dado cuelga del dedo, se puede arrastrar y al soltarlo vuelve', () => {
  const m = new Mundo();
  const paso = 1.45;
  grilla(m, 3, 3, paso);
  const d = m.dados[4]; // el del centro
  m.agarrar(1, d, d.x, d.y + 0.5, d.z);
  let yMax = 0;
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    m.moverAgarre(1, t * 1.5, 2.1, t * 0.8);
    m.paso(1 / 60);
    yMax = Math.max(yMax, d.y);
  }
  sano(m);
  assert.ok(yMax > 1.2, `no se levantó: y máx ${yMax}`);
  const g = m.agarres.get(1);
  assert.ok(Math.hypot(d.x - 1.5, d.z - 0.8) < 1.2, `no siguió al dedo: ${d.x}, ${d.z}`);
  m.soltarAgarre(1);
  correr(m, 5);
  sano(m);
  for (const e of m.dados) {
    assert.ok(e.dormido, `dado ${e.id} despierto`);
    assert.ok(Math.hypot(e.x - e.cx, e.z - e.cz) < 0.03, `dado ${e.id} lejos de su celda`);
  }
});
