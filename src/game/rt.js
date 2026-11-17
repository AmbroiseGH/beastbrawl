// Le moteur des combats en temps réel sur la grande arène : deux camps (0 = bleu, en bas ; 1 = rouge, en haut), de
// l'Aura qui se recharge, des animaux posés depuis une main de 4 cartes. On gagne en détruisant le camp adverse (sinon,
// à la fin du temps, le camp le moins abîmé gagne). Sur la carte :
//   - une catapulte par camp, poussée par le tutomonkey : au camp, elle bombarde les ennemis qui approchent ; au centre,
//     elle lance des rochers sur le camp adverse. Cassée, le singe la répare sur place ;
//   - le camp le plus abîmé recharge plus vite son Aura, sa catapulte tire et se répare plus vite ;
//   - les deux tours latérales : casser la cage libère un singe qui bombarde les animaux adverses ;
//   - les boîtes : les casser donne un bonus tiré au sort (allié en plus, fruits, rage, Aura) ;
//   - la rivière : les animaux aquatiques y sont posés et n'en sortent jamais.
// Pas de dessin ici : le moteur avance par pas fixes et range dans b.events ce qui s'est passé, pour que l'affichage
// et les sons suivent. Coordonnées : pixels de la carte (1536 × 1024), y vers le bas. Rien d'aléatoire hors de b.rng.
import { ANIMALS, statsAt, STRUCTS, levelK } from '../data/animals.js';
import { makeRng } from '../core/rng.js';
import { MAP_W, MAP_H, CRATES, CELL } from '../data/map.js';
import { zoneAt, walkable, swimmable, swimHome, swimNear, nearest, findPath, los, waterNear } from './nav.js';

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
const REGEN = { r: 4.5, rate: 0.06, calm: 2 };  // près de sa tente (dans l'eau de son camp pour un nageur), un animal au calme récupère
const HOLD_LEASH = 2.6;                         // un animal posté ne poursuit pas plus loin (cases)
const BONUS = [['monkey', 22], ['kitten', 18], ['fruit', 25], ['rage', 25], ['aura', 10]];
export const BONUS_FX = { fruitR: 4, fruit: 0.35, rageR: 4, rage: { dmg: 0.5, speed: 0.3, dur: 8 }, aura: 2 };
export const CAMPS = {
  hp: 4000,                                     // vie d'un camp (fois le niveau des decks)
  aura: 80,                                     // retard (points) qui fait recharger l'Aura deux fois plus vite (+50 % à mi-chemin)
};
// centre du camp (ellipse rx 110, ry 40), point visé par les coups, haut de la tente
export const CAMP_POS = [{ x: 767, y: 868, aimY: 846, topY: 812 }, { x: 767, y: 88, aimY: 112, topY: 92 }];
// Les nageurs attaquent un camp depuis ces deux points d'eau (de chaque côté du camp, à la même distance pour les deux camps)
export const SIEGE = [[[572, 940], [956, 940]], [[644, 84], [892, 84]]];
// Les catapultes : la route que le singe leur fait suivre, du camp (premier point) au centre (dernier point). Au centre,
// la bleue se place un peu à gauche, tournée vers le camp rouge, et la rouge un peu à droite, tournée vers le camp bleu.
export const CATA_ROAD = [
  [[702, 796], [748, 758], [767, 716], [767, 650], [742, 600], [712, 548]],
  [[832, 226], [786, 264], [767, 306], [767, 372], [792, 410], [822, 436]],
];
export const CATA = {
  hp: 1800,                                     // vie (fois le niveau des decks)
  speed: 1.1,                                   // cases par seconde quand le singe la pousse
  repair: 10,                                   // secondes de réparation une fois cassée
  rx: 30, ry: 16,                               // taille au sol (ellipse)
  def: { dmg: 170, every: 2.4, range: 10.5, splash: 1.1, splashMult: 0.6, knock: 0.3 },    // au camp : des pierres sur qui approche
  atk: { every: 11, hit: 0.05, first: 4 },      // au centre : un rocher toutes les 11 s, 5 % de la vie du camp adverse ; premier tir 4 s après l'arrivée
  wind: 0.42, dur: 0.95,                        // le bras se tend (le tir part à « wind ») puis revient
  catchup: 30,                                  // retard (points) qui fait tirer et réparer deux fois plus vite
};
// Retard d'un camp, en points : part de vie perdue par son camp moins celle du camp adverse (0 s'il mène)
export function behind(b, side) {
  const m = b.camps[side], f = b.camps[1 - side];
  return Math.max(0, 100 * (f.hp / f.maxHp - m.hp / m.maxHp));
}
// Coup de pouce de la catapulte du camp mené : elle tire et se répare plus vite (jusqu'à deux fois)
export const cataBoost = (b, side) => 1 + Math.min(1, behind(b, side) / CATA.catchup);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// distance de bord à bord entre un animal (posé en x, y) et une cible (les structures sont des ellipses). Un nageur
// attaque un camp depuis ses points d'eau (SIEGE).
function edgeAt(u, e, x, y) {
  if (u.swim && e.kind === 'camp') { let d = Infinity; for (const [sx, sy] of SIEGE[e.side]) d = Math.min(d, Math.hypot(x - sx, y - sy)); return d - u.r - 6; }
  if (e.rx) { const q = Math.hypot((x - e.x) / e.rx, (y - e.y) / e.ry); return (q - 1) * Math.min(e.rx, e.ry) - u.r; }
  return Math.hypot(x - e.x, y - e.y) - u.r - e.r;
}
const edge = (u, e) => edgeAt(u, e, u.x, u.y);
const ev = (b, e) => b.events.push(e);
// le point d'eau le plus proche d'où un nageur peut frapper ce camp
const siegeOf = (side, x, y) => SIEGE[side].reduce((a, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? p : a));
// Un nageur peut-il atteindre cette cible depuis la rivière ? (les autres : toujours)
function reachable(u, e) {
  if (!u.swim || !e || e.kind === 'camp' || e.swim) return true;
  const w = swimNear(e.x, e.y); if (!w) return false;
  return w.d - (e.rx ? Math.min(e.rx, e.ry) : e.r || 0) - u.r <= u.s.range * TILE + 4;
}

