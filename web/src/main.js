// ─────────────────────────────────────────────────────────────
//  generalito · dados
//  Grilla de dados 3D de marfil que se pueden hacer rodar con el
//  dedo, tirar con un toque y mezclar sacudiendo el celular.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Mundo } from './fisica.js';
import { geometriaDado, texturasDado, materialDado } from './dado.js';
import { crearEstudio, Piso, LUZ, FONDO_SRGB } from './escena.js';
import { Entrada } from './entrada.js';
import { Sonido } from './sonido.js';

const qs = new URLSearchParams(location.search);
const COLUMNAS = Math.max(2, Math.min(12, parseInt(qs.get('cols'), 10) || 5));
const CON_UI = qs.get('ui') !== '0';
const PASO = 1.45;     // distancia entre centros de celda, en lados de dado
const TAN_H = 0.14;    // tan(½ campo horizontal): lente larga, perspectiva leve
const TECHO = 4.2;     // vidrio invisible sobre los dados
const RADIO = 0.13;    // redondeo de las aristas
const MAX_DADOS = 400;
const movil = matchMedia('(pointer: coarse)').matches;

// ── render ──
const canvas = document.getElementById('lienzo');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: qs.has('captura'),
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor(FONDO_SRGB, 1);

const escena = new THREE.Scene();
escena.environment = crearEstudio(renderer);
escena.environmentIntensity = 1;

const luz = new THREE.DirectionalLight(0xfff8f0, 2.3);
luz.position.copy(LUZ).multiplyScalar(10);
escena.add(luz);
// relleno: cielo del estudio tenue arriba, rebote cálido del papel abajo
const relleno = new THREE.HemisphereLight(0xf0f0f0, 0xdcd3c6, 0.6);
escena.add(relleno);

const camara = new THREE.PerspectiveCamera(30, 1, 1, 60);
camara.up.set(0, 0, -1);

const piso = new Piso(renderer, { calidad: movil ? 1 : 2 });
escena.add(piso.mesh);

const geo = geometriaDado(RADIO);
const tex = texturasDado(movil ? 384 : 512);
for (const t of Object.values(tex)) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const mat = materialDado(tex);
mat.userData.uniforms.uSombra.value = piso.rtSombra.depthTexture;
mat.userData.uniforms.uLuzVP.value = piso.uniforms.uLuzVP.value; // misma matriz, compartida
const instancias = new THREE.InstancedMesh(geo, mat, MAX_DADOS);
instancias.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instancias.frustumCulled = false;
instancias.count = 0;
escena.add(instancias);
const colores = new Float32Array(MAX_DADOS * 3).fill(1);
instancias.instanceColor = new THREE.InstancedBufferAttribute(colores, 3);

// ── física ──
const mundo = new Mundo({ radio: RADIO });
const sonido = new Sonido();

// ── grilla ──
let celdas = [];
let alturaCam = 30;

function plano(C, A, dir, adentro) {
  const n = new THREE.Vector3().subVectors(A, C).cross(dir).normalize();
  if (n.dot(new THREE.Vector3().subVectors(adentro, C)) < 0) n.negate();
  return { nx: n.x, ny: n.y, nz: n.z, d: n.dot(C), tipo: 'pared' };
}

function armarGrilla() {
  const W = window.innerWidth, H = window.innerHeight;
  const aspecto = W / H;
  renderer.setSize(W, H, false);
  const ancho = COLUMNAS * PASO;
  const tanV = TAN_H / aspecto;
  alturaCam = 0.5 + (ancho / 2) / TAN_H;
  camara.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
  camara.aspect = aspecto;
  camara.near = Math.max(1, alturaCam - 14);
  camara.far = alturaCam + 2;
  camara.position.set(0, alturaCam, 0);
  camara.lookAt(0, 0, 0);
  camara.updateProjectionMatrix();
  camara.updateMatrixWorld();

  const filas = Math.max(1, Math.round(COLUMNAS / aspecto));
  const profundo = ancho / aspecto;
  const pasoZ = profundo / filas;
  celdas = [];
  for (let f = 0; f < filas; f++) for (let c = 0; c < COLUMNAS; c++) {
    celdas.push([(c - (COLUMNAS - 1) / 2) * PASO, (f - (filas - 1) / 2) * pasoZ]);
  }

  // paredes: los planos laterales del encuadre, así ningún dado sale de cuadro
  const C = camara.position.clone();
  const X0 = alturaCam * TAN_H, Z0 = alturaCam * tanV;
  const adentro = new THREE.Vector3(0, 0.5, 0);
  const ejeZ = new THREE.Vector3(0, 0, 1), ejeX = new THREE.Vector3(1, 0, 0);
  paredes = [
    plano(C, new THREE.Vector3(-X0, 0, 0), ejeZ, adentro),
    plano(C, new THREE.Vector3(X0, 0, 0), ejeZ, adentro),
    plano(C, new THREE.Vector3(0, 0, -Z0), ejeX, adentro),
    plano(C, new THREE.Vector3(0, 0, Z0), ejeX, adentro),
    { nx: 0, ny: -1, nz: 0, d: -TECHO, tipo: 'pared' },
  ];
  piso.encuadrar(-X0 - 0.3, X0 + 0.3, -Z0 - 0.3, Z0 + 0.3, TECHO + 8);
  ajustarDados();
  cerrarCaja(cajaActiva);
  sucio = 3;
}

