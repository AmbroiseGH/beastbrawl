// Simulation du combat automatique. Module pur : pas d'affichage, pas de hasard hors de la graine.
// Deux équipes placées sur leur grille marchent l'une vers l'autre et se battent jusqu'à ce qu'un camp
// soit entièrement éliminé. La même graine et les mêmes équipes redonnent toujours le même combat
// (pas à pas fixe, uniquement + − × ÷ et racine carrée), ce qui sert aux duels en ligne.
import { statsAt, CRIT_MULT } from '../data/animals.js';
import { FW, FH, cellCenter } from '../data/arena.js';
import { makeRng } from '../core/rng.js';

export const TICK = 1 / 30;       // pas de simulation (s)
export const FURY_AT = 20;        // après 20 s, la Fureur monte pour finir le combat
export const FURY_RAMP = 0.18;    // +18 % de dégâts par seconde de Fureur
const TAUNT = 0.9;                // un Protecteur est préféré s'il est à moins de 0,9 case de plus que le plus proche
const RETARGET_EVERY = 0.4;

// Les distances se mesurent sur les positions du début du pas (px, py) : les deux camps décident
// avec la même photo du terrain, aucun n'a l'avantage de jouer en second.
const dist = (a, b) => { const dx = a.px - b.px, dy = a.py - b.py; return Math.sqrt(dx * dx + dy * dy); };

// teams : [{ units: [{ id, level, col, row }] }, { ... }]  (camp 0 en bas, camp 1 en haut)
export function createBattle(teams, seed) {
  const rng = makeRng(seed);
  const b = {
    seed, t: 0, tick: 0, rng, units: [], events: [],
    over: false, winner: -1, overAt: 0, fury: false, dealt: [0, 0],
  };
  // les identifiants alternent entre les deux camps pour ne favoriser personne
  const lists = teams.map((tm) => tm.units.slice());
  const n = Math.max(lists[0].length, lists[1].length);
  for (let i = 0; i < n; i++) {
    for (let side = 0; side < 2; side++) {
      const u = lists[side][i];
      if (!u) continue;
      const s = statsAt(u.id, u.level);
      const p = cellCenter(side, u.col, u.row);
      b.units.push({
        uid: b.units.length, side, id: u.id, level: u.level || 1, s,
        x: p.x, y: p.y, hp: s.hp, maxHp: s.hp,
        state: 'idle', target: -1, cd: rng() * 0.25, atkT: -1, atk: null, atkN: 0, hitDone: false,
        fx: 0, fy: side === 0 ? -1 : 1, moving: false, retarget: 0, stun: 0,
        px: p.x, py: p.y, dead: false, deadT: -1, kills: 0, dmgDone: 0, dmgTaken: 0, col: u.col, row: u.row,
      });
    }
  }
  return b;
}

export const alive = (b, side) => b.units.filter((u) => u.hp > 0 && (side === undefined || u.side === side));

function pickTarget(b, u) {
  let best = null, bestScore = 1e9;
  for (const e of b.units) {
    if (e.side === u.side || e.hp <= 0) continue;
    let score = dist(u, e);
    if (e.s.taunt) score -= TAUNT;          // talent Protecteur
    if (score < bestScore - 1e-9) { bestScore = score; best = e; }
  }
  return best;
}

// Inflige des dégâts. kind : 'hit' (coup normal), 'special', 'splash' (coup de queue), 'aoe' (roulade)
function damage(b, target, amount, by, crit, kind, knock) {
  if (target.hp <= 0) return;
  const dealt = Math.min(target.hp, amount);
  target.hp -= amount;
  target.dmgTaken += dealt;
  by.dmgDone += dealt; b.dealt[by.side] += dealt;
  if (knock > 0) {
    const dx = target.x - by.x, dy = target.y - by.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const k = knock * (crit ? 1.6 : 1);
    target.x += (dx / d) * k; target.y += (dy / d) * k;
  }
  b.events.push({ type: 'hit', uid: target.uid, by: by.uid, amount: Math.round(amount), crit, kind, x: target.x, y: target.y });
  if (target.hp <= 0) { target.hp = 0; target.killer = by.uid; by.kills++; }   // la mort est actée en fin de pas
}

