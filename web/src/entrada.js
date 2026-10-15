// ─────────────────────────────────────────────────────────────
//  Entrada: el dedo (o el mouse) y el acelerómetro.
//
//  · Pasar el dedo: cada dedo es un rayo desde la cámara que la física
//    sigue durante el frame; el dado que toca rueda o gira según la
//    dirección y la velocidad del trazo.
//  · Tocar un dado: salta y se vuelve a tirar en su lugar.
//  · Sacudir el celular: suave → los dados tiemblan y se re-tiran en su
//    celda; fuerte → se sueltan, chocan como en una caja y al calmarse
//    vuelven de un salto a la grilla, mezclados.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

// m/s² del celular → lados de dado/s² (un dado mide ~1,6 cm, pero un
// factor menor a 1/0,016 hace que se sienta pesado y controlable)
const ESCALA_ACEL = 34;
const UMBRAL_SUAVE = 3.2;   // m/s²
const UMBRAL_FUERTE = 13;   // m/s²
const TIEMPO_FUERTE = 0.16; // segundos acumulados de sacudida fuerte para soltar los dados
const CALMA = 0.45;         // segundos tranquilos para volver a la grilla
const ESPERA_AGARRE = 0.22; // segundos con el dedo quieto sobre un dado para levantarlo
const ALTURA_AGARRE = 2.1;  // a qué altura cuelga el punto agarrado

