// Sons du jeu : bruitages (fichiers chargés une fois dans WebAudio, lecture instantanée) et musiques (menu, arènes).
import { S } from './save.js';

let ctx = null, master = null;
const BUF = {};                   // nom → AudioBuffer
const last = {};                  // nom → dernier départ (évite qu'un même son se superpose cent fois)
let voices = 0;
const vol = () => (S.settings.sfx ? S.settings.volume : 0);

const NAMES = ['arrow', 'bite', 'buy', 'card_flip', 'card_fly', 'chest_land', 'chest_open', 'chest_shake', 'chest_thud', 'click', 'coins', 'crown', 'defeat', 'deploy', 'error',
  'fight_start', 'gems', 'heal', 'hit', 'hit2', 'hit3', 'hit4', 'hit_heavy', 'hit_heavy2', 'hit_heavy3', 'horn', 'ko', 'levelup', 'main_down', 'new_card', 'no_aura', 'overtime',
  'poison', 'rev_common', 'rev_epic', 'rev_legendary', 'rev_rare', 'rev_ultimate', 'reward', 'rock', 'shield', 'slam', 'splash', 'surge', 'swish', 'target', 'tick', 'tornado',
  'tower_down', 'tower_hit', 'unlock', 'upgrade', 'v_alligator', 'v_bulldog', 'v_eagle', 'v_elephant', 'v_gorilla', 'v_kitten', 'v_monkey', 'v_orang', 'v_pig', 'v_rhino',
  'victory', 'whistle', 'whoosh'];
// volume propre à chaque son (les autres : 1)
const GAIN = { click: 0.55, tick: 0.5, swish: 0.6, whoosh: 0.6, hit: 0.55, hit2: 0.55, hit3: 0.55, hit4: 0.55, arrow: 0.35, coins: 0.7, heal: 0.6, card_fly: 0.7, deploy: 0.75, tower_hit: 0.5, poison: 0.6, v_kitten: 0.8, v_monkey: 0.75 };
const MIN_GAP = { hit: 0.05, hit2: 0.05, hit3: 0.05, hit4: 0.05, arrow: 0.07, tower_hit: 0.09, coins: 0.06, heal: 0.15, tick: 0.03 };

function ensureCtx() {
  if (ctx) return ctx;
  try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination); } catch (e) { ctx = null; }
  return ctx;
}
export function unlock() {
  try {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (cur && cur.el.paused && wanted) cur.el.play().catch(() => {});
  } catch (e) { /* pas de son sur cet appareil */ }
}
addEventListener('pointerdown', unlock, { passive: true });
addEventListener('keydown', unlock, { passive: true });

// Charge tous les bruitages (≈ 1 Mo) : appelé pendant l'écran de chargement, sans bloquer le jeu
export function loadSfx() {
  if (!ensureCtx()) return Promise.resolve();
  return Promise.all(NAMES.map((n) => fetch('assets/audio/sfx/' + n + '.mp3').then((r) => r.arrayBuffer())
    .then((ab) => new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }))
    .then((buf) => { BUF[n] = buf; }).catch(() => {}))).then(() => {});
}

// Joue un bruitage. o : { v (volume), rate (vitesse/hauteur), at (délai en s), pan (-1 gauche … 1 droite) }
export function play(name, o = {}) {
  if (!ctx || !vol() || !BUF[name] || ctx.state !== 'running') return;
  const now = ctx.currentTime, gap = MIN_GAP[name] || 0.02;
  if (!o.at && last[name] && now - last[name] < gap) return;
  if (voices > 28) return;
  last[name] = now + (o.at || 0);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = BUF[name]; s.playbackRate.value = o.rate || 1;
  g.gain.value = (o.v === undefined ? 1 : o.v) * (GAIN[name] || 1) * vol();
  let out = g;
  if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); out = p; }
  s.connect(g); out.connect(master);
  voices++; s.onended = () => { voices--; };
  s.start(now + (o.at || 0));
}
const rnd = (a, b) => a + Math.random() * (b - a);

// Raccourcis utilisés par les menus et les fenêtres
export const sfx = {
  click() { play('click', { rate: rnd(0.97, 1.05) }); },
  back() { play('click', { rate: 0.82, v: 0.8 }); },
  error() { play('error'); },
  pick() { play('swish', { v: 0.6, rate: 1.2 }); },
  place() { play('deploy'); },
  whoosh() { play('whoosh', { v: 0.7 }); },
  coin(i = 0) { play('coins', { rate: 1 + (i % 4) * 0.05, v: 0.8 }); },
  gems() { play('gems'); },
  reward() { play('reward'); },
  buy() { play('buy'); },
  upgrade() { play('upgrade'); },
  levelup() { play('levelup'); },
  star(i = 0) { play('crown', { rate: 1 + i * 0.08 }); },
  win() { play('victory'); },
  lose() { play('defeat'); },
  flip() { play('card_flip'); },
  match() { play('surge', { v: 0.8 }); },
  count() { play('tick'); },
};

// ---------- musiques ----------
// Une seule piste à la fois, avec un fondu enchaîné : 'menu', 'fight1' … 'fight4', ou null pour le silence.
const tracks = {};
let cur = null, wanted = null, fadeRaf = 0;
const musicVol = () => Math.min(1, 0.42 * S.settings.volume / 0.7);
export function music(name) {
  wanted = S.settings.music ? name : null;
  if (cur && cur.name === wanted) { if (cur.el.paused) cur.el.play().catch(() => {}); return; }
  const old = cur;
  cur = null;
  if (wanted) {
    let el = tracks[wanted];
    if (!el) { el = tracks[wanted] = new Audio('assets/audio/' + wanted + '.mp3'); el.loop = true; el.preload = 'auto'; }
    try { el.currentTime = 0; } catch (e) { /* rien */ }
    el.volume = 0; el.play().catch(() => {});
    cur = { name: wanted, el };
  }
  cancelAnimationFrame(fadeRaf);
  const t0 = performance.now(), from = old ? old.el.volume : 0;
  const tick = (t) => {
    const k = Math.max(0, Math.min(1, (t - t0) / 700));     // le premier rAF peut dater d'avant t0
    if (old) { old.el.volume = from * (1 - k); if (k >= 1) old.el.pause(); }
    if (cur) cur.el.volume = musicVol() * k;
    if (k < 1) fadeRaf = requestAnimationFrame(tick);
  };
  fadeRaf = requestAnimationFrame(tick);
}
export const musicName = () => (cur ? cur.name : null);
export function musicVolume() { if (cur) cur.el.volume = musicVol(); }
// Coupe la musique quand le jeu passe en arrière-plan, la relance au retour
document.addEventListener('visibilitychange', () => { if (!cur) return; if (document.hidden) cur.el.pause(); else if (wanted) cur.el.play().catch(() => {}); });

// Joue un fichier son à part. a.ok : promesse vraie si la lecture a démarré, fausse si le navigateur l'a bloquée
export function playFile(src, v = 0.9) { if (!S.settings.sfx) return null; const a = new Audio(src); a.volume = Math.min(1, v * S.settings.volume / 0.7); a.ok = a.play().then(() => true, () => false); return a; }
