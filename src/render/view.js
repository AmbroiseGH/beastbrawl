// Affichage du combat sur un canvas : l'arène verticale, vue en entier (on peut zoomer et la faire glisser), les
// structures (camps, catapultes et Barnabé qui les pousse, tours et leurs singes, boîtes), les dresseurs, les animaux animés
// (les nageurs dans la rivière), projectiles, effets, et l'habillage (vie des camps, mini-carte, bouton de la catapulte,
// barre du bas : Aura, cartes, Siffler, Attaquer). Ne décide de rien : il dessine l'état du moteur (src/game/rt.js) et
// ce que battle.js lui passe.
import { IMG, DATA } from '../core/assets.js';
import { clamp, rand } from '../core/utils.js';
import { handOf, nextOf, deployZones, DEPLOY_DELAY, TILE, WS, CATA, goldAir } from '../game/rt.js';
import { ANIMALS } from '../data/animals.js';
import { MAP_W, MAP_H, MAP_K, PROPS, GW, GH, BRIDGES } from '../data/map.js';
import { GRID, swimHome } from '../game/nav.js';
import { MapFx } from './mapfx.js';

export const W = 941, H = 1672;
const HK = 941 / 1024, HUD_Y = 1426;           // barre du bas : maquette de 1024 px de large, posée en bas de l'écran
export const FH = HUD_Y;                       // au-dessus de cette ligne : l'arène
const hx = (x) => x * HK, hy = (y) => HUD_Y + y * HK;
// Zones de l'habillage (pixels de scène)
export const HUD = {
  whistle: [26, 1458, 151, 133], attack: [763, 1458, 152, 133],
  slots: [[196, 1442, 126, 147], [336, 1442, 125, 147], [478, 1442, 125, 147], [619, 1442, 125, 147]],
  next: [14, 1338, 66, 90], gauge: [12, 86, 917, 64], mini: [14, 162, 120, 180], cata: [W - 142, 1290, 128, 116],
};
// Caméra : zoom en pixels de scène par pixel de carte. Au plus loin, toute l'arène tient à l'écran (comme sur un téléphone
// en hauteur) ; on peut zoomer pour voir de près, puis faire glisser.
export const ZOOM = { min: 0.94, max: 1.9, start: 0.94 };
export const VY = 713;                         // hauteur de l'écran où tombe le centre de la caméra
const CAM_TOP = 0;                             // le haut de la carte peut descendre jusque-là
const DIR8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const TINTS = { white: null, yellow: '#ffe14a', orange: '#ff9a2e', red: '#ff5a4a', green: '#8dff5a', blue: '#7fd4ff', grey: '#d9dde6', pink: '#ff8ad8' };
const fonts = {};
export const AIR_LIFT = 53;                    // hauteur de vol des animaux volants (pixels de leur planche)

// ---------- police bitmap (titres) ----------
function tintFont(name) {
  if (fonts[name]) return fonts[name];
  const src = IMG.font; if (!src || !src.width) return null;
  if (!TINTS[name]) return (fonts[name] = src);
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = TINTS[name]; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(src, 0, 0);
  return (fonts[name] = c);
}
// La police dessinée n'a que les lettres sans accent (sauf É), les chiffres : les lettres accentuées prennent leur
// lettre de base, la ponctuation (! ? : …) est écrite avec la police du jeu, de la même couleur.
const BASE = (ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const glyph = (F, ch) => F.g[ch] || F.g[BASE(ch)] || null;
const TINT = { white: '#ffffff', yellow: '#ffd23f', orange: '#ff9a2e', green: '#7be04a', pink: '#ff8af0', red: '#ff5a4a', blue: '#8fdcff', purple: '#d58cff' };
const puncW = (ch, size) => (ch === ' ' ? size * 0.38 : size * (ch === '!' || ch === ':' || ch === '.' || ch === ',' || ch === "'" ? 0.3 : 0.5));
function textWidth(str, size) {
  const F = DATA.font, k = size / F.cap; let w = 0;
  for (const ch of str) { const g = glyph(F, ch); w += g ? (g[2] - 10) * k : puncW(ch, size); }
  return w;
}
export function drawText(ctx, str, cx, cy, size, tint = 'white', alpha = 1) {
  const F = DATA.font, img = tintFont(tint); if (!F || !img) return;
  str = String(str).toUpperCase();
  const k = size / F.cap; let x = cx - textWidth(str, size) / 2;
  ctx.globalAlpha = alpha;
  for (const ch of str) {
    const g = glyph(F, ch);
    if (!g) {
      const w = puncW(ch, size);
      if (ch !== ' ') { label(ctx, ch, x + w / 2, cy, size * 1.05, TINT[tint] || '#fff', 'center', 0.22); ctx.globalAlpha = alpha; }
      x += w; continue;
    }
    ctx.drawImage(img, g[0], g[1], g[2], g[3], x - 5 * k, cy + size / 2 + g[4] * k, g[2] * k, g[3] * k);
    x += (g[2] - 10) * k;
  }
  ctx.globalAlpha = 1;
}
export function textCanvas(str, size, tint = 'white') {
  str = String(str).toUpperCase();
  const w = Math.ceil(textWidth(str, size) + size * 0.5), hgt = Math.ceil(size * 1.75);
  const c = document.createElement('canvas'); c.width = w * 2; c.height = hgt * 2; c.style.width = w + 'px'; c.style.height = hgt + 'px';
  const g = c.getContext('2d'); g.scale(2, 2); drawText(g, str, w / 2, hgt * 0.56, size, tint);
  return c;
}
// Texte vectoriel avec contour (police du jeu) : petits textes nets à toutes les tailles
export function label(c, str, x, y, size, color = '#fff', align = 'center', stroke = 0.2) {
  c.font = `${size}px "Lilita One",sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = Math.max(3, size * stroke); c.strokeStyle = '#1a1008';
  c.strokeText(str, x, y + size * 0.06); c.fillStyle = color; c.fillText(str, x, y);
}
export function rr(c, x, y, w, hgt, r) { r = Math.min(r, w / 2, hgt / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hgt, r); c.arcTo(x + w, y + hgt, x, y + hgt, r); c.arcTo(x, y + hgt, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// Image n° i de l'animation « anim » d'un animal (atlas de assets/units), les pieds en (x, y). Gère les animations en miroir.
// L'atlas est plus grand que l'affichage (d.k) pour rester net sur les écrans denses. rot : penché autour des pieds.
export function drawUnitFrame(c, key, anim, i, x, y, s = 1, alpha = 1, sx = 1, sy = 1, rot = 0) {
  const d = DATA[key], img = IMG[key]; if (!d || !img || !img.width) return null;
  let list = d.anims[anim], flip = false;
  if (!list && d.flip[anim]) { list = d.anims[d.flip[anim]]; flip = true; }
  if (!list) return null;
  const f = d.frames[list[((i % list.length) + list.length) % list.length]];
  s *= d.k || 1;
  c.globalAlpha = alpha;
  if (flip || rot) { c.save(); c.translate(x, y); if (rot) c.rotate(rot); if (flip) c.scale(-1, 1); c.drawImage(img, f[0], f[1], f[2], f[3], -f[4] * s * sx, -f[5] * s * sy, f[2] * s * sx, f[3] * s * sy); c.restore(); }
  else c.drawImage(img, f[0], f[1], f[2], f[3], x - f[4] * s * sx, y - f[5] * s * sy, f[2] * s * sx, f[3] * s * sy);
  c.globalAlpha = 1;
  return list.length;
}
export const animLen = (key, anim) => { const d = DATA[key]; if (!d) return 1; const l = d.anims[anim] || d.anims[d.flip[anim]]; return l ? l.length : 1; };

// Ombre douce et anneaux de camp, dessinés une fois dans de petites images puis étirés sous chaque animal
const SPR = {};
function sprites() {
  if (SPR.shadow) return SPR;
  const mk = (w, hgt, fn) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt; fn(cv.getContext('2d')); return cv; };
  SPR.shadow = mk(128, 64, (g) => {
    g.scale(1, 0.5);
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 63);
    gr.addColorStop(0, 'rgba(14,8,24,.66)'); gr.addColorStop(0.45, 'rgba(14,8,24,.42)'); gr.addColorStop(0.8, 'rgba(14,8,24,.12)'); gr.addColorStop(1, 'rgba(14,8,24,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const ring = (rgb, lite) => mk(192, 96, (g) => {
    g.scale(1, 0.5);
    const gr = g.createRadialGradient(96, 96, 2, 96, 96, 95);
    gr.addColorStop(0, `rgba(${rgb},.10)`); gr.addColorStop(0.62, `rgba(${rgb},.20)`); gr.addColorStop(0.76, `rgba(${rgb},.55)`);
    gr.addColorStop(0.83, `rgba(${lite},.95)`); gr.addColorStop(0.9, `rgba(${rgb},.6)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 192, 192);
  });
  SPR.ring0 = ring('40,170,255', '190,235,255'); SPR.ring1 = ring('255,70,50', '255,200,180');
  SPR.glow = mk(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  return SPR;
}
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const DROP_T = 0.22, DROP_H = 260;            // un animal posé tombe du ciel en DROP_T secondes

