// ============================================================
//  Efeitos sonoros sintetizados (WebAudio, sem arquivos)
// ============================================================
'use strict';

const SFX = {
  ctx: null, master: null, enabled: true, last: {},
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.enabled = false; }
  },
  tone(freq, dur, type = 'square', vol = 0.3, slide = 0) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  },
  noise(dur, vol = 0.3, freq = 1200) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur);
  },
  play(name, vol = 1) {
    if (!this.enabled || !this.ctx || vol <= 0.02) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 35) return;
    this.last[name] = now;
    const v = vol;
    switch (name) {
      case 'shoot': this.tone(320, 0.09, 'square', 0.12 * v, 0.4); this.noise(0.06, 0.12 * v, 2500); break;
      case 'botshoot': this.tone(620, 0.1, 'sawtooth', 0.07 * v, 0.5); break;
      case 'boom': this.noise(0.6, 0.5 * v, 500); this.tone(90, 0.5, 'sine', 0.3 * v, 0.3); break;
      case 'shield': this.tone(900, 0.07, 'sine', 0.08 * v, 1.6); break;
      case 'hullhit': this.noise(0.15, 0.25 * v, 900); this.tone(140, 0.12, 'square', 0.1 * v, 0.6); break;
      case 'bothit': this.tone(260, 0.05, 'triangle', 0.1 * v, 0.7); break;
      case 'click': this.tone(1400, 0.03, 'square', 0.05 * v); break;
      case 'ding': this.tone(880, 0.12, 'sine', 0.12 * v); setTimeout(() => this.tone(1320, 0.15, 'sine', 0.1 * v), 70); break;
      case 'pop': this.tone(500, 0.06, 'triangle', 0.1 * v, 1.8); break;
      case 'collect': this.tone(660, 0.08, 'sine', 0.12 * v, 1.5); break;
      case 'place': this.tone(220, 0.05, 'square', 0.08 * v, 0.8); this.noise(0.04, 0.08 * v, 1800); break;
      case 'break': this.noise(0.12, 0.15 * v, 1400); break;
      case 'thud': this.noise(0.2, 0.3 * v, 300); break;
      case 'portal': this.tone(200, 0.8, 'sine', 0.25 * v, 4); this.tone(300, 0.8, 'triangle', 0.15 * v, 3); break;
      case 'load': this.tone(400, 0.05, 'square', 0.08 * v); setTimeout(() => this.tone(600, 0.05, 'square', 0.08 * v), 50); break;
      case 'jump': this.tone(300, 0.08, 'triangle', 0.05 * v, 1.6); break;
      case 'door': this.noise(0.35, 0.12 * v, 600); this.tone(180, 0.3, 'sine', 0.08 * v, 0.6); break;
      case 'laser': this.tone(1500, 0.07, 'sawtooth', 0.05 * v, 0.35); break;
      case 'drill': this.noise(0.12, 0.12 * v, 2200); this.tone(110, 0.1, 'sawtooth', 0.05 * v, 1.1); break;
      case 'error': this.tone(160, 0.15, 'square', 0.08 * v); break;
    }
  },
};
