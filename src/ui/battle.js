// Un combat du début à la fin : recherche d'adversaire, placement sur la grille, combat automatique,
// écran de victoire ou de défaite, récompenses.
import { $, h, wait, fmt, clamp, lerp, rand, countTo, TEST } from '../core/utils.js';
import { S, changed } from '../core/save.js';
import { sfx, music, musicRestart } from '../core/audio.js';
import { IMG } from '../core/assets.js';
import { ANIMALS, TEAM_SLOTS, statsAt } from '../data/animals.js';
import { COLS, ROWS, FH, GAP, CELL_PX, toPx, fromPx, cellCenter } from '../data/arena.js';
import { makeBot, validTeam } from '../data/bots.js';
import { arenaOf, chestCards } from '../data/economy.js';
import { createBattle, step, TICK, alive } from '../game/sim.js';
import { newSeed } from '../core/rng.js';
import { applyFight, owned, levelOf, grant } from '../game/progress.js';
import { View, textCanvas, ARENA_H } from '../render/view.js';
import { view as stageView, toStage, onResize, setBackdrop } from './stage.js';
import { showMenu } from './menu.js';
import { modal, p, toast, fly, rewardHtml, TARGET } from './ui.js';
import { celebrate } from './pages.js';
import { Net } from '../online/net.js';

let V = null, B = null, raf = 0, busy = false, lastT = 0;
const ORDER = []; for (let r = 0; r < ROWS; r++) for (const c of [2, 1, 3, 0, 4]) ORDER.push([c, r]);   // cases libres préférées : devant, au centre
const used = () => B.mine.reduce((n, u) => n + ANIMALS[u.id].slots, 0);
const at = (col, row) => B.mine.find((u) => u.col === col && u.row === row);
const cellAt = (x, y) => { const f = fromPx(x, y), col = Math.floor(f.x), row = Math.floor(f.y - (FH / 2 + GAP / 2)); return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { col, row } : null; };

