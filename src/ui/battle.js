// Un combat du début à la fin : recherche d'adversaire, combat en temps réel sur la grande arène (caméra qui défile,
// Aura, main de 4 cartes, ordres donnés animal par animal, Siffler, catapulte), écran de victoire ou de défaite, récompenses.
// Le combat de démonstration du tutoriel (src/ui/tuto.js) passe aussi par ici, avec ses propres bulles et sans trophées.
//
// Au doigt (ou à la souris) :
//   - glisser une carte sur la zone bleue : l'animal y tombe (toucher une carte puis toucher la zone marche aussi) ; un nageur
//     se pose dans l'eau de son camp ;
//   - glisser l'arène : elle défile ; deux doigts ou la molette : zoom ; toucher la mini-carte : la caméra y va ;
//   - toucher un de ses animaux : il est choisi (les autres touchers en ajoutent ou en retirent), puis toucher un animal
//     adverse, une boîte, une tour, la catapulte ou le camp adverse l'envoie l'attaquer ; toucher le sol l'y envoie et l'y poste ;
//   - glisser depuis un de ses animaux jusqu'à une cible : même ordre, d'un seul geste (la flèche tenue au bord fait défiler
//     l'arène, de plus en plus vite) ;
//   - « Attaquer » : tout s'allume (nos animaux, les adversaires, les structures) et toute la troupe est choisie ;
//   - « Siffler » : les animaux choisis (ou tous) rentrent se soigner à la tente ; un second coup les relâche ;
//   - « Catapulte » (ou toucher sa catapulte) : elle garde le camp, ou le singe la pousse au centre pour tirer sur le camp adverse.
import { $, h, wait, fmt, clamp, rand, countTo, TEST } from '../core/utils.js';
import { S } from '../core/save.js';
import { sfx, play, music, ambience } from '../core/audio.js';
import { IMG, unitAssets, mapAssets, chestIcon } from '../core/assets.js';
import { CHESTS } from '../data/cards.js';
import { ANIMALS } from '../data/animals.js';
import { makeBot } from '../data/bots.js';
import { arenaOf, ARENAS } from '../data/economy.js';
import { createBattle, step, TICK, TILE, WS, deploy, command, canDeploy, clampDeploy, forfeit, summary, handOf, BONUS_FX, CATA, setCata } from '../game/rt.js';
import { makeAI, aiStep } from '../game/ai.js';
import { swimmable } from '../game/nav.js';
import { MAP_W, MAP_H } from '../data/map.js';
import { newSeed } from '../core/rng.js';
import { applyFight, deckLevels } from '../game/progress.js';
import { View, textCanvas, HUD, FH, ZOOM, W, VY, AIR_LIFT } from '../render/view.js';
import { view as stageView, toStage, onResize, setBackdrop } from './stage.js';
import { showMenu } from './menu.js';
import { toast, fly, rewardHtml, TARGET, ask } from './ui.js';
import { celebrate } from './pages.js';
import { xpFrom, xpSettled } from './xpbar.js';
import { Net } from '../online/net.js';

let V = null, B = null, raf = 0, busy = false, lastT = 0;
// sel : carte touchée (en attente d'un toucher sur l'arène) ; drag : carte qu'on fait glisser ; mode : ordres (tout s'allume) ;
// picked : nos animaux choisis ; pickNew : le prochain toucher sur un de nos animaux recommence le choix ;
// aim : flèche d'un ordre qu'on trace ; g : geste en cours sur l'arène ; pts : doigts posés ; pinch : zoom à deux doigts
// edgeT : depuis combien de temps une carte ou une flèche est tenue au bord (l'arène défile de plus en plus vite)
// zoneT : la zone de pose reste affichée ce temps-là ; zoneSwim : c'est l'eau du camp (les nageurs) que le tutoriel montre
const U = { sel: -1, drag: null, hint: '', hintT: 0, mode: false, picked: new Set(), pickNew: true, aim: null, hover: 0, g: null, pts: new Map(), pinch: null, mini: false, fling: null, zoneT: 0, zoneSwim: false, edgeT: 0 };
const LIFT = AIR_LIFT * WS;                        // hauteur de vol, en pixels de la carte
const isSwim = (id) => !!(id && ANIMALS[id] && ANIMALS[id].swim);

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

// Lance un combat. mode : 'ranked' (trophées), 'friendly' (amical) ou 'demo' (le combat du tutoriel, contre un bot facile).
// opp : adversaire imposé (ami, membre du clan, bot du tutoriel). deck : cartes prêtées pour ce combat (tutoriel).
// guide : les bulles du tutoriel (src/ui/tuto.js) : start(api), tick(dt), event(e), done(res) qui rend la main au menu.
export async function startFight({ mode = 'ranked', opp = null, deck = null, guide = null } = {}) {
  if (busy) return false; busy = true;
  try {
    sfx.match();
    const ov = matchOverlay(), t0 = performance.now();
    if (!opp) opp = await findOpp(mode);
    else opp = { ...opp, skill: opp.skill === undefined ? 0.5 : opp.skill };
    const mine = deck || deckLevels(), arena = mode === 'demo' ? 1 : arenaOf(S.trophies);
    const loading = Promise.all([mapAssets(arena), ...[...new Set([...mine, ...opp.deck].map((c) => c.id))].map((id) => unitAssets(id))]);
    if (!TEST) await wait(Math.max(0, 1000 - (performance.now() - t0)));
    await ov.reveal(opp);
    await loading;
    enter(opp, mode, mine, arena, guide);
    ov.close();
    return true;
  } catch (e) { console.error(e); busy = false; toast('Impossible de lancer le combat.'); document.querySelectorAll('.mm').forEach((x) => x.remove()); return false; }
}

