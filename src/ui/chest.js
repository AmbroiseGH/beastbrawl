// Ouverture d'une cage : la cage tombe sur son socle, s'impatiente, tremble puis s'ouvre dans un éclair ; chaque
// pile de cartes s'envole de la cage, se fait attendre selon sa rareté, se retourne et se révèle.
// Tout est dessiné sur un canvas plein écran (décor, rayons et lueurs calculés, pas d'images de fond) ;
// un toucher fait avancer la scène.
import { $, h, clamp, rand, wait, TEST } from '../core/utils.js';
import { play, sfx } from '../core/audio.js';
import { IMG, DATA, chestAssets, revealAssets, cardHd } from '../core/assets.js';
import { ANIMALS } from '../data/animals.js';
import { CHESTS, RARITY, upgradeCost } from '../data/cards.js';
import { view as stageView } from './stage.js';
import { drawText, label, rr } from '../render/view.js';

const W = 941, H = 1672, CX = 470;
const BIG = { x: CX, y: 1180, s: 1 };        // la cage au centre (y : là où elle touche le sol)
const SMALL = { x: CX, y: 1556, s: 0.5 };     // la cage rangée en bas pendant les cartes
const CHW = 600;                             // largeur d'une image de cage en grand
const CARD_Y = 650, CARD_W = 468;            // la carte révélée
const SUSPENSE = { common: 0, rare: 0.3, epic: 0.7, legendary: 1.15, ultimate: 1.6 };
const PILLAR = { common: 'pillar_blue', rare: 'pillar_gold', epic: 'pillar_purple', legendary: 'pillar_gold', ultimate: 'pillar_purple' };
const RAINBOW = ['#ff5a6a', '#ffb23f', '#ffe95a', '#6dff7a', '#5ad0ff', '#c07aff'];
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIO = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const back = (t, s = 1.7) => { t = clamp(t, 0, 1); return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const css = (c, a = 1, m = 1, add = 0) => `rgba(${Math.min(255, c[0] * m + add) | 0},${Math.min(255, c[1] * m + add) | 0},${Math.min(255, c[2] * m + add) | 0},${a})`;

// ---------- images calculées une fois (rayons, lueur, vignette) ----------
const SPR = {}, TINTED = {};
const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
function glowBase() {
  if (SPR.glow) return SPR.glow;
  const c = mk(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,.6)'); g.addColorStop(0.55, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return (SPR.glow = c);
}
function raysBase() {          // éventail de rayons aux bords doux, de largeurs inégales, qui s'éteint vers le bord
  if (SPR.rays) return SPR.rays;
  const n = 512, c = mk(n, n), x = c.getContext('2d'); x.translate(n / 2, n / 2);
  let a = 0;
  for (let i = 0; i < 16; i++) {
    const w = 0.055 + 0.085 * ((i * 7919) % 13) / 13, al = 0.3 + 0.5 * ((i * 104729) % 7) / 7;
    for (let j = 0; j < 5; j++) {
      const ww = w * (1 - j / 6);
      x.fillStyle = `rgba(255,255,255,${al * 0.27})`;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a - ww) * n, Math.sin(a - ww) * n); x.lineTo(Math.cos(a + ww) * n, Math.sin(a + ww) * n); x.closePath(); x.fill();
    }
    a += 6.2832 / 16 + (((i * 31) % 5) - 2) * 0.03;
  }
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(0.1, 'rgba(0,0,0,.95)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  return (SPR.rays = c);
}
function tinted(base, id, color) {        // copie colorée d'une image blanche (gardée)
  const key = id + color; if (TINTED[key]) return TINTED[key];
  const c = mk(base.width, base.height), x = c.getContext('2d');
  if (color === 'rainbow') {
    const n = base.width / 2;
    for (let i = 0; i < 36; i++) { x.fillStyle = `hsl(${i * 10},100%,62%)`; x.beginPath(); x.moveTo(n, n); x.arc(n, n, n * 1.5, i / 36 * 6.2832, (i + 1.06) / 36 * 6.2832); x.closePath(); x.fill(); }
    x.globalCompositeOperation = 'destination-in'; x.drawImage(base, 0, 0);
  } else { x.drawImage(base, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); }
  return (TINTED[key] = c);
}
function vignette() {
  if (SPR.vig) return SPR.vig;
  const c = mk(94, 167), x = c.getContext('2d'), g = x.createRadialGradient(47, 80, 52, 47, 80, 112);
  g.addColorStop(0, 'rgba(4,3,14,0)'); g.addColorStop(1, 'rgba(4,3,14,.78)');
  x.fillStyle = g; x.fillRect(0, 0, 94, 167); return (SPR.vig = c);
}

