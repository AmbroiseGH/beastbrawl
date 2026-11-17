// Le moteur des combats en temps réel sur la grande arène : deux camps (0 = bleu, en bas ; 1 = rouge, en haut), de
// l'Aura qui se recharge, des animaux posés depuis une main de 4 cartes. Deux façons de gagner (b.mode) :
//   - « camps » : détruire le camp adverse (la tente, gardée par un lanceur de pierres) ; la machine du centre est une
//     catapulte : la frapper charge un tir sur le camp adverse ; le camp le plus abîmé recharge plus vite son Aura ;
//   - « jauge » (l'ancien mode) : frapper la cible du centre remplit sa jauge et vide celle de l'adversaire.
// Dans les deux modes :
//   - les deux tours latérales : casser la cage libère un orang-outan qui bombarde les animaux adverses ;
//   - les boîtes : les casser donne un bonus tiré au sort (allié en plus, fruits, rage, Aura).
// Pas de dessin ici : le moteur avance par pas fixes et range dans b.events ce qui s'est passé, pour que l'affichage
// et les sons suivent. Coordonnées : pixels de la carte (1536 × 1024), y vers le bas. Rien d'aléatoire hors de b.rng.
import { ANIMALS, statsAt, STRUCTS, levelK } from '../data/animals.js';
import { makeRng } from '../core/rng.js';
import { MAP_W, MAP_H, CRATES, CELL } from '../data/map.js';
import { zoneAt, walkable, nearest, findPath, los, waterNear } from './nav.js';

export const TICK = 1 / 30;
export const TILE = 28;                         // une case, en pixels de la carte
export const WS = TILE / 52;                    // taille des animaux : pixels de leur planche → pixels de la carte
export const DURATION = 180, OVERTIME = 60, DOUBLE_AT = 60;
export const AURA = { start: 5, max: 10, every: 2.8 };
export const DEPLOY_DELAY = 1;                  // temps d'arrivée d'un animal posé (s)
export const BASE = [{ x: 767, y: 800 }, { x: 767, y: 190 }];      // point de ralliement devant chaque tente
export const HOME_ZONE = [2, 1];                // zone de pose de chaque camp (voir la grille de src/data/map.js)
const SIDE_ZONE = { L: 3, R: 4 };
const TOWER_POS = { L: { x: 163, y: 455, topY: 372 }, R: { x: 1373, y: 455, topY: 372 } };
export const AIR_H = 30;                        // hauteur de vol
const REGEN = { r: 4.5, rate: 0.06, calm: 2 };  // près de sa tente, un animal qui n'est plus frappé récupère
const HOLD_LEASH = 2.6;                         // un animal posté ne poursuit pas plus loin (cases)
const BONUS = [['monkey', 22], ['kitten', 18], ['fruit', 25], ['rage', 25], ['aura', 10]];
export const BONUS_FX = { fruitR: 4, fruit: 0.35, rageR: 4, rage: { dmg: 0.5, speed: 0.3, dur: 8 }, aura: 2 };
// Mode « camps » (réglages venus des simulations de l'audit du 17/11/2026)
export const CAMPS = {
  hp: 4000,                                                          // vie d'un camp (fois le niveau des decks)
  guard: { dmg: 120, hitEvery: 1.5, range: 5.5, splash: 0.9, splashMult: 0.5, knock: 0.15 },   // le garde lance des pierres sur qui approche
  catapult: { fill: 4000, hit: 0.12, catchup: 15 },                 // dégâts sur la machine pour une charge ; part de la vie du camp adverse par tir ;
                                                                     // retard (points) qui fait charger deux fois plus vite
  aura: 80,                                                          // retard (points) qui fait recharger l'Aura deux fois plus vite (+50 % à mi-chemin)
};
// centre du camp (ellipse rx 110, ry 40), point visé par les coups, hauteur d'où le garde lance (voir GUARD dans src/render/view.js)
export const CAMP_POS = [{ x: 767, y: 868, aimY: 846, topY: 812 }, { x: 767, y: 88, aimY: 112, topY: 92 }];
// Retard d'un camp, en points : part de vie perdue par son camp moins celle du camp adverse (0 s'il mène)
export function behind(b, side) {
  if (!b.camps) return 0;
  const m = b.camps[side], f = b.camps[1 - side];
  return Math.max(0, 100 * (f.hp / f.maxHp - m.hp / m.maxHp));
}
// But d'un animal sans ordre ni ennemi en vue : le camp adverse, ou la cible du centre dans l'ancien mode
const goal = (b, u) => (b.camps ? b.camps[1 - u.side] : b.machine);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// distance de bord à bord entre un animal et une cible (les structures sont des ellipses)
function edge(u, e) {
  if (e.rx) { const q = Math.hypot((u.x - e.x) / e.rx, (u.y - e.y) / e.ry); return (q - 1) * Math.min(e.rx, e.ry) - u.r; }
  return Math.hypot(u.x - e.x, u.y - e.y) - u.r - e.r;
}
const ev = (b, e) => b.events.push(e);

// ---------- création ----------
// decks : [[{ id, level }…], […]] ; towerLevels : niveau moyen de chaque deck ; seed : graine du combat ;
// mode : 'camps' (détruire le camp adverse) ou 'jauge' (l'ancien mode de la jauge du centre)
export function createBattle({ decks, towerLevels = [1, 1], seed = 1, mode = 'jauge' }) {
  const rng = makeRng(seed);
  const lv = [towerLevels[0] || 1, towerLevels[1] || 1], lvK = (levelK(lv[0]) + levelK(lv[1])) / 2;
  const b = { t: 0, clock: DURATION, overtime: false, double: false, over: false, winner: -1, endT: 0, why: '', mode: mode === 'camps' ? 'camps' : 'jauge', camps: null,
    units: [], structs: [], towers: [], crates: [], machine: null, projs: [], clouds: [], events: [], ents: new Map(), nextId: 1, rng, players: [],
    levels: lv, lvK, gaugeHp: STRUCTS.gauge.hp * lvK };
  for (let s = 0; s < 2; s++) {
    const cards = decks[s].filter((c) => ANIMALS[c.id]).map((c) => ({ id: c.id, level: c.level || 1, cost: ANIMALS[c.id].cost }));
    const order = cards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const hand = [0, 1, 2, 3].map(() => (order.length ? order.shift() : -1));
    b.players.push({ side: s, cards, hand, queue: order, aura: AURA.start, gauge: 0, kos: 0, spent: 0, played: 0, crates: 0, towers: 0 });
  }
  const add = (o) => { o.id = b.nextId++; o.dead = false; o.air = false; b.structs.push(o); b.ents.set(o.id, o); return o; };
  b.machine = add({ kind: 'machine', side: -1, x: 767, y: 486, rx: 66, ry: 48, aimX: 767, aimY: 512, hp: 1, maxHp: 1 });
  for (const lane of ['L', 'R']) {
    const P = TOWER_POS[lane], hp = Math.round(STRUCTS.tower.hp * lvK);
    b.towers.push(add({ kind: 'tower', lane, side: -1, x: P.x, y: P.y, rx: 85, ry: 128, aimX: P.x, aimY: P.y - 20, topY: P.topY, hp, maxHp: hp, taken: 0, cd: 0, shotT: 9, target: 0 }));
  }
  if (b.mode === 'camps') {
    b.camps = [0, 1].map((s) => { const P = CAMP_POS[s], hp = Math.round(CAMPS.hp * lvK); return add({ kind: 'camp', side: s, x: P.x, y: P.y, rx: 110, ry: 40, aimX: P.x, aimY: P.aimY, topY: P.topY, hp, maxHp: hp, cd: 0, target: 0 }); });
    b.gaugeHp = CAMPS.catapult.fill * lvK;          // les jauges deviennent la charge de chaque catapulte
  }
  CRATES.forEach(([x, y], i) => {
    const hp = Math.round(STRUCTS.crate.hp * lvK);
    b.crates.push(add({ kind: 'crate', n: i, side: -1, x, y: y - 20, rx: 44, ry: 24, aimX: x, aimY: y - 30, hp, maxHp: hp, respawnT: 0 }));
  });
  return b;
}
export const handOf = (b, side) => b.players[side].hand.map((i) => (i >= 0 ? b.players[side].cards[i] : null));
export const nextOf = (b, side) => { const p = b.players[side]; const i = p.queue[0]; return i === undefined ? null : p.cards[i]; };