// La caja (paredes en los bordes del encuadre y un techo de vidrio) se
// abre mientras entran dados nuevos desde arriba y se cierra cuando ya
// están todos adentro.
let paredes = [];
let cajaActiva = false;
function cerrarCaja(si) {
  cajaActiva = si;
  mundo.planos = [{ nx: 0, ny: 1, nz: 0, d: 0, tipo: 'piso' }, ...(si ? paredes : [])];
}

// Reparte las celdas: los dados que sobran se van, las celdas sin dado
// reciben uno nuevo que cae desde arriba.
function ajustarDados() {
  const L = mundo.dados;
  const libres = new Set(celdas.map((_, i) => i));
  const pares = [];
  for (const d of L) for (let j = 0; j < celdas.length; j++) {
    pares.push([(d.x - celdas[j][0]) ** 2 + (d.z - celdas[j][1]) ** 2, d, j]);
  }
  pares.sort((a, b) => a[0] - b[0]);
  const asignado = new Set();
  for (const [, d, j] of pares) {
    if (asignado.has(d) || !libres.has(j)) continue;
    asignado.add(d); libres.delete(j);
    const [cx, cz] = celdas[j];
    const mover = Math.hypot(d.cx - cx, d.cz - cz) > 0.02;
    d.cx = cx; d.cz = cz;
    if (mover && Math.hypot(d.x - cx, d.z - cz) > 0.3) mundo.saltarA(d, cx, cz, 0.34, 8);
    else if (mover) mundo.despertar(d);
  }
  for (const d of [...L]) if (!asignado.has(d)) mundo.quitarDado(d);
  // los nuevos caen en cascada, de arriba hacia abajo de la pantalla
  const nuevas = [...libres].sort((a, b) => celdas[a][1] - celdas[b][1] || celdas[a][0] - celdas[b][0]);
  const t0 = reloj + (L.length ? 0 : 0.25);
  if (nuevas.length) cajaActiva = false;
  nuevas.forEach((j, i) => porSoltar.push({ cx: celdas[j][0], cz: celdas[j][1], t: t0 + i * (0.9 / Math.max(nuevas.length, 1)) + Math.random() * 0.06 }));
}

// Reloj de la simulación (segundos). Las tareas programadas usan este
// reloj y no setTimeout, así todo se puede adelantar en las pruebas.
let reloj = 0;
const tareas = [];
function programar(fn, retraso) { tareas.push({ t: reloj + retraso, fn }); }

// ── entrada de dados nuevos: caen desde cerca de la cámara ──
const porSoltar = [];
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

function soltar(cx, cz) {
  const d = mundo.agregarDado(cx, cz);
  if (reducido) return d;
  d.x = cx + (Math.random() - 0.5) * 0.3;
  d.z = cz + (Math.random() - 0.5) * 0.3;
  d.y = 7 + Math.random() * 4;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
  d.qx = q.x; d.qy = q.y; d.qz = q.z; d.qw = q.w;
  d.vy = -8 - Math.random() * 6;
  d.wx = (Math.random() - 0.5) * 24; d.wy = (Math.random() - 0.5) * 10; d.wz = (Math.random() - 0.5) * 24;
  // cada dado es un poco distinto, como pasa con los de verdad
  d.tinte = [0.985 + Math.random() * 0.03, 0.98 + Math.random() * 0.03, 0.97 + Math.random() * 0.035];
  return d;
}

// ── frame ──
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
let ultimo = performance.now();
let sucio = 3;
let previo = new Float32Array(0);
const medicion = { t: 0, n: 0 };

function simular(dt) {
  reloj += dt;
  for (let i = tareas.length - 1; i >= 0; i--) {
    if (reloj >= tareas[i].t) { const t = tareas[i]; tareas.splice(i, 1); t.fn(); }
  }
  // dados nuevos que llegan
  for (let i = porSoltar.length - 1; i >= 0; i--) {
    if (reloj >= porSoltar[i].t) {
      soltar(porSoltar[i].cx, porSoltar[i].cz);
      porSoltar.splice(i, 1);
    }
  }
  // la caja se cierra cuando ya no queda nadie cayendo desde arriba
  if (!cajaActiva && !porSoltar.length && !mundo.dados.some((d) => d.y > TECHO - 0.6)) cerrarCaja(true);

  entrada.actualizar(dt);
  mundo.paso(dt);

  // sonido y vibración
  for (const d of mundo.dados) {
    if (d.golpe > 6) {
      sonido.golpe(d.id, d.golpe, d.golpeDado, d.x / (COLUMNAS * PASO * 0.5));
      if (d.golpe > 24 && navigator.vibrate && entrada.punteros.size) vibrar(d.golpe);
    }
  }
}