export class Entrada {
  constructor({ canvas, camara, mundo, celdas, sonido, programar, onPrimera, onCaos }) {
    this.programar = programar;
    this.canvas = canvas;
    this.camara = camara;
    this.mundo = mundo;
    this.celdas = celdas;   // función que devuelve las celdas actuales [[x, z]]
    this.sonido = sonido;
    this.onPrimera = onPrimera;
    this.onCaos = onCaos;
    this.punteros = new Map();
    this.ray = new THREE.Raycaster();
    this.v2 = new THREE.Vector2();

    // sacudida
    this.acel = new THREE.Vector3();   // última aceleración (m/s², mundo)
    this.acelT = 0;                    // cuándo llegó
    this.grav = null;                  // filtro pasa-bajos para quitar la gravedad
    this.fuerte = 0;
    this.caos = false;
    this.calma = 0;
    this.sensor = false;
    this.simulada = null;              // sacudida simulada (botón / tests)

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
    const p = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), recorrido: 0, quieto: 0, agarre: false };
    // ¿empezó sobre un dado? (para el agarre con el dedo quieto)
    const d = this._direccion(e.clientX, e.clientY, [0, 0, 0]);
    const o = this.camara.position;
    p.hit = this.mundo.rayo(o.x, o.y, o.z, d[0], d[1], d[2], 0.04);
    p.id = e.pointerId;
    this.punteros.set(e.pointerId, p);
    this.onPrimera?.();
  }

  _move(e) {
    const p = this.punteros.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const paso = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    p.recorrido += paso;
    if (!p.agarre && paso > 2) p.quieto = 0;
    p.x = e.clientX; p.y = e.clientY;
  }

  _up(e, cancelado = false) {
    const p = this.punteros.get(e.pointerId);
    if (!p) return;
    this.punteros.delete(e.pointerId);
    if (p.agarre) { this.mundo.soltarAgarre(e.pointerId); return; }
    const dur = performance.now() - p.t0;
    if (!cancelado && p.recorrido < 10 && dur < 350) this.tocar(e.clientX, e.clientY);
  }

  _direccion(x, y, out) {
    const r = this.canvas.getBoundingClientRect();
    this.v2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.v2, this.camara);
    out[0] = this.ray.ray.direction.x; out[1] = this.ray.ray.direction.y; out[2] = this.ray.ray.direction.z;
    return out;
  }

  // Toque: el dado salta y gira en su lugar.
  tocar(x, y) {
    const d = this._direccion(x, y, [0, 0, 0]);
    const o = this.camara.position;
    const hit = this.mundo.rayo(o.x, o.y, o.z, d[0], d[1], d[2], 0.08);
    if (!hit) return;
    this.mundo.saltar(hit.dado, 0.9 + Math.random() * 0.5, 16 + Math.random() * 10);
  }

  // ── acelerómetro ──
  // iOS pide permiso desde un gesto; Android no.
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
      // pasa-altos: restar la gravedad estimada con un pasa-bajos
      if (!this.grav) this.grav = [g.x, g.y, g.z];
      const k = 0.1;
      this.grav[0] += (g.x - this.grav[0]) * k;
      this.grav[1] += (g.y - this.grav[1]) * k;
      this.grav[2] += (g.z - this.grav[2]) * k;
      ax = g.x - this.grav[0]; ay = g.y - this.grav[1]; az = g.z - this.grav[2];
    }
    // ejes del dispositivo (x derecha, y arriba de la pantalla, z hacia la
    // cara) → mundo (x derecha, z hacia abajo de la pantalla, y hacia la cámara)
    this.acel.set(ax, az, -ay);
    this.acelT = performance.now();
    if (!this.sensor && this.acel.length() > 0.05) {
      this.sensor = true;
      this.onSensor?.();
    }
  }

  // Sacudida simulada: para el botón de escritorio y para los tests.
  simularSacudida(intensidad = 26, duracion = 0.9) {
    this.simulada = { t: 0, intensidad, duracion, fase: Math.random() * 6.28, dir: Math.random() * 6.28 };
  }

  // ── por frame ──
  actualizar(dt) {
    const m = this.mundo;
    // dedos → rayos para la física
    const dedos = [];
    const o = this.camara.position;
    for (const p of this.punteros.values()) {
      // dedo quieto sobre un dado un ratito → lo levanta
      p.quieto += dt;
      if (!p.agarre && p.hit && p.recorrido < 9 && p.quieto > ESPERA_AGARRE) {
        p.agarre = true;
        m.agarrar(p.id, p.hit.dado, p.hit.x, p.hit.y, p.hit.z);
        if (navigator.vibrate) navigator.vibrate(8);
      }
      const d1 = this._direccion(p.x, p.y, [0, 0, 0]);
      if (p.agarre) {
        // el punto agarrado sigue al dedo sobre un plano a media altura
        const t = (ALTURA_AGARRE - o.y) / d1[1];
        m.moverAgarre(p.id, o.x + d1[0] * t, ALTURA_AGARRE, o.z + d1[2] * t);
      } else {
        const d0 = this._direccion(p.px, p.py, [0, 0, 0]);
        dedos.push({ o: [o.x, o.y, o.z], d0, d1 });
      }
      p.px = p.x; p.py = p.y;
    }
    m.dedos = dedos;

    // aceleración de la caja
    let a = this.acel;
    if (this.simulada) {
      const s = this.simulada;
      s.t += dt;
      const env = Math.sin(Math.min(1, s.t / s.duracion) * Math.PI);
      const f = Math.sin(s.t * 2 * Math.PI * 5.2 + s.fase);
      a = new THREE.Vector3(
        Math.cos(s.dir) * f * s.intensidad * env,
        Math.sin(s.t * 2 * Math.PI * 3.1) * s.intensidad * 0.35 * env,
        Math.sin(s.dir) * f * s.intensidad * env,
      );
      if (s.t >= s.duracion) this.simulada = null;
    } else if (performance.now() - this.acelT > 200) {
      a = new THREE.Vector3(); // el sensor dejó de mandar datos
    }
    const mag = a.length();

    if (mag > UMBRAL_SUAVE) {
      // los dados sienten la aceleración de la caja al revés (inercia)
      const k = ESCALA_ACEL * Math.min(1, (mag - UMBRAL_SUAVE) / 4);
      m.aExt[0] = -a.x * k; m.aExt[1] = -a.y * k; m.aExt[2] = -a.z * k;
      m.despertarTodos();
      // saltitos al azar: más seguidos y más altos cuanto más fuerte
      const p = Math.min(1, (mag - UMBRAL_SUAVE) / 10) * dt * (this.caos ? 9 : 5);
      for (const d of m.dados) {
        if (Math.random() < p && d.y < 0.75) {
          const alto = this.caos ? 0.8 + Math.random() * Math.min(2.2, mag * 0.06) : 0.45 + Math.random() * 0.4;
          m.saltar(d, alto, 12 + Math.random() * (this.caos ? 26 : 14));
        }
      }
    } else {
      m.aExt[0] = m.aExt[1] = m.aExt[2] = 0;
    }

    // ¿sacudida fuerte sostenida? → caos
    if (mag > UMBRAL_FUERTE) this.fuerte += dt;
    else this.fuerte = Math.max(0, this.fuerte - dt * 0.6);
    if (!this.caos && this.fuerte > TIEMPO_FUERTE) {
      this.caos = true;
      for (const d of m.dados) d.resorte = 0;
      this.onCaos?.(true);
    }
    if (this.caos) {
      this.calma = mag < UMBRAL_SUAVE * 1.5 ? this.calma + dt : 0;
      if (this.calma > CALMA) this.reacomodar();
    }
  }

  // Vuelven a la grilla: cada dado a la celda libre más cercana, de un
  // salto, en cascada desde los que están más cerca.
  reacomodar() {
    const m = this.mundo;
    this.caos = false;
    this.calma = 0;
    this.fuerte = 0;
    m.reasignarCeldas(this.celdas());
    const orden = [...m.dados].sort((a, b) => Math.hypot(a.x - a.cx, a.z - a.cz) - Math.hypot(b.x - b.cx, b.z - b.cz));
    orden.forEach((d, i) => {
      d.resorte = 1;
      this.programar(() => {
        const lejos = Math.hypot(d.x - d.cx, d.z - d.cz);
        m.saltarA(d, d.cx, d.cz, 0.3 + Math.min(0.2, lejos * 0.05), 10 + Math.random() * 8);
      }, i * 0.009 + Math.random() * 0.04);
    });
    this.onCaos?.(false);
  }
}
