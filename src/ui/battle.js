// Un combat du début à la fin : recherche d'adversaire, combat en temps réel (Aura, main de 4 cartes, Siffler,
// Attaquer), écran de victoire ou de défaite, récompenses et cage gagnée.
import { $, h, wait, fmt, clamp, rand, countTo, TEST } from '../core/utils.js';
import { S } from '../core/save.js';
import { sfx, play, music } from '../core/audio.js';
import { IMG, unitAssets, arenaAssets } from '../core/assets.js';
import { CHESTS } from '../data/cards.js';
import { makeBot } from '../data/bots.js';
import { arenaOf, ARENAS } from '../data/economy.js';
import { createBattle, step, TICK, FH, deploy, order, canDeploy, forfeit, summary, handOf } from '../game/rt.js';
import { makeAI, aiStep } from '../game/ai.js';
import { newSeed } from '../core/rng.js';
import { applyFight, deckLevels } from '../game/progress.js';
import { View, textCanvas, HUD, AIR_LIFT } from '../render/view.js';
import { view as stageView, toStage, onResize, setBackdrop } from './stage.js';
import { showMenu } from './menu.js';
import { toast, fly, rewardHtml, TARGET, ask } from './ui.js';
import { celebrate } from './pages.js';
import { Net } from '../online/net.js';

let V = null, B = null, raf = 0, busy = false, lastT = 0;
const U = { sel: -1, drag: null, armed: false, hint: '', hintT: 0 };

// ---------- recherche d'un adversaire ----------
const avgLevel = (deck) => (deck.length ? deck.reduce((n, c) => n + c.level, 0) / deck.length : 1);
async function findOpp(mode) {
  if (mode === 'ranked' && Net.configured() && S.fights > 0) {
    try {
      const pl = await Promise.race([Net.findOpponent(S.trophies), wait(2500).then(() => null)]);
      if (pl && Math.random() < 0.8) return { ...pl, skill: 0.35 + 0.1 * Math.min(4, arenaOf(pl.trophies) - 1) };
    } catch (e) { /* hors ligne : un bot */ }
  }
  const ease = S.streak >= 3 ? 0.4 + 0.15 * Math.min(4, S.streak - 3) : -0.45 * Math.min(3, S.lossRun || 0);
  return makeBot(Math.random, { trophies: S.trophies, level: avgLevel(deckLevels()), arena: arenaOf(S.trophies), ease, first: S.fights === 0 });
}
function matchOverlay() {
  const title = h('div', { class: 'mm-title t' }, 'Recherche d\'un adversaire…'), spin = h('div', { class: 'mm-spin' });
  const el = h('div', { class: 'veil mm' }, title, spin);
  $('modals').append(el);
  return {
    async reveal(opp) {
      spin.remove(); title.textContent = ARENAS[arenaOf(S.trophies) - 1].name; play('surge', { v: 0.7 });
      const side = (cls, img, name, tro, clan) => h('div', { class: 'mm-side ' + cls }, h('img', { src: `assets/ui/${img}.webp`, alt: '' }), h('div', { class: 'nm t' }, name), clan ? h('div', { class: 'cl t xs cream' }, clan) : null, h('div', { class: 'tr t sm gold', html: `${fmt(tro)}<i class="ico trophy"></i>` }));
      const vs = textCanvas('VS', 120, 'yellow'); vs.className = 'mm-vstxt';
      el.append(h('div', { class: 'mm-vs' }, side('l', 'pt_red_happy', S.name || 'Dresseur', S.trophies, S.clan && S.clan.name), vs, side('r', 'pt_blue', opp.name, opp.trophies, opp.clanName)));
      await wait(TEST ? 50 : 1500);
    },
    close() { el.classList.add('out'); setTimeout(() => el.remove(), 260); },
  };
}

