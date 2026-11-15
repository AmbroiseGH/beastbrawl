// Le moteur des combats en temps réel (façon Clash Royale) : deux joueurs, trois tours chacun, de l'Aura qui se recharge,
// des animaux posés depuis une main de 4 cartes. Pas de dessin ici : le moteur avance par pas fixes et range dans
// b.events ce qui s'est passé (coups, morts, tours détruites…) pour que l'affichage et les sons suivent.
// Coordonnées : pixels du terrain affiché (941 × 1426), y vers le bas. Le joueur 0 est en bas, le joueur 1 en haut.
import { ANIMALS, statsAt, towerAt } from '../data/animals.js';
import { makeRng } from '../core/rng.js';

export const TICK = 1 / 30;
export const TILE = 52;                         // une case
export const FW = 941, FH = 1426, MID_X = 470.5, MID_Y = 735.5;
export const RIVER = [671, 800];                // la rivière, entre ces deux lignes
export const BRIDGES = [140, 800], BRIDGE_W = 62;   // centre des deux ponts et demi-largeur praticable
export const DURATION = 180, OVERTIME = 60, DOUBLE_AT = 60;
export const AURA = { start: 5, max: 10, every: 2.8 };
export const DEPLOY_DELAY = 1;                  // temps d'arrivée d'un animal posé (s)
export const ORDER = { defend: 9, focus: 12, cdDefend: 6, cdFocus: 4 };
const TOWER_POS = { left: [166, 1213], right: [775, 1213], main: [470, 1297] };   // côté du joueur 0
const GUARD_Y = 1105;                           // où les animaux rappelés au sifflet se postent (côté du joueur 0)

export const mirrorY = (side, y) => (side === 0 ? y : 2 * MID_Y - y);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const edge = (a, b) => dist(a, b) - a.r - b.r;
const onMyHalf = (side, y) => (side === 0 ? y > MID_Y - 20 : y < MID_Y + 20);

// ---------- création ----------
// decks : [[{ id, level }…], […]] ; towerLevels : [n, n] ; seed : graine du mélange des cartes
export function createBattle({ decks, towerLevels = [1, 1], seed = 1 }) {
  const rng = makeRng(seed);
  const b = { t: 0, clock: DURATION, overtime: false, double: false, over: false, winner: -1, endT: 0,
    units: [], towers: [], projs: [], clouds: [], events: [], ents: new Map(), nextId: 1, rng, players: [] };
  for (let s = 0; s < 2; s++) {
    const cards = decks[s].filter((c) => ANIMALS[c.id]).map((c) => ({ id: c.id, level: c.level || 1, cost: ANIMALS[c.id].cost }));
    const order = cards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const hand = [0, 1, 2, 3].map(() => (order.length ? order.shift() : -1));
    b.players.push({ side: s, cards, hand, queue: order, aura: AURA.start, crowns: 0, kos: 0, spent: 0, played: 0,
      defendT: 0, focus: null, focusSeq: 0, cdDefend: 0, cdFocus: 0 });
    for (const key of ['left', 'right', 'main']) {
      const role = key === 'main' ? 'main' : 'side', T = towerAt(role, towerLevels[s] || 1), [x, y] = TOWER_POS[key];
      const t = { id: b.nextId++, kind: 'tower', side: s, role, lane: key, x, y: mirrorY(s, y), r: T.radius * TILE, hp: T.hp, maxHp: T.hp, dmg: T.dmg,
        hitEvery: T.hitEvery, range: T.range * TILE, proj: T.proj, cd: 0.5, active: role !== 'main', target: 0, dead: false, air: false, level: towerLevels[s] || 1, shotT: 9 };
      b.towers.push(t); b.ents.set(t.id, t);
    }
  }
  return b;
}
const ev = (b, e) => b.events.push(e);
export const handOf = (b, side) => b.players[side].hand.map((i) => (i >= 0 ? b.players[side].cards[i] : null));
export const nextOf = (b, side) => { const p = b.players[side]; const i = p.queue[0]; return i === undefined ? null : p.cards[i]; };

