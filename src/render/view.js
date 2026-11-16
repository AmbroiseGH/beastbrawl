// Affichage du combat sur un canvas : la grande arène vue de près par une caméra que le joueur fait défiler, les
// structures (cible et jauges, tours, boîtes), les animaux animés, projectiles, effets, et l'habillage (jauges, mini-carte,
// barre du bas : Aura, cartes, Siffler, Attaquer). Ne décide de rien : il dessine l'état du moteur (src/game/rt.js) et
// ce que battle.js lui passe.
import { IMG, DATA } from '../core/assets.js';
import { clamp, rand } from '../core/utils.js';
import { handOf, nextOf, deployZones, DEPLOY_DELAY, TILE, WS } from '../game/rt.js';
import { ANIMALS } from '../data/animals.js';
import { MAP_W, MAP_H, MAP_K, PROPS, GW, GH } from '../data/map.js';
import { GRID } from '../game/nav.js';
import { MapFx } from './mapfx.js';

export const W = 941, H = 1672;
const HK = 941 / 1024, HUD_Y = 1426;           // barre du bas : maquette de 1024 px de large, posée en bas de l'écran
export const FH = HUD_Y;                       // au-dessus de cette ligne : l'arène
const hx = (x) => x * HK, hy = (y) => HUD_Y + y * HK;
// Zones de l'habillage (pixels de scène)
export const HUD = {
  whistle: [26, 1458, 151, 133], attack: [763, 1458, 152, 133],
  slots: [[196, 1442, 126, 147], [336, 1442, 125, 147], [478, 1442, 125, 147], [619, 1442, 125, 147]],
  next: [14, 1338, 66, 90], gauge: [12, 86, 917, 64], mini: [14, 162, 216, 144],
};
// Caméra : zoom en pixels de scène par pixel de carte. Au plus loin, la carte tient en hauteur entre les jauges et la barre du bas.
export const ZOOM = { min: 1.29, max: 2.5, start: 1.72 };
const VY = 768;                                // hauteur de l'écran où tombe le centre de la caméra
const CAM_TOP = 104;                           // le haut de la carte peut descendre jusque-là (sous les jauges)
const DIR8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const TINTS = { white: null, yellow: '#ffe14a', orange: '#ff9a2e', red: '#ff5a4a', green: '#8dff5a', blue: '#7fd4ff', grey: '#d9dde6', pink: '#ff8ad8' };
const fonts = {};
export const AIR_LIFT = 56;                    // hauteur de vol des animaux volants (pixels de leur planche)

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
const DROP_T = 0.22, DROP_H = 170;            // un animal posé tombe du ciel en DROP_T secondes

const ellipse = (c, x, y, rx, ry) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.3); };
const TEAM = ['#39a9ff', '#ff5a4a'], TEAM_LITE = ['#bfe6ff', '#ffd0c4'];
const AMBIENT = [null, '#fff0dc', '#e4f6dc', null, '#dbe9ff', '#ffd9cb'];      // teinte de l'air selon l'arène
const JARS = [[716, 431, 44, 56], [775, 431, 44, 56]];                         // verre des deux bocaux : bleu à gauche, rouge à droite

