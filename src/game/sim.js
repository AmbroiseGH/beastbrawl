// Simulation du combat automatique. Module pur : pas d'affichage, pas de hasard hors de la graine.
// Deux équipes placées sur leur grille marchent l'une vers l'autre et se battent jusqu'à ce qu'un camp
// soit entièrement éliminé. La même graine et les mêmes équipes redonnent toujours le même combat
// (pas à pas fixe, uniquement + − × ÷ et racine carrée), ce qui sert aux duels en ligne.
//
// Comportements des animaux (« IA ») :
//   - choix de la cible : le plus proche, mais on préfère les Protecteurs, on se répartit quand un ennemi
//     est déjà entouré, on évite les chemins encombrés et on achève les ennemis presque morts ;
//   - contournement : chacun cherche autour de sa cible une place libre (par crans de 30°) et anticipe
//     les animaux qui barrent la route ; bloqué trop longtemps, il change de plan ou de cible ;
//   - entraide : un ennemi qui malmène un allié en difficulté attire les renforts (qui sprintent),
//     et un Protecteur arrivé à la rescousse pousse un grondement qui détourne les attaquants vers lui ;
//   - fuite : un animal blessé qui perd son duel s'enfuit se cacher derrière un allié solide, reprend son
//     souffle puis revient ; acculé, il se retourne avec rage. La Fureur met fin à toutes les fuites.
import { statsAt, CRIT_MULT } from '../data/animals.js';
import { FW, FH, cellCenter } from '../data/arena.js';
import { makeRng } from '../core/rng.js';

export const TICK = 1 / 30;       // pas de simulation (s)
export const FURY_AT = 20;        // après 20 s, la Fureur monte pour finir le combat
export const FURY_RAMP = 0.18;    // +18 % de dégâts par seconde de Fureur
const TAUNT = 0.9;                // un Protecteur est préféré s'il est à moins de 0,9 case de plus que le plus proche

// Réglages du comportement. Distances en cases, durées en secondes.
export const AI = {
  THINK: 0.2,        // délai entre deux décisions
  STICK: 0.5,        // préférence pour l'ennemi qu'on frappe déjà
  SWITCH: 0.35,      // écart de score nécessaire pour changer de cible
  CROWD: 0.3,        // malus par allié déjà au contact d'un ennemi (on se répartit)
  BLOCK: 0.5,        // malus par animal en travers du chemin
  FINISH: 0.35,      // bonus pour achever un ennemi sous 25 % de ses PV
  CHASE: 1.2,        // malus pour poursuivre un fuyard qu'on ne rattrapera pas
  AVOID: 1.5,        // malus temporaire d'une cible inaccessible
  AVOID_T: 1.5,
  STUCK_T: 0.5,      // bloqué depuis 0,5 s : on change de plan
  LOOK: 1.3,         // on anticipe les obstacles jusqu'à 1,3 case devant soi
  REACH: 0.4,        // un coup rate si la cible s'est éloignée de plus que portée + 0,4 case
  FLANK_CD: 2.5,
  HELP: 1.6,         // bonus pour frapper un ennemi qui malmène un allié en difficulté
  HELP_HP: 0.55,     // « en difficulté » : sous 55 % de ses PV
  HELP_SHOW: 0.4,    // sous 40 %, c'est un sauvetage : sprint, grondement et message « RENFORT »
  GUARD: 2.2,        // un Protecteur porte secours 2,2 fois plus volontiers
  SPRINT: 1.35, SPRINT_T: 0.9, HELP_CD: 5,
  ROAR_R: 1, ROAR_CD: 6, ROAR_LOCK: 1.5, GUARD_T: 3,
  FLEE_TTD: 3,       // on fuit si l'on risque de tomber en moins de 3 s en perdant son duel
  FLEE_T: 1.8, FLEE_CD: 6, FLEE_SPEED: 1.2,
  BREATH: 0.07,      // en fuite, sans coup reçu depuis 0,6 s : +7 % de PV par seconde
  BREATH_MAX: 0.15,  // au plus 15 % de PV regagnés par fuite
  RAGE: 1.3, RAGE_T: 3,   // acculé, ou vengeance : +30 % de dégâts pendant 3 s
  AVENGE_R: 2.2,     // un allié tombe : ceux qui sont à moins de 2,2 cases veulent le venger
};