// ---------- où peut-on poser ? ----------
// Rectangles de pose d'un joueur : sa moitié, et la poche derrière une tour adverse détruite
export function zones(b, side) {
  const out = [{ x0: 20, x1: FW - 20, y0: 812, y1: FH - 12 }];
  for (const t of b.towers) if (t.side !== side && t.role === 'side' && t.dead) out.push(t.lane === 'left' ? { x0: 20, x1: MID_X, y0: 330, y1: RIVER[0] - 8 } : { x0: MID_X, x1: FW - 20, y0: 330, y1: RIVER[0] - 8 });
  return out.map((z) => (side === 0 ? z : { x0: z.x0, x1: z.x1, y0: 2 * MID_Y - z.y1, y1: 2 * MID_Y - z.y0 }));
}
export function canDeploy(b, side, x, y) {
  if (!zones(b, side).some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1)) return false;
  return !b.towers.some((t) => !t.dead && Math.hypot(t.x - x, t.y - y) < t.r + 8);
}
// Point de pose le plus proche dans la zone autorisée (pour l'IA et le doigt qui déborde)
export function clampDeploy(b, side, x, y) {
  let best = null, bd = Infinity;
  for (const z of zones(b, side)) {
    const cx = Math.max(z.x0, Math.min(z.x1, x)), cy = Math.max(z.y0, Math.min(z.y1, y)), d = Math.hypot(cx - x, cy - y);
    if (d < bd) { bd = d; best = { x: cx, y: cy }; }
  }
  for (const t of b.towers) if (!t.dead) { const d = Math.hypot(best.x - t.x, best.y - t.y); if (d < t.r + 10) { const k = (t.r + 12) / Math.max(1, d); best.x = t.x + (best.x - t.x) * k; best.y = t.y + (best.y - t.y || 1) * k; } }
  return best;
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
  spawn(b, side, card.id, card.level, x, y);
  ev(b, { type: 'deploy', side, id: card.id, x, y, cost: card.cost });
  return '';
}
const FORM = { 1: [[0, 0]], 2: [[-0.55, 0.1], [0.55, -0.1]], 3: [[0, -0.5], [-0.55, 0.4], [0.55, 0.4]] };
function spawn(b, side, id, level, x, y) {
  const s = statsAt(id, level), n = s.count || 1;
  for (const [ox, oy] of FORM[n] || FORM[1]) {
    const u = { id: b.nextId++, kind: 'unit', side, aid: id, level, s, x: x + ox * TILE, y: y + oy * TILE, px: 0, py: 0, r: s.radius * TILE, air: !!s.air, mass: s.mass,
      hp: s.hp, maxHp: s.hp, spawn: DEPLOY_DELAY, target: 0, retarget: 0, atk: null, atkT: 0, hitDone: true, cd: 0, count: 0,
      fx: 0, fy: side === 0 ? -1 : 1, moving: false, stun: 0, kx: 0, ky: 0, kt: 0, armorT: 0, buffT: 0, buff: null, run: 0, charging: false, chargeHit: false,
      focusDone: 0, dead: false, deadT: 0, poisonT: 0 };
    u.px = u.x; u.py = u.y;
    b.units.push(u); b.ents.set(u.id, u);
  }
}

