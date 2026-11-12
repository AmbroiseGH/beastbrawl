// Sons du jeu : bruitages fabriqués par le navigateur (WebAudio), musique de combat et jingles en fichiers.
import { S } from './save.js';

let ctx = null, master = null, musicEl = null, musicWanted = false;
const vol = () => (S.settings.sfx ? S.settings.volume : 0);

export function unlock() {
  try {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    if (musicWanted && musicEl && musicEl.paused) musicEl.play().catch(() => {});
  } catch (e) { /* pas de son sur cet appareil */ }
}
addEventListener('pointerdown', unlock, { passive: true });

function tone({ f = 440, f2, t = 0.12, type = 'square', v = 0.2, at = 0, a = 0.005 }) {
  if (!ctx || !vol()) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(v * vol(), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + t + 0.03);
}
let noiseBuf = null;
function noise({ t = 0.15, v = 0.25, at = 0, f = 1200, q = 0.8, type = 'lowpass', f2 }) {
  if (!ctx || !vol()) return;
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter(), t0 = ctx.currentTime + at;
  s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + t); fl.Q.value = q;
  g.gain.setValueAtTime(v * vol(), t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t0, Math.random() * 0.5, t + 0.05);
}

let lastHit = 0;
export const sfx = {
  click() { tone({ f: 620, f2: 880, t: 0.06, type: 'triangle', v: 0.25 }); },
  back() { tone({ f: 520, f2: 320, t: 0.08, type: 'triangle', v: 0.22 }); },
  error() { tone({ f: 180, f2: 120, t: 0.16, type: 'sawtooth', v: 0.16 }); tone({ f: 150, f2: 100, t: 0.16, type: 'sawtooth', v: 0.16, at: 0.1 }); },
  place() { noise({ t: 0.12, v: 0.3, f: 500, f2: 180 }); tone({ f: 220, f2: 140, t: 0.1, type: 'sine', v: 0.35 }); },
  pick() { tone({ f: 500, f2: 760, t: 0.07, type: 'sine', v: 0.25 }); },
  hit(big) {
    const now = performance.now(); if (now - lastHit < 45) return; lastHit = now;
    noise({ t: big ? 0.16 : 0.08, v: big ? 0.4 : 0.22, f: big ? 900 : 1600, f2: 300 });
    tone({ f: big ? 160 : 240, f2: 70, t: big ? 0.16 : 0.08, type: 'sine', v: big ? 0.5 : 0.28 });
  },
  crit() { noise({ t: 0.2, v: 0.4, f: 2400, f2: 400 }); tone({ f: 880, f2: 220, t: 0.18, type: 'square', v: 0.16 }); },
  special() { tone({ f: 300, f2: 900, t: 0.16, type: 'sawtooth', v: 0.14 }); noise({ t: 0.2, v: 0.2, f: 600, f2: 2600, type: 'bandpass', q: 1.5 }); },
  roll() { noise({ t: 0.4, v: 0.45, f: 300, f2: 90 }); tone({ f: 90, f2: 45, t: 0.4, type: 'sine', v: 0.6 }); },
  whoosh() { noise({ t: 0.18, v: 0.16, f: 500, f2: 3000, type: 'bandpass', q: 1.2 }); },
  dodge() { noise({ t: 0.14, v: 0.15, f: 2500, f2: 800, type: 'bandpass', q: 2 }); },
  death(mine) { noise({ t: 0.3, v: 0.35, f: 700, f2: 120 }); tone({ f: mine ? 330 : 520, f2: mine ? 110 : 180, t: 0.3, type: 'triangle', v: 0.3 }); },
  coin(i = 0) { tone({ f: 1320 + i * 60, t: 0.07, type: 'square', v: 0.1 }); tone({ f: 1760 + i * 60, t: 0.12, type: 'square', v: 0.1, at: 0.05 }); },
  star(i = 0) { [0, 4, 7, 12].forEach((s, k) => tone({ f: 523 * Math.pow(2, (s + i * 2) / 12), t: 0.22, type: 'triangle', v: 0.26, at: k * 0.045 })); noise({ t: 0.25, v: 0.12, f: 5000, type: 'highpass' }); },
  count(n) { tone({ f: n > 0 ? 440 : 880, t: n > 0 ? 0.14 : 0.4, type: 'square', v: 0.2 }); tone({ f: n > 0 ? 220 : 440, t: n > 0 ? 0.14 : 0.4, type: 'triangle', v: 0.3 }); },
  fury() { tone({ f: 110, f2: 330, t: 0.6, type: 'sawtooth', v: 0.2 }); noise({ t: 0.6, v: 0.25, f: 300, f2: 2500 }); },
  win() { [0, 4, 7, 12, 7, 12, 16].forEach((s, k) => tone({ f: 392 * Math.pow(2, s / 12), t: 0.3, type: 'square', v: 0.14, at: k * 0.11 })); [0, 4, 7].forEach((s) => tone({ f: 196 * Math.pow(2, s / 12), t: 1.1, type: 'triangle', v: 0.2, at: 0.75 })); },
  lose() { [0, -2, -4, -7].forEach((s, k) => tone({ f: 330 * Math.pow(2, s / 12), t: 0.4, type: 'triangle', v: 0.22, at: k * 0.2 })); },
  upgrade() { [0, 5, 7, 12, 17, 19, 24].forEach((s, k) => tone({ f: 440 * Math.pow(2, s / 12), t: 0.16, type: 'square', v: 0.12, at: k * 0.05 })); noise({ t: 0.5, v: 0.14, f: 6000, type: 'highpass', at: 0.2 }); },
  buy() { sfx.coin(0); sfx.coin(2); tone({ f: 660, f2: 1320, t: 0.3, type: 'triangle', v: 0.25, at: 0.12 }); },
  reward() { [0, 7, 12].forEach((s, k) => tone({ f: 660 * Math.pow(2, s / 12), t: 0.2, type: 'triangle', v: 0.22, at: k * 0.07 })); },
  flip() { noise({ t: 0.1, v: 0.2, f: 3000, f2: 900, type: 'bandpass', q: 1 }); },
  match() { tone({ f: 330, f2: 660, t: 0.25, type: 'sawtooth', v: 0.14 }); tone({ f: 660, f2: 990, t: 0.3, type: 'square', v: 0.1, at: 0.2 }); },
};

// Musique de combat (fichier). Elle démarre au premier toucher si le navigateur bloque le son.
export function music(on) {
  musicWanted = on && S.settings.music;
  if (!musicEl) { musicEl = new Audio('assets/audio/music_battle.mp3'); musicEl.loop = true; musicEl.preload = 'none'; }
  musicEl.volume = Math.min(1, 0.4 * S.settings.volume / 0.7);
  if (musicWanted) musicEl.play().catch(() => {}); else { musicEl.pause(); }
}
export function musicRestart() { if (musicEl) { try { musicEl.currentTime = 0; } catch (e) { /* rien */ } } }
export function playFile(src, v = 0.9) { if (!S.settings.sfx) return null; const a = new Audio(src); a.volume = Math.min(1, v * S.settings.volume / 0.7); a.play().catch(() => {}); return a; }