const C30 = 0.8660254037844386, S30 = 0.5;   // cos et sin de 30°, écrits en dur : même résultat partout

// Les distances se mesurent sur les positions du début du pas (px, py) : les deux camps décident
// avec la même photo du terrain, aucun n'a l'avantage de jouer en second.
const dist = (a, b) => { const dx = a.px - b.px, dy = a.py - b.py; return Math.sqrt(dx * dx + dy * dy); };
const edgeOf = (a, b) => dist(a, b) - a.s.radius - b.s.radius;
const inField = (x, y, r) => x >= r && x <= FW - r && y >= r && y <= FH - r;
const hand = (u) => (((u.uid >> 1) & 1) ? 1 : -1);   // gaucher ou droitier, identique pour les deux camps

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
        fx: 0, fy: side === 0 ? -1 : 1, moving: false, stun: 0,
        px: p.x, py: p.y, dead: false, deadT: -1, kills: 0, dmgDone: 0, dmgTaken: 0, col: u.col, row: u.row,
        // IA
        mode: 'fight', think: 0, lastHit: -9,
        slotK: -1, slotOf: -1, slotX: 0, slotY: 0, detour: 0, detourOf: -1,
        stuckT: 0, mvx: 0, mvy: 0, unstuck: false, avoid: -1, avoidT: 0, lockT: 0, tauntBy: 0, flankCd: 0,
        helpCd: 0, helpedAt: -9, boostT: 0, guard: -1, guardT: 0, roarCd: 0,
        fleeT: 0, fleeCd: 0, fleeHp: 0, breath: false, rageT: 0,
      });
    }
  }
  for (const u of b.units) u.think = rng() * AI.THINK;   // les décisions ne tombent pas toutes au même pas
  return b;
}

export const alive = (b, side) => b.units.filter((u) => u.hp > 0 && (side === undefined || u.side === side));

// ---------- choix de la cible ----------
let helpOf = -1;   // allié malmené par l'ennemi qu'on vient de noter (rempli par score)

// Note d'un ennemi pour u : plus elle est basse, plus il est intéressant.
function score(b, u, e, cur) {
  helpOf = -1;
  const d = dist(u, e), edge = d - u.s.radius - e.s.radius;
  const inRange = edge <= u.s.range + 0.15;
  let s = edge > 0 ? edge : 0;
  if (e.s.taunt) s -= TAUNT;                                   // talent Protecteur
  if (e === cur && inRange) s -= AI.STICK;
  if (e.target >= 0 && e.mode === 'fight') {                   // il malmène un allié en difficulté ?
    const a = b.units[e.target];
    if (a !== u && a.side === u.side && a.hp > 0 && a.hp < a.maxHp * AI.HELP_HP &&
        edgeOf(e, a) <= e.s.range + (a.mode === 'flee' ? 1.2 : 0.8)) {
      s -= AI.HELP * (AI.HELP_HP - a.hp / a.maxHp) / AI.HELP_HP * (u.s.taunt ? AI.GUARD : 1);
      helpOf = a.uid;
    }
  }
  if (!inRange && d > 1e-6) {
    let crowd = 0, block = 0;
    const dx = e.px - u.px, dy = e.py - u.py;
    for (const o of b.units) {
      if (o === u || o === e || o.hp <= 0) continue;
      if (o.side === u.side && o.target === e.uid && o.mode === 'fight' && edgeOf(o, e) <= o.s.range + 0.5) crowd++;
      const ox = o.px - u.px, oy = o.py - u.py, t = (ox * dx + oy * dy) / d;
      if (t > 0 && t < d - e.s.radius) {                       // en travers du chemin ?
        const lat = (oy * dx - ox * dy) / d, c = (u.s.radius + o.s.radius) * 0.8;
        if (lat < c && lat > -c) block++;
      }
    }
    s += AI.CROWD * crowd + AI.BLOCK * block;
  }
  if (e.hp < e.maxHp * 0.25) s -= AI.FINISH;
  if (e.mode === 'flee') s += u.s.speed > e.s.speed * AI.FLEE_SPEED ? 0.2 : AI.CHASE;
  if (e.uid === u.avoid && u.avoidT > 0) s += AI.AVOID;
  return s;
}