// ---------- création ----------
// decks : [[{ id, level }…], […]] ; towerLevels : niveau moyen de chaque deck ; seed : graine du combat
export function createBattle({ decks, towerLevels = [1, 1], seed = 1 }) {
  const rng = makeRng(seed);
  const lv = [towerLevels[0] || 1, towerLevels[1] || 1], lvK = (levelK(lv[0]) + levelK(lv[1])) / 2;
  const b = { t: 0, clock: DURATION, overtime: false, double: false, over: false, winner: -1, endT: 0, why: '', mode: 'camps', camps: null, catas: null,
    units: [], structs: [], towers: [], crates: [], projs: [], clouds: [], events: [], ents: new Map(), nextId: 1, rng, players: [], levels: lv, lvK };
  for (let s = 0; s < 2; s++) {
    const cards = decks[s].filter((c) => ANIMALS[c.id]).map((c) => ({ id: c.id, level: c.level || 1, cost: ANIMALS[c.id].cost }));
    const order = cards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const hand = [0, 1, 2, 3].map(() => (order.length ? order.shift() : -1));
    b.players.push({ side: s, cards, hand, queue: order, aura: AURA.start, kos: 0, spent: 0, played: 0, crates: 0, towers: 0, shots: 0, breaks: 0 });
  }
  const add = (o) => { o.id = b.nextId++; o.dead = false; o.air = false; b.structs.push(o); b.ents.set(o.id, o); return o; };
  for (const lane of ['L', 'R']) {
    const P = TOWER_POS[lane], hp = Math.round(STRUCTS.tower.hp * lvK);
    b.towers.push(add({ kind: 'tower', lane, side: -1, x: P.x, y: P.y, rx: 85, ry: 128, aimX: P.x, aimY: P.y - 20, topY: P.topY, hp, maxHp: hp, taken: 0, cd: 0, shotT: 9, target: 0 }));
  }
  b.camps = [0, 1].map((s) => { const P = CAMP_POS[s], hp = Math.round(CAMPS.hp * lvK); return add({ kind: 'camp', side: s, x: P.x, y: P.y, rx: 110, ry: 40, aimX: P.x, aimY: P.aimY, topY: P.topY, hp, maxHp: hp, hurtT: 9 }); });
  b.catas = [0, 1].map((s) => {
    const R = CATA_ROAD[s], hp = Math.round(CATA.hp * lvK);
    let len = 0; for (let i = 1; i < R.length; i++) len += Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]);
    return add({ kind: 'cata', side: s, x: R[0][0], y: R[0][1], rx: CATA.rx, ry: CATA.ry, aimX: R[0][0], aimY: R[0][1] - 22, hp, maxHp: hp,
      want: 'camp', at: 'camp', pos: 0, len, fx: 0, fy: s === 0 ? -1 : 1, cd: 1, fire: null, target: 0, repairT: 0, moving: false, hurtT: 9 });
  });
  CRATES.forEach(([x, y], i) => {
    const hp = Math.round(STRUCTS.crate.hp * lvK);
    b.crates.push(add({ kind: 'crate', n: i, side: -1, x, y: y - 20, rx: 44, ry: 24, aimX: x, aimY: y - 30, hp, maxHp: hp, respawnT: 0 }));
  });
  return b;
}
export const handOf = (b, side) => b.players[side].hand.map((i) => (i >= 0 ? b.players[side].cards[i] : null));
export const nextOf = (b, side) => { const p = b.players[side]; const i = p.queue[0]; return i === undefined ? null : p.cards[i]; };

