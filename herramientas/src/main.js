// ─────────────────────────────────────────────────────────────
//  generalito · herramientas
//  Útiles de dibujo en 3D dentro de una caja que es la pantalla:
//  al sacudir el celular se mueven como de verdad. "Ordenar" los
//  vuelve a la composición prolija.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { crearEscenario, TECHO } from './escenario.js';
import { Mundo } from './fisica.js';
import { Entrada } from './entrada.js';
import { Sonido } from './sonido.js';
import { PALETA } from './paleta.js';
import { COMPOSICION, ANCHO_CORTO } from './composicion.js';

const qs = new URLSearchParams(location.search);
const CON_UI = qs.get('ui') !== '0';
const FONDO = qs.get('fondo') === 'crema' ? PALETA.crema : PALETA.salvia;
const movil = matchMedia('(pointer: coarse)').matches;
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('lienzo');
const esc = crearEscenario(canvas, { fondo: FONDO, calidad: movil ? 1 : 2, captura: qs.has('captura') });
const mundo = new Mundo();
const sonido = new Sonido();
const items = []; // { c: cuerpo de la física, malla, def, cuerpo }

// ── caja y composición ──
let caja = null;
let horizontal = false;

function armarCaja() {
  const W = window.innerWidth, H = window.innerHeight;
  horizontal = W > H;
  // en horizontal la composición va rotada: se agranda el encuadre para
  // que entre a lo largo sin apretar los objetos
  const corto = horizontal ? Math.max(ANCHO_CORTO, 54 / (W / H)) : ANCHO_CORTO;
  caja = esc.encuadrar(corto, W, H);
  mundo.planos = [
    { n: [0, 1, 0], d: 0, tipo: 'piso' },
    ...caja.paredes.map((p) => ({ ...p, tipo: 'pared' })),
    { n: [0, -1, 0], d: -TECHO, tipo: 'pared' },
  ];
}

const _q = new THREE.Quaternion();
const EJE_Y = new THREE.Vector3(0, 1, 0);

// Pose de reposo de cada objeto en la composición, para el encuadre actual.
function objetivos() {
  return items.map(({ def, cuerpo }) => {
    let { x, z, giro } = def;
    if (horizontal) { [x, z] = [z, -x]; giro -= 90; }
    _q.setFromAxisAngle(EJE_Y, THREE.MathUtils.degToRad(giro));
    return { x, y: cuerpo.medias[1] + cuerpo.radio, z, q: _q.clone() };
  });
}

async function cargar() {
  const nombres = [...new Set(COMPOSICION.map((c) => c.objeto))];
  const modulos = {};
  await Promise.all(nombres.map(async (n) => {
    try { modulos[n] = await import(`./objetos/${n}.js`); } catch (e) { console.warn(`no se pudo cargar ${n}`, e); }
  }));
  for (const def of COMPOSICION) {
    const mod = modulos[def.objeto];
    if (!mod) continue;
    const variante = mod.variantes.includes(def.variante) ? def.variante : mod.variantes[0];
    const { malla, cuerpo } = mod.crear(variante);
    esc.escena.add(malla);
    const c = mundo.agregar({ ...cuerpo, x: def.x, y: cuerpo.medias[1] + cuerpo.radio, z: def.z, qx: 0, qy: 0, qz: 0, qw: 1 });
    items.push({ c, malla, def: { ...def, variante }, cuerpo });
  }
}

// Al empezar: cada objeto cae desde un poquito arriba de su lugar.
function presentar() {
  const T = objetivos();
  items.forEach((it, i) => {
    const t = T[i], c = it.c;
    c.x = t.x; c.z = t.z;
    c.y = t.y + (reducido ? 0 : 1.2 + i * 0.35);
    c.qx = t.q.x; c.qy = t.q.y; c.qz = t.q.z; c.qw = t.q.w;
    c.vx = c.vy = c.vz = 0; c.wx = c.wy = c.wz = 0;
  });
  mundo.despertarTodos();
}