// ---------- où peut-on poser ? ----------
// Zones de pose d'un camp : sa zone, plus la zone latérale de chaque tour qu'il tient
export function deployZones(b, side) {
  const z = [HOME_ZONE[side]];
  for (const t of b.towers) if (t.side === side) z.push(SIDE_ZONE[t.lane]);
  return z;
}
const inCrate = (b, x, y, pad = 0) => b.crates.some((c) => !c.dead && Math.hypot((x - c.x) / (c.rx + pad), (y - c.y) / (c.ry + pad)) < 1);
export function canDeploy(b, side, x, y) { return deployZones(b, side).includes(zoneAt(x, y)) && !inCrate(b, x, y, 4); }
// Point de pose le plus proche dans une zone autorisée (pour l'IA et le doigt qui déborde)
export function clampDeploy(b, side, x, y) {
  const p = nearest(x, y, deployZones(b, side)) || { ...BASE[side] };
  for (const c of b.crates) if (!c.dead) {
    const q = Math.hypot((p.x - c.x) / (c.rx + 6), (p.y - c.y) / (c.ry + 6));
    if (q < 1) { const k = 1.05 / Math.max(0.05, q); p.x = c.x + (p.x - c.x || 1) * k; p.y = c.y + (p.y - c.y || 1) * k; }
  }
  return walkable(p.x, p.y) ? p : nearest(p.x, p.y, deployZones(b, side)) || { ...BASE[side] };
}

// Pose la carte n° slot de la main. Renvoie '' si c'est fait, sinon la raison ('aura', 'zone', 'carte', 'fini').
export function deploy(b, side, slot, x, y) {
  if (b.over) return 'fini';
  const p = b.players[side], ci = p.hand[slot]; if (ci === undefined || ci < 0) return 'carte';
  const card = p.cards[ci];
  if (p.aura < card.cost) return 'aura';
  if (!canDeploy(b, side, x, y)) return 'zone';
  p.aura -= card.cost; p.spent += card.cost; p.played++;
  p.queue.push(ci); p.hand[slot] = p.queue.shift();
  const made = spawn(b, side, card.id, card.level, x, y);
  // posé au pied d'une boîte ou d'une tour à prendre : il s'en occupe d'abord
  let near = null, nd = 3.5 * TILE;
  for (const s of b.structs) { if (s.dead || s.kind === 'machine' || ((s.kind === 'tower' || s.kind === 'camp') && s.side === side)) continue; const d = edge({ x, y, r: 0 }, s); if (d < nd) { nd = d; near = s; } }
  if (near) for (const u of made) u.order = { ref: near.id, auto: true };
  ev(b, { type: 'deploy', side, id: card.id, x, y, cost: card.cost, ids: made.map((u) => u.id) });
  return '';
}
const FORM = { 1: [[0, 0]], 2: [[-0.55, 0.1], [0.55, -0.1]], 3: [[0, -0.5], [-0.55, 0.4], [0.55, 0.4]] };
function spawn(b, side, id, level, x, y, delay = DEPLOY_DELAY, count = 0) {
  const s = statsAt(id, level), n = count || s.count || 1, out = [];
  for (const [ox, oy] of FORM[n] || FORM[1]) {
    let ux = x + ox * TILE, uy = y + oy * TILE;
    if (!s.air && !walkable(ux, uy)) { ux = x; uy = y; }
    const u = { id: b.nextId++, kind: 'unit', side, aid: id, level, s, x: ux, y: uy, px: ux, py: uy, r: s.radius * TILE, air: !!s.air, mass: s.mass,
      hp: s.hp, maxHp: s.hp, spawn: delay, target: 0, retarget: 0, atk: null, atkT: 0, hitDone: true, cd: 0, count: 0,
      fx: 0, fy: side === 0 ? -1 : 1, moving: false, stun: 0, kx: 0, ky: 0, kt: 0, buffT: 0, buff: null, run: 0, charging: false, chargeHit: false,
      order: null, path: null, pathT: 0, healing: false, shield: 0, shieldT: 0, slowT: 0, slowK: 0, poison: null, rage: 0, plate: 0, plateT: 0,
      guardT: 0, guardCd: 0, water: 0, waterT: 0, hurtT: 9, regenT: 0, dead: false, deadT: 0 };
    b.units.push(u); b.ents.set(u.id, u); out.push(u);
  }
  return out;
}

