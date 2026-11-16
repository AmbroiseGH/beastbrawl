// L'adversaire contrôlé par le jeu : il dépense son Aura comme un joueur, se bat pour la cible du centre, va chercher
// les boîtes et les tours latérales, et donne des ordres à ses animaux (les bons adversaires seulement).
// skill va de 0 (débutant, lent et maladroit) à 1 (rapide et précis).
import { ANIMALS } from '../data/animals.js';
import { deploy, command, handOf, clampDeploy, deployZones, TILE, BASE } from './rt.js';

const TANKS = ['bulldog', 'gorilla', 'rhino', 'elephant', 'orang'];
const BACK = ['kitten', 'orang', 'eagle'];
const BREAKERS = { monkey: 3, alligator: 3, pig: 2.2, gorilla: 2, rhino: 1.8, elephant: 1.6, bulldog: 1, eagle: 1, orang: 0.8, kitten: 0.2 };

export function makeAI(side, skill = 0.5, rng = Math.random) {
  return { side, skill: Math.max(0, Math.min(1, skill)), rng, think: 1.2 + rng() * 2, plan: 'centre', planT: 6 + rng() * 6, lane: rng() < 0.5 ? 'L' : 'R', crateDone: false, microT: 3 };
}
// Points de pose (côté rouge, en haut ; le côté bleu est le miroir) : bouche du pont central, bouts de la zone près des ponts latéraux
const SPOT = { centre: [767, 262], L: [470, 262], R: [1064, 262], crateL: [505, 225], crateR: [1031, 225], back: [767, 205] };
const spot = (side, key) => { const [x, y] = SPOT[key]; return { x, y: side === 1 ? y : 1024 - y + 14 }; };