// ---------- entrée dans l'arène ----------
function enter(opp, mode, mine, arena, guide) {
  if (!V) { V = new View($('cv')); onResize((v) => V.resize(v.scale)); bindPointer(); }
  V.resize(stageView.scale); V.reset(arena);
  const lv = (d) => clamp(Math.round(avgLevel(d)), 1, 11);
  const b = createBattle({ decks: [mine, opp.deck], towerLevels: [lv(mine), lv(opp.deck)], seed: newSeed() });
  if (mode === 'demo') { const cp = b.camps[1]; cp.maxHp = cp.hp = Math.round(cp.maxHp * 0.55); }      // le camp du bot d'entraînement tombe plus vite
  B = { b, mode, opp, arena, acc: 0, ai: makeAI(1, opp.skill), endShown: false, party: false, sec: 99, tips: guide ? [] : tipsFor(), thr: {}, intro: TEST ? 0 : 1.1, guide, cataGlow: 0, seen: {}, ham: [0, 0] };
  Object.assign(U, { sel: -1, drag: null, mode: false, picked: new Set(), pickNew: true, aim: null, hover: 0, g: null, pinch: null, mini: false, fling: null, zoneT: 0, zoneSwim: false, edgeT: 0 });
  U.pts.clear();
  if (!guide) say('Glisse une carte dans ta zone bleue', 6);
  $('scrMenu').hidden = true; $('scrBattle').hidden = false; setBackdrop(IMG.mini || IMG['field' + arena]);
  const hud = $('bHud'); hud.textContent = '';
  hud.append(h('button', { class: 'icbtn bflag', 'aria-label': 'Abandonner', onclick: quit }));
  music(ARENAS[arena - 1].music);
  // la caméra part de près, sur le centre de l'arène, puis recule jusqu'à la montrer toute (voir loop)
  V.cam.x = MAP_W / 2; V.cam.y = MAP_H / 2; V.cam.z = 1.32; V.clampCam(V.cam);
  if (TEST) { V.cam.y = MAP_H; V.cam.z = ZOOM.start; V.clampCam(V.cam); }
  V.banner('COMBAT !', { size: 150, tint: 'orange', life: 1.3, y: 700 }); play('fight_start'); play('horn', { at: 0.15, v: 0.7 });
  V.banner('Détruis le camp adverse !', { size: 44, tint: 'white', life: 1.9, y: 800, delay: 0.35 });
  V.shake = 10; V.mapfx.excite(1);
  startAmbience();
  if (guide) guide.start(guideApi());
  lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
async function quit() {
  if (!B || B.b.over) return;
  sfx.click();
  const demo = B.mode === 'demo';
  if (await ask(demo ? 'Quitter l\'entraînement ?' : 'Abandonner ?', demo ? 'Tu pourras le refaire depuis les réglages.' : 'Ton adversaire gagnera, comme si ton camp était détruit.', demo ? 'Quitter' : 'Abandonner', 'Continuer')) { if (B && !B.b.over) forfeit(B.b, 0); }
}
// Ce que le tutoriel peut faire pendant son combat
function guideApi() {
  return {
    get b() { return B && B.b; }, get view() { return V; }, get ui() { return U; },
    say, glowCata(t = 6) { if (B) B.cataGlow = t; }, look(x, y, z) { V.lookAt(x, y, z || ZOOM.start); },
    ping(x, y, col) { V.ping(x, y, col || '#ffd23f'); },
    // Barnabé explique : le combat se fige (plus rien ne bouge ni ne se joue, la caméra reste libre) ; le geste en cours
    // est abandonné (la carte tenue retourne dans la main)
    freeze(on) {
      if (!B) return;
      B.frozen = !!on;
      if (on) { if (U.aim) endAim(false); Object.assign(U, { drag: null, g: null, pinch: null, mini: false, fling: null, sel: -1, edgeT: 0 }); U.pts.clear(); }
    },
    // la caméra va montrer (x, y) de la carte au zoom z, à la hauteur sy de l'écran (au mieux : elle ne sort pas de l'arène) ;
    // rend l'endroit de l'écran où (x, y) se trouvera
    focus(x, y, z, sy = VY) {
      const zz = clamp(z, ZOOM.min, ZOOM.max), t = V.clampCam({ x, y: y - (sy - VY) / zz, z: zz });
      V.lookAt(t.x, t.y, t.z);
      return { x: (x - t.x) * t.z + W / 2, y: (y - t.y) * t.z + VY };
    },
    camSave() { const c = V.camT || V.cam; return { x: c.x, y: c.y, z: c.z }; },
    camBack(c) { V.lookAt(c.x, c.y, c.z); },
    // la zone de pose reste affichée (swim : l'eau du camp, pour les nageurs) ; t : pendant ce temps (0 : on l'enlève)
    zone(t, swim = false) { U.zoneT = t; U.zoneSwim = t > 0 && swim; },
  };
}
// Astuces des premiers combats (temps de jeu, texte), montrées quand rien d'autre n'est affiché. Le 3e élément marque ce qui
// est nouveau avec les catapultes : montré aussi, deux combats, aux joueurs qui connaissent déjà le jeu.
const TIPS = [[9, 'Fais glisser l\'arène pour la parcourir'], [15, 'Détruis le camp rouge, tout en haut, pour gagner', 1], [26, 'Touche un de tes animaux, puis sa cible'],
  [36, 'Touche « Catapulte » : Barnabé la pousse au centre', 1], [52, 'Au centre, elle tire sur le camp adverse. Protège-la !', 1],
  [68, 'Casse les boîtes : elles cachent des bonus'], [82, 'Prends les tours : leur singe lance des pierres pour toi', 1], [98, 'Siffler : tes animaux rentrent se soigner']];
function tipsFor() {
  return S.fights < 3 ? TIPS.slice() : (S.cataFights || 0) < 2 ? TIPS.filter((x) => x[2]) : [];
}
// Une astuce liée à ce qui se passe (première fois seulement, pendant les premiers combats avec les catapultes)
function tipOnce(key, text, t = 3) {
  if (B.guide || B.seen[key] || ((S.cataFights || 0) >= 3 && S.fights >= 3)) return;
  B.seen[key] = 1; say(text, t);
}

// ---------- doigt : cartes, caméra, ordres ----------
const inRect = (p, [x, y, w, hh], m = 0) => p.x >= x - m && p.x <= x + w + m && p.y >= y - m && p.y <= y + hh + m;
function say(text, t = 1.8) { U.hint = text; U.hintT = t; }
const mine = () => B.b.units.filter((u) => !u.dead && u.side === 0);
// Un animal sous le doigt : son corps (des pattes à la tête), avec une marge qui garde la même taille à l'écran
function bodyHit(u, w, tol) {
  const v = V.vis.get(u.id), feet = u.y - (u.air ? LIFT : 0), top = v && v.top !== undefined ? Math.min(v.top, feet - 16) : feet - 34;
  const cy = (feet + top) / 2, hh = (feet - top) / 2 + tol, hw = Math.max(u.r * 1.3, 12) + tol;
  const dx = (w.x - u.x) / hw, dy = (w.y - cy) / hh, q = dx * dx + dy * dy;
  return q < 1 ? q : Infinity;
}
function unitAt(w, side, tolPx = 26) {
  const tol = tolPx / V.cam.z; let best = null, bs = Infinity;
  for (const u of B.b.units) { if (u.dead || u.side !== side) continue; const q = bodyHit(u, w, tol); if (q < bs) { bs = q; best = u; } }
  return best;
}
// Une catapulte sous le doigt (son bâti, des roues au haut du bras)
function cataAt(w, side, tolPx = 20) {
  const k = B.b.catas[side], tol = tolPx / V.cam.z;
  return Math.abs(w.x - k.x) < 62 + tol && w.y > k.y - 120 - tol && w.y < k.y + 20 + tol ? k : null;
}
// Ce qu'on peut viser sous le doigt : un animal adverse, une boîte (la dorée aussi), une tour qui n'est pas à nous, la
// catapulte ou le camp adverse
function targetAt(w) {
  const b = B.b, tol = 24 / V.cam.z;
  const u = unitAt(w, 1); if (u && u.spawn <= 0) return u;
  const k = cataAt(w, 1); if (k && !k.dead) return k;
  const gb = b.gold && b.gold.box; if (gb && !gb.dead && Math.hypot((w.x - gb.x) / (gb.rx + 6 + tol), (w.y - gb.y + 30) / (42 + tol)) < 1) return gb;
  for (const c of b.crates) if (!c.dead && Math.hypot((w.x - c.x) / (c.rx + tol), (w.y - c.y + 14) / (c.ry + 20 + tol)) < 1) return c;
  for (const t of b.towers) if (t.side !== 0 && Math.abs(w.x - t.x) < 78 + tol && w.y > 574 - tol && w.y < 892) return t;
  const cp = b.camps[1]; if (!cp.dead && Math.abs(w.x - cp.x) < 118 + tol && w.y > -20 && w.y < cp.y + 64 + tol) return cp;
  return null;
}

function tryDeploy(slot, x, y) {
  const b = B.b, card = handOf(b, 0)[slot]; if (!card) return false;
  const swim = isSwim(card.id);
  if (!canDeploy(b, 0, x, y, card.id)) {     // le doigt déborde un peu : on pose au bord de la zone
    const q = clampDeploy(b, 0, x, y, card.id);
    if (Math.hypot(q.x - x, q.y - y) > (swim ? 2.2 : 1.6) * TILE) { play('error', { v: 0.6 }); say(swim ? 'Les nageurs se posent dans l\'eau de ton camp' : 'Pose tes animaux dans ta zone bleue'); U.zoneT = 1.4; return false; }
    x = q.x; y = q.y;
  }
  const r = deploy(b, 0, slot, x, y);
  if (r === 'aura') { play('no_aura'); say('Pas assez d\'Aura !'); V.text('AURA !', x, y - 24, { size: 30, tint: 'pink', life: 0.8 }); return false; }
  if (r) { play('error', { v: 0.6 }); return false; }
  U.sel = -1; if (U.hint.startsWith('Glisse une carte') || U.hint.startsWith('Touche ta zone') || U.hint.startsWith('Touche l\'eau')) U.hintT = 0;
  return true;
}
// La carte choisie ou tenue est-elle un nageur ? (la vue montre alors l'eau de notre camp au lieu de la zone bleue)
function swimCard() {
  const s = U.drag ? U.drag.slot : U.sel; if (s < 0) return false;
  const c = handOf(B.b, 0)[s]; return !!(c && isSwim(c.id));
}
// Bouton « Catapulte » (ou toucher sa catapulte) : défense au camp, ou attaque depuis le centre
function cataToggle() {
  const b = B.b, k = b.catas[0], want = k.want === 'centre' ? 'camp' : 'centre';
  if (b.over || !setCata(b, 0, want)) return;
  sfx.click(); B.cataGlow = 0;
  if (want === 'centre') say(k.dead ? 'Une fois réparée, elle ira au centre' : 'Barnabé pousse ta catapulte au centre', 2.2);
  else say(k.dead ? 'Une fois réparée, elle gardera ton camp' : 'Ta catapulte rentre garder ton camp', 2.2);
  B.tips = B.tips.filter((x) => !x[1].startsWith('Touche « Catapulte »'));      // il a compris : plus besoin de l'astuce
}
// Mode ordres : tout s'allume ; all : toute la troupe est choisie d'office
function setMode(on, all = true) {
  U.mode = on; U.hover = 0; U.aim = null;
  if (!on) { U.picked = new Set(); U.pickNew = true; return; }
  U.sel = -1;
  const list = mine();
  U.picked = new Set(all ? list.map((u) => u.id) : []); U.pickNew = true;
  if (!list.length) say('Pose d\'abord un animal !', 2);
  else if (all) say(list.length > 1 ? 'Toute ta troupe : touche sa cible' : 'Touche sa cible, ou un endroit', 2.6);
}
function toggleMode() { sfx.click(); setMode(!U.mode); if (!U.mode) say('Tes animaux suivent leurs ordres', 1.4); }
function pick(id) {
  if (!U.mode) setMode(true, false);
  if (U.pickNew) { U.picked = new Set([id]); U.pickNew = false; }
  else if (U.picked.has(id)) U.picked.delete(id); else U.picked.add(id);
  const u = B.b.ents.get(id);
  play('click', { v: 0.6, rate: U.picked.has(id) ? 1.15 : 0.85 });
  if (u && U.picked.has(id)) V.fx('ring_yellow', u.x, u.y + 2, { s0: 0.12, s1: 0.4, life: 0.3, flat: 0.5, a: 0.9 });
  if (!U.picked.size) { U.pickNew = true; say('Touche un de tes animaux', 1.6); }
  else say(U.picked.size > 1 ? U.picked.size + ' animaux : touche leur cible' : (u ? ANIMALS[u.aid].name : 'Ton animal') + ' : touche sa cible', 2.4);
}
function orderAttack(ids, t) {
  const b = B.b;
  if (!ids.length) { play('error', { v: 0.5 }); say('Touche d\'abord un de tes animaux'); return; }
  const n = command(b, 0, ids, { ref: t.id });
  if (!n) { play('error', { v: 0.6 }); say(whyNot(ids, t)); return; }
  V.fx('ring_red', t.kind === 'unit' ? t.x : t.aimX, t.kind === 'unit' ? t.y + 2 : t.aimY + 10, { s0: 0.2, s1: t.kind === 'unit' ? 0.5 : t.kind === 'cata' ? 0.6 : 0.9, life: 0.45, flat: 0.55, a: 0.95 });
  say(n === 1 ? 'À l\'attaque !' : n + ' animaux à l\'attaque !', 1.2);
  if (n < ids.length) say(n + ' sur ' + ids.length + ' peuvent attaquer ça', 1.6);
  U.pickNew = true;
}
// Pourquoi personne n'a pris l'ordre d'attaque
function whyNot(ids, t) {
  const us = ids.map((id) => B.b.ents.get(id)).filter((u) => u && !u.dead);
  if (t.kind === 'unit' && t.air) return 'Il vole : il faut un animal qui touche les airs';
  if (t.kind === 'unit' && t.swim) return 'Il nage : seuls les volants et les nageurs l\'atteignent';
  if (us.length && us.every((u) => u.swim)) return 'Tes nageurs ne l\'atteignent pas depuis la rivière';
  return 'Ils ne peuvent pas attaquer ça';
}
function orderMove(ids, w) {
  if (!ids.length) { play('error', { v: 0.5 }); say('Touche d\'abord un de tes animaux'); return; }
  const n = command(B.b, 0, ids, { x: w.x, y: w.y });
  if (!n) return;
  V.fx('ring_blue', w.x, w.y, { s0: 0.15, s1: 0.5, life: 0.4, flat: 0.55, a: 0.9 });
  say(n === 1 ? 'Il tient cette place' : 'Ils tiennent cette place', 1.2);
  U.pickNew = true;
}
// Siffler : retour à la tente pour se soigner (les choisis, sinon tous) ; si certains y sont déjà, ils repartent
function whistle() {
  const b = B.b, list = mine(), home = list.filter((u) => u.order && u.order.home);
  if (home.length) { command(b, 0, home.map((u) => u.id), null); say('Ils repartent au combat !', 1.4); return; }
  const ids = U.picked.size ? [...U.picked] : list.map((u) => u.id);
  if (!ids.length) { play('error', { v: 0.5 }); say('Aucun animal à rappeler'); return; }
  command(b, 0, ids, { home: true }); say('Retour à la tente : ils s\'y soignent', 2);
  U.pickNew = true;
}
function startAim(id) {
  if (!U.picked.has(id)) { if (!U.mode) setMode(true, false); U.picked = new Set([id]); U.pickNew = false; }
  U.aim = { ids: [...U.picked], x: 0, y: 0, ent: 0 };
  play('swish', { v: 0.4, rate: 1.4 });
}
function endAim(apply) {
  const A = U.aim; U.aim = null; U.hover = 0;
  if (!A || !apply) return;
  const t = A.ent ? B.b.ents.get(A.ent) : null;
  const near = A.ids.every((id) => { const u = B.b.ents.get(id); return !u || Math.hypot(u.x - A.x, u.y - A.y) < 16; });
  if (t && !t.dead) orderAttack(A.ids, t);
  else if (!near) orderMove(A.ids, A);
}
function miniLook(p) {
  const [x, y, w, hh] = HUD.mini;
  V.lookAt(clamp((p.x - x) / w, 0, 1) * MAP_W, clamp((p.y - y) / hh, 0, 1) * MAP_H, 0, true);
}

function bindPointer() {
  const scr = $('scrBattle');
  scr.addEventListener('pointerdown', (e) => {
    if (!B || B.b.over || B.frozen || (e.target.closest && e.target.closest('button'))) return;
    const p = toStage(e), b = B.b;
    try { scr.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
    U.pts.set(e.pointerId, p);
    if (U.pts.size === 2 && !U.drag) {       // deux doigts : on zoome (le geste d'un doigt en cours est abandonné)
      if (U.g && U.g.kind === 'aim') endAim(false);
      U.g = null; U.mini = false;
      const [a, c] = [...U.pts.values()];
      U.pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      return;
    }
    if (U.pts.size > 1) return;
    U.fling = null;
    if (inRect(p, HUD.whistle)) { whistle(); return; }
    if (inRect(p, HUD.attack)) { toggleMode(); return; }
    if (inRect(p, HUD.cata, 4)) { cataToggle(); return; }
    const slot = HUD.slots.findIndex((r) => inRect(p, r, 4));
    if (slot >= 0) {
      const card = handOf(b, 0)[slot]; if (!card) return;
      U.drag = { slot, id: card.id, x: 0, y: 0, sx: p.x, sy: p.y, sxp: p.x, syp: p.y, moved: false, onField: false, ok: false, pid: e.pointerId, p };
      play('swish', { v: 0.5, rate: 1.3 });
      return;
    }
    if (p.y >= FH) return;
    if (V.miniShown() && inRect(p, HUD.mini, 6)) { U.mini = true; miniLook(p); sfx.click(); return; }
    // sur l'arène : toucher ou glisser ? On décide au premier déplacement ou au relâché.
    const w = V.worldAt(p.x, p.y), own = U.sel < 0 ? unitAt(w, 0, 22) : null;
    U.g = { id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, lt: performance.now(), vx: 0, vy: 0, own: own ? own.id : 0, kind: null };
  });
  scr.addEventListener('pointermove', (e) => {
    if (!B) return;
    const p = toStage(e);
    if (U.pts.has(e.pointerId)) U.pts.set(e.pointerId, p);
    if (U.pinch) {
      if (U.pts.size < 2) return;
      const [a, c] = [...U.pts.values()], d = Math.hypot(a.x - c.x, a.y - c.y), mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      V.panBy(mx - U.pinch.x, my - U.pinch.y); V.zoomAt(mx, my, d / Math.max(30, U.pinch.d));
      U.pinch = { d, x: mx, y: my }; return;
    }
    const d = U.drag;
    if (d) { if (e.pointerId === d.pid) cardMove(d, p); return; }
    if (U.mini) { if (U.pts.has(e.pointerId)) miniLook(p); return; }
    const g = U.g;
    if (!g || e.pointerId !== g.id) {      // la souris survole : viseur sur ce qu'on peut viser
      if (U.mode && e.pointerType === 'mouse' && p.y < FH && p.y > 152) { const t = targetAt(V.worldAt(p.x, p.y)); U.hover = t ? t.id : 0; }
      return;
    }
    if (!g.kind) {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) < 12) return;
      if (g.own && !B.b.over) { const u = B.b.ents.get(g.own); if (u && !u.dead) { g.kind = 'aim'; startAim(g.own); } else g.kind = 'pan'; } else g.kind = 'pan';
    }
    if (g.kind === 'pan') {
      const now = performance.now(), dtm = Math.max(4, now - g.lt), dx = p.x - g.lx, dy = p.y - g.ly;
      V.panBy(dx, dy);
      g.vx = g.vx * 0.6 + dx / dtm * 1000 * 0.4; g.vy = g.vy * 0.6 + dy / dtm * 1000 * 0.4; g.lx = p.x; g.ly = p.y; g.lt = now;
      return;
    }
    if (g.kind === 'aim' && U.aim) { g.p = p; aimAt(p); }
  });
  const up = (e) => {
    if (!B) return;
    U.pts.delete(e.pointerId);
    if (U.pinch) { if (U.pts.size < 2) U.pinch = null; return; }
    const d = U.drag;
    if (d) { if (e.pointerId === d.pid) cardUp(d, e); return; }
    if (U.mini) { U.mini = false; return; }
    const g = U.g; if (!g || e.pointerId !== g.id) return;
    U.g = null;
    if (e.type === 'pointercancel' || B.b.over) { if (g.kind === 'aim') endAim(false); return; }
    if (g.kind === 'pan') { if (performance.now() - g.lt < 90 && Math.hypot(g.vx, g.vy) > 120) U.fling = { vx: g.vx, vy: g.vy }; return; }
    if (g.kind === 'aim') { endAim(true); return; }
    tap(toStage(e), g);
  };
  scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);
  scr.addEventListener('wheel', (e) => {
    if (!B || $('scrBattle').hidden) return;
    e.preventDefault();
    if (B.frozen) return;
    const p = toStage(e); if (p.y < FH) V.zoomAt(p.x, p.y, Math.exp(-clamp(e.deltaY, -240, 240) * 0.0016));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!B || B.b.over || B.frozen || $('scrBattle').hidden) return;
    const k = e.key;
    if (['1', '2', '3', '4'].includes(k)) { U.sel = +k - 1; say(swimCard() ? 'Touche l\'eau de ton camp pour le poser' : 'Touche ta zone bleue pour le poser', 2.2); }
    else if (k === 'Escape') { U.sel = -1; setMode(false); }
    else if (k === 'a' || k === 'A') toggleMode();
    else if (k === 's' || k === 'S') whistle();
    else if (k === 'c' || k === 'C') cataToggle();
    else if (k === '+' || k === '=') V.zoomAt(W / 2, 768, 1.15);
    else if (k === '-') V.zoomAt(W / 2, 768, 1 / 1.15);
    else if (k.startsWith('Arrow')) { const s = 90; V.panBy(k === 'ArrowLeft' ? s : k === 'ArrowRight' ? -s : 0, k === 'ArrowUp' ? s : k === 'ArrowDown' ? -s : 0); }
  });
}
function tap(p, g) {
  const b = B.b, w = V.worldAt(p.x, p.y);
  if (p.y < 152) return;                                   // sous les jauges du haut : rien
  if (U.sel >= 0) {
    const card = handOf(b, 0)[U.sel], id = card ? card.id : null;
    const q = canDeploy(b, 0, w.x, w.y, id) ? w : clampDeploy(b, 0, w.x, w.y, id);
    if (Math.hypot(q.x - w.x, q.y - w.y) <= 1.6 * TILE || !(unitAt(w, 0) || targetAt(w))) { tryDeploy(U.sel, w.x, w.y); return; }
    U.sel = -1;                                            // on touche un animal ou une cible : la carte retourne dans la main
  }
  const own = g.own ? b.ents.get(g.own) : unitAt(w, 0);
  if (own && !own.dead) { pick(own.id); return; }
  if (!U.mode && !U.picked.size) {                         // hors ordres : toucher sa catapulte la fait changer de poste ;
    if (cataAt(w, 0)) { cataToggle(); return; }            // toucher une cible montre comment faire
    if (targetAt(w)) say('Touche d\'abord un de tes animaux', 1.6);
    return;
  }
  const t = targetAt(w);
  if (t) { orderAttack([...U.picked], t); return; }
  orderMove([...U.picked], w);
}
function aimAt(p) {
  const w = V.worldAt(p.x, p.y), t = targetAt(w);
  U.aim.x = w.x; U.aim.y = w.y; U.aim.ent = t ? t.id : 0; U.hover = U.aim.ent;
}
function cardMove(d, p) {
  d.p = p; d.sxp = p.x; d.syp = p.y;
  if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 14) d.moved = true;
  d.onField = d.moved && p.y < FH - 20;
  if (!d.onField) return;
  const b = B.b, card = handOf(b, 0)[d.slot], id = card ? card.id : null, w = V.worldAt(p.x, Math.min(p.y - 36, FH - 50));
  let x = w.x, y = w.y, zone = canDeploy(b, 0, x, y, id);
  if (!zone) { const q = clampDeploy(b, 0, x, y, id); if (Math.hypot(q.x - x, q.y - y) <= (isSwim(id) ? 2.2 : 1.6) * TILE) { x = q.x; y = q.y; zone = true; } }
  d.x = x; d.y = y; d.ok = !!card && zone && b.players[0].aura >= card.cost;
}
function cardUp(d, e) {
  U.drag = null;
  if (e.type === 'pointercancel') return;
  if (!d.moved) { U.sel = U.sel === d.slot ? -1 : d.slot; if (U.sel >= 0) { setMode(false); say(isSwim(d.id) ? 'Touche l\'eau de ton camp pour le poser' : 'Touche ta zone bleue pour le poser', 2.2); } return; }
  if (d.onField) tryDeploy(d.slot, d.x, d.y);
}