export async function openChestAnim(loot) {
  const stacks = loot.cards.map((c) => ({ ...c, rarity: ANIMALS[c.id].rarity }));
  const rarities = [...new Set(stacks.map((c) => c.rarity))];
  const ready = Promise.all([loot.direct ? null : chestAssets(loot.tier), ...rarities.map(revealAssets), ...stacks.map((c) => cardHd(c.id))]);   // direct : cartes achetées, sans cage
  const cv = h('canvas', { class: 'ch-cv' });
  const skip = h('button', { class: 'ch-skip t xs', onclick: (e) => { e.stopPropagation(); S.skip = true; tap(); } }, 'Tout voir ▸▸');
  const el = h('div', { class: 'chest-ov' }, cv, skip);
  $('modals').append(el);
  const ctx = cv.getContext('2d');
  const k = clamp(stageView.scale * (window.devicePixelRatio || 1), 0.5, 1.4);
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);

  const C = CHESTS[loot.tier] || CHESTS.rustique, tierN = Math.max(0, Object.keys(CHESTS).indexOf(loot.tier));
  const first = stacks[0] ? RARITY[stacks[0].rarity].color : C.color, homeCol = loot.direct ? first : C.color;
  const S = {
    phase: 'load', t: 0, time: 0, i: -1, skip: false, done: false, parts: [], rings: [], trail: [], motes: [], shake: 0, flash: 0, flashCol: '255,255,255',
    bg: rgbOf(homeCol).map((v) => v * 0.4), bgT: rgbOf(homeCol),
    ray: { x: CX, y: BIG.y - 250, tx: CX, ty: BIG.y - 250, p: 0, pT: 0, col: homeCol, prev: null, fade: 1 },
    ch: { ...BIG, a: loot.direct ? 0 : 1 }, chT: BIG, sq: 0, sqv: 0, pod: 0,
  };
  for (let i = 0; i < 34; i++) S.motes.push({ x: rand(0, W), y: rand(0, H), r: rand(1.5, 6), v: rand(14, 60), ph: rand(0, 6.3), a: rand(0.12, 0.5) });
  const left = () => stacks.length - Math.max(0, S.i) - (S.phase === 'card' || S.phase === 'reveal' || S.phase === 'suspense' ? 1 : 0);
  const go = (p) => { S.phase = p; S.t = 0; };
  const setRay = (col, x, y) => { const r = S.ray; if (col !== r.col) { r.prev = r.col; r.col = col; r.fade = 0; } r.tx = x; r.ty = y; };
  const rayCol = (R) => (R.rainbow ? 'rainbow' : R.color);

  // ---------- particules : effets de l'atlas, points de lumière ('@'), ondes de choc ----------
  const fx = (key, x, y, o = {}) => { if (key === '@' || (DATA.fx && DATA.fx[key])) S.parts.push({ key, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.6, s0: o.s0 ?? 0.3, s1: o.s1 ?? 0.6, rot: o.rot || 0, vr: o.vr || 0, a: o.a ?? 1, add: !!o.add, back: !!o.back, col: o.col, drag: o.drag || 0 }); };
  const burst = (key, x, y, n, o = {}) => { for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 200, o.sp1 || 600); fx(key, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g ?? 900, life: rand(0.6, 1.1) * (o.life || 1), s0: (o.s || 0.3) * rand(0.7, 1.2), s1: (o.s || 0.3) * rand(0.3, 0.7), rot: rand(0, 6), vr: rand(-8, 8), delay: o.delay, add: o.add, back: o.back, col: o.col, drag: o.drag }); } };
  const lightBurst = (x, y, n, col, sp = 700, size = 46) => burst('@', x, y, n, { col, s: size, sp0: sp * 0.3, sp1: sp, g: 0, drag: 2.6, life: 0.9, add: true });
  const inward = (x, y, col, d0, d1) => { const an = rand(0, 6.283), d = rand(d0, d1), life = rand(0.32, 0.5); fx('@', x + Math.cos(an) * d, y + Math.sin(an) * d * 0.85, { vx: -Math.cos(an) * d / life, vy: -Math.sin(an) * d * 0.85 / life, life, s0: rand(26, 54), s1: 8, col, add: true }); };
  const ring = (x, y, col, o = {}) => S.rings.push({ x, y, col, age: -(o.delay || 0), life: o.life || 0.55, r0: o.r0 || 40, r1: o.r1 || 620, w: o.w || 26, flat: o.flat || 1 });
  const drawFx = (key, x, y, s, rot, a) => { const r = DATA.fx[key]; if (!r) return; ctx.globalAlpha = a; ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(IMG.fx, r[0], r[1], r[2], r[3], -r[2] * s / 2, -r[3] * s / 2, r[2] * s, r[3] * s); ctx.restore(); ctx.globalAlpha = 1; };
  const glow = (x, y, size, col, a, sy = 1) => { if (a <= 0.005) return; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(tinted(glowBase(), 'g', col), x - size / 2, y - size * sy / 2, size, size * sy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; };
  const stepParts = (dt, backLayer) => {
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const p = S.parts[i]; if (p.back !== backLayer) continue;
      p.age += dt; if (p.age < 0) continue; if (p.age >= p.life) { S.parts.splice(i, 1); continue; }
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * ease(t), a = p.a * (t < 0.6 ? 1 : (1 - t) / 0.4);
      if (p.key === '@') { glow(p.x, p.y, s, p.col || '#ffffff', a); continue; }
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      drawFx(p.key, p.x, p.y, s, p.rot, a);
      if (p.add) ctx.globalCompositeOperation = 'source-over';
    }
  };
  const stepRings = (dt) => {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = S.rings.length - 1; i >= 0; i--) {
      const r = S.rings[i]; r.age += dt; if (r.age < 0) continue; if (r.age >= r.life) { S.rings.splice(i, 1); continue; }
      const t = r.age / r.life, rad = r.r0 + (r.r1 - r.r0) * ease(t);
      ctx.strokeStyle = r.col; ctx.globalAlpha = (1 - t) * 0.85; ctx.lineWidth = Math.max(1, r.w * (1 - t));
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * r.flat, 0, 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ---------- décor ----------
  const backdrop = () => {
    const c = S.bg, g = ctx.createLinearGradient(0, 0, 0, H);
    const tone = (m, b) => `rgb(${c[0] * m + b[0] | 0},${c[1] * m + b[1] | 0},${c[2] * m + b[2] | 0})`;      // nuit indigo, teintée par la couleur du moment
    g.addColorStop(0, tone(0.04, [12, 9, 36])); g.addColorStop(0.5, tone(0.09, [30, 18, 72])); g.addColorStop(1, tone(0.03, [8, 6, 26]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = ctx.createRadialGradient(S.ray.x, S.ray.y, 40, S.ray.x, S.ray.y, 980);
    r.addColorStop(0, css(c, 0.55, 0.8, 14)); r.addColorStop(0.45, css(c, 0.18, 0.7)); r.addColorStop(1, css(c, 0));
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  };
  const raysOf = (col, x, y, a) => {
    if (a <= 0.01) return;
    const img = tinted(raysBase(), 'r', col), s1 = 2300, s2 = 1500;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y);
    ctx.globalAlpha = Math.min(1, 0.62 * a); ctx.rotate(S.time * 0.11); ctx.drawImage(img, -s1 / 2, -s1 / 2, s1, s1);
    ctx.globalAlpha = Math.min(1, 0.5 * a); ctx.rotate(-S.time * 0.3 + 1.3); ctx.drawImage(img, -s2 / 2, -s2 / 2, s2, s2);
    ctx.restore();
  };
  const lights = () => {
    const r = S.ray;
    if (r.prev && r.fade < 1) raysOf(r.prev, r.x, r.y, r.p * (1 - r.fade));
    raysOf(r.col, r.x, r.y, r.p * r.fade);
    glow(r.x, r.y, 760 + 180 * r.p, r.col === 'rainbow' ? '#ffffff' : r.col, 0.2 + 0.3 * Math.min(1.4, r.p));
  };
  const motes = (dt) => {      // poussières lumineuses qui montent doucement
    ctx.fillStyle = css(S.bg, 1, 0.6, 120);
    for (const m of S.motes) {
      m.y -= m.v * dt * (1 + S.ray.p * 0.6); m.ph += dt; if (m.y < -20) { m.y = H + 20; m.x = rand(0, W); }
      ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.ph * 2.2));
      ctx.beginPath(); ctx.arc(m.x + Math.sin(m.ph) * 18, m.y, m.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  // ---------- la cage et son socle ----------
  const meta = () => DATA.chestMeta || { fw: 217, fh: 290, cols: 8 };
  const box = () => { const m = meta(); return (m.box && m.box[loot.tier]) || [m.fw * 0.12, m.fh * 0.2, m.fw * 0.88, m.fh * 0.8]; };   // le corps de la cage dans son image
  const chestH = () => CHW * meta().fh / meta().fw;
  const bodyH = () => (box()[3] - box()[1]) * CHW / meta().fw, bodyW = () => (box()[2] - box()[0]) * CHW / meta().fw;
  const mouth = () => ({ x: S.ch.x, y: S.ch.y - bodyH() * S.ch.s * 0.6 });
  const podium = (a) => {
    if (a <= 0.01) return;
    const c = rgbOf(C.color), { x, y, s } = S.ch;
    ctx.save(); ctx.translate(x, y - 30 * s); ctx.scale(s, s); ctx.globalAlpha = a;
    glow(0, 14, 1050, C.color, 0.5 * a * (0.5 + 0.5 * Math.min(1, S.ray.p)), 0.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = css(c, 1, 0.1, 8); ctx.beginPath(); ctx.ellipse(0, 40, 322, 70, 0, 0, 6.2832); ctx.fill();          // tranche
    const g = ctx.createLinearGradient(0, -60, 0, 70); g.addColorStop(0, css(c, 1, 0.42, 34)); g.addColorStop(1, css(c, 1, 0.16, 16));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 8, 322, 66, 0, 0, 6.2832); ctx.fill();                   // dessus
    ctx.lineWidth = 5; ctx.strokeStyle = css(c, 0.9, 0.8, 70); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = css(c, 0.4 + 0.2 * Math.sin(S.time * 3), 1, 40); ctx.beginPath(); ctx.ellipse(0, 8, 250, 49, 0, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.beginPath(); ctx.ellipse(0, 12, 190 * (1 + S.sq), 34, 0, 0, 6.2832); ctx.fill();   // ombre de la cage
    ctx.restore(); ctx.globalAlpha = 1;
  };
  const chest = (f, o = {}) => {
    const img = IMG['sheet_' + loot.tier], m = meta(), { x, y, s, a } = S.ch;
    if (loot.direct || a <= 0.01) return;
    podium(a * S.pod);
    if (!img || !img.width) return;
    const sq = S.sq + (o.sq || 0), w = CHW * s * (o.k || 1) * (1 + sq), hh = chestH() * s * (o.k || 1) * (1 - sq), yb = y + (o.dy || 0) * s, base = hh * box()[3] / m.fh;
    if (f >= 6) {      // lumière dans la cage ouverte (elle bouche aussi les trous des images)
      const cy = yb - base * 0.52, g = ctx.createRadialGradient(x, cy, 6, x, cy, w * 0.36);
      g.addColorStop(0, 'rgba(255,255,240,.96)'); g.addColorStop(0.45, css(rgbOf(C.color), 0.75)); g.addColorStop(1, css(rgbOf(C.color), 0));
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - w * 0.4, cy - w * 0.4, w * 0.8, w * 0.8);
      glow(x, cy, w * (1.2 + 0.08 * Math.sin(S.time * 7)), C.color, 0.5 * a);
    }
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x + (o.dx || 0) * s, yb); if (o.rot) ctx.rotate(o.rot);
    ctx.drawImage(img, (f % m.cols) * m.fw, Math.floor(f / m.cols) * m.fh, m.fw, m.fh, -w / 2, -base, w, hh);
    ctx.restore(); ctx.globalAlpha = 1;
    if (o.count !== false) counter();
  };
  const openFrame = () => 8 + (Math.floor(S.time * 5) % 2);
  function counter() {            // nombre de piles restantes, accroché à la cage
    const n = left(); if (n <= 0 || S.ch.a < 0.5) return;
    const s = S.ch.s, r = 26 + 18 * s, x = S.ch.x + bodyW() * 0.5 * s, y = S.ch.y - bodyH() * 0.9 * s, z = 1 + 0.25 * Math.max(0, 1 - (S.time - (S.cntAt || -9)) / 0.25);
    ctx.save(); ctx.translate(x, y); ctx.scale(z, z);
    ctx.fillStyle = '#1a0a08'; ctx.beginPath(); ctx.arc(0, 3, r + 5, 0, 6.3); ctx.fill();
    const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#ff6a4a'); g.addColorStop(1, '#c0201a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(0, -r * 0.42, r * 0.62, r * 0.32, 0, 0, 6.3); ctx.fill();
    label(ctx, String(n), 0, 2, r * 1.05, '#fff'); ctx.restore();
  }

  // ---------- cartes ----------
  const backBox = (r) => { const m = DATA.revealMeta || {}, b = m.back && m.back[r], fw = m.fw || 212, fh = m.fh || 282; return { fw, fh, cols: m.cols || 8, b: b || [fw * 0.18, fh * 0.14, fw * 0.82, fh * 0.86] }; };
  // Image f de la planche de révélation (dos de la carte qui tourne), le dos centré en (x, y) et large de w
  const cardBack = (r, f, x, y, w, o = {}) => {
    const img = IMG['reveal_' + r]; if (!img || !img.width) return;
    const m = backBox(r), sc = w / (m.b[2] - m.b[0]), ox = (m.b[0] + m.b[2]) / 2, oy = (m.b[1] + m.b[3]) / 2;
    f = Math.min(f, (m.cols === 4 ? 8 : 16) - 1);
    ctx.save(); ctx.globalAlpha = o.a ?? 1; if (o.add) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); ctx.scale((o.sx ?? 1) * sc, sc);
    ctx.drawImage(img, (f % m.cols) * m.fw, Math.floor(f / m.cols) * m.fh, m.fw, m.fh, -ox, -oy, m.fw, m.fh);
    ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  const faceImg = (id) => { const hd = IMG['cardhd_' + id]; return hd && hd.width ? hd : IMG['card_' + id]; };
  const cardFace = (id, x, y, w, o = {}) => {
    const img = faceImg(id); if (!img || !img.width) return 0;
    const hh = w * img.height / img.width;
    ctx.save(); ctx.globalAlpha = o.a ?? 1; ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); ctx.scale(o.sx ?? 1, 1);
    ctx.drawImage(img, -w / 2, -hh / 2, w, hh); ctx.restore(); ctx.globalAlpha = 1;
    return hh;
  };
  const shine = (id, x, y, w, p) => {       // bande de lumière qui traverse la carte (limitée à sa forme)
    const img = faceImg(id); if (!img || !img.width || p <= 0 || p >= 1) return;
    const sc = SPR.shine || (SPR.shine = mk(256, 352)), sx = sc.getContext('2d'), hh = w * img.height / img.width, bx = -140 + p * 640;
    sx.globalCompositeOperation = 'source-over'; sx.clearRect(0, 0, 256, 352);
    const g = sx.createLinearGradient(bx - 60, 0, bx + 60, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    sx.setTransform(1, 0, -0.5, 1, 0, 0); sx.fillStyle = g; sx.fillRect(-300, 0, 1200, 352); sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.globalCompositeOperation = 'destination-in'; sx.drawImage(img, 0, 0, 256, 352);
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(sc, x - w / 2, y - hh / 2, w, hh); ctx.globalCompositeOperation = 'source-over';
  };

  // ---------- textes et petits éléments ----------
  const pill = (x, y, w, hh, c1, c2) => {
    ctx.fillStyle = '#140c1e'; rr(ctx, x - w / 2 - 5, y - hh / 2 - 5, w + 10, hh + 13, hh / 2 + 6); ctx.fill();
    const g = ctx.createLinearGradient(0, y - hh / 2, 0, y + hh / 2); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; rr(ctx, x - w / 2, y - hh / 2, w, hh, hh / 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.26)'; rr(ctx, x - w / 2 + 10, y - hh / 2 + 5, w - 20, hh * 0.34, hh * 0.17); ctx.fill();
  };
  const title = (a) => {
    if (a <= 0.01) return;
    const z = back(a);
    drawText(ctx, C.name, CX, 176 - 60 * (1 - z), 72, 'yellow', Math.min(1, a * 1.5));
    ctx.globalAlpha = Math.min(1, a * 1.5); label(ctx, loot.welcome ? 'Cadeau de bienvenue !' : 'Cage ' + C.tier.toLowerCase(), CX, 262 - 40 * (1 - z), 32, '#f3e6d0'); ctx.globalAlpha = 1;
  };
  const icon = (img, x, y, s) => { if (img && img.width) ctx.drawImage(img, x - s / 2, y - s / 2, s, s); };
  const cardIcon = (x, y, s) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-0.16); ctx.fillStyle = '#1a1008'; rr(ctx, -s * 0.36, -s * 0.48, s * 0.72, s * 0.96, s * 0.14); ctx.fill(); ctx.fillStyle = '#4aa8ff'; rr(ctx, -s * 0.29, -s * 0.41, s * 0.58, s * 0.82, s * 0.1); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(0, s * 0.03, s * 0.14, 0, 6.3); ctx.fill(); ctx.restore(); };
  const contents = (y, a) => {          // ce que contient la cage : cartes, pièces, gemmes
    const items = [['card', loot.cards.reduce((n, c) => n + c.n, 0) + ' cartes'], ['coin', String(loot.coins)]]; if (loot.gems) items.push(['ruby', String(loot.gems)]);
    ctx.font = '34px "Lilita One",sans-serif';
    const ws = items.map((it) => 62 + ctx.measureText(it[1]).width), tot = ws.reduce((s, w) => s + w, 0) + 40 * (items.length - 1) + 60;
    ctx.globalAlpha = a; ctx.fillStyle = 'rgba(8,5,20,.62)'; rr(ctx, CX - tot / 2, y - 36, tot, 72, 36); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.stroke();
    let x = CX - tot / 2 + 30;
    items.forEach((it, i) => { if (it[0] === 'card') cardIcon(x + 24, y, 50); else icon(IMG[it[0]], x + 24, y, 48); label(ctx, it[1], x + 58, y + 1, 34, '#fff3d0', 'left'); x += ws[i] + 40; });
    ctx.globalAlpha = 1;
  };
  const hint = (str, y = 1634, size = 34) => drawText(ctx, str, CX, y, size, 'white', 0.55 + 0.35 * Math.sin(S.time * 4.2));
  const bar = (x, y, w, hh, r, full) => {
    ctx.fillStyle = '#120a1a'; rr(ctx, x - 6, y - 6, w + 12, hh + 14, hh / 2 + 6); ctx.fill();
    ctx.fillStyle = '#2c2140'; rr(ctx, x, y, w, hh, hh / 2); ctx.fill();
    const fw = Math.max(hh, w * r), g = ctx.createLinearGradient(0, y, 0, y + hh);
    if (full) { g.addColorStop(0, '#a8ff5a'); g.addColorStop(1, '#2fb313'); } else { g.addColorStop(0, '#d68cff'); g.addColorStop(1, '#8a2fe0'); }
    if (r > 0.005) {
      ctx.fillStyle = g; rr(ctx, x, y, fw, hh, hh / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.3)'; rr(ctx, x + 8, y + 5, fw - 16, hh * 0.32, hh * 0.16); ctx.fill();
      ctx.save(); rr(ctx, x, y, fw, hh, hh / 2); ctx.clip();                      // reflet qui glisse
      const p = (S.time * 0.7) % 1.6, sx = x - 80 + p * (w + 160), sg = ctx.createLinearGradient(sx - 40, 0, sx + 40, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.45)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(sx - 40, y, 80, hh); ctx.restore();
    }
  };
  const arrowUp = (x, y, s) => { ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, 0); ctx.lineTo(s * 0.38, 0); ctx.lineTo(s * 0.38, s * 0.85); ctx.lineTo(-s * 0.38, s * 0.85); ctx.lineTo(-s * 0.38, 0); ctx.lineTo(-s * 0.9, 0); ctx.closePath(); ctx.lineWidth = 9; ctx.strokeStyle = '#12300a'; ctx.stroke(); ctx.fillStyle = '#8dff3a'; ctx.fill(); ctx.restore(); };

  // ---------- boucle de dessin ----------
  function draw(dt) {
    S.time += dt; S.t += dt;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const e = 1 - Math.pow(0.0015, dt), e2 = 1 - Math.pow(0.00002, dt), r = S.ray;
    for (let i = 0; i < 3; i++) S.bg[i] += (S.bgT[i] - S.bg[i]) * e;
    r.x += (r.tx - r.x) * e2; r.y += (r.ty - r.y) * e2; r.p += (r.pT - r.p) * e2; r.fade = Math.min(1, r.fade + dt / 0.4);
    S.ch.x += (S.chT.x - S.ch.x) * e2; S.ch.y += (S.chT.y - S.ch.y) * e2; S.ch.s += (S.chT.s - S.ch.s) * e2;
    S.sqv += (-S.sq * 300 - S.sqv * 13) * dt; S.sq += S.sqv * dt;
    const sx = S.shake > 0.3 ? rand(-1, 1) * S.shake : 0, sy = S.shake > 0.3 ? rand(-1, 1) * S.shake : 0; S.shake *= Math.pow(0.004, dt);
    const cur = S.i >= 0 && S.i < stacks.length ? stacks[S.i] : null, R = cur ? RARITY[cur.rarity] : null;
    backdrop();
    ctx.save(); ctx.translate(sx, sy); lights(); motes(dt); ctx.restore();
    ctx.drawImage(vignette(), 0, 0, W, H);
    ctx.save(); ctx.translate(sx, sy);
    stepParts(dt, true);
    phases[S.phase](dt, cur, R);
    stepParts(dt, false); stepRings(dt);
    ctx.restore();
    if (S.flash > 0.01) { ctx.fillStyle = `rgba(${S.flashCol},${Math.min(1, S.flash)})`; ctx.fillRect(0, 0, W, H); S.flash *= Math.pow(0.003, dt); }
  }

  const phases = {
    load() {       // les images arrivent
      glow(CX, 800, 300 + 60 * Math.sin(S.time * 5), homeCol, 0.5);
    },
    drop(dt) {
      const T = 0.42, kf = clamp(S.t / T, 0, 1);
      S.pod = Math.min(1, S.pod + dt * 3.5);
      if (!S.whoosh) { S.whoosh = true; play('whoosh', { v: 0.5 }); }
      if (kf >= 1 && !S.landed) {
        S.landed = true; play('chest_land'); play('chest_thud', { v: 0.8 }); S.shake = 24; S.sq = 0.2; S.sqv = 0; S.flash = 0.22; S.ray.pT = 0.75;
        burst('smoke_puff', CX, BIG.y - 14, 9, { s: 0.36, sp0: 140, sp1: 420, up: 30, g: 100, back: true });
        fx('dust_ring', CX, BIG.y - 6, { s0: 0.6, s1: 2.8, life: 0.6, back: true });
        ring(CX, BIG.y - 10, C.color, { r0: 120, r1: 620, flat: 0.22, w: 18, life: 0.5 });
        lightBurst(CX, BIG.y - 120, 14, C.color, 620, 40);
      }
      title((S.t - 0.3) / 0.45);
      if (!S.landed) {       // traînée de chute
        const y = BIG.y - 1560 * (1 - kf * kf);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(tinted(glowBase(), 'g', C.color), CX - 150, y - 1250, 300, 1200); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        chest(0, { dy: y - BIG.y, sq: -0.07, count: false });
      } else chest(0, { count: false });
      if (S.t > 1.05) go('idle');
    },
    idle() {
      S.ray.pT = 0.72 + 0.08 * Math.sin(S.time * 2.6);
      title(1);
      // la cage s'impatiente : un petit saut toutes les 2,4 s
      const c = (S.t + 1.2) % 2.4, n = Math.floor((S.t + 1.2) / 2.4), hop = c > 1.7 && c < 2.12 ? Math.sin((c - 1.7) / 0.42 * Math.PI) : 0;
      if (c >= 2.12 && S.hopN !== n) { S.hopN = n; S.sq = 0.09; S.sqv = 0; play('chest_thud', { v: 0.22, rate: 1.3 }); burst('smoke_puff', CX, BIG.y - 10, 4, { s: 0.2, sp0: 80, sp1: 220, g: 60, back: true, life: 0.6 }); }
      chest(hop ? 1 + Math.floor(c * 14) % 3 : 0, { dy: -hop * 30, rot: hop ? Math.sin(c * 42) * 0.03 * hop : 0, k: 1 + Math.sin(S.time * 3) * 0.008 });
      if (Math.random() < 0.16) fx('star_big', CX + rand(-290, 290), BIG.y - rand(60, 640), { s0: 0.02, s1: 0.13, life: 0.9, vy: -40, add: true, back: Math.random() < 0.6 });
      contents(BIG.y + 150, clamp(S.t / 0.3, 0, 1));
      hint('Touche pour ouvrir', 1440, 46);
      if (TEST || S.skip) tap();
    },
    shake() {
      const dur = S.skip ? 0.3 : 0.8 + 0.07 * tierN, kf = clamp(S.t / dur, 0, 1), f = 1 + Math.floor(S.t * (9 + 14 * kf)) % 3, cy = BIG.y - bodyH() * 0.5;
      S.shake = Math.max(S.shake, 3 + 13 * kf * kf); S.ray.pT = 0.85 + 0.95 * kf;
      title(1 - kf * 1.6);
      if (Math.random() < 0.4 + 0.5 * kf) inward(CX, cy, Math.random() < 0.3 ? '#ffffff' : C.color, 340, 640);     // la lumière est aspirée par la cage
      if (Math.random() < 0.4) fx('star_big', CX + rand(-230, 230), cy + rand(-260, 260), { s0: 0.05, s1: 0.18, life: 0.5, add: true });
      chest(f, { dx: rand(-1, 1) * 8 * kf, dy: rand(-1, 1) * 4 * kf, rot: rand(-1, 1) * 0.035 * kf, k: 1 + 0.08 * kf * kf });
      glow(CX, cy, 520 + 260 * kf, C.color, 0.15 + 0.45 * kf * kf);
      if (S.t >= dur) go('open');
    },
    open() {
      const f = S.t < 0.08 ? 3 : 4 + Math.min(4, Math.floor((S.t - 0.08) / 0.07)), cy = BIG.y - bodyH() * 0.5;
      if (f >= 6 && !S.boom) {
        S.boom = true; play('chest_open'); S.flash = 0.8; S.flashCol = '255,250,225'; S.shake = 34; S.sq = -0.14; S.sqv = 0; S.ray.pT = 1.7;
        ring(CX, cy, '#ffffff', { r0: 60, r1: 900, w: 46, life: 0.55 }); ring(CX, cy, C.color, { r0: 30, r1: 700, w: 30, life: 0.75, delay: 0.08 });
        burst('star_big', CX, cy, 26, { s: 0.36, sp0: 300, sp1: 1000, up: 280, add: true });
        lightBurst(CX, cy, 30, C.color, 1300, 60); lightBurst(CX, cy, 14, '#ffffff', 900, 40);
        burst('coins_small', CX, cy, 12, { s: 0.3, sp0: 250, sp1: 720, up: 520 });
        fx(PILLAR[stacks.length ? stacks[stacks.length - 1].rarity : 'common'], CX, cy - 60, { s0: 0.8, s1: 2.8, life: 0.9, add: true, back: true });
      }
      chest(f, { k: 1.08 - 0.08 * ease(S.t / 0.4), count: false });
      if (S.t > 0.62) go('pour');
    },
    pour() {          // pièces et gemmes d'abord
      S.ray.pT = 1.05; const cy = BIG.y - bodyH() * 0.6;
      chest(openFrame());
      if (!S.coinsShown) {
        S.coinsShown = true; play('coins'); play('coins', { at: 0.15, rate: 1.1 });
        burst('coins_small', CX, cy, 16, { s: 0.36, sp0: 200, sp1: 620, up: 760, g: 1400 });
        if (loot.gems) { play('gems', { at: 0.3 }); burst('gem_purple', CX, cy, 9, { s: 0.3, sp0: 200, sp1: 520, up: 760, g: 1400, delay: 0.25 }); }
      }
      if (S.t < 0.5 && Math.random() < 0.5) fx('coins_small', CX + rand(-60, 60), cy, { vx: rand(-260, 260), vy: rand(-900, -500), g: 1500, life: 1, s0: 0.3, s1: 0.2, rot: rand(0, 6), vr: rand(-8, 8) });
      const gain = (img, n, x, col, name, d) => {
        const z = back((S.t - d) / 0.35); if (z <= 0) return;
        glow(x, 360, 300 * z, col === 'yellow' ? '#ffd23f' : '#ff6ad5', 0.35);
        icon(img, x, 330, 132 * z);
        drawText(ctx, '+' + Math.round(n * ease((S.t - d - 0.1) / 0.55)), x, 452, 68 * z, col);
        label(ctx, name, x, 512, 30, col === 'yellow' ? '#ffe680' : '#ffc2f4');
      };
      if (loot.gems) { gain(IMG.coin, loot.coins, CX - 175, 'yellow', 'pièces', 0); gain(IMG.ruby, loot.gems, CX + 175, 'pink', 'gemmes', 0.18); } else gain(IMG.coin, loot.coins, CX, 'yellow', 'pièces', 0);
      if (S.t > 1.35 || S.skip) nextCard();
    },
    card(dt, c, R) {  // le dos de la carte jaillit de la cage et vole jusqu'au centre en tournoyant
      const T = 0.52, kf = clamp(S.t / T, 0, 1), e = easeIO(kf), from = S.from, side = S.i % 2 ? 1 : -1;
      S.ray.pT = 0.3 + 0.5 * kf;
      chest(openFrame());
      const px = (from.x + CX) / 2 + side * 250, py = Math.min(from.y, CARD_Y) - 220;
      const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * px + e * e * CX, y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * py + e * e * CARD_Y;
      const w = CARD_W * (0.1 + 0.9 * ease(kf)), flip = Math.cos((1 - e) * 6.2832), rot = (1 - e) * side * -1.1;
      S.trail.push({ x, y, w }); if (S.trail.length > 12) S.trail.shift();
      S.trail.forEach((p, i) => glow(p.x, p.y, p.w * (0.8 + i * 0.06), R.color, 0.05 + 0.03 * i));
      if (Math.random() < 0.7) fx('star_big', x + rand(-40, 40), y + rand(-40, 40), { s0: 0.12, s1: 0.02, life: 0.45, add: true, vr: 4 });
      cardBack(c.rarity, 0, x, y, w, { rot, sx: Math.abs(flip) < 0.06 ? 0.06 : flip });
      if (S.t >= T) {
        S.trail.length = 0; ring(CX, CARD_Y, R.color, { r0: 120, r1: 420, w: 14, life: 0.35 });
        if (SUSPENSE[c.rarity] && !S.skip) { go('suspense'); play('surge', { v: 0.7, rate: c.rarity === 'epic' ? 1.15 : c.rarity === 'rare' ? 1.4 : 1 }); } else { go('reveal'); S.shown = false; }
      }
    },
    suspense(dt, c, R) {    // les cartes rares se font attendre : la carte bat comme un cœur, la lumière afflue
      const dur = SUSPENSE[c.rarity], kf = clamp(S.t / dur, 0, 1), beat = Math.pow(Math.max(0, Math.sin(S.t * (8 + 10 * kf))), 6);
      S.ray.pT = 0.5 + 1.2 * kf; S.shake = Math.max(S.shake, 1.5 + 9 * kf * kf);
      chest(openFrame());
      if (Math.random() < 0.45 + 0.5 * kf) inward(CX, CARD_Y, R.rainbow ? RAINBOW[Math.floor(rand(0, 6))] : Math.random() < 0.25 ? '#ffffff' : R.color, 380, 700);
      if (c.rarity !== 'rare' && Math.random() < 0.12 + kf * 0.45) fx(c.rarity === 'epic' ? 'electric' : c.rarity === 'ultimate' ? (Math.random() < 0.5 ? 'lightning' : 'electric') : 'lightning', CX + rand(-230, 230), CARD_Y + rand(-300, 300), { s0: 0.3, s1: 0.6, life: 0.22, add: true, rot: rand(0, 6) });
      glow(CX, CARD_Y, 700 + 300 * kf + 80 * beat, R.color, 0.3 + 0.5 * kf);
      cardBack(c.rarity, 0, CX + rand(-1, 1) * 7 * kf, CARD_Y - 14 * kf + rand(-1, 1) * 5 * kf, CARD_W * (1 + 0.05 * beat + 0.05 * kf), { rot: rand(-1, 1) * 0.04 * kf });
      if (kf > 0.25) cardBack(c.rarity, 0, CX, CARD_Y - 14 * kf, CARD_W * (1 + 0.05 * beat + 0.05 * kf), { add: true, a: 0.35 * kf * (0.4 + 0.6 * beat) });
      if (S.t >= dur || S.skip) { go('reveal'); S.shown = false; }
    },
    reveal(dt, c, R) {
      const SPIN = 0.32;
      setRay(rayCol(R), CX, CARD_Y);
      chest(openFrame());
      if (S.t < SPIN) {        // la carte pivote sur la tranche (images de la planche)
        S.ray.pT = 0.9 + 0.7 * S.t / SPIN;
        if (!S.flipSnd) { S.flipSnd = true; play('card_flip', { v: 0.7 }); }
        glow(CX, CARD_Y, 760, R.color, 0.5);
        cardBack(c.rarity, 1 + Math.min(5, Math.floor(S.t / SPIN * 6)), CX, CARD_Y, CARD_W);
        return;
      }
      const t = S.t - SPIN, big = c.rarity === 'legendary' || c.rarity === 'ultimate';
      if (!S.shown) {
        S.shown = true; S.flipSnd = false; S.shownAt = S.time;
        S.flash = c.rarity === 'common' ? 0.4 : 0.8; S.flashCol = c.rarity === 'ultimate' ? '255,225,255' : '255,255,255';
        S.shake = { common: 6, rare: 10, epic: 18, legendary: 28, ultimate: 36 }[c.rarity]; S.ray.pT = 1.5;
        play('rev_' + c.rarity); if (c.isNew) play('new_card', { at: 0.35 });
        play('v_' + c.id, { at: 0.25, v: 0.7 });
        const n = { common: 10, rare: 14, epic: 20, legendary: 30, ultimate: 40 }[c.rarity];
        burst('star_big', CX, CARD_Y, n, { s: 0.3, sp0: 300, sp1: 950, up: 200, add: true });
        ring(CX, CARD_Y, '#ffffff', { r0: 150, r1: 760, w: 34, life: 0.5 }); ring(CX, CARD_Y, R.color, { r0: 100, r1: 620, w: 24, life: 0.7, delay: 0.07 });
        if (R.rainbow) RAINBOW.forEach((col) => lightBurst(CX, CARD_Y, 8, col, 1300, 56)); else lightBurst(CX, CARD_Y, n * 1.4, R.color, 1200, 54);
        fx(PILLAR[c.rarity], CX, CARD_Y + 120, { s0: 1, s1: 2.8, life: 1.1, add: true, back: true });
        if (big) { burst('confetti', CX, CARD_Y - 200, 18, { s: 0.5, sp0: 300, sp1: 850, up: 520, g: 600, life: 2.4 }); fx('crown_burst', CX, 120, { s0: 0.2, s1: 0.62, life: 1.6, vy: -14, back: true }); }
        if (c.rarity === 'epic' || c.rarity === 'ultimate') fx('purple_ring', CX, CARD_Y, { s0: 0.5, s1: 3.2, life: 0.8, add: true, back: true });
      }
      S.ray.pT = big ? 1.35 : 1.05;
      // ambiance selon la rareté
      if (c.rarity === 'ultimate' && Math.random() < 0.05) ring(CX, CARD_Y, RAINBOW[Math.floor(rand(0, 6))], { r0: 200, r1: 640, w: 12, life: 0.8 });
      if (Math.random() < 0.22) fx('star_big', CX + rand(-290, 290), CARD_Y + rand(-360, 360), { s0: 0.03, s1: 0.15, life: 0.7, add: true });
      if (c.rarity !== 'common' && Math.random() < (big ? 0.6 : 0.3)) fx('@', CX + rand(-270, 270), CARD_Y + rand(120, 340), { vy: rand(-260, -120), vx: rand(-30, 30), life: rand(0.8, 1.4), s0: rand(14, 34), s1: 4, col: R.rainbow ? RAINBOW[Math.floor(rand(0, 6))] : R.glow, add: true, back: Math.random() < 0.5 });
      // la carte finit de se retourner, face visible, avec un rebond
      const sx = Math.max(0.05, back(t / 0.22, 2.2)), pop = 1 + 0.2 * (1 - ease(t / 0.4)), fy = CARD_Y + Math.sin(S.time * 2) * 5, w = CARD_W * pop;
      glow(CX, fy, 860 + 60 * Math.sin(S.time * 3), R.color, 0.5);
      const hh = cardFace(c.id, CX, fy, w, { sx: sx * (1 + 0.012 * Math.sin(S.time * 1.7)), rot: 0.012 * Math.sin(S.time * 1.3) });
      if (t < 0.32) cardBack(c.rarity, 7, CX, fy, w, { add: true, a: 1 - t / 0.32, sx });        // éclat blanc de la planche par-dessus
      const sh = ((S.time - S.shownAt - 0.5) % 2.6) / 0.6; if (t > 0.5) shine(c.id, CX, fy, w, sh);
      // rareté, nouveau, nombre, progression
      const a = clamp((t - 0.12) / 0.25, 0, 1), za = back((t - 0.12) / 0.3);
      if (a > 0) {
        const rc = rgbOf(R.color), rw = 150 + R.name.length * 21;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(CX, 236 - 30 * (1 - za));
        pill(0, 0, rw, 62, css(rc, 1, 1, 40), css(rc, 1, 0.72)); label(ctx, R.name, 0, 1, 38, '#fff'); ctx.restore();
      }
      if (c.isNew && t > 0.3) {       // tampon « NOUVEAU ! » qui s'écrase sur la carte
        const zt = clamp((t - 0.3) / 0.18, 0, 1), z = (2.6 - 1.6 * ease(zt)) * (1 + 0.05 * Math.sin(S.time * 8));
        if (zt >= 1 && !S.stamp) { S.stamp = true; S.shake = Math.max(S.shake, 9); burst('star_big', CX + 165, fy - hh / 2 + 6, 8, { s: 0.2, sp0: 200, sp1: 520, add: true, life: 0.6 }); }
        ctx.save(); ctx.globalAlpha = zt; ctx.translate(CX + 165, fy - hh / 2 + 6); ctx.rotate(0.2); ctx.scale(z, z);
        ctx.fillStyle = '#1a0a08'; rr(ctx, -122, -40, 244, 88, 22); ctx.fill();
        const g = ctx.createLinearGradient(0, -36, 0, 36); g.addColorStop(0, '#ff6a4a'); g.addColorStop(1, '#d81f1f'); ctx.fillStyle = g; rr(ctx, -114, -34, 228, 68, 18); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.28)'; rr(ctx, -104, -28, 208, 22, 11); ctx.fill();
        label(ctx, 'NOUVEAU !', 0, 2, 40, '#fff'); ctx.restore();
      }
      const y0 = CARD_Y + CARD_W * 1.375 / 2;                       // sous la carte
      if (a > 0) {
        const cn = Math.max(1, Math.round(c.n * ease((t - 0.15) / 0.45)));
        if (cn !== S.cn) { S.cn = cn; if (c.n > 1 && cn % Math.ceil(c.n / 6) === 0) play('tick', { v: 0.25, rate: 1 + cn / c.n * 0.5 }); }
        drawText(ctx, 'x' + cn, CX, y0 + 64, 86 * (0.6 + 0.4 * za), 'white', a);
        ctx.globalAlpha = a;
        const need = upgradeCost(c.id, c.level), bw = 400, bx = CX - bw / 2 + 28, by = y0 + 122;
        if (need) {
          const from = c.isNew ? 0 : Math.min(1, (c.had || 0) / need.cards), to = Math.min(1, c.count / need.cards), r = from + (to - from) * ease((t - 0.4) / 0.6), full = c.count >= need.cards;
          bar(bx, by, bw, 42, r, full && r >= 0.999);
          label(ctx, `${Math.round((c.had || 0) + (c.count - (c.had || 0)) * ease((t - 0.4) / 0.6))} / ${need.cards}`, bx + bw / 2, by + 22, 28, '#fff');
          if (full && t > 1) { arrowUp(bx + bw + 40, by + 16 - 6 * Math.abs(Math.sin(S.time * 5)), 24); drawText(ctx, 'Prêt à améliorer !', CX, by + 100, 38, 'green', 0.65 + 0.35 * Math.sin(S.time * 6)); }
        } else { bar(bx, by, bw, 42, 1, true); label(ctx, 'Niveau max', bx + bw / 2, by + 22, 28, '#fff'); }
        // médaillon du niveau, à gauche de la barre
        ctx.fillStyle = '#120a1a'; ctx.beginPath(); ctx.arc(bx - 30, by + 22, 40, 0, 6.3); ctx.fill();
        const lg = ctx.createLinearGradient(0, by - 14, 0, by + 58); lg.addColorStop(0, '#6fc2ff'); lg.addColorStop(1, '#1f6fd6'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(bx - 30, by + 20, 33, 0, 6.3); ctx.fill();
        label(ctx, String(c.level), bx - 30, by + 22, 38, '#fff');
        ctx.globalAlpha = 1;
      }
      if (t > 0.6) hint(left() > 0 ? 'Touche pour continuer' : loot.direct ? 'Touche pour revenir' : 'Touche pour finir', loot.direct ? 1560 : 1636, loot.direct ? 38 : 30);
      if ((TEST || S.skip) && t > 0.12) tap();
    },
    summary() {
      S.ray.pT = 0.6;
      drawText(ctx, loot.welcome ? 'Bienvenue !' : 'Contenu de la cage', CX, 176 - 60 * (1 - back(S.t / 0.4)), 64, 'yellow', clamp(S.t / 0.25, 0, 1));
      const n = stacks.length, cols = n <= 4 ? n : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols), cw = cols <= 3 ? 236 : 196, chh = cw * 1.375, gap = 26, rowH = chh + 96;
      const y0 = Math.max(330 + chh / 2, 800 - (rows * rowH) / 2 + chh / 2 - 40);
      stacks.forEach((c, i) => {
        const inRow = Math.min(cols, n - Math.floor(i / cols) * cols), col = i % cols, row = Math.floor(i / cols), R = RARITY[c.rarity];
        const x = CX - (inRow * cw + (inRow - 1) * gap) / 2 + col * (cw + gap) + cw / 2, y = y0 + row * rowH, kf = clamp((S.t - 0.12 - i * 0.09) / 0.42, 0, 1), z = back(kf, 1.4);
        if (kf <= 0) return;
        if (!c.dealt) { c.dealt = true; play('card_fly', { v: 0.5, rate: 1.2 + i * 0.05 }); }
        const px = CX + (x - CX) * z, py = H + 200 + (y - H - 200) * z;
        glow(px, py, cw * 2.1, R.color, 0.42 * kf);
        cardFace(c.id, px, py + Math.sin(S.time * 2 + i) * 3, cw * (0.6 + 0.4 * z), { rot: (1 - z) * (i % 2 ? 0.5 : -0.5) });
        if (kf > 0.75) {
          const a = (kf - 0.75) / 0.25, rc = rgbOf(R.color);
          ctx.globalAlpha = a; pill(x, y + chh / 2 + 34, 104, 46, css(rc, 1, 1, 40), css(rc, 1, 0.7)); label(ctx, 'x' + c.n, x, y + chh / 2 + 35, 32, '#fff');
          if (c.isNew) { ctx.save(); ctx.translate(x + cw * 0.22, y - chh / 2 + 2); ctx.rotate(0.14); ctx.fillStyle = '#1a0a08'; rr(ctx, -68, -22, 136, 46, 14); ctx.fill(); ctx.fillStyle = '#ee2f2a'; rr(ctx, -63, -18, 126, 36, 11); ctx.fill(); label(ctx, 'NOUVEAU', 0, 1, 23, '#fff'); ctx.restore(); }
          ctx.globalAlpha = 1;
        }
      });
      const y = y0 + (rows - 1) * rowH + chh / 2 + 150, a = clamp((S.t - 0.3 - n * 0.09) / 0.3, 0, 1);
      if (a > 0 && (loot.coins || loot.gems)) {
        const tw = loot.gems ? 520 : 300;
        ctx.globalAlpha = a; ctx.fillStyle = 'rgba(8,5,20,.62)'; rr(ctx, CX - tw / 2, y - 48, tw, 96, 48); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.stroke();
        icon(IMG.coin, CX - tw / 2 + 70, y, 70); label(ctx, '+' + loot.coins, CX - tw / 2 + 116, y + 2, 46, '#ffe680', 'left');
        if (loot.gems) { icon(IMG.ruby, CX + 40, y, 70); label(ctx, '+' + loot.gems, CX + 86, y + 2, 46, '#ffc2f4', 'left'); }
        ctx.globalAlpha = 1;
      }
      if (Math.random() < 0.1) fx('star_big', rand(60, W - 60), rand(260, 1400), { s0: 0.03, s1: 0.14, life: 0.9, add: true, back: true });
      if (S.t > 0.6 + n * 0.09) hint('Touche pour revenir', 1560, 40);
      if (TEST && S.t > 0.1) tap();
    },
  };
  function nextCard() {
    S.i++; S.t = 0; S.shown = false; S.stamp = false; S.cn = 0; S.cntAt = S.time;
    if (S.i >= stacks.length && loot.direct) { close(); return; }
    if (S.i >= stacks.length) {        // la cage vide disparaît dans un nuage, place au résumé
      burst('smoke_puff', S.ch.x, S.ch.y - 110, 8, { s: 0.3, sp0: 100, sp1: 320, g: 60, life: 0.8 }); lightBurst(S.ch.x, S.ch.y - 110, 12, C.color, 600, 40);
      S.ch.a = 0; S.phase = 'summary'; play('reward'); skip.hidden = true; setRay(C.color, CX, 760); S.bgT = rgbOf(C.color); return;
    }
    const c = stacks[S.i], R = RARITY[c.rarity];
    S.phase = 'card'; play('card_fly', { rate: 1 + S.i * 0.03 });
    S.chT = SMALL; S.bgT = rgbOf(R.color); setRay(S.ray.col, CX, CARD_Y);
    S.from = loot.direct ? { x: CX, y: H + 260 } : mouth(); S.sq = 0.12; S.sqv = 0;
    if (!loot.direct) { burst('star_big', S.from.x, S.from.y, 8, { s: 0.2, sp0: 150, sp1: 500, up: 200, add: true, life: 0.6 }); lightBurst(S.from.x, S.from.y, 10, R.color, 700, 44); }
  }
  function tap() {
    if (S.phase === 'idle') { go('shake'); play('chest_shake'); return; }
    if (S.phase === 'pour' && S.t > 0.35) { nextCard(); return; }
    if (S.phase === 'reveal' && S.shown && S.t > (TEST || S.skip ? 0.45 : 0.85)) { nextCard(); return; }
    if (S.phase === 'summary' && (S.t > 0.5 || TEST)) close();
  }
  let resolve, raf = 0, last = performance.now();
  const loop = (now) => { raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!document.hidden) draw(dt); };
  const close = () => { if (S.done) return; S.done = true; cancelAnimationFrame(raf); el.classList.add('out'); sfx.click(); setTimeout(() => el.remove(), 250); resolve(); };
  el.addEventListener('pointerdown', (e) => { if (e.target === skip) return; tap(); });
  raf = requestAnimationFrame(loop);
  const done = new Promise((r) => { resolve = r; });
  Promise.race([ready, wait(5000)]).then(() => {      // les images sont là : la scène commence
    if (S.done) return;
    if (loot.direct) { skip.hidden = true; S.ray.pT = 0.6; nextCard(); } else go('drop');
  });
  return done;
}