// ---------- ordres ----------
// Donne un ordre aux animaux « ids » du camp « side ». o : { ref } attaquer cette cible (animal adverse, boîte, tour, cible),
// { x, y } aller à cet endroit et le tenir, { home: true } revenir à la tente, null : reprendre sa liberté.
// Renvoie le nombre d'animaux qui ont pris l'ordre.
export function command(b, side, ids, o) {
  if (b.over) return 0;
  let ref = 0;
  if (o && o.ref) { const e = b.ents.get(o.ref); if (!e || e.dead || e.side === side) return 0; ref = e.id; }
  let n = 0;
  for (const id of ids) {
    const u = b.ents.get(id); if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
    if (ref) { if (!canHit(u, b.ents.get(ref))) continue; u.order = { ref }; }
    else if (o && o.home) u.order = { home: true };
    else if (o && o.x !== undefined) {
      // chacun sa place autour du point : le premier au centre, les suivants en couronne
      const k = n === 0 ? 0 : 1 + Math.floor((n - 1) / 6), an = n * 1.0472 + k * 0.5, rr = k * 1.15 * TILE;
      let px = Math.max(20, Math.min(MAP_W - 20, o.x + Math.cos(an) * rr)), py = Math.max(20, Math.min(MAP_H - 20, o.y + Math.sin(an) * rr * 0.8));
      if (!u.air) { const q = nearest(px, py); if (q) { px = q.x; py = q.y; } }
      u.order = { x: px, y: py };
    } else u.order = null;
    u.path = null; u.target = 0; u.healing = false; u.retarget = 0; n++;
  }
  if (n) ev(b, { type: 'order', side, n, ref, x: o && o.x, y: o && o.y, home: !!(o && o.home), free: !o });
  return n;
}

// ---------- un pas de simulation ----------
export function step(b) {
  const dt = TICK;
  b.t += dt;
  if (b.over) { b.endT += dt; for (const u of b.units) { if (u.dead) u.deadT += dt; u.px = u.x; u.py = u.y; u.moving = false; if (u.atk) { u.atkT += dt; if (u.atkT >= u.atk.dur) u.atk = null; } } advanceProjs(b, dt, true); return; }
  b.clock -= dt;
  if (!b.overtime && !b.double && b.clock <= DOUBLE_AT) { b.double = true; ev(b, { type: 'double' }); }
  for (const p of b.players) {
    // mode camps : le camp le plus abîmé recharge plus vite (+50 % à CAMPS.aura / 2 points de retard, le double à CAMPS.aura)
    const k = b.camps ? 1 + Math.min(1, behind(b, p.side) / CAMPS.aura) : 1;
    p.aura = Math.min(AURA.max, p.aura + k * dt / (AURA.every / (b.double || b.overtime ? 2 : 1)));
  }
  for (const u of b.units) { u.px = u.x; u.py = u.y; if (u.dead) { u.deadT += dt; continue; } updateUnit(b, u, dt); if (b.over) return; }
  for (const t of b.towers) updateTower(b, t, dt);
  if (b.camps) for (const c of b.camps) updateCamp(b, c, dt);
  for (const c of b.crates) if (c.dead) { c.respawnT -= dt; if (c.respawnT <= 0 && !b.units.some((u) => !u.dead && !u.air && Math.hypot((u.x - c.x) / (c.rx + u.r), (u.y - c.y) / (c.ry + u.r)) < 1)) { c.dead = false; c.hp = c.maxHp; ev(b, { type: 'crate_spawn', id: c.id, x: c.x, y: c.y }); } }
  advanceProjs(b, dt, false);
  if (b.over) return;
  updateClouds(b, dt);
  separate(b);
  if (b.units.some((u) => u.dead && u.deadT > 1)) b.units = b.units.filter((u) => { if (u.dead && u.deadT > 1) { b.ents.delete(u.id); return false; } return true; });
  if (b.clock <= 0 && !b.over) {
    // le mode camps compare la vie des camps (en part de leur vie), l'ancien mode les jauges
    const [g0, g1] = b.camps ? [b.camps[0].hp / b.camps[0].maxHp * 100, b.camps[1].hp / b.camps[1].maxHp * 100] : [b.players[0].gauge, b.players[1].gauge];
    if (Math.abs(g0 - g1) > (b.camps ? 0.5 : 1e-6)) end(b, g0 > g1 ? 0 : 1, b.overtime ? 'overtime' : 'time');
    else if (!b.overtime) { b.overtime = true; b.clock = OVERTIME; ev(b, { type: 'overtime' }); }
    else {    // toujours à égalité : les tours tenues, puis les K.-O., départagent
      const own = (s) => b.towers.filter((t) => t.side === s).length, d = own(0) - own(1) || b.players[0].kos - b.players[1].kos;
      end(b, d > 0 ? 0 : d < 0 ? 1 : -1, 'tie');
    }
  }
}
// Abandon : l'adversaire gagne, jauge pleine (ou camp détruit)
export function forfeit(b, side) {
  if (b.over) return;
  if (b.camps) b.camps[side].hp = 0; else { b.players[1 - side].gauge = 100; b.players[side].gauge = 0; }
  end(b, 1 - side, 'forfeit');
}
function end(b, winner, why) {
  if (b.over) return;
  b.over = true; b.winner = winner; b.endT = 0; b.why = why;
  for (const u of b.units) { u.atk = null; }
  ev(b, { type: 'end', winner, why });
}