// ---------- ordres : Siffler et Attaquer ----------
// kind 'defend' : les animaux reviennent défendre leur camp. kind 'focus' : ils attaquent l'ennemi, la tour ou l'endroit touché.
export function order(b, side, kind, x, y) {
  const p = b.players[side];
  if (b.over) return '';
  if (kind === 'defend') {
    if (p.cdDefend > 0) return 'attente';
    p.defendT = ORDER.defend; p.cdDefend = ORDER.cdDefend; p.focus = null;
    ev(b, { type: 'order', side, kind });
    return '';
  }
  if (p.cdFocus > 0) return 'attente';
  const ent = entityAt(b, 1 - side, x, y);
  p.focusSeq++; p.focus = { seq: p.focusSeq, ref: ent ? ent.id : 0, x: ent ? ent.x : x, y: ent ? ent.y : y, t: ORDER.focus };
  p.defendT = 0; p.cdFocus = ORDER.cdFocus;
  ev(b, { type: 'order', side, kind, ref: p.focus.ref, x: p.focus.x, y: p.focus.y });
  return '';
}
// L'ennemi (animal ou tour) sous le doigt
export function entityAt(b, side, x, y) {
  let best = null, bd = Infinity;
  for (const u of b.units) if (u.side === side && !u.dead) { const d = Math.hypot(u.x - x, (u.y - (u.air ? 80 : 26)) - y) - u.r - 30; if (d < 0 && d < bd) { bd = d; best = u; } }
  if (best) return best;
  for (const t of b.towers) if (t.side === side && !t.dead && Math.hypot(t.x - x, t.y - 40 - y) < t.r + 50) return t;
  return null;
}

// ---------- un pas de simulation ----------
export function step(b) {
  const dt = TICK;
  b.t += dt;
  if (b.over) { b.endT += dt; for (const u of b.units) { if (u.dead) u.deadT += dt; u.px = u.x; u.py = u.y; u.moving = false; if (u.atk) { u.atkT += dt; if (u.atkT >= u.atk.dur) u.atk = null; } } advanceProjs(b, dt, true); return; }
  // horloge, Aura
  b.clock -= dt;
  if (!b.overtime && !b.double && b.clock <= DOUBLE_AT) { b.double = true; ev(b, { type: 'double' }); }
  for (const p of b.players) {
    p.aura = Math.min(AURA.max, p.aura + dt / (AURA.every / (b.double || b.overtime ? 2 : 1)));
    p.cdDefend = Math.max(0, p.cdDefend - dt); p.cdFocus = Math.max(0, p.cdFocus - dt);
    if (p.defendT > 0) p.defendT -= dt;
    if (p.focus) { p.focus.t -= dt; const e = p.focus.ref && b.ents.get(p.focus.ref); if (p.focus.t <= 0 || (p.focus.ref && (!e || e.dead))) p.focus = null; else if (e) { p.focus.x = e.x; p.focus.y = e.y; } }
  }
  for (const u of b.units) { u.px = u.x; u.py = u.y; if (u.dead) { u.deadT += dt; continue; } updateUnit(b, u, dt); }
  for (const t of b.towers) if (!t.dead) updateTower(b, t, dt);
  advanceProjs(b, dt, false);
  updateClouds(b, dt);
  separate(b);
  // on oublie les morts (après leur petite animation)
  if (b.units.some((u) => u.dead && u.deadT > 1)) b.units = b.units.filter((u) => { if (u.dead && u.deadT > 1) { b.ents.delete(u.id); return false; } return true; });
  if (b.clock <= 0 && !b.over) {
    const [c0, c1] = [b.players[0].crowns, b.players[1].crowns];
    if (c0 !== c1) end(b, c0 > c1 ? 0 : 1, 'time');
    else if (!b.overtime) { b.overtime = true; b.clock = OVERTIME; ev(b, { type: 'overtime' }); }
    else {    // fin des prolongations : la tour la plus abîmée perd
      const low = (s) => Math.min(...b.towers.filter((t) => t.side === s && !t.dead).map((t) => t.hp / t.maxHp));
      const l0 = low(0), l1 = low(1);
      end(b, Math.abs(l0 - l1) < 1e-6 ? -1 : l0 > l1 ? 0 : 1, 'hp');
    }
  }
}
// Abandon : l'adversaire gagne avec trois couronnes
export function forfeit(b, side) { if (b.over) return; b.players[1 - side].crowns = 3; end(b, 1 - side, 'forfeit'); }
function end(b, winner, why) {
  if (b.over) return;
  b.over = true; b.winner = winner; b.endT = 0;
  for (const u of b.units) { u.atk = null; }
  ev(b, { type: 'end', winner, why });
}