// ---------- recherche d'un adversaire ----------
async function findOpp(mode) {
  if (mode === 'ranked' && Net.configured() && S.fights > 0) {
    try { const pl = await Promise.race([Net.findOpponent(S.trophies), wait(2500).then(() => null)]); if (pl && Math.random() < 0.8) return pl; } catch (e) { /* hors ligne : un bot */ }
  }
  const lv = { monkey: levelOf('monkey'), bulldog: owned('bulldog') ? levelOf('bulldog') : 0 };
  let ease = S.streak >= 3 ? 0.4 + 0.15 * Math.min(4, S.streak - 3) : -0.45 * Math.min(3, S.lossRun || 0);
  if (S.fights === 0) ease = -1.5;                         // tout premier combat : adversaire facile
  const bot = makeBot(Math.random, { trophies: S.trophies, playerLevels: lv, hasBulldog: owned('bulldog'), ease });
  if (S.fights === 0) bot.units = bot.units.slice(0, 4).map((u) => ({ ...u, level: 1 }));
  return bot;
}
function matchOverlay() {
  const title = h('div', { class: 'mm-title t' }, 'Recherche d\'un adversaire…'), spin = h('div', { class: 'mm-spin' });
  const el = h('div', { class: 'veil mm' }, title, spin);
  $('modals').append(el);
  return {
    async reveal(opp) {
      spin.remove(); title.textContent = 'Adversaire trouvé !'; sfx.count(0);
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
    if (!TEST) await wait(Math.max(0, 1000 - (performance.now() - t0)));
    await ov.reveal(opp);
    enter(opp, mode);
    ov.close();
  } catch (e) { console.error(e); busy = false; toast('Impossible de lancer le combat.'); document.querySelectorAll('.mm').forEach((x) => x.remove()); }
}

// ---------- entrée dans l'arène : phase de placement ----------
function enter(opp, mode) {
  if (!V) { V = new View($('cv')); onResize((v) => V.resize(v.scale)); bindPointer(); }
  V.resize(stageView.scale); V.reset();
  let mine = (S.formation || []).filter((u) => owned(u.id)).map((u) => ({ id: u.id, col: u.col, row: u.row }));
  if (!validTeam(mine, (a) => ANIMALS[a].slots)) mine = [];
  B = { mode, opp, phase: 'place', mine, enemy: opp.units.map((u) => ({ ...u })), sim: null, acc: 0, speed: S.settings.speed || 1, scale: 1, banner: null, drag: null,
    paws: 0, t: 0, placeLeft: 45, vu: [], endT: 0, hp0: [1, 1], total: 0, fade: 1 };
  if (!mine.length) autoFill();
  $('scrMenu').hidden = true; $('scrBattle').hidden = false; setBackdrop(IMG.arena);
  buildHud(); music(true); musicRestart();
  lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function autoFill() {
  const ids = Object.keys(S.animals).filter((id) => ANIMALS[id]);
  // des bulldogs devant s'il y en a, des singes ensuite
  const want = ids.includes('bulldog') ? ['bulldog', 'bulldog', 'monkey', 'monkey', 'monkey'] : ['monkey', 'monkey', 'monkey', 'monkey', 'monkey'];
  for (const id of want) { const free = ORDER.find(([c, r]) => !at(c, r)); if (free && used() + ANIMALS[id].slots <= TEAM_SLOTS) B.mine.push({ id, col: free[0], row: free[1] }); }
}

// ---------- interface par-dessus le canvas ----------
function plate(cls, name, avatar, sub) {
  return h('div', { class: 'plate ' + cls }, h('div', { class: 'av', style: { backgroundImage: `url('assets/ui/av_${avatar || 'tiger'}.webp')` } }),
    h('div', { class: 'pi' }, h('div', { class: 'nm t sm' }, name), h('div', { class: 'hp' }, h('b'), h('span', { class: 't xs' }, sub))));
}
function buildHud() {
  const hud = $('bHud'); hud.textContent = '';
  const opp = B.opp;
  hud.append(
    plate('top', opp.name, opp.avatar, fmt(opp.trophies) + ' trophées'),
    h('button', { class: 'icbtn', id: 'bQuit', 'aria-label': 'Quitter', style: { right: '14px', top: '14px', backgroundImage: "url('assets/ui/ic_close.webp')" }, onclick: quit }),
    h('div', { class: 'hint t xs', id: 'bHint' }, 'Glisse tes animaux sur les carrés bleus · touche un animal pour le retirer'),
    h('div', { class: 'tray', id: 'tray' }));
  drawTray();
}
function drawTray() {
  const tray = $('tray'); if (!tray) return; tray.textContent = '';
  if (B.phase === 'place') {
    const cards = Object.keys(S.animals).filter((id) => ANIMALS[id]).map((id) => {
      const n = B.mine.filter((u) => u.id === id).length;
      return h('div', { class: 'tcard', dataset: { id } }, h('img', { src: `assets/ui/card_${id}.webp`, alt: '', draggable: 'false' }), h('div', { class: 'lv t xs' }, 'Niv. ' + levelOf(id)), h('div', { class: 'nm t xs' }, ANIMALS[id].name), n ? h('div', { class: 'ct t xs' }, '×' + n) : null);
    });
    const pips = []; for (let i = 0; i < TEAM_SLOTS; i++) pips.push(h('i', { class: i < used() ? 'on' : '' }));
    tray.append(h('div', { class: 'tcards' }, cards),
      h('div', { class: 'tmid' }, h('div', { class: 'tslots t sm' }, 'Slots ' + used() + '/' + TEAM_SLOTS), h('div', { class: 'pips' }, pips), h('div', { class: 'ttime t xs', id: 'bTime' }, '')),
      h('button', { class: 'btn yellow big t tgo' + (B.mine.length ? ' pulse' : ' off'), id: 'btnGo', onclick: go }, 'Combattre !'));
  } else {
    tray.append(plate('bot', S.name || 'Dresseur', S.avatar, ''),
      h('div', { class: 'tpaws t sm', id: 'bPaws', html: `0<i class="ico paw"></i>` }),
      h('button', { class: 'icbtn tspeed' + (B.speed > 1 ? ' on' : ''), id: 'bSpeed', 'aria-label': 'Vitesse', style: { backgroundImage: "url('assets/ui/ic_fast.webp')" }, onclick: () => { B.speed = B.speed > 1 ? 1 : 2; S.settings.speed = B.speed; changed(); $('bSpeed').classList.toggle('on', B.speed > 1); sfx.click(); } }, h('span', { class: 't xs' }, '×2')));
  }
}
function quit() {
  sfx.back();
  if (B.phase === 'place') return leave();
  toast('Le combat est lancé, courage !');
}

// ---------- placement au doigt ----------
function bindPointer() {
  const scr = $('scrBattle');
  scr.addEventListener('pointerdown', (e) => {
    if (!B || B.phase !== 'place' || B.drag) return;
    const pos = toStage(e), card = e.target.closest && e.target.closest('.tcard');
    if (card) B.drag = { id: card.dataset.id, unit: null, px: pos.x, py: pos.y, sx: pos.x, sy: pos.y, moved: false, pid: e.pointerId };
    else if (!e.target.closest('button')) { const c = cellAt(pos.x, pos.y), u = c && at(c.col, c.row); if (u) B.drag = { id: u.id, unit: u, px: pos.x, py: pos.y, sx: pos.x, sy: pos.y, moved: false, pid: e.pointerId }; }
    if (B.drag) { sfx.pick(); try { scr.setPointerCapture(e.pointerId); } catch (er) { /* rien */ } e.preventDefault(); }
  });
  scr.addEventListener('pointermove', (e) => {
    if (!B || !B.drag || e.pointerId !== B.drag.pid) return;
    const pos = toStage(e), d = B.drag; d.px = pos.x; d.py = pos.y;
    if (!d.moved && Math.abs(pos.x - d.sx) + Math.abs(pos.y - d.sy) > 14) d.moved = true;
  });
  const up = (e) => {
    if (!B || !B.drag || e.pointerId !== B.drag.pid) return;
    const d = B.drag; B.drag = null;
    const c = cellAt(d.px, d.py), there = c && at(c.col, c.row), slots = ANIMALS[d.id].slots;
    if (!d.unit) {                                   // depuis une carte de la barre du bas
      if (!d.moved) {                                // simple toucher : première case libre
        const free = ORDER.find(([col, row]) => !at(col, row));
        if (used() + slots > TEAM_SLOTS || !free) { sfx.error(); toast('Ton équipe est complète (' + TEAM_SLOTS + ' slots). Retire un animal d\'abord.'); }
        else place({ id: d.id, col: free[0], row: free[1] });
      } else if (c) {
        if (there) { if (used() - ANIMALS[there.id].slots + slots <= TEAM_SLOTS) { B.mine.splice(B.mine.indexOf(there), 1); place({ id: d.id, col: c.col, row: c.row }); } else sfx.error(); }
        else if (used() + slots <= TEAM_SLOTS) place({ id: d.id, col: c.col, row: c.row });
        else { sfx.error(); toast('Ton équipe est complète (' + TEAM_SLOTS + ' slots).'); }
      }
    } else if (!d.moved || !c) {                     // toucher un animal placé (ou le sortir de la grille) : on le retire
      B.mine.splice(B.mine.indexOf(d.unit), 1); sfx.back();
      const p0 = toPx(...Object.values(cellCenter(0, d.unit.col, d.unit.row))); V.fx('smoke_puff', p0.x, p0.y - 30, { s0: 0.4, s1: 0.8, life: 0.4, vy: -60 });
    } else {                                         // déplacer, ou échanger avec l'animal déjà là
      if (there && there !== d.unit) { there.col = d.unit.col; there.row = d.unit.row; V.vis.delete(key(there)); }
      V.vis.delete(key(d.unit)); d.unit.col = c.col; d.unit.row = c.row; placed(d.unit);
    }
    drawTray();
  };
  scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);
}
const key = (u) => 1000 + u.col * 10 + u.row;
function place(u) { B.mine.push(u); placed(u); }
function placed(u) {
  V.vis.delete(key(u)); sfx.place();
  const c = cellCenter(0, u.col, u.row), q = toPx(c.x, c.y);
  V.fx('paw_dust', q.x, q.y + 26, { s0: 0.35, s1: 0.75, life: 0.45, a: 0.9 }); V.shake = Math.max(V.shake, 3);
}

// ---------- lancement du combat ----------
function go() {
  if (!B || B.phase !== 'place') return;
  if (!B.mine.length) { sfx.error(); return toast('Place au moins un animal !'); }
  sfx.click(); B.drag = null;
  S.formation = B.mine.map((u) => ({ id: u.id, col: u.col, row: u.row })); changed(); Net.pushProfile();
  const teams = [{ units: B.mine.map((u) => ({ ...u, level: levelOf(u.id) })) }, { units: B.enemy.map((u) => ({ id: u.id, col: u.col, row: u.row, level: u.level || 1 })) }];
  B.sim = createBattle(teams, newSeed()); B.total = B.mine.length;
  B.hp0 = [0, 1].map((s) => B.sim.units.filter((u) => u.side === s).reduce((n, u) => n + u.maxHp, 0));
  B.vu = B.sim.units.map((u) => ({ key: u.uid, id: u.id, side: u.side, radius: u.s.radius, level: u.level, speed: u.s.speed, bar: true, hit: false, deadAge: 0, pop: false }));
  V.vis.clear();
  B.phase = 'count'; B.t = 0; B.count = 3; B.banner = { str: '3', size: 240, age: 0, life: 0.6, tint: 'yellow' }; sfx.count(3);
  $('bHint').remove(); $('bQuit').hidden = true;
  drawTray();
}

// ---------- événements du combat : effets, sons, chiffres ----------
function onEvents(evs) {
  const b = B.sim;
  for (const e of evs) {
    if (e.type === 'attack') { const u = b.units[e.uid]; if (e.special) { u.id === 'bulldog' ? sfx.roll() : sfx.special(); const q = toPx(u.x, u.y); V.fx('speed_lines', q.x, q.y - 40, { s0: 0.5, s1: 0.9, life: 0.3, rot: Math.atan2(u.fy, u.fx) + Math.PI }); } else if (Math.random() < 0.5) sfx.whoosh(); }
    else if (e.type === 'hit') {
      const tg = b.units[e.uid], by = b.units[e.by], q = toPx(e.x, e.y), mine = tg.side === 0;
      B.vu[e.uid].hit = true;
      const main = e.kind === 'hit' || e.kind === 'special';
      if (main) {
        if (by.id === 'monkey') V.fx(e.kind === 'special' ? 'burst_yellow' : 'arc_yellow', q.x + rand(-10, 10), q.y - 46, { s0: 0.3, s1: e.kind === 'special' ? 0.95 : 0.62, life: 0.24, rot: rand(-0.6, 0.6) });
        else V.fx(e.kind === 'special' ? 'burst_rocks' : 'claw_red', q.x + rand(-8, 8), q.y - 44, { s0: 0.35, s1: e.kind === 'special' ? 0.95 : 0.6, life: 0.28, rot: rand(-0.4, 0.4) });
        sfx.hit(e.kind === 'special' || e.crit);
        V.shake = Math.max(V.shake, e.kind === 'special' ? 10 : e.crit ? 7 : 2.5);
      }
      if (e.crit) { sfx.crit(); V.burst('star_big', q.x, q.y - 50, 5, { s: 0.3, sp0: 140, sp1: 320, up: 120 }); B.stop = 0.07; }
      if (e.kind === 'special') { B.stop = 0.09; V.burst('star_big', q.x, q.y - 50, 4, { s: 0.26, up: 100 }); }
      const size = e.kind === 'splash' ? 19 : e.kind === 'aoe' ? 24 : e.kind === 'special' ? 40 : 27;
      V.text(e.amount, q.x + rand(-26, 26), q.y - 100 + rand(-14, 10), { size: size * (e.crit ? 1.35 : 1), tint: e.crit ? 'yellow' : e.kind === 'special' || e.kind === 'aoe' ? 'orange' : mine ? 'red' : 'white', vx: rand(-30, 30), life: e.kind === 'splash' ? 0.55 : 0.85, vy: -130, pop: e.crit || e.kind === 'special' ? 1.4 : 1 });
    } else if (e.type === 'aoe') {
      const q = toPx(e.x, e.y);
      V.fx('dust_ring', q.x, q.y + 6, { s0: 0.5, s1: 1.9, life: 0.45, flat: 0.62, a: 0.9 }); V.decal('crater2', q.x, q.y + 10, 5, 0.75);
      V.burst('rocks', q.x, q.y - 10, 6, { s: 0.2, sp0: 160, sp1: 380, up: 220, g: 900 }); V.shake = 18; V.flash = 0.18;
    } else if (e.type === 'dodge') { const q = toPx(e.x, e.y); sfx.dodge(); V.text('ESQUIVE', q.x, q.y - 110, { size: 22, tint: 'blue', life: 0.7, vy: -70 }); V.fx('wind_leaves', q.x, q.y - 50, { s0: 0.4, s1: 0.8, life: 0.35 }); }
    else if (e.type === 'death') {
      const q = toPx(e.x, e.y), mine = e.side === 0;
      sfx.death(mine); V.fx('ko_cloud', q.x, q.y - 50, { s0: 0.4, s1: 1.0, life: 0.75, fade: 0.3 }); V.fx('smoke_puff', q.x - 30, q.y - 30, { s0: 0.4, s1: 0.9, life: 0.6, vy: -80, delay: 0.1 }); V.fx('smoke_puff', q.x + 34, q.y - 20, { s0: 0.3, s1: 0.8, life: 0.6, vy: -70, delay: 0.18 });
      V.decal('bones', q.x, q.y + 8, 7, 0.5); V.shake = Math.max(V.shake, 9); B.stop = 0.06;
      V.trainer(mine ? 1 : 0, 1); V.trainer(mine ? 0 : 1, 2);
      if (!mine) { B.paws += 2; V.fx('paw_burst', q.x, q.y - 80, { s0: 0.3, s1: 0.62, life: 0.9, vy: -140, fade: 0.3 }); V.burst('coins_small', q.x, q.y - 40, 3, { s: 0.3, up: 260, g: 800 }); sfx.coin(B.paws % 5); const el = $('bPaws'); if (el) { el.innerHTML = `+${B.paws}<i class="ico paw"></i>`; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } }
    } else if (e.type === 'fury') { sfx.fury(); B.banner = { str: 'FUREUR', size: 130, age: 0, life: 1.3, tint: 'red' }; B.furyOn = true; V.trainer(0, 3); V.trainer(1, 3); }
    else if (e.type === 'end') {
      B.phase = 'over'; B.endT = 0; B.win = e.winner === 0;
      V.trainer(B.win ? 0 : 1, 1, true); V.trainer(B.win ? 1 : 0, 2, true);
    }
  }
}

// ---------- boucle d'affichage ----------
function loop(now) {
  raf = requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!B || document.hidden) return;
  B.t += dt;
  const m = { units: [], squares: [], drag: null, banner: null };

  if (B.phase === 'place') {
    B.placeLeft -= dt;
    const tm = $('bTime'); if (tm) { const s = Math.max(0, Math.ceil(B.placeLeft)); tm.textContent = 'Départ dans ' + s + ' s'; tm.classList.toggle('bad', s <= 10); }
    if (B.placeLeft <= 0) { if (!B.mine.length) autoFill(); go(); }
  }
  if (B.phase === 'place' || B.phase === 'count') {
    const hover = B.drag && B.drag.moved ? cellAt(B.drag.px, B.drag.py) : null;
    if (B.phase === 'count') B.fade = Math.max(0, B.fade - dt * 2.2);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p0 = cellCenter(0, c, r), occ = at(c, r), hv = hover && hover.col === c && hover.row === r;
      m.squares.push({ x: p0.x, y: p0.y, img: hv ? 'sqGold' : 'sqBlue', a: (hv ? 1 : occ ? 0.95 : 0.5 + 0.12 * Math.sin(B.t * 3 + c + r)) * B.fade, pop: hv ? 1.1 : 1 });
    }
    for (const u of B.enemy) { const p1 = cellCenter(1, u.col, u.row); m.squares.push({ x: p1.x, y: p1.y, img: 'sqRed', a: 0.6 * B.fade }); }
  }
  if (B.phase === 'place') {
    for (const u of B.mine) { if (B.drag && B.drag.unit === u && B.drag.moved) continue; const c = cellCenter(0, u.col, u.row), q = toPx(c.x, c.y); m.units.push({ key: key(u), id: u.id, side: 0, px: q.x, py: q.y, radius: ANIMALS[u.id].radius, fx: 0, fy: -1, hpRatio: 1, level: levelOf(u.id), bar: true, pop: true }); }
    for (const u of B.enemy) { const c = cellCenter(1, u.col, u.row), q = toPx(c.x, c.y); m.units.push({ key: 2000 + u.col * 10 + u.row, id: u.id, side: 1, px: q.x, py: q.y, radius: ANIMALS[u.id].radius, fx: 0, fy: 1, hpRatio: 1, level: u.level || 1, bar: true, pop: true }); }
    if (B.drag && B.drag.moved) m.drag = B.drag;
  } else {
    // décompte 3, 2, 1, COMBAT
    if (B.phase === 'count') {
      B.banner.age += dt;
      if (B.banner.age >= (B.count > 0 ? 0.55 : 0.5)) {
        B.count--;
        if (B.count > 0) { B.banner = { str: String(B.count), size: 240, age: 0, life: 0.6, tint: 'yellow' }; sfx.count(B.count); }
        else if (B.count === 0) { B.banner = { str: 'COMBAT', size: 150, age: 0, life: 0.7, tint: 'orange' }; sfx.count(0); V.shake = 12; B.phase = 'fight'; }
      }
    }
    // simulation à pas fixe, avec arrêts sur image et ralenti final
    if (B.phase === 'fight' || B.phase === 'over') {
      let sdt = dt * B.speed;
      if (B.stop > 0) { B.stop -= dt; sdt *= 0.08; }
      if (B.phase === 'over') { B.endT += dt; sdt = dt * (B.endT < 0.9 ? 0.3 : 1); }
      B.acc += sdt;
      while (B.acc >= TICK) { B.acc -= TICK; step(B.sim); if (B.sim.events.length) { onEvents(B.sim.events); B.sim.events.length = 0; } }
      if (B.furyOn) V.fury = Math.min(1, V.fury + dt);
    }
    const a = B.phase === 'count' ? 0 : B.acc / TICK;
    for (const u of B.sim.units) {
      const v = B.vu[u.uid], q = toPx(lerp(u.px, u.x, a), lerp(u.py, u.y, a));
      v.px = q.x; v.py = q.y; v.fx = u.fx; v.fy = u.fy; v.moving = u.moving; v.hpRatio = u.hp / u.maxHp; v.stun = u.stun > 0; v.dead = u.dead; v.win = u.state === 'win';
      v.atk = u.atkT >= 0 && u.atk ? { anim: u.atk.anim, t: u.atkT + a * TICK, dur: u.atk.dur, special: u.atk === u.s.attacks.special } : null;
      if (u.dead) v.deadAge += dt; if (!u.dead || v.deadAge < 0.5) m.units.push(v);
    }
    hudHp();
    if (B.banner) { B.banner.age += B.phase === 'count' ? 0 : dt; if (B.banner.age >= B.banner.life) B.banner = null; }
    if (B.phase === 'over') {
      if (B.win && B.endT > 0.9 && !B.party) { B.party = true; sfx.win(); for (let i = 0; i < 4; i++) V.burst('confetti', rand(150, 790), rand(250, 500), 10, { s: 0.5, sp0: 120, sp1: 420, up: 300, g: 420, life: 2.2, delay: i * 0.12 }); V.burst('star_big', 470, 700, 14, { s: 0.4, sp0: 200, sp1: 520, up: 200, life: 1.6 }); }
      if (!B.win && B.endT > 0.9 && !B.party) { B.party = true; sfx.lose(); V.fx('broken_heart', 470, 1240, { s0: 0.4, s1: 0.9, life: 1.4, vy: -40 }); }
      if (B.endT > (TEST ? 0.3 : 2.3) && !B.done) { B.done = true; finish(); }
    }
  }
  m.banner = B.banner;
  V.draw(dt, m);
}
function hudHp() {
  const b = B.sim, top = document.querySelector('.plate.top .hp'), bot = document.querySelector('.plate.bot .hp');
  for (const [el, side] of [[top, 1], [bot, 0]]) {
    if (!el) continue;
    const hp = b.units.filter((u) => u.side === side).reduce((n, u) => n + u.hp, 0), r = clamp(hp / B.hp0[side], 0, 1);
    el.firstChild.style.width = (r * 100).toFixed(1) + '%'; el.lastChild.textContent = alive(b, side).length + ' en vie';
  }
}