// ---------- ce qui se passe en combat : effets et sons ----------
const BIG = { gorilla: 1, elephant: 1, rhino: 1, alligator: 1 };
const SPARK = { kitten: 'pink_burst', monkey: 'arc_yellow', bulldog: 'claw_red', pig: 'burst_rocks', orang: 'burst_rocks', alligator: 'claw_yellow', eagle: 'slash_red', gorilla: 'burst_yellow', rhino: 'burst_rocks', elephant: 'burst_rocks',
  octo: 'claw_red', dolphin: 'ring_blue', clownfish: 'ring_blue' };
const SPECIAL_SFX = { monkey: 'whoosh', bulldog: 'whoosh', pig: 'poison', alligator: 'whoosh', gorilla: 'slam', rhino: 'shield', elephant: 'splash', kitten: 'shield', orang: 'shield', octo: 'whirlpool', dolphin: 'dolphin_jump', clownfish: 'bubbles' };
// tirs des nageurs : le bruit du départ, puis de l'arrivée
const WATER_SHOT = { bubble: ['bubbles', 0.3, 1.35], bubbles: ['bubbles', 0.55, 1], waterball: ['water_spit', 0.6, 1], wave: ['wave', 0.75, 1] };
const WATER_LAND = { bubble: ['bubble_pop', 0.45, 5], bubbles: ['bubble_pop', 0.6, 9], waterball: ['splash', 0.45, 10], wave: ['splash', 0.7, 16] };
// gerbe de gouttes (quand quelque chose tombe ou frappe dans l'eau)
function droplets(x, y, n, sp = 1, col = '190,232,255') {
  for (let i = 0; i < n; i++) { const an = rand(0, 6.283), v = rand(30, 90) * sp; V.dot(x + Math.cos(an) * 5, y - 4, { vx: Math.cos(an) * v, vy: Math.sin(an) * v * 0.4 - rand(70, 140) * sp, g: 480, life: rand(0.4, 0.7), r: rand(1.2, 2.4), col }); }
}
const BONUS_TXT = { monkey: ['SINGE EN RENFORT !', 'Un singe de plus dans ta troupe'], kitten: ['CHATON EN RENFORT !', 'Un chaton soigneur de plus'], fruit: ['FRUITS !', 'Tes animaux autour reprennent des forces'],
  rage: ['RAGE !', `+${Math.round(BONUS_FX.rage.dmg * 100)} % de dégâts pendant ${BONUS_FX.rage.dur} s`], aura: ['+' + BONUS_FX.aura + ' AURA', 'De l\'Aura en plus pour poser'] };