function dibujar(dt) {
  // matrices de las instancias, y ver si algo se movió
  const L = mundo.dados;
  if (previo.length !== L.length * 7) { previo = new Float32Array(L.length * 7); sucio = 3; instancias.instanceColor.needsUpdate = true; }
  let mov = 0;
  for (let i = 0; i < L.length; i++) {
    const d = L[i];
    const k = i * 7;
    mov += Math.abs(previo[k] - d.x) + Math.abs(previo[k + 1] - d.y) + Math.abs(previo[k + 2] - d.z)
      + Math.abs(previo[k + 3] - d.qx) + Math.abs(previo[k + 4] - d.qy) + Math.abs(previo[k + 5] - d.qz) + Math.abs(previo[k + 6] - d.qw);
    previo[k] = d.x; previo[k + 1] = d.y; previo[k + 2] = d.z;
    previo[k + 3] = d.qx; previo[k + 4] = d.qy; previo[k + 5] = d.qz; previo[k + 6] = d.qw;
    _p.set(d.x, d.y, d.z);
    _q.set(d.qx, d.qy, d.qz, d.qw);
    _m.compose(_p, _q, _s);
    instancias.setMatrixAt(i, _m);
    const t = d.tinte;
    if (t !== 1) { colores[i * 3] = t[0]; colores[i * 3 + 1] = t[1]; colores[i * 3 + 2] = t[2]; }
  }
  instancias.count = L.length;
  instancias.instanceMatrix.needsUpdate = true;
  if (mov > 1e-5) sucio = 2;

  if (sucio > 0) {
    sucio--;
    piso.actualizar(escena);
    renderer.render(escena, camara);
    medir(dt);
  }
}

let pausado = qs.has('pausa');
function frame(ahora) {
  const dt = Math.min((ahora - ultimo) / 1000, 1 / 30);
  ultimo = ahora;
  if (!pausado) simular(dt);
  dibujar(dt);
  requestAnimationFrame(frame);
}

// Si el teléfono no llega a ~45 fps, bajar la resolución de a poco.
function medir(dt) {
  medicion.t += dt; medicion.n++;
  if (medicion.n < 90) return;
  const prom = medicion.t / medicion.n;
  medicion.t = 0; medicion.n = 0;
  if (prom > 1 / 45 && pixelRatio > 1.01) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}

let ultimaVibracion = 0;
function vibrar(v) {
  const t = performance.now();
  if (t - ultimaVibracion < 70) return;
  ultimaVibracion = t;
  navigator.vibrate(Math.min(14, 4 + v * 0.12));
}

// ── interfaz ──
const ui = document.getElementById('ui');
const pista = document.getElementById('pista');
const bSonido = document.getElementById('b-sonido');
const bSacudir = document.getElementById('b-sacudir');

const entrada = new Entrada({
  canvas,
  camara,
  mundo,
  sonido,
  celdas: () => celdas,
  programar,
  onPrimera: () => pista?.classList.add('oculta'),
  onCaos: () => {},
});

if (!CON_UI) ui?.remove();
else {
  bSonido.addEventListener('click', () => {
    sonido.desbloquear();
    const on = sonido.alternar();
    bSonido.setAttribute('aria-pressed', String(on));
  });
  bSacudir.addEventListener('click', async () => {
    sonido.desbloquear();
    if (entrada.necesitaPermiso() && !entrada.sensor && !bSacudir.dataset.pedido) {
      bSacudir.dataset.pedido = '1';
      const ok = await entrada.pedirPermiso();
      if (ok) { bSacudir.querySelector('span').textContent = 'Sacudí el celular'; setTimeout(() => bSacudir.classList.add('oculta'), 2200); return; }
    }
    entrada.simularSacudida();
  });
}

if (entrada.necesitaPermiso()) {
  bSacudir?.querySelector('span') && (bSacudir.querySelector('span').textContent = 'Activar sacudida');
} else {
  entrada.escucharSensor();
  entrada.onSensor = () => bSacudir?.classList.add('oculta');
}

// teclado (escritorio): espacio sacude, S apaga o prende el sonido
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); sonido.desbloquear(); entrada.simularSacudida(); }
  else if (e.key === 's' || e.key === 'S') { sonido.desbloquear(); bSonido?.setAttribute('aria-pressed', String(sonido.alternar())); }
});

window.addEventListener('resize', () => { armarGrilla(); });
document.addEventListener('visibilitychange', () => { ultimo = performance.now(); });

// para pruebas automáticas y para la consola
window.__dados = {
  mundo, entrada, camara, renderer, sonido, luz, relleno, material: mat, escena, piso,
  redibujar() { sucio = 2; dibujar(0); },
  celdas: () => celdas,
  // adelanta la simulación sin dibujar (para pruebas)
  avanzar(seg, dt = 1 / 60) {
    for (let t = 0; t < seg; t += dt) simular(dt);
    sucio = 2;
    dibujar(0);
  },
  pausar(si = true) { pausado = si; },
};

armarGrilla();
requestAnimationFrame((t) => {
  ultimo = t;
  document.body.classList.add('listo');
  requestAnimationFrame(frame);
});