function strike(b, u, tg) {
  const a = u.atk, special = a === u.s.attacks.special;
  // esquive (seulement sur un coup normal)
  if (!special && tg.s.dodge > 0 && b.rng() < tg.s.dodge) {
    b.events.push({ type: 'dodge', uid: tg.uid, by: u.uid, x: tg.x, y: tg.y });
  } else {
    const crit = b.rng() < u.s.crit;
    let amount = u.s.dmg * a.mult * (crit ? CRIT_MULT : 1);
    if (b.fury) amount *= 1 + FURY_RAMP * (b.t - FURY_AT);
    amount *= 0.94 + b.rng() * 0.12;   // légère variation pour des chiffres vivants
    const tx = tg.px, ty = tg.py;
    damage(b, tg, amount, u, crit, special ? 'special' : 'hit', a.knock !== undefined ? a.knock : u.s.knock);
    if (a.stun && tg.hp > 0) {
      tg.stunNext = a.stun;
      b.events.push({ type: 'stun', uid: tg.uid, dur: a.stun });
    }
    if (a.aoe) {                         // roulade : tout ce qui est autour de la cible
      b.events.push({ type: 'aoe', by: u.uid, x: tx, y: ty, r: a.aoe });
      for (const e of b.units) {
        if (e === tg || e.side === u.side || e.hp <= 0) continue;
        const dx = e.px - tx, dy = e.py - ty;
        if (Math.sqrt(dx * dx + dy * dy) - e.s.radius <= a.aoe) damage(b, e, amount * a.aoeMult, u, false, 'aoe', a.knock * 0.6);
      }
    }
  }
  if (a.splash) {                        // coup de queue : les autres ennemis collés au singe
    for (const e of b.units) {
      if (e === tg || e.side === u.side || e.hp <= 0) continue;
      if (dist(u, e) - e.s.radius <= a.splashR) {
        let amount = u.s.dmg * a.splash * (0.94 + b.rng() * 0.12);
        if (b.fury) amount *= 1 + FURY_RAMP * (b.t - FURY_AT);
        damage(b, e, amount, u, false, 'splash', 0.03);
      }
    }
  }
}

function stepUnit(b, u, dt) {
  if (u.dead) return;
  u.cd -= dt;
  u.retarget -= dt;
  u.moving = false;
  if (u.stun > 0) { u.stun -= dt; u.state = 'stun'; return; }
  let tg = u.target >= 0 ? b.units[u.target] : null;
  if (!tg || tg.hp <= 0 || (u.retarget <= 0 && u.atkT < 0)) {
    const nt = pickTarget(b, u);
    // on ne change de cible vivante que si la nouvelle est nettement plus proche
    if (!tg || tg.hp <= 0 || (nt && nt !== tg && dist(u, nt) < dist(u, tg) * 0.75)) tg = nt;
    u.target = tg ? tg.uid : -1;
    u.retarget = RETARGET_EVERY;
  }
  if (!tg) { u.state = 'idle'; u.atkT = -1; u.atk = null; return; }

  const dx = tg.px - u.px, dy = tg.py - u.py, d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const edge = d - u.s.radius - tg.s.radius;

  if (u.atkT >= 0) {                       // attaque en cours
    u.atkT += dt;
    if (!u.hitDone && u.atkT >= u.atk.windup) { u.hitDone = true; strike(b, u, tg); }
    if (u.atkT >= u.atk.dur) { u.atkT = -1; u.atk = null; }
    u.state = 'attack';
    return;
  }

  u.fx = dx / d; u.fy = dy / d;
  if (edge <= u.s.range) {
    if (u.cd <= 0) {                        // à portée et prêt : on frappe
      u.atkN++;
      const sp = u.s.attacks.special;
      u.atk = (sp && u.atkN % sp.every === 0) ? sp : u.s.attacks.normal;
      u.atkT = 0; u.hitDone = false; u.cd = Math.max(u.s.atkEvery, u.atk.dur + 0.05); u.state = 'attack';
      b.events.push({ type: 'attack', uid: u.uid, special: u.atk === sp, anim: u.atk.anim, dur: u.atk.dur });
    } else u.state = 'idle';
    return;
  }
  if (edge <= u.s.range + 0.12 && u.cd > 0) { u.state = 'idle'; return; }   // évite de trépigner

  // marche vers la cible, en contournant les voisins
  let vx = dx / d, vy = dy / d;
  for (const o of b.units) {
    if (o === u || o === tg || o.hp <= 0) continue;
    const ox = o.px - u.px, oy = o.py - u.py;
    const od = Math.sqrt(ox * ox + oy * oy);
    const near = u.s.radius + o.s.radius + 0.3;
    if (od >= near) continue;
    const ahead = (ox * (dx / d) + oy * (dy / d)) / (od || 1e-6);
    if (ahead < 0.2) continue;              // seulement ceux qui gênent devant
    let lat = (ox * (-dy / d) + oy * (dx / d));  // côté du voisin par rapport à ma route
    if (lat > -0.02 && lat < 0.02) lat = (u.uid & 1) ? 0.02 : -0.02;
    const w = (near - od) / near * 1.6;
    const sgn = lat > 0 ? -1 : 1;
    vx += (-dy / d) * sgn * w; vy += (dx / d) * sgn * w;
  }
  const vl = Math.sqrt(vx * vx + vy * vy) || 1;
  const sp = u.s.speed * (b.fury ? 1.25 : 1);
  u.x += (vx / vl) * sp * dt; u.y += (vy / vl) * sp * dt;
  u.moving = true; u.state = 'walk';
}

