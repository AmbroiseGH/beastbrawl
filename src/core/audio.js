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
  'victory', 'whistle', 'whoosh',
  // l'eau, les nageurs, les catapultes et leur singe
  'river', 'splash_in', 'bubbles', 'bubble_pop', 'water_spit', 'wave', 'dolphin_jump', 'tentacle', 'whirlpool', 'v_octo', 'v_dolphin', 'v_clownfish',
  'cata_creak', 'cata_launch', 'cata_roll', 'cata_break', 'cata_ready', 'hammer', 'v_tuto',
  // Barnabé selon ce qu'il ressent, la boîte dorée et son singe
  'v_barn_happy', 'v_barn_think', 'v_barn_scared', 'v_barn_cheer', 'gold_appear', 'gold_break', 'gold_heal', 'v_goldmonkey'];
// volume propre à chaque son (les autres : 1)
const GAIN = { click: 0.55, tick: 0.5, swish: 0.6, whoosh: 0.6, hit: 0.55, hit2: 0.55, hit3: 0.55, hit4: 0.55, arrow: 0.35, coins: 0.7, heal: 0.6, card_fly: 0.7, deploy: 0.75, tower_hit: 0.5, poison: 0.6, v_kitten: 0.8, v_monkey: 0.75,
  bubble_pop: 0.7, bubbles: 0.7, tentacle: 0.8, cata_roll: 0.7, hammer: 0.6, v_tuto: 0.8, v_clownfish: 0.8,
  v_barn_happy: 0.7, v_barn_think: 0.7, v_barn_scared: 0.7, v_barn_cheer: 0.7, gold_appear: 0.8, gold_break: 0.85, gold_heal: 0.6, v_goldmonkey: 0.55 };
const MIN_GAP = { gold_heal: 0.12, v_goldmonkey: 0.6, hit: 0.05, hit2: 0.05, hit3: 0.05, hit4: 0.05, arrow: 0.07, tower_hit: 0.09, coins: 0.06, heal: 0.15, tick: 0.03, bubble_pop: 0.06, bubbles: 0.12, tentacle: 0.07, water_spit: 0.08, splash: 0.06, cata_roll: 0.5 };

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

// Charge un son dans WebAudio sous le nom « name ». Renvoie vrai s'il est prêt.
export function loadSound(name, url) {
  if (BUF[name]) return Promise.resolve(true);
  if (!ensureCtx()) return Promise.resolve(false);
  return fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((ab) => new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }))
    .then((buf) => { BUF[name] = buf; return true; }).catch(() => false);
}
// Charge tous les bruitages (≈ 1 Mo) : appelé pendant l'écran de chargement, sans bloquer le jeu
export function loadSfx() {
  if (!ensureCtx()) return Promise.resolve();
  return Promise.all(NAMES.map((n) => loadSound(n, 'assets/audio/sfx/' + n + '.mp3'))).then(() => {});
}
// Le navigateur laisse-t-il jouer du son tout de suite ? (sinon il faut un premier toucher)
export const soundAllowed = () => !!ensureCtx() && ctx.state === 'running';
// Attend que le son soit débloqué (après unlock), au plus « ms » millisecondes
export function soundReady(ms = 400) {
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === 'running') return Promise.resolve(true);
  return Promise.race([ctx.resume().then(() => ctx.state === 'running', () => false), new Promise((r) => setTimeout(() => r(ctx.state === 'running'), ms))]);
}
// Durée d'un son chargé, en secondes (0 s'il manque)
export const soundLength = (name) => (BUF[name] ? BUF[name].duration : 0);

// Joue un bruitage. o : { v (volume), rate (vitesse/hauteur), at (délai en s), pan (-1 gauche … 1 droite) }
// force : part même si le son n'est pas encore débloqué (dans le toucher qui le débloque, iPhone compris). Renvoie vrai si le son part.
export function play(name, o = {}) {
  if (!ctx || !vol() || !BUF[name] || (ctx.state !== 'running' && !o.force)) return false;
  const now = ctx.currentTime, gap = MIN_GAP[name] || 0.02;
  if (!o.at && last[name] && now - last[name] < gap) return false;
  if (voices > 28) return false;
  last[name] = now + (o.at || 0);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = BUF[name]; s.playbackRate.value = o.rate || 1;
  g.gain.value = (o.v === undefined ? 1 : o.v) * (GAIN[name] || 1) * vol();
  let out = g;
  if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); out = p; }
  s.connect(g); out.connect(master);
  voices++; s.onended = () => { voices--; };
  s.start(now + (o.at || 0));
  return true;
}

