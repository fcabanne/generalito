// ─────────────────────────────────────────────────────────────
//  Entrada de la caja de herramientas: el acelerómetro (lo principal),
//  el dedo que empuja y el toque que hace saltar.
//
//  · Sacudir: los objetos sienten la aceleración de la caja al revés,
//    con su valor físico real (m/s² → cm/s²): la pantalla es la caja.
//  · Pasar el dedo: empuja y hace rodar lo que toca.
//  · Tocar un objeto: le da un golpecito desde abajo en ese punto.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

const ESCALA = 120;      // m/s² → cm/s² (×100) y un poco más de vida
const UMBRAL = 1.1;      // m/s²: por debajo es ruido del sensor o la mano quieta
const LIMITE = 45;       // m/s²: tope de la aceleración que se aplica
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Entrada {
  constructor({ canvas, camara, mundo, sonido, onPrimera }) {
    this.canvas = canvas;
    this.camara = camara;
    this.mundo = mundo;
    this.sonido = sonido;
    this.onPrimera = onPrimera;
    this.punteros = new Map();
    this.ray = new THREE.Raycaster();
    this.v2 = new THREE.Vector2();
    this.acel = new THREE.Vector3();
    this.acelT = 0;
    this.grav = null;
    this.sensor = false;
    this.simulada = null;
    this.intensidad = 0;   // envolvente de la sacudida, para el sonido y la vibración

    const o = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this._down(e), o);
    canvas.addEventListener('pointermove', (e) => this._move(e), o);
    canvas.addEventListener('pointerup', (e) => this._up(e), o);
    canvas.addEventListener('pointercancel', (e) => this._up(e, true), o);
    canvas.addEventListener('lostpointercapture', (e) => this._up(e, true));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── punteros ──
  _down(e) {
    e.preventDefault();
    this.sonido?.desbloquear();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, t0: performance.now(), recorrido: 0 });
    this.onPrimera?.();
  }

  _move(e) {
    const p = this.punteros.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.recorrido += Math.hypot(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
  }

  _up(e, cancelado = false) {
    const p = this.punteros.get(e.pointerId);
    if (!p) return;
    this.punteros.delete(e.pointerId);
    if (!cancelado && p.recorrido < 10 && performance.now() - p.t0 < 350) this.tocar(e.clientX, e.clientY);
  }

  _direccion(x, y, out) {
    const r = this.canvas.getBoundingClientRect();
    this.v2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.v2, this.camara);
    out[0] = this.ray.ray.direction.x; out[1] = this.ray.ray.direction.y; out[2] = this.ray.ray.direction.z;
    return out;
  }

  // Toque: un golpecito hacia arriba en el punto tocado (si es en una
  // punta, el objeto salta y gira; si es en el medio, salta derecho).
  tocar(x, y) {
    const d = this._direccion(x, y, [0, 0, 0]);
    const o = this.camara.position;
    const hit = this.mundo.rayo(o.x, o.y, o.z, d[0], d[1], d[2], 0.15);
    if (!hit) return;
    const c = hit.cuerpo;
    const v = 55 + Math.random() * 25; // cm/s hacia arriba
    this.mundo.impulso(c, hit.x, hit.y - 0.3, hit.z,
      (Math.random() - 0.5) * c.masa * 12, c.masa * v, (Math.random() - 0.5) * c.masa * 12);
  }

  // ── acelerómetro ──
  necesitaPermiso() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  async pedirPermiso() {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r === 'granted') { this.escucharSensor(); return true; }
    } catch { /* rechazado */ }
    return false;
  }

  escucharSensor() {
    if (this._escuchando) return;
    this._escuchando = true;
    window.addEventListener('devicemotion', (e) => this._movimiento(e));
  }

  _movimiento(e) {
    let ax, ay, az;
    const a = e.acceleration;
    if (a && a.x != null) {
      ax = a.x; ay = a.y; az = a.z;
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      if (!this.grav) this.grav = [g.x, g.y, g.z];
      const k = 0.1;
      this.grav[0] += (g.x - this.grav[0]) * k;
      this.grav[1] += (g.y - this.grav[1]) * k;
      this.grav[2] += (g.z - this.grav[2]) * k;
      ax = g.x - this.grav[0]; ay = g.y - this.grav[1]; az = g.z - this.grav[2];
    }
    // dispositivo (x derecha, y arriba de la pantalla, z hacia la cara) →
    // mundo (x derecha, z hacia abajo de la pantalla, y hacia la cámara)
    this.acel.set(ax, az, -ay);
    this.acelT = performance.now();
    if (!this.sensor && this.acel.length() > 0.05) {
      this.sensor = true;
      this.onSensor?.();
    }
  }

  simularSacudida(intensidad = 22, duracion = 1.1) {
    this.simulada = { t: 0, intensidad, duracion, fase: Math.random() * 6.28, dir: Math.random() * 6.28 };
  }

  // ── por frame ──
  actualizar(dt) {
    const m = this.mundo;
    const dedos = [];
    const o = this.camara.position;
    for (const p of this.punteros.values()) {
      const d0 = this._direccion(p.px, p.py, [0, 0, 0]);
      const d1 = this._direccion(p.x, p.y, [0, 0, 0]);
      dedos.push({ o: [o.x, o.y, o.z], d0, d1 });
      p.px = p.x; p.py = p.y;
    }
    m.dedos = dedos;

    let a = this.acel;
    if (this.simulada) {
      // vaivén de 5 Hz en una dirección al azar, con algo de arriba-abajo
      const s = this.simulada;
      s.t += dt;
      const env = Math.sin(Math.min(1, s.t / s.duracion) * Math.PI);
      const f = Math.sin(s.t * 2 * Math.PI * 5 + s.fase);
      a = new THREE.Vector3(
        Math.cos(s.dir) * f * s.intensidad * env,
        Math.sin(s.t * 2 * Math.PI * 3.3) * s.intensidad * 0.4 * env,
        Math.sin(s.dir) * f * s.intensidad * env,
      );
      if (s.t >= s.duracion) this.simulada = null;
    } else if (performance.now() - this.acelT > 200) {
      a = new THREE.Vector3();
    }
    let mag = a.length();
    this.intensidad = Math.max(mag, this.intensidad * Math.exp(-dt / 0.3));
    if (mag > UMBRAL) {
      const k = (Math.min(mag, LIMITE) / mag) * ESCALA * Math.min(1, (mag - UMBRAL) / 2);
      m.aExt[0] = -a.x * k; m.aExt[1] = -a.y * k; m.aExt[2] = -a.z * k;
      m.despertarTodos();
      this._traqueteo(Math.min(mag, LIMITE), dt);
    } else {
      m.aExt[0] = m.aExt[1] = m.aExt[2] = 0;
    }
  }

  // Con la misma aceleración para todos, los objetos se deslizarían en
  // bloque como sobre hielo. En una caja de verdad el fondo no es plano
  // y cada objeto apoya distinto: golpecitos al azar en un punto a lo
  // largo de cada uno (más seguidos y fuertes cuanto más se sacude) los
  // hacen saltar, girar y rodar cada uno a su manera.
  _traqueteo(mag, dt) {
    const f = Math.min(1, (mag - UMBRAL) / 14);
    const prob = f * dt * 7;
    for (const c of this.mundo.cuerpos) {
      if (c.cinematico || Math.random() > prob) continue;
      const largo = c.medias[0] + c.radio;
      _p.set((Math.random() * 2 - 1) * largo * 0.9, -c.medias[1] - c.radio, 0)
        .applyQuaternion(_q.set(c.qx, c.qy, c.qz, c.qw));
      const v = 12 + 55 * f * Math.random(); // cm/s
      this.mundo.impulso(c, c.x + _p.x, c.y + _p.y, c.z + _p.z,
        (Math.random() - 0.5) * c.masa * v * 0.6, c.masa * v, (Math.random() - 0.5) * c.masa * v * 0.6);
    }
  }
}
