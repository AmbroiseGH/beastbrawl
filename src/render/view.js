// Affichage du combat sur un canvas : arène, tours, animaux animés, projectiles, effets, barre du bas (Aura, cartes,
// Siffler, Attaquer). Ne décide de rien : il dessine l'état du moteur (src/game/rt.js) et ce que battle.js lui passe.
import { IMG, DATA } from '../core/assets.js';
import { clamp, rand } from '../core/utils.js';
import { FH, zones, handOf, nextOf, ORDER, DEPLOY_DELAY, RIVER, BRIDGES, BRIDGE_W } from '../game/rt.js';
import { ANIMALS } from '../data/animals.js';

export const W = 941, H = 1672;
const FS = 941 / 838, SX0 = 93;                // terrain de la maquette → scène
const HK = 941 / 1024, HUD_Y = FH;             // barre du bas : maquette de 1024 px de large, posée sous le terrain
const hx = (x) => x * HK, hy = (y) => HUD_Y + y * HK;
// Zones de la barre du bas (pixels de scène)
export const HUD = {
  whistle: [26, 1458, 151, 133], attack: [763, 1458, 152, 133],
  slots: [[196, 1442, 126, 147], [336, 1442, 125, 147], [478, 1442, 125, 147], [619, 1442, 125, 147]],
  next: [14, 1338, 66, 90],
};
const DIR8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const TINTS = { white: null, yellow: '#ffe14a', orange: '#ff9a2e', red: '#ff5a4a', green: '#8dff5a', blue: '#7fd4ff', grey: '#d9dde6', pink: '#ff8ad8' };
const fonts = {};
export const AIR_LIFT = 56;                    // hauteur de vol des animaux volants

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

