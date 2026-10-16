// ─────────────────────────────────────────────────────────────
//  Escenario de las herramientas: el mismo estudio de los dados
//  (softboxes para los reflejos, luz principal arriba a la izquierda,
//  piso con sombra suave y oclusión de contacto), con la paleta de la
//  foto de referencia. Unidades: centímetros, y hacia la cámara.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { crearEstudio, Piso, LUZ } from '../../src/escena.js';
import { SOMBRA } from './util.js';
import { PALETA } from './paleta.js';

export const TAN_H = 0.14;  // tan(½ campo horizontal): lente larga, como en los dados
export const TECHO = 9;     // profundidad de la caja (cm): vidrio invisible arriba

export function crearEscenario(canvas, { fondo = PALETA.salvia, calidad = 1, captura = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: captura,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(fondo, 1);

  const escena = new THREE.Scene();
  // el cartón de relleno, más fuerte que en los dados: las herramientas se
  // ven más de costado y sus caras de adelante no pueden quedar negras
  escena.environment = crearEstudio(renderer, { fondo, relleno: 2.2 });
  escena.environmentIntensity = 1;

  const luz = new THREE.DirectionalLight(0xfff8f0, 2.4);
  luz.position.copy(LUZ).multiplyScalar(100);
  escena.add(luz);
  // relleno: cielo tenue arriba, rebote del papel salvia abajo
  const relleno = new THREE.HemisphereLight(0xf2f2ee, 0xc9cbb8, 0.65);
  escena.add(relleno);

  const piso = new Piso(renderer, {
    calidad,
    fondo,
    tinte: [0.6, 0.62, 0.57],
    escala: 0.9,
    oclusion: 0.55,
  });
  escena.add(piso.mesh);
  SOMBRA.uSombra.value = piso.rtSombra.depthTexture;
  SOMBRA.uLuzVP.value = piso.uniforms.uLuzVP.value; // misma matriz, se actualiza sola

  const camara = new THREE.PerspectiveCamera(30, 1, 1, 400);
  camara.up.set(0, 0, -1);

  // Cámara cenital que muestra `corto` cm en el lado corto de la pantalla
  // (medido a 1 cm del piso). Devuelve el rectángulo visible y las
  // paredes de la caja: los planos laterales del encuadre.
  function encuadrar(corto, ancho = window.innerWidth, alto = window.innerHeight) {
    renderer.setSize(ancho, alto, false);
    const aspecto = ancho / alto;
    const anchoMundo = aspecto < 1 ? corto : corto * aspecto;
    const tanV = TAN_H / aspecto;
    const h = 1 + (anchoMundo / 2) / TAN_H;
    camara.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
    camara.aspect = aspecto;
    camara.near = Math.max(1, h - TECHO - 30);
    camara.far = h + 5;
    camara.position.set(0, h, 0);
    camara.lookAt(0, 0, 0);
    camara.updateProjectionMatrix();
    camara.updateMatrixWorld();
    const X0 = h * TAN_H, Z0 = h * tanV;
    piso.encuadrar(-X0 - 1, X0 + 1, -Z0 - 1, Z0 + 1, TECHO + 10);
    const C = camara.position.clone();
    const adentro = new THREE.Vector3(0, 1, 0);
    const plano = (A, dir) => {
      const n = new THREE.Vector3().subVectors(A, C).cross(dir).normalize();
      if (n.dot(new THREE.Vector3().subVectors(adentro, C)) < 0) n.negate();
      return { n: [n.x, n.y, n.z], d: n.dot(C) };
    };
    const ejeZ = new THREE.Vector3(0, 0, 1), ejeX = new THREE.Vector3(1, 0, 0);
    const paredes = [
      plano(new THREE.Vector3(-X0, 0, 0), ejeZ),
      plano(new THREE.Vector3(X0, 0, 0), ejeZ),
      plano(new THREE.Vector3(0, 0, -Z0), ejeX),
      plano(new THREE.Vector3(0, 0, Z0), ejeX),
    ];
    return { x0: -X0, x1: X0, z0: -Z0, z1: Z0, alturaCamara: h, paredes };
  }

  function dibujar() {
    piso.actualizar(escena);
    renderer.render(escena, camara);
  }

  return { renderer, escena, camara, luz, relleno, piso, encuadrar, dibujar };
}
