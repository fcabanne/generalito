// ─────────────────────────────────────────────────────────────
//  Sonido de los golpes, sintetizado con WebAudio (sin archivos).
//  Cada material suena distinto:
//  · madera: "toc" seco con una resonancia media (lápices, pincel, regla);
//  · metal: "tin" brillante con parciales inarmónicos que duran un poco;
//  · goma: golpe sordo y corto;
//  · plástico: clic medio-agudo;
//  · contra el piso (papel sobre cartón): todo un poco más apagado.
// ─────────────────────────────────────────────────────────────

const TIMBRE = {
  madera: { ruido: [1500, 1.2, 0.03], tonos: [[780, 0.5, 0.045], [1960, 0.18, 0.025]], umbral: 14 },
  metal: { ruido: [5200, 2.5, 0.015], tonos: [[2650, 0.35, 0.16], [4310, 0.22, 0.11], [6890, 0.12, 0.07]], umbral: 12 },
  goma: { ruido: [520, 0.8, 0.035], tonos: [[190, 0.5, 0.04]], umbral: 22 },
  plastico: { ruido: [2900, 1.6, 0.025], tonos: [[1450, 0.3, 0.04]], umbral: 14 },
};

export class Sonido {
  constructor() {
    this.ctx = null;
    this.activo = true;
    this.ultimo = new Map();
    this.voces = [];
  }

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
    this.master.gain.value = this.activo ? 0.85 : 0;
    this.master.connect(comp).connect(ctx.destination);
    const n = Math.floor(ctx.sampleRate * 0.25);
    this.ruido = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.ruido.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  alternar() {
    this.activo = !this.activo;
    if (this.master) this.master.gain.setTargetAtTime(this.activo ? 0.85 : 0, this.ctx.currentTime, 0.02);
    return this.activo;
  }

  // v: velocidad del impacto (cm/s); contra: 'piso' | 'cuerpo'; pan: −1..1
  golpe(id, v, material, contra = 'piso', pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.activo || ctx.state !== 'running') return;
    const T = TIMBRE[material] || TIMBRE.madera;
    const umbral = contra === 'piso' ? T.umbral * 1.4 : T.umbral;
    if (v < umbral) return;
    const t = ctx.currentTime;
    if (t - (this.ultimo.get(id) ?? -1) < 0.05) return;
    this.voces = this.voces.filter((x) => t - x < 0.06);
    if (this.voces.length >= 6) return;
    this.voces.push(t);
    this.ultimo.set(id, t);

    const fuerza = Math.min(1, (v - umbral) / 220);
    const amp = (0.05 + 0.45 * fuerza ** 1.1) / Math.sqrt(1 + this.voces.length * 0.6);
    // contra el piso de papel suena más apagado y grave
    const apagado = contra === 'piso' ? 0.62 : 1;
    const salida = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (salida.pan) salida.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    salida.connect(this.master);

    const r = Math.random();
    const [fr, q, dec] = T.ruido;
    const src = ctx.createBufferSource();
    src.buffer = this.ruido;
    src.playbackRate.value = 0.9 + r * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fr * apagado * (0.85 + r * 0.3);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
    src.connect(bp).connect(g).connect(salida);
    src.start(t, Math.random() * 0.1, dec + 0.02);

    let fin = t + dec;
    for (const [f, a, d] of T.tonos) {
      const os = ctx.createOscillator();
      os.type = 'sine';
      os.frequency.value = f * apagado * (0.92 + r * 0.16);
      const go = ctx.createGain();
      const dd = d * (contra === 'piso' ? 0.6 : 1);
      go.gain.setValueAtTime(0, t);
      go.gain.linearRampToValueAtTime(amp * a, t + 0.001);
      go.gain.exponentialRampToValueAtTime(0.0005, t + dd);
      os.connect(go).connect(salida);
      os.start(t);
      os.stop(t + dd + 0.02);
      fin = Math.max(fin, t + dd + 0.02);
    }
    setTimeout(() => salida.disconnect(), (fin - t) * 1000 + 100);
  }
}