// ---------- les animaux ----------
function canHit(u, e) {
  if (!e || e.dead) return false;
  if (e.kind === 'unit') return e.side !== u.side && (!e.air || u.s.targets === 'all');
  if (e.kind === 'tower' || e.kind === 'camp') return e.side !== u.side;
  return true;                                   // la cible du centre et les boîtes : tout le monde peut les frapper
}
const aimX = (e) => (e.aimX !== undefined ? e.aimX : e.x), aimY = (e) => (e.aimY !== undefined ? e.aimY : e.y);
// portée (px) contre cette cible : l'éléphant qui a de l'eau arrose les animaux de loin
function rangeTo(u, e) {
  const sp = u.s.attacks.special;
  if (sp && sp.spray && u.water > 0 && e && e.kind === 'unit' && e.side !== u.side) return sp.spray.range * TILE;
  return u.s.range * TILE;
}
// Un ennemi à combattre. near : seulement ce qui est à portée de main. On ne se laisse pas attirer par un animal
// qui est de l'autre côté de l'eau, sauf si on peut déjà le toucher d'ici.
function acquire(b, u, near = false) {
  let best = null, bs = Infinity;
  const sight = near ? Math.max(u.s.range, 1.8) * TILE : u.s.sight * TILE, zu = u.air ? -1 : zoneAt(u.x, u.y);
  for (const e of b.units) {
    if (e.dead || e.side === u.side || !canHit(u, e)) continue;
    const d = edge(u, e); if (d > sight) continue;
    if (!u.air && d > rangeTo(u, e) && zoneAt(e.x, e.y) !== zu && !los(u.x, u.y, e.x, e.y)) continue;
    const taunt = e.guardT > 0 ? e.s.attacks.special.guard.taunt : e.s.taunt || 0;
    const sc = d - (taunt && d < taunt * TILE ? 2.5 * TILE : 0);
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
// L'allié le plus blessé à portée de vue (pour le chaton)
function wounded(b, u, reach) {
  let best = null, bs = 0.93;
  for (const e of b.units) {
    if (e.dead || e.side !== u.side || e === u || e.spawn > 0) continue;
    const r = e.hp / e.maxHp; if (r >= bs || edge(u, e) > reach) continue;
    bs = r; best = e;
  }
  return best;
}
function homeSpot(u) {
  if (!u.homeAt) {
    const B = BASE[u.side], an = u.id * 2.39996, rr = (0.9 + (u.id % 3) * 0.8) * TILE;
    u.homeAt = nearest(B.x + Math.cos(an) * rr * 1.6, B.y + Math.sin(an) * rr * 0.6, [HOME_ZONE[u.side]]) || { ...B };
  }
  return u.homeAt;
}
function updateUnit(b, u, dt) {
  if (u.spawn > 0) { u.spawn -= dt; if (u.spawn <= 0) ev(b, { type: 'arrive', uid: u.id, id: u.aid, x: u.x, y: u.y }); return; }
  u.hurtT += dt;
  if (u.buffT > 0) { u.buffT -= dt; if (u.buffT <= 0) u.buff = null; }
  if (u.shieldT > 0) { u.shieldT -= dt; if (u.shieldT <= 0) u.shield = 0; }
  if (u.slowT > 0) u.slowT -= dt;
  if (u.plateT > 0) u.plateT -= dt;
  if (u.guardCd > 0) u.guardCd -= dt;
  if (u.poison) {
    const p = u.poison; p.t -= dt; p.acc += dt;
    if (p.acc >= 0.5) { p.acc -= 0.5; damage(b, u, p.dps * 0.5, { side: p.side, aid: 'pig', a: { mult: 1 }, dmg: 0, sx: u.x, sy: u.y, dot: true }, true); if (u.dead || b.over) return; }
    if (p.t <= 0) u.poison = null;
  }
  // près de sa tente, au calme : il récupère
  if (u.hp < u.maxHp && u.hurtT > REGEN.calm && dist(u, BASE[u.side]) < REGEN.r * TILE) {
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * REGEN.rate * dt); u.regenT += dt;
    if (u.regenT >= 1) { u.regenT = 0; ev(b, { type: 'regen', uid: u.id, x: u.x, y: u.y }); }
  }
  if (u.kt > 0) { const k = Math.min(dt, u.kt); u.x += u.kx * k; u.y += u.ky * k; u.kt -= dt; u.run = 0; u.charging = false; }
  if (u.stun > 0) { u.stun -= dt; u.atk = null; u.moving = false; return; }
  if (u.guardT > 0) { u.guardT -= dt; u.atkT += dt; u.moving = false; if (u.guardT <= 0) u.atk = null; return; }
  u.cd -= dt;
  const sp = u.s.attacks.special;
  if (sp && sp.spray && u.water < sp.spray.charges) {          // l'éléphant puise dans la rivière la plus proche
    const w = waterNear(u.x, u.y);
    if (w && w.d < sp.spray.near * TILE) { u.waterT += dt; if (u.waterT >= sp.spray.every) { u.waterT = 0; u.water++; ev(b, { type: 'drink', uid: u.id, x: u.x, y: u.y, wx: w.x, wy: w.y, n: u.water }); } }
  }
  // attaque en cours
  if (u.atk) {
    u.atkT += dt;
    if (!u.hitDone && u.atkT >= u.atk.windup) { u.hitDone = true; hit(b, u); if (!u.atk || b.over) return; }
    if (u.atkT >= u.atk.dur) u.atk = null;
    else { u.moving = false; return; }
  }
  // l'ordre en cours tient-il toujours ? (cible détruite ou prise : l'animal reprend sa liberté)
  let ord = u.order;
  if (ord && ord.ref) { const e = b.ents.get(ord.ref); if (!canHit(u, e)) { ord = u.order = null; u.path = null; } }
  let tgt = u.target ? b.ents.get(u.target) : null, dest = null, holdAt = null;
  if (tgt && (tgt.dead || (u.healing ? tgt.side !== u.side || tgt.hp >= tgt.maxHp : !canHit(u, tgt)))) { tgt = null; u.healing = false; }
  const inRange = (e) => !!e && edge(u, e) <= rangeTo(u, e) + 5;
  u.retarget -= dt;
  const tick = u.retarget <= 0; if (tick) u.retarget = 0.25;
  if (ord && ord.ref) { tgt = b.ents.get(ord.ref); u.healing = false; }
  else {
    holdAt = ord ? (ord.home ? homeSpot(u) : ord) : null;
    if (u.s.healer && tick) {                                   // le chaton cherche d'abord un blessé
      const w = wounded(b, u, holdAt ? u.s.range * TILE : u.s.sight * TILE);
      if (w) { tgt = w; u.healing = true; } else if (u.healing) { tgt = null; u.healing = false; }
    }
    if (!u.healing) {
      const keep = tgt && tgt.kind === 'unit' && inRange(tgt);
      if (!keep && tick) tgt = acquire(b, u, !!holdAt) || (holdAt ? null : goal(b, u));
      else if (!tgt && !holdAt) tgt = goal(b, u);
    }
  }
  u.target = tgt ? tgt.id : 0;
  if (tgt) {
    const d = edge(u, tgt), R = rangeTo(u, tgt);
    if (d <= R + 5) {
      u.moving = false; face(u, aimX(tgt) - u.x, aimY(tgt) - u.y);
      if (u.cd <= 0) startAttack(b, u, tgt, d);
      return;
    }
    if (holdAt && Math.hypot(tgt.x - holdAt.x, tgt.y - holdAt.y) > HOLD_LEASH * TILE + R) { u.target = 0; u.healing = false; dest = holdAt; }
    else dest = tgt;
  } else if (holdAt) dest = holdAt;
  if (dest && dest !== tgt && Math.hypot(dest.x - u.x, dest.y - u.y) < 5) { u.moving = false; return; }
  if (dest) travel(b, u, dest, dest === tgt ? tgt : null, dt); else u.moving = false;
}
function face(u, dx, dy) { const l = Math.hypot(dx, dy); if (l > 0.01) { u.fx = dx / l; u.fy = dy / l; } }
function startAttack(b, u, tgt, d) {
  const A = u.s.attacks;
  u.count++;
  let a = A.normal, special = false;
  if (A.melee && tgt.kind === 'unit' && d < 1.2 * TILE) a = A.melee;
  else if (A.special && A.special.spray) { if (u.water > 0 && tgt.kind === 'unit' && d > u.s.range * TILE + 5) { a = A.special; special = true; u.water--; } }
  else if (A.special && A.special.every && u.count % A.special.every === 0) { a = A.special; special = true; }
  u.atk = a; u.atkT = 0; u.hitDone = false; u.atkTarget = tgt.id; u.atkX = aimX(tgt); u.atkY = aimY(tgt); u.atkHeal = u.healing;
  u.chargeHit = u.charging; u.charging = false; u.run = 0;
  const haste = (u.buff ? 1 + u.buff.speed : 1) * (u.slowT > 0 ? 1 - u.slowK * 0.4 : 1);
  u.cd = u.s.hitEvery / haste;
  ev(b, { type: 'attack', uid: u.id, id: u.aid, special, anim: a.anim, charge: u.chargeHit, x: u.x, y: u.y, heal: u.healing });
}
// Le coup part : au contact, ou un projectile
function hit(b, u) {
  const a = u.atk, tgt = b.ents.get(u.atkTarget);
  const live = tgt && !tgt.dead;
  const tx = live ? aimX(tgt) : u.atkX, ty = live ? aimY(tgt) : u.atkY;
  const dmg = u.s.dmg * a.mult * (u.buff ? 1 + u.buff.dmg : 1) * (u.rage ? 1 + u.rage * u.s.attacks.special.rage.add : 1) * (u.chargeHit ? u.s.charge.mult : 1);
  const info = { side: u.side, aid: u.aid, a, dmg, src: u.id, sx: u.x, sy: u.y, charge: u.chargeHit, k: u.s.k, heal: u.atkHeal && a.heal ? a.heal * u.s.k : 0 };
  if (a.shield) shieldAround(b, u, a.shield);
  if (a.proj) {
    const lift = u.air ? AIR_H + 8 : 18;
    const pr = { side: u.side, x: u.x + u.fx * u.r, y: u.y - lift, sx: u.x, sy: u.y - 18, tx, ty, target: live ? tgt.id : 0, speed: a.projSpeed * TILE, key: a.proj, arc: !!a.arc, arcH: 70, info, t: 0 };
    pr.T = Math.max(0.15, Math.hypot(tx - pr.x, ty - pr.y) / pr.speed);
    b.projs.push(pr); ev(b, { type: 'proj', id: u.aid, key: a.proj, x: pr.x, y: pr.y });
    return;
  }
  if (a.spray) { ev(b, { type: 'spray', uid: u.id, x: u.x, y: u.y, tx, ty, left: u.water }); impact(b, info, live ? tgt : null, tx, ty); return; }
  if (live && edge(u, tgt) <= u.s.range * TILE + 0.8 * TILE) impact(b, info, tgt, tx, ty);
  else if (a.splash) impact(b, info, null, tx, ty);
  else ev(b, { type: 'miss', uid: u.id, x: tx, y: ty });
  if (a.rage) { u.rage = Math.min(a.rage.max, u.rage + 1); ev(b, { type: 'roar', uid: u.id, x: u.x, y: u.y, n: u.rage, max: a.rage.max }); }
  if (a.plate) { u.plate = Math.min(a.plate.max, u.plate + 1); u.plateT = a.plate.dur; ev(b, { type: 'armor', uid: u.id, x: u.x, y: u.y, n: u.plate, max: a.plate.max }); }
}
// Les dégâts arrivent : cible principale, dégâts de zone, recul, étourdissement, ralentissement, nuage
function impact(b, info, tgt, x, y) {
  const a = info.a, hitList = [], A = ANIMALS[info.aid];
  if (tgt && !tgt.dead) { damage(b, tgt, info.dmg, info); hitList.push(tgt); if (b.over) return; }
  if (a.splash) {
    const cx = a.around ? info.sx : x, cy = a.around ? info.sy : y, R = a.splash * TILE;
    for (const e of b.units) {
      if (e.dead || e.side === info.side || e === tgt) continue;
      if (e.air && !(info.tower || (A && A.targets === 'all') || a.gust)) continue;
      if (Math.hypot(e.x - cx, e.y - cy) - e.r > R) continue;
      damage(b, e, info.dmg * a.splashMult, info, true); hitList.push(e);
    }
    if (!info.tower) for (const s of b.structs) {
      if (s === tgt || s.dead || ((s.kind === 'tower' || s.kind === 'camp') && s.side === info.side)) continue;
      if ((Math.hypot((s.x - cx) / s.rx, (s.y - cy) / s.ry) - 1) * Math.min(s.rx, s.ry) < R) { damage(b, s, info.dmg * a.splashMult * 0.5, info, true); if (b.over) return; }
    }
    ev(b, { type: 'splash', id: info.aid, x: cx, y: cy, r: R, water: !!a.water, gust: !!a.gust, tower: !!info.tower, special: !!A && a === A.attacks.special });
  }
  const knock = (a.knock || 0) + (info.charge && A ? A.charge.knock : 0);
  for (const e of hitList) {
    if (e.kind !== 'unit' || e.dead || e.guardT > 0) continue;
    if (knock) {
      const dx = e.x - info.sx, dy = e.y - info.sy, l = Math.hypot(dx, dy) || 1, k = knock * TILE * (e.mass >= 12 ? 0.35 : e.mass >= 8 ? 0.65 : 1);
      e.kx = dx / l * k / 0.22; e.ky = dy / l * k / 0.22; e.kt = 0.22;
    }
    if (a.stun) { e.stun = Math.max(e.stun, a.stun); e.atk = null; ev(b, { type: 'stun', uid: e.id, x: e.x, y: e.y }); }
    if (a.slow) { e.slowT = a.slow.dur; e.slowK = a.slow.k; ev(b, { type: 'slow', uid: e.id, x: e.x, y: e.y }); }
  }
  if (a.cloud) { b.clouds.push({ side: info.side, x, y, r: a.cloud.r * TILE, dps: a.cloud.dps * (info.k || 1), linger: a.cloud.linger, t: a.cloud.dur, acc: 0, T: a.cloud.dur }); ev(b, { type: 'cloud', x, y, r: a.cloud.r * TILE }); }
}
function shieldAround(b, u, sh) {
  const amount = Math.round(sh.amount * u.s.k); let n = 0;
  for (const e of b.units) if (!e.dead && e.side === u.side && e.spawn <= 0 && Math.hypot(e.x - u.x, e.y - u.y) - e.r < sh.r * TILE) { e.shield = Math.max(e.shield, amount); e.shieldMax = amount; e.shieldT = sh.dur; n++; ev(b, { type: 'shield', uid: e.id, x: e.x, y: e.y }); }
  ev(b, { type: 'shieldwave', uid: u.id, x: u.x, y: u.y, r: sh.r * TILE, n });
}
function heal(b, e, amount) {
  if (e.dead || e.hp >= e.maxHp) return;
  const got = Math.min(e.maxHp - e.hp, amount); e.hp += got;
  ev(b, { type: 'heal', uid: e.id, amount: Math.round(got), x: e.x, y: e.y });
}
export function damage(b, e, amount, info, splash = false) {
  if (e.dead || b.over) return;
  if (e.kind === 'machine' && b.camps) {        // mode camps : la catapulte. Chaque camp charge la sienne, le camp en retard plus vite
    const p = b.players[info.side], g = amount / b.gaugeHp * 100 * (1 + behind(b, info.side) / CAMPS.catapult.catchup);
    p.gauge = Math.min(100, p.gauge + g);
    ev(b, { type: 'gauge', side: info.side, g, amount: Math.round(amount), x: e.aimX, y: e.aimY, by: info.aid, splash });
    if (p.gauge >= 100) fireCatapult(b, info.side);
    return;
  }
  if (e.kind === 'machine') {                   // la cible : la jauge du camp qui frappe monte, l'autre descend d'autant
    const p = b.players[info.side], q = b.players[1 - info.side], g = amount / b.gaugeHp * 100;
    p.gauge = Math.min(100, p.gauge + g); q.gauge = Math.max(0, q.gauge - g);
    ev(b, { type: 'gauge', side: info.side, g, amount: Math.round(amount), x: e.aimX, y: e.aimY, by: info.aid, splash });
    if (p.gauge >= 100) end(b, info.side, 'full');
    else if (b.overtime && Math.abs(p.gauge - q.gauge) > 1e-6) end(b, p.gauge > q.gauge ? p.side : q.side, 'overtime');
    return;
  }
  if (e.kind === 'unit') {
    if (e.guardT > 0) { ev(b, { type: 'block', uid: e.id, x: e.x, y: e.y }); return; }
    if (e.plate) amount *= 1 - e.plate * e.s.attacks.special.plate.add;
    if (e.shield > 0) {
      const ab = Math.min(e.shield, amount); e.shield -= ab; amount -= ab;
      if (e.shield <= 0.5) { e.shield = 0; e.shieldT = 0; ev(b, { type: 'shield_break', uid: e.id, x: e.x, y: e.y }); }
      if (amount < 1) { ev(b, { type: 'hit', id: e.id, kind: 'unit', amount: 0, x: e.x, y: e.y, by: info ? info.aid : null, splash, air: !!e.air, side: e.side, shield: true }); return; }
    }
  }
  amount = Math.max(1, Math.round(amount));
  e.hp -= amount;
  if (e.kind === 'unit') e.hurtT = 0;
  ev(b, { type: 'hit', id: e.id, kind: e.kind, amount, x: aimX(e), y: aimY(e), by: info ? info.aid : null, splash, air: !!e.air, side: e.side, charge: info && info.charge, dot: !!(info && info.dot), from: info ? info.side : -1 });
  if (e.hp <= 0) { kill(b, e, info); return; }
  if (e.kind === 'camp' && b.overtime) { end(b, 1 - e.side, 'overtime'); return; }      // mort subite : le premier camp touché perd
  // l'orang-outan se protège la tête dès qu'on le frappe
  const g = e.kind === 'unit' && e.s.attacks.special && e.s.attacks.special.guard;
  if (g && e.guardCd <= 0 && e.stun <= 0 && e.spawn <= 0 && !(info && info.dot)) {
    e.guardT = g.dur; e.guardCd = g.cd; e.atk = e.s.attacks.special; e.atkT = 0; e.hitDone = true; e.moving = false;
    ev(b, { type: 'guard', uid: e.id, x: e.x, y: e.y, dur: g.dur });
  }
}
function kill(b, e, info) {
  e.hp = 0;
  const by = info ? info.side : -1;
  if (e.kind === 'camp') { e.dead = true; ev(b, { type: 'camp_down', side: e.side, x: e.x, y: e.y, topY: e.topY }); end(b, 1 - e.side, 'camp'); return; }
  if (e.kind === 'unit') { e.dead = true; e.deadT = 0; e.atk = null; b.players[1 - e.side].kos++; ev(b, { type: 'death', uid: e.id, id: e.aid, side: e.side, x: e.x, y: e.y, air: e.air }); return; }
  if (e.kind === 'crate') {                    // la boîte éclate : un bonus tiré au sort pour le camp qui l'a cassée
    e.dead = true; e.respawnT = STRUCTS.crate.respawn;
    if (by < 0) return;
    b.players[by].crates++;
    let roll = b.rng() * BONUS.reduce((n, x) => n + x[1], 0), bonus = BONUS[0][0];
    for (const [k, w] of BONUS) { if (roll < w) { bonus = k; break; } roll -= w; }
    ev(b, { type: 'crate_break', id: e.id, side: by, bonus, x: e.x, y: e.y });
    if (bonus === 'monkey' || bonus === 'kitten') { for (const u of spawn(b, by, bonus, Math.max(1, Math.round(b.levels[by])), e.x, e.y + 4, 0.6, 1)) u.gift = true; }
    else if (bonus === 'aura') b.players[by].aura = Math.min(AURA.max, b.players[by].aura + BONUS_FX.aura);
    else for (const u of b.units) {
      if (u.dead || u.side !== by || Math.hypot(u.x - e.x, u.y - e.y) - u.r > (bonus === 'fruit' ? BONUS_FX.fruitR : BONUS_FX.rageR) * TILE) continue;
      if (bonus === 'fruit') heal(b, u, u.maxHp * BONUS_FX.fruit);
      else { u.buff = BONUS_FX.rage; u.buffT = BONUS_FX.rage.dur; ev(b, { type: 'buff', uid: u.id, x: u.x, y: u.y }); }
    }
    return;
  }
  if (e.kind === 'tower') {                    // la cage (ou le perchoir) cède : la tour change de camp
    if (by < 0) { e.hp = 1; return; }
    const was = e.side;
    e.side = by; e.taken++; e.maxHp = Math.round(STRUCTS.tower.hp * b.lvK * Math.pow(STRUCTS.tower.retake, e.taken)); e.hp = e.maxHp; e.cd = 1.6; e.target = 0;
    b.players[by].towers++;
    ev(b, { type: 'tower_take', tid: e.id, side: by, was, lane: e.lane, x: e.x, y: e.y, topY: e.topY });
  }
}

// Déplacement : les animaux au sol suivent un chemin par les ponts ; les animaux volants vont tout droit.
// ent : la cible visée (on s'arrête à portée), sinon on va jusqu'au point.
function travel(b, u, dest, ent, dt) {
  let wx = dest.x, wy = dest.y;
  if (!u.air) {
    const key = ent ? ent.id : -1 - Math.round(dest.x) * 2048 - Math.round(dest.y);
    u.pathT -= dt;
    const P = u.path;
    if (!P || P.key !== key || (u.pathT <= 0 && (Math.hypot(P.gx - dest.x, P.gy - dest.y) > 2 * CELL || P.done))) {
      const R = ent ? rangeTo(u, ent) : 0;
      let pts;
      if (ent && ent.rx) pts = findPath(u.x, u.y, ent.x, ent.y, Math.min(ent.rx, ent.ry), (x, y) => (Math.hypot((x - ent.x) / ent.rx, (y - ent.y) / ent.ry) - 1) * Math.min(ent.rx, ent.ry) - u.r <= R * 0.7);
      else if (ent) pts = findPath(u.x, u.y, ent.x, ent.y, Math.max(CELL, (u.r + ent.r + R) * 0.85));
      else pts = findPath(u.x, u.y, dest.x, dest.y, 0);
      u.path = { key, gx: dest.x, gy: dest.y, pts: pts || [[dest.x, dest.y]], i: 0, done: false };
      u.pathT = 0.4 + (u.id % 5) * 0.04;
    }
    const Q = u.path, pts = Q.pts;
    while (Q.i < pts.length - 1 && (Math.hypot(pts[Q.i][0] - u.x, pts[Q.i][1] - u.y) < 5 || los(u.x, u.y, pts[Q.i + 1][0], pts[Q.i + 1][1]))) Q.i++;
    wx = pts[Q.i][0]; wy = pts[Q.i][1];
    if (Q.i === pts.length - 1 && Math.hypot(wx - u.x, wy - u.y) < 4) {      // au bout du chemin sans être à portée : on finit tout droit si possible
      Q.done = true;
      if (los(u.x, u.y, dest.x, dest.y) || (ent && ent.rx)) { wx = dest.x; wy = dest.y; } else { u.moving = false; return; }
    }
  }
  const dx = wx - u.x, dy = wy - u.y, l = Math.hypot(dx, dy);
  if (l < 1) { u.moving = false; return; }
  if (u.s.charge && u.run >= u.s.charge.after * TILE && !u.charging) { u.charging = true; ev(b, { type: 'charge', uid: u.id, x: u.x, y: u.y }); }
  const spd = (u.charging ? u.s.charge.speed : u.s.speed) * TILE * (u.buff ? 1 + u.buff.speed : 1) * (u.slowT > 0 ? 1 - u.slowK : 1);
  const k = Math.min(l, spd * dt);
  let nx = u.x + dx / l * k, ny = u.y + dy / l * k;
  if (!u.air && !walkable(nx, ny)) {             // on glisse le long du bord plutôt que d'entrer dans l'eau ou un mur
    if (walkable(nx, u.y)) ny = u.y; else if (walkable(u.x, ny)) nx = u.x; else { u.moving = false; u.path = null; return; }
  }
  u.run += Math.hypot(nx - u.x, ny - u.y); u.x = nx; u.y = ny;
  u.moving = true; face(u, dx, dy);
}

// ---------- les tours latérales : l'orang-outan libéré bombarde les animaux adverses ----------
function updateTower(b, t, dt) {
  t.shotT += dt;
  if (t.side < 0) return;
  t.cd -= dt; if (t.cd > 0) return;
  const T = STRUCTS.tower, R = T.range * TILE;
  // d'abord ceux qui s'en prennent à la tour, sinon l'ennemi le plus proche de notre camp (de la cible du centre dans l'ancien mode)
  let tgt = null, bs = Infinity;
  const G = b.camps ? b.camps[t.side] : b.machine;
  for (const u of b.units) {
    if (u.dead || u.side === t.side || u.spawn > 0) continue;
    const d = Math.hypot(u.x - t.x, u.y - t.y); if (d > R) continue;
    const sc = d < 7 * TILE ? d - 2000 : Math.hypot(u.x - G.x, u.y - G.y);
    if (sc < bs) { bs = sc; tgt = u; }
  }
  if (!tgt) { t.cd = 0.3; return; }
  t.cd = T.hitEvery; t.target = tgt.id;
  const dmg = Math.round(T.dmg * levelK(b.levels[t.side]));
  const pr = { side: t.side, x: t.x, y: t.topY, sx: t.x, sy: t.topY, tx: tgt.x, ty: tgt.y, target: tgt.id, key: 'rocks2', arc: true, arcH: 95, track: true, t: 0,
    info: { side: t.side, aid: null, tower: true, a: { mult: 1, splash: T.splash, splashMult: T.splashMult, knock: T.knock }, dmg, src: t.id, sx: t.x, sy: t.y } };
  pr.T = Math.max(0.7, Math.min(1.5, Math.hypot(pr.tx - pr.x, pr.ty - pr.y) / (15 * TILE)));
  b.projs.push(pr); ev(b, { type: 'shot', tid: t.id, side: t.side, x: pr.x, y: pr.y, tx: pr.tx, ty: pr.ty });
}

// ---------- mode camps : le garde du camp lance des pierres sur qui approche ----------
function updateCamp(b, c, dt) {
  if (c.dead) return;
  c.cd -= dt; if (c.cd > 0) return;
  const T = CAMPS.guard, R = T.range * TILE;
  let tgt = null, bs = Infinity;
  for (const u of b.units) {
    if (u.dead || u.side === c.side || u.spawn > 0) continue;
    const d = edge(u, c); if (d > R) continue;
    if (d < bs) { bs = d; tgt = u; }
  }
  if (!tgt) { c.cd = 0.3; c.target = 0; return; }
  c.cd = T.hitEvery; c.target = tgt.id;
  const dmg = Math.round(T.dmg * levelK(b.levels[c.side]));
  const pr = { side: c.side, x: c.x, y: c.topY, sx: c.x, sy: c.topY, tx: tgt.x, ty: tgt.y, target: tgt.id, key: 'rocks2', arc: true, arcH: 80, track: true, t: 0,
    info: { side: c.side, aid: null, tower: true, a: { mult: 1, splash: T.splash, splashMult: T.splashMult, knock: T.knock }, dmg, src: c.id, sx: c.x, sy: c.y } };
  pr.T = Math.max(0.5, Math.min(1.2, Math.hypot(pr.tx - pr.x, pr.ty - pr.y) / (15 * TILE)));
  b.projs.push(pr); ev(b, { type: 'shot', tid: c.id, side: c.side, x: pr.x, y: pr.y, tx: pr.tx, ty: pr.ty, camp: true });
}
// Charge pleine : la catapulte du centre lance un gros rocher sur le camp adverse, et la charge repart de zéro
function fireCatapult(b, side) {
  const p = b.players[side], c = b.camps[1 - side], M = b.machine, dmg = c.maxHp * CAMPS.catapult.hit;
  p.gauge = 0; p.shots = (p.shots || 0) + 1;
  const sx = M.x + (side === 0 ? -29 : 30), sy = M.y - 70;          // il part du bocal du camp qui tire
  const pr = { side, x: sx, y: sy, sx, sy, tx: c.aimX, ty: c.aimY, target: c.id, key: 'boulder', arc: true, arcH: 120, track: false, t: 0, T: 1.4,
    info: { side, aid: null, catapult: true, a: { mult: 1 }, dmg, src: M.id, sx: M.x, sy: M.y } };
  b.projs.push(pr);
  ev(b, { type: 'catapult', side, x: sx, y: sy, tx: c.aimX, ty: c.aimY, amount: Math.round(dmg), T: pr.T });
}

// ---------- projectiles et nuages ----------
function advanceProjs(b, dt, frozen) {
  for (let i = b.projs.length - 1; i >= 0; i--) {
    const p = b.projs[i]; p.t += dt;
    const tg = p.target ? b.ents.get(p.target) : null, live = tg && !tg.dead;
    if (live && (!p.arc || p.track)) { p.tx = aimX(tg); p.ty = aimY(tg) - (tg.kind === 'unit' && !p.arc ? (tg.air ? AIR_H + 8 : 10) : 0); }
    p.px = p.x; p.py = p.y;
    if (p.arc) {
      const k = Math.min(1, p.t / p.T); p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k - Math.sin(Math.PI * k) * p.arcH; p.k = k;
      if (k >= 1) { b.projs.splice(i, 1); if (!frozen) land(b, p, tg); }
      continue;
    }
    const dx = p.tx - p.x, dy = p.ty - p.y, l = Math.hypot(dx, dy), s = p.speed * dt;
    if (l <= s || p.t > 3) { b.projs.splice(i, 1); if (!frozen) land(b, p, tg); continue; }
    p.x += dx / l * s; p.y += dy / l * s; p.ang = Math.atan2(dy, dx);
  }
}
function land(b, p, tg) {
  const live = tg && !tg.dead;
  ev(b, { type: 'land', key: p.key, x: p.tx, y: p.ty, splash: !!p.info.a.splash, tower: !!p.info.tower, heal: !!p.info.heal, side: p.side, cata: !!p.info.catapult });
  if (p.info.heal) { if (live && tg.side === p.side) heal(b, tg, p.info.heal); return; }
  if (p.info.a.splash) impact(b, p.info, live && Math.hypot(aimX(tg) - p.tx, aimY(tg) - p.ty) < (tg.r || 30) + 16 ? tg : null, p.tx, p.ty);
  else if (live) impact(b, p.info, tg, p.tx, p.ty);
}
function updateClouds(b, dt) {
  for (let i = b.clouds.length - 1; i >= 0; i--) {
    const c = b.clouds[i]; c.t -= dt; c.acc += dt;
    if (c.acc >= 0.25) {                        // tout animal adverse dans le nuage est empoisonné, et le reste un moment après en être sorti
      c.acc -= 0.25;
      for (const e of b.units) if (!e.dead && e.side !== c.side && e.spawn <= 0 && Math.hypot(e.x - c.x, e.y - c.y) - e.r < c.r) {
        if (!e.poison) { e.poison = { dps: c.dps, t: c.linger, acc: 0, side: c.side }; ev(b, { type: 'poison', uid: e.id, x: e.x, y: e.y }); }
        else { e.poison.t = c.linger; e.poison.dps = Math.max(e.poison.dps, c.dps); }
      }
    }
    if (c.t <= 0) b.clouds.splice(i, 1);
  }
}

// ---------- les corps ne se chevauchent pas, et personne ne finit dans l'eau ----------
function separate(b) {
  const us = b.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i]; if (a.dead || a.spawn > 0) continue;
    for (let j = i + 1; j < us.length; j++) {
      const c = us[j]; if (c.dead || c.spawn > 0 || a.air !== c.air) continue;
      let dx = c.x - a.x, dy = c.y - a.y; const d = Math.hypot(dx, dy), min = (a.r + c.r) * 0.85;
      if (d >= min) continue;
      if (d < 0.01) { dx = (a.id % 2 ? 1 : -1) * 0.5; dy = 0.3; }
      const l = Math.hypot(dx, dy), push = (min - d), wa = c.mass / (a.mass + c.mass), wc = 1 - wa;
      a.x -= dx / l * push * wa; a.y -= dy / l * push * wa; c.x += dx / l * push * wc; c.y += dy / l * push * wc;
    }
    if (!a.air) for (const c of b.crates) {       // les boîtes sont des obstacles : on glisse autour
      if (c.dead) continue;
      const ex = (a.x - c.x) / (c.rx + a.r * 0.6), ey = (a.y - c.y) / (c.ry + a.r * 0.6), q = Math.hypot(ex, ey);
      if (q < 1) { const k = 1 / Math.max(0.05, q), sx = ex || (a.id % 2 ? 0.05 : -0.05); a.x = c.x + sx * k * (c.rx + a.r * 0.6); a.y = c.y + (ey || 0.05) * k * (c.ry + a.r * 0.6); }
    }
  }
  for (const u of us) {
    if (u.dead) continue;
    if (u.air) {      // les volants restent au-dessus de l'arène
      const q = Math.hypot((u.x - 768) / 650, (u.y - 512) / 420); if (q > 1) { u.x = 768 + (u.x - 768) / q; u.y = 512 + (u.y - 512) / q; }
      continue;
    }
    if (walkable(u.x, u.y)) continue;
    if (walkable(u.x, u.py)) u.y = u.py; else if (walkable(u.px, u.y)) u.x = u.px;
    else if (walkable(u.px, u.py)) { u.x = u.px; u.y = u.py; }
    else { const p = nearest(u.x, u.y); if (p) { u.x = p.x; u.y = p.y; } }
  }
}