// Une place libre au point (x, y) pour attaquer tg ? (ni animal, ni place déjà visée par un allié)
function slotFree(b, u, tg, x, y) {
  const r = u.s.radius;
  if (!inField(x, y, r)) return false;
  for (const o of b.units) {
    if (o === u || o === tg || o.hp <= 0) continue;
    const m = (o.s.radius + r) * 0.85;
    let dx = o.px - x, dy = o.py - y;
    if (dx * dx + dy * dy < m * m) return false;
    if (o.side === u.side && o.target === tg.uid && o.slotOf === tg.uid && o.slotK > 0 && o.mode === 'fight') {
      const R = o.s.radius + tg.s.radius + o.s.range * 0.5;
      dx = tg.px + o.slotX * R - x; dy = tg.py + o.slotY * R - y;
      if (dx * dx + dy * dy < m * m) return false;
    }
  }
  return true;
}

// Cherche autour de la cible la place libre la plus proche de l'axe d'arrivée, par crans de 30°.
// Renvoie le nombre de crans du détour (0 = tout droit), ou -1 si toute la couronne est prise.
function findSlot(b, u, tg) {
  const R = u.s.radius + tg.s.radius + u.s.range * 0.5;
  const keep = (k, x, y) => { u.slotK = k; u.slotOf = tg.uid; u.slotX = x; u.slotY = y; return k; };
  if (u.slotOf === tg.uid && u.slotK > 0 && slotFree(b, u, tg, tg.px + u.slotX * R, tg.py + u.slotY * R)) return u.slotK;
  let vx = u.px - tg.px, vy = u.py - tg.py; const l = Math.sqrt(vx * vx + vy * vy);
  if (l < 1e-6) { vx = 0; vy = u.side === 0 ? 1 : -1; } else { vx /= l; vy /= l; }
  if (slotFree(b, u, tg, tg.px + vx * R, tg.py + vy * R)) return keep(0, vx, vy);
  const h = hand(u);
  let ax = vx, ay = vy, cx = vx, cy = vy, t;
  for (let k = 1; k <= 6; k++) {
    t = ax * C30 - ay * S30; ay = ax * S30 + ay * C30; ax = t;      // +30°
    t = cx * C30 + cy * S30; cy = cy * C30 - cx * S30; cx = t;      // −30°
    const x1 = h > 0 ? ax : cx, y1 = h > 0 ? ay : cy, x2 = h > 0 ? cx : ax, y2 = h > 0 ? cy : ay;
    if (slotFree(b, u, tg, tg.px + x1 * R, tg.py + y1 * R)) return keep(k, x1, y1);
    if (k < 6 && slotFree(b, u, tg, tg.px + x2 * R, tg.py + y2 * R)) return keep(k, x2, y2);
  }
  u.slotK = -1; u.slotOf = -1;
  return -1;
}

function decide(b, u, retry) {
  if (u.mode === 'fight' && shouldFlee(b, u)) { startFlee(b, u); return; }
  const cur = u.target >= 0 && b.units[u.target].hp > 0 ? b.units[u.target] : null;
  let tg = cur, help = -1;
  if (!cur || u.lockT <= 0) {                                    // provoqué par un grondement : on garde sa cible
    let best = null, bs = 1e9, cs = 1e9, bh = -1;
    for (const e of b.units) {
      if (e.side === u.side || e.hp <= 0) continue;
      const sc = score(b, u, e, cur);
      if (e === cur) cs = sc;
      if (sc < bs - 1e-9) { bs = sc; best = e; bh = helpOf; }
    }
    if (!cur || (best && best !== cur && bs < cs - AI.SWITCH)) { tg = best; help = bh; }
  }
  if (!tg) { u.target = -1; return; }
  const changed = tg !== cur, edge = edgeOf(u, tg);
  let told = false;
  if (changed) { u.target = tg.uid; u.slotK = -1; u.slotOf = -1; u.stuckT = 0; }
  const ally = help >= 0 ? b.units[help] : null;
  if (changed && ally && ally.hp < ally.maxHp * AI.HELP_SHOW && u.helpCd <= 0 && edge > 0.6) {    // en renfort !
    told = true;
    u.helpCd = AI.HELP_CD; u.boostT = AI.SPRINT_T;
    if (u.s.taunt) { u.guard = help; u.guardT = AI.GUARD_T; }
    if (!(b.t - ally.helpedAt < 2.5)) b.events.push({ type: 'help', uid: u.uid, ally: help, x: u.x, y: u.y });   // un seul message par sauvetage
    ally.helpedAt = b.t;
  }
  if (edge <= u.s.range) { u.slotK = -1; u.unstuck = false; return; }
  const k0 = u.slotK;
  const k = findSlot(b, u, tg);
  if (k < 0 && !retry) {                                         // plus de place autour : une autre cible
    u.avoid = tg.uid; u.avoidT = AI.AVOID_T;
    decide(b, u, true);
    return;
  }
  if (!told && u.flankCd <= 0 && edge > 0.5 && ((k >= 2 && (k0 < 2 || changed)) || (changed && u.unstuck))) {
    u.flankCd = AI.FLANK_CD;
    b.events.push({ type: 'flank', uid: u.uid, x: u.x, y: u.y });
  }
  u.unstuck = false;
}

