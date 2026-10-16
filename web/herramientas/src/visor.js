// Visor de objetos para desarrollar y revisar cada herramienta por separado.
// visor.html?objeto=lapiz&variante=rojo&vista=arriba|cerca|colision|todas&lista=a,b
import * as THREE from 'three';
import { crearEscenario } from './escenario.js';

const qs = new URLSearchParams(location.search);
const vista = qs.get('vista') || 'arriba';
const nombres = (qs.get('lista') || qs.get('objeto') || 'lapiz').split(',').filter(Boolean);
const canvas = document.getElementById('lienzo');
const esc = crearEscenario(canvas, { captura: true });
const info = { objetos: [] };
window.__info = info;

function triangulos(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(n);
}

function cajaColision(cuerpo) {
  const [hx, hy, hz] = cuerpo.medias, r = cuerpo.radio;
  const g = new THREE.Group();
  const afuera = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * (hx + r), 2 * (hy + r), 2 * (hz + r))),
    new THREE.LineBasicMaterial({ color: 0xff2a00, depthTest: false, transparent: true, opacity: 0.9 })
  );
  const nucleo = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(2 * hx, 0.01), Math.max(2 * hy, 0.01), Math.max(2 * hz, 0.01))),
    new THREE.LineBasicMaterial({ color: 0x0044ff, depthTest: false, transparent: true, opacity: 0.9 })
  );
  afuera.renderOrder = nucleo.renderOrder = 10;
  g.add(afuera, nucleo);
  return g;
}

async function cargar(nombre) {
  const m = await import(`./objetos/${nombre}.js`);
  const variantes = qs.get('variante') && nombres.length === 1 ? [qs.get('variante')] : m.variantes;
  return variantes.map((v) => {
    const t0 = performance.now();
    const o = m.crear(v);
    const ms = performance.now() - t0;
    const tri = triangulos(o.malla);
    info.objetos.push({ nombre, variante: v, ms: Math.round(ms), triangulos: tri, cuerpo: o.cuerpo });
    return { nombre, variante: v, ...o };
  });
}

async function principal() {
  const lista = (await Promise.all(nombres.map(cargar))).flat();
  // cada objeto apoyado en el piso, con el eje largo vertical en pantalla (z)
  let x = 0;
  const anchos = lista.map((o) => 2 * (o.cuerpo.medias[2] + o.cuerpo.radio));
  const total = anchos.reduce((a, b) => a + b, 0) + 1.5 * (lista.length - 1);
  let largo = 0;
  lista.forEach((o, i) => {
    const pivote = new THREE.Group();
    pivote.add(o.malla);
    if (vista === 'colision') pivote.add(cajaColision(o.cuerpo));
    const alto = o.cuerpo.medias[1] + o.cuerpo.radio;
    pivote.position.set(-total / 2 + x + anchos[i] / 2, alto, 0);
    if (vista !== 'cerca') pivote.rotation.y = Math.PI / 2; // eje largo (x local) → z del mundo
    x += anchos[i] + 1.5;
    largo = Math.max(largo, 2 * (o.cuerpo.medias[0] + o.cuerpo.radio));
    esc.escena.add(pivote);
  });

  if (vista === 'cerca') {
    esc.encuadrar(40);
    const o = lista[0];
    const L = 2 * (o.cuerpo.medias[0] + o.cuerpo.radio);
    const cam = esc.camara;
    cam.up.set(0, 1, 0);
    cam.fov = 26;
    cam.near = 0.5; cam.far = 400;
    const d = Math.max(L, 4) * 1.6;
    cam.position.set(-0.35 * d, 0.55 * d, 0.85 * d);
    cam.lookAt(0, o.cuerpo.medias[1], 0);
    cam.updateProjectionMatrix();
  } else {
    const aspecto = window.innerWidth / window.innerHeight;
    const corto = Math.max(total + 4, (largo + 4) * Math.min(aspecto, 1), 10);
    esc.encuadrar(corto);
  }

  esc.dibujar();
  document.getElementById('info').textContent = info.objetos
    .map((o) => `${o.nombre}/${o.variante}  ${o.triangulos} tri  ${o.ms} ms  medias ${o.cuerpo.medias.map((v) => v.toFixed(2)).join(',')} r ${o.cuerpo.radio}`)
    .join('\n');
  if (qs.has('sininfo')) document.getElementById('info').remove();
  requestAnimationFrame(() => { window.__listo = true; });
}

principal().catch((e) => { console.error(e); window.__error = String(e && e.stack || e); window.__listo = true; });