// Lance un combat. mode : 'ranked' (trophées) ou 'friendly' (amical). opp : adversaire imposé (ami, membre du clan).
export async function startFight({ mode = 'ranked', opp = null } = {}) {
  if (busy) return; busy = true;
  try {
    sfx.match();
    const ov = matchOverlay(), t0 = performance.now();
    if (!opp) opp = await findOpp(mode);
    else opp = { ...opp, skill: opp.skill || 0.5 };
    const mine = deckLevels(), arena = arenaOf(S.trophies);
    const loading = Promise.all([arenaAssets(arena), ...[...new Set([...mine, ...opp.deck].map((c) => c.id))].map((id) => unitAssets(id))]);
    if (!TEST) await wait(Math.max(0, 1000 - (performance.now() - t0)));
    await ov.reveal(opp);
    await loading;
    enter(opp, mode, mine, arena);
    ov.close();
  } catch (e) { console.error(e); busy = false; toast('Impossible de lancer le combat.'); document.querySelectorAll('.mm').forEach((x) => x.remove()); }
}

// ---------- entrée dans l'arène ----------
function enter(opp, mode, mine, arena) {
  if (!V) { V = new View($('cv')); onResize((v) => V.resize(v.scale)); bindPointer(); }
  V.resize(stageView.scale); V.reset(arena);
  const lv = (d) => clamp(Math.round(avgLevel(d)), 1, 11);
  const b = createBattle({ decks: [mine, opp.deck], towerLevels: [lv(mine), lv(opp.deck)], seed: newSeed() });
  B = { b, mode, opp, arena, acc: 0, ai: makeAI(1, opp.skill === undefined ? 0.5 : opp.skill), endShown: false, party: false };
  Object.assign(U, { sel: -1, drag: null, armed: false, hint: 'Glisse une carte sur ton terrain', hintT: 6 });
  $('scrMenu').hidden = true; $('scrBattle').hidden = false; setBackdrop(IMG['field' + arena]);
  const hud = $('bHud'); hud.textContent = '';
  hud.append(h('button', { class: 'icbtn bflag', 'aria-label': 'Abandonner', onclick: quit }));
  music(ARENAS[arena - 1].music);
  V.banner('COMBAT !', { size: 150, tint: 'orange', life: 1.3, y: 700 }); play('fight_start'); play('horn', { at: 0.15, v: 0.7 });
  V.shake = 10;
  lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
async function quit() {
  if (!B || B.b.over) return;
  sfx.click();
  if (await ask('Abandonner ?', 'Ton adversaire gagnera avec trois couronnes.', 'Abandonner', 'Continuer')) { if (B && !B.b.over) forfeit(B.b, 0); }
}

// ---------- doigt : poser une carte, Siffler, Attaquer ----------
const inRect = (p, [x, y, w, hh], m = 0) => p.x >= x - m && p.x <= x + w + m && p.y >= y - m && p.y <= y + hh + m;
function say(text, t = 1.6) { U.hint = text; U.hintT = t; }
function tryDeploy(slot, x, y) {
  const b = B.b, card = handOf(b, 0)[slot]; if (!card) return false;
  if (!canDeploy(b, 0, x, y)) { play('error', { v: 0.6 }); say('Pose tes animaux sur ton terrain'); return false; }
  const r = deploy(b, 0, slot, x, y);
  if (r === 'aura') { play('no_aura'); say('Pas assez d\'Aura !'); V.text('AURA !', x, y - 40, { size: 30, tint: 'pink', life: 0.8 }); return false; }
  if (r) { play('error', { v: 0.6 }); return false; }
  U.sel = -1; U.hintT = 0;
  return true;
}
function bindPointer() {
  const scr = $('scrBattle');
  scr.addEventListener('pointerdown', (e) => {
    if (!B || B.b.over || !e.isPrimary || (e.target.closest && e.target.closest('button'))) return;
    const p = toStage(e), b = B.b;
    if (inRect(p, HUD.whistle)) { U.armed = false; if (order(b, 0, 'defend')) play('error', { v: 0.5 }); return; }
    if (inRect(p, HUD.attack)) {
      if (b.players[0].cdFocus > 0) { play('error', { v: 0.5 }); return; }
      U.armed = !U.armed; U.sel = -1; sfx.click(); return;
    }
    const slot = HUD.slots.findIndex((r) => inRect(p, r, 4));
    if (slot >= 0) {
      const card = handOf(b, 0)[slot]; if (!card) return;
      U.armed = false;
      U.drag = { slot, id: card.id, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, onField: false, ok: false, pid: e.pointerId };
      try { scr.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
      play('swish', { v: 0.5, rate: 1.3 });
      return;
    }
    if (p.y >= FH) return;
    if (U.armed) { U.armed = false; order(b, 0, 'focus', p.x, p.y); return; }
    if (U.sel >= 0) tryDeploy(U.sel, p.x, p.y);
  });
  scr.addEventListener('pointermove', (e) => {
    const d = U.drag; if (!B || !d || e.pointerId !== d.pid) return;
    const p = toStage(e);
    d.x = p.x; d.y = p.y;
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 14) d.moved = true;
    d.onField = d.moved && p.y < FH - 20;
    if (d.onField) { d.y = Math.min(p.y - 20, FH - 30); const card = handOf(B.b, 0)[d.slot]; d.ok = !!card && canDeploy(B.b, 0, d.x, d.y) && B.b.players[0].aura >= card.cost; }
  });
  const up = (e) => {
    const d = U.drag; if (!B || !d || e.pointerId !== d.pid) return;
    U.drag = null;
    if (e.type === 'pointercancel') return;
    if (!d.moved) { U.sel = U.sel === d.slot ? -1 : d.slot; if (U.sel >= 0) say('Touche ton terrain pour le poser', 2.2); return; }
    if (d.onField && !tryDeploy(d.slot, d.x, d.y)) U.sel = d.slot;
  };
  scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);
  addEventListener('keydown', (e) => {
    if (!B || B.b.over || $('scrBattle').hidden) return;
    if (['1', '2', '3', '4'].includes(e.key)) { U.sel = +e.key - 1; say('Touche ton terrain pour le poser', 2.2); }
    if (e.key === 'Escape') { U.sel = -1; U.armed = false; }
  });
}