export function aiStep(b, ai, dt) {
  if (b.over) return;
  ai.planT -= dt; ai.microT -= dt;
  ai.think -= dt; if (ai.think > 0) return;
  const { side, skill, rng } = ai;
  ai.think = 1.1 - 0.6 * skill + rng() * 0.5;
  const p = b.players[side], foe = b.players[1 - side], hand = handOf(b, side), M = b.machine;
  const mine = b.units.filter((u) => !u.dead && u.side === side), foes = b.units.filter((u) => !u.dead && u.side !== side);
  const weight = (list) => list.reduce((n, u) => n + ANIMALS[u.aid].cost * (u.hp / u.maxHp) / (ANIMALS[u.aid].count || 1), 0);
  const near = (list, x, y, r) => list.filter((u) => Math.hypot(u.x - x, u.y - y) < r * TILE);
  const playable = hand.map((c, i) => (c && c.cost <= p.aura ? { ...c, slot: i, a: ANIMALS[c.id] } : null)).filter(Boolean);
  const jitter = (k = 1) => (rng() - 0.5) * TILE * (2.4 - 1.6 * skill) * k;
  const put = (c, pos, ref) => {
    const q = clampDeploy(b, side, pos.x + jitter(), pos.y + jitter(0.5)), n0 = b.nextId;
    if (deploy(b, side, c.slot, q.x, q.y)) return false;
    if (ref) command(b, side, b.units.filter((u) => u.id >= n0 && u.side === side).map((u) => u.id), { ref });
    return true;
  };

  // ---------- ordres aux animaux déjà sur le terrain ----------
  if (ai.microT <= 0 && skill > 0.3) {
    ai.microT = 2.2 - skill;
    // un animal cher et très abîmé rentre se soigner à la tente, et repart une fois remis
    for (const u of mine) {
      const cost = ANIMALS[u.aid].cost, r = u.hp / u.maxHp, atHome = u.order && u.order.home;
      if (!atHome && skill > 0.55 && cost >= 5 && r < 0.22 && Math.hypot(u.x - BASE[side].x, u.y - BASE[side].y) > 6 * TILE && rng() < 0.6) command(b, side, [u.id], { home: true });
      else if (atHome && (r > 0.8 || foe.gauge > 80)) command(b, side, [u.id], null);
    }
    // le soigneur adverse d'abord : ceux qui se battent près de lui le prennent pour cible
    if (skill > 0.5) {
      const healer = foes.find((u) => u.s.healer);
      if (healer) { const ids = near(mine, healer.x, healer.y, 5).filter((u) => !u.order && u.s.targets !== 'buildings' && u.target !== healer.id).map((u) => u.id); if (ids.length && rng() < 0.5) command(b, side, ids, { ref: healer.id }); }
    }
  }

  // ---------- quel objectif ? ----------
  const atCentre = weight(near(mine, M.x, M.y, 7)), foeCentre = weight(near(foes, M.x, M.y, 7));
  const losing = foe.gauge - p.gauge;
  if (ai.planT <= 0) {
    ai.planT = 9 + rng() * 8 - 3 * skill;
    const free = b.towers.filter((t) => t.side !== side);
    const wantTower = free.length && rng() < (0.18 + 0.5 * skill) * (losing > 30 ? 0.5 : 1) * (b.clock < 25 ? 0.3 : 1);
    if (wantTower) {
      // la tour la moins gardée (et de préférence celle qui n'est encore à personne)
      free.sort((t, s) => (weight(near(foes, t.x, t.y, 9)) + (t.side >= 0 ? 2 : 0)) - (weight(near(foes, s.x, s.y, 9)) + (s.side >= 0 ? 2 : 0)));
      ai.plan = 'tower'; ai.lane = free[0].lane;
    } else ai.plan = 'centre';
  }
  if (ai.plan === 'tower') { const t = b.towers.find((x) => x.lane === ai.lane); if (!t || t.side === side) ai.plan = 'centre'; }
  if (losing > 35 || foe.gauge > 70) ai.plan = 'centre';

  // ---------- poser une carte ----------
  if (!playable.length) return;
  // une boîte à côté de la tente pour bien commencer (et quand elle revient, si on a de l'Aura à ne savoir qu'en faire)
  const homeCrate = b.crates.filter((c) => !c.dead && deployZones(b, side).some((z) => z === (c.y < 400 ? 1 : c.y > 620 ? 2 : c.x < 768 ? 3 : 4)));
  if (homeCrate.length && (b.t < 14 || p.aura > 9) && rng() < 0.35 + 0.4 * skill && !near(mine, homeCrate[0].x, homeCrate[0].y, 4).length) {
    const c = pick(playable, (x) => (BREAKERS[x.id] || 1) - x.cost * 0.45 + rng() * 0.5);
    if (c.cost <= 4) { const cr = homeCrate[Math.floor(rng() * homeCrate.length)]; if (put(c, { x: cr.x + (cr.x < 768 ? 50 : -50), y: cr.y + (side === 1 ? 34 : -34) })) return; }
  }
  // la cible est menacée : on répond tout de suite, avec ce qui tient le choc
  const threat = foeCentre > atCentre * 1.1 + 1 || losing > 20;
  if (threat && rng() < 0.55 + 0.45 * skill) {
    const c = pick(playable, (x) => (TANKS.includes(x.id) ? 2 : 1) + (BACK.includes(x.id) && atCentre > 2 ? 1.5 : 0) + Math.min(x.cost, foeCentre) * 0.3 + rng());
    put(c, BACK.includes(c.id) ? spot(side, 'back') : spot(side, 'centre')); return;
  }
  // sinon on attend d'avoir de quoi lancer une vraie poussée (les débutants jouent plus tôt et moins bien)
  const pushing = mine.filter((u) => !u.order || !u.order.home).length;
  const want = pushing ? 3.5 + 2 * (1 - skill) : 6 + 2.5 * skill;
  if (p.aura < Math.min(9.5, want)) return;
  if (ai.plan === 'tower') {
    const t = b.towers.find((x) => x.lane === ai.lane);
    const c = pick(playable, (x) => (BREAKERS[x.id] || 1) + rng() * 1.2);
    // si on tient déjà la zone d'à côté on y pose directement, sinon au bout de notre zone, près du pont latéral
    put(c, spot(side, ai.lane), t.id); return;
  }
  const front = near(mine, M.x, M.y, 9).some((u) => TANKS.includes(u.aid));
  const c = pick(playable, (x) => (front ? (BACK.includes(x.id) ? 2.5 : (BREAKERS[x.id] || 1)) : TANKS.includes(x.id) ? 3 : 1) + x.cost * 0.12 + rng() * 1.2);
  put(c, BACK.includes(c.id) && front ? spot(side, 'back') : spot(side, 'centre'));
}

function pick(list, score) { let best = list[0], bs = -Infinity; for (const x of list) { const s = score(x); if (s > bs) { bs = s; best = x; } } return best; }