const voiceT = {};
function voice(id, v = 0.55) { const now = performance.now(); if (now - (voiceT[id] || 0) < 2500) return; voiceT[id] = now; play('v_' + id, { v, rate: rand(0.95, 1.06) }); }
// son placé : à gauche ou à droite selon la caméra, plus doux hors de l'écran
const pan = (x) => clamp((x - V.cam.x) * V.cam.z / (W / 2), -1, 1) * 0.8;
const seen = (x, y) => V.onScreen(x, y, 40);
function snd(name, x, y, v = 1, o = {}) { play(name, { ...o, v: v * (seen(x, y) ? 1 : 0.4), pan: pan(x) }); }
function shake(x, y, k) { if (seen(x, y)) V.shake = Math.max(V.shake, k); }
// pas trop souvent pour la même chose (texte au-dessus d'un animal, petit son)
function every(key, s) { const t = B.b.t; if (t - (B.thr[key] || -9) < s) return false; B.thr[key] = t; return true; }
function midY(id, x, y, air) { const v = V.vis.get(id), feet = y - (air ? LIFT : 0); return v && v.top !== undefined ? (feet + v.top) / 2 : feet - 16; }
const RING = (r, base = 90) => r / WS / base;      // taille d'un anneau d'effet pour un rayon donné (pixels de la carte)