// ---------- les animaux ----------
const canHit = (u, e) => !!e && !e.dead && e.side !== u.side && (e.kind === 'tower' || (u.s.targets !== 'buildings' && (!e.air || u.s.targets === 'all')));
function laneTower(b, u) {
  const lane = u.x < MID_X ? 'left' : 'right';
  const side = b.towers.find((t) => t.side !== u.side && t.lane === lane && !t.dead);
  if (side) return side;
  const main = b.towers.find((t) => t.side !== u.side && t.role === 'main' && !t.dead);
  return main || b.towers.find((t) => t.side !== u.side && !t.dead) || null;
}
// Cherche une cible. near : seulement à portée d'attaque. home : seulement les ennemis entrés dans notre moitié.
function acquire(b, u, { near = false, home = false } = {}) {
  let best = null, bs = Infinity;
  const reach = near ? u.s.range * TILE + 4 : u.s.sight * TILE;
  if (u.s.targets !== 'buildings') {
    for (const e of b.units) {
      if (e.dead || e.side === u.side || !canHit(u, e)) continue;
      if (home && !onMyHalf(u.side, e.y)) continue;
      const d = edge(u, e); if (d > reach) continue;
      const sc = d - (e.s.taunt && d < e.s.taunt * TILE ? 2.5 * TILE : 0);
      if (sc < bs) { bs = sc; best = e; }
    }
  }
  if (!home) for (const t of b.towers) {
    if (t.dead || t.side === u.side) continue;
    const d = edge(u, t); if (d > reach) continue;
    if (d < bs) { bs = d; best = t; }
  }
  return best;
}
function updateUnit(b, u, dt) {
  if (u.spawn > 0) { u.spawn -= dt; if (u.spawn <= 0) ev(b, { type: 'arrive', uid: u.id, id: u.aid, x: u.x, y: u.y }); return; }
  if (u.armorT > 0) u.armorT -= dt;
  if (u.buffT > 0) { u.buffT -= dt; if (u.buffT <= 0) u.buff = null; }
  if (u.kt > 0) { const k = Math.min(dt, u.kt); u.x += u.kx * k; u.y += u.ky * k; u.kt -= dt; u.run = 0; u.charging = false; }
  if (u.stun > 0) { u.stun -= dt; u.atk = null; u.moving = false; return; }
  u.cd -= dt;
  const p = b.players[u.side];
  // attaque en cours
  if (u.atk) {
    u.atkT += dt;
    if (!u.hitDone && u.atkT >= u.atk.windup) { u.hitDone = true; hit(b, u); if (!u.atk || b.over) return; }
    if (u.atkT >= u.atk.dur) u.atk = null;
    else { u.moving = false; return; }
  }
  // ordres du joueur
  const focus = p.focus && u.focusDone !== p.focus.seq ? p.focus : null;
  const defend = p.defendT > 0;
  let tgt = u.target ? b.ents.get(u.target) : null, dest = null;
  if (!canHit(u, tgt)) tgt = null;
  const inRange = (e) => !!e && edge(u, e) <= u.s.range * TILE + 6;
  const fEnt = focus && focus.ref ? b.ents.get(focus.ref) : null;
  u.retarget -= dt;
  if (fEnt && canHit(u, fEnt)) tgt = fEnt;            // Attaquer sur un ennemi ou une tour : on ne lâche plus cette cible
  else if (focus && !focus.ref) {                      // Attaquer sur un endroit : on y va, en ne frappant que ce qui est à portée
    if (!inRange(tgt)) tgt = acquire(b, u, { near: true });
    if (!tgt) { dest = focus; if (Math.hypot(u.x - focus.x, u.y - focus.y) < 1.3 * TILE) u.focusDone = focus.seq; }
  } else if (defend) {                                 // Siffler : retour au camp, on ne s'occupe que des ennemis entrés chez nous
    if (tgt && (tgt.kind === 'tower' || !onMyHalf(u.side, tgt.y))) tgt = null;
    if (!inRange(tgt) && (!tgt || u.retarget <= 0)) { tgt = acquire(b, u, { home: true }); u.retarget = 0.3; }
    if (!tgt) dest = { x: u.x < MID_X ? 215 : 726, y: mirrorY(u.side, GUARD_Y) };
  } else if (!inRange(tgt) && (!tgt || u.retarget <= 0)) {
    tgt = acquire(b, u) || laneTower(b, u); u.retarget = 0.25;
  }
  u.target = tgt ? tgt.id : 0;
  if (tgt) {
    const d = edge(u, tgt);
    if (d <= u.s.range * TILE + 6) {
      u.moving = false; face(u, tgt.x - u.x, tgt.y - u.y);
      if (u.cd <= 0) startAttack(b, u, tgt, d);
      return;
    }
    dest = tgt;
  }
  if (dest) moveTo(b, u, dest.x, dest.y, dt); else u.moving = false;
}
function face(u, dx, dy) { const l = Math.hypot(dx, dy); if (l > 0.01) { u.fx = dx / l; u.fy = dy / l; } }
function startAttack(b, u, tgt, d) {
  const A = u.s.attacks;
  u.count++;
  let a = A.normal, special = false;
  if (A.melee && d < 1.2 * TILE) a = A.melee;
  else if (A.special && u.count % A.special.every === 0) { a = A.special; special = true; }
  u.atk = a; u.atkT = 0; u.hitDone = false; u.atkTarget = tgt.id; u.atkX = tgt.x; u.atkY = tgt.y;
  u.chargeHit = u.charging; u.charging = false; u.run = 0;
  const haste = u.buff ? 1 + u.buff.speed : 1;
  u.cd = u.s.hitEvery / haste;
  ev(b, { type: 'attack', uid: u.id, id: u.aid, special, anim: a.anim, charge: u.chargeHit, x: u.x, y: u.y });
}
// Le coup part : au contact, ou un projectile
function hit(b, u) {
  const a = u.atk, tgt = b.ents.get(u.atkTarget);
  const live = tgt && !tgt.dead;
  const tx = live ? tgt.x : u.atkX, ty = live ? tgt.y : u.atkY;
  const dmg = u.s.dmg * a.mult * (u.buff ? 1 + u.buff.dmg : 1) * (u.chargeHit ? u.s.charge.mult : 1);
  const info = { side: u.side, aid: u.aid, a, dmg, src: u.id, sx: u.x, sy: u.y, charge: u.chargeHit };
  if (a.proj) {
    const pr = { side: u.side, x: u.x + u.fx * u.r, y: u.y - (u.air ? 70 : 34), sx: u.x, sy: u.y - 34, tx, ty, target: live ? tgt.id : 0, speed: a.projSpeed * TILE, key: a.proj, arc: !!a.arc, info, t: 0 };
    pr.T = Math.max(0.15, Math.hypot(tx - pr.x, ty - pr.y) / pr.speed);
    b.projs.push(pr); ev(b, { type: 'proj', id: u.aid, key: a.proj });
    if (a.heal) healAround(b, u, a);
    return;
  }
  if (live && edge(u, tgt) <= u.s.range * TILE + 0.8 * TILE) impact(b, info, tgt, tgt.x, tgt.y);
  else if (a.splash) impact(b, info, null, tx, ty);
  else ev(b, { type: 'miss', uid: u.id, x: tx, y: ty });
  if (a.heal) healAround(b, u, a);
  if (a.buff) buffAround(b, u, a.buff);
  if (a.armor) { u.armorT = a.armor.dur; ev(b, { type: 'armor', uid: u.id, x: u.x, y: u.y }); }
}
// Les dégâts arrivent : cible principale, dégâts de zone, recul, étourdissement, nuage
function impact(b, info, tgt, x, y) {
  const a = info.a, hitList = [];
  if (tgt && !tgt.dead) { damage(b, tgt, info.dmg, info); hitList.push(tgt); }
  if (a.splash) {
    const cx = a.splashTroops ? info.sx : x, cy = a.splashTroops ? info.sy : y, R = a.splash * TILE;
    for (const e of b.units) {
      if (e.dead || e.side === info.side || e === tgt) continue;
      if (e.air && !(ANIMALS[info.aid].targets === 'all' || a.gust)) continue;
      if (Math.hypot(e.x - cx, e.y - cy) - e.r > R) continue;
      damage(b, e, info.dmg * a.splashMult, info, true); hitList.push(e);
    }
    if (!a.splashTroops) for (const t of b.towers) if (!t.dead && t.side !== info.side && t !== tgt && Math.hypot(t.x - cx, t.y - cy) - t.r < R) damage(b, t, info.dmg * a.splashMult * 0.5, info, true);
    ev(b, { type: 'splash', id: info.aid, x: cx, y: cy, r: R, water: !!a.water, gust: !!a.gust, special: a === ANIMALS[info.aid].attacks.special });
  }
  const knock = (a.knock || 0) + (info.charge ? ANIMALS[info.aid].charge.knock : 0);
  for (const e of hitList) {
    if (e.kind !== 'unit' || e.dead) continue;
    if (knock) {
      const dx = e.x - info.sx, dy = e.y - info.sy, l = Math.hypot(dx, dy) || 1, k = knock * TILE * (e.mass >= 12 ? 0.35 : e.mass >= 8 ? 0.65 : 1);
      e.kx = dx / l * k / 0.22; e.ky = dy / l * k / 0.22; e.kt = 0.22;
    }
    if (a.stun) { e.stun = Math.max(e.stun, a.stun); e.atk = null; ev(b, { type: 'stun', uid: e.id, x: e.x, y: e.y }); }
  }
  if (a.cloud) { b.clouds.push({ side: info.side, x, y, r: a.cloud.r * TILE, dps: a.cloud.dps * (info.dmg / (ANIMALS[info.aid].dmg * a.mult)), t: a.cloud.dur, acc: 0, T: a.cloud.dur, aid: info.aid }); ev(b, { type: 'cloud', x, y }); }
}
function healAround(b, u, a) {
  const R = a.healR * TILE, amount = u.s.heal || a.heal; let n = 0;
  for (const e of b.units) if (!e.dead && e.side === u.side && Math.hypot(e.x - u.x, e.y - u.y) - e.r < R && e.hp < e.maxHp) { e.hp = Math.min(e.maxHp, e.hp + amount); n++; ev(b, { type: 'heal', uid: e.id, amount, x: e.x, y: e.y }); }
  ev(b, { type: 'healwave', uid: u.id, x: u.x, y: u.y, r: R, n });
}
function buffAround(b, u, bf) {
  for (const e of b.units) if (!e.dead && e.side === u.side && Math.hypot(e.x - u.x, e.y - u.y) - e.r < bf.r * TILE) { e.buff = bf; e.buffT = bf.dur; ev(b, { type: 'buff', uid: e.id, x: e.x, y: e.y }); }
  ev(b, { type: 'roar', uid: u.id, x: u.x, y: u.y, r: bf.r * TILE });
}
export function damage(b, e, amount, info, splash = false) {
  if (e.dead || b.over) return;
  if (e.kind === 'unit' && e.armorT > 0) amount *= 1 - ANIMALS[e.aid].attacks.special.armor.cut;
  amount = Math.max(1, Math.round(amount));
  e.hp -= amount;
  if (e.kind === 'tower') { if (!e.active) { e.active = true; ev(b, { type: 'wake', tid: e.id }); } e.shotT = 0; }
  ev(b, { type: 'hit', id: e.id, kind: e.kind, amount, x: e.x, y: e.y, by: info ? info.aid : null, splash, air: !!e.air, side: e.side, charge: info && info.charge });
  if (e.hp <= 0) kill(b, e, info);
}
function kill(b, e, info) {
  e.hp = 0; e.dead = true; e.deadT = 0; e.atk = null;
  const foe = b.players[1 - e.side];
  if (e.kind === 'unit') { foe.kos++; ev(b, { type: 'death', uid: e.id, id: e.aid, side: e.side, x: e.x, y: e.y, air: e.air }); return; }
  // une tour tombe
  const crowns = e.role === 'main' ? 3 - foe.crowns : 1;
  foe.crowns = Math.min(3, foe.crowns + crowns);
  ev(b, { type: 'tower_down', tid: e.id, side: e.side, role: e.role, lane: e.lane, x: e.x, y: e.y, crowns: foe.crowns });
  if (e.role === 'side') { const m = b.towers.find((t) => t.side === e.side && t.role === 'main'); if (m && !m.active) { m.active = true; ev(b, { type: 'wake', tid: m.id }); } }
  if (e.role === 'main') { for (const t of b.towers) if (t.side === e.side && !t.dead) { t.hp = 0; t.dead = true; ev(b, { type: 'tower_down', tid: t.id, side: t.side, role: t.role, lane: t.lane, x: t.x, y: t.y, crowns: foe.crowns, chain: true }); } end(b, foe.side, 'main'); }
  else if (b.overtime) end(b, foe.side, 'overtime');
}