// ---------- fuite ----------
function shouldFlee(b, u) {
  if (b.fury || u.fleeCd > 0 || !u.s.flee || u.hp >= u.maxHp * u.s.flee) return false;
  let n = 0, dps = 0, ehp = 0, allies = 0;
  for (const o of b.units) {
    if (o === u || o.hp <= 0) continue;
    if (o.side === u.side) { if (o.mode === 'fight' && dist(o, u) < 1.6) allies++; continue; }
    if (o.target !== u.uid || o.mode !== 'fight' || edgeOf(o, u) > o.s.range + 0.5) continue;
    n++; dps += o.s.dmg / o.s.atkEvery; ehp += o.hp;
  }
  if (n === 0) return false;
  const ttd = u.hp / dps, ttk = ehp / (u.s.dmg / u.s.atkEvery);   // temps pour tomber, temps pour gagner
  return ttd < AI.FLEE_TTD && ttk > ttd && n >= allies;
}

function startFlee(b, u) {
  u.mode = 'flee'; u.fleeT = AI.FLEE_T; u.fleeHp = u.hp; u.target = -1; u.slotK = -1; u.slotOf = -1; u.stuckT = 0;
  b.events.push({ type: 'flee', uid: u.uid, x: u.x, y: u.y });
}

function endFlee(b, u, cornered) {
  u.mode = 'fight'; u.fleeCd = AI.FLEE_CD; u.think = 0; u.stuckT = 0; u.breath = false;
  if (cornered) u.rageT = AI.RAGE_T;
  b.events.push({ type: cornered ? 'cornered' : 'rally', uid: u.uid, gain: Math.round(u.hp - u.fleeHp), x: u.x, y: u.y });
}

