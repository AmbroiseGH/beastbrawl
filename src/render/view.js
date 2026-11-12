// Affichage du combat sur un canvas : arène, carrés de placement, animaux animés, dresseurs,
// particules, chiffres de dégâts. Ne décide de rien : il dessine ce que battle.js lui donne.
import { IMG, DATA } from '../core/assets.js';
import { COLS, ROWS, CELL_PX, toPx, cellCenter } from '../data/arena.js';
import { clamp, rand } from '../core/utils.js';

export const W = 941, H = 1672, ARENA_H = 1411;
const UNIT_SCALE = 0.8;                         // taille des animaux à l'écran par rapport à l'atlas
const DIR8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const TINTS = { white: null, yellow: '#ffe14a', orange: '#ff9a2e', red: '#ff5a4a', green: '#8dff5a', blue: '#7fd4ff', grey: '#d9dde6' };
const fonts = {};

// La police fournie est blanche : on en fabrique des copies colorées une fois pour toutes
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
// Largeur d'un texte en police bitmap pour une hauteur de capitale donnée
function textWidth(str, size) {
  const F = DATA.font, k = size / F.cap; let w = 0;
  for (const ch of str) { const g = F.g[ch]; w += g ? (g[2] - 10) * k : size * 0.38; }
  return w;
}
export function drawText(ctx, str, cx, cy, size, tint = 'white', alpha = 1) {
  const F = DATA.font, img = tintFont(tint); if (!F || !img) return;
  str = String(str).toUpperCase();
  const k = size / F.cap; let x = cx - textWidth(str, size) / 2;
  ctx.globalAlpha = alpha;
  for (const ch of str) {
    const g = F.g[ch];
    if (!g) { x += size * 0.38; continue; }
    ctx.drawImage(img, g[0], g[1], g[2], g[3], x - 5 * k, cy + size / 2 + g[4] * k, g[2] * k, g[3] * k);
    x += (g[2] - 10) * k;
  }
  ctx.globalAlpha = 1;
}
// Un texte en police bitmap dans un petit canvas (pour l'interface : VICTOIRE, DÉFAITE…)
export function textCanvas(str, size, tint = 'white') {
  str = String(str).toUpperCase();
  const w = Math.ceil(textWidth(str, size) + size * 0.5), hgt = Math.ceil(size * 1.75);
  const c = document.createElement('canvas'); c.width = w * 2; c.height = hgt * 2; c.style.width = w + 'px'; c.style.height = hgt + 'px';
  const g = c.getContext('2d'); g.scale(2, 2); drawText(g, str, w / 2, hgt * 0.56, size, tint);
  return c;
}