// Déplacement : les animaux au sol passent la rivière par un pont ; les animaux volants vont tout droit
function moveTo(b, u, tx, ty, dt) {
  let wx = tx, wy = ty;
  if (!u.air) {
    const bank = (y) => (y >= RIVER[1] ? 1 : y <= RIVER[0] ? -1 : 0);     // 1 : rive du bas, -1 : rive du haut, 0 : sur la rivière
    const su = bank(u.y), st = bank(ty);
    if (su !== st) {
      const bx = Math.abs(u.x - BRIDGES[0]) + Math.abs(tx - BRIDGES[0]) <= Math.abs(u.x - BRIDGES[1]) + Math.abs(tx - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
      const lim = Math.max(8, BRIDGE_W - u.r * 0.6);
      if (Math.abs(u.x - bx) > lim) { wx = bx; wy = su > 0 ? RIVER[1] + 16 : su < 0 ? RIVER[0] - 16 : u.y; }      // d'abord l'entrée du pont
      else { wx = Math.max(bx - lim, Math.min(bx + lim, tx)); wy = st > 0 ? RIVER[1] + 30 : st < 0 ? RIVER[0] - 30 : ty; }   // puis tout droit
    }
  }
  const dx = wx - u.x, dy = wy - u.y, l = Math.hypot(dx, dy);
  if (l < 1) { u.moving = false; return; }
  if (u.s.charge && u.run >= u.s.charge.after * TILE && !u.charging) { u.charging = true; ev(b, { type: 'charge', uid: u.id, x: u.x, y: u.y }); }
  const spd = (u.charging ? u.s.charge.speed : u.s.speed) * TILE * (u.buff ? 1 + u.buff.speed : 1);
  const k = Math.min(l, spd * dt);
  u.x += dx / l * k; u.y += dy / l * k; u.run += k;
  u.moving = true; face(u, dx, dy);
}

// ---------- les tours ----------
function updateTower(b, t, dt) {
  t.shotT += dt;
  if (!t.active) return;
  t.cd -= dt;
  let tgt = t.target ? b.ents.get(t.target) : null;
  if (!tgt || tgt.dead || tgt.spawn > 0 || Math.hypot(tgt.x - t.x, tgt.y - t.y) - tgt.r > t.range) {
    tgt = null; let bd = Infinity;
    for (const u of b.units) { if (u.dead || u.side === t.side || u.spawn > 0) continue; const d = Math.hypot(u.x - t.x, u.y - t.y) - u.r; if (d <= t.range && d < bd) { bd = d; tgt = u; } }
    t.target = tgt ? tgt.id : 0;
  }
  if (tgt && t.cd <= 0) {
    t.cd = t.hitEvery;
    const pr = { side: t.side, x: t.x, y: t.y - (t.role === 'main' ? 150 : 120), tx: tgt.x, ty: tgt.y, target: tgt.id, speed: (t.role === 'main' ? 11 : 14) * TILE, key: t.proj, arc: false, t: 0,
      info: { side: t.side, aid: null, a: { mult: 1 }, dmg: t.dmg, src: t.id, sx: t.x, sy: t.y, tower: true } };
    pr.T = Math.hypot(pr.tx - pr.x, pr.ty - pr.y) / pr.speed;
    b.projs.push(pr); ev(b, { type: 'shot', tid: t.id, role: t.role, x: pr.x, y: pr.y });
  }
}

// ---------- projectiles et nuages ----------
function advanceProjs(b, dt, frozen) {
  for (let i = b.projs.length - 1; i >= 0; i--) {
    const p = b.projs[i]; p.t += dt;
    const tg = p.target ? b.ents.get(p.target) : null;
    if (!p.arc && tg && !tg.dead) { p.tx = tg.x; p.ty = tg.y - (tg.air ? 70 : 20); }
    p.px = p.x; p.py = p.y;
    if (p.arc) {
      const k = Math.min(1, p.t / p.T); p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k - Math.sin(Math.PI * k) * 140; p.k = k;
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
  if (p.info.tower) { if (live) damage(b, tg, p.info.dmg, p.info); return; }
  if (p.info.a.splash) impact(b, p.info, live && Math.hypot(tg.x - p.tx, tg.y - p.ty) < tg.r + 30 ? tg : null, p.tx, p.ty);
  else if (live) impact(b, p.info, tg, tg.x, tg.y);
  ev(b, { type: 'land', key: p.key, x: p.tx, y: p.ty, splash: !!p.info.a.splash });
}
function updateClouds(b, dt) {
  for (let i = b.clouds.length - 1; i >= 0; i--) {
    const c = b.clouds[i]; c.t -= dt; c.acc += dt;
    if (c.acc >= 0.5) {
      c.acc -= 0.5;
      const info = { side: c.side, aid: c.aid, a: { mult: 1 }, dmg: 0, sx: c.x, sy: c.y };
      for (const e of b.units) if (!e.dead && e.side !== c.side && Math.hypot(e.x - c.x, e.y - c.y) - e.r < c.r) { damage(b, e, c.dps * 0.5, info, true); e.poisonT = 0.6; }
      for (const t of b.towers) if (!t.dead && t.side !== c.side && Math.hypot(t.x - c.x, t.y - c.y) - t.r < c.r) damage(b, t, c.dps * 0.5 * 0.35, info, true);
    }
    if (c.t <= 0) b.clouds.splice(i, 1);
  }
}

// ---------- les corps ne se chevauchent pas ----------
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
    if (!a.air) for (const t of b.towers) {
      if (t.dead) continue;
      const dx = a.x - t.x, dy = a.y - t.y, d = Math.hypot(dx, dy), min = a.r + t.r * 0.9;
      if (d < min) { const l = d || 1; a.x = t.x + dx / l * min; a.y = t.y + (dy || 1) / l * min; }
    }
  }
  for (const u of us) {
    if (u.dead) continue;
    u.x = Math.max(16 + u.r * 0.5, Math.min(FW - 16 - u.r * 0.5, u.x)); u.y = Math.max(20, Math.min(FH - 14, u.y));
    if (!u.air && u.y > RIVER[0] && u.y < RIVER[1]) {
      const onBridge = BRIDGES.some((bx) => Math.abs(u.x - bx) <= BRIDGE_W);
      if (!onBridge) {
        const bx = Math.abs(u.x - BRIDGES[0]) < Math.abs(u.x - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
        if (Math.abs(u.x - bx) < BRIDGE_W + 30) u.x = bx + Math.sign(u.x - bx) * BRIDGE_W;
        else u.y = u.y - RIVER[0] < RIVER[1] - u.y ? RIVER[0] : RIVER[1];
      }
    }
  }
}

// Résumé de fin pour l'écran de résultats
export function summary(b, side) {
  const me = b.players[side], foe = b.players[1 - side];
  return { win: b.winner === side, draw: b.winner === -1, crowns: me.crowns, lost: foe.crowns, kos: me.kos, aura: Math.round(me.spent) };
}