// Joue un son calé sur l'horloge du son (pour y accrocher une animation) : renvoie l'instant, sur cette horloge, où il
// commence (dans « lead » secondes), ou -1 s'il ne peut pas partir (son coupé ou bloqué par le navigateur).
export function playSync(name, lead = 0.06, v = 1) {
  if (!ctx || !vol() || !BUF[name] || ctx.state !== 'running') return -1;
  const at = ctx.currentTime + lead, s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = BUF[name]; g.gain.value = v * (GAIN[name] || 1) * vol();
  s.connect(g); g.connect(master); voices++; s.onended = () => { voices--; };
  s.start(at); last[name] = at;
  return at;
}
// L'instant de l'horloge du son que l'on entend en ce moment : le retard de la sortie (haut-parleur du téléphone, casque
// Bluetooth…) est retiré, pour que l'image tombe pile avec ce qu'on entend.
export function heardTime() {
  if (!ctx) return -1;
  if (ctx.getOutputTimestamp) {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
  }
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}
// Une horloge (en secondes) qui suit un son lancé par playSync à l'instant « at » ; sans son (at < 0), le temps réel.
// Si l'horloge du son s'arrête (onglet en arrière-plan…), on repasse sur le temps réel pour ne rien bloquer.
export function syncClock(at) {
  const p0 = performance.now();
  if (at < 0 || !ctx) return () => (performance.now() - p0) / 1000;
  let lastA = -1, lastP = p0, off = null;
  return () => {
    const now = performance.now(), a = heardTime() - at;
    if (off !== null) return (now - p0) / 1000 - off;
    if (a !== lastA) { lastA = a; lastP = now; } else if (now - lastP > 400) off = (now - p0) / 1000 - a;   // l'horloge du son est figée
    return a;
  };
}

// Un son qui tourne en boucle (le murmure de la rivière pendant un combat). Renvoie { set(v), stop() } ou null.
// Les fichiers de boucle portent une marge de 100 ms de chaque côté (copie de l'autre bout) : on boucle entre les marges,
// ce qui reste sans couture même si le décodeur MP3 du navigateur décale un peu le son. LOOPS : durée de la boucle (s).
const LOOPS = { river: 8 };
export function ambience(name, v = 0.5) {
  if (!ctx || !BUF[name]) return null;
  const s = ctx.createBufferSource(), g = ctx.createGain(), len = LOOPS[name];
  s.buffer = BUF[name]; s.loop = true; g.gain.value = 0;
  if (len && s.buffer.duration >= len + 0.15) { s.loopStart = 0.1; s.loopEnd = 0.1 + len; }
  s.connect(g); g.connect(master);
  try { s.start(0, len ? 0.1 : 0); } catch (e) { return null; }
  let k = v, alive = true;
  const level = () => k * (GAIN[name] || 1) * vol();
  g.gain.setTargetAtTime(level(), ctx.currentTime, 0.6);
  return {
    set(nv) { if (!alive) return; k = nv; g.gain.setTargetAtTime(level(), ctx.currentTime, 0.4); },
    stop() { if (!alive) return; alive = false; g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); try { s.stop(ctx.currentTime + 1.5); } catch (e) { /* déjà arrêté */ } },
  };
}

// Petit tintement de l'XP (synthétisé : lame de glockenspiel). step : 0, 1, 2… chaque pas monte d'une note de la gamme
// pentatonique, pour que la jauge « monte » à l'oreille. o.v : volume, o.at : délai (s).
const PENTA = [0, 2, 4, 7, 9];
export function chime(step = 0, o = {}) {
  if (!ctx || !vol() || ctx.state !== 'running' || voices > 28) return;
  const st = Math.max(0, Math.round(step)), semi = 12 * Math.floor(st / 5) + PENTA[st % 5];
  const f = 783.99 * Math.pow(2, Math.min(semi, 24) / 12);           // départ : sol5, deux octaves au plus
  const t = ctx.currentTime + (o.at || 0), v = (o.v === undefined ? 1 : o.v) * 0.22 * vol();
  const out = ctx.createGain(); out.gain.value = v; out.connect(master);
  // la lame : fondamentale + partiel inharmonique (2,76) qui s'éteint vite + petit éclat de frappe
  [[1, 1, 0.9], [2.756, 0.45, 0.16], [5.404, 0.18, 0.06]].forEach(([m, a, d]) => {
    const os = ctx.createOscillator(), g = ctx.createGain();
    os.type = 'sine'; os.frequency.value = f * m;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
    os.connect(g); g.connect(out); os.start(t); os.stop(t + d + 0.05);
  });
  voices++; setTimeout(() => { voices--; out.disconnect(); }, (o.at || 0) * 1000 + 1100);
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
// Pendant un toucher : la piste « name » est lancée en muet puis arrêtée. Sur iPhone, elle pourra ensuite démarrer
// toute seule (la musique du menu arrive après le jingle, sans attendre un autre toucher).
export function primeMusic(name) {
  if (!S.settings.music || (cur && cur.name === name)) return;
  let el = tracks[name];
  if (!el) { el = tracks[name] = new Audio('assets/audio/' + name + '.mp3'); el.loop = true; el.preload = 'auto'; }
  el.muted = true;
  const p = el.play();
  const done = () => { if (!cur || cur.el !== el) el.pause(); el.muted = false; };
  if (p && p.then) p.then(done, () => { el.muted = false; }); else done();
}
export function musicVolume() { if (cur) cur.el.volume = musicVol(); }
// Coupe la musique quand le jeu passe en arrière-plan, la relance au retour
document.addEventListener('visibilitychange', () => { if (!cur) return; if (document.hidden) cur.el.pause(); else if (wanted) cur.el.play().catch(() => {}); });

// Joue un fichier son à part. a.ok : promesse vraie si la lecture a démarré, fausse si le navigateur l'a bloquée
export function playFile(src, v = 0.9) { if (!S.settings.sfx) return null; const a = new Audio(src); a.volume = Math.min(1, v * S.settings.volume / 0.7); a.ok = a.play().then(() => true, () => false); return a; }