// ── ordenar: cada objeto vuela a su lugar (cinemático) y se suelta ──
const animaciones = new Map();
const suave = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

function ordenar() {
  const T = objetivos();
  // primero los que están más lejos de su lugar, así no se cruzan tanto
  const orden = items.map((it, i) => i).sort((a, b) => {
    const da = Math.hypot(items[a].c.x - T[a].x, items[a].c.z - T[a].z);
    const db = Math.hypot(items[b].c.x - T[b].x, items[b].c.z - T[b].z);
    return db - da;
  });
  orden.forEach((i, k) => {
    const c = items[i].c;
    c.cinematico = true;
    animaciones.set(c, {
      t: -k * 0.04,
      dur: 0.75,
      x0: c.x, y0: c.y, z0: c.z,
      q0: new THREE.Quaternion(c.qx, c.qy, c.qz, c.qw),
      ...T[i],
    });
  });
  sucio = 3;
}

const _qa = new THREE.Quaternion();
function animar(dt) {
  for (const [c, a] of animaciones) {
    a.t += dt;
    if (a.t < 0) continue;
    const k = Math.min(1, a.t / a.dur);
    const e = suave(k);
    const px = c.x, py = c.y, pz = c.z;
    c.x = a.x0 + (a.x - a.x0) * e;
    c.z = a.z0 + (a.z - a.z0) * e;
    c.y = a.y0 + (a.y - a.y0) * e + Math.sin(Math.PI * e) * 3.2;
    _qa.slerpQuaternions(a.q0, a.q, e);
    c.qx = _qa.x; c.qy = _qa.y; c.qz = _qa.z; c.qw = _qa.w;
    // velocidad para que los contactos con los que están quietos sean creíbles
    c.vx = (c.x - px) / Math.max(dt, 1e-3); c.vy = (c.y - py) / Math.max(dt, 1e-3); c.vz = (c.z - pz) / Math.max(dt, 1e-3);
    c.wx = c.wy = c.wz = 0;
    if (k >= 1) {
      c.vx = c.vy = c.vz = 0;
      c.cinematico = false;
      animaciones.delete(c);
    }
  }
}

// ── frame ──
let ultimo = performance.now();
let sucio = 3;
let previo = new Float32Array(0);
let pausado = qs.has('pausa');
let ultimaVibracion = 0;

function simular(dt) {
  entrada.actualizar(dt);
  animar(dt);
  mundo.paso(dt);
  const ancho = caja ? caja.x1 : 12;
  for (const { c } of items) {
    if (c.golpe > 0) {
      sonido.golpe(c.id, c.golpe, c.material, c.golpeContra, c.x / ancho);
      if (c.golpe > 120 && navigator.vibrate && entrada.intensidad > 4) {
        const t = performance.now();
        if (t - ultimaVibracion > 90) { ultimaVibracion = t; navigator.vibrate(Math.min(12, 3 + c.golpe * 0.02)); }
      }
    }
  }
}

function dibujar() {
  if (previo.length !== items.length * 7) { previo = new Float32Array(items.length * 7); sucio = 3; }
  let mov = 0;
  items.forEach(({ c, malla }, i) => {
    const k = i * 7;
    mov += Math.abs(previo[k] - c.x) + Math.abs(previo[k + 1] - c.y) + Math.abs(previo[k + 2] - c.z)
      + Math.abs(previo[k + 3] - c.qx) + Math.abs(previo[k + 4] - c.qy) + Math.abs(previo[k + 5] - c.qz) + Math.abs(previo[k + 6] - c.qw);
    previo[k] = c.x; previo[k + 1] = c.y; previo[k + 2] = c.z;
    previo[k + 3] = c.qx; previo[k + 4] = c.qy; previo[k + 5] = c.qz; previo[k + 6] = c.qw;
    malla.position.set(c.x, c.y, c.z);
    malla.quaternion.set(c.qx, c.qy, c.qz, c.qw);
  });
  if (mov > 1e-5) sucio = 2;
  if (sucio > 0) {
    sucio--;
    esc.dibujar();
    medir();
  }
}