// Un pas de fuite. Renvoie false si la fuite vient de s'arrêter (l'animal se bat dès ce pas).
function fleeStep(b, u, dt, sp) {
  if (u.fleeT <= 0 || b.fury) { endFlee(b, u, false); return false; }
  if (u.stuckT > 0.35) { endFlee(b, u, true); return false; }
  // d'où vient le danger ?
  let rx = 0, ry = 0, cx = 0, cy = 0, w = 0, close = false;
  for (const e of b.units) {
    if (e.side === u.side || e.hp <= 0) continue;
    const ex = u.px - e.px, ey = u.py - e.py, d = Math.sqrt(ex * ex + ey * ey) || 1e-6;
    if (d > 3) continue;
    if (d - u.s.radius - e.s.radius < 0.25) close = true;
    const k = (e.target === u.uid ? 2 : 1) / (d * d + 0.25);
    rx += ex / d * k; ry += ey / d * k; cx += e.px * k; cy += e.py * k; w += k;
  }
  const r = u.s.radius;
  if (w > 0) {
    cx /= w; cy /= w;
    // refuge : derrière l'allié solide le plus accessible, à l'abri de la menace
    let gx = 0, gy = 0, gs = 1e9;
    for (const a of b.units) {
      if (a.side !== u.side || a === u || a.hp <= 0 || a.mode !== 'fight' || a.hp < a.maxHp * 0.4) continue;
      let hx = a.px - cx, hy = a.py - cy; const hl = Math.sqrt(hx * hx + hy * hy) || 1e-6;
      hx = a.px + hx / hl * (a.s.radius + r + 0.25); hy = a.py + hy / hl * (a.s.radius + r + 0.25);
      if (!inField(hx, hy, r)) continue;
      const dx = hx - u.px, dy = hy - u.py;
      let sc = Math.sqrt(dx * dx + dy * dy);
      if (dx * rx + dy * ry < 0) sc += 1.5;                      // il faudrait passer par la menace
      if (sc < gs) { gs = sc; gx = hx; gy = hy; }
    }
    if (gs > 3) {                                                // personne pour le couvrir : il file vers son camp
      const l = Math.sqrt(rx * rx + ry * ry) || 1e-6, m = r + 0.1;
      gx = u.px + rx / l * 1.2; gy = u.py + ry / l * 1.2 + (u.side === 0 ? 0.5 : -0.5);
      if (gx < m) gx = m; else if (gx > FW - m) gx = FW - m;
      if (gy < m) gy = m; else if (gy > FH - m) gy = FH - m;
    }
    const dx = gx - u.px, dy = gy - u.py, gd = dx * dx + dy * dy;
    if (gd < 0.1225 && close) { endFlee(b, u, true); return false; }   // coincé avec l'ennemi au contact : acculé
    if (gd < 0.04) { u.state = 'idle'; u.fx = -rx; u.fy = -ry; }
    else { steer(b, u, gx, gy, null, sp * AI.FLEE_SPEED, dt); u.state = 'flee'; }
  } else {
    // plus personne à ses trousses : il souffle, puis revient
    if (u.hp >= u.fleeHp + u.maxHp * AI.BREATH_MAX - 1e-9 || u.hp >= u.maxHp) { endFlee(b, u, false); return false; }
    u.state = 'idle';
  }
  u.breath = false;
  if (b.t - u.lastHit > 0.6) {                                   // reprend son souffle
    let cap = u.fleeHp + u.maxHp * AI.BREATH_MAX; if (cap > u.maxHp) cap = u.maxHp;
    if (u.hp < cap) { u.hp += u.maxHp * AI.BREATH * dt; if (u.hp > cap) u.hp = cap; u.breath = true; }
  }
  return true;
}

// ---------- déplacement ----------
// Avance u vers (gx, gy) en contournant les animaux qui barrent la route. ign : animal à ne pas éviter.
function steer(b, u, gx, gy, ign, sp, dt) {
  let dx = gx - u.px, dy = gy - u.py; const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-3) return;
  dx /= d; dy /= d;
  const look = d < AI.LOOK ? d : AI.LOOK, r = u.s.radius;
  let ob = null, bt = 1e9, blat = 0;
  for (const o of b.units) {
    if (o === u || o === ign || o.hp <= 0) continue;
    const ox = o.px - u.px, oy = o.py - u.py;
    const t = ox * dx + oy * dy;                    // distance devant soi
    if (t <= 0 || t > look + o.s.radius * 0.5) continue;
    const lat = oy * dx - ox * dy;                  // écart sur le côté (> 0 : à gauche)
    const c = r + o.s.radius + 0.04;
    if (lat >= c || lat <= -c) continue;
    if (t < bt) { bt = t; ob = o; blat = lat; }
  }
  let vx = dx, vy = dy;
  if (ob) {
    // on passe à côté de l'obstacle, du côté le plus dégagé (en gardant son choix pour ne pas hésiter)
    const c = r + ob.s.radius + 0.1;
    let side = u.detourOf === ob.uid ? u.detour : blat > 0.03 ? -1 : blat < -0.03 ? 1 : hand(u);
    let wx = ob.px - dy * side * c, wy = ob.py + dx * side * c;
    if (!inField(wx, wy, r * 0.8)) { side = -side; wx = ob.px - dy * side * c; wy = ob.py + dx * side * c; }
    u.detour = side; u.detourOf = ob.uid;
    vx = wx - u.px; vy = wy - u.py; const l = Math.sqrt(vx * vx + vy * vy) || 1e-6; vx /= l; vy /= l;
  }
  const st = sp * dt < d ? sp * dt : d;
  u.x += vx * st; u.y += vy * st;
  u.mvx = vx * st; u.mvy = vy * st;
  u.fx = vx; u.fy = vy;
  u.moving = true;
}