// ---------- où peut-on poser ? ----------
// Zones de pose d'un camp : sa zone, plus la zone latérale de chaque tour qu'il tient. Les nageurs : l'eau de son camp.
export function deployZones(b, side) {
  const z = [HOME_ZONE[side]];
  for (const t of b.towers) if (t.side === side) z.push(SIDE_ZONE[t.lane]);
  return z;
}
const isSwim = (id) => !!(id && ANIMALS[id] && ANIMALS[id].swim);
const inCrate = (b, x, y, pad = 0) => b.crates.some((c) => !c.dead && Math.hypot((x - c.x) / (c.rx + pad), (y - c.y) / (c.ry + pad)) < 1);
export function canDeploy(b, side, x, y, id = null) {
  if (isSwim(id)) return swimHome(side, x, y);
  return deployZones(b, side).includes(zoneAt(x, y)) && !inCrate(b, x, y, 4);
}
// Point de pose le plus proche dans une zone autorisée (pour l'IA et le doigt qui déborde)
export function clampDeploy(b, side, x, y, id = null) {
  if (isSwim(id)) return nearest(x, y, (px, py) => swimHome(side, px, py), true) || { x: side === 0 ? 572 : 964, y: side === 0 ? 940 : 84 };
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
  if (!canDeploy(b, side, x, y, card.id)) return 'zone';
  p.aura -= card.cost; p.spent += card.cost; p.played++;
  p.queue.push(ci); p.hand[slot] = p.queue.shift();
  const made = spawn(b, side, card.id, card.level, x, y);
  // posé au pied d'une boîte ou d'une tour à prendre : il s'en occupe d'abord
  let near = null, nd = 3.5 * TILE;
  for (const s of b.structs) {
    if (s.dead || s.side === side || s.kind === 'camp' || s.kind === 'cata' || !reachable(made[0], s)) continue;
    const d = edge({ x, y, r: 0 }, s); if (d < nd) { nd = d; near = s; }
  }
  if (near) for (const u of made) u.order = { ref: near.id, auto: true };
  ev(b, { type: 'deploy', side, id: card.id, x, y, cost: card.cost, ids: made.map((u) => u.id), swim: isSwim(card.id) });
  return '';
}
const FORM = { 1: [[0, 0]], 2: [[-0.55, 0.1], [0.55, -0.1]], 3: [[0, -0.5], [-0.55, 0.4], [0.55, 0.4]] };
function spawn(b, side, id, level, x, y, delay = DEPLOY_DELAY, count = 0) {
  const s = statsAt(id, level), n = count || s.count || 1, out = [], swim = !!s.swim;
  for (const [ox, oy] of FORM[n] || FORM[1]) {
    let ux = x + ox * TILE, uy = y + oy * TILE;
    if (!s.air && !(swim ? swimmable(ux, uy) : walkable(ux, uy))) { ux = x; uy = y; }
    const u = { id: b.nextId++, kind: 'unit', side, aid: id, level, s, x: ux, y: uy, px: ux, py: uy, r: s.radius * TILE, air: !!s.air, swim, mass: s.mass,
      hp: s.hp, maxHp: s.hp, spawn: delay, target: 0, retarget: 0, atk: null, atkT: 0, hitDone: true, cd: 0, count: 0,
      fx: 0, fy: side === 0 ? -1 : 1, moving: false, stun: 0, kx: 0, ky: 0, kt: 0, buffT: 0, buff: null, run: 0, charging: false, chargeHit: false,
      order: null, path: null, pathT: 0, healing: false, shield: 0, shieldT: 0, slowT: 0, slowK: 0, poison: null, rage: 0, plate: 0, plateT: 0,
      guardT: 0, guardCd: 0, water: 0, waterT: 0, hurtT: 9, regenT: 0, dead: false, deadT: 0 };
    b.units.push(u); b.ents.set(u.id, u); out.push(u);
  }
  return out;
}

// ---------- ordres ----------
// Donne un ordre aux animaux « ids » du camp « side ». o : { ref } attaquer cette cible (animal adverse, boîte, tour,
// catapulte, camp), { x, y } aller à cet endroit et le tenir, { home: true } revenir à la tente, null : reprendre sa
// liberté. Renvoie le nombre d'animaux qui ont pris l'ordre (un nageur ne prend pas une cible hors de portée de l'eau).
export function command(b, side, ids, o) {
  if (b.over) return 0;
  let ref = 0;
  if (o && o.ref) { const e = b.ents.get(o.ref); if (!e || e.dead || e.side === side) return 0; ref = e.id; }
  let n = 0;
  for (const id of ids) {
    const u = b.ents.get(id); if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
    if (ref) { const e = b.ents.get(ref); if (!canHit(u, e) || !reachable(u, e)) continue; u.order = { ref }; }
    else if (o && o.home) { u.order = { home: true }; if (u.swim) u.homeAt = null; }
    else if (o && o.x !== undefined) {
      // chacun sa place autour du point : le premier au centre, les suivants en couronne
      const k = n === 0 ? 0 : 1 + Math.floor((n - 1) / 6), an = n * 1.0472 + k * 0.5, rr = k * 1.15 * TILE;
      let px = Math.max(20, Math.min(MAP_W - 20, o.x + Math.cos(an) * rr)), py = Math.max(20, Math.min(MAP_H - 20, o.y + Math.sin(an) * rr * 0.8));
      if (!u.air) { const q = nearest(px, py, null, u.swim); if (q) { px = q.x; py = q.y; } }
      u.order = { x: px, y: py };
    } else u.order = null;
    u.path = null; u.target = 0; u.healing = false; u.retarget = 0; n++;
  }
  if (n) ev(b, { type: 'order', side, n, ref, x: o && o.x, y: o && o.y, home: !!(o && o.home), free: !o });
  return n;
}
// La catapulte du camp « side » : want = 'camp' (défendre) ou 'centre' (attaquer). Le singe la pousse dès que possible.
export function setCata(b, side, want) {
  const c = b.catas[side]; if (b.over || (want !== 'camp' && want !== 'centre') || c.want === want) return false;
  c.want = want;
  ev(b, { type: 'cata_order', side, want, cid: c.id, x: c.x, y: c.y, broken: c.dead });
  return true;
}