// Résumé de fin pour l'écran de résultats.
//   mode jauge : gauge = sa jauge ; couronnes : 3 = jauge pleine, 2 = jauge à 60 % ou plus, 1 = 25 % (ou victoire) ;
//   mode camps : gauge = part du camp adverse détruite ; couronnes : 3 = camp adverse détruit, 2 = au moins 50 %, 1 = victoire.
export function summary(b, side) {
  const me = b.players[side], foe = b.players[1 - side], win = b.winner === side;
  const base = { win, draw: b.winner === -1, kos: me.kos, aura: Math.round(me.spent), towers: b.towers.filter((t) => t.side === side).length, crates: me.crates, why: b.why, mode: b.mode };
  if (b.camps) {
    const lost = (s) => 100 * (1 - Math.max(0, b.camps[s].hp) / b.camps[s].maxHp);
    const stars = (d, won) => (d >= 99.999 ? 3 : d >= 50 ? 2 : won ? 1 : 0);
    const g = lost(1 - side), fg = lost(side);
    return { ...base, crowns: stars(g, win), lost: stars(fg, b.winner === 1 - side), gauge: Math.floor(g * 10) / 10, foeGauge: Math.floor(fg * 10) / 10, shots: me.shots || 0 };
  }
  const stars = (g, won) => (g >= 99.999 ? 3 : g >= 60 ? 2 : g >= 25 || won ? 1 : 0);
  return { ...base, crowns: stars(me.gauge, win), lost: stars(foe.gauge, b.winner === 1 - side), gauge: Math.floor(me.gauge * 10) / 10, foeGauge: Math.floor(foe.gauge * 10) / 10 };
}