// ---------- combat ----------
// Inflige des dégâts. kind : 'hit' (coup normal), 'special', 'splash' (coup de queue), 'aoe' (roulade)
function damage(b, target, amount, by, crit, kind, knock) {
  if (target.hp <= 0) return;
  const dealt = Math.min(target.hp, amount);
  target.hp -= amount;
  target.dmgTaken += dealt; target.lastHit = b.t;
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
  const boost = (b.fury ? 1 + FURY_RAMP * (b.t - FURY_AT) : 1) * (u.rageT > 0 ? AI.RAGE : 1);
  // esquive (seulement sur un coup normal)
  if (!special && tg.s.dodge > 0 && b.rng() < tg.s.dodge) {
    b.events.push({ type: 'dodge', uid: tg.uid, by: u.uid, x: tg.x, y: tg.y });
  } else {
    const crit = b.rng() < u.s.crit;
    let amount = u.s.dmg * a.mult * (crit ? CRIT_MULT : 1) * boost;
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
      if (dist(u, e) - e.s.radius <= a.splashR) damage(b, e, u.s.dmg * a.splash * (0.94 + b.rng() * 0.12) * boost, u, false, 'splash', 0.03);
    }
  }
}

// Grondement du Protecteur venu en renfort : les ennemis qui s'acharnaient sur l'allié se tournent vers lui.
function roar(b, u) {
  const uids = [];
  for (const e of b.units) {
    if (e.side === u.side || e.hp <= 0 || e.target !== u.guard || e.mode !== 'fight' || e.tauntBy) continue;
    if (edgeOf(u, e) <= AI.ROAR_R) { e.tauntBy = u.uid + 1; uids.push(e.uid); }
  }
  if (!uids.length) return;
  u.roarCd = AI.ROAR_CD; u.guardT = 0;
  b.events.push({ type: 'roar', uid: u.uid, ally: u.guard, uids, x: u.x, y: u.y });
}