// ---------- un pas de simulation ----------
export function step(b) {
  const dt = TICK;
  b.t += dt;
  if (b.over) {
    b.endT += dt;
    for (const u of b.units) { if (u.dead) u.deadT += dt; u.px = u.x; u.py = u.y; u.moving = false; if (u.atk) { u.atkT += dt; if (u.atkT >= u.atk.dur) u.atk = null; } }
    for (const c of b.catas) { c.moving = false; if (c.fire) { c.fire.t += dt; if (c.fire.t >= CATA.dur) c.fire = null; } }
    advanceProjs(b, dt, true); return;
  }
  b.clock -= dt;
  if (!b.overtime && !b.double && b.clock <= DOUBLE_AT) { b.double = true; ev(b, { type: 'double' }); }
  for (const p of b.players) {
    // le camp le plus abîmé recharge plus vite (+50 % à CAMPS.aura / 2 points de retard, le double à CAMPS.aura)
    const k = 1 + Math.min(1, behind(b, p.side) / CAMPS.aura);
    p.aura = Math.min(AURA.max, p.aura + k * dt / (AURA.every / (b.double || b.overtime ? 2 : 1)));
  }
  for (const u of b.units) { u.px = u.x; u.py = u.y; if (u.dead) { u.deadT += dt; continue; } updateUnit(b, u, dt); if (b.over) return; }
  for (const t of b.towers) updateTower(b, t, dt);
  for (const c of b.catas) { updateCata(b, c, dt); if (b.over) return; }
  for (const c of b.camps) c.hurtT += dt;
  for (const c of b.crates) if (c.dead) { c.respawnT -= dt; if (c.respawnT <= 0 && !b.units.some((u) => !u.dead && !u.air && !u.swim && Math.hypot((u.x - c.x) / (c.rx + u.r), (u.y - c.y) / (c.ry + u.r)) < 1)) { c.dead = false; c.hp = c.maxHp; ev(b, { type: 'crate_spawn', id: c.id, x: c.x, y: c.y }); } }
  advanceProjs(b, dt, false);
  if (b.over) return;
  updateClouds(b, dt);
  separate(b);
  if (b.units.some((u) => u.dead && u.deadT > 1)) b.units = b.units.filter((u) => { if (u.dead && u.deadT > 1) { b.ents.delete(u.id); return false; } return true; });
  if (b.clock <= 0 && !b.over) {
    // au temps, on compare la vie des camps (en part de leur vie)
    const [g0, g1] = [b.camps[0].hp / b.camps[0].maxHp * 100, b.camps[1].hp / b.camps[1].maxHp * 100];
    if (Math.abs(g0 - g1) > 0.5) end(b, g0 > g1 ? 0 : 1, b.overtime ? 'overtime' : 'time');
    else if (!b.overtime) { b.overtime = true; b.clock = OVERTIME; ev(b, { type: 'overtime' }); }
    else {    // toujours à égalité : les tours tenues, puis les K.-O., départagent
      const own = (s) => b.towers.filter((t) => t.side === s).length, d = own(0) - own(1) || b.players[0].kos - b.players[1].kos;
      end(b, d > 0 ? 0 : d < 0 ? 1 : -1, 'tie');
    }
  }
}
// Abandon : l'adversaire gagne, comme si notre camp était détruit
export function forfeit(b, side) {
  if (b.over) return;
  b.camps[side].hp = 0;
  end(b, 1 - side, 'forfeit');
}
function end(b, winner, why) {
  if (b.over) return;
  b.over = true; b.winner = winner; b.endT = 0; b.why = why;
  for (const u of b.units) { u.atk = null; }
  ev(b, { type: 'end', winner, why });
}