export class View {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.k = 1;
    this.parts = []; this.texts = []; this.decals = []; this.dots = []; this.vis = new Map(); this.svis = new Map();
    this.shake = 0; this.time = 0; this.flash = 0; this.flashColor = '255,255,255'; this.banners = [];
    this.hand = [{}, {}, {}, {}]; this.auraN = -1; this.mapfx = new MapFx(); this.zoneCv = {};
    this.cam = { x: 767, y: 512, z: ZOOM.min }; this.camT = null; this.gv = [0, 0]; this.gpulse = [0, 0]; this.pings = [];
  }
  resize(scale) {
    const k = clamp(scale * (window.devicePixelRatio || 1), 0.5, 1.35);
    if (Math.abs(k - this.k) < 0.02 && this.cv.width > 300) return;
    this.k = k; this.cv.width = Math.round(W * k); this.cv.height = Math.round(H * k);
  }
  reset(arena) {
    this.parts.length = 0; this.texts.length = 0; this.decals.length = 0; this.dots.length = 0; this.vis.clear(); this.svis.clear(); this.shake = 0; this.flash = 0; this.banners.length = 0;
    this.arena = arena; this.hand = [{}, {}, {}, {}]; this.auraN = -1; this.mapfx.reset(); this.gv = [0, 0]; this.gpulse = [0, 0];
    this.cam = { x: 767, y: 512, z: ZOOM.min }; this.camT = null; this.pings = [];
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
  dot(x, y, o = {}) { this.dots.push({ x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.5, r: o.r || 2, col: o.col || '120,200,255', add: !!o.add, tx: o.tx, ty: o.ty }); if (this.dots.length > 420) this.dots.shift(); }
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
  draw(dt, b, ui) {
    const c = this.ctx, k = this.k; this.time += dt;
    this.stepCam(dt);
    const cam = this.cam, z = cam.z;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = '#17102a'; c.fillRect(0, 0, W, H);
    let shx = 0, shy = 0;
    if (this.shake > 0.3) { shx = rand(-1, 1) * this.shake; shy = rand(-1, 1) * this.shake; this.shake *= Math.pow(0.002, dt); } else this.shake = 0;
    c.setTransform(k * z, 0, 0, k * z, k * (W / 2 - cam.x * z + shx), k * (VY - cam.y * z + shy));
    const R = this.R = { x0: cam.x - W / 2 / z, x1: cam.x + W / 2 / z, y0: cam.y - VY / z, y1: cam.y + (H - VY) / z };
    this.drawMap(R);
    this.mapfx.ground(c, R, dt);
    if (ui.zone) this.drawZones(b);
    if (ui.mode) { c.fillStyle = 'rgba(12,8,34,.34)'; c.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); }
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.age += dt; if (d.age >= d.life) { this.decals.splice(i, 1); continue; } this.drawFx(d.key, d.x, d.y, d.s * WS, 0, Math.min(1, (d.life - d.age) / 1.2) * 0.8, 0.62); }
    for (const cl of b.clouds) this.drawCloud(cl);
    this.drawMarks(b, ui);
    // structures et animaux, du fond vers l'avant (les animaux volants passent par-dessus)
    const a = ui.alpha, list = [];
    for (const u of b.units) { const y = u.py + (u.y - u.py) * a; list.push({ y: y + (u.air ? 3000 : 0), u }); }
    for (const s of b.crates) list.push({ y: s.y + 16, s });
    for (const t of b.towers) list.push({ y: 566, s: t });
    list.push({ y: 541, s: b.machine }, { y: 2000, tent: 1 });
    list.sort((p, q) => p.y - q.y);
    for (const it of list) { if (it.u) this.drawUnit(it.u, dt, a, b, ui); else if (it.tent) this.prop('tentB'); else this.drawStruct(it.s, dt, b, ui); }
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
    if (this.flash > 0.01) { c.fillStyle = `rgba(${this.flashColor},${this.flash})`; c.fillRect(0, 0, W, HUD_Y); this.flash *= Math.pow(0.002, dt); }
    this.drawTop(b, ui, dt);
    this.drawMini(b, ui);
    this.drawHud(b, ui);
    this.stepParts(dt, true);
    this.drawBanners(dt);
    if (ui.drag && !ui.drag.onField && ui.drag.moved) this.drawDragCard(ui.drag);
  }

  drawMap(R) {
    const c = this.ctx, im = IMG.map;
    const x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0)), x1 = Math.min(MAP_W, Math.ceil(R.x1)), y1 = Math.min(MAP_H, Math.ceil(R.y1));
    if (!im || !im.width) { c.fillStyle = '#3d6b2a'; c.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
    c.imageSmoothingQuality = 'medium';
    c.drawImage(im, x0 * MAP_K, y0 * MAP_K, (x1 - x0) * MAP_K, (y1 - y0) * MAP_K, x0, y0, x1 - x0, y1 - y0);
  }
  // Un élément détouré de la carte (boîte, cage, tour, machine, tente), à sa place d'origine (+ décalage), agrandi autour de son pied
  prop(name, dx = 0, dy = 0, alpha = 1, sc = 1, add = false) {
    const p = PROPS[name], im = IMG.props, c = this.ctx; if (!p || !im || !im.width) return;
    const w = p[2] / MAP_K, h = p[3] / MAP_K, x = p[4] + dx, y = p[5] + dy;
    c.globalAlpha = alpha; if (add) c.globalCompositeOperation = 'lighter';
    if (sc !== 1) c.drawImage(im, p[0], p[1], p[2], p[3], x + w / 2 - w * sc / 2, y + h - h * sc, w * sc, h * sc);
    else c.drawImage(im, p[0], p[1], p[2], p[3], x, y, w, h);
    c.globalAlpha = 1; if (add) c.globalCompositeOperation = 'source-over';
  }
  // Là où l'on peut poser une carte : en clair, le reste du sol rougit
  drawZones(b) {
    const zs = deployZones(b, 0), key = zs.join(',');
    let z = this.zoneCv[key];
    if (!z) {      // deux petites images à la taille de la grille : la zone (bleue, le reste assombri) et son bord (lumineux)
      const mk = () => { const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH; return cv; };
      const fill = mk(), edge = mk(), g = fill.getContext('2d'), ge = edge.getContext('2d'), id = g.createImageData(GW, GH), ie = ge.createImageData(GW, GH), d = id.data, de = ie.data;
      const ok = (i) => zs.includes(GRID[i]);
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
    const c = this.ctx; c.imageSmoothingEnabled = true;
    c.globalAlpha = 0.85 + 0.15 * Math.sin(this.time * 5); c.drawImage(z.fill, 0, 0, MAP_W, MAP_H);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55 + 0.3 * Math.sin(this.time * 5); c.drawImage(z.edge, 0, 0, MAP_W, MAP_H);
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
        if (s.dead || (s.kind === 'tower' && s.side === 0)) continue;
        this.ring(s.x, s.y + (s.kind === 'crate' ? 6 : s.kind === 'tower' ? 96 : 40), s.rx * (s.kind === 'tower' ? 0.9 : 1.05) + 3 * pulse, (s.kind === 'tower' ? 26 : s.ry * 0.9) + 2 * pulse, `rgba(255,214,60,${0.65 + 0.3 * pulse})`, 3.2, [9, 6], t * 1.2);
      }
      for (const u of b.units) {
        if (u.dead || u.spawn > 0) continue;
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
        const e = g.e, rx = e.kind === 'unit' ? e.r * 1.7 : e.kind === 'tower' ? 64 : e.kind === 'machine' ? 52 : e.rx * 1.05, ry = e.kind === 'unit' ? e.r * 0.85 : e.kind === 'tower' ? 20 : e.kind === 'machine' ? 20 : e.ry * 0.9;
        const gx = e.kind === 'unit' ? e.x : e.x, gy = e.kind === 'unit' ? e.y + 2 : e.kind === 'tower' ? 556 : e.kind === 'machine' ? 530 : e.y + 6;
        this.ring(gx, gy, rx + 2 * pulse, ry + pulse, 'rgba(26,16,8,.6)', 5, [10, 7], t * 1.5);
        this.ring(gx, gy, rx + 2 * pulse, ry + pulse, `rgba(255,80,60,${0.75 + 0.25 * pulse})`, 2.8, [10, 7], t * 1.5);
      }
    }
    for (const u of b.units) {
      if (u.dead || !picked.has(u.id)) continue;
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
      const v = this.vis.get(u.id); if (!v || v.top === undefined) continue;
      const y = v.top - 9 + bob;
      c.fillStyle = '#1a1008'; c.beginPath(); c.moveTo(u.x - 7, y - 8); c.lineTo(u.x + 7, y - 8); c.lineTo(u.x, y + 2); c.closePath(); c.fill();
      c.fillStyle = '#fff27a'; c.beginPath(); c.moveTo(u.x - 4.6, y - 6.6); c.lineTo(u.x + 4.6, y - 6.6); c.lineTo(u.x, y - 0.4); c.closePath(); c.fill();
    }
    const h = ui.hover ? b.ents.get(ui.hover) : null;
    if (h && !h.dead) {
      const img = IMG.ic_target, top = h.kind === 'unit' ? ((this.vis.get(h.id) || {}).top || h.y - 40) - 12 : h.kind === 'tower' ? 300 : h.kind === 'machine' ? 392 : h.y - 52;
      const s = 22 + 3 * Math.sin(t * 9);
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
      c.fillStyle = 'rgba(14,8,24,.28)'; ellipse(c, s.x + 3, s.y + 20, 46, 12); c.fill();
      this.prop(name, jx, 0, 1, sc);
      if (v.flash > 0.02 || glow) this.prop(name, jx, 0, Math.min(1, v.flash * 0.5 + glow), sc, true);
      return;
    }
    if (s.kind === 'machine') {
      this.prop('machine');
      if (glow) this.prop('machine', 0, 0, glow, 1, true);
      this.drawJars(b, dt);
      return;
    }
    // tour latérale : le corps, puis la cage (tant qu'elle n'est à personne) ou l'orang-outan libéré derrière sa rambarde
    const L = s.lane, cx = L === 'L' ? 164 : 1372, m = L === 'L' ? 1 : -1;
    this.prop('tower' + L);
    if (s.side >= 0) {      // la bannière blanche prend la couleur du camp
      c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = s.side === 0 ? '#63b4ff' : '#ff7868';
      c.beginPath(); c.moveTo(cx - 28 * m, 440); c.lineTo(cx + 25 * m, 440); c.lineTo(cx + 25 * m, 510); c.lineTo(cx - 2 * m, 532); c.lineTo(cx - 28 * m, 510); c.closePath(); c.fill(); c.restore();
    }
    if (v.side !== s.side) { v.side = s.side; v.pop = 0; }
    v.pop = Math.min(1, v.pop + dt * 2.2);
    if (s.side < 0) {
      this.prop('cage' + L, jx, v.flash > 0.4 ? rand(-0.8, 0.8) : 0);
      if (v.flash > 0.02 || glow) this.prop('cage' + L, jx, 0, Math.min(1, v.flash * 0.45 + glow), 1, true);
    } else {
      const tg = s.target ? b.ents.get(s.target) : null;
      if (tg && v.throwT < 0.9) { const dx = tg.x - s.x, dy = tg.y - s.topY; v.dir = Math.abs(dx) > Math.abs(dy) * 1.1 ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'); }
      const hop = v.pop < 1 ? Math.sin(v.pop * Math.PI) * 16 : Math.abs(Math.sin(this.time * 2.4 + cx)) * 1.2;
      const thr = v.throwT < 0.62, anim = thr ? 'atk2_' + v.dir : 'walk_S', n = animLen('orang', anim), fr = thr ? Math.min(n - 1, Math.floor((0.38 + v.throwT / 0.62 * 0.62) * n)) : 0;
      c.fillStyle = TEAM[s.side]; c.globalAlpha = 0.55; ellipse(c, cx, 397, 40, 9); c.fill(); c.globalAlpha = 1;
      drawUnitFrame(c, 'orang', anim, fr, cx, 402 - hop, WS * 1.32);
      this.prop('rail' + L);
      if (glow) this.prop('tower' + L, 0, 0, glow, 1, true);
    }
  }
  // Liquide des deux jauges : il monte dans les bocaux, avec une petite houle et des bulles
  drawJars(b, dt) {
    const c = this.ctx, t = this.time;
    for (let s = 0; s < 2; s++) {
      const g = b.players[s].gauge; this.gv[s] += (g - this.gv[s]) * Math.min(1, dt * 6);
      if (g > this.gv[s] + 0.05) this.gpulse[s] = 1; this.gpulse[s] = Math.max(0, this.gpulse[s] - dt * 2.5);
      const [x, y, w, h] = JARS[s], lv = this.gv[s] / 100, top = y + h - h * lv, col = s === 0 ? ['#9fe4ff', '#2f9bff', '#1663c8'] : ['#ffb09a', '#ff4a3a', '#b81e1a'];
      c.save(); rr(c, x, y, w, h, 13); c.clip();
      if (lv > 0.004) {
        const gr = c.createLinearGradient(0, top, 0, y + h); gr.addColorStop(0, col[0]); gr.addColorStop(0.25, col[1]); gr.addColorStop(1, col[2]);
        c.globalAlpha = 0.86; c.fillStyle = gr; c.beginPath(); c.moveTo(x, y + h);
        for (let i = 0; i <= 8; i++) c.lineTo(x + w * i / 8, top + Math.sin(t * 4 + i * 0.9 + s * 2) * (1.1 + 1.6 * this.gpulse[s]));
        c.lineTo(x + w, y + h); c.closePath(); c.fill(); c.globalAlpha = 1;
        c.fillStyle = 'rgba(255,255,255,.55)';
        for (let i = 0; i < 4; i++) { const q = (t * (0.35 + i * 0.07) + i * 0.27 + s * 0.4) % 1, by = y + h - q * h * lv; if (by > top + 2) { c.beginPath(); c.arc(x + w * (0.2 + 0.2 * i) + Math.sin(t * 3 + i) * 1.5, by, 1.1 + (i % 2) * 0.6, 0, 6.3); c.fill(); } }
        if (this.gpulse[s] > 0.02) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,255,255,${0.3 * this.gpulse[s]})`; c.fillRect(x, top - 2, w, y + h - top + 2); c.globalCompositeOperation = 'source-over'; }
      }
      c.fillStyle = 'rgba(255,255,255,.22)'; rr(c, x + 5, y + 6, 6, h - 16, 3); c.fill();      // reflet du verre
      c.restore();
    }
  }
  drawStructBar(s, b, ui) {
    if (s.kind === 'machine' || s.dead) return;
    const r = s.hp / s.maxHp;
    if (s.kind === 'crate' && r >= 1) return;
    if (!this.onScreen(s.x, s.y, 120)) return;
    const c = this.ctx, w = s.kind === 'tower' ? 70 : 44, hh = s.kind === 'tower' ? 8 : 5.5, x = s.x - w / 2, y = s.kind === 'tower' ? 286 : s.y - 62;
    const col = s.kind === 'tower' ? (s.side < 0 ? ['#ffe9a0', '#f0b030'] : s.side === 0 ? ['#8fe0ff', '#1f8fe6'] : ['#ff9a84', '#d92a20']) : ['#ffdf9a', '#d9902a'];
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 1.6, y - 1.6, w + 3.2, hh + 3.2, 3.4); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 2.4); c.fill();
    const g = c.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    c.fillStyle = g; rr(c, x, y, Math.max(2.5, w * r), hh, 2.4); c.fill();
    if (s.kind === 'tower') label(c, s.side < 0 ? 'Cage' : s.side === 0 ? 'À toi' : 'Adverse', s.x, y - 9, 11, s.side < 0 ? '#ffe9a0' : TEAM_LITE[s.side], 'center', 0.3);
  }

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
    const lift = u.air ? AIR_LIFT + Math.sin(this.time * 3 + v.bob) * 6 : 0;
    // arrivée : il tombe, s'écrase un peu, puis attend la fin de son temps de pose
    if (v.age < DROP_T) {
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
    if (u.dead) { const t = u.deadT; if (t > 0.42) return; const k = t / 0.42; alpha = 1 - k * k; sy *= 1 + 0.18 * Math.sin(k * Math.PI) - 0.35 * k; sx *= 1 + 0.22 * Math.sin(k * Math.PI) - 0.2 * k; oy -= 26 * k; shadowK = 1 - k; }
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
    c.save(); c.translate(x, y); c.scale(WS, WS);
    // au sol : anneau du camp, ombre douce
    const ring = u.side === 0 ? S.ring0 : S.ring1, gy = 3;
    if (!u.dead && v.age >= DROP_T * 0.6) {
      const rw = r * (u.air ? 1.15 : 1.42), pulse = v.ready > 0 && v.ready < 2 ? 1 + 0.5 * Math.sin(Math.min(1, v.ready) * Math.PI) * (1 - v.ready / 2) : 1;
      c.globalAlpha = (u.air ? 0.55 : 0.9) * alpha; c.drawImage(ring, -rw * pulse, gy - rw * 0.5 * pulse, rw * 2 * pulse, rw * pulse); c.globalAlpha = 1;
    }
    { const sw = r * (u.air ? 0.95 : 1.5) * shadowK, sh = sw * 0.5; c.globalAlpha = (u.air ? 0.5 : 0.95) * alpha * (0.4 + 0.6 * shadowK); c.drawImage(S.shadow, -sw + (u.air ? 10 : 3), gy - sh + (u.air ? 6 : 1), sw * 2, sh * 2); c.globalAlpha = 1; }
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
    c.restore();
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
    const v = this.vis.get(u.id); if (!v || v.top === undefined) return;
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
  drawProj(p) {
    const c = this.ctx;
    if (p.arc) { const gy = p.sy + (p.ty - p.sy) * (p.k || 0) + (p.info.tower ? (1 - (p.k || 0)) * 150 : 18); c.fillStyle = 'rgba(0,0,0,.25)'; ellipse(c, p.x, gy, 7.5, 3.2); c.fill(); }
    if (p.key === 'gust') {      // bourrasque : croissants d'air qui filent
      const an = p.ang !== undefined ? p.ang : Math.atan2(p.ty - p.y, p.tx - p.x);
      c.save(); c.translate(p.x, p.y); c.rotate(an); c.lineCap = 'round';
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
    // jauges : la bleue se remplit depuis la gauche, la rouge depuis la droite, la cible au milieu
    const [gx, gy, gw, gh] = HUD.gauge, mid = gx + gw / 2, bx0 = gx + 62, bw = mid - 36 - bx0, by = gy + 14, bh = gh - 28;
    c.fillStyle = 'rgba(20,12,30,.8)'; rr(c, gx, gy, gw, gh, 20); c.fill();
    for (let s = 0; s < 2; s++) {
      const g = b.players[s].gauge / 100, x = s === 0 ? bx0 : mid + 36, lead = b.players[s].gauge > b.players[1 - s].gauge + 0.01;
      c.fillStyle = '#0c0814'; rr(c, x - 4, by - 4, bw + 8, bh + 8, 14); c.fill();
      c.fillStyle = s === 0 ? '#14284a' : '#4a1614'; rr(c, x, by, bw, bh, 10); c.fill();
      if (g > 0.002) {
        const fw = Math.max(10, bw * g), fx0 = s === 0 ? x : x + bw - fw, gr = c.createLinearGradient(0, by, 0, by + bh);
        if (s === 0) { gr.addColorStop(0, '#a6e8ff'); gr.addColorStop(0.45, '#2fa8ff'); gr.addColorStop(1, '#1663c8'); } else { gr.addColorStop(0, '#ffb8a4'); gr.addColorStop(0.45, '#ff4a3a'); gr.addColorStop(1, '#b81e1a'); }
        c.fillStyle = gr; rr(c, fx0, by, fw, bh, 10); c.fill();
        c.fillStyle = 'rgba(255,255,255,.4)'; rr(c, fx0 + 5, by + 4, Math.max(0, fw - 10), 6, 3); c.fill();
        if (this.gpulse[s] > 0.02) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,255,255,${0.45 * this.gpulse[s]})`; rr(c, fx0, by, fw, bh, 10); c.fill(); c.globalCompositeOperation = 'source-over'; }
      }
      label(c, Math.floor(b.players[s].gauge) + ' %', s === 0 ? x + 14 : x + bw - 14, by + bh / 2 + 1, lead ? 27 : 23, lead ? '#fff' : '#d9d2e6', s === 0 ? 'left' : 'right', 0.24);
      // la tour de ce côté de l'arène : grise tant qu'elle est en cage, puis à la couleur de celui qui la tient
      const tw = b.towers[s], tx = s === 0 ? gx + 32 : gx + gw - 32, col = tw.side < 0 ? '#8a8496' : TEAM[tw.side];
      c.fillStyle = '#0c0814'; c.beginPath(); c.arc(tx, gy + gh / 2, 23, 0, 6.3); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(tx, gy + gh / 2, 19, 0, 6.3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(tx - 9, gy + gh / 2 - 4, 18, 14); c.fillRect(tx - 12, gy + gh / 2 - 11, 6, 8); c.fillRect(tx - 3, gy + gh / 2 - 11, 6, 8); c.fillRect(tx + 6, gy + gh / 2 - 11, 6, 8);
      c.fillStyle = col; c.fillRect(tx - 3, gy + gh / 2 + 2, 6, 8);
    }
    const pz = 1 + 0.12 * Math.max(this.gpulse[0], this.gpulse[1]);
    for (const [r2, col] of [[30, '#0c0814'], [26, '#fff'], [20, '#ff3b30'], [13.5, '#fff'], [7.5, '#ff3b30']]) { c.fillStyle = col; c.beginPath(); c.arc(mid, gy + gh / 2, r2 * pz, 0, 6.3); c.fill(); }
    void dt;
  }
  // ---------- mini-carte : toute l'arène, les animaux, les tours, et le cadre de ce que montre la caméra ----------
  drawMini(b, ui) {
    const c = this.ctx, [x, y, w, h] = HUD.mini, k = w / MAP_W, im = IMG.mini, R = this.R;
    c.fillStyle = '#0c0814'; rr(c, x - 5, y - 5, w + 10, h + 10, 14); c.fill();
    c.save(); rr(c, x, y, w, h, 10); c.clip();
    if (im && im.width) c.drawImage(im, x, y, w, h); else { c.fillStyle = '#3d6b2a'; c.fillRect(x, y, w, h); }
    c.fillStyle = 'rgba(10,6,26,.22)'; c.fillRect(x, y, w, h);
    for (const s of b.crates) if (!s.dead) { c.fillStyle = '#2a1608'; c.fillRect(x + s.x * k - 4.5, y + s.y * k - 4.5, 9, 9); c.fillStyle = '#ffb648'; c.fillRect(x + s.x * k - 3, y + s.y * k - 3, 6, 6); }
    for (const t of b.towers) { c.fillStyle = '#0c0814'; c.beginPath(); c.arc(x + t.x * k, y + (t.y - 40) * k, 9, 0, 6.3); c.fill(); c.fillStyle = t.side < 0 ? '#c9c2d6' : TEAM[t.side]; c.beginPath(); c.arc(x + t.x * k, y + (t.y - 40) * k, 6.5, 0, 6.3); c.fill(); }
    for (const [r2, col] of [[7, '#fff'], [4.5, '#ff3b30'], [2, '#fff']]) { c.fillStyle = col; c.beginPath(); c.arc(x + 767 * k, y + 505 * k, r2, 0, 6.3); c.fill(); }
    for (const u of b.units) { if (u.dead) continue; c.fillStyle = '#0c0814'; c.beginPath(); c.arc(x + u.x * k, y + u.y * k, 5, 0, 6.3); c.fill(); c.fillStyle = ui.picked.has(u.id) ? '#fff27a' : TEAM[u.side]; c.beginPath(); c.arc(x + u.x * k, y + u.y * k, 3.4, 0, 6.3); c.fill(); }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]; p.age += 1 / 60; if (p.age > 1.6) { this.pings.splice(i, 1); continue; }
      for (const d of [0, 0.45]) { const q = (p.age + d) % 0.9 / 0.9; c.globalAlpha = (1 - q) * Math.min(1, (1.6 - p.age) * 2); c.lineWidth = 3; c.strokeStyle = p.col; c.beginPath(); c.arc(x + p.x * k, y + p.y * k, 4 + q * 18, 0, 6.3); c.stroke(); }
      c.globalAlpha = 1;
    }
    if (R) { c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.strokeRect(x + Math.max(0, R.x0) * k, y + Math.max(0, R.y0) * k, (Math.min(MAP_W, R.x1) - Math.max(0, R.x0)) * k, (Math.min(MAP_H, R.y0 + (HUD_Y) / this.cam.z) - Math.max(0, R.y0)) * k); }
    c.restore();
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
    if (ui.picked.size) { const [x, y, w] = HUD.attack; c.fillStyle = '#1a1008'; c.beginPath(); c.arc(x + w - 12, y + 12, 23, 0, 6.3); c.fill(); c.fillStyle = '#fff27a'; c.beginPath(); c.arc(x + w - 12, y + 12, 19, 0, 6.3); c.fill(); label(c, String(ui.picked.size), x + w - 12, y + 13, 25, '#3a2206', 'center', 0); }
    if (ui.hint) {
      const big = ui.mode, size = big ? 30 : 26; c.font = `${size}px "Lilita One",sans-serif`;
      const tw = c.measureText(ui.hint).width + 44;
      c.fillStyle = 'rgba(20,12,30,.66)'; rr(c, W / 2 - tw / 2, HUD_Y - 58, tw, 46, 20); c.fill();
      label(c, ui.hint, W / 2, HUD_Y - 35, size, big ? '#ffd23f' : '#fff3d0');
    }
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