// ---------- fin du combat : écran de victoire ou de défaite ----------
function finish() {
  const b = B.sim, win = B.win, survivors = alive(b, 0).length, kos = b.units.filter((u) => u.side === 1 && u.hp <= 0).length;
  const ranked = B.mode === 'ranked';
  S.lossRun = ranked ? (win ? 0 : (S.lossRun || 0) + 1) : (S.lossRun || 0);
  const res = applyFight({ win, survivors, total: B.total, kos }, B.opp, ranked);
  if (B.opp.uid) Net.report(B.opp.uid, win, !ranked);
  Net.pushProfile();
  music(false);
  showEnd(win, res, ranked);
}
function showEnd(win, res, ranked) {
  const r = res.rewards, POS = win ? { coin: 262, xp: 443, ruby: 620, btn: 442 } : { coin: 245, xp: 426, ruby: 603, btn: 428 };
  const title = textCanvas(win ? 'VICTOIRE' : 'DÉFAITE', win ? 78 : 80, 'white'); title.className = 'end-title';
  const val = (x, id) => h('div', { class: 'ctr t sm end-val', id, style: { left: x + 'px', top: '655px' } }, '0');
  const panel = h('div', { class: 'end-panel ' + (win ? 'win' : 'lose'), style: { backgroundImage: `url('assets/ui/end_${win ? 'victory' : 'defeat'}.webp')` } }, title, val(POS.coin, 'eCoin'), val(POS.xp, 'eXp'), val(POS.ruby, 'eRuby'),
    h('button', { class: 'end-btn t', id: 'eBtn', style: { left: (POS.btn - 168) + 'px' }, onclick: () => next() }, 'Continuer'));
  const lines = [];
  if (ranked && r.trophies) lines.push(`<span class="${r.trophies > 0 ? 'good' : 'bad'}">${r.trophies > 0 ? '+' : ''}${r.trophies}</span><i class="ico trophy"></i>`);
  if (r.paws) lines.push(`+${r.paws}<i class="ico paw"></i>`);
  const extra = [];
  if (!ranked) extra.push('Combat amical : pas de trophées');
  if (r.streakBonus) extra.push(`Série de ${res.streak} victoires : +${fmt(r.streakBonus)}<i class="ico coin"></i>`);
  if (res.firstWin) extra.push('Première victoire du jour : +5<i class="ico ruby"></i>');
  if (!win) extra.push(S.lossRun >= 2 ? 'Astuce : améliore tes animaux dans la Collection.' : 'Astuce : change ton placement et retente ta chance !');
  const el = h('div', { class: 'veil end' }, h('div', { class: 'end-top t', html: lines.join('   ') }), panel, h('div', { class: 'end-extra t xs', html: extra.join('<br>') }));
  $('modals').append(el);
  let closed = false;
  // étoiles qui claquent une à une
  const STARS = [[235, 389, 133, 135], [364, 355, 157, 138], [514, 390, 132, 125]];
  (async () => {
    await wait(TEST ? 10 : 450);
    for (let i = 0; i < res.stars; i++) { const [x, y, w, hh] = STARS[i]; panel.append(h('img', { class: 'end-star', src: `assets/ui/end_star${i + 1}.webp`, alt: '', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } })); sfx.star(i); await wait(TEST ? 5 : 330); }
    sfx.reward();
    countTo($('eCoin'), 0, r.coins, 700, (n) => '+' + fmt(n)); countTo($('eXp'), 0, r.xp, 700, (n) => '+' + fmt(n)); countTo($('eRuby'), 0, r.rubies, 500, (n) => '+' + fmt(n));
    $('eBtn').classList.add('pulse');
  })();
  async function next() {
    if (closed) return; closed = true; sfx.click(); el.remove();
    if (win && ranked) await chest();
    leave();
    for (const u of res.ups) celebrate('Niveau ' + u.level + ' atteint !', null, `Récompense : ${rewardHtml({ coins: u.coins, rubies: u.rubies })}`);
    if (res.arenaUp) celebrate('Arène ' + res.arenaUp + ' débloquée !', null, 'Les récompenses de chaque victoire augmentent.');
    if (r.coins) fly('coin', [470, 900], TARGET.coin, 10, (i) => sfx.coin(i % 4));
    if (r.paws) fly('paw', [470, 900], TARGET.paw, 6);
    if (r.rubies) fly('ruby', [470, 900], TARGET.ruby, 3);
  }
}
// Coffre de victoire : trois cartes face cachée, on en retourne une
function chest() {
  return new Promise((resolve) => {
    const cards = chestCards(Math.random, arenaOf(S.trophies));
    let picked = false;
    const mk = (c, i) => {
      const kind = c.coins ? 'coin' : c.paws ? 'paw' : 'ruby', n = c.coins || c.paws || c.rubies;
      const el = h('button', { class: 'ccard', onclick: async () => {
        if (picked) return; picked = true; sfx.flip(); el.classList.add('flip'); grant(c);
        await wait(450); sfx.reward(); els.forEach((o, k) => { if (k !== i) { o.classList.add('flip', 'dim'); } });
        await wait(TEST ? 50 : 1300); m.close();
      } }, h('div', { class: 'back' }, h('i')), h('div', { class: 'front t' }, h('i', { style: { backgroundImage: `url('assets/ui/cur_${kind}.webp')` } }), '+' + fmt(n)));
      return el;
    };
    const els = cards.map(mk);
    const m = modal({ title: 'Coffre de victoire', color: 'yellow', closable: false, body: [p('Retourne une carte !'), h('div', { class: 'chestRow' }, els)], onClose: resolve });
    if (TEST) setTimeout(() => els[0].click(), 30);
  });
}
function leave() {
  cancelAnimationFrame(raf); raf = 0; B = null; busy = false; music(false);
  $('scrBattle').hidden = true; $('bHud').textContent = '';
  showMenu('main');
}
export const battleState = () => B;      // pour les tests automatiques