function onEvents(evs) {
  const b = B.b;
  for (const e of evs) {
    if (B.guide) B.guide.event(e);
    switch (e.type) {
      case 'deploy':       // l'animal tombe du ciel : le bruit de l'atterrissage suit de peu (la poussière est dessinée par la vue)
        if (e.swim) {      // un nageur plonge dans l'eau de son camp (les ronds dans l'eau sont dessinés par la vue)
          snd('splash_in', e.x, e.y, e.side === 0 ? 0.8 : 0.5); droplets(e.x, e.y, 14, 1.1);
          V.fx(e.side === 0 ? 'ring_blue' : 'ring_red', e.x, e.y + 2, { s0: 0.2, s1: 0.62, life: 0.45, flat: 0.55, a: 0.65 });
          tipOnce('swim' + e.side, e.side === 0 ? 'Tes nageurs ne craignent que les volants et les nageurs' : 'Un nageur adverse ! Seuls les volants et les nageurs le touchent', 3.2);
        } else {
          snd('deploy', e.x, e.y, e.side === 0 ? 0.8 : 0.5);
          if (BIG[e.id]) snd('chest_thud', e.x, e.y, 0.55, { at: 0.2 });
          V.fx(e.side === 0 ? 'ring_blue' : 'ring_red', e.x, e.y + 2, { s0: 0.2, s1: 0.62, life: 0.45, flat: 0.55, a: 0.9 });
        }
        if (e.side === 1 && !seen(e.x, e.y)) V.ping(e.x, e.y, '#ff6a5a');
        if (e.side === 0) { const tip = B.tips.find((x) => x[1].startsWith('Touche un')); if (tip && tip[0] > b.t + 3) { tip[0] = b.t + 3; B.tips.sort((p, q) => p[0] - q[0]); } }
        break;
      case 'arrive': voice(e.id, 0.5); break;
      case 'attack':
        if (e.special) { snd(SPECIAL_SFX[e.id] || 'whoosh', e.x, e.y, 0.8); voice(e.id, 0.6); if (e.swim) droplets(e.x, e.y, 8); }
        else if (e.heal) snd('heal', e.x, e.y, 0.25, { rate: 1.3 });
        else if (e.swim) snd('swish', e.x, e.y, 0.3, { rate: 0.75 });
        else snd('swish', e.x, e.y, e.id === 'kitten' ? 0.35 : 0.45, { rate: e.id === 'kitten' ? 1.5 : rand(0.85, 1.15) });
        if (e.charge) { snd('hit_heavy2', e.x, e.y, 0.9); shake(e.x, e.y, 10); }
        break;
      case 'hit': {
        if (e.kind === 'gold') {     // la boîte dorée encaisse : des éclats d'or
          V.burst('star_big', e.x + rand(-14, 14), e.y - 34, 2, { s: 0.1, sp0: 80, sp1: 200, up: 150, g: 500, add: true });
          if (!e.splash) { snd('hit', e.x, e.y, 0.5, { rate: rand(1.25, 1.45) }); if (every('goldHit', 0.5)) snd('coins', e.x, e.y, 0.3, { rate: rand(1.1, 1.3) }); }
          break;
        }
        if (e.kind === 'tower' || e.kind === 'crate' || e.kind === 'camp' || e.kind === 'cata') {
          const camp = e.kind === 'camp', cata = e.kind === 'cata', y = e.y - (e.kind === 'tower' ? 40 : camp ? 14 : cata ? 4 : 6) + rand(-10, 10), sx = e.x + rand(camp ? -40 : -18, camp ? 40 : 18);
          if (!e.splash && e.by) V.fx(SPARK[e.by] || 'burst_yellow', sx, y, { s0: 0.22, s1: 0.5, life: 0.25, rot: rand(-0.5, 0.5) });
          if (e.kind === 'crate' || cata) { if (!e.splash) { snd(e.by === 'octo' ? 'tentacle' : 'hit', e.x, e.y, 0.5, { rate: rand(0.6, 0.75) }); V.burst('planks', e.x, e.y - 14, 1, { s: 0.1, sp0: 80, sp1: 200, up: 160, g: 900 }); } }
          else if (!e.splash) { snd(e.by === 'octo' ? 'tentacle' : 'tower_hit', e.x, e.y, 0.55); if (Math.random() < 0.4) V.burst(camp ? 'planks' : 'rocks', sx, y, 1, { s: 0.1, sp0: 80, sp1: 200, up: 160, g: 900 }); }
          if (camp && e.side === 0 && !seen(e.x, e.y) && every('campHit', 4)) { V.ping(e.x, e.y, '#ff5a4a'); say('Ton camp est attaqué !', 1.8); }
          if (cata && e.side === 0 && !seen(e.x, e.y) && every('cataHit', 5)) { V.ping(e.x, e.y, '#ff5a4a'); say('Ta catapulte est attaquée !', 1.8); }
          break;
        }
        const ent = b.ents.get(e.id), y = midY(e.id, e.x, e.y, e.air);
        if (e.shield) { V.fx('shield', e.x, y, { s0: 0.12, s1: 0.22, life: 0.3, a: 0.8 }); if (every('sh' + e.id, 0.4)) snd('shield', e.x, e.y, 0.3, { rate: 1.5 }); break; }
        if (e.dot) { if (seen(e.x, e.y) && every('dot' + e.id, 0.9)) V.text('-' + e.amount, e.x + rand(-10, 10), y - 14, { size: 18, tint: 'green', life: 0.6 }); break; }
        if (e.swim && !e.splash) droplets(e.x, e.y, 5, 0.8);          // un nageur touché : l'eau gicle
        if (e.splash && !e.by) break;
        if (!e.by) { V.fx('smoke_puff', e.x + rand(-5, 5), y, { s0: 0.12, s1: 0.3, life: 0.3, a: 0.8 }); snd('hit', e.x, e.y, 0.3, { rate: 1.3 }); break; }
        if (e.splash) { V.fx('star_big', e.x, y, { s0: 0.08, s1: 0.2, life: 0.14, add: true, a: 0.7 }); break; }
        const heavy = BIG[e.by] || e.charge;
        V.fx(SPARK[e.by] || 'burst_yellow', e.x + rand(-5, 5), y, { s0: 0.18, s1: heavy ? 0.6 : 0.4, life: 0.24, rot: rand(-0.6, 0.6) });
        V.fx('star_big', e.x + rand(-4, 4), y, { s0: 0.1, s1: heavy ? 0.5 : 0.32, life: 0.16, add: true, a: 0.9, rot: rand(0, 3) });
        if (heavy) { snd(['hit_heavy', 'hit_heavy2', 'hit_heavy3'][Math.floor(Math.random() * 3)], e.x, e.y, 0.75); shake(e.x, e.y, 6); }
        else if (e.by === 'bulldog' || e.by === 'alligator') snd('bite', e.x, e.y, 0.6);
        else if (e.by === 'octo') snd('tentacle', e.x, e.y, 0.65, { rate: rand(0.9, 1.1) });
        else snd(['hit', 'hit2', 'hit3', 'hit4'][Math.floor(Math.random() * 4)], e.x, e.y, 0.7);
        if (ent && ent.kind === 'unit' && (e.amount > ent.maxHp * 0.25 || e.by === 'alligator')) V.text('-' + e.amount, e.x, y - 18, { size: e.by === 'alligator' ? 26 : 22, tint: ent.side === 0 ? 'red' : 'yellow', life: 0.7 });
        break;
      }
      case 'shot': { const v = V.svis.get(e.tid); if (v) v.throwT = 0; snd('whoosh', e.x, e.y, 0.4, { rate: 0.7 }); break; }
      // ---- les catapultes ----
      case 'cata_order':      // envoyée au centre ou rappelée : le singe répond
        if (e.side === 0) snd('v_tuto', e.x, e.y, 0.6, { at: 0.12, rate: rand(0.95, 1.08) });
        break;
      case 'cata_move':
        snd('v_tuto', e.x, e.y, 0.35, { rate: 0.9 });       // (le bruit des roues : voir la boucle)
        if (e.side === 1 && e.want === 'centre' && every('redGo', 20)) { V.ping(e.x, e.y, '#ff5a4a'); if (!B.guide) say('La catapulte rouge part au centre !', 2.2); }
        break;
      case 'cata_arrive':
        if (e.at === 'centre') {
          snd('chest_thud', e.x, e.y, 0.5, { rate: 0.8 });
          if (e.side === 0) { if (!B.guide) say('Ta catapulte est en place : elle tire sur le camp rouge', 2.8); }
          else { V.ping(e.x, e.y, '#ff5a4a'); if (!B.guide && every('redHere', 25)) say('La catapulte rouge vise ton camp : casse-la !', 2.8); }
        } else if (e.side === 0 && !B.guide) say('Ta catapulte garde ton camp', 1.8);
        break;
      case 'cata_wind': snd('cata_creak', e.x, e.y, e.atk ? 0.75 : 0.4, { rate: e.atk ? 0.9 : 1.15 }); break;
      case 'cata_fire':       // au camp : une pierre sur qui approche
        snd('cata_launch', e.x, e.y, 0.45, { rate: 1.25 });
        V.fx('dust_ring', e.x, e.y + 50, { s0: 0.2, s1: 0.6, life: 0.4, flat: 0.55, a: 0.6 });
        break;
      case 'catapult': {      // depuis le centre, un gros rocher part vers le camp adverse
        const ours = e.side === 0;
        snd('cata_launch', e.x, e.y, 0.95); snd('whoosh', e.x, e.y, 0.8, { rate: 0.55, at: 0.05 });
        V.fx('dust_ring', e.x, e.y + 50, { s0: 0.3, s1: 1.1, life: 0.5, flat: 0.55, a: 0.8 });
        V.burst('star_big', e.x, e.y, 6, { s: 0.16, sp0: 100, sp1: 260, up: 120, g: 400, add: true });
        shake(e.x, e.y, 8); V.mapfx.excite(0.8);
        if (ours) { if (every('cataBanner', 30)) V.banner('TIR DE CATAPULTE !', { size: 72, tint: 'blue', life: 1.2, y: 560 }); }
        else if (!B.guide && every('redShot', 16)) say('La catapulte rouge tire sur ton camp !', 2.2);
        V.ping(e.tx, e.ty, ours ? '#5ac8ff' : '#ff5a4a');
        break;
      }
      case 'cata_break': {    // cassée : le singe va la réparer (src/game/rt.js, updateCata)
        const ours = e.side === 0;
        snd('cata_break', e.x, e.y, 1); snd('tower_down', e.x, e.y, 0.45, { rate: 1.3 });
        V.fx('explosion1', e.x, e.y - 30, { s0: 0.3, s1: 0.9, life: 0.5 });
        V.burst('planks', e.x, e.y - 30, 9, { s: 0.18, sp0: 140, sp1: 380, up: 260, g: 1000 });
        V.fx('dust_ring', e.x, e.y + 4, { s0: 0.3, s1: 1.1, life: 0.5, flat: 0.5, a: 0.85 });
        shake(e.x, e.y, 12); V.mapfx.excite(0.8);
        V.text('CATAPULTE CASSÉE !', e.x, e.y - 100, { size: 30, tint: ours ? 'red' : 'yellow', life: 1.5, pop: 1.3 });
        if (ours) { if (!B.guide) say('Ta catapulte est cassée : Barnabé la répare', 2.6); if (!seen(e.x, e.y)) V.ping(e.x, e.y, '#ff5a4a'); }
        else play('crown', { v: 0.5, at: 0.2 });
        break;
      }
      case 'cata_fixed':
        snd('cata_ready', e.x, e.y, 0.8); snd('crown', e.x, e.y, 0.45, { at: 0.62, rate: 1.2 });
        V.burst('star_big', e.x, e.y - 40, 8, { s: 0.14, sp0: 80, sp1: 220, up: 160, g: 300, add: true });
        if (e.side === 0 && !B.guide) say('Ta catapulte est réparée !', 1.8);
        break;
      case 'camp_down': {     // un camp est détruit : fin du combat
        const mx = e.x, my = e.side === 0 ? 1316 : 158;
        snd('tower_down', e.x, e.y, 1); snd('slam', e.x, e.y, 0.9, { at: 0.1 }); play('crown', { at: 0.4, v: 0.8 });
        V.fx('explosion2', mx, my, { s0: 0.5, s1: 1.6, life: 0.8 }); V.fx('explosion1', mx - 60, my + 10, { s0: 0.3, s1: 1, life: 0.6, delay: 0.1 }); V.fx('explosion1', mx + 60, my - 5, { s0: 0.3, s1: 1, life: 0.6, delay: 0.2 });
        V.burst('planks', mx, my, 12, { s: 0.22, sp0: 200, sp1: 520, up: 300, g: 1000 }); V.burst('rocks', mx, my, 10, { s: 0.18, sp0: 180, sp1: 480, up: 280, g: 1000 });
        V.burst('star_big', mx, my - 20, 16, { s: 0.22, sp0: 200, sp1: 520, up: 200, g: 500, add: true });
        shake(e.x, e.y, 26); V.flash = 0.4; V.flashColor = e.side === 1 ? '150,210,255' : '255,110,90'; V.mapfx.excite(2);
        break;
      }
      case 'proj':
        if (e.key === 'rocks2') snd('whoosh', e.x, e.y, 0.4, { rate: 0.8 });
        else if (e.key === 'gust') snd('tornado', e.x, e.y, 0.35, { rate: 1.3 });
        else if (WATER_SHOT[e.key]) { const [n, v, r] = WATER_SHOT[e.key]; snd(n, e.x, e.y, v, { rate: r * rand(0.92, 1.08) }); }
        break;
      case 'land':
        if (e.cata) {        // le rocher de la catapulte s'écrase sur le camp
          const ours = e.side === 0;
          snd('tower_down', e.x, e.y, 0.9); snd('rock', e.x, e.y, 0.9, { at: 0.04 });
          V.fx('explosion2', e.x, e.y - 20, { s0: 0.35, s1: 1.1, life: 0.6 });
          V.burst('rocks', e.x, e.y - 10, 8, { s: 0.18, sp0: 160, sp1: 420, up: 260, g: 1000 }); V.burst('planks', e.x, e.y - 10, 6, { s: 0.16, sp0: 140, sp1: 380, up: 240, g: 1000 });
          V.fx('dust_ring', e.x, e.y + 6, { s0: 0.4, s1: 1.6, life: 0.55, flat: 0.5, a: 0.9 }); V.decal('crater2', e.x, e.y + 10, 6, 0.7);
          shake(e.x, e.y, 18); if (seen(e.x, e.y)) { V.flash = 0.25; V.flashColor = ours ? '150,210,255' : '255,110,90'; }
          V.text('-' + Math.round(CATA.atk.hit * 100) + ' %', e.x, e.y - 60, { size: 40, tint: ours ? 'yellow' : 'red', life: 1.3, pop: 1.4 });
          V.mapfx.excite(1.2);
        } else if (e.key === 'rocks2' || e.key === 'stone') {      // pierre d'une tour ou d'une catapulte qui garde son camp
          const big = e.tower ? 1.25 : 1;
          snd('rock', e.x, e.y, 0.8); V.fx('burst_rocks', e.x, e.y - 8, { s0: 0.25, s1: 0.62 * big, life: 0.3 });
          V.burst('rocks', e.x, e.y - 6, e.tower ? 6 : 4, { s: 0.12, sp0: 120, sp1: 260, up: 160, g: 900 }); V.decal('crater1', e.x, e.y + 3, 4, 0.32 * big); shake(e.x, e.y, e.tower ? 7 : 4);
          V.fx('dust_ring', e.x, e.y + 3, { s0: 0.2, s1: 0.7 * big, life: 0.4, flat: 0.55, a: 0.8 });
        } else if (e.key === 'hearts') V.fx('pink_burst', e.x, e.y - 14, { s0: 0.12, s1: 0.34, life: 0.25 });
        else if (e.key === 'banana') {     // la banane dorée éclate en lumière sur l'animal qu'elle soigne
          snd('gold_heal', e.x, e.y, 0.7, { rate: rand(0.95, 1.08) });
          V.fx('pillar_gold', e.x, e.y - 30, { s0: 0.15, s1: 0.45, life: 0.6, a: 0.85 });
          V.fx('ring_yellow', e.x, e.y + 2, { s0: 0.15, s1: 0.6, life: 0.45, flat: 0.55, add: true });
          V.burst('star_big', e.x, e.y - 20, 6, { s: 0.12, sp0: 60, sp1: 180, up: 160, g: 300, add: true });
          for (let i = 0; i < 10; i++) { const an = rand(0, 6.283), sp = rand(30, 80); V.dot(e.x + Math.cos(an) * 6, e.y - 18, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.5 - rand(50, 110), g: 200, life: rand(0.5, 0.8), r: rand(1, 1.8), col: '255,222,110', add: true }); }
        }
        else if (WATER_LAND[e.key]) {     // bulles et boules d'eau des nageurs : ça éclabousse (et ça fait des ronds si c'est dans l'eau)
          const [n, v, k] = WATER_LAND[e.key];
          snd(n, e.x, e.y, v, { rate: rand(0.9, 1.15) }); droplets(e.x, e.y, k, e.key === 'wave' ? 1.3 : 0.9);
          if (e.key !== 'bubble') V.fx('ring_blue', e.x, e.y + 2, { s0: 0.15, s1: e.key === 'wave' ? 0.8 : 0.45, life: 0.4, flat: 0.55, a: 0.8 });
          if (e.swim || swimmable(e.x, e.y)) { V.ripple(e.x, e.y + 2, 10, 0.8, 0.7); V.ripple(e.x, e.y + 2, 18, 1.1, 0.45); }
        }
        break;
      case 'miss': V.fx('smoke_puff', e.x, e.y - 4, { s0: 0.08, s1: 0.2, life: 0.3, a: 0.6 }); break;
      case 'splash':
        if (e.water) {         // le jet d'eau de l'éléphant retombe
          V.fx('ring_blue', e.x, e.y + 2, { s0: 0.4, s1: RING(e.r, 70), life: 0.5, flat: 0.55 }); V.mapfx.ripple(e.x, e.y + 2);
          for (let i = 0; i < 12; i++) { const an = rand(0, 6.283), sp = rand(30, 90); V.dot(e.x + Math.cos(an) * 6, e.y - 6, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.5 - rand(60, 120), g: 420, life: rand(0.4, 0.7), r: rand(1.4, 2.4), col: '140,210,255' }); }
          snd('splash', e.x, e.y, 0.6); shake(e.x, e.y, 5);
        } else if (e.gust) { V.fx('tornado', e.x, e.y - 20, { s0: 0.3, s1: 0.85, life: 0.6, a: 0.9 }); V.fx('wind_leaves', e.x, e.y - 16, { s0: 0.3, s1: 0.9, life: 0.5 }); V.fx('dust_ring', e.x, e.y + 2, { s0: 0.3, s1: RING(e.r, 80), life: 0.4, flat: 0.55, a: 0.7 }); }
        else if (!e.tower) {
          V.fx('dust_ring', e.x, e.y + 3, { s0: 0.4, s1: RING(e.r, 100), life: 0.45, flat: 0.6, a: 0.9 });
          if (e.special) { V.decal('crater2', e.x, e.y + 4, 5, 0.6); V.burst('rocks', e.x, e.y - 6, 6, { s: 0.16, sp0: 160, sp1: 360, up: 220, g: 900 }); shake(e.x, e.y, 12); }
        }
        break;
      case 'heal':
        V.burst('heal_plus', e.x, e.y - 22, 2, { s: 0.1, sp0: 40, sp1: 100, up: 140, g: 0, life: 1.2 });
        if (b.ents.get(e.uid) && b.ents.get(e.uid).side === 0 && e.amount >= 20) V.text('+' + e.amount, e.x + 14, e.y - 36, { size: 20, tint: 'green', life: 0.8 });
        break;
      case 'regen': if (seen(e.x, e.y)) V.fx('heal_plus', e.x + rand(-8, 8), e.y - 30, { s0: 0.05, s1: 0.1, life: 0.8, vy: -50, a: 0.85 }); break;
      case 'shield': V.fx('shield', e.x, e.y - 34, { s0: 0.1, s1: 0.2, life: 0.6, vy: -20, a: 0.9 }); break;
      case 'shieldwave': V.fx('ring_green', e.x, e.y + 2, { s0: 0.3, s1: RING(e.r), life: 0.6, flat: 0.55, a: 0.9 }); V.burst('hearts', e.x, e.y - 24, 4, { s: 0.08, sp0: 60, sp1: 160, up: 120, g: 120, life: 1 }); break;
      case 'shield_break': V.burst('crystals', e.x, e.y - 24, 4, { s: 0.08, sp0: 80, sp1: 200, up: 120, g: 700 }); snd('hit', e.x, e.y, 0.35, { rate: 1.7 }); break;
      case 'guard':      // l'orang-outan se protège la tête : intouchable un moment
        V.fx('ring_yellow', e.x, e.y + 2, { s0: 0.25, s1: 0.75, life: 0.5, flat: 0.55, a: 0.95 });
        if (seen(e.x, e.y) && every('gd' + e.uid, 2)) V.text('INTOUCHABLE !', e.x, e.y - 70, { size: 24, tint: 'yellow', life: 1 });
        snd('shield', e.x, e.y, 0.55, { rate: 1.2 }); voice('orang', 0.5);
        break;
      case 'block': V.fx('star_big', e.x + rand(-8, 8), e.y - 36, { s0: 0.12, s1: 0.32, life: 0.2, add: true }); if (every('bk' + e.uid, 0.3)) snd('tower_hit', e.x, e.y, 0.3, { rate: 1.7 }); break;
      case 'roar': {     // le gorille hurle : ses coups grossissent à chaque cri
        V.fx('ring_red', e.x, e.y + 2, { s0: 0.3, s1: 1.1, life: 0.6, flat: 0.55, a: 0.95 });
        for (let i = 0; i < 16; i++) { const an = rand(0, 6.283), sp = rand(40, 130); V.dot(e.x + Math.cos(an) * 10, e.y - 30 + Math.sin(an) * 10, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.6 - 30, life: rand(0.4, 0.8), r: rand(1.2, 2.2), col: '255,60,30', add: true }); }
        if (seen(e.x, e.y)) V.text(e.n >= e.max ? 'RAGE MAX !' : 'RAGE x' + e.n, e.x, e.y - 80, { size: 28, tint: 'red', life: 1, pop: 1.4 });
        shake(e.x, e.y, 10); V.mapfx.excite(0.4);
        break;
      }
      case 'armor':      // la carapace du rhinocéros devient métal : il encaisse un peu mieux à chaque fois
        V.fx('shield', e.x, e.y - 44, { s0: 0.18, s1: 0.38, life: 0.8, vy: -20 });
        for (let i = 0; i < 6; i++) V.fx('star_big', e.x + rand(-26, 26), e.y - rand(10, 40), { s0: 0.05, s1: 0.16, life: 0.3, add: true, delay: i * 0.05 });
        if (seen(e.x, e.y)) V.text(e.n >= e.max ? 'ARMURE MAX !' : 'ARMURE x' + e.n, e.x, e.y - 76, { size: 26, tint: 'grey', life: 1 });
        snd('shield', e.x, e.y, 0.6, { rate: 0.8 });
        break;
      case 'stun': V.fx('dizzy_stars', e.x, e.y - 40, { s0: 0.15, s1: 0.3, life: 0.6 }); break;
      case 'slow':
        for (let i = 0; i < 5; i++) V.dot(e.x + rand(-12, 12), e.y - rand(8, 30), { vy: rand(10, 30), g: 80, life: 0.6, r: 1.6, col: '120,200,255' });
        if (seen(e.x, e.y) && every('sl' + e.uid, 2.5)) V.text('RALENTI', e.x, e.y - 60, { size: 20, tint: 'blue', life: 0.8 });
        break;
      case 'cloud': snd('poison', e.x, e.y, 0.6); V.fx('skull_green', e.x, e.y - 16, { s0: 0.2, s1: 0.5, life: 0.8, vy: -30 }); break;
      case 'poison': if (seen(e.x, e.y) && every('ps' + e.uid, 3)) V.text('POISON', e.x, e.y - 60, { size: 20, tint: 'green', life: 0.8 }); break;
      case 'charge': voice('rhino', 0.6); if (seen(e.x, e.y)) V.text('CHARGE !', e.x, e.y - 70, { size: 26, tint: 'orange', life: 0.8 }); break;
      case 'buff': V.fx('fire2', e.x, e.y - 26, { s0: 0.1, s1: 0.3, life: 0.5, vy: -60 }); break;
      case 'drink': {    // l'éléphant puise à la rivière : des gouttes montent jusqu'à sa trompe
        for (let i = 0; i < 7; i++) V.dot(e.wx + rand(-6, 6), e.wy + rand(-4, 4), { vx: rand(-40, 40), vy: rand(-90, -40), life: 0.8, r: rand(1.4, 2.2), col: '130,205,255', tx: e.x, ty: e.y - 34, delay: i * 0.05 });
        V.mapfx.ripple(e.wx, e.wy); snd('splash', e.x, e.y, 0.25, { rate: 1.4 });
        if (e.n >= 3 && seen(e.x, e.y)) V.text('PLEIN D\'EAU', e.x, e.y - 84, { size: 22, tint: 'blue', life: 0.9 });
        break;
      }
      case 'spray': {    // jet d'eau en cloche vers la cible
        const ent = b.ents.get(e.uid), fx0 = ent ? ent.fx : 0, x0 = e.x + fx0 * 22, y0 = e.y - 40, T = 0.32, gr = 520;
        for (let i = 0; i < 18; i++) {
          const tx = e.tx + rand(-10, 10), ty = e.ty - 8 + rand(-6, 6);
          V.dot(x0, y0, { vx: (tx - x0) / T + rand(-15, 15), vy: (ty - y0) / T - 0.5 * gr * T + rand(-15, 15), g: gr, life: T + 0.04, r: rand(1.6, 2.8), col: i % 3 ? '120,200,255' : '220,245,255', delay: i * 0.012 });
        }
        snd('splash', e.x, e.y, 0.7, { rate: 1.1 });
        break;
      }
      case 'crate_break': {     // la boîte éclate et révèle son bonus
        const ours = e.side === 0, y = e.y - 10, [big, small] = BONUS_TXT[e.bonus] || ['BONUS !', ''];
        snd('chest_thud', e.x, e.y, 0.8); snd('rock', e.x, e.y, 0.5, { at: 0.05, rate: 1.3 });
        V.fx('explosion1', e.x, y - 6, { s0: 0.3, s1: 0.85, life: 0.45 });
        V.burst('planks', e.x, y, 7, { s: 0.16, sp0: 140, sp1: 380, up: 260, g: 1000 });
        V.burst('star_big', e.x, y - 10, 8, { s: 0.16, sp0: 120, sp1: 320, up: 140, g: 400, add: true });
        V.fx('dust_ring', e.x, e.y + 8, { s0: 0.3, s1: 1.2, life: 0.5, flat: 0.5, a: 0.85 });
        if (e.bonus === 'fruit') { V.fx('ring_green', e.x, e.y + 6, { s0: 0.3, s1: RING(BONUS_FX.fruitR * TILE), life: 0.7, flat: 0.55, add: true }); V.burst('heal_plus', e.x, y - 10, 6, { s: 0.12, sp0: 60, sp1: 180, up: 160, g: 60, life: 1.3 }); V.burst('hibiscus', e.x, y, 3, { s: 0.12, sp0: 80, sp1: 200, up: 200, g: 700 }); snd('heal', e.x, e.y, 0.7); }
        else if (e.bonus === 'rage') { V.fx('ring_red', e.x, e.y + 6, { s0: 0.3, s1: RING(BONUS_FX.rageR * TILE), life: 0.7, flat: 0.55, add: true }); V.fx('fire2', e.x, y - 16, { s0: 0.3, s1: 0.8, life: 0.6, vy: -50 }); snd('slam', e.x, e.y, 0.7); }
        else if (e.bonus === 'aura') { V.fx('pillar_purple', e.x, y - 30, { s0: 0.3, s1: 0.8, life: 0.8 }); V.burst('gem_purple', e.x, y - 10, 4, { s: 0.12, sp0: 80, sp1: 200, up: 220, g: 600 }); snd('surge', e.x, e.y, 0.6); }
        else { V.fx('pillar_gold', e.x, y - 30, { s0: 0.3, s1: 0.85, life: 0.8 }); snd('new_card', e.x, e.y, 0.45); }
        V.text(big, e.x, y - 40, { size: 30, tint: ours ? 'yellow' : 'red', life: 1.5, vy: -40, pop: 1.3 });
        if (ours) { if (small && seen(e.x, e.y)) say(small, 2.2); } else if (!seen(e.x, e.y)) V.ping(e.x, e.y, '#ff6a5a');
        if (ours && !seen(e.x, e.y)) V.ping(e.x, e.y, '#ffd23f');
        shake(e.x, e.y, 8); V.mapfx.excite(0.5);
        break;
      }
      case 'crate_spawn': if (seen(e.x, e.y)) { V.fx('smoke_puff', e.x, e.y - 10, { s0: 0.2, s1: 0.6, life: 0.5, a: 0.8 }); V.burst('star_big', e.x, e.y - 20, 4, { s: 0.1, sp0: 60, sp1: 160, up: 100, g: 200, add: true }); snd('chest_land', e.x, e.y, 0.3); } break;
      case 'tower_take': {      // la tour change de camp : son singe lance désormais ses pierres pour le camp qui l'a prise
        const ours = e.side === 0, top = e.topY;
        snd('tower_down', e.x, e.y, 0.9); play('crown', { at: 0.35, v: 0.8 }); voice('monkey', 0.85);
        V.fx('explosion2', e.x, top - 6, { s0: 0.4, s1: 1.2, life: 0.7 }); V.fx('explosion1', e.x + 20, top - 20, { s0: 0.3, s1: 0.8, life: 0.6, delay: 0.12 });
        V.burst('planks', e.x, top, 8, { s: 0.2, sp0: 160, sp1: 420, up: 260, g: 1000 }); V.burst('rocks', e.x, top, 6, { s: 0.16, sp0: 160, sp1: 400, up: 260, g: 1000 });
        V.burst('star_big', e.x, top - 10, 12, { s: 0.22, sp0: 200, sp1: 520, up: 200, g: 500, add: true });
        V.fx(ours ? 'ring_blue' : 'ring_red', e.x, top + 26, { s0: 0.3, s1: 1.6, life: 0.55, flat: 0.5, a: 0.9, add: true });
        V.fx('crown_burst', e.x, top - 40, { s0: 0.2, s1: 0.6, life: 1.3, vy: -50, delay: 0.3 });
        shake(e.x, e.y, 22); if (seen(e.x, e.y)) { V.flash = 0.3; V.flashColor = ours ? '150,210,255' : '255,110,90'; }
        V.banner(ours ? 'TOUR PRISE !' : e.was === 0 ? 'TOUR PERDUE !' : 'TOUR ADVERSE !', { size: 104, tint: ours ? 'yellow' : 'red', life: 1.5, y: 640, delay: 0.2 });
        if (ours) V.banner('Tu peux poser tes animaux à côté', { size: 40, tint: 'white', life: 1.8, y: 735, delay: 0.45 });
        V.ping(e.x, e.y, ours ? '#5ac8ff' : '#ff5a4a'); V.mapfx.excite(1.4);
        break;
      }
      case 'death': {
        snd('ko', e.x, e.y, 0.7);
        const y = e.y - (e.air ? LIFT : 0), big = BIG[e.id] ? 1.25 : 1;
        if (e.swim) {        // un nageur K.-O. coule (la vue le fait couler dans des bulles) : gerbe d'eau
          snd('splash', e.x, e.y, 0.55, { rate: 0.8 }); droplets(e.x, e.y, 16, 1.2);
          V.fx('ring_blue', e.x, e.y + 2, { s0: 0.25, s1: 0.75, life: 0.55, flat: 0.55, a: 0.85 });
        } else {
          V.fx('ko_cloud', e.x, y - 22 * big, { s0: 0.22, s1: 0.56 * big, life: 0.7, fade: 0.3 });
          for (let i = 0; i < 5; i++) { const an = rand(0, 6.283); V.fx('smoke_puff', e.x + Math.cos(an) * 8, y - 12 + Math.sin(an) * 5, { vx: Math.cos(an) * rand(50, 120), vy: Math.sin(an) * rand(30, 70) - 40, s0: 0.14, s1: 0.4 * big, life: rand(0.4, 0.65), a: 0.7, fade: 0.6, delay: 0.04 }); }
        }
        V.burst('star_big', e.x, y - 16, 5, { s: 0.16, sp0: 120, sp1: 300, up: 120, g: 500, add: true });
        if (e.air) V.burst('feather' + (1 + Math.floor(Math.random() * 3)), e.x, y - 22, 4, { s: 0.16, sp0: 40, sp1: 140, up: 60, g: 120, life: 1.6 });
        if (e.side === 1) V.fx('paw_burst', e.x, y - 38, { s0: 0.16, s1: 0.36, life: 0.8, vy: -110, fade: 0.3 });
        else if (!seen(e.x, e.y)) V.ping(e.x, e.y, '#ff5a4a');
        V.mapfx.excite(0.35);
        break;
      }
      // ---- la boîte dorée et son singe (src/game/rt.js, GOLD) ----
      case 'gold_drop': {      // elle tombe du ciel (la vue la fait tomber en une demi-seconde) du côté du camp mené
        const ours = e.side === 0;
        snd('gold_appear', e.x, e.y, 0.9); snd('chest_land', e.x, e.y, 0.7, { at: 0.5 });
        V.fx('pillar_gold', e.x, e.y - 60, { s0: 0.4, s1: 1.3, life: 1.1, a: 0.9 });
        V.fx('dust_ring', e.x, e.y + 4, { s0: 0.3, s1: 1.2, life: 0.5, flat: 0.5, a: 0.85, delay: 0.5 });
        V.burst('star_big', e.x, e.y - 30, 12, { s: 0.18, sp0: 120, sp1: 340, up: 180, g: 400, add: true, delay: 0.5 });
        V.banner('BOÎTE DORÉE !', { size: 100, tint: 'yellow', life: 1.8, y: 620 });
        V.banner(ours ? 'Casse-la : un singe doré t\'aidera !' : 'Elle est tombée chez l\'adversaire', { size: 36, tint: 'white', life: 2.2, y: 712, delay: 0.3 });
        V.ping(e.x, e.y, '#ffd23f'); V.mapfx.excite(1.2); shake(e.x, e.y, 8);
        if (ours && !B.guide) say('Touche un animal, puis la boîte dorée', 3.4);
        break;
      }
      case 'gold_break': {     // elle éclate : le singe doré en sort, pour le camp qui l'a cassée
        const ours = e.side === 0;
        snd('gold_break', e.x, e.y, 1); play('v_goldmonkey', { at: 0.35, v: 0.8 });
        V.fx('explosion1', e.x, e.y - 30, { s0: 0.3, s1: 0.9, life: 0.5 });
        V.fx('pillar_gold', e.x, e.y - 50, { s0: 0.3, s1: 1.2, life: 0.9 });
        V.fx('ring_yellow', e.x, e.y + 4, { s0: 0.3, s1: 1.5, life: 0.6, flat: 0.5, add: true });
        V.burst('star_big', e.x, e.y - 30, 16, { s: 0.22, sp0: 160, sp1: 460, up: 220, g: 500, add: true });
        V.burst('planks', e.x, e.y - 20, 6, { s: 0.15, sp0: 120, sp1: 340, up: 240, g: 1000 });
        for (let i = 0; i < 24; i++) { const an = rand(0, 6.283), sp = rand(60, 180); V.dot(e.x, e.y - 26, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.6 - rand(60, 140), g: 260, life: rand(0.6, 1.1), r: rand(1.1, 2), col: '255,215,90', add: true }); }
        shake(e.x, e.y, 14); V.flash = 0.25; V.flashColor = '255,225,120'; V.mapfx.excite(1.4);
        V.banner('SINGE DORÉ !', { size: 96, tint: ours ? 'yellow' : 'red', life: 1.7, y: 620, delay: 0.2 });
        V.banner(ours ? 'Ses bananes soignent tes animaux' : 'Il soigne tes adversaires : vite !', { size: 36, tint: 'white', life: 2.2, y: 712, delay: 0.45 });
        V.ping(e.x, e.y, '#ffd23f');
        break;
      }
      case 'gold_throw':
        snd('swish', e.x, e.y, 0.45, { rate: 1.45 });
        if (every('gmv', 3.2)) snd('v_goldmonkey', e.x, e.y, 0.5, { rate: rand(1.05, 1.2) });
        break;
      case 'gold_done': if (seen(e.x, e.y)) V.text('Plus de bananes !', e.x, e.y - 80, { size: 22, tint: 'yellow', life: 1.1 }); break;
      case 'gold_bye':         // il repart comme il est venu : un éclat doré
        snd('whoosh', e.x, e.y, 0.5, { rate: 1.4 });
        V.fx('smoke_puff', e.x, e.y - 20, { s0: 0.2, s1: 0.6, life: 0.5, a: 0.8 });
        V.burst('star_big', e.x, e.y - 24, 8, { s: 0.14, sp0: 80, sp1: 240, up: 160, g: 300, add: true });
        break;
      case 'double': V.banner('AURA x2 !', { size: 120, tint: 'pink', life: 1.8, y: 680 }); play('surge'); V.mapfx.excite(1); break;
      case 'overtime':
        V.banner('MORT SUBITE !', { size: 104, tint: 'orange', life: 2.2, y: 650 }); V.banner('Le premier camp touché perd', { size: 42, tint: 'white', life: 2.2, y: 750, delay: 0.3 });
        play('overtime'); V.mapfx.excite(1.6);
        break;
      case 'order':
        if (e.side === 0) {
          if (e.home) { play('whistle'); V.banner('', { img: 'order_whistle', life: 1.1, y: 1250, s: 0.62 }); }
          else if (e.free) play('horn', { v: 0.5, rate: 1.25 });
          else if (e.ref) { play('target', { v: 0.8 }); V.banner('', { img: 'order_attack', life: 0.9, y: 1250, s: 0.5 }); }
          else play('swish', { v: 0.5, rate: 0.9 });
        } else if (e.home) play('whistle', { v: 0.3, rate: 1.15 });
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
  const b = B.b, frozen = !!B.frozen && !b.over;          // figé : Barnabé explique (tutoriel)
  if (B.intro > 0) { B.intro -= dt; if (B.intro <= 0) V.lookAt(MAP_W / 2, MAP_H, ZOOM.start); }
  if (!frozen) {
    B.acc += dt;
    let n = 0;
    while (B.acc >= TICK && n < 5) {
      B.acc -= TICK; n++;
      aiStep(b, B.ai, TICK);
      step(b);
      if (b.events.length) { onEvents(b.events); b.events.length = 0; }
    }
    if (n >= 5) B.acc = 0;
  }
  // nos animaux tombés quittent le choix
  for (const id of U.picked) { const u = b.ents.get(id); if (!u || u.dead) U.picked.delete(id); }
  if (U.mode && !U.picked.size && !U.pickNew) U.pickNew = true;
  // la carte lancée glisse encore un peu
  if (U.fling) { V.panBy(U.fling.vx * dt, U.fling.vy * dt); const k = Math.pow(0.02, dt); U.fling.vx *= k; U.fling.vy *= k; if (Math.hypot(U.fling.vx, U.fling.vy) < 20) U.fling = null; }
  // une carte ou une flèche tenue près du bord fait défiler l'arène. Sur les côtés, plus on la tient au bord, plus ça va
  // vite (la flèche d'un ordre d'attaque surtout : sa cible peut être à l'autre bout de l'arène) ; près du bord du haut aussi.
  const edge = U.drag && U.drag.onField ? U.drag.p : U.aim && U.g && U.g.p ? U.g.p : null;
  let held = false;
  if (edge) {
    const aim = !U.drag, m = aim ? 130 : 100, base = (aim ? 720 : 560) * dt;
    const boost = 1 + (aim ? 2.6 : 1.4) * Math.min(1, U.edgeT / 0.7);      // jusqu'à 3,6 fois plus vite (2,4 avec une carte)
    let dx = 0, dy = 0;
    if (edge.x < m) dx = base * boost * (1 - edge.x / m); else if (edge.x > W - m) dx = -base * boost * (1 - (W - edge.x) / m);
    if (edge.y < 260) dy = base * Math.min(1, (260 - edge.y) / 160);
    if (dx) { held = true; U.edgeT += dt; }
    if (dx || dy) { V.panBy(dx, dy); if (U.drag) cardMove(U.drag, edge); else aimAt(edge); }
  }
  if (!held) U.edgeT = 0;
  // le bruit de la rivière, plus fort quand la caméra est près de l'eau ; les roues des catapultes qui roulent
  if (B.amb && every('amb', 0.25)) B.amb.set(b.over ? 0.12 : 0.3 + 0.08 * clamp((V.cam.z - ZOOM.min) / (ZOOM.max - ZOOM.min), 0, 1));
  for (const k of frozen ? [] : b.catas) {
    if (k.moving && every('roll' + k.side, 2.4)) snd('cata_roll', k.x, k.y, 0.5);
    else if (k.dead) {           // le singe tape pour la réparer : un coup de marteau à chaque coup dessiné (drawMonkey, src/render/view.js)
      const ph = (V.time * 2.8 + k.side * 0.3) % 1, was = B.ham[k.side]; B.ham[k.side] = ph;
      if (was < 0.55 && ph >= 0.55 && seen(k.x, k.y)) snd('hammer', k.x, k.y, 0.32, { rate: rand(0.92, 1.1) });
    }
  }
  if (B.cataGlow > 0) B.cataGlow -= dt;
  if (B.guide && !b.over) B.guide.tick(dt);
  // les dix dernières secondes : tic-tac, la foule s'enflamme
  const sec = Math.ceil(b.clock);
  if (!b.over && sec !== B.sec) {
    B.sec = sec;
    if (sec <= 10 && sec > 0) { play('tick', { v: 0.5 + 0.05 * (10 - sec) }); V.mapfx.excite(0.6 + 0.08 * (10 - sec)); }
    if (sec === 30 && !b.overtime) { V.banner('30 SECONDES !', { size: 84, tint: 'orange', life: 1.4, y: 620 }); play('horn', { v: 0.5 }); }
  }
  if (U.hintT > 0) { U.hintT -= dt; if (U.hintT <= 0) U.hint = ''; }
  if (U.zoneT > 0) { U.zoneT -= dt; if (U.zoneT <= 0) U.zoneSwim = false; }
  if (B.tips.length && !U.hint && b.t >= B.tips[0][0] && !b.over) say(B.tips.shift()[1], 3.2);
  const zone = !!(U.drag && U.drag.onField) || U.sel >= 0 || U.zoneT > 0;
  V.draw(dt, b, { alpha: B.acc / TICK, drag: U.drag, sel: U.drag ? U.drag.slot : U.sel, opp: B.opp, hint: U.hint, zone, zoneSwim: zone && (U.drag || U.sel >= 0 ? swimCard() : U.zoneSwim), mode: U.mode, picked: U.picked, aim: U.aim, hover: U.hover, cataGlow: B.cataGlow > 0, frozen });
  if (b.over && !B.endShown) {
    if (!B.party) {
      B.party = true; U.sel = -1; U.drag = null; setMode(false); U.hint = '';
      const win = b.winner === 0, draw = b.winner === -1;
      music(null);
      if (b.why === 'camp') V.lookAt(MAP_W / 2, win ? 310 : 1275, 1.3);      // le camp qui vient de tomber
      else V.lookAt(MAP_W / 2, MAP_H, ZOOM.min);         // toute l'arène
      if (b.why === 'camp') V.banner(win ? 'CAMP DÉTRUIT !' : 'TON CAMP EST TOMBÉ', { size: 90, tint: win ? 'blue' : 'red', life: 1.2, y: 560 });
      if (win) { sfx.win(); for (let i = 0; i < 4; i++) V.burst('confetti', rand(150, 790), rand(250, 500), 10, { s: 0.5, sp0: 120, sp1: 420, up: 300, g: 420, life: 2.2, delay: i * 0.12, top: true }); V.burst('star_big', 470, 700, 14, { s: 0.4, sp0: 200, sp1: 520, up: 200, life: 1.6, top: true }); }
      else if (!draw) sfx.lose(); else play('overtime', { v: 0.6 });
      V.banner(win ? 'VICTOIRE !' : draw ? 'ÉGALITÉ' : 'DÉFAITE', { size: 140, tint: win ? 'yellow' : draw ? 'white' : 'red', life: 2.4, y: 700, delay: b.why === 'camp' ? 0.5 : 0 });
      V.mapfx.excite(1.6);
    }
    if (b.endT > (TEST ? 0.3 : 2.8)) { B.endShown = true; finish(); }
  }
}