// ---------- ce qui se passe en combat : effets et sons ----------
const BIG = { gorilla: 1, elephant: 1, rhino: 1, alligator: 1 };
const SPARK = { kitten: 'pink_burst', monkey: 'arc_yellow', bulldog: 'claw_red', pig: 'burst_rocks', orang: 'burst_rocks', alligator: 'claw_yellow', eagle: 'slash_red', gorilla: 'burst_yellow', rhino: 'burst_rocks', elephant: 'burst_rocks' };
const SPECIAL_SFX = { monkey: 'whoosh', bulldog: 'whoosh', pig: 'poison', alligator: 'whoosh', eagle: 'tornado', gorilla: 'slam', rhino: 'shield', elephant: 'splash', kitten: 'heal', orang: 'whoosh' };
const voiceT = {};
function voice(id, v = 0.55) { const now = performance.now(); if (now - (voiceT[id] || 0) < 2500) return; voiceT[id] = now; play('v_' + id, { v, rate: rand(0.95, 1.06) }); }
const pan = (x) => (x - 470) / 600;
function onEvents(evs) {
  const b = B.b;
  for (const e of evs) {
    switch (e.type) {
      case 'deploy':       // l'animal tombe du ciel : le bruit de l'atterrissage suit de peu (la poussière est dessinée par la vue)
        play('deploy', { v: e.side === 0 ? 0.8 : 0.45, pan: pan(e.x) });
        if (BIG[e.id]) play('chest_thud', { v: 0.55, pan: pan(e.x), at: 0.2 });
        V.fx(e.side === 0 ? 'ring_blue' : 'ring_red', e.x, e.y + 4, { s0: 0.2, s1: 0.62, life: 0.45, flat: 0.55, a: 0.9 });
        break;
      case 'arrive': voice(e.id, 0.5); break;
      case 'attack':
        if (e.special) { play(SPECIAL_SFX[e.id] || 'whoosh', { v: 0.8, pan: pan(e.x) }); voice(e.id, 0.6); }
        else play('swish', { v: e.id === 'kitten' ? 0.35 : 0.45, rate: e.id === 'kitten' ? 1.5 : rand(0.85, 1.15), pan: pan(e.x) });
        if (e.charge) { play('hit_heavy2', { v: 0.9 }); V.shake = Math.max(V.shake, 10); }
        break;
      case 'hit': {
        const ent = b.ents.get(e.id), y = e.y - (e.air ? AIR_LIFT : 0) - (e.kind === 'tower' ? 90 : ent && ent.r ? 14 + ent.r * 0.55 : 28);
        if (e.kind === 'tower') { play('tower_hit', { v: 0.6, pan: pan(e.x) }); if (!e.splash && e.by) V.fx(SPARK[e.by] || 'burst_yellow', e.x + rand(-30, 30), y + rand(-20, 30), { s0: 0.25, s1: 0.55, life: 0.25, rot: rand(-0.5, 0.5) }); break; }
        if (e.splash) break;
        if (!e.by) { V.fx('smoke_puff', e.x + rand(-8, 8), y, { s0: 0.12, s1: 0.3, life: 0.3, a: 0.8 }); play('hit', { v: 0.3, rate: 1.3, pan: pan(e.x) }); break; }
        const heavy = BIG[e.by] || e.charge;
        V.fx(SPARK[e.by] || 'burst_yellow', e.x + rand(-8, 8), y, { s0: 0.18, s1: heavy ? 0.6 : 0.4, life: 0.24, rot: rand(-0.6, 0.6) });
        V.fx('star_big', e.x + rand(-6, 6), y, { s0: 0.1, s1: heavy ? 0.5 : 0.32, life: 0.16, add: true, a: 0.9, rot: rand(0, 3) });
        if (heavy) { play(['hit_heavy', 'hit_heavy2', 'hit_heavy3'][Math.floor(Math.random() * 3)], { v: 0.75, pan: pan(e.x) }); V.shake = Math.max(V.shake, 6); }
        else if (e.by === 'bulldog' || e.by === 'alligator') play('bite', { v: 0.6, pan: pan(e.x) });
        else play(['hit', 'hit2', 'hit3', 'hit4'][Math.floor(Math.random() * 4)], { v: 0.7, pan: pan(e.x) });
        if (ent && ent.kind === 'unit' && ent.side === 0 && e.amount > ent.maxHp * 0.25) V.text('-' + e.amount, e.x, y - 26, { size: 22, tint: 'red', life: 0.7 });
        break;
      }
      case 'shot': if (Math.random() < 0.6) play('arrow', { v: 0.6, pan: pan(e.x) }); V.fx(e.role === 'main' ? 'burst_yellow' : 'star_big', e.x, e.y, { s0: 0.1, s1: e.role === 'main' ? 0.34 : 0.3, life: 0.16, add: true, top: true }); if (e.role === 'main') V.fx('smoke_puff', e.x, e.y - 6, { s0: 0.1, s1: 0.3, life: 0.5, vy: -40, a: 0.6, top: true }); break;
      case 'proj': if (e.key === 'rocks2') play('whoosh', { v: 0.45, rate: 0.8 }); break;
      case 'land':
        if (e.key === 'rocks2') { play('rock', { v: 0.8, pan: pan(e.x) }); V.fx('burst_rocks', e.x, e.y - 14, { s0: 0.25, s1: 0.62, life: 0.3 }); V.burst('rocks', e.x, e.y - 10, 4, { s: 0.12, sp0: 120, sp1: 260, up: 160, g: 900 }); V.decal('crater1', e.x, e.y + 6, 4, 0.32); V.shake = Math.max(V.shake, 4); }
        else if (e.key === 'hearts') V.fx('pink_burst', e.x, e.y - 26, { s0: 0.12, s1: 0.34, life: 0.25 });
        break;
      case 'splash':
        if (e.water) { V.fx('ice_burst', e.x, e.y - 20, { s0: 0.3, s1: 1.1, life: 0.5, a: 0.9 }); V.fx('ring_blue', e.x, e.y + 4, { s0: 0.4, s1: 2.0, life: 0.5, flat: 0.55 }); V.burst('crystals', e.x, e.y - 20, 6, { s: 0.12, sp0: 150, sp1: 360, up: 200, g: 900 }); V.shake = Math.max(V.shake, 14); }
        else if (e.gust) { V.fx('tornado', e.x, e.y - 40, { s0: 0.3, s1: 0.85, life: 0.6, a: 0.9 }); V.fx('wind_leaves', e.x, e.y - 30, { s0: 0.3, s1: 0.9, life: 0.5 }); }
        else { V.fx('dust_ring', e.x, e.y + 6, { s0: 0.4, s1: e.r / 100, life: 0.45, flat: 0.6, a: 0.9 }); if (e.special) { V.decal('crater2', e.x, e.y + 8, 5, 0.6); V.burst('rocks', e.x, e.y - 10, 6, { s: 0.16, sp0: 160, sp1: 360, up: 220, g: 900 }); V.shake = Math.max(V.shake, 12); } }
        break;
      case 'heal': V.burst('heal_plus', e.x, e.y - 40, 2, { s: 0.1, sp0: 40, sp1: 100, up: 140, g: 0, life: 1.2 }); if (b.ents.get(e.uid) && b.ents.get(e.uid).side === 0) V.text('+' + e.amount, e.x + 26, e.y - 66, { size: 20, tint: 'green', life: 0.8 }); break;
      case 'healwave': V.fx('ring_green', e.x, e.y + 4, { s0: 0.3, s1: e.r / 90, life: 0.6, flat: 0.55, a: 0.9 }); break;
      case 'roar': V.fx('ring_red', e.x, e.y + 4, { s0: 0.3, s1: e.r / 85, life: 0.6, flat: 0.55, a: 0.95 }); V.text('RAGE !', e.x, e.y - 140, { size: 32, tint: 'red', life: 1, pop: 1.4 }); V.shake = Math.max(V.shake, 10); break;
      case 'armor': V.fx('shield', e.x, e.y - 76, { s0: 0.18, s1: 0.38, life: 0.8, vy: -20 }); break;
      case 'cloud': V.fx('skull_green', e.x, e.y - 30, { s0: 0.2, s1: 0.5, life: 0.8, vy: -30 }); break;
      case 'charge': voice('rhino', 0.6); V.text('CHARGE !', e.x, e.y - 128, { size: 26, tint: 'orange', life: 0.8 }); break;
      case 'death': {
        play('ko', { v: 0.7, pan: pan(e.x) });
        const y = e.y - (e.air ? AIR_LIFT : 0);
        const big = BIG[e.id] ? 1.25 : 1;
        V.fx('ko_cloud', e.x, y - 40 * big, { s0: 0.22, s1: 0.56 * big, life: 0.7, fade: 0.3 });
        for (let i = 0; i < 5; i++) { const an = rand(0, 6.283); V.fx('smoke_puff', e.x + Math.cos(an) * 14, y - 22 + Math.sin(an) * 10, { vx: Math.cos(an) * rand(50, 120), vy: Math.sin(an) * rand(30, 70) - 40, s0: 0.14, s1: 0.4 * big, life: rand(0.4, 0.65), a: 0.7, fade: 0.6, delay: 0.04 }); }
        V.burst('star_big', e.x, y - 30, 5, { s: 0.16, sp0: 120, sp1: 300, up: 120, g: 500, add: true });
        if (e.air) V.burst('feather' + (1 + Math.floor(Math.random() * 3)), e.x, y - 40, 4, { s: 0.16, sp0: 40, sp1: 140, up: 60, g: 120, life: 1.6 });
        if (e.side === 1) V.fx('paw_burst', e.x, y - 70, { s0: 0.16, s1: 0.36, life: 0.8, vy: -110, fade: 0.3 });
        break;
      }
      case 'wake': { const t = b.ents.get(e.tid); if (t) { V.fx('exclaim', t.x, t.y - 210, { s0: 0.15, s1: 0.3, life: 0.8, vy: -30 }); play('horn', { v: 0.45, rate: 1.2 }); } break; }
      case 'tower_down': {
        const main = e.role === 'main', y = e.y - 80;
        if (!e.chain) { play(main ? 'main_down' : 'tower_down'); play('crown', { at: 0.35 }); }
        V.fx('explosion2', e.x, y, { s0: 0.4, s1: main ? 1.5 : 1.1, life: 0.7 }); V.fx('explosion1', e.x + 40, y - 30, { s0: 0.3, s1: 0.9, life: 0.6, delay: 0.12 });
        V.burst('rocks', e.x, y, 10, { s: 0.2, sp0: 200, sp1: 520, up: 300, g: 1000 }); V.burst('planks', e.x, y, 5, { s: 0.2, sp0: 160, sp1: 420, up: 260, g: 1000 });
        V.fx('dust_ring', e.x, e.y + 10, { s0: 0.5, s1: main ? 3.4 : 2.6, life: 0.7, flat: 0.5, a: 0.9 });
        V.fx(e.side === 1 ? 'ring_yellow' : 'ring_red', e.x, e.y + 6, { s0: 0.4, s1: main ? 4.2 : 3.2, life: 0.55, flat: 0.5, a: 0.8, add: true });
        for (let i = 0; i < 9; i++) { const an = rand(0, 6.283); V.fx('smoke_puff', e.x + Math.cos(an) * 30, y + 30 + Math.sin(an) * 20, { vx: Math.cos(an) * rand(90, 220), vy: Math.sin(an) * rand(40, 110) - 50, s0: 0.3, s1: main ? 0.95 : 0.75, life: rand(0.7, 1.2), a: 0.75, fade: 0.6, delay: 0.05, top: true }); }
        V.burst('star_big', e.x, y, 12, { s: 0.26, sp0: 220, sp1: 620, up: 200, g: 500, add: true, top: true });
        V.fx('crown_burst', e.x, y - 60, { s0: 0.2, s1: 0.75, life: 1.4, vy: -60, delay: 0.3 });
        V.shake = main ? 30 : 22; V.flash = 0.35; V.flashColor = e.side === 0 ? '255,80,60' : '255,255,255';
        if (!e.chain) V.banner(e.side === 1 ? 'COURONNE !' : 'AÏE !', { size: 110, tint: e.side === 1 ? 'yellow' : 'red', life: 1.2, y: 720, delay: 0.25 });
        break;
      }
      case 'double': V.banner('AURA x2 !', { size: 120, tint: 'pink', life: 1.8, y: 680 }); play('surge'); break;
      case 'overtime': V.banner('PROLONGATIONS', { size: 96, tint: 'orange', life: 2, y: 680 }); V.banner('Première couronne gagne !', { size: 46, tint: 'white', life: 2, y: 790, delay: 0.3 }); play('overtime'); break;
      case 'order':
        if (e.side === 0) {
          if (e.kind === 'defend') { play('whistle'); V.banner('', { img: 'order_whistle', life: 1.1, y: 1250, s: 0.62 }); }
          else { play('target'); V.banner('', { img: 'order_attack', life: 1.1, y: 1250, s: 0.62 }); V.fx('ring_red', e.x, e.y + 4, { s0: 0.2, s1: 0.8, life: 0.5, flat: 0.6 }); }
        } else { play('whistle', { v: 0.35, rate: 1.15 }); V.text(e.kind === 'defend' ? 'REPLI !' : 'À L\'ATTAQUE !', 470, 300, { size: 34, tint: 'red', life: 1.1 }); }
        break;
      default: break;
    }
  }
}