function separate(b) {
  const us = b.units;
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < us.length; i++) {
      const a = us[i]; if (a.hp <= 0) continue;
      for (let j = i + 1; j < us.length; j++) {
        const c = us[j]; if (c.hp <= 0) continue;
        let dx = c.x - a.x, dy = c.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        const min = (a.s.radius + c.s.radius) * (a.side === c.side ? 0.92 : 1);
        if (d >= min) continue;
        if (d < 1e-6) { dx = (a.uid & 1) ? 0.01 : -0.01; dy = 0.01; d = Math.sqrt(dx * dx + dy * dy); }
        const push = min - d;
        const wa = a.atkT >= 0 ? 0.25 : 1, wc = c.atkT >= 0 ? 0.25 : 1, wt = wa + wc;
        a.x -= (dx / d) * push * (wa / wt); a.y -= (dy / d) * push * (wa / wt);
        c.x += (dx / d) * push * (wc / wt); c.y += (dy / d) * push * (wc / wt);
      }
    }
  }
  for (const u of us) {
    if (u.hp <= 0) continue;
    const r = u.s.radius;
    if (u.x < r) u.x = r; else if (u.x > FW - r) u.x = FW - r;
    if (u.y < r) u.y = r; else if (u.y > FH - r) u.y = FH - r;
  }
}

// Avance le combat d'un pas. Les événements (coups, morts…) s'accumulent dans b.events :
// l'affichage les lit puis vide la liste.
export function step(b) {
  const dt = TICK;
  b.tick++; b.t = b.tick * dt;
  if (b.over) return b;
  if (!b.fury && b.t >= FURY_AT) { b.fury = true; b.events.push({ type: 'fury' }); }
  // l'ordre de passage s'inverse à chaque pas : aucun camp n'a l'avantage du premier coup
  const us = b.units;
  for (const u of us) { u.px = u.x; u.py = u.y; }
  if (b.tick & 1) for (let i = 0; i < us.length; i++) stepUnit(b, us[i], dt);
  else for (let i = us.length - 1; i >= 0; i--) stepUnit(b, us[i], dt);
  for (const u of us) {
    if (u.stunNext) { if (u.hp > 0) { u.stun = u.stunNext; u.atkT = -1; u.atk = null; } u.stunNext = 0; }
    if (!u.dead && u.hp <= 0) {
      u.dead = true; u.state = 'dead'; u.deadT = b.t; u.atkT = -1; u.atk = null;
      b.events.push({ type: 'death', uid: u.uid, by: u.killer, x: u.x, y: u.y, side: u.side });
    }
  }
  separate(b);
  const a0 = alive(b, 0).length, a1 = alive(b, 1).length;
  if (a0 === 0 || a1 === 0) {
    b.over = true; b.overAt = b.t;
    if (a0 > 0) b.winner = 0;
    else if (a1 > 0) b.winner = 1;
    else b.winner = b.dealt[0] >= b.dealt[1] ? 0 : 1;   // double K.-O. : le camp qui a fait le plus de dégâts
    for (const u of us) if (u.hp > 0) { u.state = 'win'; u.atkT = -1; u.atk = null; }
    b.events.push({ type: 'end', winner: b.winner });
  }
  return b;
}

// Joue un combat entier sans affichage (tests, bots, vérification d'un duel en ligne).
export function runBattle(teams, seed, maxSeconds = 120) {
  const b = createBattle(teams, seed);
  const maxTicks = Math.round(maxSeconds / TICK);
  while (!b.over && b.tick < maxTicks) { step(b); b.events.length = 0; }
  return {
    winner: b.winner, time: b.t, over: b.over,
    survivors: [alive(b, 0).length, alive(b, 1).length],
    hpLeft: [0, 1].map((s) => b.units.filter((u) => u.side === s).reduce((n, u) => n + u.hp, 0)),
    dealt: b.dealt.map(Math.round),
    kills: [0, 1].map((s) => b.units.filter((u) => u.side !== s && u.hp <= 0).length),
  };
}
