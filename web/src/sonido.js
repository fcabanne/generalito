// ─────────────────────────────────────────────────────────────
//  Sonido de los golpes, sintetizado con WebAudio (sin archivos).
//  · dado contra el piso: ruido filtrado grave y un "toc" de cuerpo;
//  · dado contra dado: un clic seco y agudo, con resonancia corta.
// ─────────────────────────────────────────────────────────────

export class Sonido {
  constructor() {
    this.ctx = null;
    this.activo = true;
    this.ultimo = new Map(); // id de dado → tiempo del último sonido
    this.voces = [];         // tiempos de las voces recientes (límite global)
  }

  // Los navegadores sólo dejan crear audio dentro de un gesto del usuario.
  desbloquear() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = this.activo ? 0.9 : 0;
    this.master.connect(comp).connect(ctx.destination);
    // ruido blanco reutilizable
    const n = Math.floor(ctx.sampleRate * 0.25);
    this.ruido = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.ruido.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  alternar() {
    this.activo = !this.activo;
    if (this.master) this.master.gain.setTargetAtTime(this.activo ? 0.9 : 0, this.ctx.currentTime, 0.02);
    return this.activo;
  }

  // v: velocidad del impacto (lados de dado por segundo); pan: −1..1
  golpe(id, v, contraDado, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.activo || ctx.state !== 'running') return;
    const vmin = contraDado ? 6 : 9;
    if (v < vmin) return;
    const t = ctx.currentTime;
    if (t - (this.ultimo.get(id) ?? -1) < 0.045) return;
    this.voces = this.voces.filter((x) => t - x < 0.06);
    if (this.voces.length >= 6) return;
    this.voces.push(t);
    this.ultimo.set(id, t);

    const fuerza = Math.min(1, (v - vmin) / 45);
    // con muchos golpes juntos (sacudida) cada uno suena más bajo
    const amp = (0.06 + 0.5 * fuerza ** 1.2) / Math.sqrt(1 + this.voces.length * 0.6);
    const salida = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (salida.pan) salida.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    salida.connect(this.master);

    const r = Math.random();
    // ruido filtrado: el "clac"
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.playbackRate.value = 0.9 + r * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = contraDado ? 3800 + r * 2200 : 1700 + r * 900;
    bp.Q.value = contraDado ? 2.2 : 0.9;
    const g = ctx.createGain();
    const dec = contraDado ? 0.035 : 0.05;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
    src.connect(bp).connect(g).connect(salida);
    src.start(t, Math.random() * 0.1, dec + 0.02);

    // resonancia tonal: plástico duro (agudo) o la mesa (grave)
    const os = ctx.createOscillator();
    os.type = 'sine';
    os.frequency.value = contraDado ? 2600 + r * 1800 : 190 + r * 90;
    const go = ctx.createGain();
    const ampO = contraDado ? amp * 0.22 : amp * 0.55;
    const decO = contraDado ? 0.05 : 0.035;
    go.gain.setValueAtTime(0, t);
    go.gain.linearRampToValueAtTime(ampO, t + 0.001);
    go.gain.exponentialRampToValueAtTime(0.0005, t + decO);
    os.connect(go).connect(salida);
    os.start(t);
    os.stop(t + decO + 0.02);
    os.onended = () => salida.disconnect();
  }
}