// si el teléfono no llega a ~45 fps, bajar la resolución de a poco
const medicion = { t: performance.now(), n: 0 };
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
function medir() {
  medicion.n++;
  if (medicion.n < 90) return;
  const prom = (performance.now() - medicion.t) / medicion.n / 1000;
  medicion.t = performance.now(); medicion.n = 0;
  if (prom > 1 / 45 && pixelRatio > 1.01) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    esc.renderer.setPixelRatio(pixelRatio);
    esc.encuadrar(caja ? (horizontal ? Math.max(ANCHO_CORTO, 54 / (window.innerWidth / window.innerHeight)) : ANCHO_CORTO) : ANCHO_CORTO);
  }
}

function frame(ahora) {
  const dt = Math.min((ahora - ultimo) / 1000, 1 / 30);
  ultimo = ahora;
  if (!pausado) simular(dt);
  dibujar();
  requestAnimationFrame(frame);
}

// ── interfaz ──
const ui = document.getElementById('ui');
const pista = document.getElementById('pista');
const bSonido = document.getElementById('b-sonido');
const bSacudir = document.getElementById('b-sacudir');
const bOrdenar = document.getElementById('b-ordenar');

const entrada = new Entrada({
  canvas,
  camara: esc.camara,
  mundo,
  sonido,
  onPrimera: () => pista?.classList.add('oculta'),
});

if (!CON_UI) ui?.remove();
else {
  bSonido.addEventListener('click', () => {
    sonido.desbloquear();
    bSonido.setAttribute('aria-pressed', String(sonido.alternar()));
  });
  bOrdenar.addEventListener('click', () => { sonido.desbloquear(); ordenar(); });
  bSacudir.addEventListener('click', async () => {
    sonido.desbloquear();
    if (entrada.necesitaPermiso() && !entrada.sensor && !bSacudir.dataset.pedido) {
      bSacudir.dataset.pedido = '1';
      const ok = await entrada.pedirPermiso();
      if (ok) {
        bSacudir.querySelector('span').textContent = 'Sacudí el celular';
        setTimeout(() => bSacudir.classList.add('oculta'), 2200);
        return;
      }
    }
    entrada.simularSacudida();
  });
}

if (entrada.necesitaPermiso()) {
  const s = bSacudir?.querySelector('span');
  if (s) s.textContent = 'Activar sacudida';
} else {
  entrada.escucharSensor();
  entrada.onSensor = () => bSacudir?.classList.add('oculta');
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); sonido.desbloquear(); entrada.simularSacudida(); }
  else if (e.key === 'o' || e.key === 'O') ordenar();
  else if (e.key === 's' || e.key === 'S') { sonido.desbloquear(); bSonido?.setAttribute('aria-pressed', String(sonido.alternar())); }
});

window.addEventListener('resize', () => {
  const antes = horizontal;
  armarCaja();
  if (antes !== horizontal) ordenar();
  sucio = 3;
});
document.addEventListener('visibilitychange', () => { ultimo = performance.now(); });

// para pruebas automáticas y para la consola
window.__herr = {
  mundo, entrada, esc, items, sonido,
  ordenar,
  avanzar(seg, dt = 1 / 60) { for (let t = 0; t < seg; t += dt) simular(dt); sucio = 2; dibujar(); },
  redibujar() { sucio = 2; dibujar(); },
  pausar(si = true) { pausado = si; },
};

armarCaja();
await cargar();
presentar();
requestAnimationFrame((t) => {
  ultimo = t;
  document.body.classList.add('listo');
  window.__listo = true;
  requestAnimationFrame(frame);
});
