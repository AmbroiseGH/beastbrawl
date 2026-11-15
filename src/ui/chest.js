// Ouverture d'une cage : la cage tombe, tremble, s'ouvre dans un éclair, puis chaque pile de cartes sort et se
// révèle avec une mise en scène qui dépend de sa rareté (plus c'est rare, plus c'est long, lumineux et bruyant).
// Tout est dessiné sur un canvas plein écran ; un toucher fait avancer la scène.
import { $, h, clamp, rand, wait, TEST } from '../core/utils.js';
import { play, sfx } from '../core/audio.js';
import { IMG, DATA, chestAssets, revealAssets } from '../core/assets.js';
import { ANIMALS, MAX_LEVEL } from '../data/animals.js';
import { CHESTS, RARITY, upgradeCost } from '../data/cards.js';
import { view as stageView } from './stage.js';
import { drawText, label, rr } from '../render/view.js';

const W = 941, H = 1672, CX = 470;
const CHEST_Y = 1160;                        // bas de la cage
const CARD_Y = 640;                          // centre de la carte révélée
const RW = 212, RH = 282;                    // une image des planches de révélation
const SUSPENSE = { common: 0, rare: 0.15, epic: 0.55, legendary: 1.05, ultimate: 1.5 };
const PILLAR = { common: 'pillar_blue', rare: 'pillar_gold', epic: 'pillar_purple', legendary: 'pillar_gold', ultimate: 'pillar_purple' };
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const back = (t) => { t = clamp(t, 0, 1); const s = 1.7; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export async function openChestAnim(loot) {
  const rarities = [...new Set(loot.cards.map((c) => ANIMALS[c.id].rarity))];
  const ready = Promise.all([loot.direct ? null : chestAssets(loot.tier), ...rarities.map(revealAssets)]);   // direct : cartes achetées, sans cage
  const cv = h('canvas', { class: 'ch-cv' });
  const skip = h('button', { class: 'ch-skip t xs', onclick: (e) => { e.stopPropagation(); S.skip = true; tap(); } }, 'Tout voir ▸▸');
  const el = h('div', { class: 'chest-ov' }, cv, skip);
  $('modals').append(el);
  const ctx = cv.getContext('2d');
  let k = 1;
  const fit = () => { k = clamp(stageView.scale * (window.devicePixelRatio || 1), 0.5, 1.4); cv.width = Math.round(W * k); cv.height = Math.round(H * k); };
  fit();
  await Promise.race([ready, wait(4000)]);

  const C = CHESTS[loot.tier] || CHESTS.rustique, meta = DATA.chestMeta || { fw: 217, fh: 290, cols: 8 };
  const S = { phase: 'drop', t: 0, i: -1, skip: false, done: false, parts: [], shake: 0, flash: 0, flashCol: '255,255,255', rays: 0, rayCol: C.color, time: 0, coinsShown: false };
  const stacks = loot.cards.map((c) => ({ ...c, rarity: ANIMALS[c.id].rarity }));
  const left = () => stacks.length - Math.max(0, S.i) - (S.phase === 'card' || S.phase === 'reveal' || S.phase === 'suspense' ? 1 : 0);

  // ---------- particules (atlas des effets) ----------
  const fx = (key, x, y, o = {}) => { if (DATA.fx && DATA.fx[key]) S.parts.push({ key, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.6, s0: o.s0 ?? 0.3, s1: o.s1 ?? 0.6, rot: o.rot || 0, vr: o.vr || 0, a: o.a ?? 1, add: !!o.add, back: !!o.back }); };
  const burst = (key, x, y, n, o = {}) => { for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 200, o.sp1 || 600); fx(key, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g ?? 900, life: rand(0.6, 1.1) * (o.life || 1), s0: (o.s || 0.3) * rand(0.7, 1.2), s1: (o.s || 0.3) * rand(0.3, 0.7), rot: rand(0, 6), vr: rand(-8, 8), delay: o.delay, add: o.add, back: o.back }); } };
  const drawFx = (key, x, y, s, rot, a) => { const r = DATA.fx[key]; if (!r) return; ctx.globalAlpha = a; ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(IMG.fx, r[0], r[1], r[2], r[3], -r[2] * s / 2, -r[3] * s / 2, r[2] * s, r[3] * s); ctx.restore(); ctx.globalAlpha = 1; };
  const stepParts = (dt, backLayer) => {
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const p = S.parts[i]; if (p.back !== backLayer) continue;
      p.age += dt; if (p.age < 0) continue; if (p.age >= p.life) { S.parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * ease(t), a = p.a * (t < 0.6 ? 1 : (1 - t) / 0.4);
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      drawFx(p.key, p.x, p.y, s, p.rot, a);
      if (p.add) ctx.globalCompositeOperation = 'source-over';
    }
  };

  // ---------- dessin ----------
  const rays = (x, y, col, power, rainbow) => {
    if (power <= 0.01) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(S.time * 0.35); ctx.globalCompositeOperation = 'lighter';
    const n = 18;
    for (let i = 0; i < n; i++) {
      const c = rainbow ? `hsla(${(i * 40 + S.time * 120) % 360},100%,65%,` : null;
      const g = ctx.createLinearGradient(0, 0, 0, -900);
      g.addColorStop(0, rainbow ? c + (0.55 * power) + ')' : hexA(col, 0.5 * power)); g.addColorStop(1, rainbow ? c + '0)' : hexA(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-48, -900); ctx.lineTo(48, -900); ctx.closePath(); ctx.fill();
      ctx.rotate(6.283 / n);
    }
    ctx.restore();
    const g = ctx.createRadialGradient(x, y, 10, x, y, 380);
    g.addColorStop(0, rainbow ? `hsla(${(S.time * 120) % 360},100%,80%,${0.6 * power})` : hexA(col, 0.55 * power)); g.addColorStop(1, hexA(col, 0));
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - 400, y - 400, 800, 800); ctx.globalCompositeOperation = 'source-over';
  };
  const chestFrame = (f, x, yBottom, s) => {
    const img = IMG['sheet_' + loot.tier]; if (loot.direct || !img || !img.width) return;
    const fw = meta.fw, fh = meta.fh, col = f % meta.cols, row = Math.floor(f / meta.cols), w = fw * s, hh = fh * s;
    if (f >= 6) {      // lumière derrière la cage ouverte (elle bouche aussi les trous des images)
      const g = ctx.createRadialGradient(x, yBottom - hh * 0.42, 10, x, yBottom - hh * 0.42, w * 0.55);
      g.addColorStop(0, 'rgba(255,255,240,.95)'); g.addColorStop(0.45, hexA(C.color, 0.75)); g.addColorStop(1, hexA(C.color, 0));
      ctx.fillStyle = g; ctx.fillRect(x - w, yBottom - hh, w * 2, hh);
    }
    ctx.drawImage(img, col * fw, row * fh, fw, fh, x - w / 2, yBottom - hh, w, hh);
  };
  const revealFrame = (r, f, x, y, s, rot = 0, a = 1) => {
    const img = IMG['reveal_' + r]; if (!img || !img.width) return;
    const w = RW * s, hh = RH * s;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(img, (f % 8) * RW, Math.floor(f / 8) * RH, RW, RH, -w / 2, -hh / 2, w, hh); ctx.restore(); ctx.globalAlpha = 1;
  };
  const cardFace = (id, x, y, s, a = 1) => { const img = IMG['card_' + id]; if (!img || !img.width) return; const w = 400 * s, hh = 550 * s; ctx.globalAlpha = a; ctx.drawImage(img, x - w / 2, y - hh / 2, w, hh); ctx.globalAlpha = 1; };

  function draw(dt) {
    S.time += dt; S.t += dt;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // fond
    const cur = S.i >= 0 && S.i < stacks.length ? stacks[S.i] : null;
    const R = cur ? RARITY[cur.rarity] : null;
    const g = ctx.createRadialGradient(CX, 760, 60, CX, 760, 1100);
    g.addColorStop(0, R && S.phase !== 'pour' ? hexA(R.dark, 1) : '#2a2350'); g.addColorStop(1, '#070818');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (S.shake > 0.3) { ctx.translate(rand(-1, 1) * S.shake, rand(-1, 1) * S.shake); S.shake *= Math.pow(0.004, dt); }
    stepParts(dt, true);
    const step = phases[S.phase]; if (step) step(dt, cur, R);
    stepParts(dt, false);
    ctx.restore();
    if (S.flash > 0.01) { ctx.fillStyle = `rgba(${S.flashCol},${S.flash})`; ctx.fillRect(0, 0, W, H); S.flash *= Math.pow(0.004, dt); }
  }
  const title = () => { drawText(ctx, C.name, CX, 180, 70, 'yellow'); label(ctx, loot.welcome ? 'Cadeau de bienvenue !' : 'Cage ' + C.tier.toLowerCase(), CX, 262, 30, '#e8dccb'); };
  const counter = (x, y) => { // nombre de piles restantes, sur la cage
    const n = left(); if (n <= 0) return;
    ctx.fillStyle = '#c0281e'; ctx.beginPath(); ctx.arc(x, y, 40, 0, 6.3); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#1a0a08'; ctx.stroke();
    label(ctx, String(n), x, y + 2, 40, '#fff');
  };
  const chestBob = () => 1 + Math.sin(S.time * 3) * 0.012;

  const phases = {
    drop(dt) {
      const k = clamp(S.t / 0.55, 0, 1), y = -200 + (CHEST_Y + 200) * (k < 1 ? k * k : 1);
      if (k >= 1 && !S.landed) { S.landed = true; play('chest_land'); play('chest_thud', { v: 0.8 }); S.shake = 26; burst('smoke_puff', CX, CHEST_Y - 20, 8, { s: 0.35, sp0: 120, sp1: 360, up: 40, g: 120, back: true }); fx('dust_ring', CX, CHEST_Y - 10, { s0: 0.6, s1: 2.6, life: 0.6 }); }
      S.rays = Math.min(1, S.rays + dt * 1.6);
      rays(CX, CHEST_Y - 300, C.color, S.landed ? S.rays * 0.7 : 0);
      title();
      const sq = S.landed ? 1 - 0.12 * Math.max(0, 1 - (S.t - 0.55) / 0.25) : 1;
      chestFrame(0, CX, y, 2.3 * (2 - sq) * 0.5 + 2.3 * 0.5);
      if (S.t > 0.95) { S.phase = 'idle'; S.t = 0; }
    },
    idle() {
      rays(CX, CHEST_Y - 300, C.color, 0.7 + 0.1 * Math.sin(S.time * 3));
      title();
      chestFrame(0, CX, CHEST_Y + Math.sin(S.time * 2.5) * 6, 2.3 * chestBob());
      if (Math.random() < 0.15) fx('star_big', CX + rand(-260, 260), CHEST_Y - rand(80, 560), { s0: 0.02, s1: 0.12, life: 0.8, add: true, back: true });
      counter(CX + 230, CHEST_Y - 560);
      label(ctx, `${loot.cards.reduce((n, c) => n + c.n, 0)} cartes · ${loot.coins} pièces`, CX, CHEST_Y + 60, 30, '#fff3d0');
      drawText(ctx, 'Touche pour ouvrir', CX, 1420, 46, 'white', 0.65 + 0.35 * Math.sin(S.time * 4));
      if (TEST || S.skip) tap();
    },
    shake(dt) {
      const dur = 0.55 + 0.08 * Object.keys(CHESTS).indexOf(loot.tier);
      const k = S.t / dur, f = 1 + Math.floor(S.t * 18) % 3;
      S.shake = Math.max(S.shake, 6 + 14 * k); S.rays = 0.7 + 0.6 * k;
      rays(CX, CHEST_Y - 300, C.color, S.rays);
      title();
      if (Math.random() < 0.5) fx('star_big', CX + rand(-200, 200), CHEST_Y - rand(100, 500), { s0: 0.05, s1: 0.18, life: 0.5, add: true });
      chestFrame(f, CX + rand(-6, 6) * k, CHEST_Y, 2.3 * (1 + 0.05 * k));
      if (S.t >= dur) { S.phase = 'open'; S.t = 0; }
    },
    open(dt) {
      const f = 4 + Math.min(3, Math.floor(S.t / 0.09));
      if (f >= 6 && !S.boom) {
        S.boom = true; play('chest_open'); S.flash = 0.9; S.shake = 30; S.flashCol = '255,250,220';
        burst('star_big', CX, CHEST_Y - 300, 22, { s: 0.35, sp0: 300, sp1: 900, up: 300, add: true });
        burst('coins_small', CX, CHEST_Y - 260, 10, { s: 0.3, sp0: 250, sp1: 700, up: 500 });
        fx(PILLAR[stacks.length ? stacks[stacks.length - 1].rarity : 'common'], CX, CHEST_Y - 330, { s0: 0.8, s1: 2.6, life: 0.9, add: true, back: true });
      }
      rays(CX, CHEST_Y - 300, C.color, 1.4);
      chestFrame(f, CX, CHEST_Y, 2.3);
      if (S.t > 0.5) { S.phase = 'pour'; S.t = 0; }
    },
    pour() {          // pièces et gemmes d'abord
      rays(CX, CHEST_Y - 300, C.color, 1);
      chestFrame(8 + Math.floor(S.time * 10) % 8, CX, CHEST_Y, 2.3);
      if (!S.coinsShown) { S.coinsShown = true; play('coins'); play('coins', { at: 0.15, rate: 1.1 }); burst('coins_small', CX, CHEST_Y - 300, 14, { s: 0.35, sp0: 200, sp1: 600, up: 700, g: 1300 }); if (loot.gems) { play('gems', { at: 0.3 }); burst('gem_purple', CX, CHEST_Y - 300, 8, { s: 0.3, sp0: 200, sp1: 500, up: 700, g: 1300, delay: 0.25 }); } }
      const k = ease(S.t / 0.4);
      const icon = (img, n, x, col) => { if (img && img.width) ctx.drawImage(img, x - 60 * k, 560 - 60 * k, 120 * k, 120 * k); drawText(ctx, '+' + n, x, 680, 64 * k, col); };
      if (loot.gems) { icon(IMG.coin, loot.coins, CX - 160, 'yellow'); icon(IMG.ruby, loot.gems, CX + 160, 'pink'); label(ctx, 'gemmes', CX + 160, 740, 28, '#ffc2f4'); }
      else icon(IMG.coin, loot.coins, CX, 'yellow');
      label(ctx, 'pièces', loot.gems ? CX - 160 : CX, 740, 28, '#ffe680');
      counter(CX + 230, CHEST_Y - 560);
      if (S.t > 0.9 || S.skip) nextCard();
    },
    card(dt, c, R) {  // le dos de la carte sort de la cage et vient au centre
      rays(CX, CHEST_Y - 300, C.color, 0.6);
      chestFrame(8 + Math.floor(S.time * 10) % 8, CX, CHEST_Y, 2.3);
      counter(CX + 230, CHEST_Y - 560);
      const k = back(S.t / 0.42), x = CX, y = CHEST_Y - 300 + (CARD_Y - CHEST_Y + 300) * k, s = 0.4 + 1.2 * k;
      revealFrame(c.rarity, 0, x, y, s, (1 - k) * 0.6);
      if (S.t > 0.45) { S.phase = SUSPENSE[c.rarity] && !S.skip ? 'suspense' : 'reveal'; S.t = 0; if (S.phase === 'suspense') play('surge', { v: 0.7, rate: c.rarity === 'epic' ? 1.15 : 1 }); else startReveal(c); }
    },
    suspense(dt, c, R) {    // les cartes rares se font attendre : la carte tremble, la lumière monte
      const dur = SUSPENSE[c.rarity], k = S.t / dur;
      S.rays = k; rays(CX, CARD_Y, R.color, 0.4 + 1.2 * k, R.rainbow);
      S.shake = Math.max(S.shake, 3 + 10 * k);
      if (Math.random() < 0.3 + k * 0.5) fx(c.rarity === 'epic' ? 'electric' : c.rarity === 'ultimate' ? (Math.random() < 0.5 ? 'lightning' : 'electric') : 'lightning', CX + rand(-200, 200), CARD_Y + rand(-260, 260), { s0: 0.3, s1: 0.6, life: 0.25, add: true });
      if (Math.random() < 0.6) fx('star_big', CX + rand(-180, 180), CARD_Y + rand(-250, 250), { s0: 0.05, s1: 0.2, life: 0.5, add: true });
      revealFrame(c.rarity, 0, CX + rand(-1, 1) * 8 * k, CARD_Y + rand(-1, 1) * 6 * k, 1.6 * (1 + 0.06 * k), rand(-0.05, 0.05) * k);
      if (S.t >= dur || S.skip) { S.phase = 'reveal'; S.t = 0; startReveal(c); }
    },
    reveal(dt, c, R) {
      const spin = 0.42, f = Math.min(15, Math.floor(S.t / spin * 8));
      rays(CX, CARD_Y, R.color, S.t < spin ? 0.8 + S.t / spin : 1.6, R.rainbow);
      if (S.t < spin) { revealFrame(c.rarity, Math.min(7, f), CX, CARD_Y, 1.6); return; }
      if (!S.shown) {
        S.shown = true; S.flash = c.rarity === 'common' ? 0.5 : 0.95; S.flashCol = c.rarity === 'ultimate' ? '255,220,255' : '255,255,255';
        S.shake = { common: 6, rare: 10, epic: 18, legendary: 28, ultimate: 36 }[c.rarity];
        play('rev_' + c.rarity); if (c.isNew) play('new_card', { at: 0.35 });
        play('v_' + c.id, { at: 0.25, v: 0.7 });
        const n = { common: 10, rare: 14, epic: 20, legendary: 30, ultimate: 40 }[c.rarity];
        burst('star_big', CX, CARD_Y, n, { s: 0.3, sp0: 300, sp1: 900, up: 200, add: true });
        fx(PILLAR[c.rarity], CX, CARD_Y + 120, { s0: 1, s1: 2.8, life: 1.1, add: true, back: true });
        if (c.rarity === 'legendary' || c.rarity === 'ultimate') { burst('confetti', CX, CARD_Y - 200, 16, { s: 0.5, sp0: 300, sp1: 800, up: 500, g: 600, life: 2.4 }); fx('crown_burst', CX, CARD_Y - 330, { s0: 0.3, s1: 0.9, life: 1.5, vy: -40 }); }
        if (c.rarity === 'epic' || c.rarity === 'ultimate') fx('purple_ring', CX, CARD_Y, { s0: 0.5, s1: 3, life: 0.8, add: true, back: true });
      }
      const t = S.t - spin, s = 0.85 * (t < 0.3 ? 1.25 - 0.25 * back(t / 0.3) : 1);
      if (c.rarity === 'ultimate' && Math.random() < 0.3) fx(['pillar_blue', 'pillar_gold', 'pillar_purple'][Math.floor(Math.random() * 3)], CX + rand(-300, 300), CARD_Y + 300, { s0: 0.4, s1: 1, life: 0.8, add: true, back: true });
      if (Math.random() < 0.25) fx('star_big', CX + rand(-220, 220), CARD_Y + rand(-300, 300), { s0: 0.03, s1: 0.14, life: 0.7, add: true });
      cardFace(c.id, CX, CARD_Y + Math.sin(S.time * 2) * 4, s);
      if (t < 0.25) { ctx.globalCompositeOperation = 'lighter'; cardFace(c.id, CX, CARD_Y, s, 1 - t / 0.25); ctx.globalCompositeOperation = 'source-over'; }
      // nom, rareté, nombre, progression
      const a = clamp((t - 0.1) / 0.25, 0, 1);
      if (c.isNew) { ctx.save(); ctx.translate(CX + 150, CARD_Y - 230); ctx.rotate(0.22); const z = 1 + 0.08 * Math.sin(S.time * 8); ctx.scale(z, z); ctx.fillStyle = '#f0312b'; rr(ctx, -110, -34, 220, 68, 18); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#1a0a08'; ctx.stroke(); label(ctx, 'NOUVEAU !', 0, 2, 38, '#fff'); ctx.restore(); }
      ctx.globalAlpha = a;
      drawText(ctx, 'x' + c.n, CX, CARD_Y + 300, 84, 'white', a);
      label(ctx, R.name, CX, 290 - 20 * (1 - a), 40, R.color);
      const need = upgradeCost(c.id, c.level), lv = c.level;
      const bw = 420, bx = CX - bw / 2, by = CARD_Y + 370;
      ctx.fillStyle = '#140c08'; rr(ctx, bx - 5, by - 5, bw + 10, 50, 14); ctx.fill(); ctx.fillStyle = '#3a2c40'; rr(ctx, bx, by, bw, 40, 10); ctx.fill();
      if (need) {
        const from = c.isNew ? 0 : Math.min(1, (c.had || 0) / need.cards), to = Math.min(1, c.count / need.cards), r = from + (to - from) * ease((t - 0.35) / 0.6);
        const full = c.count >= need.cards;
        ctx.fillStyle = full ? '#4fd21f' : '#9b3df0'; rr(ctx, bx, by, Math.max(14, bw * r), 40, 10); ctx.fill();
        label(ctx, `${c.count} / ${need.cards}`, CX, by + 21, 28, '#fff');
        label(ctx, 'Niveau ' + lv, CX, by + 76, 28, '#e8dccb');
        if (full && t > 0.9) drawText(ctx, 'Prêt à améliorer !', CX, by + 128, 40, 'green', 0.6 + 0.4 * Math.sin(S.time * 6));
      } else { ctx.fillStyle = '#ffc21a'; rr(ctx, bx, by, bw, 40, 10); ctx.fill(); label(ctx, 'Niveau max', CX, by + 21, 28, '#fff'); }
      ctx.globalAlpha = 1;
      if (t > 0.6) drawText(ctx, left() > 0 ? 'Touche pour continuer' : 'Touche pour finir', CX, 1560, 36, 'white', 0.5 + 0.3 * Math.sin(S.time * 4));
      if ((TEST && t > 0.05) || (S.skip && t > 0.05)) tap();
    },
    summary() {
      drawText(ctx, loot.welcome ? 'Bienvenue !' : 'Contenu de la cage', CX, 170, 64, 'yellow');
      const cols = Math.min(4, stacks.length), cw = 180, chh = 248, gap = 22, x0 = CX - (cols * cw + (cols - 1) * gap) / 2;
      stacks.forEach((c, i) => {
        const col = i % 4, row = Math.floor(i / 4), x = x0 + col * (cw + gap) + cw / 2, y = 400 + row * (chh + 70), k = back(clamp((S.t - i * 0.06) / 0.35, 0, 1));
        cardFace(c.id, x, y, 0.45 * k);
        if (k > 0.5) { label(ctx, 'x' + c.n, x, y + chh / 2 + 24, 34, '#fff'); if (c.isNew) label(ctx, 'NOUVEAU', x, y - chh / 2 - 6, 24, '#ff6a5a'); }
      });
      const y = 400 + Math.ceil(stacks.length / 4) * (chh + 70) + 30;
      if (IMG.coin && IMG.coin.width) ctx.drawImage(IMG.coin, CX - (loot.gems ? 250 : 110), y - 34, 68, 68);
      label(ctx, '+' + loot.coins, CX - (loot.gems ? 170 : 30), y, 46, '#ffe680', 'left');
      if (loot.gems) { if (IMG.ruby && IMG.ruby.width) ctx.drawImage(IMG.ruby, CX + 60, y - 34, 68, 68); label(ctx, '+' + loot.gems, CX + 140, y, 46, '#ffc2f4', 'left'); }
      if (S.t > 0.5) drawText(ctx, 'Touche pour revenir', CX, 1520, 40, 'white', 0.55 + 0.3 * Math.sin(S.time * 4));
      if (TEST && S.t > 0.1) tap();
    },
  };
  function startReveal() { S.shown = false; }
  function nextCard() {
    S.i++; S.t = 0;
    if (S.i >= stacks.length && loot.direct) { close(); return; }
    if (S.i >= stacks.length) { S.phase = 'summary'; play('reward'); skip.hidden = true; return; }
    S.phase = 'card'; play('card_fly', { rate: 1 + S.i * 0.03 });
  }
  function tap() {
    if (S.phase === 'idle') { S.phase = 'shake'; S.t = 0; play('chest_shake'); return; }
    if (S.phase === 'pour' && S.t > 0.3) { nextCard(); return; }
    if (S.phase === 'reveal' && S.shown && S.t > 0.65) { nextCard(); return; }
    if (S.phase === 'summary' && (S.t > 0.4 || TEST)) close();
  }
  let resolve, raf = 0, last = performance.now();
  const loop = (now) => { raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!document.hidden) draw(dt); };
  const close = () => { if (S.done) return; S.done = true; cancelAnimationFrame(raf); el.classList.add('out'); sfx.click(); setTimeout(() => el.remove(), 250); resolve(); };
  el.addEventListener('pointerdown', (e) => { if (e.target === skip) return; tap(); });
  if (loot.direct) { skip.hidden = true; nextCard(); }
  raf = requestAnimationFrame(loop);
  return new Promise((r) => { resolve = r; });
}