export class View {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.k = 1;
    this.parts = []; this.texts = []; this.decals = []; this.vis = new Map(); this.tvis = new Map();
    this.shake = 0; this.time = 0; this.flash = 0; this.flashColor = '255,255,255'; this.banners = [];
    this.motes = []; this.glints = []; this.hand = [{}, {}, {}, {}]; this.auraN = -1;
  }
  resize(scale) {
    const k = clamp(scale * (window.devicePixelRatio || 1), 0.5, 1.35);
    if (Math.abs(k - this.k) < 0.02 && this.cv.width > 300) return;
    this.k = k; this.cv.width = Math.round(W * k); this.cv.height = Math.round(H * k);
  }
  reset(arena) { this.parts.length = 0; this.texts.length = 0; this.decals.length = 0; this.vis.clear(); this.tvis.clear(); this.shake = 0; this.flash = 0; this.banners.length = 0; this.arena = arena; this.motes.length = 0; this.glints.length = 0; this.hand = [{}, {}, {}, {}]; this.auraN = -1; }

  // ---------- particules et textes ----------
  fx(key, x, y, o = {}) {
    if (!DATA.fx || !DATA.fx[key]) return;
    this.parts.push({ key, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.4, s0: o.s0 !== undefined ? o.s0 : 0.6, s1: o.s1 !== undefined ? o.s1 : 1, rot: o.rot || 0, vr: o.vr || 0, a: o.a !== undefined ? o.a : 1, add: !!o.add, flat: o.flat || 1, fade: o.fade !== undefined ? o.fade : 0.45, top: !!o.top });
    if (this.parts.length > 260) this.parts.shift();
  }
  burst(key, x, y, n, o = {}) {
    for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 80, o.sp1 || 260); this.fx(key, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g !== undefined ? o.g : 500, life: rand(0.35, 0.7) * (o.life || 1), s0: (o.s || 0.3) * rand(0.7, 1.2), s1: (o.s || 0.3) * rand(0.4, 0.8), rot: rand(0, 6), vr: rand(-6, 6), delay: o.delay || 0, add: o.add, top: o.top }); }
  }
  decal(key, x, y, life = 6, s = 1) { this.decals.push({ key, x, y, age: 0, life, s }); if (this.decals.length > 18) this.decals.shift(); }
  text(str, x, y, o = {}) { this.texts.push({ str: String(str), x, y, vy: o.vy !== undefined ? o.vy : -90, vx: o.vx || 0, age: 0, life: o.life || 0.8, size: o.size || 34, tint: o.tint || 'white', pop: o.pop !== undefined ? o.pop : 1 }); if (this.texts.length > 30) this.texts.shift(); }
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

  // ---------- une image complète ----------
  // b : le combat (rt.js) ; ui : { alpha, drag, sel, armed, opp, hint, zone }
  draw(dt, b, ui) {
    const c = this.ctx, k = this.k; this.time += dt;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.save();
    if (this.shake > 0.3) { c.translate(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake); this.shake *= Math.pow(0.002, dt); } else this.shake = 0;
    this.drawField();
    this.drawGlints(dt);
    if (ui.zone !== undefined && ui.zone !== null) this.drawZones(b, ui.zone);
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.age += dt; if (d.age >= d.life) { this.decals.splice(i, 1); continue; } this.drawFx(d.key, d.x, d.y, d.s, 0, Math.min(1, (d.life - d.age) / 1.2) * 0.8, 0.62); }
    for (const cl of b.clouds) this.drawCloud(cl);
    const me = b.players[0];
    if (me.focus) this.drawFocus(me.focus, b);
    // structures et animaux, du fond vers l'avant (les animaux volants passent par-dessus)
    const a = ui.alpha, list = [];
    for (const t of b.towers) list.push({ y: t.y + t.r * 0.35, t });
    for (const u of b.units) { const y = u.py + (u.y - u.py) * a; list.push({ y: y + (u.air ? 2000 : 0), u }); }
    list.sort((p, q) => p.y - q.y);
    for (const it of list) if (it.t) this.drawTower(it.t, dt); else this.drawUnit(it.u, dt, a, b);
    for (const t of b.towers) this.drawTowerBar(t);
    for (const it of list) if (it.u) this.drawUnitBar(it.u);
    for (const p of b.projs) this.drawProj(p);
    this.stepParts(dt, false);
    this.drawMotes(dt);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.age += dt; if (t.age >= t.life) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt; t.x += t.vx * dt; t.vy *= Math.pow(0.12, dt);
      const q = t.age / t.life, pop = q < 0.15 ? 0.6 + (q / 0.15) * 0.75 * t.pop : 1 + 0.35 * t.pop * Math.max(0, 1 - (q - 0.15) / 0.2);
      drawText(c, t.str, t.x, t.y, t.size * pop, t.tint, q > 0.7 ? (1 - q) / 0.3 : 1);
    }
    if (ui.drag && ui.drag.onField) this.drawGhost(ui.drag);
    c.restore();
    if (this.flash > 0.01) { c.fillStyle = `rgba(${this.flashColor},${this.flash})`; c.fillRect(0, 0, W, FH); this.flash *= Math.pow(0.002, dt); }
    this.drawTop(b, ui);
    this.drawHud(b, ui);
    this.stepParts(dt, true);
    this.drawBanners(dt);
    if (ui.drag && !ui.drag.onField && ui.drag.moved) this.drawDragCard(ui.drag);
  }

  drawField() {
    const c = this.ctx, f = IMG['field' + this.arena];
    if (!f || !f.width) { c.fillStyle = '#3d6b2a'; c.fillRect(0, 0, W, FH + 40); return; }
    c.drawImage(f, SX0 - 88, f.height - 30, 838, 30, 0, FH - 4, W, 44);       // sous les coins de la barre du bas
    c.drawImage(f, SX0 - 88, 0, 838, f.height, 0, 0, W, FH);
  }
  // Reflets qui scintillent sur la rivière (ou la lave) et poussières dorées qui flottent : le décor vit un peu
  drawGlints(dt) {
    const c = this.ctx, S = sprites(), G = this.glints;
    if (G.length < 9 && Math.random() < dt * 5) {
      let x = rand(20, W - 20); for (const bx of BRIDGES) if (Math.abs(x - bx) < BRIDGE_W + 26) x = bx + (x < bx ? -1 : 1) * (BRIDGE_W + 30 + rand(0, 60));
      G.push({ x, y: rand(RIVER[0] + 26, RIVER[1] - 26), age: 0, life: rand(0.7, 1.5), s: rand(10, 22), vx: rand(-14, -4) });
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = G.length - 1; i >= 0; i--) {
      const g = G[i]; g.age += dt; if (g.age >= g.life) { G.splice(i, 1); continue; }
      g.x += g.vx * dt;
      const k = Math.sin(g.age / g.life * Math.PI), w = g.s * (0.6 + 0.8 * k);
      c.globalAlpha = 0.55 * k; c.drawImage(S.glow, g.x - w * 1.6, g.y - w * 0.28, w * 3.2, w * 0.56); c.drawImage(S.glow, g.x - w * 0.3, g.y - w * 0.9, w * 0.6, w * 1.8);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  drawMotes(dt) {
    const c = this.ctx, S = sprites(), M = this.motes;
    if (M.length < 12 && Math.random() < dt * 3) M.push({ x: rand(0, W), y: rand(120, FH - 60), vx: rand(-12, 12), vy: rand(-22, -8), age: 0, life: rand(3, 6), s: rand(5, 11), ph: rand(0, 6) });
    c.globalCompositeOperation = 'lighter';
    for (let i = M.length - 1; i >= 0; i--) {
      const m = M[i]; m.age += dt; if (m.age >= m.life) { M.splice(i, 1); continue; }
      m.x += (m.vx + Math.sin(this.time * 1.3 + m.ph) * 10) * dt; m.y += m.vy * dt;
      const k = Math.sin(m.age / m.life * Math.PI);
      c.globalAlpha = 0.34 * k * (0.7 + 0.3 * Math.sin(this.time * 5 + m.ph)); c.drawImage(S.glow, m.x - m.s, m.y - m.s, m.s * 2, m.s * 2);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  drawZones(b, side) {
    const c = this.ctx, zs = zones(b, side);
    c.save(); c.beginPath(); c.rect(0, 0, W, FH);
    for (const z of zs) c.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    c.fillStyle = `rgba(230,40,30,${0.24 + 0.04 * Math.sin(this.time * 6)})`; c.fill('evenodd');
    c.setLineDash([16, 12]); c.lineDashOffset = -this.time * 40; c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.8)';
    for (const z of zs) { rr(c, z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, 18); c.stroke(); }
    c.restore();
  }
  drawCloud(cl) {
    const c = this.ctx, life = clamp(cl.t / 0.6, 0, 1) * clamp((cl.T - cl.t) / 0.3, 0, 1);
    const g = c.createRadialGradient(cl.x, cl.y, 4, cl.x, cl.y, cl.r);
    g.addColorStop(0, `rgba(150,255,60,${0.42 * life})`); g.addColorStop(0.7, `rgba(90,200,30,${0.26 * life})`); g.addColorStop(1, 'rgba(60,160,20,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(cl.x, cl.y, cl.r, cl.r * 0.62, 0, 0, 6.3); c.fill();
    if (Math.random() < 0.18) this.fx(Math.random() < 0.4 ? 'skull_green' : 'smoke1', cl.x + rand(-cl.r * 0.7, cl.r * 0.7), cl.y + rand(-cl.r * 0.4, cl.r * 0.3), { s0: 0.08, s1: 0.2, life: 0.9, vy: -40, a: 0.65 * life, fade: 0.6 });
  }
  drawFocus(f, b) {
    const c = this.ctx, img = IMG.ic_target, e = f.ref ? b.ents.get(f.ref) : null;
    const x = e ? e.x : f.x, y = e ? e.y : f.y, s = 1 + 0.12 * Math.sin(this.time * 8);
    c.save(); c.translate(x, y + 6); c.scale(1, 0.62); c.rotate(this.time * 1.4);
    c.lineWidth = 7; c.strokeStyle = 'rgba(255,60,40,.9)'; c.setLineDash([22, 14]); c.beginPath(); c.arc(0, 0, (e ? e.r * 1.5 + 12 : 46) * s, 0, 6.3); c.stroke();
    c.restore();
    if (img && img.width) { const z = 56 * s, top = e ? (e.kind === 'tower' ? 200 : ((DATA[e.aid] && DATA[e.aid].walkH) || 90) + 44 + (e.air ? AIR_LIFT : 0)) : 70; c.globalAlpha = 0.92; c.drawImage(img, x - z / 2, y - top - z / 2 + Math.sin(this.time * 5) * 6, z, z); c.globalAlpha = 1; }
  }

  // ---------- tours ----------
  towerRect(t) {
    const st = DATA.arena && DATA.arena.structs[this.arena], key = (t.side === 0 ? 'p_' : 'e_') + t.lane;
    const r = st && st[key]; if (!r) return null;
    return { key, x: (r.x - SX0) * FS, y: r.y * FS, w: r.w * FS, h: r.h * FS, dy: r.ruin_dy * FS };
  }
  drawTower(t, dt) {
    const c = this.ctx, R = this.towerRect(t); if (!R) return;
    let v = this.tvis.get(t.id); if (!v) { v = { flash: 0, hp: t.hp, deadT: 0, z: 0 }; this.tvis.set(t.id, v); }
    if (t.hp < v.hp) v.flash = 1;
    v.hp = t.hp; v.flash = Math.max(0, v.flash - dt * 7);
    const img = IMG[`a${this.arena}_${R.key}${t.dead ? '_ruin' : ''}`];
    if (!img || !img.width) return;
    if (t.dead) {      // ruine : sol noirci, pied de la tour, gravats posés sur la cassure (toujours les mêmes pour une tour), fumée
      v.deadT += dt;
      const rh = img.height * FS, ry = R.y + R.dy, cx = R.x + R.w / 2, main = t.role === 'main';
      c.save(); c.translate(cx, ry + rh * 0.62); c.scale(1, 0.62);      // sol noirci par l'explosion
      const sg = c.createRadialGradient(0, 0, R.w * 0.15, 0, 0, R.w * 0.95); sg.addColorStop(0, 'rgba(46,22,10,.6)'); sg.addColorStop(0.55, 'rgba(60,28,10,.3)'); sg.addColorStop(1, 'rgba(60,28,10,0)');
      c.fillStyle = sg; c.fillRect(-R.w, -R.w, R.w * 2, R.w * 2); c.restore();
      c.drawImage(img, R.x, ry, R.w, rh);
      if (!v.rub) {
        v.rub = []; let seed = Math.round(R.x * 7 + R.y * 13) % 233280; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
        for (let i = 0; i < (main ? 10 : 6); i++) v.rub.push({ k: ['rocks', 'planks', 'rocks2', 'rocks'][i % 4], x: R.x + R.w * (0.1 + 0.8 * (i + rnd() * 0.8) / (main ? 10 : 6)), y: ry + rh * (0.3 + 0.36 * rnd()), s: 0.2 + 0.1 * rnd(), r: rnd() * 6.28 });
      }
      for (const q of v.rub) this.drawFx(q.k, q.x, q.y, q.s, q.r, 1);
      if (v.deadT < 14 && Math.random() < dt * (v.deadT < 5 ? 4 : 1.5)) this.fx('smoke2', R.x + R.w * rand(0.25, 0.75), ry + rh * 0.3, { s0: 0.12, s1: 0.36, life: 1.8, vy: -55, vx: rand(-10, 10), a: 0.5, top: true });
      if (v.deadT < 6 && Math.random() < dt * 2.5) this.fx(Math.random() < 0.5 ? 'fire1' : 'fire2', R.x + R.w * rand(0.25, 0.75), ry + rh * rand(0.25, 0.5), { s0: 0.14, s1: 0.24, life: 0.6, vy: -30, a: 0.9, top: true });
      return;
    }
    const jx = v.flash > 0.5 ? rand(-2, 2) : 0, hpK = t.hp / t.maxHp;
    c.drawImage(img, R.x + jx, R.y, R.w, R.h);
    if (hpK < 0.45 && Math.random() < dt * (hpK < 0.2 ? 5 : 2.2)) this.fx('smoke2', R.x + R.w * rand(0.28, 0.72), R.y + R.h * rand(0.18, 0.45), { s0: 0.1, s1: 0.3, life: 1.5, vy: -55, vx: rand(-12, 12), a: 0.5, top: true });
    if (hpK < 0.2 && Math.random() < dt * 4) this.fx(Math.random() < 0.5 ? 'fire1' : 'fire2', R.x + R.w * rand(0.3, 0.7), R.y + R.h * rand(0.25, 0.5), { s0: 0.14, s1: 0.24, life: 0.55, vy: -35, a: 0.9, top: true });
    if (v.flash > 0.02) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = v.flash * 0.35; c.drawImage(img, R.x + jx, R.y, R.w, R.h); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    // la tour principale dort tant qu'on ne l'a pas touchée
    if (t.role === 'main' && !t.active) { v.z += dt; if (v.z > 1.1) { v.z = 0; this.text('z', R.x + R.w * 0.62, R.y + R.h * 0.3, { size: 30, tint: 'white', vy: -40, vx: 18, life: 1.4, pop: 0.6 }); } }
  }
  drawTowerBar(t) {
    if (t.dead) return;
    const c = this.ctx, R = this.towerRect(t); if (!R) return;
    const main = t.role === 'main', w = main ? 168 : 116, hgt = 22, x = R.x + R.w / 2 - w / 2 + 14;
    const y = t.side === 1 ? (main ? R.y + 6 : R.y - 6) : R.y - (main ? 4 : 12);
    const ratio = t.hp / t.maxHp, mine = t.side === 0;
    c.fillStyle = '#140c08'; rr(c, x - 3, y - 3, w + 6, hgt + 6, 8); c.fill();
    c.fillStyle = '#3a2c30'; rr(c, x, y, w, hgt, 6); c.fill();
    const bg = c.createLinearGradient(0, y, 0, y + hgt); bg.addColorStop(0, mine ? '#6fd0ff' : '#ff7a5e'); bg.addColorStop(1, mine ? '#1f8fe6' : '#d92a20');
    c.fillStyle = bg; rr(c, x, y, Math.max(8, w * ratio), hgt, 6); c.fill();
    c.fillStyle = 'rgba(255,255,255,.38)'; rr(c, x + 4, y + 3, Math.max(0, w * ratio - 8), 6, 3); c.fill();
    label(c, String(Math.ceil(t.hp)), x + w / 2, y + hgt / 2 + 1, 20, '#fff', 'center', 0.25);
    const sh = IMG.shield; if (sh && sh.width) { c.drawImage(sh, x - 40, y - 12, 44, 44); label(c, String(t.level), x - 18, y + 10, 21, '#fff'); }
  }

  // ---------- animaux ----------
  drawUnit(u, dt, a, b) {
    const c = this.ctx, S = sprites(); let v = this.vis.get(u.id);
    if (!v) {
      v = { walk: Math.random() * 4, flash: 0, lag: 1, dir: u.side === 0 ? 'N' : 'S', adir: u.side === 0 ? 'N' : 'S', bob: Math.random() * 6, age: u.spawn > DEPLOY_DELAY - 0.15 ? 0 : 9, landed: false, sq: 0, dirT: 0, ready: 0 };
      this.vis.set(u.id, v);
    }
    v.age += dt;
    const ratio = u.hp / u.maxHp;
    if (v.last !== undefined && ratio < v.last - 0.001) { v.flash = 1; v.sq = Math.max(v.sq, 0.5); }
    v.last = ratio; v.flash = Math.max(0, v.flash - dt * 6); v.sq = Math.max(0, v.sq - dt * 5);
    const x = u.px + (u.x - u.px) * a, y = u.py + (u.y - u.py) * a, key = u.aid, d = DATA[key];
    if (!d) return;
    const r = u.r, big = r > 30;
    let alpha = 1, sx = 1, sy = 1, ox = 0, oy = 0, rot = 0, shadowK = 1;
    const lift = u.air ? AIR_LIFT + Math.sin(this.time * 3 + v.bob) * 6 : 0;
    // arrivée : il tombe, s'écrase un peu, puis attend la fin de son temps de pose
    if (v.age < DROP_T) {
      const k = v.age / DROP_T; oy = -(1 - k * k) * DROP_H; alpha = Math.min(1, k * 4); sy = 1.14; sx = 0.9; shadowK = 0.35 + 0.65 * k;
    } else if (!v.landed) {
      v.landed = true;
      if (v.age < 1) {
        v.sq = 1;
        this.fx('dust_ring', x, y + 5, { s0: 0.25, s1: big ? 1.15 : 0.7, life: 0.42, flat: 0.55, a: 0.85 });
        for (let i = 0; i < (big ? 6 : 4); i++) { const an = rand(0, 6.283); this.fx('smoke_puff', x + Math.cos(an) * r * 0.6, y + Math.sin(an) * r * 0.3, { vx: Math.cos(an) * rand(60, 140), vy: Math.sin(an) * rand(20, 60) - 30, s0: 0.12, s1: big ? 0.42 : 0.28, life: rand(0.35, 0.6), a: 0.75, fade: 0.6 }); }
        this.shake = Math.max(this.shake, big ? 9 : 3);
        if (big) this.decal('crater1', x, y + 6, 4, 0.36);
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
      const q = clamp(u.atkT / u.atk.dur, 0, 0.999);
      anim = u.atk.anim + '_' + v.adir; frame = Math.floor(q * animLen(key, anim));
      // élan vers la cible (corps à corps) ou léger recul (tir)
      const w = u.atk.windup / u.atk.dur, k = q < w ? -0.35 * Math.sin(q / w * Math.PI) : Math.sin(clamp((q - w) / 0.3, 0, 1) * Math.PI), L = (u.atk.proj ? -3 : 9) * (big ? 1.3 : 1);
      ox += u.fx * k * L; oy += u.fy * k * L * 0.7;
    } else if (u.moving && u.spawn <= 0) {
      v.walk += dt * (6 + u.s.speed * 3.5) * (u.charging ? 1.6 : 1); frame = Math.floor(v.walk) % 4;
      const ph = v.walk * Math.PI / 2, hop = Math.abs(Math.sin(ph));
      if (!u.air) { oy -= hop * (big ? 2.5 : 4); sy *= 1 + 0.035 * hop; sx *= 1 - 0.02 * hop; rot = Math.sin(ph) * (big ? 0.018 : 0.035); }
      if (!u.air && big && frame !== v.step) { v.step = frame; if (frame % 2 === 0) this.fx('smoke_puff', x - u.fx * r * 0.6 + rand(-8, 8), y + 2, { s0: 0.08, s1: 0.2, life: 0.4, a: 0.45, vy: -18, fade: 0.7 }); }
    }
    else if (b.over && b.winner === u.side && !u.dead) { const hop = Math.abs(Math.sin(this.time * 7 + u.id)); oy -= hop * 18; sy *= 1 + 0.06 * hop; anim = 'walk_S'; shadowK = 1 - 0.3 * hop; }
    else if (u.stun > 0) { ox = Math.sin(this.time * 30) * 2.5; rot = Math.sin(this.time * 9) * 0.05; }
    else if (u.air) { v.walk += dt * 6; frame = Math.floor(v.walk) % 4; }
    else { const br = Math.sin(this.time * 2.6 + u.id); sy *= 1 + br * 0.018; sx *= 1 - br * 0.008; }
    if (u.air && !u.atk) { v.walk += 0; }
    // au sol : anneau du camp, ombre douce
    const ring = u.side === 0 ? S.ring0 : S.ring1, gy = y + 3;
    if (!u.dead && v.age >= DROP_T * 0.6) {
      const rw = r * (u.air ? 1.15 : 1.42), pulse = v.ready > 0 && v.ready < 2 ? 1 + 0.5 * Math.sin(Math.min(1, v.ready) * Math.PI) * (1 - v.ready / 2) : 1;
      c.globalAlpha = (u.air ? 0.55 : 0.9) * alpha; c.drawImage(ring, x - rw * pulse, gy - rw * 0.5 * pulse, rw * 2 * pulse, rw * pulse); c.globalAlpha = 1;
    }
    { const sw = r * (u.air ? 0.95 : 1.5) * shadowK, sh = sw * 0.5; c.globalAlpha = (u.air ? 0.5 : 0.95) * alpha * (0.4 + 0.6 * shadowK); c.drawImage(S.shadow, x - sw + (u.air ? 10 : 3), gy - sh + (u.air ? 6 : 1), sw * 2, sh * 2); c.globalAlpha = 1; }
    // temps de pose : petit cadran qui se vide autour des pattes
    if (u.spawn > 0 && v.landed) {
      const col = u.side === 0 ? '#bfeaff' : '#ffd0c4', k = u.spawn / DEPLOY_DELAY, rw = r * 1.5 + 6;
      c.save(); c.translate(x, gy); c.scale(1, 0.5); c.lineCap = 'round';
      c.lineWidth = 9; c.strokeStyle = 'rgba(20,12,30,.55)'; c.beginPath(); c.arc(0, 0, rw, 0, 6.283); c.stroke();
      c.lineWidth = 6; c.strokeStyle = col; c.beginPath(); c.arc(0, 0, rw, -Math.PI / 2, -Math.PI / 2 + 6.283 * k); c.stroke();
      c.restore();
    }
    const fy = y - lift + oy, fxp = x + ox;
    if (u.armorT > 0) { const pu = 0.5 + 0.5 * Math.sin(this.time * 7); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.34 + 0.14 * pu; const gw = r * 3.4, gh = d.walkH * 1.5; c.drawImage(S.glow, fxp - gw / 2, fy - d.walkH * 0.5 - gh / 2, gw, gh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.lineWidth = 3; c.strokeStyle = `rgba(150,220,255,${0.5 + 0.3 * pu})`; c.beginPath(); c.ellipse(fxp, fy - d.walkH * 0.46, r * 1.55, d.walkH * 0.66, 0, 0, 6.3); c.stroke(); }
    if (u.buff) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.26 + 0.1 * Math.sin(this.time * 11); const gw = r * 3.6, gh = d.walkH * 1.5; c.drawImage(S.glow, fxp - gw / 2, fy - d.walkH * 0.45 - gh / 2, gw, gh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    drawUnitFrame(c, key, anim, frame, fxp, fy, 1, alpha, sx, sy, rot);
    const glow = v.flash * 0.85 + (u.charging ? 0.22 : 0) + (u.dead ? 0.6 : 0) + (v.age < DROP_T + 0.12 ? 0.5 : 0) + (v.ready > 0 && v.ready < 1 ? 0.35 * (1 - v.ready) : 0);
    if (glow > 0.02) { c.globalCompositeOperation = 'lighter'; drawUnitFrame(c, key, anim, frame, fxp, fy, 1, Math.min(1, glow) * alpha, sx, sy, rot); if (v.flash > 0.5) drawUnitFrame(c, key, anim, frame, fxp, fy, 1, (v.flash - 0.5) * alpha, sx, sy, rot); c.globalCompositeOperation = 'source-over'; }
    if (u.poisonT > 0) { u.poisonT -= dt; if (Math.random() < 0.08) this.fx('skull_green', x + rand(-14, 14), fy - d.walkH * 0.8, { s0: 0.05, s1: 0.1, life: 0.6, vy: -50, a: 0.8 }); }
    if (u.stun > 0 && !u.dead) this.drawFx('dizzy_stars', x + Math.sin(this.time * 5) * 5, fy - d.walkH - 4, 0.34, Math.sin(this.time * 4) * 0.2, 1);
    if (u.buff && Math.random() < 0.25) this.fx('fire1', x + rand(-r, r) * 0.7, fy - rand(8, d.walkH * 0.7), { s0: 0.07, s1: 0.02, life: 0.45, vy: -100, a: 0.85 });
    if (u.charging && u.moving && Math.random() < 0.5) this.fx('dust_dash', x - u.fx * r * 1.3, y - 4 - u.fy * r, { s0: 0.14, s1: 0.26, life: 0.3, rot: Math.atan2(-u.fy, -u.fx), a: 0.8 });
    v.top = fy - d.walkH - 10; v.x = x;
  }
  drawUnitBar(u) {
    if (u.dead || u.spawn > 0) return;
    const v = this.vis.get(u.id); if (!v || v.top === undefined) return;
    const r = u.hp / u.maxHp;
    v.lag += (r - v.lag) * 0.08; if (v.lag < r) v.lag = r;
    if (r >= 1 && v.lag >= 0.999) return;
    const c = this.ctx, w = clamp(u.r * 2.1, 46, 84), hh = 9, x = v.x - w / 2 + 7, y = v.top, mine = u.side === 0;
    c.fillStyle = 'rgba(16,10,8,.92)'; rr(c, x - 2.5, y - 2.5, w + 5, hh + 5, 5); c.fill();
    c.fillStyle = '#3b2e2c'; rr(c, x, y, w, hh, 3.5); c.fill();
    if (v.lag > r + 0.004) { c.fillStyle = '#fff6d8'; rr(c, x, y, Math.max(4, w * v.lag), hh, 3.5); c.fill(); }
    if (r > 0.001) {
      const g = c.createLinearGradient(0, y, 0, y + hh);
      if (mine) { g.addColorStop(0, '#8fe0ff'); g.addColorStop(0.5, '#2fa8ff'); g.addColorStop(1, '#1b74d8'); } else { g.addColorStop(0, '#ff9a84'); g.addColorStop(0.5, '#ff4a3a'); g.addColorStop(1, '#c92a20'); }
      c.fillStyle = g; rr(c, x, y, Math.max(4, w * r), hh, 3.5); c.fill();
    }
    c.fillStyle = mine ? '#1c6fd0' : '#c0281e'; c.beginPath(); c.arc(x - 8, y + hh / 2, 10.5, 0, 6.3); c.fill(); c.lineWidth = 2.5; c.strokeStyle = 'rgba(16,10,8,.95)'; c.stroke();
    label(c, String(u.level), x - 8, y + hh / 2 + 0.5, 15, '#fff', 'center', 0.15);
  }
  drawProj(p) {
    const c = this.ctx;
    if (p.key === 'arrow') {
      const an = p.ang !== undefined ? p.ang : Math.atan2(p.ty - p.y, p.tx - p.x);
      c.save(); c.translate(p.x, p.y); c.rotate(an);
      const tr = c.createLinearGradient(-84, 0, -20, 0); tr.addColorStop(0, 'rgba(255,255,255,0)'); tr.addColorStop(1, 'rgba(255,250,220,.6)');
      c.strokeStyle = tr; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(-84, 0); c.lineTo(-22, 0); c.stroke(); c.lineCap = 'butt';
      c.strokeStyle = '#5a3a1e'; c.lineWidth = 5; c.beginPath(); c.moveTo(-26, 0); c.lineTo(10, 0); c.stroke();
      c.fillStyle = '#e8e8f0'; c.beginPath(); c.moveTo(18, 0); c.lineTo(6, -7); c.lineTo(6, 7); c.closePath(); c.fill();
      c.fillStyle = '#ff4a3a'; c.fillRect(-28, -5, 8, 3); c.fillRect(-28, 2, 8, 3);
      c.restore(); return;
    }
    if (p.key === 'cannon') {
      c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(p.x, p.y + 30, 13, 6, 0, 0, 6.3); c.fill();
      const gl = c.createRadialGradient(p.x, p.y, 4, p.x, p.y, 34); gl.addColorStop(0, 'rgba(255,170,60,.75)'); gl.addColorStop(1, 'rgba(255,90,20,0)');
      c.globalCompositeOperation = 'lighter'; c.fillStyle = gl; c.fillRect(p.x - 34, p.y - 34, 68, 68); c.globalCompositeOperation = 'source-over';
      const g = c.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, 13); g.addColorStop(0, '#8a8a96'); g.addColorStop(1, '#1d1d24');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 13, 0, 6.3); c.fill();
      if (Math.random() < 0.5) this.fx('smoke_puff', p.x, p.y, { s0: 0.05, s1: 0.12, life: 0.4, a: 0.5 });
      return;
    }
    if (p.arc) { const gy = p.sy + (p.ty - p.sy) * (p.k || 0) + 34; c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(p.x, gy, 14, 6, 0, 0, 6.3); c.fill(); }
    this.drawFx(p.key, p.x, p.y, p.key === 'hearts' ? 0.24 : 0.26, p.key === 'hearts' ? Math.sin(this.time * 12) * 0.3 : this.time * 9, 1);
    if (p.key === 'hearts' && Math.random() < 0.4) this.fx('hearts', p.x, p.y, { s0: 0.1, s1: 0.03, life: 0.35, a: 0.6 });
  }
  drawGhost(d) {
    const c = this.ctx, A = ANIMALS[d.id], ok = d.ok, dd = DATA[d.id], S = sprites();
    const offs = (A.count || 1) === 2 ? [[-0.55, 0.1], [0.55, -0.1]] : [[0, 0]];
    if (A.range > 2) { c.lineWidth = 4; c.setLineDash([10, 8]); c.lineDashOffset = -this.time * 30; c.strokeStyle = ok ? 'rgba(255,255,255,.75)' : 'rgba(255,80,60,.85)'; c.beginPath(); c.ellipse(d.x, d.y, (A.range + A.radius) * 52, (A.range + A.radius) * 52 * 0.7, 0, 0, 6.3); c.stroke(); c.setLineDash([]); }
    for (const [ox, oy] of offs) {
      const x = d.x + ox * 52, y = d.y + oy * 52, rw = A.radius * 52 * 1.5 * (1 + 0.06 * Math.sin(this.time * 7));
      c.globalAlpha = ok ? 1 : 0.9; c.drawImage(ok ? S.ring0 : S.ring1, x - rw, y + 3 - rw * 0.5, rw * 2, rw); c.globalAlpha = 1;
      if (dd) drawUnitFrame(c, d.id, 'walk_N', Math.floor(this.time * 8), x, y - (A.air ? AIR_LIFT : 0) - 4 - 3 * Math.sin(this.time * 7), 1, ok ? 0.78 : 0.42);
    }
    label(c, A.name, d.x, d.y - (dd ? dd.walkH : 90) - (A.air ? AIR_LIFT : 0) - 30, 26, ok ? '#fff' : '#ff8a7a');
  }
  drawDragCard(d) {
    const c = this.ctx, img = IMG['card_' + d.id]; if (!img || !img.width) return;
    const w = 112, hh = 154; c.globalAlpha = 0.95; c.drawImage(img, d.x - w / 2, d.y - hh * 0.7, w, hh); c.globalAlpha = 1;
  }

  // ---------- haut de l'écran : adversaire, horloge, couronnes ----------
  drawTop(b, ui) {
    const c = this.ctx;
    c.fillStyle = 'rgba(20,12,30,.72)'; rr(c, 12, 12, 330, 74, 18); c.fill();
    c.save(); c.beginPath(); c.rect(12, 12, 326, 74); c.clip();
    label(c, ui.opp.name, 28, 38, 30, '#ffb4a8', 'left');
    label(c, ui.opp.clanName || 'Sans clan', 30, 68, 20, '#e8dccb', 'left');
    c.restore();
    const t = Math.max(0, Math.ceil(b.clock)), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    c.fillStyle = 'rgba(20,12,30,.72)'; rr(c, W - 182, 12, 170, 84, 18); c.fill();
    label(c, b.overtime ? 'Prolongations' : 'Temps restant', W - 97, 34, 20, b.overtime ? '#ff9a7a' : '#e8dccb');
    label(c, mm + ':' + ss, W - 97, 68, 40, b.overtime || t <= 10 ? '#ff6a5a' : '#fff');
    const crown = (img, n, y, col) => {
      c.fillStyle = 'rgba(20,12,30,.6)'; rr(c, W - 92, y - 40, 80, 84, 20); c.fill();
      if (img && img.width) c.drawImage(img, W - 84, y - 36, 64, 50);
      label(c, String(n), W - 52, y + 24, 32, col);
    };
    crown(IMG.crownRed, b.players[1].crowns, 590, '#ff8a7a');
    crown(IMG.crownBlue, b.players[0].crowns, 885, '#8fdcff');
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
    label(c, String(full), hx(828), hy(226), 36 * (1 + 0.0), boost ? '#ffb4ee' : '#fff');
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
    this.drawOrderBtn(HUD.whistle, me.cdDefend / ORDER.cdDefend, me.defendT > 0, me.defendT / ORDER.defend, '#7fd4ff');
    this.drawOrderBtn(HUD.attack, me.cdFocus / ORDER.cdFocus, ui.armed || !!me.focus, me.focus ? me.focus.t / ORDER.focus : 1, '#ff8a6a');
    if (ui.armed) label(c, 'Touche une cible !', W / 2, HUD_Y - 34, 34, '#ffd23f');
    else if (ui.hint) label(c, ui.hint, W / 2, HUD_Y - 34, 26, '#fff3d0');
  }
  drawOrderBtn([x, y, w, hh], cd, active, left, col) {
    const c = this.ctx;
    if (active) {
      c.save(); c.globalAlpha = 0.55 + 0.35 * Math.sin(this.time * 9); c.lineWidth = 8; c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 24; rr(c, x - 2, y - 2, w + 4, hh + 4, 22); c.stroke(); c.restore();
      c.fillStyle = col; rr(c, x + 12, y + hh - 14, (w - 24) * clamp(left, 0, 1), 8, 4); c.fill();
    }
    if (cd > 0) { c.fillStyle = 'rgba(8,10,24,.6)'; rr(c, x + 4, y + 4 + (hh - 8) * (1 - cd), w - 8, (hh - 8) * cd, 16); c.fill(); }
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