export class View {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.k = 1;
    this.parts = []; this.texts = []; this.decals = []; this.vis = new Map();
    this.shake = 0; this.time = 0; this.flash = 0; this.fury = 0;
    this.trainers = [{ row: 0, t: 0, loop: true }, { row: 0, t: 0, loop: true }];
  }
  resize(scale) {
    const k = clamp(scale * (window.devicePixelRatio || 1), 0.5, 1.3);
    if (Math.abs(k - this.k) < 0.02 && this.cv.width > 300) return;
    this.k = k; this.cv.width = Math.round(W * k); this.cv.height = Math.round(H * k);
  }
  reset() { this.parts.length = 0; this.texts.length = 0; this.decals.length = 0; this.vis.clear(); this.shake = 0; this.flash = 0; this.fury = 0; this.trainers.forEach((t) => { t.row = 0; t.t = 0; t.loop = true; }); }

  // ---------- particules ----------
  fx(key, x, y, o = {}) {
    if (!DATA.fx || !DATA.fx[key]) return;
    this.parts.push({ key, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.4, s0: o.s0 !== undefined ? o.s0 : 0.6, s1: o.s1 !== undefined ? o.s1 : 1, rot: o.rot || 0, vr: o.vr || 0, a: o.a !== undefined ? o.a : 1, add: !!o.add, flat: o.flat || 1, fade: o.fade !== undefined ? o.fade : 0.45 });
  }
  burst(key, x, y, n, o = {}) {
    for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 80, o.sp1 || 260); this.fx(key, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g !== undefined ? o.g : 500, life: rand(0.35, 0.7) * (o.life || 1), s0: (o.s || 0.3) * rand(0.7, 1.2), s1: (o.s || 0.3) * rand(0.4, 0.8), rot: rand(0, 6), vr: rand(-6, 6), delay: o.delay || 0 }); }
  }
  decal(key, x, y, life = 6, s = 1) { this.decals.push({ key, x, y, age: 0, life, s }); if (this.decals.length > 14) this.decals.shift(); }
  text(str, x, y, o = {}) { this.texts.push({ str: String(str), x, y, vy: o.vy !== undefined ? o.vy : -90, vx: o.vx || 0, age: 0, life: o.life || 0.8, size: o.size || 34, tint: o.tint || 'white', pop: o.pop !== undefined ? o.pop : 1 }); if (this.texts.length > 40) this.texts.shift(); }
  trainer(side, row, loop = false) { const t = this.trainers[side]; if (t.row === row && t.loop === loop) return; t.row = row; t.t = 0; t.loop = loop; }

  drawFx(key, x, y, s = 1, rot = 0, alpha = 1, flat = 1) {
    const r = DATA.fx[key]; if (!r) return;
    const c = this.ctx; c.globalAlpha = alpha;
    if (rot || flat !== 1) { c.save(); c.translate(x, y); if (flat !== 1) c.scale(1, flat); if (rot) c.rotate(rot); c.drawImage(IMG.fx, r[0], r[1], r[2], r[3], -r[2] * s / 2, -r[3] * s / 2, r[2] * s, r[3] * s); c.restore(); } else c.drawImage(IMG.fx, r[0], r[1], r[2], r[3], x - r[2] * s / 2, y - r[3] * s / 2, r[2] * s, r[3] * s);
    c.globalAlpha = 1;
  }
  // Image n° i de l'animation « anim » d'un animal, les pieds posés en (x, y)
  drawUnitFrame(id, anim, i, x, y, s = 1, alpha = 1, sx = 1, sy = 1) {
    const d = DATA[id], img = IMG[id]; if (!d || !img) return;
    const list = d.anims[anim]; if (!list) return;
    const f = d.frames[list[clamp(i, 0, list.length - 1)]], k = UNIT_SCALE * s, c = this.ctx;
    c.globalAlpha = alpha;
    c.drawImage(img, f[0], f[1], f[2], f[3], x - f[4] * k * sx, y - f[5] * k * sy, f[2] * k * sx, f[3] * k * sy);
    c.globalAlpha = 1;
  }

  // ---------- dessin d'une image complète ----------
  // m : { phase, grid: [{col,row,state}], units: [{...}], drag, battle, alpha, count, banner }
  draw(dt, m) {
    const c = this.ctx, k = this.k; this.time += dt;
    c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H);
    c.save();
    if (this.shake > 0.3) { c.translate(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake); this.shake *= Math.pow(0.0015, dt); } else this.shake = 0;
    if (IMG.arena) c.drawImage(IMG.arena, 0, 0, W, ARENA_H);

    // carrés de placement
    if (m.squares) for (const q of m.squares) {
      const p = toPx(q.x, q.y), img = IMG[q.img] || IMG.sqBlue, s = CELL_PX * 0.96 * (q.pop || 1);
      c.globalAlpha = q.a; c.drawImage(img, p.x - s / 2, p.y - s / 2, s, s); c.globalAlpha = 1;
    }
    // marques au sol
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.age += dt; if (d.age >= d.life) { this.decals.splice(i, 1); continue; } this.drawFx(d.key, d.x, d.y, d.s, 0, Math.min(1, (d.life - d.age) / 1.2) * 0.85, 0.6); }

    // dresseurs
    this.drawTrainer(1, 470, 150, dt);
    // animaux, du fond vers l'avant
    const us = m.units.slice().sort((a, b) => a.py - b.py);
    for (const u of us) this.drawUnit(u, dt);
    this.drawTrainer(0, 470, 1392, dt);
    for (const u of us) if (u.bar) this.drawBar(u);

    // particules
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.age += dt; if (p.age < 0) continue;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t)), al = p.a * (t < 1 - p.fade ? 1 : (1 - t) / p.fade);
      if (p.add) c.globalCompositeOperation = 'lighter';
      this.drawFx(p.key, p.x, p.y, s, p.rot, al, p.flat);
      if (p.add) c.globalCompositeOperation = 'source-over';
    }
    // chiffres
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.age += dt; if (t.age >= t.life) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt; t.x += t.vx * dt; t.vy *= Math.pow(0.12, dt);
      const q = t.age / t.life, pop = q < 0.15 ? 0.6 + (q / 0.15) * 0.75 * t.pop : 1 + 0.35 * t.pop * Math.max(0, 1 - (q - 0.15) / 0.2);
      drawText(c, t.str, t.x, t.y, t.size * pop, t.tint, q > 0.7 ? (1 - q) / 0.3 : 1);
    }
    c.restore();

    // voile rouge de la Fureur
    if (this.fury > 0) { const g = c.createRadialGradient(W / 2, ARENA_H / 2, 380, W / 2, ARENA_H / 2, 900); g.addColorStop(0, 'rgba(255,40,0,0)'); g.addColorStop(1, `rgba(255,40,0,${0.28 * this.fury * (0.75 + 0.25 * Math.sin(this.time * 6))})`); c.fillStyle = g; c.fillRect(0, 0, W, ARENA_H); }
    if (this.flash > 0.01) { c.fillStyle = `rgba(255,255,255,${this.flash})`; c.fillRect(0, 0, W, ARENA_H); this.flash *= Math.pow(0.001, dt); }
    // animal en train d'être déplacé au doigt (dessiné par-dessus tout, même la barre du bas)
    if (m.drag) { const d = m.drag; c.globalAlpha = 0.28; c.fillStyle = '#000'; c.beginPath(); c.ellipse(d.px, d.py + 6, 46, 20, 0, 0, 6.3); c.fill(); c.globalAlpha = 1; this.drawUnitFrame(d.id, 'walk_N', Math.floor(this.time * 9) % 4, d.px, d.py - 14, 1.12, 0.95); }
    if (m.banner) { const b = m.banner, s = b.size * (1 + 0.5 * Math.max(0, 1 - b.age / 0.18)); drawText(c, b.str, W / 2, b.y || 700, s, b.tint || 'yellow', b.age > b.life - 0.2 ? Math.max(0, (b.life - b.age) / 0.2) : 1); }
  }

  drawTrainer(side, x, y, dt) {
    const img = side === 0 ? IMG.trainerRed : IMG.trainerBlue, t = this.trainers[side]; if (!img || !img.width) return;
    t.t += dt; let f = Math.floor(t.t * 9);
    if (t.row === 0) f = 0; else if (t.loop) f = f % 6; else if (f > 5) { t.row = 0; f = 0; }
    const s = 1.05 + (t.row === 0 ? Math.sin(this.time * 2.4 + side) * 0.012 : 0), cw = 160;
    this.ctx.drawImage(img, f * cw, t.row * cw, cw, cw, x - cw * s / 2, y - cw * s * 0.86, cw * s, cw * s);
  }

  drawUnit(u, dt) {
    const c = this.ctx; let v = this.vis.get(u.key);
    if (!v) { v = { walk: Math.random() * 4, flash: 0, hp: u.hpRatio, lag: u.hpRatio, pop: u.pop ? 0 : 1, dir: u.side === 0 ? 'N' : 'S', adir: u.side === 0 ? 'N' : 'S' }; this.vis.set(u.key, v); }
    if (v.pop < 1) v.pop = Math.min(1, v.pop + dt * 5);
    v.flash = Math.max(0, v.flash - dt * 5);
    if (u.hit) { v.flash = 1; u.hit = false; }
    v.lag += (u.hpRatio - v.lag) * Math.min(1, dt * 3.5); if (v.lag < u.hpRatio) v.lag = u.hpRatio;
    const x = u.px, y = u.py, r = u.radius * CELL_PX;
    let alpha = u.alpha !== undefined ? u.alpha : 1, sx = 1, sy = 1, oy = 0, ox = 0;
    if (u.dead) { const t = u.deadAge; if (t > 0.5) return; alpha *= 1 - t / 0.5; sy = 1 - t * 0.6; sx = 1 + t * 0.5; }
    // orientation : 8 directions pour la marche, 4 pour l'attaque
    if (u.fx || u.fy) {
      const an = Math.atan2(u.fy, u.fx); v.dir = DIR8[(Math.round(an / (Math.PI / 4)) + 8) % 8];
      v.adir = Math.abs(u.fx) > Math.abs(u.fy) * 1.15 ? (u.fx > 0 ? 'E' : 'W') : (u.fy > 0 ? 'S' : 'N');
    }
    let anim = 'walk_' + v.dir, frame = 0;
    if (u.atk) { anim = u.atk.anim + '_' + v.adir; frame = Math.floor(clamp(u.atk.t / u.atk.dur, 0, 0.999) * 8); const l = Math.sin(Math.PI * clamp(u.atk.t / u.atk.dur, 0, 1)) * (u.atk.special ? 20 : 12); ox = u.fx * l; oy = u.fy * l; }
    else if (u.moving) { v.walk += dt * (7 + u.speed * 2.2); frame = Math.floor(v.walk) % 4; oy = -Math.abs(Math.sin(v.walk * Math.PI / 2)) * 3; }
    else if (u.win) { oy = -Math.abs(Math.sin(this.time * 7 + u.key * 1.3)) * 22; anim = 'walk_S'; }
    else if (u.stun) { ox = Math.sin(this.time * 30) * 3; sy = 0.95; }
    else { sy = 1 + Math.sin(this.time * 3 + u.key) * 0.018; }
    if (v.pop < 1) { const e = v.pop; sx *= 0.4 + 0.6 * e + 0.25 * Math.sin(e * Math.PI); sy *= 0.4 + 0.6 * e + 0.25 * Math.sin(e * Math.PI); }
    // ombre + anneau de couleur du camp
    c.globalAlpha = 0.3 * alpha; c.fillStyle = '#000'; c.beginPath(); c.ellipse(x, y + 4, r * 1.05, r * 0.5, 0, 0, 6.3); c.fill();
    c.globalAlpha = 0.9 * alpha; c.lineWidth = 5; c.strokeStyle = u.side === 0 ? '#39c0ff' : '#ff4a3a'; c.beginPath(); c.ellipse(x, y + 4, r * 1.1, r * 0.52, 0, 0, 6.3); c.stroke();
    c.globalAlpha = 0.22 * alpha; c.fillStyle = u.side === 0 ? '#39c0ff' : '#ff4a3a'; c.fill(); c.globalAlpha = 1;
    if (u.sel) { c.lineWidth = 6; c.strokeStyle = '#fff36b'; c.beginPath(); c.ellipse(x, y + 4, r * 1.3, r * 0.62, 0, 0, 6.3); c.stroke(); }
    const fy = y + r * 0.42;      // les pieds sont un peu en dessous du centre du corps
    this.drawUnitFrame(u.id, anim, frame, x + ox, fy + oy, u.scale || 1, alpha, sx, sy);
    if (v.flash > 0.02) { c.globalCompositeOperation = 'lighter'; this.drawUnitFrame(u.id, anim, frame, x + ox, fy + oy, u.scale || 1, v.flash * 0.75 * alpha, sx, sy); c.globalCompositeOperation = 'source-over'; }
    if (u.stun && !u.dead) this.drawFx('dizzy_stars', x + Math.sin(this.time * 5) * 6, fy - 128, 0.55, Math.sin(this.time * 4) * 0.2, 1);
    u._top = fy - 138; v.hpShown = u.hpRatio;
  }
  drawBar(u) {
    if (u.dead) return;
    const c = this.ctx, v = this.vis.get(u.key); if (!v) return;
    const w = 78, hh = 13, x = u.px - w / 2, y = (u._top || u.py - 120) - 6;
    c.fillStyle = '#140c08'; this.rr(x - 3, y - 3, w + 6, hh + 6, 7); c.fill();
    c.fillStyle = '#4a3a34'; this.rr(x, y, w, hh, 5); c.fill();
    if (v.lag > 0.001) { c.fillStyle = '#fff'; this.rr(x, y, w * v.lag, hh, 5); c.fill(); }
    if (u.hpRatio > 0.001) { c.fillStyle = u.side === 0 ? (u.hpRatio > 0.3 ? '#4fd8ff' : '#ffc23a') : '#ff5544'; this.rr(x, y, Math.max(6, w * u.hpRatio), hh, 5); c.fill(); c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(x + 3, y + 2, Math.max(0, w * u.hpRatio - 6), 3); }
    // niveau
    c.fillStyle = u.side === 0 ? '#1c6fd0' : '#c0281e'; c.beginPath(); c.arc(x - 9, y + hh / 2, 14, 0, 6.3); c.fill(); c.lineWidth = 3; c.strokeStyle = '#140c08'; c.stroke();
    c.fillStyle = '#fff'; c.font = '20px "Lilita One",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(u.level, x - 9, y + hh / 2 + 1);
  }
  rr(x, y, w, hgt, r) { const c = this.ctx; r = Math.min(r, w / 2, hgt / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hgt, r); c.arcTo(x + w, y + hgt, x, y + hgt, r); c.arcTo(x, y + hgt, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
}