function stepUnit(b, u, dt) {
  if (u.dead) return;
  u.cd -= dt; u.think -= dt; u.avoidT -= dt; u.lockT -= dt; u.flankCd -= dt; u.helpCd -= dt; u.boostT -= dt;
  u.guardT -= dt; u.roarCd -= dt; u.fleeT -= dt; u.fleeCd -= dt; u.rageT -= dt;
  u.moving = false;
  if (u.stun > 0) { u.stun -= dt; u.state = 'stun'; return; }

  if (u.atkT >= 0) {                       // attaque en cours
    const tg = u.target >= 0 ? b.units[u.target] : null;
    u.atkT += dt;
    if (!u.hitDone && (!tg || tg.hp <= 0)) { u.atkT = -1; u.atk = null; u.state = 'idle'; return; }   // cible tombée avant le coup
    if (!u.hitDone && u.atkT >= u.atk.windup) {
      u.hitDone = true;
      if (edgeOf(u, tg) <= u.s.range + AI.REACH) strike(b, u, tg);
      else b.events.push({ type: 'miss', uid: u.uid, x: u.x, y: u.y });   // la cible s'est sauvée
    }
    if (u.atkT >= u.atk.dur) { u.atkT = -1; u.atk = null; }
    u.state = 'attack';
    return;
  }

  const sp = u.s.speed * (b.fury ? 1.25 : 1) * (u.boostT > 0 ? AI.SPRINT : 1);
  if (u.mode === 'flee' && fleeStep(b, u, dt, sp)) return;

  if (u.stuckT > AI.STUCK_T) {             // coincé : on tente l'autre côté, ou une autre cible
    if (u.target >= 0) { u.avoid = u.target; u.avoidT = AI.AVOID_T; }
    u.detour = -u.detour; u.stuckT = 0; u.think = 0; u.unstuck = true;
  }
  let tg = u.target >= 0 ? b.units[u.target] : null;
  if (!tg || tg.hp <= 0 || u.think <= 0) {
    decide(b, u, false);
    u.think = AI.THINK;
    if (u.mode === 'flee') { fleeStep(b, u, dt, sp); return; }
    tg = u.target >= 0 ? b.units[u.target] : null;
  }
  if (!tg) { u.state = 'idle'; return; }
  if (u.guardT > 0 && u.guardT < AI.GUARD_T - 0.3 && u.roarCd <= 0) roar(b, u);

  const dx = tg.px - u.px, dy = tg.py - u.py, d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const edge = d - u.s.radius - tg.s.radius;
  if (edge <= u.s.range) {
    u.fx = dx / d; u.fy = dy / d;
    if (u.cd <= 0) {                        // à portée et prêt : on frappe
      u.atkN++;
      const sp2 = u.s.attacks.special;
      u.atk = (sp2 && u.atkN % sp2.every === 0) ? sp2 : u.s.attacks.normal;
      u.atkT = 0; u.hitDone = false; u.cd = Math.max(u.s.atkEvery, u.atk.dur + 0.05); u.state = 'attack';
      b.events.push({ type: 'attack', uid: u.uid, special: u.atk === sp2, anim: u.atk.anim, dur: u.atk.dur });
    } else u.state = 'idle';
    return;
  }
  if (edge <= u.s.range + 0.12 && u.cd > 0) { u.fx = dx / d; u.fy = dy / d; u.state = 'idle'; return; }   // évite de trépigner

  // marche : vers sa place autour de la cible (contournement), ou droit sur elle
  if (u.slotK > 0 && u.slotOf === tg.uid) {
    const R = u.s.radius + tg.s.radius + u.s.range * 0.5;
    steer(b, u, tg.px + u.slotX * R, tg.py + u.slotY * R, null, sp, dt);
  } else steer(b, u, tg.px, tg.py, tg, sp, dt);
  u.state = 'walk';
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
  for (const u of us) {
    // a-t-il vraiment avancé au pas précédent, une fois bousculé par les autres ? Sinon il est bloqué.
    if (u.mvx !== 0 || u.mvy !== 0) {
      const want = Math.sqrt(u.mvx * u.mvx + u.mvy * u.mvy);
      const got = ((u.x - u.px) * u.mvx + (u.y - u.py) * u.mvy) / want;
      if (got < want * 0.35) u.stuckT += dt; else if (u.stuckT > 0) u.stuckT = u.stuckT > dt ? u.stuckT - dt : 0;
    } else u.stuckT = 0;
    u.mvx = 0; u.mvy = 0;
    u.px = u.x; u.py = u.y;                 // photo du terrain pour ce pas
  }
  if (b.tick & 1) for (let i = 0; i < us.length; i++) stepUnit(b, us[i], dt);
  else for (let i = us.length - 1; i >= 0; i--) stepUnit(b, us[i], dt);
  for (const u of us) {
    if (u.stunNext) { if (u.hp > 0) { u.stun = u.stunNext; u.atkT = -1; u.atk = null; } u.stunNext = 0; }
    if (u.tauntBy && u.atkT < 0) {          // grondement : la cible change une fois le coup en cours fini
      const by = b.units[u.tauntBy - 1];
      if (u.hp > 0 && by.hp > 0 && u.mode === 'fight') { u.target = by.uid; u.lockT = AI.ROAR_LOCK; u.slotK = -1; u.slotOf = -1; u.think = 0; }
      u.tauntBy = 0;
    }
    if (!u.dead && u.hp <= 0) {
      u.dead = true; u.state = 'dead'; u.deadT = b.t; u.atkT = -1; u.atk = null; u.mode = 'fight';
      b.events.push({ type: 'death', uid: u.uid, by: u.killer, x: u.x, y: u.y, side: u.side });
      if (AI.AVENGE_R > 0) {                 // vengeance : les compagnons proches enragent
        const uids = [];
        for (const a of us) if (a.side === u.side && a.hp > 0 && dist(a, u) <= AI.AVENGE_R) { a.rageT = AI.RAGE_T; uids.push(a.uid); }
        if (uids.length) b.events.push({ type: 'avenge', uid: u.uid, uids });
      }
    }
  }
  separate(b);
  const a0 = alive(b, 0).length, a1 = alive(b, 1).length;
  if (a0 === 0 || a1 === 0) {
    b.over = true; b.overAt = b.t;
    if (a0 > 0) b.winner = 0;
    else if (a1 > 0) b.winner = 1;
    else b.winner = b.dealt[0] >= b.dealt[1] ? 0 : 1;   // double K.-O. : le camp qui a fait le plus de dégâts
    for (const u of us) if (u.hp > 0) { u.state = 'win'; u.atkT = -1; u.atk = null; u.mode = 'fight'; }
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