// ---------- fin du combat ----------
function finish() {
  const b = B.b, ranked = B.mode === 'ranked', res = summary(b, 0);
  if (B.amb) { B.amb.stop(); B.amb = null; }
  if (B.mode === 'demo') {        // combat du tutoriel : ni trophées ni récompenses ici, le tutoriel prend la suite (coffre en bois)
    const guide = B.guide; leave(false);
    if (guide) guide.done(res); else showMenu('main');
    return;
  }
  S.cataFights = (S.cataFights || 0) + 1;      // pour les astuces des catapultes (voir tipsFor)
  const out = applyFight(res, B.opp, ranked);
  if (B.opp.uid) Net.report(B.opp.uid, res.win, !ranked);
  Net.pushProfile();
  showEnd(res, out, ranked);
}
const WHY = { camp: 'Camp détruit !', time: 'Fin du temps', overtime: 'Mort subite', tie: 'Égalité : départage aux tours, puis aux K.-O.', forfeit: 'Abandon' };
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
  // pourcentages entiers, sauf si les deux nombres ont le même entier (on montre alors la décimale qui les départage)
  const same = Math.floor(res.gauge) === Math.floor(res.foeGauge) && res.gauge !== res.foeGauge, pc = (g) => (same ? String(g.toFixed(1)).replace('.', ',') : Math.floor(g)) + ' %';
  // gauge = part du camp adverse détruite, foeGauge = part du nôtre
  const extra = [`Camps détruits à <span class="blue">${pc(res.gauge)}</span> contre <span class="bad">${pc(res.foeGauge)}</span> · ${WHY[res.why] || ''}`];
  const bits = [];
  if (res.shots) bits.push(res.shots > 1 ? res.shots + ' tirs de catapulte' : '1 tir de catapulte');
  if (res.breaks) bits.push(res.breaks > 1 ? res.breaks + ' catapultes cassées' : '1 catapulte cassée');
  if (res.towers) bits.push(res.towers > 1 ? res.towers + ' tours tenues' : '1 tour tenue');
  if (res.crates) bits.push(res.crates > 1 ? res.crates + ' boîtes cassées' : '1 boîte cassée');
  if (res.kos) bits.push(res.kos + ' K.-O.');
  if (bits.length) extra.push(bits.join(' · '));
  if (!ranked) extra.push('Combat amical : ni trophées ni coffre');
  if (r.streakBonus) extra.push(`Série de ${out.streak} victoires : +${fmt(r.streakBonus)}<i class="ico coin"></i>`);
  if (out.firstWin) extra.push('Première victoire du jour : +5<i class="ico ruby"></i>');
  if (out.full) extra.push('<span class="bad">Tes 4 emplacements de coffres sont pleins !</span>');
  if (!win && !res.draw) extra.push(S.lossRun >= 2 ? 'Astuce : améliore tes animaux dans la Collection.' : !res.shots ? 'Astuce : envoie ta catapulte au centre, elle tirera sur le camp adverse !'
    : res.towers === 0 ? 'Astuce : prends une tour, son singe lancera des pierres pour toi !' : !res.breaks ? 'Astuce : casse la catapulte adverse quand elle vient au centre !' : 'Astuce : passe par un flanc pour surprendre le camp adverse !');
  const chestEl = out.chest ? h('div', { class: 'end-chest' }, h('img', { src: chestIcon(out.chest.tier), alt: '' }), h('div', { class: 't sm' }, CHESTS[out.chest.tier].name + ' gagné !')) : null;
  const el = h('div', { class: 'veil end' }, h('div', { class: 'end-top t', html: lines.join('   ') }), panel, chestEl, h('div', { class: 'end-extra t xs', html: extra.join('<br>') }));
  $('modals').append(el);
  let closed = false;
  const STARS = [[235, 389, 133, 135], [364, 355, 157, 138], [514, 390, 132, 125]];    // les étoiles claquent une à une
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
    xpFrom([470, 900]);       // de retour au menu, l'XP du combat file vers la jauge (src/ui/xpbar.js)
    leave();
    (async () => {
      if (out.ups.length) await xpSettled();
      for (const u of out.ups) celebrate('Niveau ' + u.level + ' atteint !', null, `Récompense : ${rewardHtml({ coins: u.coins, rubies: u.rubies })}`);
      if (out.arenaUp) celebrate(ARENAS[out.arenaUp - 1].name + ' débloquée !', null, `Arène ${out.arenaUp} : nouvelle ambiance, nouvelle musique et des coffres plus riches.`);
    })();
    if (r.coins) fly('coin', [470, 900], TARGET.coin, 10, (i) => sfx.coin(i));
    if (r.paws) fly('paw', [470, 900], TARGET.paw, 6);
    if (r.rubies) fly('ruby', [470, 900], TARGET.ruby, 3);
  }
}
function leave(menu = true) {
  if (B && B.amb) B.amb.stop();
  cancelAnimationFrame(raf); raf = 0; B = null; busy = false;
  $('scrBattle').hidden = true; $('bHud').textContent = '';
  if (menu) showMenu('main');
}
// Le murmure de la rivière pendant tout le combat (src/core/audio.js, ambience)
function startAmbience() { B.amb = ambience('river', 0.3); }
export const battleState = () => B;      // pour les tests automatiques
export const battleView = () => V;
export const battleUi = () => U;