const ellipse = (c, x, y, rx, ry) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.3); };
const TEAM = ['#39a9ff', '#ff5a4a'], TEAM_LITE = ['#bfe6ff', '#ffd0c4'];
const AMBIENT = [null, '#fff0dc', '#e4f6dc', null, '#dbe9ff', '#ffd9cb'];      // teinte de l'air selon l'arène
// le milieu de chaque tente (fumée, flammes), la hauteur de la barre de vie, et où se tient chaque dresseur (sur le sable,
// à côté de sa tente, du côté opposé à sa catapulte)
const TENT_MID = [{ x: 512, y: 1300 }, { x: 512, y: 150 }], CAMP_BAR = [1396, 170], TRAINER = [{ x: 594, y: 1232 }, { x: 430, y: 302 }];
// les tours : centre de la cage et de son anneau (le singe libéré s'y tient), bas de la tour (ordre d'affichage)
const TOWER = { L: 81, R: 943, ring: 688, base: 884, bar: 552 };
const dir4 = (dx, dy) => (Math.abs(dx) > Math.abs(dy) * 1.1 ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'));
const CANFILTER = (() => { try { return typeof document !== 'undefined' && 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();
const campPct = (cp) => Math.ceil(100 * Math.max(0, cp.hp) / cp.maxHp - 1e-6);       // vie d'un camp en %, arrondie vers le haut (1 % tant qu'il tient)
const ROCK = [[0, 1], [0.8, 0.86], [1.5, 1.04], [2.3, 0.9], [3.1, 1], [3.9, 0.84], [4.7, 1.02], [5.5, 0.9]];      // contour du rocher (angle, rayon)
// taille de dessin de la catapulte, de Barnabé qui la pousse et des dresseurs (pixels de leur planche → pixels de la carte)
const CATA_S = 0.9, BARN_S = 0.8, TRAIN_S = 0.85;
const DQ = 1.7;                                // gouttes et étincelles : taille et vitesse (écrites à l'échelle de l'ancienne carte)
// Les tabliers des ponts : les nageurs passent dessous. Pour chacun : le contour et sa boîte.
const DECKS = Object.values(BRIDGES).map((b) => {
  const P = b.poly, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  return { P, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
});
const SINK_D = 46;                             // un nageur commence à plonger à cette distance d'un pont
function inPoly(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
  return inside;
}
function deckDist(D, x, y) {
  if (x < D.x0 - SINK_D || x > D.x1 + SINK_D || y < D.y0 - SINK_D || y > D.y1 + SINK_D) return 999;
  if (inPoly(D.P, x, y)) return 0;
  let m = 999;
  for (let i = 0, j = D.P.length - 1; i < D.P.length; j = i++) {
    const [ax, ay] = D.P[j], [bx, by] = D.P[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? clamp(((x - ax) * dx + (y - ay) * dy) / l, 0, 1) : 0;
    m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return m;
}
// le bord avant d'un tablier (le plus bas à l'écran) à l'abscisse x : un nageur plus bas que ça nage devant le pont
function deckFront(D, x) {
  x = clamp(x, D.x0 + 0.5, D.x1 - 0.5); let f = D.y0;
  for (let i = 0, j = D.P.length - 1; i < D.P.length; j = i++) { const [xi, yi] = D.P[i], [xj, yj] = D.P[j]; if ((xi > x) !== (xj > x)) f = Math.max(f, yi + (yj - yi) * (x - xi) / (xj - xi)); }
  return f;
}
// à quel point un nageur en (x, y) a plongé : 0 en surface, 1 tout entier sous l'eau (sous un pont)
export function sinkAt(x, y) { let d = 999; for (const D of DECKS) d = Math.min(d, deckDist(D, x, y)); const k = clamp(1 - d / SINK_D, 0, 1); return k * k * (3 - 2 * k); }
const nearDeck = (x, y, m) => DECKS.some((D) => x > D.x0 - m && x < D.x1 + m && y > D.y0 - m && y < D.y1 + m);

export class View {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.k = 1;
    this.parts = []; this.texts = []; this.decals = []; this.dots = []; this.vis = new Map(); this.svis = new Map();
    this.shake = 0; this.time = 0; this.flash = 0; this.flashColor = '255,255,255'; this.banners = [];
    this.hand = [{}, {}, {}, {}]; this.auraN = -1; this.mapfx = new MapFx(); this.zoneCv = {};
    this.cam = { x: MAP_W / 2, y: MAP_H, z: ZOOM.min }; this.camT = null; this.cpulse = [0, 0]; this.chp = null; this.pings = []; this.ripples = [];
    this.tr = [{ anim: 'idle', t: 0, left: 0 }, { anim: 'idle', t: 0, left: 0 }];
  }
  // le dresseur d'un camp réagit : 'cheer' (ordre d'attaque, victoire), 'worry' (repli, coup dur), 'angry' (son camp est frappé)
  trainerAct(side, anim, dur = 1.5) { const T = this.tr[side]; if (!T) return; if (T.anim !== anim) T.t = 0; T.anim = anim; T.left = Math.max(T.left, dur); }
  // ronds dans l'eau (nageurs, plongeons)
  ripple(x, y, r = 10, life = 0.9, a = 0.55) { this.ripples.push({ x, y, r, life, a, age: 0 }); if (this.ripples.length > 60) this.ripples.shift(); }
  resize(scale) {
    const k = clamp(scale * (window.devicePixelRatio || 1), 0.5, 1.35);
    if (Math.abs(k - this.k) < 0.02 && this.cv.width > 300) return;
    this.k = k; this.cv.width = Math.round(W * k); this.cv.height = Math.round(H * k);
  }
  reset(arena) {
    this.parts.length = 0; this.texts.length = 0; this.decals.length = 0; this.dots.length = 0; this.vis.clear(); this.svis.clear(); this.shake = 0; this.flash = 0; this.banners.length = 0;
    this.arena = arena; this.hand = [{}, {}, {}, {}]; this.auraN = -1; this.mapfx.reset(); this.cpulse = [0, 0]; this.chp = null;
    this.cam = this.clampCam({ x: MAP_W / 2, y: MAP_H, z: ZOOM.min }); this.camT = null; this.pings = []; this.ripples = [];
    this.tr = [{ anim: 'idle', t: 0, left: 0 }, { anim: 'idle', t: 0, left: 0 }];
  }
  // signal sur la mini-carte (tour prise, boîte cassée, animal tombé hors de l'écran)
  ping(x, y, col = '#fff') { this.pings.push({ x, y, col, age: 0 }); if (this.pings.length > 8) this.pings.shift(); }

  // ---------- caméra ----------
  clampCam(cam) {
    cam.z = clamp(cam.z, ZOOM.min, ZOOM.max);
    const hw = W / 2 / cam.z;
    cam.x = hw * 2 >= MAP_W ? MAP_W / 2 : clamp(cam.x, hw, MAP_W - hw);
    const lo = (VY - CAM_TOP) / cam.z, hi = MAP_H - (HUD_Y - VY) / cam.z;
    cam.y = lo >= hi ? (lo + hi) / 2 : clamp(cam.y, lo, hi);
    return cam;
  }
  worldAt(sx, sy) { const c = this.cam; return { x: (sx - W / 2) / c.z + c.x, y: (sy - VY) / c.z + c.y }; }
  screenOf(x, y) { const c = this.cam; return { x: (x - c.x) * c.z + W / 2, y: (y - c.y) * c.z + VY }; }
  // le doigt fait glisser la carte (dx, dy en pixels de scène)
  panBy(dx, dy) { this.camT = null; this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z; this.clampCam(this.cam); }
  // zoom autour d'un point de l'écran (deux doigts, molette)
  zoomAt(sx, sy, f) {
    this.camT = null; const c = this.cam, w = this.worldAt(sx, sy);
    c.z = clamp(c.z * f, ZOOM.min, ZOOM.max); c.x = w.x - (sx - W / 2) / c.z; c.y = w.y - (sy - VY) / c.z; this.clampCam(c);
  }
  // la caméra glisse vers un point (mini-carte, début du combat)
  lookAt(x, y, z, fast) { this.camT = this.clampCam({ x, y, z: z || this.cam.z }); this.camT.k = fast ? 9 : 3.2; }
  stepCam(dt) {
    const t = this.camT; if (!t) return;
    const c = this.cam, k = 1 - Math.exp(-dt * t.k);
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
    if (Math.abs(t.x - c.x) < 0.5 && Math.abs(t.y - c.y) < 0.5 && Math.abs(t.z - c.z) < 0.004) { c.x = t.x; c.y = t.y; c.z = t.z; this.camT = null; }
  }
  onScreen(x, y, m = 40) { const R = this.R; return !R || (x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m); }

  // ---------- particules et textes ----------
  // Les effets posés sur la carte sont en pixels de la carte ; leurs tailles et vitesses restent écrites à l'échelle
  // des planches d'animaux (comme avant) et sont converties ici. top : effet posé sur l'écran (habillage).
  fx(key, x, y, o = {}) {
    if (!DATA.fx || !DATA.fx[key]) return;
    const ws = o.top ? 1 : WS;
    this.parts.push({ key, x, y, vx: (o.vx || 0) * ws, vy: (o.vy || 0) * ws, g: (o.g || 0) * ws, age: -(o.delay || 0), life: o.life || 0.4, s0: (o.s0 !== undefined ? o.s0 : 0.6) * ws, s1: (o.s1 !== undefined ? o.s1 : 1) * ws, rot: o.rot || 0, vr: o.vr || 0, a: o.a !== undefined ? o.a : 1, add: !!o.add, flat: o.flat || 1, fade: o.fade !== undefined ? o.fade : 0.45, top: !!o.top });
    if (this.parts.length > 300) this.parts.shift();
  }
  burst(key, x, y, n, o = {}) {
    for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 80, o.sp1 || 260); this.fx(key, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g !== undefined ? o.g : 500, life: rand(0.35, 0.7) * (o.life || 1), s0: (o.s || 0.3) * rand(0.7, 1.2), s1: (o.s || 0.3) * rand(0.4, 0.8), rot: rand(0, 6), vr: rand(-6, 6), delay: o.delay || 0, add: o.add, top: o.top }); }
  }
  // petite goutte ou étincelle ronde (eau, liquide des jauges, fruits) : x, y, vitesses en pixels de la carte
  dot(x, y, o = {}) { this.dots.push({ x, y, vx: (o.vx || 0) * DQ, vy: (o.vy || 0) * DQ, g: (o.g || 0) * DQ, age: -(o.delay || 0), life: o.life || 0.5, r: (o.r || 2) * DQ, col: o.col || '120,200,255', add: !!o.add, tx: o.tx, ty: o.ty }); if (this.dots.length > 420) this.dots.shift(); }
  decal(key, x, y, life = 6, s = 1) { this.decals.push({ key, x, y, age: 0, life, s }); if (this.decals.length > 18) this.decals.shift(); }
  text(str, x, y, o = {}) { this.texts.push({ str: String(str), x, y, vy: (o.vy !== undefined ? o.vy : -90) * WS, vx: (o.vx || 0) * WS, age: 0, life: o.life || 0.8, size: o.size || 34, tint: o.tint || 'white', pop: o.pop !== undefined ? o.pop : 1 }); if (this.texts.length > 34) this.texts.shift(); }
  banner(str, o = {}) { this.banners.push({ str, age: -(o.delay || 0), life: o.life || 1.4, size: o.size || 120, tint: o.tint || 'yellow', y: o.y || 640, img: o.img || null, s: o.s || 0.8 }); }
  drawFx(key, x, y, s = 1, rot = 0, alpha = 1, flat = 1) {
    const r = DATA.fx && DATA.fx[key]; if (!r) return;
    const c = this.ctx; c.globalAlpha = alpha;
    if (rot || flat !== 1) { c.save(); c.translate(x, y); if (flat !== 1) c.scale(1, flat); if (rot) c.rotate(rot); c.drawImage(IMG.fx, r[0], r[1], r[2], r[3], -r[2] * s / 2, -r[3] * s / 2, r[2] * s, r[3] * s); c.restore(); } else c.drawImage(IMG.fx, r[0], r[1], r[2], r[3], x - r[2] * s / 2, y - r[3] * s / 2, r[2] * s, r[3] * s);
    c.globalAlpha = 1;
  }
  stepParts(dt, top) {
    const c = this.ctx;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; if (p.top !== top) continue;
      p.age += dt; if (p.age < 0) continue;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t)), al = p.a * (t < 1 - p.fade ? 1 : (1 - t) / p.fade);
      if (p.add) c.globalCompositeOperation = 'lighter';
      this.drawFx(p.key, p.x, p.y, s, p.rot, al, p.flat);
      if (p.add) c.globalCompositeOperation = 'source-over';
    }
  }
  stepDots(dt) {
    const c = this.ctx;
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const p = this.dots[i]; p.age += dt; if (p.age < 0) continue;
      if (p.age >= p.life) { this.dots.splice(i, 1); continue; }
      const t = p.age / p.life;
      if (p.tx !== undefined) { const k = Math.min(1, dt * 7); p.vx += (p.tx - p.x) * k * 6 * dt * 30; p.vy += (p.ty - p.y) * k * 6 * dt * 30; p.vx *= 0.9; p.vy *= 0.9; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = t > 0.7 ? (1 - t) / 0.3 : 1, r = p.r * (1 - 0.3 * t);
      if (p.add) c.globalCompositeOperation = 'lighter';
      c.fillStyle = `rgba(${p.col},${0.9 * a})`; c.beginPath(); c.arc(p.x, p.y, r, 0, 6.3); c.fill();
      c.fillStyle = `rgba(255,255,255,${0.7 * a})`; c.beginPath(); c.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.35, 0, 6.3); c.fill();
      if (p.add) c.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- une image complète ----------
  // b : le combat (rt.js) ; ui : { alpha, drag, sel, opp, hint, zone, mode, picked, aim, hover }
  // ui.frozen : le combat est figé (le tutoriel explique) ; tout s'arrête, sauf la caméra, les bandeaux et l'habillage
  draw(dt, b, ui) {
    const c = this.ctx, k = this.k, rdt = dt;
    if (ui.frozen) dt = 0;
    this.time += dt; this.rtime = (this.rtime || 0) + rdt;
    this.stepCam(rdt);
    const cam = this.cam, z = cam.z;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = '#17102a'; c.fillRect(0, 0, W, H);
    let shx = 0, shy = 0;
    if (this.shake > 0.3) { shx = rand(-1, 1) * this.shake; shy = rand(-1, 1) * this.shake; this.shake *= Math.pow(0.002, rdt); } else this.shake = 0;
    c.setTransform(k * z, 0, 0, k * z, k * (W / 2 - cam.x * z + shx), k * (VY - cam.y * z + shy));
    const R = this.R = { x0: cam.x - W / 2 / z, x1: cam.x + W / 2 / z, y0: cam.y - VY / z, y1: cam.y + (H - VY) / z };
    this.drawMap(R);
    this.mapfx.ground(c, R, dt);
    if (ui.zone) this.drawZones(b, ui.zoneSwim);
    this.drawRipples(dt);
    if (ui.mode) { c.fillStyle = 'rgba(12,8,34,.34)'; c.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); }
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.age += dt; if (d.age >= d.life) { this.decals.splice(i, 1); continue; } this.drawFx(d.key, d.x, d.y, d.s * WS, 0, Math.min(1, (d.life - d.age) / 1.2) * 0.8, 0.62); }
    for (const cl of b.clouds) this.drawCloud(cl);
    this.drawMarks(b, ui);
    // structures et animaux, du fond vers l'avant (les animaux volants passent par-dessus)
    const a = ui.alpha, list = [];
    for (const u of b.units) { const y = u.py + (u.y - u.py) * a; list.push({ y: y + (u.air ? 3000 : 0), u }); }
    for (const s of b.crates) list.push({ y: s.y + 16, s });
    for (const t of b.towers) list.push({ y: TOWER.base, s: t });
    for (const cp of b.catas) { const m = this.monkeyAt(cp, dt); list.push({ y: cp.y, cata: cp }, { y: m.y + 0.5, monkey: cp }); }
    list.push({ y: 2000, tent: 1 });
    for (const cp of b.camps) list.push({ y: cp.side === 0 ? 2001 : 130, camp: cp });      // l'éclat de la tente bleue passe par-dessus son image
    for (const s of [0, 1]) list.push({ y: TRAINER[s].y, trainer: s });
    const G = b.gold;
    if (G && G.box && !G.box.dead) list.push({ y: G.box.y + 4, gold: G.box });
    if (G) for (const m of G.monkeys) if (!m.gone) list.push({ y: m.py + (m.y - m.py) * a + (goldAir(m) ? 60 : 0), gm: m });
    list.sort((p, q) => p.y - q.y);
    for (const it of list) {
      if (it.u) this.drawUnit(it.u, dt, a, b, ui); else if (it.tent) this.prop('tentB'); else if (it.camp) this.drawCamp(it.camp, dt, b);
      else if (it.cata) this.drawCata(it.cata, dt, b, ui); else if (it.monkey) this.drawMonkey(it.monkey, b); else if (it.trainer !== undefined) this.drawTrainer(it.trainer, dt, b);
      else if (it.gold) this.drawGoldBox(it.gold, dt, ui); else if (it.gm) this.drawGoldMonkey(it.gm, dt, a);
      else this.drawStruct(it.s, dt, b, ui);
    }
    for (const s of b.structs) this.drawStructBar(s, b, ui);
    for (const it of list) if (it.u) this.drawUnitBar(it.u, ui);
    for (const p of b.projs) this.drawProj(p);
    this.stepDots(dt);
    this.stepParts(dt, false);
    this.mapfx.sky(c, R, dt);
    const tint = AMBIENT[this.arena];
    if (tint) { c.globalCompositeOperation = 'multiply'; c.fillStyle = tint; c.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); c.globalCompositeOperation = 'source-over'; }
    this.drawOverhead(b, ui);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.age += dt; if (t.age >= t.life) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt; t.x += t.vx * dt; t.vy *= Math.pow(0.12, dt);
      const q = t.age / t.life, pop = q < 0.15 ? 0.6 + (q / 0.15) * 0.75 * t.pop : 1 + 0.35 * t.pop * Math.max(0, 1 - (q - 0.15) / 0.2);
      drawText(c, t.str, t.x, t.y, t.size * pop * WS, t.tint, q > 0.7 ? (1 - q) / 0.3 : 1);
    }
    if (ui.aim) this.drawAim(b, ui);
    if (ui.drag && ui.drag.onField) this.drawGhost(ui.drag);
    // ---------- habillage, en pixels de scène ----------
    c.setTransform(k, 0, 0, k, 0, 0);
    { const g = c.createLinearGradient(0, 0, 0, 240); g.addColorStop(0, 'rgba(10,6,26,.55)'); g.addColorStop(1, 'rgba(10,6,26,0)'); c.fillStyle = g; c.fillRect(0, 0, W, 240); }
    if (this.flash > 0.01) { c.fillStyle = `rgba(${this.flashColor},${this.flash})`; c.fillRect(0, 0, W, HUD_Y); this.flash *= Math.pow(0.002, rdt); }
    this.drawTop(b, ui, dt);
    this.drawMini(b, ui);
    this.drawHud(b, ui);
    this.stepParts(rdt, true);
    this.drawBanners(rdt);
    if (ui.drag && !ui.drag.onField && ui.drag.moved) this.drawDragCard(ui.drag);
  }

  drawMap(R) {
    const c = this.ctx, im = IMG.map;
    const x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0)), x1 = Math.min(MAP_W, Math.ceil(R.x1)), y1 = Math.min(MAP_H, Math.ceil(R.y1));
    if (!im || !im.width) { c.fillStyle = '#3d6b2a'; c.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
    c.imageSmoothingQuality = 'medium';
    c.drawImage(im, x0 * MAP_K, y0 * MAP_K, (x1 - x0) * MAP_K, (y1 - y0) * MAP_K, x0, y0, x1 - x0, y1 - y0);
  }
  // Un élément détouré de la carte (boîte, cage, tour, tente), à sa place d'origine (+ décalage), agrandi autour de son pied
  prop(name, dx = 0, dy = 0, alpha = 1, sc = 1, add = false) {
    const p = PROPS[name], im = IMG.props, c = this.ctx; if (!p || !im || !im.width) return;
    const w = p[2] / MAP_K, h = p[3] / MAP_K, x = p[4] + dx, y = p[5] + dy;
    c.globalAlpha = alpha; if (add) c.globalCompositeOperation = 'lighter';
    if (sc !== 1) c.drawImage(im, p[0], p[1], p[2], p[3], x + w / 2 - w * sc / 2, y + h - h * sc, w * sc, h * sc);
    else c.drawImage(im, p[0], p[1], p[2], p[3], x, y, w, h);
    c.globalAlpha = 1; if (add) c.globalCompositeOperation = 'source-over';
  }
  // Là où l'on peut poser une carte : en clair, le reste du sol rougit. swim : un nageur (l'eau du camp)
  drawZones(b, swim = false) {
    const zs = deployZones(b, 0), key = swim ? 'swim' : zs.join(',');
    let z = this.zoneCv[key];
    if (!z) {      // deux petites images à la taille de la grille : la zone (bleue, le reste assombri) et son bord (lumineux)
      const mk = () => { const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH; return cv; };
      const fill = mk(), edge = mk(), g = fill.getContext('2d'), ge = edge.getContext('2d'), id = g.createImageData(GW, GH), ie = ge.createImageData(GW, GH), d = id.data, de = ie.data;
      const ok = swim ? (i) => swimHome(0, (i % GW + 0.5) * 8, (Math.floor(i / GW) + 0.5) * 8) : (i) => zs.includes(GRID[i]);
      for (let i = 0; i < GW * GH; i++) {
        const v = GRID[i], o = i * 4, x = i % GW;
        if (ok(i)) {
          d[o] = 70; d[o + 1] = 175; d[o + 2] = 255; d[o + 3] = 92;
          if ((x > 0 && !ok(i - 1)) || (x < GW - 1 && !ok(i + 1)) || (i >= GW && !ok(i - GW)) || (i < GW * (GH - 1) && !ok(i + GW))) { de[o] = 200; de[o + 1] = 240; de[o + 2] = 255; de[o + 3] = 255; }
        } else if (v > 0 && v < 8) { d[o] = 18; d[o + 1] = 8; d[o + 2] = 36; d[o + 3] = 96; }
      }
      g.putImageData(id, 0, 0); ge.putImageData(ie, 0, 0);
      z = this.zoneCv[key] = { fill, edge };
    }
    const c = this.ctx, t = this.rtime; c.imageSmoothingEnabled = true;          // elle palpite même quand le combat est figé (tutoriel)
    c.globalAlpha = 0.85 + 0.15 * Math.sin(t * 5); c.drawImage(z.fill, 0, 0, MAP_W, MAP_H);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55 + 0.3 * Math.sin(t * 5); c.drawImage(z.edge, 0, 0, MAP_W, MAP_H);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  drawCloud(cl) {
    const c = this.ctx, life = clamp(cl.t / 0.6, 0, 1) * clamp((cl.T - cl.t) / 0.3, 0, 1);
    const g = c.createRadialGradient(cl.x, cl.y, 2, cl.x, cl.y, cl.r);
    g.addColorStop(0, `rgba(150,255,60,${0.46 * life})`); g.addColorStop(0.7, `rgba(90,200,30,${0.3 * life})`); g.addColorStop(1, 'rgba(60,160,20,0)');
    c.save(); c.translate(cl.x, cl.y); c.scale(1, 0.66); c.translate(-cl.x, -cl.y); c.fillStyle = g; c.fillRect(cl.x - cl.r, cl.y - cl.r, cl.r * 2, cl.r * 2); c.restore();
    for (let i = 0; i < 4; i++) { const an = this.time * 0.8 + i * 1.57 + cl.x, rr2 = cl.r * (0.35 + 0.15 * Math.sin(this.time * 1.7 + i)); c.fillStyle = `rgba(190,255,90,${0.2 * life})`; ellipse(c, cl.x + Math.cos(an) * rr2, cl.y + Math.sin(an) * rr2 * 0.6 - 6, cl.r * 0.34, cl.r * 0.22); c.fill(); }
    if (Math.random() < 0.2) this.fx(Math.random() < 0.35 ? 'skull_green' : 'smoke1', cl.x + rand(-cl.r * 0.7, cl.r * 0.7), cl.y + rand(-cl.r * 0.4, cl.r * 0.3), { s0: 0.08, s1: 0.2, life: 0.9, vy: -40, a: 0.65 * life, fade: 0.6 });
  }

  // ronds dans l'eau : ils s'élargissent et s'effacent
  drawRipples(dt) {
    const c = this.ctx;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]; r.age += dt; if (r.age >= r.life) { this.ripples.splice(i, 1); continue; }
      const q = r.age / r.life, rad = r.r * (0.45 + 1.1 * q), under = nearDeck(r.x, r.y, rad + 4);
      if (under) { c.save(); this.clipDecks(); }
      c.lineWidth = 2.6 * (1 - q) + 0.6; c.strokeStyle = `rgba(235,250,255,${r.a * (1 - q)})`; ellipse(c, r.x, r.y, rad, rad * 0.42); c.stroke();
      if (under) c.restore();
    }
  }
  // Ce qui est sous un pont ne se voit pas : on ne dessine plus sur les tabliers (x, y : un nageur, qu'on voit
  // par-dessus un pont quand il nage devant lui, plus bas à l'écran). Sans point : tous les tabliers proches.
  clipDecks(x, y) {
    const c = this.ctx, R = this.R; let any = false;
    for (const D of DECKS) {
      if (x !== undefined && (x < D.x0 - 70 || x > D.x1 + 70 || y < D.y0 - 12 || y > deckFront(D, x) + 3)) continue;
      if (!any) { any = true; c.beginPath(); c.rect(R.x0 - 60, R.y0 - 60, R.x1 - R.x0 + 120, R.y1 - R.y0 + 120); }
      D.P.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath();
    }
    if (any) c.clip('evenodd');
  }

  // ---------- ordres : anneaux au sol, lignes vers les cibles ----------
  ring(x, y, rx, ry, col, lw, dash, spin = 0) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(1, ry / rx); if (spin) c.rotate(spin);
    c.lineWidth = lw; c.strokeStyle = col; if (dash) c.setLineDash(dash);
    c.beginPath(); c.arc(0, 0, rx, 0, 6.3); c.stroke(); c.restore();
  }
  orderTarget(b, u) {
    const o = u.order; if (!o) return null;
    if (o.ref) { const e = b.ents.get(o.ref); return e && !e.dead ? { x: e.kind === 'unit' ? e.x : e.aimX, y: e.kind === 'unit' ? e.y : e.aimY, kind: 'atk', e } : null; }
    if (o.home) return u.homeAt ? { x: u.homeAt.x, y: u.homeAt.y, kind: 'home' } : null;
    return { x: o.x, y: o.y, kind: 'go' };
  }
  drawMarks(b, ui) {
    const c = this.ctx, t = this.time, mode = ui.mode, picked = ui.picked, pulse = 0.5 + 0.5 * Math.sin(t * 7);
    if (mode) {
      // tout ce qu'on peut viser s'allume : la cible, les tours qui ne sont pas à nous, les boîtes, les animaux adverses
      for (const s of b.structs) {
        if (s.dead || s.side === 0) continue;
        this.ring(s.x, s.kind === 'tower' ? TOWER.base - 14 : s.y + (s.kind === 'crate' ? 6 : s.kind === 'camp' ? 30 : 2), s.rx * (s.kind === 'tower' ? 0.95 : s.kind === 'cata' ? 1.25 : 1.05) + 3 * pulse, (s.kind === 'tower' ? 26 : s.ry * 0.9) + 2 * pulse, `rgba(255,214,60,${0.65 + 0.3 * pulse})`, 3.2, [9, 6], t * 1.2);
      }
      for (const u of b.units) {
        if (u.dead || u.spawn > 0 || (this.vis.get(u.id) || {}).sunk) continue;
        if (u.side === 1) this.ring(u.x, u.y + 2, u.r * 1.55 + 2 * pulse, (u.r * 1.55 + 2 * pulse) * 0.5, `rgba(255,70,50,${0.7 + 0.3 * pulse})`, 2.6, [7, 5], -t * 2);
        else if (!picked.has(u.id)) this.ring(u.x, u.y + 2, u.r * 1.5, u.r * 0.75, `rgba(140,215,255,${0.45 + 0.3 * pulse})`, 2.2);
      }
    }
    // ordres en cours de nos animaux : un trait vers leur but
    for (const u of b.units) {
      if (u.dead || u.side !== 0 || !(mode || picked.has(u.id))) continue;
      const g = this.orderTarget(b, u); if (!g) continue;
      const col = g.kind === 'atk' ? '255,90,70' : g.kind === 'home' ? '120,235,140' : '130,205,255';
      const on = picked.has(u.id), al = on ? 0.95 : 0.5;
      c.save(); c.setLineDash([7, 6]); c.lineDashOffset = -t * 26; c.lineCap = 'round';
      if (on) { c.lineWidth = 5; c.strokeStyle = 'rgba(26,16,8,.55)'; c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(g.x, g.y); c.stroke(); }
      c.lineWidth = on ? 2.8 : 2; c.strokeStyle = `rgba(${col},${al})`; c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(g.x, g.y); c.stroke(); c.restore();
      if (g.kind !== 'atk') this.ring(g.x, g.y, 9 + 2 * pulse, 4.5 + pulse, `rgba(${col},.9)`, 2.2);
      else if (on) {      // la cible visée : un anneau rouge qui tourne
        const e = g.e, rx = e.kind === 'unit' ? e.r * 1.7 : e.kind === 'tower' ? 74 : e.kind === 'cata' ? 66 : e.rx * 1.05, ry = e.kind === 'unit' ? e.r * 0.85 : e.kind === 'tower' ? 22 : e.kind === 'cata' ? 26 : e.ry * 0.9;
        const gx = e.x, gy = e.kind === 'unit' ? e.y + 2 : e.kind === 'tower' ? TOWER.base - 14 : e.kind === 'cata' ? e.y + 2 : e.y + 6;
        this.ring(gx, gy, rx + 2 * pulse, ry + pulse, 'rgba(26,16,8,.6)', 5, [10, 7], t * 1.5);
        this.ring(gx, gy, rx + 2 * pulse, ry + pulse, `rgba(255,80,60,${0.75 + 0.25 * pulse})`, 2.8, [10, 7], t * 1.5);
      }
    }
    for (const u of b.units) {
      if (u.dead || !picked.has(u.id) || (this.vis.get(u.id) || {}).sunk) continue;
      const r = u.r * 1.7 + 2.5 * pulse;
      c.fillStyle = 'rgba(255,240,150,.22)'; ellipse(c, u.x, u.y + 2, r, r * 0.5); c.fill();
      this.ring(u.x, u.y + 2, r, r * 0.5, '#1a1008', 5); this.ring(u.x, u.y + 2, r, r * 0.5, '#fff27a', 2.8);
    }
  }
  // Par-dessus les animaux : chevron sur ceux qu'on a choisis, viseur sur la cible survolée
  drawOverhead(b, ui) {
    const c = this.ctx, t = this.time, bob = Math.sin(t * 6) * 2.5;
    for (const u of b.units) {
      if (u.dead || !ui.picked.has(u.id)) continue;
      const v = this.vis.get(u.id); if (!v || v.top === undefined || v.sunk) continue;
      const y = v.top - 9 + bob;
      c.fillStyle = '#1a1008'; c.beginPath(); c.moveTo(u.x - 7, y - 8); c.lineTo(u.x + 7, y - 8); c.lineTo(u.x, y + 2); c.closePath(); c.fill();
      c.fillStyle = '#fff27a'; c.beginPath(); c.moveTo(u.x - 4.6, y - 6.6); c.lineTo(u.x + 4.6, y - 6.6); c.lineTo(u.x, y - 0.4); c.closePath(); c.fill();
    }
    const h = ui.hover ? b.ents.get(ui.hover) : null;
    if (h && !h.dead) {
      const img = IMG.ic_target, top = h.kind === 'unit' ? ((this.vis.get(h.id) || {}).top || h.y - 70) - 12 : h.kind === 'tower' ? TOWER.bar - 30 : h.kind === 'cata' ? h.y - 128 : h.y - 60;
      const s = 30 + 4 * Math.sin(t * 9);
      if (img && img.width) c.drawImage(img, h.x - s / 2, top - s / 2 + bob, s, s);
    }
  }
  // Flèche d'un ordre qu'on est en train de tracer : de chaque animal choisi vers le doigt (ou la cible accrochée)
  drawAim(b, ui) {
    const c = this.ctx, A = ui.aim, e = A.ent ? b.ents.get(A.ent) : null, tx = e ? e.x : A.x, ty = e ? e.y : A.y, col = e ? '#ff5a4a' : '#7fd4ff';
    for (const id of A.ids) {
      const u = b.ents.get(id); if (!u || u.dead) continue;
      const dx = tx - u.x, dy = ty - u.y, l = Math.hypot(dx, dy); if (l < 12) continue;
      const ux = dx / l, uy = dy / l, ex = tx - ux * 6, ey = ty - uy * 6, mx = (u.x + ex) / 2, my = (u.y + ey) / 2 - Math.min(30, l * 0.16);
      for (const [lw, st] of [[7, '#1a1008'], [3.6, col]]) {
        c.lineWidth = lw; c.strokeStyle = st; c.lineCap = 'round'; c.beginPath(); c.moveTo(u.x, u.y - 4); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
        const an = Math.atan2(ey - my, ex - mx); c.fillStyle = st; c.beginPath(); const hs = lw > 5 ? 11 : 8;
        c.moveTo(ex + Math.cos(an) * hs, ey + Math.sin(an) * hs); c.lineTo(ex + Math.cos(an + 2.5) * hs, ey + Math.sin(an + 2.5) * hs); c.lineTo(ex + Math.cos(an - 2.5) * hs, ey + Math.sin(an - 2.5) * hs); c.closePath(); c.fill();
      }
      c.lineCap = 'butt';
    }
    if (!e) this.ring(tx, ty, 11, 5.5, '#1a1008', 4.5), this.ring(tx, ty, 11, 5.5, col, 2.4);
  }

  // ---------- structures ----------
  drawStruct(s, dt, b, ui) {
    const c = this.ctx; let v = this.svis.get(s.id);
    if (!v) { v = { hp: s.hp, flash: 0, side: s.side, pop: 1, throwT: 9, dead: s.dead, age: 9, dir: 'S' }; this.svis.set(s.id, v); }
    if (s.hp < v.hp) v.flash = 1;
    v.hp = s.hp; v.flash = Math.max(0, v.flash - dt * 6); v.age += dt; v.throwT += dt;
    const jx = v.flash > 0.4 ? rand(-1.2, 1.2) : 0, glow = ui.mode && !(s.kind === 'tower' && s.side === 0) ? 0.16 + 0.12 * Math.sin(this.time * 7) : 0;
    if (s.kind === 'crate') {
      if (v.dead !== s.dead) { v.dead = s.dead; v.age = 0; }
      if (s.dead) return;
      const name = 'crate' + s.n, k = Math.min(1, v.age / 0.28), sc = v.age < 0.28 ? 0.5 + 0.62 * k - 0.12 * Math.sin(k * Math.PI) : 1 + 0.03 * v.flash;
      c.fillStyle = 'rgba(14,8,24,.3)'; ellipse(c, s.x + 2, s.y + 14, 31, 8); c.fill();
      this.prop(name, jx, 0, 1, sc);
      if (v.flash > 0.02 || glow) this.prop(name, jx, 0, Math.min(1, v.flash * 0.5 + glow), sc, true);
      return;
    }
    // tour latérale : le corps, puis la cage (tant qu'elle n'est à personne) ou le singe libéré derrière sa rambarde
    const L = s.lane, cx = TOWER[L], m = L === 'L' ? 1 : -1;
    this.prop('tower' + L);
    if (s.side >= 0) {      // la bannière blanche prend la couleur du camp
      c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = s.side === 0 ? '#63b4ff' : '#ff7868';
      c.beginPath(); c.moveTo(cx - 30 * m, 732); c.lineTo(cx + 30 * m, 732); c.lineTo(cx + 30 * m, 812); c.lineTo(cx, 838); c.lineTo(cx - 30 * m, 812); c.closePath(); c.fill(); c.restore();
    }
    if (v.side !== s.side) { v.side = s.side; v.pop = 0; }
    v.pop = Math.min(1, v.pop + dt * 2.2);
    if (s.side < 0) {
      this.prop('cage' + L, jx, v.flash > 0.4 ? rand(-0.8, 0.8) : 0);
      if (v.flash > 0.02 || glow) this.prop('cage' + L, jx, 0, Math.min(1, v.flash * 0.45 + glow), 1, true);
    } else {
      // le singe lanceur (aux couleurs du camp) : le caillou au-dessus de la tête, il le lance, puis se remet en garde
      const tg = s.target ? b.ents.get(s.target) : null, key = 'towermonkey' + s.side;
      if (tg && v.throwT < 0.9) v.dir = dir4(tg.x - s.x, tg.y - s.topY);
      else if (v.throwT > 2.5) v.dir = 'S';
      const hop = v.pop < 1 ? Math.sin(v.pop * Math.PI) * 16 : Math.abs(Math.sin(this.time * 2.4 + cx)) * 1.2;
      const thr = v.throwT < 0.55, fr = thr ? Math.min(7, 4 + Math.floor(v.throwT / 0.55 * 4)) : 0;
      c.fillStyle = TEAM[s.side]; c.globalAlpha = 0.55; ellipse(c, cx, TOWER.ring + 1, 46, 11); c.fill(); c.globalAlpha = 1;
      drawUnitFrame(c, key, 'throw_' + v.dir, fr, cx, TOWER.ring + 6 - hop, 0.78, 1, 1, thr ? 1 : 1 + 0.012 * Math.sin(this.time * 2.6 + cx));
      this.prop('rail' + L);
      if (glow) this.prop('tower' + L, 0, 0, glow, 1, true);
    }
  }
  // La tente encaisse : éclat sous les coups, fumée sous la moitié de sa vie, flammes sous le quart
  drawCamp(cp, dt) {
    const s = cp.side; let v = this.svis.get(cp.id);
    if (!v) { v = { hp: cp.hp, flash: 0, smoke: 0 }; this.svis.set(cp.id, v); }
    if (cp.hp < v.hp) v.flash = 1;
    v.hp = cp.hp; v.flash = Math.max(0, v.flash - dt * 5);
    if (s === 0 && v.flash > 0.02) this.prop('tentB', 0, 0, v.flash * 0.4, 1, true);
    const r = Math.max(0, cp.hp) / cp.maxHp, M = TENT_MID[s];
    if (r < 0.5) {
      v.smoke -= dt;
      if (v.smoke <= 0) {
        v.smoke = cp.dead ? 0.07 : r < 0.25 ? 0.16 : 0.32;
        this.fx(Math.random() < 0.5 ? 'smoke1' : 'smoke2', M.x + rand(-70, 70), M.y + rand(-20, 10), { s0: 0.18, s1: 0.55, life: 1.5, vy: -45, vx: rand(-10, 10), a: 0.65, fade: 0.7 });
        if (r < 0.25) this.fx('fire2', M.x + rand(-70, 70), M.y + rand(-10, 20), { s0: 0.2, s1: 0.48, life: 0.8, vy: -30, a: 0.95 });
      }
    }
  }
  // ---------- les catapultes ----------
  cataVis(cp) {
    let v = this.svis.get(cp.id);
    if (!v) { v = { hp: cp.hp, flash: 0, roll: 0, px: cp.x, py: cp.y, mx: 0, my: 0, mdir: 'S', mwalk: 0, mset: false, smoke: 0, spark: 0, dead: cp.dead, fixT: 9 }; this.svis.set(cp.id, v); }
    return v;
  }
  // Barnabé (sprite « tutomonkey ») : derrière la catapulte quand il la pousse, à côté d'elle sinon (il y va à pied). Renvoie sa position.
  monkeyAt(cp, dt) {
    const v = this.cataVis(cp), s = cp.side === 0 ? 1 : -1;
    let tx, ty;
    if (cp.moving) { tx = cp.x - cp.fx * 44; ty = cp.y - cp.fy * 24 + 5; }
    else if (cp.dead) { tx = cp.x + 50 * s; ty = cp.y + 8; }
    else { tx = cp.x + 58 * s; ty = cp.y + 13; }
    if (!v.mset) { v.mset = true; v.mx = tx; v.my = ty; }
    const dx = tx - v.mx, dy = ty - v.my, l = Math.hypot(dx, dy);
    v.mgo = false;
    if (cp.moving || l < 1.5) { v.mx += dx * Math.min(1, dt * 12); v.my += dy * Math.min(1, dt * 12); }
    else { const st = Math.min(l, 75 * dt); v.mx += dx / l * st; v.my += dy / l * st; v.mgo = true; v.mdir = dir4(dx, dy); v.mwalk += dt * 9; }
    return { x: v.mx, y: v.my };
  }
  drawCata(cp, dt, b, ui) {
    const c = this.ctx, S = sprites(), v = this.cataVis(cp), key = 'cata' + cp.side;
    if (cp.hp < v.hp && !cp.dead) v.flash = 1;
    v.hp = cp.hp; v.flash = Math.max(0, v.flash - dt * 6);
    if (v.dead !== cp.dead) { v.dead = cp.dead; if (!cp.dead) v.fixT = 0; }
    v.fixT += dt;
    if (!this.onScreen(cp.x, cp.y, 160)) { v.px = cp.x; v.py = cp.y; return; }
    const moved = Math.hypot(cp.x - v.px, cp.y - v.py); v.px = cp.x; v.py = cp.y; v.roll += moved / 8;
    const dir = dir4(cp.fx, cp.fy);
    let anim = 'fire_' + dir, fr = 0, rot = 0, sx = 1, sy = 1, oy = 0;
    if (cp.moving) { anim = 'move_' + dir; fr = Math.floor(v.roll) % 8; oy = -Math.abs(Math.sin(v.roll * 1.6)) * 1.2; }
    else if (cp.fire) { fr = Math.min(7, Math.floor(cp.fire.t / CATA.dur * 8)); const k = cp.fire.t / CATA.dur; sy = 1 - 0.05 * Math.sin(Math.min(1, k * 2) * Math.PI); }
    else if (cp.dead) { fr = 5; rot = cp.side === 0 ? -0.11 : 0.11; sy = 0.94; }
    if (v.fixT < 0.4) { const k = v.fixT / 0.4; sy *= 1 + 0.12 * Math.sin(k * Math.PI); sx *= 1 - 0.05 * Math.sin(k * Math.PI); }
    // au sol : ombre et anneau du camp
    const rw = 72;
    c.globalAlpha = 0.8; c.drawImage(cp.side === 0 ? S.ring0 : S.ring1, cp.x - rw, cp.y + 3 - rw * 0.5, rw * 2, rw); c.globalAlpha = 1;
    c.globalAlpha = 0.85; c.drawImage(S.shadow, cp.x - 62, cp.y - 14, 124, 42); c.globalAlpha = 1;
    const glow = (ui.mode && cp.side !== 0 && !cp.dead ? 0.16 + 0.12 * Math.sin(this.time * 7) : 0) + v.flash * 0.7 + (v.fixT < 0.5 ? 0.6 * (1 - v.fixT / 0.5) : 0);
    if (cp.dead && CANFILTER) c.filter = 'brightness(0.55) saturate(0.55)';
    drawUnitFrame(c, key, anim, fr, cp.x, cp.y + oy, CATA_S, 1, sx, sy, rot);
    if (cp.dead && CANFILTER) c.filter = 'none';
    if (glow > 0.02) { c.globalCompositeOperation = 'lighter'; drawUnitFrame(c, key, anim, fr, cp.x, cp.y + oy, CATA_S, Math.min(1, glow), sx, sy, rot); c.globalCompositeOperation = 'source-over'; }
    // en route : un peu de poussière derrière les roues
    if (cp.moving && Math.random() < 0.25) this.fx('smoke_puff', cp.x - cp.fx * 36 + rand(-13, 13), cp.y + 3, { s0: 0.06, s1: 0.16, life: 0.45, a: 0.45, vy: -14, fade: 0.7 });
    // cassée : fumée, et des étincelles là où le singe tape
    if (cp.dead) {
      v.smoke -= dt; if (v.smoke <= 0) { v.smoke = 0.22; this.fx(Math.random() < 0.5 ? 'smoke1' : 'smoke2', cp.x + rand(-29, 29), cp.y - 50, { s0: 0.08, s1: 0.3, life: 1.2, vy: -38, vx: rand(-8, 8), a: 0.6, fade: 0.7 }); }
    }
  }
  // Barnabé : il pousse, rejoint sa place, attend, ou répare à grands coups
  drawMonkey(cp, b) {
    const c = this.ctx, v = this.cataVis(cp), x = v.mx, y = v.my; if (!this.onScreen(x, y, 110)) return;
    const s = cp.side === 0 ? 1 : -1;
    let anim = 'walk_S', fr = 0, oy = 0, sy = 1, sx = 1;
    if (cp.moving) { anim = 'push_' + dir4(cp.fx, cp.fy); fr = Math.floor(v.roll * 0.9) % 8; oy = -Math.abs(Math.sin(v.roll * 0.9 * Math.PI / 2)) * 1.5; }
    else if (v.mgo) { anim = 'walk_' + v.mdir; fr = Math.floor(v.mwalk) % 8; }
    else if (cp.dead) {          // il tape sur la catapulte : élan, coup, rebond
      const ph = (this.time * 2.8 + cp.side * 0.3) % 1; anim = 'push_' + (s > 0 ? 'W' : 'E'); fr = ph < 0.55 ? 2 : 5;
      oy = -Math.sin(Math.min(1, ph / 0.55) * Math.PI) * 8; sy = ph > 0.55 && ph < 0.7 ? 0.92 : 1;
      if (ph > 0.55 && v.spark < 0.55) { this.burst('star_big', x - 26 * s, y - 32, 3, { s: 0.09, sp0: 40, sp1: 120, life: 0.5, g: 300 }); this.dot(x - 24 * s, y - 32, { vx: rand(-40, 40), vy: -60, g: 220, r: 2.4, col: '255,220,120', life: 0.4, add: true }); }
      v.spark = ph;
    } else if (b.over) { const hop = Math.abs(Math.sin(this.time * 7 + cp.side)); oy = -hop * 16; anim = 'walk_S'; }
    else { const br = Math.sin(this.time * 2.4 + cp.side); sy = 1 + br * 0.02; anim = cp.fire ? 'walk_' + dir4(cp.fx, cp.fy) : 'walk_S'; }
    c.globalAlpha = 0.8; c.drawImage(sprites().shadow, x - 24, y - 8, 48, 19); c.globalAlpha = 1;
    drawUnitFrame(c, 'tutomonkey', anim, fr, x, y + oy, BARN_S, 1, sx, sy);
  }
  // Le dresseur de chaque camp, en petit à côté de sa tente : il encourage, s'inquiète ou se fâche selon le combat
  drawTrainer(s, dt, b) {
    const P = TRAINER[s], T = this.tr[s], key = 'trainer' + s; if (!this.onScreen(P.x, P.y, 110)) { T.t += dt; return; }
    T.t += dt; T.left -= dt;
    if (b.over) { T.anim = b.winner === s ? 'cheer' : b.winner < 0 ? 'worry' : 'angry'; T.left = 1; }
    else if (T.left <= 0 && T.anim !== 'idle') { T.anim = 'idle'; T.t = 0; }
    // au repos il trépigne en boucle ; une réaction se joue une fois, puis son moment le plus expressif tourne en boucle
    const c = this.ctx, n = animLen(key, T.anim), f = Math.floor(T.t * 9), fr = T.anim === 'idle' ? Math.floor(T.t * 5) % n : f < n ? f : 2 + (f - n) % 3;
    c.globalAlpha = 0.85; c.drawImage(sprites().shadow, P.x - 24, P.y - 8, 48, 18); c.globalAlpha = 1;
    c.fillStyle = TEAM[s]; c.globalAlpha = 0.5; ellipse(c, P.x, P.y + 1, 25, 8); c.fill(); c.globalAlpha = 1;
    drawUnitFrame(c, key, T.anim, fr, P.x, P.y, TRAIN_S);
  }
  drawCampBar(s) {
    const y = CAMP_BAR[s.side]; if (!this.onScreen(s.x, y, 140)) return;
    const c = this.ctx, w = 160, hh = 13, x = s.x - w / 2, r = Math.max(0, s.hp) / s.maxHp, col = s.side === 0 ? ['#8fe0ff', '#1f8fe6'] : ['#ff9a84', '#d92a20'];
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 2, y - 2, w + 4, hh + 4, 4.5); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 3); c.fill();
    const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    c.fillStyle = g; rr(c, x, y, Math.max(3, w * r), hh, 3); c.fill();
    label(c, (s.side === 0 ? 'Ton camp · ' : 'Camp adverse · ') + campPct(s) + ' %', s.x, y - 13, 16, TEAM_LITE[s.side], 'center', 0.3);
  }
  drawStructBar(s, b, ui) {
    if (s.kind === 'cata') { this.drawCataBar(s, ui); return; }
    if (s.dead) return;
    if (s.kind === 'camp') { this.drawCampBar(s); return; }
    const r = s.hp / s.maxHp;
    if (s.kind === 'crate' && r >= 1) return;
    if (s.kind === 'gold') {          // la boîte dorée : toujours sa barre, et son nom
      if (!this.onScreen(s.x, s.y, 120)) return;
      const c = this.ctx, w = 78, hh = 9, x = s.x - w / 2, y = s.y - 82, v = this.svis.get(s.id);
      if (v && v.age < 0.7) return;     // (pas pendant qu'elle tombe)
      c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 1.6, y - 1.6, w + 3.2, hh + 3.2, 3.4); c.fill();
      c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 2.4); c.fill();
      const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, '#fff6b8'); g.addColorStop(1, '#e0a010');
      c.fillStyle = g; rr(c, x, y, Math.max(2.5, w * r), hh, 2.4); c.fill();
      label(c, 'Boîte dorée', s.x, y - 12, 15, '#ffe27a', 'center', 0.3);
      return;
    }
    if (!this.onScreen(s.x, s.y, 120)) return;
    const c = this.ctx, w = s.kind === 'tower' ? 90 : 54, hh = s.kind === 'tower' ? 10 : 7, x = s.x - w / 2, y = s.kind === 'tower' ? TOWER.bar : s.y - 56;
    const col = s.kind === 'tower' ? (s.side < 0 ? ['#ffe9a0', '#f0b030'] : s.side === 0 ? ['#8fe0ff', '#1f8fe6'] : ['#ff9a84', '#d92a20']) : ['#ffdf9a', '#d9902a'];
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 1.6, y - 1.6, w + 3.2, hh + 3.2, 3.4); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 2.4); c.fill();
    const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    c.fillStyle = g; rr(c, x, y, Math.max(2.5, w * r), hh, 2.4); c.fill();
    if (s.kind === 'tower') label(c, s.side < 0 ? 'Cage' : s.side === 0 ? 'À toi' : 'Adverse', s.x, y - 11, 14, s.side < 0 ? '#ffe9a0' : TEAM_LITE[s.side], 'center', 0.3);
  }

  // vie de la catapulte (quand elle a souffert, ou en mode ordres) ; cassée : la réparation qui avance
  drawCataBar(s, ui) {
    if (!this.onScreen(s.x, s.y, 160)) return;
    const c = this.ctx, w = 80, hh = 8.5, x = s.x - w / 2, y = s.y - 124;
    if (s.dead) {
      const k = 1 - s.repairT / CATA.repair;
      c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 1.6, y - 1.6, w + 3.2, hh + 3.2, 3.4); c.fill();
      c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 2.4); c.fill();
      c.fillStyle = '#ffd23f'; rr(c, x, y, Math.max(2.5, w * clamp(k, 0, 1)), hh, 2.4); c.fill();
      label(c, 'Réparation', s.x, y - 11, 14, '#ffe9a0', 'center', 0.3);
      return;
    }
    const r = s.hp / s.maxHp; if (r >= 1 && !ui.mode) return;
    const col = s.side === 0 ? ['#8fe0ff', '#1f8fe6'] : ['#ff9a84', '#d92a20'];
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 1.6, y - 1.6, w + 3.2, hh + 3.2, 3.4); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 2.4); c.fill();
    const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    c.fillStyle = g; rr(c, x, y, Math.max(2.5, w * r), hh, 2.4); c.fill();
  }

  // ---------- la boîte dorée et son singe ----------
  // La boîte tombe du ciel, rebondit, puis brille sur place (reflets de son image, lueur au sol, étincelles)
  drawGoldBox(s, dt, ui) {
    const c = this.ctx; let v = this.svis.get(s.id);
    if (!v) { v = { hp: s.hp, flash: 0, age: 0 }; this.svis.set(s.id, v); }
    if (s.hp < v.hp) v.flash = 1;
    v.hp = s.hp; v.flash = Math.max(0, v.flash - dt * 6); v.age += dt;
    const FALL = 0.5, t = v.age, k = Math.min(1, t / FALL), drop = t < FALL ? (1 - k * k) * 420 : 0;
    const land = t - FALL, sq = land > 0 && land < 0.3 ? Math.sin(land / 0.3 * Math.PI) * 0.16 : 0;
    const sc = WS * 1.18, pulse = 0.5 + 0.5 * Math.sin(this.time * 4), jx = v.flash > 0.4 ? rand(-1.5, 1.5) : 0;
    // l'ombre grandit pendant la chute, puis la lueur dorée au sol
    c.fillStyle = `rgba(14,8,24,${0.18 + 0.2 * k})`; ellipse(c, s.x, s.y + 2, 18 + 22 * k, 6 + 6 * k); c.fill();
    if (land > 0) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.28 + 0.16 * pulse;
      const G = sprites().glow; c.drawImage(G, s.x - 70, s.y - 26, 140, 52); c.restore();
    }
    const fr = Math.floor(this.time * 7) % 4;
    drawUnitFrame(c, 'goldbox', 'box', fr, s.x + jx, s.y + 4 - drop, sc, 1, 1 + sq, 1 - sq);
    if (v.flash > 0.02 || (ui.mode && land > 0)) {
      c.save(); c.globalCompositeOperation = 'lighter';
      drawUnitFrame(c, 'goldbox', 'box', fr, s.x + jx, s.y + 4 - drop, sc, Math.min(1, v.flash * 0.55 + (ui.mode ? 0.14 + 0.1 * pulse : 0)), 1 + sq, 1 - sq);
      c.restore();
    }
    // des étincelles montent de la boîte
    if (land > 0 && Math.random() < dt * 9) this.dot(s.x + rand(-28, 28), s.y - rand(10, 50), { vy: -rand(20, 50), g: -10, life: rand(0.5, 0.9), r: rand(0.9, 1.5), col: '255,222,110', add: true });
  }
  // Le singe doré court vite (8 images par direction), saute par-dessus l'eau (haut, et loin de son ombre), laisse des
  // paillettes derrière lui, et lance ses bananes en sautillant
  drawGoldMonkey(m, dt, a) {
    const c = this.ctx, x = m.px + (m.x - m.px) * a, y = m.py + (m.y - m.py) * a;
    let hgt = 0;
    for (const [s0, s1] of m.jumps) if (m.s > s0 && m.s < s1) hgt = Math.sin(Math.PI * (m.s - s0) / (s1 - s0)) * (24 + 0.45 * (s1 - s0));
    const al = m.leaving > 0 ? clamp(m.leaving / 0.5, 0, 1) : 1, pop = m.t < 0.35 ? 0.4 + 0.6 * easeOut(m.t / 0.35) : 1;
    const thr = m.throwT < 0.3 ? Math.sin(m.throwT / 0.3 * Math.PI) : 0, hop = thr * 10 + (m.moving ? Math.abs(Math.sin(this.time * 16)) * 3 : Math.abs(Math.sin(this.time * 5)) * 2);
    const S = sprites(), sw = 46 * (1 - Math.min(0.55, hgt / 150));
    c.globalAlpha = 0.85 * al; c.drawImage(S.shadow, x - sw / 2, y - sw / 4 + 2, sw, sw / 2);
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = (0.32 + 0.12 * Math.sin(this.time * 9)) * al; c.drawImage(S.glow, x - 34, y - 14 - hgt * 0.3, 68, 28); c.restore();
    c.globalAlpha = 1;
    const anim = 'run_' + dir4(m.fx, m.fy), fr = m.moving || hgt > 0 ? Math.floor(this.time * 15) : 0;
    drawUnitFrame(c, 'goldmonkey', anim, fr, x, y - hgt - hop, WS * 1.25 * pop, al, 1 + thr * 0.1, 1 - thr * 0.08);
    if (al > 0.3 && Math.random() < (m.moving ? 0.7 : 0.25)) this.dot(x + rand(-12, 12), y - hgt - rand(8, 44), { vx: -m.fx * rand(10, 40), vy: -rand(10, 40), g: 20, life: rand(0.35, 0.7), r: rand(0.9, 1.6), col: Math.random() < 0.5 ? '255,226,120' : '255,250,210', add: true });
  }
  miniShown() { return this.cam.z > ZOOM.min + 0.05; }

  // ---------- animaux ----------
  drawUnit(u, dt, a, b, ui) {
    const c = this.ctx, S = sprites(); let v = this.vis.get(u.id);
    if (!v) {
      v = { walk: Math.random() * 4, flash: 0, lag: 1, dir: u.side === 0 ? 'N' : 'S', adir: u.side === 0 ? 'N' : 'S', bob: Math.random() * 6, age: u.spawn > (u.gift ? 0.45 : DEPLOY_DELAY - 0.15) ? 0 : 9, landed: false, sq: 0, dirT: 0, ready: 0 };
      this.vis.set(u.id, v);
    }
    v.age += dt;
    const ratio = u.hp / u.maxHp;
    if (v.last !== undefined && ratio < v.last - 0.001) { v.flash = 1; v.sq = Math.max(v.sq, 0.5); }
    v.last = ratio; v.flash = Math.max(0, v.flash - dt * 6); v.sq = Math.max(0, v.sq - dt * 5);
    const x = u.px + (u.x - u.px) * a, y = u.py + (u.y - u.py) * a, key = u.aid, d = DATA[key];
    if (!d) return;
    if (!this.onScreen(x, y, 90)) { v.x = x; v.top = y - d.walkH * WS; return; }
    const r = u.r / WS, big = r > 30, P = (dx, dy) => [x + dx * WS, y + dy * WS];
    let alpha = 1, sx = 1, sy = 1, ox = 0, oy = 0, rot = 0, shadowK = 1;
    const lift = u.air ? AIR_LIFT + Math.sin(this.time * 3 + v.bob) * 6 : 0, swim = u.swim;
    // sous un pont, un nageur plonge : il s'enfonce en approchant du tablier, passe dessous sans qu'on le voie, et
    // ressort de l'autre côté dans une gerbe d'eau
    const sink = swim ? sinkAt(x, y) : 0;
    if (swim && !u.dead) {
      const was = v.sk === undefined ? sink : v.sk;
      if (was < 0.45 && sink >= 0.45) {
        this.ripple(x, y + 2, 30, 0.8, 0.75); this.ripple(x, y + 2, 46, 1.1, 0.5);
        for (let i = 0; i < 6; i++) this.dot(x + rand(-0.6, 0.6) * u.r, y - 2, { vx: rand(-25, 25), vy: -rand(40, 80), g: 300, r: rand(1, 1.8), col: '220,245,255', life: 0.45 });
      } else if (was > 0.85 && sink <= 0.85) {
        this.ripple(x, y + 2, 34, 0.9, 0.8); this.ripple(x, y + 2, 52, 1.2, 0.5);
        for (let i = 0; i < 10; i++) { const an = rand(0, 6.283); this.dot(x + Math.cos(an) * u.r * 0.5, y - 4, { vx: Math.cos(an) * rand(20, 55), vy: -rand(60, 120), g: 320, r: rand(1.1, 2), col: '220,245,255', life: 0.6 }); }
      }
      v.sk = sink;
    }
    // arrivée : il tombe, s'écrase un peu, puis attend la fin de son temps de pose (un nageur, lui, sort de l'eau)
    if (swim) {
      if (!v.landed) {
        v.landed = true;
        if (v.age < 1) { for (let i = 0; i < 3; i++) this.ripple(x, y + 2, 26 + i * 11, 0.7 + i * 0.25, 0.8); for (let i = 0; i < 12; i++) { const an = rand(0, 6.283); this.dot(x + Math.cos(an) * 6, y - 2, { vx: Math.cos(an) * rand(20, 60), vy: -rand(50, 110), g: 320, r: rand(1.2, 2.2), col: '200,240,255', life: 0.6 }); } }
      }
      if (v.age < 0.5) { const k = v.age / 0.5; alpha = Math.min(1, k * 2.2); oy = (1 - k) * 18; sy = 0.5 + 0.5 * k; sx = 1.1 - 0.1 * k; }
      shadowK = 0;
    } else if (v.age < DROP_T) {
      const k = v.age / DROP_T; oy = -(1 - k * k) * DROP_H; alpha = Math.min(1, k * 4); sy = 1.14; sx = 0.9; shadowK = 0.35 + 0.65 * k;
    } else if (!v.landed) {
      v.landed = true;
      if (v.age < 1) {
        v.sq = 1;
        this.fx('dust_ring', ...P(0, 5), { s0: 0.25, s1: big ? 1.15 : 0.7, life: 0.42, flat: 0.55, a: 0.85 });
        for (let i = 0; i < (big ? 6 : 4); i++) { const an = rand(0, 6.283); this.fx('smoke_puff', ...P(Math.cos(an) * r * 0.6, Math.sin(an) * r * 0.3), { vx: Math.cos(an) * rand(60, 140), vy: Math.sin(an) * rand(20, 60) - 30, s0: 0.12, s1: big ? 0.42 : 0.28, life: rand(0.35, 0.6), a: 0.75, fade: 0.6 }); }
        this.shake = Math.max(this.shake, big ? 9 : 3);
        if (big) this.decal('crater1', ...P(0, 6), 4, 0.36);
      }
    }
    if (v.sq > 0 && !u.dead) { const q = v.sq * v.sq; sy *= 1 - 0.2 * q; sx *= 1 + 0.16 * q; }
    if (u.spawn <= 0 && v.ready === 0) { v.ready = 1; }
    if (v.ready > 0 && v.ready < 2) v.ready += dt * 3.2;
    if (u.dead && swim) {        // un nageur vaincu coule, dans un remous de bulles
      const t = u.deadT; if (t > 0.8) return; const k = t / 0.8; alpha = 1 - k; oy += 22 * k; sy *= 1 - 0.3 * k; shadowK = 0;
      if (Math.random() < 0.5) this.dot(x + rand(-u.r, u.r), y - rand(0, 6), { vy: -rand(20, 50), r: rand(1, 2), col: '220,245,255', life: 0.5 });
      if (!v.sank) { v.sank = true; this.ripple(x, y + 2, 32, 1.1, 0.8); this.ripple(x, y + 2, 46, 1.4, 0.6); }
    } else if (u.dead) { const t = u.deadT; if (t > 0.42) return; const k = t / 0.42; alpha = 1 - k * k; sy *= 1 + 0.18 * Math.sin(k * Math.PI) - 0.35 * k; sx *= 1 + 0.22 * Math.sin(k * Math.PI) - 0.2 * k; oy -= 26 * k; shadowK = 1 - k; }
    // direction : une petite inertie évite que l'animal tremble entre deux orientations voisines
    if (u.fx || u.fy) {
      const an = Math.atan2(u.fy, u.fx), nd = DIR8[(Math.round(an / (Math.PI / 4)) + 8) % 8];
      if (nd !== v.dir) { v.dirT += dt; if (v.dirT > 0.09 || u.atk) { v.dir = nd; v.dirT = 0; } } else v.dirT = 0;
      v.adir = Math.abs(u.fx) > Math.abs(u.fy) * 1.1 ? (u.fx > 0 ? 'E' : 'W') : (u.fy > 0 ? 'S' : 'N');
    }
    let anim = 'walk_' + v.dir, frame = 0;
    if (u.atk) {
      anim = u.atk.anim + '_' + v.adir; const n = animLen(key, anim);
      if (u.guardT > 0 || u.atk.guard) {       // tête à l'abri : il se couvre vite, tient la pose, puis se relève
        const T = u.atk.dur, tt = clamp(u.atkT, 0, T), q = tt < 0.25 ? tt / 0.25 * 0.5 : tt > T - 0.25 ? 0.5 + (tt - (T - 0.25)) / 0.25 * 0.5 : 0.5;
        frame = Math.min(n - 1, Math.floor(q * n));
      } else {
        const q = clamp(u.atkT / u.atk.dur, 0, 0.999); frame = Math.floor(q * n);
        // élan vers la cible (corps à corps) ou léger recul (tir)
        const w = u.atk.windup / u.atk.dur, k = q < w ? -0.35 * Math.sin(q / w * Math.PI) : Math.sin(clamp((q - w) / 0.3, 0, 1) * Math.PI), L = (u.atk.proj || u.atk.spray ? -3 : 9) * (big ? 1.3 : 1);
        ox += u.fx * k * L; oy += u.fy * k * L * 0.7;
      }
    } else if (swim && !u.dead) {       // nage : battements réguliers, le corps monte et descend avec les vagues ; un sillage quand il avance
      const n = animLen(key, anim), mv = u.moving && u.spawn <= 0;
      v.walk += dt * (mv ? 7 + u.s.speed * 2 : 4.5) * (u.slowT > 0 ? 0.6 : 1); frame = Math.floor(v.walk) % n;
      oy += Math.sin(this.time * 2.3 + v.bob) * 1.6; rot = Math.sin(this.time * 1.7 + v.bob) * 0.025;
      if (u.stun > 0) { ox = Math.sin(this.time * 30) * 2.5; rot += Math.sin(this.time * 9) * 0.05; }
      v.rip = (v.rip || 0) - dt;
      if (v.rip <= 0) { v.rip = mv ? 0.28 : 0.85; this.ripple(x - u.fx * u.r * 0.6, y + 2, u.r * (mv ? 1.1 : 1.5), mv ? 0.7 : 1.1, mv ? 0.6 : 0.4); }
      if (mv && sink < 0.3 && Math.random() < 0.5) this.dot(x - u.fx * u.r * 0.9 + rand(-3, 3), y + rand(-1, 3), { vx: -u.fx * 18 + rand(-10, 10), vy: -u.fy * 8 - rand(0, 18), g: 90, r: rand(1, 1.8), col: '235,250,255', life: 0.45 });
    } else if (u.moving && u.spawn <= 0) {
      v.walk += dt * (6 + u.s.speed * 3.5) * (u.charging ? 1.6 : 1) * (u.slowT > 0 ? 0.6 : 1); frame = Math.floor(v.walk) % 4;
      const ph = v.walk * Math.PI / 2, hop = Math.abs(Math.sin(ph));
      if (!u.air) { oy -= hop * (big ? 2.5 : 4); sy *= 1 + 0.035 * hop; sx *= 1 - 0.02 * hop; rot = Math.sin(ph) * (big ? 0.018 : 0.035); }
      if (!u.air && big && frame !== v.step) { v.step = frame; if (frame % 2 === 0) this.fx('smoke_puff', ...P(-u.fx * r * 0.6 + rand(-8, 8), 2), { s0: 0.08, s1: 0.2, life: 0.4, a: 0.45, vy: -18, fade: 0.7 }); }
    }
    else if (b.over && b.winner === u.side && !u.dead) { const hop = Math.abs(Math.sin(this.time * 7 + u.id)); oy -= hop * 18; sy *= 1 + 0.06 * hop; anim = 'walk_S'; shadowK = 1 - 0.3 * hop; }
    else if (u.stun > 0) { ox = Math.sin(this.time * 30) * 2.5; rot = Math.sin(this.time * 9) * 0.05; }
    else if (u.air) { v.walk += dt * 6; frame = Math.floor(v.walk) % 4; }
    else { const br = Math.sin(this.time * 2.6 + u.id); sy *= 1 + br * 0.018; sx *= 1 - br * 0.008; }
    if (sink > 0) oy += sink * (d.walkH + 8);
    c.save(); if (swim) this.clipDecks(x, y);
    c.translate(x, y); c.scale(WS, WS);
    // au sol : anneau du camp, ombre douce (dans l'eau : l'anneau seulement, plus discret, et l'eau assombrie sous le corps)
    const ring = u.side === 0 ? S.ring0 : S.ring1, gy = 3;
    if (!u.dead && (swim || v.age >= DROP_T * 0.6)) {
      const rw = r * (u.air ? 1.15 : swim ? 1.6 : 1.42), pulse = v.ready > 0 && v.ready < 2 ? 1 + 0.5 * Math.sin(Math.min(1, v.ready) * Math.PI) * (1 - v.ready / 2) : 1;
      c.globalAlpha = (u.air ? 0.55 : swim ? 0.6 : 0.9) * alpha * (1 - sink); c.drawImage(ring, -rw * pulse, gy - rw * 0.5 * pulse, rw * 2 * pulse, rw * pulse); c.globalAlpha = 1;
    }
    if (swim) { c.fillStyle = `rgba(10,40,90,${0.22 * alpha * (1 - sink)})`; ellipse(c, 0, gy - 2, r * 1.25, r * 0.5); c.fill(); }
    else { const sw = r * (u.air ? 0.95 : 1.5) * shadowK, sh = sw * 0.5; c.globalAlpha = (u.air ? 0.5 : 0.95) * alpha * (0.4 + 0.6 * shadowK); c.drawImage(S.shadow, -sw + (u.air ? 10 : 3), gy - sh + (u.air ? 6 : 1), sw * 2, sh * 2); c.globalAlpha = 1; }
    // temps de pose : petit cadran qui se vide autour des pattes
    if (u.spawn > 0 && v.landed) {
      const col = u.side === 0 ? '#bfeaff' : '#ffd0c4', k = u.spawn / DEPLOY_DELAY, rw = r * 1.5 + 6;
      c.save(); c.translate(0, gy); c.scale(1, 0.5); c.lineCap = 'round';
      c.lineWidth = 9; c.strokeStyle = 'rgba(20,12,30,.55)'; c.beginPath(); c.arc(0, 0, rw, 0, 6.283); c.stroke();
      c.lineWidth = 6; c.strokeStyle = col; c.beginPath(); c.arc(0, 0, rw, -Math.PI / 2, -Math.PI / 2 + 6.283 * k); c.stroke();
      c.restore();
    }
    const fy = -lift + oy, fxp = ox, H2 = d.walkH;
    const halo = (rgb, al, kw = 3.6, kh = 1.5) => { c.globalCompositeOperation = 'lighter'; c.globalAlpha = al; c.fillStyle = `rgb(${rgb})`; const gw = r * kw, gh = H2 * kh; c.drawImage(S.glow, fxp - gw / 2, fy - H2 * 0.48 - gh / 2, gw, gh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; };
    if (u.buff) halo('255,255,255', 0.26 + 0.1 * Math.sin(this.time * 11));
    if (u.rage > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(0.5, 0.1 + 0.055 * u.rage) * (0.8 + 0.2 * Math.sin(this.time * 9)); c.fillStyle = '#ff2a1a'; ellipse(c, fxp, fy - H2 * 0.4, r * 1.5, H2 * 0.62); c.fill(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    if (sink > 0.002) {      // il plonge : sous la surface, une silhouette bleutée ; au-dessus, le corps coupé à la ligne d'eau
      c.save(); c.beginPath(); c.rect(-300, 3, 600, 300); c.clip();
      if (CANFILTER) c.filter = 'brightness(0.55) sepia(1) hue-rotate(165deg) saturate(2.4)';
      drawUnitFrame(c, key, anim, frame, fxp, fy, 1, alpha * 0.32 * (1 - sink), sx, sy, rot);
      c.restore();
      c.save(); c.beginPath(); c.rect(-300, -700, 600, 703); c.clip();
    }
    drawUnitFrame(c, key, anim, frame, fxp, fy, 1, alpha, sx, sy, rot);
    const glow = v.flash * 0.85 + (u.charging ? 0.22 : 0) + (u.dead ? 0.6 : 0) + (v.age < DROP_T + 0.12 ? 0.5 : 0) + (v.ready > 0 && v.ready < 1 ? 0.35 * (1 - v.ready) : 0)
      + (ui.mode && !u.dead ? 0.14 + 0.1 * Math.sin(this.time * 7 + u.id) : 0) + (ui.picked.has(u.id) ? 0.16 : 0) + (u.plateT > 0 ? 0.25 + 0.2 * Math.sin(this.time * 14) : 0);
    if (glow > 0.02) { c.globalCompositeOperation = 'lighter'; drawUnitFrame(c, key, anim, frame, fxp, fy, 1, Math.min(1, glow) * alpha, sx, sy, rot); if (v.flash > 0.5) drawUnitFrame(c, key, anim, frame, fxp, fy, 1, (v.flash - 0.5) * alpha, sx, sy, rot); c.globalCompositeOperation = 'source-over'; }
    // bulles : bouclier du chaton (vert), tête à l'abri de l'orang-outan (doré)
    if (u.shield > 0 && !u.dead) {
      const pu = 0.5 + 0.5 * Math.sin(this.time * 6 + u.id), k = clamp(u.shield / (u.shieldMax || u.shield), 0.25, 1);
      c.fillStyle = `rgba(120,255,140,${0.12 + 0.06 * pu})`; ellipse(c, fxp, fy - H2 * 0.46, r * 1.5, H2 * 0.68); c.fill();
      c.lineWidth = 2 + 2 * k; c.strokeStyle = `rgba(170,255,170,${0.55 + 0.3 * pu})`; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2; c.beginPath(); c.ellipse(fxp, fy - H2 * 0.46, r * 1.5, H2 * 0.68, 0, 3.6, 4.5); c.stroke();
    }
    if (u.guardT > 0 && !u.dead) {
      const pu = 0.5 + 0.5 * Math.sin(this.time * 12);
      c.fillStyle = `rgba(255,225,120,${0.14 + 0.08 * pu})`; ellipse(c, fxp, fy - H2 * 0.46, r * 1.6, H2 * 0.72); c.fill();
      c.lineWidth = 4; c.strokeStyle = `rgba(255,240,170,${0.7 + 0.3 * pu})`; c.stroke();
    }
    if (u.stun > 0 && !u.dead) this.drawFx('dizzy_stars', Math.sin(this.time * 5) * 5, fy - H2 - 4, 0.34, Math.sin(this.time * 4) * 0.2, 1);
    if (sink > 0.002) {
      c.restore();
      if (sink < 0.97) {      // l'écume là où le corps traverse la surface
        const fa = Math.sin(Math.min(1, sink * 1.15) * Math.PI) * alpha, fw = r * (1.05 + 0.08 * Math.sin(this.time * 9 + v.bob));
        c.fillStyle = `rgba(235,250,255,${0.5 * fa})`; ellipse(c, 0, 3, fw, 5); c.fill();
        c.fillStyle = `rgba(255,255,255,${0.75 * fa})`; ellipse(c, 0, 2, fw * 0.62, 2.4); c.fill();
      }
    }
    c.restore();
    v.sunk = sink > 0.55;
    if (v.sunk) { v.top = y + (fy - H2 - 10) * WS; v.x = x; return; }
    // petits effets qui s'échappent de l'animal
    const head = P(rand(-14, 14), fy - H2 * 0.8);
    if (u.poison && Math.random() < 0.1) this.fx('skull_green', head[0], head[1], { s0: 0.05, s1: 0.1, life: 0.6, vy: -50, a: 0.8 });
    if (u.poison && Math.random() < 0.25) this.dot(x + rand(-u.r, u.r), y + (fy - rand(4, H2 * 0.8)) * WS, { vy: -12, life: 0.5, r: 1.3, col: '140,240,60' });
    if (u.slowT > 0 && Math.random() < 0.3) this.dot(x + rand(-u.r, u.r), y + (fy - rand(4, H2 * 0.7)) * WS, { vy: 8, g: 60, life: 0.5, r: 1.4, col: '110,200,255' });
    if (u.buff && Math.random() < 0.25) this.fx('fire1', ...P(rand(-r, r) * 0.7, fy - rand(8, H2 * 0.7)), { s0: 0.07, s1: 0.02, life: 0.45, vy: -100, a: 0.85 });
    if (u.rage > 2 && Math.random() < 0.04 * u.rage) this.dot(x + rand(-u.r, u.r), y + (fy - rand(4, H2 * 0.9)) * WS, { vy: -26, life: 0.5, r: 1.2, col: '255,70,40', add: true });
    if (u.charging && u.moving && Math.random() < 0.5) this.fx('dust_dash', ...P(-u.fx * r * 1.3, -4 - u.fy * r), { s0: 0.14, s1: 0.26, life: 0.3, rot: Math.atan2(-u.fy, -u.fx), a: 0.8 });
    v.top = y + (fy - H2 - 10) * WS; v.x = x;
  }
  drawUnitBar(u, ui) {
    if (u.dead || u.spawn > 0) return;
    const v = this.vis.get(u.id); if (!v || v.top === undefined || v.sunk) return;
    const r = u.hp / u.maxHp;
    v.lag += (r - v.lag) * 0.08; if (v.lag < r) v.lag = r;
    const extra = u.shield > 0 || u.rage > 0 || u.plate > 0 || u.water > 0 || ui.picked.has(u.id) || ui.mode;
    if (r >= 1 && v.lag >= 0.999 && !extra) return;
    if (!this.onScreen(v.x, v.top, 60)) return;
    const c = this.ctx, w = clamp(u.r / WS * 2.1, 46, 84), hh = 9, x = -w / 2 + 7, y = 0, mine = u.side === 0;
    c.save(); c.translate(v.x, v.top); c.scale(WS * 1.08, WS * 1.08);
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 2.5, y - 2.5, w + 5, hh + 5, 5); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 3.5); c.fill();
    if (v.lag > r + 0.004) { c.fillStyle = '#fff6d8'; rr(c, x, y, Math.max(4, w * v.lag), hh, 3.5); c.fill(); }
    if (r > 0.001) {
      const g = c.createLinearGradient(0, y, 0, y + hh);
      if (u.poison) { g.addColorStop(0, '#c8ff8a'); g.addColorStop(0.5, '#6fd62a'); g.addColorStop(1, '#3f9a14'); }
      else if (mine) { g.addColorStop(0, '#8fe0ff'); g.addColorStop(0.5, '#2fa8ff'); g.addColorStop(1, '#1b74d8'); } else { g.addColorStop(0, '#ff9a84'); g.addColorStop(0.5, '#ff4a3a'); g.addColorStop(1, '#c92a20'); }
      c.fillStyle = g; rr(c, x, y, Math.max(4, w * r), hh, 3.5); c.fill();
    }
    if (u.shield > 0) { c.fillStyle = 'rgba(16,10,8,.9)'; rr(c, x - 1.5, y - 9, w + 3, 6.5, 3); c.fill(); c.fillStyle = '#8dff8a'; rr(c, x, y - 7.5, Math.max(3, w * clamp(u.shield / (u.shieldMax || u.shield), 0, 1)), 3.5, 1.7); c.fill(); }
    c.fillStyle = mine ? '#1c6fd0' : '#c0281e'; c.beginPath(); c.arc(x - 8, y + hh / 2, 10.5, 0, 6.3); c.fill(); c.lineWidth = 2.5; c.strokeStyle = 'rgba(16,10,8,.95)'; c.stroke();
    label(c, String(u.level), x - 8, y + hh / 2 + 0.5, 15, '#fff', 'center', 0.15);
    // pastilles : cris du gorille (rouge), plaques du rhinocéros (acier), jets d'eau de l'éléphant (bleu)
    const pips = u.rage > 0 ? [u.rage, '#ff4a3a'] : u.plate > 0 ? [u.plate, '#c9d6e6'] : u.water > 0 ? [u.water, '#5ac8ff'] : null;
    if (pips) for (let i = 0; i < pips[0]; i++) { c.fillStyle = '#140c08'; c.beginPath(); c.arc(x + 5 + i * 10, y + hh + 8, 4.6, 0, 6.3); c.fill(); c.fillStyle = pips[1]; c.beginPath(); c.arc(x + 5 + i * 10, y + hh + 8, 3.2, 0, 6.3); c.fill(); }
    c.restore();
  }
  // Le rocher de la catapulte : il tourne en l'air, son ombre file au sol jusqu'à sa cible. Le gros (tiré du centre sur
  // le camp adverse) grossit en haut de sa course, comme s'il passait près de la caméra ; le petit (défense du camp) non.
  drawBoulder(p, small = false) {
    const c = this.ctx, k = p.k || 0, g0 = p.sy + 84, gx = p.sx + (p.tx - p.sx) * k, gy = g0 + (p.ty - g0) * k, up = Math.sin(Math.PI * k);
    c.fillStyle = `rgba(0,0,0,${0.16 + 0.22 * (1 - up)})`; ellipse(c, gx, gy, (small ? 12 : 23) + (small ? 7 : 17) * (1 - up), (small ? 5 : 8) + (small ? 3 : 7) * (1 - up)); c.fill();
    const R = small ? 13 + 3 * up : 27 + 21 * up;
    c.save(); c.translate(p.x, p.y); c.rotate(this.time * 7);
    c.beginPath(); ROCK.forEach(([an, q], i) => { const x = Math.cos(an) * R * q, y = Math.sin(an) * R * q; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
    const g = c.createRadialGradient(-R * 0.3, -R * 0.35, 2, 0, 0, R * 1.1); g.addColorStop(0, '#ecd0a8'); g.addColorStop(0.55, '#a87a50'); g.addColorStop(1, '#5a3a24');
    c.fillStyle = g; c.fill(); c.lineWidth = 4.5; c.strokeStyle = '#2a1608'; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.32)'; ellipse(c, -R * 0.3, -R * 0.38, R * 0.28, R * 0.16); c.fill();
    c.restore();
    if (Math.random() < (small ? 0.25 : 0.6)) this.fx('smoke_puff', p.x + rand(-10, 10), p.y + rand(-10, 10), { s0: small ? 0.05 : 0.1, s1: small ? 0.14 : 0.26, life: 0.5, a: 0.55 });
  }
  // bulle, boule d'eau, vague : de l'eau qui brille, et des gouttes qui s'en échappent
  drawWater(p) {
    const c = this.ctx, t = this.time, an = p.ang !== undefined ? p.ang : Math.atan2(p.ty - p.y, p.tx - p.x);
    if (p.key === 'wave') {
      c.save(); c.translate(p.x, p.y); c.rotate(an); c.scale(1.8, 1.8); c.lineCap = 'round';
      for (let i = 0; i < 3; i++) { c.strokeStyle = i ? `rgba(225,248,255,${0.9 - i * 0.25})` : 'rgba(40,140,230,.85)'; c.lineWidth = i ? 2.6 - i * 0.7 : 6; c.beginPath(); c.arc(-i * 5, 0, 13 - i * 2, -1.15, 1.15); c.stroke(); }
      c.restore(); c.lineCap = 'butt';
      if (Math.random() < 0.8) this.dot(p.x + rand(-11, 11), p.y + rand(-14, 14), { vx: -Math.cos(an) * 30, vy: -Math.sin(an) * 30 - 20, g: 200, r: rand(1.2, 2.2), col: '200,240,255', life: 0.4 });
      return;
    }
    const n = p.key === 'bubbles' ? 3 : 1, R0 = 1.8 * (p.key === 'waterball' ? 6.5 : p.key === 'bubbles' ? 4.5 : 4);
    for (let i = 0; i < n; i++) {
      const ox = n > 1 ? Math.cos(t * 6 + i * 2.1) * 9 : 0, oy = n > 1 ? Math.sin(t * 6 + i * 2.1) * 5.4 : 0, R = R0 * (1 + 0.08 * Math.sin(t * 14 + i));
      const x = p.x + ox, y = p.y + oy, g = c.createRadialGradient(x - R * 0.35, y - R * 0.4, 0.5, x, y, R);
      if (p.key === 'waterball') { g.addColorStop(0, '#e8fbff'); g.addColorStop(0.45, '#58c4ff'); g.addColorStop(1, '#1f6fd0'); }
      else { g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.5, 'rgba(170,230,255,.35)'); g.addColorStop(1, 'rgba(120,200,255,.55)'); }
      c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 6.3); c.fill();
      c.lineWidth = 2; c.strokeStyle = p.key === 'waterball' ? 'rgba(20,60,140,.7)' : 'rgba(255,255,255,.85)'; c.stroke();
    }
    if (Math.random() < (p.key === 'waterball' ? 0.7 : 0.25)) this.dot(p.x + rand(-3, 3), p.y + rand(-3, 3), { vx: -Math.cos(an) * 25, vy: -Math.sin(an) * 25, g: 160, r: rand(1, 1.8), col: '170,225,255', life: 0.35 });
  }
  drawProj(p) {
    const c = this.ctx;
    if (p.key === 'boulder' || p.key === 'stone') { this.drawBoulder(p, p.key === 'stone'); return; }
    if (p.arc) { const k = p.k || 0, g0 = p.info.tower ? p.sy + 230 : p.info.sy, gy = g0 + (p.ty - g0) * k; c.fillStyle = 'rgba(0,0,0,.25)'; ellipse(c, p.x, gy, 13, 5.5); c.fill(); }
    if (p.key === 'bubble' || p.key === 'bubbles' || p.key === 'waterball' || p.key === 'wave') { this.drawWater(p); return; }
    if (p.key === 'banana') {    // la banane dorée tourne en l'air et sème des paillettes
      c.save(); c.translate(p.x, p.y); c.rotate(this.time * 11 + p.T * 7); c.scale(1.25, 1.25);
      c.beginPath(); c.arc(0, -4, 12, 0.35, Math.PI - 0.35); c.arc(0, -10, 10.5, Math.PI - 0.6, 0.6, true); c.closePath();
      const g = c.createLinearGradient(-10, -4, 10, 9); g.addColorStop(0, '#fff8c4'); g.addColorStop(0.45, '#ffd53f'); g.addColorStop(1, '#d48c0c');
      c.fillStyle = g; c.fill(); c.lineWidth = 2.2; c.lineJoin = 'round'; c.strokeStyle = '#5e3406'; c.stroke();
      c.fillStyle = '#5e3406'; c.beginPath(); c.arc(-11.2, 0.6, 1.9, 0, 6.3); c.fill(); c.beginPath(); c.arc(11.2, 0.6, 1.9, 0, 6.3); c.fill();
      c.restore();
      if (Math.random() < 0.7) this.dot(p.x + rand(-5, 5), p.y + rand(-5, 5), { vy: rand(-10, 25), life: rand(0.3, 0.5), r: rand(0.9, 1.4), col: '255,228,120', add: true });
      return;
    }
    if (p.key === 'gust') {      // bourrasque : croissants d'air qui filent
      const an = p.ang !== undefined ? p.ang : Math.atan2(p.ty - p.y, p.tx - p.x);
      c.save(); c.translate(p.x, p.y); c.rotate(an); c.scale(1.8, 1.8); c.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const q = (this.time * 5 + i / 3) % 1, rr2 = 5 + i * 3.4; c.strokeStyle = `rgba(235,250,255,${0.85 - i * 0.22})`; c.lineWidth = 2.6 - i * 0.6; c.beginPath(); c.arc(-i * 6 - q * 3, 0, rr2, -1.0, 1.0); c.stroke(); }
      c.restore(); c.lineCap = 'butt';
      if (Math.random() < 0.5) this.fx('wind_leaves', p.x, p.y, { s0: 0.08, s1: 0.16, life: 0.3, a: 0.6, rot: rand(0, 6) });
      return;
    }
    const big = p.info.tower ? 1.25 : 1;
    this.drawFx(p.key, p.x, p.y, (p.key === 'hearts' ? 0.24 : 0.26) * WS * big, p.key === 'hearts' ? Math.sin(this.time * 12) * 0.3 : this.time * 9, 1);
    if (p.key === 'hearts' && Math.random() < 0.4) this.fx('hearts', p.x, p.y, { s0: 0.1, s1: 0.03, life: 0.35, a: 0.6 });
  }
  // Aperçu de la carte qu'on fait glisser sur l'arène (d.x, d.y en pixels de la carte)
  drawGhost(d) {
    const c = this.ctx, A = ANIMALS[d.id], ok = d.ok, dd = DATA[d.id], S = sprites();
    const offs = (A.count || 1) === 2 ? [[-0.55, 0.1], [0.55, -0.1]] : [[0, 0]];
    if (A.range > 2) { c.lineWidth = 2.2; c.setLineDash([6, 5]); c.lineDashOffset = -this.time * 18; c.strokeStyle = ok ? 'rgba(255,255,255,.75)' : 'rgba(255,80,60,.85)'; ellipse(c, d.x, d.y, (A.range + A.radius) * TILE, (A.range + A.radius) * TILE * 0.8); c.stroke(); c.setLineDash([]); }
    for (const [ox, oy] of offs) {
      const x = d.x + ox * TILE, y = d.y + oy * TILE, rw = A.radius * TILE * 1.5 * (1 + 0.06 * Math.sin(this.time * 7));
      c.globalAlpha = ok ? 1 : 0.9; c.drawImage(ok ? S.ring0 : S.ring1, x - rw, y + 1.5 - rw * 0.5, rw * 2, rw); c.globalAlpha = 1;
      if (dd) drawUnitFrame(c, d.id, 'walk_N', Math.floor(this.time * 8), x, y - ((A.air ? AIR_LIFT : 0) + 4 + 3 * Math.sin(this.time * 7)) * WS, WS, ok ? 0.78 : 0.42);
    }
    label(c, A.name, d.x, d.y - ((dd ? dd.walkH : 90) + (A.air ? AIR_LIFT : 0) + 30) * WS, 14, ok ? '#fff' : '#ff8a7a');
  }
  drawDragCard(d) {
    const c = this.ctx, img = IMG['card_' + d.id]; if (!img || !img.width) return;
    const w = 112, hh = 154; c.globalAlpha = 0.95; c.drawImage(img, d.sxp - w / 2, d.syp - hh * 0.7, w, hh); c.globalAlpha = 1;
  }

  // ---------- haut de l'écran : adversaire, horloge, les deux jauges, les tours ----------
  drawTop(b, ui, dt) {
    const c = this.ctx;
    c.fillStyle = 'rgba(20,12,30,.74)'; rr(c, 12, 10, 286, 66, 16); c.fill();
    c.save(); c.beginPath(); c.rect(12, 10, 282, 66); c.clip();
    label(c, ui.opp.name, 26, 32, 27, '#ffb4a8', 'left');
    label(c, ui.opp.clanName || 'Sans clan', 28, 59, 18, '#e8dccb', 'left');
    c.restore();
    const t = Math.max(0, Math.ceil(b.clock)), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0'), hot = b.overtime || t <= 10;
    c.fillStyle = 'rgba(20,12,30,.74)'; rr(c, W - 176, 10, 164, 66, 16); c.fill();
    label(c, b.overtime ? 'Mort subite' : 'Temps restant', W - 94, 26, 17, b.overtime ? '#ff9a7a' : '#e8dccb');
    label(c, mm + ':' + ss, W - 94, 54, 36 * (hot ? 1 + 0.06 * Math.sin(this.time * 10) : 1), hot ? '#ff6a5a' : '#fff');
    // la vie des deux camps : la bleue part de la gauche, la rouge de la droite, elles se vident vers les bords
    const [gx, gy, gw, gh] = HUD.gauge, mid = gx + gw / 2, bx0 = gx + 62, bw = mid - 36 - bx0, by = gy + 14, bh = gh - 28;
    const val = (s) => 100 * Math.max(0, b.camps[s].hp) / b.camps[s].maxHp;
    if (!this.chp) this.chp = b.camps.map((cp) => cp.hp);
    for (let s = 0; s < 2; s++) { if (b.camps[s].hp < this.chp[s]) this.cpulse[s] = 1; this.chp[s] = b.camps[s].hp; this.cpulse[s] = Math.max(0, this.cpulse[s] - dt * 2.5); }
    c.fillStyle = 'rgba(20,12,30,.8)'; rr(c, gx, gy, gw, gh, 20); c.fill();
    for (let s = 0; s < 2; s++) {
      const vs = val(s), g = vs / 100, x = s === 0 ? bx0 : mid + 36, lead = vs > val(1 - s) + 0.01, pulse = this.cpulse[s];
      c.fillStyle = '#0c0814'; rr(c, x - 4, by - 4, bw + 8, bh + 8, 14); c.fill();
      c.fillStyle = s === 0 ? '#14284a' : '#4a1614'; rr(c, x, by, bw, bh, 10); c.fill();
      if (g > 0.002) {
        const fw = Math.max(10, bw * g), fx0 = s === 0 ? x : x + bw - fw, gr = c.createLinearGradient(0, by, 0, by + bh);
        if (s === 0) { gr.addColorStop(0, '#a6e8ff'); gr.addColorStop(0.45, '#2fa8ff'); gr.addColorStop(1, '#1663c8'); } else { gr.addColorStop(0, '#ffb8a4'); gr.addColorStop(0.45, '#ff4a3a'); gr.addColorStop(1, '#b81e1a'); }
        c.fillStyle = gr; rr(c, fx0, by, fw, bh, 10); c.fill();
        c.fillStyle = 'rgba(255,255,255,.4)'; rr(c, fx0 + 5, by + 4, Math.max(0, fw - 10), 6, 3); c.fill();
        if (pulse > 0.02) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,255,255,${0.45 * pulse})`; rr(c, fx0, by, fw, bh, 10); c.fill(); c.globalCompositeOperation = 'source-over'; }
      }
      label(c, campPct(b.camps[s]) + ' %', s === 0 ? x + 14 : x + bw - 14, by + bh / 2 + 1, lead ? 27 : 23, lead ? '#fff' : '#d9d2e6', s === 0 ? 'left' : 'right', 0.24);
      label(c, s === 0 ? 'Ton camp' : 'Camp adverse', s === 0 ? x + bw - 12 : x + 12, by + bh / 2 + 1, 17, 'rgba(255,255,255,.82)', s === 0 ? 'right' : 'left', 0.22);
      // la tour de ce côté de l'arène : grise tant qu'elle est en cage, puis à la couleur de celui qui la tient
      const tw = b.towers[s], tx = s === 0 ? gx + 32 : gx + gw - 32, col = tw.side < 0 ? '#8a8496' : TEAM[tw.side];
      c.fillStyle = '#0c0814'; c.beginPath(); c.arc(tx, gy + gh / 2, 23, 0, 6.3); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(tx, gy + gh / 2, 19, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(tx - 9, gy + gh / 2 - 4, 18, 14); c.fillRect(tx - 12, gy + gh / 2 - 11, 6, 8); c.fillRect(tx - 3, gy + gh / 2 - 11, 6, 8); c.fillRect(tx + 6, gy + gh / 2 - 11, 6, 8);
      c.fillStyle = col; c.fillRect(tx - 3, gy + gh / 2 + 2, 6, 8);
    }
    // au milieu : « VS »
    c.fillStyle = '#0c0814'; c.beginPath(); c.arc(mid, gy + gh / 2, 30, 0, 6.3); c.fill();
    const vg = c.createLinearGradient(0, gy + gh / 2 - 26, 0, gy + gh / 2 + 26); vg.addColorStop(0, '#ffe680'); vg.addColorStop(1, '#e88a00');
    c.fillStyle = vg; c.beginPath(); c.arc(mid, gy + gh / 2, 26, 0, 6.3); c.fill();
    label(c, 'VS', mid, gy + gh / 2 + 1, 25, '#fff', 'center', 0.24);
  }
  // ---------- mini-carte : toute l'arène, les animaux, les tours, et le cadre de ce que montre la caméra ----------
  drawMini(b, ui) {
    for (let i = this.pings.length - 1; i >= 0; i--) { const p = this.pings[i]; p.age += 1 / 60; if (p.age > 1.6) this.pings.splice(i, 1); }
    const show = clamp((this.cam.z - ZOOM.min - 0.05) / 0.12, 0, 1); if (show <= 0) return;
    const c = this.ctx, [x, y, w, h] = HUD.mini, k = w / MAP_W, im = IMG.mini, R = this.R;
    c.save(); c.globalAlpha = show;
    c.fillStyle = '#0c0814'; rr(c, x - 5, y - 5, w + 10, h + 10, 14); c.fill();
    c.save(); rr(c, x, y, w, h, 10); c.clip();
    if (im && im.width) c.drawImage(im, x, y, w, h); else { c.fillStyle = '#3d6b2a'; c.fillRect(x, y, w, h); }
    c.fillStyle = 'rgba(10,6,26,.22)'; c.fillRect(x, y, w, h);
    for (const s of b.crates) if (!s.dead) { c.fillStyle = '#2a1608'; c.fillRect(x + s.x * k - 4.5, y + s.y * k - 4.5, 9, 9); c.fillStyle = '#ffb648'; c.fillRect(x + s.x * k - 3, y + s.y * k - 3, 6, 6); }
    for (const t of b.towers) { c.fillStyle = '#0c0814'; c.beginPath(); c.arc(x + t.x * k, y + (t.y - 40) * k, 9, 0, 6.3); c.fill(); c.fillStyle = t.side < 0 ? '#c9c2d6' : TEAM[t.side]; c.beginPath(); c.arc(x + t.x * k, y + (t.y - 40) * k, 6.5, 0, 6.3); c.fill(); }
    for (const cp of b.catas) {      // les catapultes : un losange aux couleurs du camp (gris quand elle est cassée)
      const cx = x + cp.x * k, cy = y + cp.y * k;
      c.fillStyle = '#0c0814'; c.beginPath(); c.moveTo(cx, cy - 8); c.lineTo(cx + 8, cy); c.lineTo(cx, cy + 8); c.lineTo(cx - 8, cy); c.closePath(); c.fill();
      c.fillStyle = cp.dead ? '#8a8496' : TEAM[cp.side]; c.beginPath(); c.moveTo(cx, cy - 5.5); c.lineTo(cx + 5.5, cy); c.lineTo(cx, cy + 5.5); c.lineTo(cx - 5.5, cy); c.closePath(); c.fill();
    }
    for (const cp of b.camps) { const cx = x + cp.x * k, cy = y + cp.y * k + (cp.side === 0 ? 10 : -10), r = Math.max(0, cp.hp) / cp.maxHp; c.fillStyle = '#0c0814'; rr(c, cx - 19, cy - 5, 38, 10, 4); c.fill(); c.fillStyle = TEAM[cp.side]; if (r > 0) { rr(c, cx - 17, cy - 3, 34 * r, 6, 3); c.fill(); } }
    if (b.gold) {
      const gb = b.gold.box; if (gb && !gb.dead) { const p = 0.5 + 0.5 * Math.sin(this.time * 8); c.fillStyle = '#2a1608'; c.fillRect(x + gb.x * k - 6, y + gb.y * k - 6, 12, 12); c.fillStyle = `rgb(255,${200 + 40 * p | 0},60)`; c.fillRect(x + gb.x * k - 4.5, y + gb.y * k - 4.5, 9, 9); }
      for (const m of b.gold.monkeys) if (!m.gone) { c.fillStyle = '#2a1608'; c.beginPath(); c.arc(x + m.x * k, y + m.y * k, 6, 0, 6.3); c.fill(); c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(x + m.x * k, y + m.y * k, 4.5, 0, 6.3); c.fill(); }
    }
    for (const u of b.units) { if (u.dead) continue; c.fillStyle = '#0c0814'; c.beginPath(); c.arc(x + u.x * k, y + u.y * k, 5, 0, 6.3); c.fill(); c.fillStyle = ui.picked.has(u.id) ? '#fff27a' : TEAM[u.side]; c.beginPath(); c.arc(x + u.x * k, y + u.y * k, 3.4, 0, 6.3); c.fill(); }
    for (const p of this.pings) {
      for (const d of [0, 0.45]) { const q = (p.age + d) % 0.9 / 0.9; c.globalAlpha = show * (1 - q) * Math.min(1, (1.6 - p.age) * 2); c.lineWidth = 3; c.strokeStyle = p.col; c.beginPath(); c.arc(x + p.x * k, y + p.y * k, 4 + q * 18, 0, 6.3); c.stroke(); }
      c.globalAlpha = show;
    }
    if (R) { c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.strokeRect(x + Math.max(0, R.x0) * k, y + Math.max(0, R.y0) * k, (Math.min(MAP_W, R.x1) - Math.max(0, R.x0)) * k, (Math.min(MAP_H, R.y0 + (HUD_Y) / this.cam.z) - Math.max(0, R.y0)) * k); }
    c.restore(); c.restore();
  }

  // ---------- barre du bas ----------
  drawHud(b, ui) {
    const c = this.ctx, hud = IMG.hud, me = b.players[0];
    if (hud && hud.width) c.drawImage(hud, 0, HUD_Y, W, hud.height * HK);
    else { c.fillStyle = '#123a7a'; c.fillRect(0, HUD_Y, W, H - HUD_Y); }
    // Aura : la jauge de la maquette est recouverte, puis redessinée segment par segment
    c.fillStyle = '#071938'; c.fillRect(hx(255), hy(205), hx(512), 44 * HK);
    c.fillStyle = '#061a3a'; rr(c, hx(776), hy(203), hx(108), 46 * HK, 10); c.fill();
    const aura = me.aura, full = Math.floor(aura), part = aura - full, boost = b.double || b.overtime;
    for (let i = 0; i < 10; i++) {
      const x0 = hx(260 + i * 50.25), w = hx(48), y0 = hy(210), hh = 32 * HK;
      c.fillStyle = '#0f2a5a'; rr(c, x0, y0, w, hh, 6); c.fill();
      const f = i < full ? 1 : i === full ? part : 0;
      if (f > 0) {
        const g = c.createLinearGradient(0, y0, 0, y0 + hh);
        if (boost) { g.addColorStop(0, '#ffc2f4'); g.addColorStop(0.45, '#ff6ad5'); g.addColorStop(1, '#b02aa8'); } else { g.addColorStop(0, '#fff07a'); g.addColorStop(0.45, '#ffc21a'); g.addColorStop(1, '#f08a00'); }
        c.fillStyle = g; c.globalAlpha = i < full ? 1 : 0.55; rr(c, x0, y0, w * f, hh, 6); c.fill(); c.globalAlpha = 1;
        if (i < full) { c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(x0 + 4, y0 + 3, w - 8, 5); }
      }
    }
    { // tête de la jauge : halo, et reflet qui parcourt les cases pleines
      const S = sprites(), hxp = hx(260 + Math.min(10, aura) * 50.25), hyp = hy(210) + 16 * HK;
      c.globalCompositeOperation = 'lighter';
      if (aura < 10) { c.globalAlpha = 0.5 + 0.25 * Math.sin(this.time * 9); c.drawImage(S.glow, hxp - 22, hyp - 26, 44, 52); }
      const sw = ((this.time * 0.55) % 1.6) * hx(512) * 1.25 - 60, x0 = hx(258), x1 = hx(260 + full * 50.25);
      if (full > 0 && sw > x0 - 60 + 0 && sw + x0 < x1 + 40) { c.save(); c.beginPath(); c.rect(x0, hy(210), x1 - x0, 32 * HK); c.clip(); c.globalAlpha = 0.5; c.drawImage(S.glow, x0 + sw - 40, hy(210) - 20, 80, 32 * HK + 40); c.restore(); }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      if (this.auraN >= 0 && full > this.auraN) for (let i = this.auraN; i < full; i++) this.fx('star_big', hx(284 + i * 50.25), hyp, { s0: 0.12, s1: 0.42, life: 0.3, add: true, top: true, rot: rand(0, 3) });
      this.auraN = full;
    }
    label(c, String(full), hx(828), hy(226), 36, boost ? '#ffb4ee' : '#fff');
    if (boost) label(c, 'Aura x2', hx(512), hy(188), 22, '#ffb4ee');
    // cartes en main : la nouvelle carte glisse depuis « Suivante », une carte qui devient jouable brille un instant
    const p0 = b.players[0], [nxX, nxY, nxW, nxH] = HUD.next;
    handOf(b, 0).forEach((card, i) => {
      const [x, y, w, hh] = HUD.slots[i], hv = this.hand[i];
      if (!card) return;
      if (hv.ci !== p0.hand[i]) { hv.t = hv.ci === undefined ? -0.08 * i : 0; hv.ci = p0.hand[i]; hv.ok = aura >= card.cost; hv.pulse = 0; hv.first = hv.first === undefined; }
      hv.t += 1 / 60;
      const can = aura >= card.cost;
      if (can && !hv.ok) hv.pulse = 1;
      hv.ok = can; hv.pulse = Math.max(0, hv.pulse - 1 / 60 * 2.6);
      const img = IMG['card_' + card.id], sel = ui.sel === i, lift = sel ? -22 : 0;
      const dragging = ui.drag && ui.drag.slot === i && ui.drag.moved;
      const ch = hh + 10, cw = ch * 400 / 550;
      let cx = x + w / 2 - cw / 2, cy = y - 6 + lift, sc = 1 + 0.05 * hv.pulse, al = 1;
      if (hv.t < 0) return;
      if (hv.t < 0.3) {
        const k = easeOut(hv.t / 0.3), ov = 1 + 0.12 * Math.sin(k * Math.PI);
        if (hv.first) { cy += (1 - k) * 220; al = k; sc *= ov; }
        else { const fx0 = nxX + nxW / 2 - cw / 2, fy0 = nxY + nxH / 2 - ch / 2; cx = fx0 + (cx - fx0) * k; cy = fy0 + (cy - fy0) * k; sc *= (nxH / ch) + (1 - nxH / ch) * k; sc *= ov; }
      }
      if (!can && !sel) sc *= 0.96;
      const dw = cw * sc, dh = ch * sc, dx = cx + cw / 2 - dw / 2, dy = cy + ch / 2 - dh / 2;
      if (sel) { c.save(); c.shadowColor = '#fff36b'; c.shadowBlur = 26; c.fillStyle = 'rgba(255,240,120,.9)'; rr(c, dx - 4, dy - 4, dw + 8, dh + 8, 14); c.fill(); c.restore(); }
      if (img && img.width) { c.globalAlpha = (dragging ? 0.35 : 1) * al; c.drawImage(img, dx, dy, dw, dh); c.globalAlpha = 1; }
      if (!can) { c.fillStyle = 'rgba(10,14,30,.58)'; rr(c, dx, dy, dw, dh * (1 - aura / card.cost), 10); c.fill(); }
      if (hv.pulse > 0.02 && img && img.width) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = hv.pulse * 0.6; c.drawImage(img, dx, dy, dw, dh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
      const bx = dx + dw / 2, by = dy + dh - 6;
      const g = c.createRadialGradient(bx - 5, by - 5, 2, bx, by, 21);
      if (can) { g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#e88a00'); } else { g.addColorStop(0, '#b9b3c9'); g.addColorStop(1, '#6a6480'); }
      c.globalAlpha = al; c.fillStyle = '#1a1008'; c.beginPath(); c.arc(bx, by, 22, 0, 6.3); c.fill(); c.fillStyle = g; c.beginPath(); c.arc(bx, by, 18, 0, 6.3); c.fill();
      label(c, String(card.cost), bx, by + 1, 28, '#fff', 'center', 0.22); c.globalAlpha = 1;
    });
    const nx = nextOf(b, 0);
    if (nx) {
      const [x, y, w, hh] = HUD.next, img = IMG['card_' + nx.id];
      c.fillStyle = 'rgba(20,12,30,.7)'; rr(c, x - 6, y - 30, w + 12, hh + 38, 12); c.fill();
      label(c, 'Suivante', x + w / 2, y - 14, 17, '#e8dccb');
      if (img && img.width) c.drawImage(img, x, y, w, hh);
    }
    const home = b.units.some((u) => !u.dead && u.side === 0 && u.order && u.order.home);
    this.drawOrderBtn(HUD.whistle, home, '#7fd4ff');
    this.drawOrderBtn(HUD.attack, ui.mode, '#ffd23f');
    this.drawCataBtn(b, ui);
    if (ui.picked.size) { const [x, y, w] = HUD.attack; c.fillStyle = '#1a1008'; c.beginPath(); c.arc(x + w - 12, y + 12, 23, 0, 6.3); c.fill(); c.fillStyle = '#fff27a'; c.beginPath(); c.arc(x + w - 12, y + 12, 19, 0, 6.3); c.fill(); label(c, String(ui.picked.size), x + w - 12, y + 13, 25, '#3a2206', 'center', 0); }
    if (ui.hint) {
      const big = ui.mode, size = big ? 30 : 26; c.font = `${size}px "Lilita One",sans-serif`;
      const tw = c.measureText(ui.hint).width + 44;
      c.fillStyle = 'rgba(20,12,30,.66)'; rr(c, W / 2 - tw / 2, HUD_Y - 58, tw, 46, 20); c.fill();
      label(c, ui.hint, W / 2, HUD_Y - 35, size, big ? '#ffd23f' : '#fff3d0');
    }
  }
  // Bouton de la catapulte, au-dessus d'« Attaquer » : Défense (elle garde le camp) ou Attaque (elle tire depuis le
  // centre) ; on le touche pour changer. En route, cassée (la réparation avance) ou rechargement au centre.
  drawCataBtn(b, ui) {
    const c = this.ctx, cp = b.catas[0], [x, y, w, hh] = HUD.cata, atk = cp.want === 'centre', t = this.time;
    const col = cp.dead ? ['#a49eb2', '#5a546a'] : atk ? ['#ffc06a', '#e0601c'] : ['#8fdcff', '#1f74d8'];
    if (ui.cataGlow) { c.save(); c.globalAlpha = 0.55 + 0.4 * Math.sin(t * 8); c.lineWidth = 8; c.strokeStyle = '#fff27a'; c.shadowColor = '#fff27a'; c.shadowBlur = 26; rr(c, x - 6, y - 6, w + 12, hh + 12, 22); c.stroke(); c.restore(); }
    c.fillStyle = 'rgba(12,8,24,.85)'; rr(c, x - 4, y - 4, w + 8, hh + 8, 20); c.fill();
    const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    c.fillStyle = g; rr(c, x, y, w, hh, 16); c.fill();
    c.fillStyle = 'rgba(255,255,255,.28)'; rr(c, x + 8, y + 5, w - 16, 9, 4.5); c.fill();
    const bob = cp.moving ? Math.abs(Math.sin(t * 8)) * 2 : 0;
    if (cp.dead && CANFILTER) c.filter = 'grayscale(1) brightness(0.85)';
    drawUnitFrame(c, 'cata0', cp.moving ? 'move_E' : 'fire_E', cp.moving ? Math.floor(t * 10) % 8 : 0, x + w / 2, y + 70 - bob, 0.66);
    if (cp.dead && CANFILTER) c.filter = 'none';
    const txt = cp.dead ? 'Réparation' : cp.moving ? (atk ? 'Vers le centre' : 'Vers le camp') : atk ? 'Attaque' : 'Défense';
    label(c, txt, x + w / 2, y + hh - 26, cp.moving || cp.dead ? 17 : 22, '#fff', 'center', 0.26);
    // petite barre : réparation, ou rechargement du prochain tir depuis le centre
    let k = -1;
    if (cp.dead) k = 1 - cp.repairT / CATA.repair; else if (cp.at === 'centre' && !cp.moving) k = 1 - Math.max(0, cp.cd) / CATA.atk.every;
    if (k >= 0) { c.fillStyle = 'rgba(12,8,24,.75)'; rr(c, x + 14, y + hh - 12, w - 28, 7, 3.5); c.fill(); c.fillStyle = cp.dead ? '#ffd23f' : '#fff27a'; rr(c, x + 14, y + hh - 12, Math.max(3, (w - 28) * clamp(k, 0, 1)), 7, 3.5); c.fill(); }
    label(c, 'Catapulte', x + w / 2, y - 14, 16, '#e8dccb', 'center', 0.3);
  }
  drawOrderBtn([x, y, w, hh], active, col) {
    if (!active) return;
    const c = this.ctx;
    c.save(); c.globalAlpha = 0.55 + 0.35 * Math.sin(this.time * 9); c.lineWidth = 8; c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 24; rr(c, x - 2, y - 2, w + 4, hh + 4, 22); c.stroke(); c.restore();
  }
  drawBanners(dt) {
    const c = this.ctx;
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const bn = this.banners[i]; bn.age += dt; if (bn.age < 0) continue;
      if (bn.age >= bn.life) { this.banners.splice(i, 1); continue; }
      const q = bn.age / bn.life, s = q < 0.12 ? 0.4 + q / 0.12 * 0.75 : 1.15 - Math.min(0.15, (q - 0.12) * 1.2), al = q > 0.8 ? (1 - q) / 0.2 : 1;
      if (bn.img) { const im = IMG[bn.img]; if (im && im.width) { const w = im.width * bn.s * s, hh = im.height * bn.s * s; c.globalAlpha = al; c.drawImage(im, W / 2 - w / 2, bn.y - hh / 2, w, hh); c.globalAlpha = 1; } }
      else drawText(c, bn.str, W / 2, bn.y, bn.size * s, bn.tint, al);
    }
  }
}