// ---------- les animaux ----------
// u peut-il frapper e ? Les nageurs ne sont touchés que par les volants et les autres nageurs, et ne touchent pas les volants.
function canHit(u, e) {
  if (!e || e.dead) return false;
  if (e.kind === 'unit') {
    if (e.side === u.side) return false;
    if (e.swim) return u.air || u.swim;
    if (e.air) return !u.swim && u.s.targets === 'all';
    return true;
  }
  if (e.kind === 'tower' || e.kind === 'camp' || e.kind === 'cata') return e.side !== u.side;
  return true;                                   // les boîtes : tout le monde peut les frapper
}
const aimX = (e) => (e.aimX !== undefined ? e.aimX : e.x), aimY = (e) => (e.aimY !== undefined ? e.aimY : e.y);
// portée (px) contre cette cible : l'éléphant qui a de l'eau arrose les animaux de loin
function rangeTo(u, e) {
  const sp = u.s.attacks.special;
  if (sp && sp.spray && u.water > 0 && e && e.kind === 'unit' && e.side !== u.side) return sp.spray.range * TILE;
  return u.s.range * TILE;
}
// Un ennemi à combattre. near : seulement ce qui est à portée de main. On ne se laisse pas attirer par un animal
// qui est de l'autre côté de l'eau, sauf si on peut déjà le toucher d'ici. Un nageur ne poursuit que les autres nageurs.
function acquire(b, u, near = false) {
  let best = null, bs = Infinity;
  const sight = near ? Math.max(u.s.range, 1.8) * TILE : u.s.sight * TILE, zu = u.air || u.swim ? -1 : zoneAt(u.x, u.y);
  for (const e of b.units) {
    if (e.dead || e.side === u.side || !canHit(u, e)) continue;
    const d = edge(u, e); if (d > sight) continue;
    if (u.swim) { if (d > rangeTo(u, e) && !(e.swim && los(u.x, u.y, e.x, e.y, true))) continue; }
    else if (!u.air && d > rangeTo(u, e) && zoneAt(e.x, e.y) !== zu && !los(u.x, u.y, e.x, e.y)) continue;
    const taunt = e.guardT > 0 ? e.s.attacks.special.guard.taunt : e.s.taunt || 0;
    const sc = d - (taunt && d < taunt * TILE ? 2.5 * TILE : 0);
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
// But d'un animal sans ordre ni ennemi en vue : la catapulte adverse s'il passe près d'elle, sinon le camp adverse.
// Un nageur ne craint pas la catapulte : il ne s'en prend à elle que si elle tire depuis le centre.
function goal(b, u) {
  const c = b.catas[1 - u.side];
  if (!c.dead && (!u.swim || c.at !== 'camp') && edge(u, c) < (u.s.sight + 1.5) * TILE && reachable(u, c)) return c;
  return b.camps[1 - u.side];
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
    if (u.swim) u.homeAt = nearest(u.x, u.y, (x, y) => swimHome(u.side, x, y), true) || { x: u.x, y: u.y };
    else {
      const B = BASE[u.side], an = u.id * 2.39996, rr = (0.9 + (u.id % 3) * 0.8) * TILE;
      u.homeAt = nearest(B.x + Math.cos(an) * rr * 1.6, B.y + Math.sin(an) * rr * 0.6, [HOME_ZONE[u.side]]) || { ...B };
    }
  }
  return u.homeAt;
}
const atHome = (u) => (u.swim ? swimHome(u.side, u.x, u.y) : dist(u, BASE[u.side]) < REGEN.r * TILE);
function updateUnit(b, u, dt) {
  if (u.spawn > 0) { u.spawn -= dt; if (u.spawn <= 0) ev(b, { type: 'arrive', uid: u.id, id: u.aid, x: u.x, y: u.y, swim: u.swim }); return; }
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
  // près de sa tente (ou dans l'eau de son camp), au calme : il récupère
  if (u.hp < u.maxHp && u.hurtT > REGEN.calm && atHome(u)) {
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
  ev(b, { type: 'attack', uid: u.id, id: u.aid, special, anim: a.anim, charge: u.chargeHit, x: u.x, y: u.y, heal: u.healing, swim: u.swim });
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
    const lift = u.air ? AIR_H + 8 : u.swim ? 8 : 18;
    const pr = { side: u.side, x: u.x + u.fx * u.r, y: u.y - lift, sx: u.x, sy: u.y - lift, tx, ty, target: live ? tgt.id : 0, speed: a.projSpeed * TILE, key: a.proj, arc: !!a.arc, arcH: 70, info, t: 0 };
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
// Les dégâts de zone touchent-ils cet animal ? (mêmes règles que canHit, plus : les tours touchent les volants, pas la catapulte)
function splashHits(info, e) {
  const A = info.aid ? ANIMALS[info.aid] : null;
  if (e.swim) return !!(A && (A.air || A.swim));
  if (e.air) return info.tower ? !info.cata : !!(A && !A.swim && (A.targets === 'all' || info.a.gust));
  return true;
}
// Les dégâts arrivent : cible principale, dégâts de zone, recul, étourdissement, ralentissement, nuage
function impact(b, info, tgt, x, y) {
  const a = info.a, hitList = [], A = info.aid ? ANIMALS[info.aid] : null;
  if (tgt && !tgt.dead) { damage(b, tgt, info.dmg, info); hitList.push(tgt); if (b.over) return; }
  if (a.splash) {
    const cx = a.around ? info.sx : x, cy = a.around ? info.sy : y, R = a.splash * TILE;
    for (const e of b.units) {
      if (e.dead || e.side === info.side || e === tgt || !splashHits(info, e)) continue;
      if (Math.hypot(e.x - cx, e.y - cy) - e.r > R) continue;
      damage(b, e, info.dmg * a.splashMult, info, true); hitList.push(e);
    }
    if (!info.tower) for (const s of b.structs) {
      if (s === tgt || s.dead || (s.side >= 0 && s.side === info.side)) continue;
      if ((Math.hypot((s.x - cx) / s.rx, (s.y - cy) / s.ry) - 1) * Math.min(s.rx, s.ry) < R) { damage(b, s, info.dmg * a.splashMult * 0.5, info, true); if (b.over) return; }
    }
    ev(b, { type: 'splash', id: info.aid, x: cx, y: cy, r: R, water: !!a.water || !!(A && A.swim), gust: !!a.gust, tower: !!info.tower, cata: !!info.cata, special: !!A && a === A.attacks.special });
  }
  const knock = (a.knock || 0) + (info.charge && A && A.charge ? A.charge.knock : 0);
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
  if (e.kind === 'unit') {
    if (e.guardT > 0) { ev(b, { type: 'block', uid: e.id, x: e.x, y: e.y }); return; }
    if (e.plate) amount *= 1 - e.plate * e.s.attacks.special.plate.add;
    if (e.shield > 0) {
      const ab = Math.min(e.shield, amount); e.shield -= ab; amount -= ab;
      if (e.shield <= 0.5) { e.shield = 0; e.shieldT = 0; ev(b, { type: 'shield_break', uid: e.id, x: e.x, y: e.y }); }
      if (amount < 1) { ev(b, { type: 'hit', id: e.id, kind: 'unit', amount: 0, x: e.x, y: e.y, by: info ? info.aid : null, splash, air: !!e.air, swim: !!e.swim, side: e.side, shield: true }); return; }
    }
  } else if (info && info.aid && ANIMALS[info.aid] && ANIMALS[info.aid].bldg) amount *= ANIMALS[info.aid].bldg;     // les nageurs abîment peu les structures
  amount = Math.max(1, Math.round(amount));
  e.hp -= amount;
  if (e.kind === 'unit' || e.kind === 'camp' || e.kind === 'cata') e.hurtT = 0;
  ev(b, { type: 'hit', id: e.id, kind: e.kind, amount, x: aimX(e), y: aimY(e), by: info ? info.aid : null, splash, air: !!e.air, swim: !!e.swim, side: e.side, charge: info && info.charge, dot: !!(info && info.dot), from: info ? info.side : -1, cata: !!(info && info.catapult) });
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
  if (e.kind === 'unit') { e.dead = true; e.deadT = 0; e.atk = null; b.players[1 - e.side].kos++; ev(b, { type: 'death', uid: e.id, id: e.aid, side: e.side, x: e.x, y: e.y, air: e.air, swim: e.swim }); return; }
  if (e.kind === 'cata') {                     // la catapulte est cassée : le singe la répare là où elle est
    e.dead = true; e.fire = null; e.moving = false; e.target = 0; e.repairT = CATA.repair;
    if (by >= 0) b.players[by].breaks++;
    ev(b, { type: 'cata_break', side: e.side, cid: e.id, x: e.x, y: e.y, by });
    return;
  }
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

// Déplacement : les animaux au sol suivent un chemin par les ponts, les nageurs par la rivière ; les volants vont tout
// droit. ent : la cible visée (on s'arrête à portée), sinon on va jusqu'au point.
function travel(b, u, dest, ent, dt) {
  let wx = dest.x, wy = dest.y;
  const swim = u.swim, okAt = swim ? swimmable : walkable;
  if (!u.air) {
    const key = ent ? ent.id : -1 - Math.round(dest.x) * 2048 - Math.round(dest.y);
    u.pathT -= dt;
    const P = u.path;
    if (!P || P.key !== key || (u.pathT <= 0 && (Math.hypot(P.gx - dest.x, P.gy - dest.y) > 2 * CELL || P.done))) {
      const R = ent ? rangeTo(u, ent) : 0;
      let pts;
      if (ent && (ent.rx || (swim && ent.kind === 'camp'))) {
        const [tx, ty] = swim && ent.kind === 'camp' ? siegeOf(ent.side, u.x, u.y) : [ent.x, ent.y];
        pts = findPath(u.x, u.y, tx, ty, swim && ent.kind === 'camp' ? CELL : Math.min(ent.rx, ent.ry), (x, y) => edgeAt(u, ent, x, y) <= R * 0.7, swim);
      } else if (ent) pts = findPath(u.x, u.y, ent.x, ent.y, Math.max(CELL, (u.r + ent.r + R) * 0.85), null, swim);
      else pts = findPath(u.x, u.y, dest.x, dest.y, 0, null, swim);
      u.path = { key, gx: dest.x, gy: dest.y, pts: pts || [[dest.x, dest.y]], i: 0, done: false };
      u.pathT = 0.4 + (u.id % 5) * 0.04;
    }
    // on passe au point suivant dès qu'on le voit, ou une fois au point (les nageurs collent au tracé : la rivière est étroite par endroits)
    const Q = u.path, pts = Q.pts, close = swim ? 1.5 : 5;
    while (Q.i < pts.length - 1 && (Math.hypot(pts[Q.i][0] - u.x, pts[Q.i][1] - u.y) < close || los(u.x, u.y, pts[Q.i + 1][0], pts[Q.i + 1][1], swim))) Q.i++;
    wx = pts[Q.i][0]; wy = pts[Q.i][1];
    if (Q.i === pts.length - 1 && Math.hypot(wx - u.x, wy - u.y) < 4) {      // au bout du chemin sans être à portée : on finit tout droit si possible
      Q.done = true;
      if (los(u.x, u.y, dest.x, dest.y, swim) || (ent && ent.rx && !swim)) { wx = dest.x; wy = dest.y; } else { u.moving = false; return; }
    }
  }
  const dx = wx - u.x, dy = wy - u.y, l = Math.hypot(dx, dy);
  if (l < 1) { u.moving = false; return; }
  if (u.s.charge && u.run >= u.s.charge.after * TILE && !u.charging) { u.charging = true; ev(b, { type: 'charge', uid: u.id, x: u.x, y: u.y }); }
  const spd = (u.charging ? u.s.charge.speed : u.s.speed) * TILE * (u.buff ? 1 + u.buff.speed : 1) * (u.slowT > 0 ? 1 - u.slowK : 1);
  const k = Math.min(l, spd * dt);
  let nx = u.x + dx / l * k, ny = u.y + dy / l * k;
  if (!u.air && !okAt(nx, ny)) {                 // on glisse le long du bord plutôt que d'entrer dans l'eau (ou d'en sortir) ou dans un mur
    if (okAt(nx, u.y)) ny = u.y; else if (okAt(u.x, ny)) nx = u.x; else { u.moving = false; u.path = null; return; }
  }
  u.run += Math.hypot(nx - u.x, ny - u.y); u.x = nx; u.y = ny;
  u.moving = true; face(u, dx, dy);
}

// ---------- les tours latérales : le singe libéré bombarde les animaux adverses (pas les nageurs) ----------
function updateTower(b, t, dt) {
  t.shotT += dt;
  if (t.side < 0) return;
  t.cd -= dt; if (t.cd > 0) return;
  const T = STRUCTS.tower, R = T.range * TILE;
  // d'abord ceux qui s'en prennent à la tour, sinon l'ennemi le plus proche de notre camp
  let tgt = null, bs = Infinity;
  const G = b.camps[t.side];
  for (const u of b.units) {
    if (u.dead || u.side === t.side || u.spawn > 0 || u.swim) continue;
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

// ---------- les catapultes ----------
// Point de la route à « pos » pixels du camp, et la direction de la route à cet endroit
export function roadAt(side, pos) {
  const R = CATA_ROAD[side];
  for (let i = 1; i < R.length; i++) {
    const [x0, y0] = R[i - 1], [x1, y1] = R[i], l = Math.hypot(x1 - x0, y1 - y0);
    if (pos <= l || i === R.length - 1) { const k = Math.max(0, Math.min(1, pos / l)); return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, dx: (x1 - x0) / l, dy: (y1 - y0) / l }; }
    pos -= l;
  }
  return { x: R[0][0], y: R[0][1], dx: 0, dy: -1 };
}
const OWN_HALF = (side, y) => (side === 0 ? y > 512 : y < 512);
function updateCata(b, c, dt) {
  if (c.fire) {                                   // un tir en cours : le bras se tend, le projectile part, le bras revient
    const f = c.fire; f.t += dt;
    if (!f.done && f.t >= CATA.wind) { f.done = true; launch(b, c, f); }
    if (f.t >= CATA.dur) c.fire = null;
  }
  if (c.dead) {                                   // cassée : le singe la répare (plus vite quand son camp est mené)
    c.moving = false;
    c.repairT -= dt * cataBoost(b, c.side);
    if (c.repairT <= 0) { c.dead = false; c.hp = c.maxHp; c.repairT = 0; c.cd = Math.max(c.cd, 1.2); ev(b, { type: 'cata_fixed', side: c.side, cid: c.id, x: c.x, y: c.y }); }
    return;
  }
  const to = c.want === 'centre' ? c.len : 0;
  if (Math.abs(c.pos - to) > 0.01) {              // en route : le singe la pousse (pas de tir en chemin)
    if (c.fire) { c.moving = false; return; }
    if (!c.moving) ev(b, { type: 'cata_move', side: c.side, cid: c.id, want: c.want, x: c.x, y: c.y });
    c.moving = true; c.at = '';
    const d = Math.sign(to - c.pos), v = CATA.speed * TILE * dt;
    c.pos = d > 0 ? Math.min(to, c.pos + v) : Math.max(to, c.pos - v);
    const p = roadAt(c.side, c.pos);
    c.x = p.x; c.y = p.y; c.aimX = p.x; c.aimY = p.y - 22; c.fx = p.dx * d; c.fy = p.dy * d;
    if (c.pos === to) {
      c.moving = false; c.at = to ? 'centre' : 'camp';
      c.fx = 0; c.fy = c.side === 0 ? -1 : 1;      // à poste, elle regarde vers le camp adverse
      c.cd = to ? CATA.atk.first : 0.6;
      ev(b, { type: 'cata_arrive', side: c.side, cid: c.id, at: c.at, x: c.x, y: c.y });
    }
    return;
  }
  c.moving = false;
  if (c.fire) return;
  if (c.at === 'centre') {                        // au centre : un rocher sur le camp adverse de temps en temps
    c.cd -= dt * cataBoost(b, c.side);
    if (c.cd > 0) return;
    const foe = b.camps[1 - c.side];
    c.cd = CATA.atk.every; c.fx = 0; c.fy = c.side === 0 ? -1 : 1;
    c.fire = { t: 0, done: false, atk: true, target: foe.id, tx: foe.aimX, ty: foe.aimY };
    ev(b, { type: 'cata_wind', side: c.side, cid: c.id, atk: true, x: c.x, y: c.y });
    return;
  }
  // au camp : elle bombarde les animaux adverses qui entrent dans notre moitié (ni les volants ni les nageurs)
  c.cd -= dt; if (c.cd > 0) return;
  const D = CATA.def, R = D.range * TILE, home = b.camps[c.side];
  let tgt = null, bs = Infinity;
  for (const u of b.units) {
    if (u.dead || u.side === c.side || u.spawn > 0 || u.air || u.swim || !OWN_HALF(c.side, u.y)) continue;
    if (Math.hypot(u.x - c.x, u.y - c.y) > R) continue;
    const sc = Math.hypot(u.x - home.x, u.y - home.y);
    if (sc < bs) { bs = sc; tgt = u; }
  }
  if (!tgt) { c.cd = 0.3; c.target = 0; return; }
  c.cd = D.every; c.target = tgt.id;
  face(c, tgt.x - c.x, tgt.y - c.y);
  c.fire = { t: 0, done: false, atk: false, target: tgt.id, tx: tgt.x, ty: tgt.y };
  ev(b, { type: 'cata_wind', side: c.side, cid: c.id, atk: false, x: c.x, y: c.y });
}
// Le bras de la catapulte se détend : le rocher part
function launch(b, c, f) {
  const sx = c.x + c.fx * 10, sy = c.y - 50;
  if (f.atk) {
    const foe = b.camps[1 - c.side]; if (foe.dead) return;
    const dmg = foe.maxHp * CATA.atk.hit;
    const pr = { side: c.side, x: sx, y: sy, sx, sy, tx: foe.aimX, ty: foe.aimY, target: foe.id, key: 'boulder', arc: true, arcH: 150, track: false, t: 0, T: 1.6,
      info: { side: c.side, aid: null, catapult: true, a: { mult: 1 }, dmg, src: c.id, sx: c.x, sy: c.y } };
    b.projs.push(pr); b.players[c.side].shots++;
    ev(b, { type: 'catapult', side: c.side, cid: c.id, x: sx, y: sy, tx: foe.aimX, ty: foe.aimY, amount: Math.round(dmg), T: pr.T });
    return;
  }
  const tg = b.ents.get(f.target), live = tg && !tg.dead;
  const tx = live ? tg.x : f.tx, ty = live ? tg.y : f.ty, D = CATA.def;
  const dmg = Math.round(D.dmg * levelK(b.levels[c.side]));
  const pr = { side: c.side, x: sx, y: sy, sx, sy, tx, ty, target: live ? tg.id : 0, key: 'stone', arc: true, arcH: 105, track: true, t: 0,
    info: { side: c.side, aid: null, tower: true, cata: true, a: { mult: 1, splash: D.splash, splashMult: D.splashMult, knock: D.knock }, dmg, src: c.id, sx: c.x, sy: c.y } };
  pr.T = Math.max(0.6, Math.min(1.35, Math.hypot(tx - sx, ty - sy) / (13 * TILE)));
  b.projs.push(pr);
  ev(b, { type: 'cata_fire', side: c.side, cid: c.id, x: sx, y: sy, tx, ty });
}

// ---------- projectiles et nuages ----------
function advanceProjs(b, dt, frozen) {
  for (let i = b.projs.length - 1; i >= 0; i--) {
    const p = b.projs[i]; p.t += dt;
    const tg = p.target ? b.ents.get(p.target) : null, live = tg && !tg.dead;
    if (live && (!p.arc || p.track)) { p.tx = aimX(tg); p.ty = aimY(tg) - (tg.kind === 'unit' && !p.arc ? (tg.air ? AIR_H + 8 : tg.swim ? 4 : 10) : 0); }
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
  ev(b, { type: 'land', key: p.key, x: p.tx, y: p.ty, splash: !!p.info.a.splash, tower: !!p.info.tower, heal: !!p.info.heal, side: p.side, cata: !!p.info.catapult, def: !!p.info.cata, swim: !!(live && tg.swim) });
  if (p.info.heal) { if (live && tg.side === p.side) heal(b, tg, p.info.heal); return; }
  if (p.info.a.splash) impact(b, p.info, live && Math.hypot(aimX(tg) - p.tx, aimY(tg) - p.ty) < (tg.r || 30) + 16 ? tg : null, p.tx, p.ty);
  else if (live) impact(b, p.info, tg, p.tx, p.ty);
}
function updateClouds(b, dt) {
  for (let i = b.clouds.length - 1; i >= 0; i--) {
    const c = b.clouds[i]; c.t -= dt; c.acc += dt;
    if (c.acc >= 0.25) {                        // tout animal adverse dans le nuage est empoisonné (pas les nageurs), et le reste un moment après en être sorti
      c.acc -= 0.25;
      for (const e of b.units) if (!e.dead && !e.swim && e.side !== c.side && e.spawn <= 0 && Math.hypot(e.x - c.x, e.y - c.y) - e.r < c.r) {
        if (!e.poison) { e.poison = { dps: c.dps, t: c.linger, acc: 0, side: c.side }; ev(b, { type: 'poison', uid: e.id, x: e.x, y: e.y }); }
        else { e.poison.t = c.linger; e.poison.dps = Math.max(e.poison.dps, c.dps); }
      }
    }
    if (c.t <= 0) b.clouds.splice(i, 1);
  }
}

// ---------- les corps ne se chevauchent pas, personne ne finit dans l'eau, et les nageurs n'en sortent pas ----------
const layer = (u) => (u.air ? 2 : u.swim ? 1 : 0);
function separate(b) {
  const us = b.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i]; if (a.dead || a.spawn > 0) continue;
    const la = layer(a);
    for (let j = i + 1; j < us.length; j++) {
      const c = us[j]; if (c.dead || c.spawn > 0 || layer(c) !== la) continue;
      let dx = c.x - a.x, dy = c.y - a.y; const d = Math.hypot(dx, dy), min = (a.r + c.r) * 0.85;
      if (d >= min) continue;
      if (d < 0.01) { dx = (a.id % 2 ? 1 : -1) * 0.5; dy = 0.3; }
      const l = Math.hypot(dx, dy), push = (min - d), wa = c.mass / (a.mass + c.mass), wc = 1 - wa;
      a.x -= dx / l * push * wa; a.y -= dy / l * push * wa; c.x += dx / l * push * wc; c.y += dy / l * push * wc;
    }
    if (la === 0) for (const c of b.structs) {      // les boîtes et les catapultes sont des obstacles : on glisse autour
      if ((c.kind !== 'crate' || c.dead) && c.kind !== 'cata') continue;
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
    const ok = u.swim ? swimmable : walkable;
    if (ok(u.x, u.y)) continue;
    if (ok(u.x, u.py)) u.y = u.py; else if (ok(u.px, u.y)) u.x = u.px;
    else if (ok(u.px, u.py)) { u.x = u.px; u.y = u.py; }
    else { const p = nearest(u.x, u.y, null, u.swim); if (p) { u.x = p.x; u.y = p.y; } }
  }
}

// Résumé de fin pour l'écran de résultats : gauge = part du camp adverse détruite, foeGauge = part du nôtre ;
// couronnes : 3 = camp adverse détruit, 2 = au moins 50 %, 1 = victoire.
export function summary(b, side) {
  const me = b.players[side], win = b.winner === side;
  const lost = (s) => 100 * (1 - Math.max(0, b.camps[s].hp) / b.camps[s].maxHp);
  const stars = (d, won) => (d >= 99.999 ? 3 : d >= 50 ? 2 : won ? 1 : 0);
  const g = lost(1 - side), fg = lost(side);
  return { win, draw: b.winner === -1, kos: me.kos, aura: Math.round(me.spent), towers: b.towers.filter((t) => t.side === side).length, crates: me.crates, why: b.why, mode: 'camps',
    crowns: stars(g, win), lost: stars(fg, b.winner === 1 - side), gauge: Math.floor(g * 10) / 10, foeGauge: Math.floor(fg * 10) / 10, shots: me.shots, breaks: me.breaks };
}