// ---------- boucle ----------
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!B || document.hidden) return;
  const b = B.b;
  B.acc += dt;
  let n = 0;
  while (B.acc >= TICK && n < 5) {
    B.acc -= TICK; n++;
    aiStep(b, B.ai, TICK);
    step(b);
    if (b.events.length) { onEvents(b.events); b.events.length = 0; }
  }
  if (n >= 5) B.acc = 0;
  if (U.hintT > 0) { U.hintT -= dt; if (U.hintT <= 0) U.hint = ''; }
  const zone = (U.drag && U.drag.onField) || U.sel >= 0 ? 0 : null;
  V.draw(dt, b, { alpha: B.acc / TICK, drag: U.drag, sel: U.drag ? U.drag.slot : U.sel, armed: U.armed, opp: B.opp, hint: U.hint, zone });
  if (b.over && !B.endShown) {
    if (!B.party) {
      B.party = true; U.sel = -1; U.drag = null; U.armed = false;
      const win = b.winner === 0, draw = b.winner === -1;
      music(null);
      if (win) { sfx.win(); for (let i = 0; i < 4; i++) V.burst('confetti', rand(150, 790), rand(250, 500), 10, { s: 0.5, sp0: 120, sp1: 420, up: 300, g: 420, life: 2.2, delay: i * 0.12, top: true }); V.burst('star_big', 470, 700, 14, { s: 0.4, sp0: 200, sp1: 520, up: 200, life: 1.6, top: true }); }
      else if (!draw) sfx.lose(); else play('overtime', { v: 0.6 });
      V.banner(win ? 'VICTOIRE !' : draw ? 'ÉGALITÉ' : 'DÉFAITE', { size: 140, tint: win ? 'yellow' : draw ? 'white' : 'red', life: 2.4, y: 700 });
    }
    if (b.endT > (TEST ? 0.3 : 2.6)) { B.endShown = true; finish(); }
  }
}

// ---------- fin du combat ----------
function finish() {
  const b = B.b, ranked = B.mode === 'ranked', res = summary(b, 0);
  const out = applyFight(res, B.opp, ranked);
  if (B.opp.uid) Net.report(B.opp.uid, res.win, !ranked);
  Net.pushProfile();
  showEnd(res, out, ranked);
}
function showEnd(res, out, ranked) {
  const r = out.rewards, win = res.win;
  const POS = win ? { coin: 262, xp: 443, ruby: 620, btn: 442 } : { coin: 245, xp: 426, ruby: 603, btn: 428 };
  const title = textCanvas(win ? 'VICTOIRE' : res.draw ? 'ÉGALITÉ' : 'DÉFAITE', win ? 78 : 80, 'white'); title.className = 'end-title';
  const val = (x, id) => h('div', { class: 'ctr t sm end-val', id, style: { left: x + 'px', top: '655px' } }, '0');
  const panel = h('div', { class: 'end-panel ' + (win ? 'win' : 'lose'), style: { backgroundImage: `url('assets/ui/end_${win ? 'victory' : 'defeat'}.webp')` } }, title, val(POS.coin, 'eCoin'), val(POS.xp, 'eXp'), val(POS.ruby, 'eRuby'),
    h('button', { class: 'end-btn t', id: 'eBtn', style: { left: (POS.btn - 168) + 'px' }, onclick: () => next() }, 'Continuer'));
  const lines = [];
  if (ranked && r.trophies) lines.push(`<span class="${r.trophies > 0 ? 'good' : 'bad'}">${r.trophies > 0 ? '+' : ''}${r.trophies}</span><i class="ico trophy"></i>`);
  if (r.paws) lines.push(`+${r.paws}<i class="ico paw"></i>`);
  const extra = [`Couronnes : <span class="gold">${res.crowns}</span> - ${res.lost}`];
  if (!ranked) extra.push('Combat amical : ni trophées ni cage');
  if (r.streakBonus) extra.push(`Série de ${out.streak} victoires : +${fmt(r.streakBonus)}<i class="ico coin"></i>`);
  if (out.firstWin) extra.push('Première victoire du jour : +5<i class="ico ruby"></i>');
  if (out.full) extra.push('<span class="bad">Tes 4 emplacements de cages sont pleins !</span>');
  if (!win && !res.draw) extra.push(S.lossRun >= 2 ? 'Astuce : améliore tes animaux dans la Collection.' : 'Astuce : garde de l\'Aura pour défendre, puis contre-attaque !');
  const chestEl = out.chest ? h('div', { class: 'end-chest' }, h('img', { src: `assets/chests/icon_${out.chest.tier}.webp`, alt: '' }), h('div', { class: 't sm' }, CHESTS[out.chest.tier].name + ' gagnée !')) : null;
  const el = h('div', { class: 'veil end' }, h('div', { class: 'end-top t', html: lines.join('   ') }), panel, chestEl, h('div', { class: 'end-extra t xs', html: extra.join('<br>') }));
  $('modals').append(el);
  let closed = false;
  const STARS = [[235, 389, 133, 135], [364, 355, 157, 138], [514, 390, 132, 125]];    // les couronnes claquent une à une
  (async () => {
    await wait(TEST ? 10 : 450);      // (le joueur peut toucher « Continuer » avant la fin : on s'arrête dès que l'écran est fermé)
    for (let i = 0; i < res.crowns && !closed; i++) { const [x, y, w, hh] = STARS[i]; panel.append(h('img', { class: 'end-star', src: `assets/ui/end_star${i + 1}.webp`, alt: '', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } })); sfx.star(i); await wait(TEST ? 5 : 330); }
    if (closed) return;
    sfx.reward();
    countTo($('eCoin'), 0, r.coins, 700, (n) => '+' + fmt(n)); countTo($('eXp'), 0, r.xp, 700, (n) => '+' + fmt(n)); countTo($('eRuby'), 0, r.rubies, 500, (n) => '+' + fmt(n));
    if (chestEl) { await wait(TEST ? 5 : 500); if (closed) return; chestEl.classList.add('in'); play('chest_land'); }
    if (!closed && $('eBtn')) $('eBtn').classList.add('pulse');
  })();
  async function next() {
    if (closed) return; closed = true; sfx.click(); el.remove();
    leave();
    for (const u of out.ups) celebrate('Niveau ' + u.level + ' atteint !', null, `Récompense : ${rewardHtml({ coins: u.coins, rubies: u.rubies })}`);
    if (out.arenaUp) celebrate(ARENAS[out.arenaUp - 1].name + ' débloquée !', null, `Arène ${out.arenaUp} : nouveau décor, nouvelle musique et des cages plus riches.`);
    if (r.coins) fly('coin', [470, 900], TARGET.coin, 10, (i) => sfx.coin(i));
    if (r.paws) fly('paw', [470, 900], TARGET.paw, 6);
    if (r.rubies) fly('ruby', [470, 900], TARGET.ruby, 3);
  }
}
function leave() {
  cancelAnimationFrame(raf); raf = 0; B = null; busy = false;
  $('scrBattle').hidden = true; $('bHud').textContent = '';
  showMenu('main');
}
export const battleState = () => B;      // pour les tests automatiques
