// L'adversaire contrôlé par le jeu : il dépense son Aura comme un joueur, défend ses tours et lance des attaques.
// skill va de 0 (débutant, lent et maladroit) à 1 (rapide et précis).
import { ANIMALS } from '../data/animals.js';
import { deploy, order, handOf, clampDeploy, TILE, MID_X, MID_Y, BRIDGES, RIVER, mirrorY } from './rt.js';

const TANKS = ['bulldog', 'gorilla', 'rhino', 'elephant', 'alligator'];
const RANGED = ['kitten', 'orang'];

export function makeAI(side, skill = 0.5, rng = Math.random) {
  return { side, skill: Math.max(0, Math.min(1, skill)), rng, think: 1.2 + rng() * 2, lane: rng() < 0.5 ? 'left' : 'right', waitFor: 0 };
}

export function aiStep(b, ai, dt) {
  if (b.over) return;
  ai.think -= dt; if (ai.think > 0) return;
  const { side, skill, rng } = ai;
  ai.think = 1.15 - 0.65 * skill + rng() * 0.5;
  const p = b.players[side], hand = handOf(b, side);
  const mine = (y) => mirrorY(side, y);                                    // y vu du joueur du bas → y réel
  const home = (y) => (side === 0 ? y > MID_Y - 10 : y < MID_Y + 10);
  const foes = b.units.filter((u) => !u.dead && u.side !== side);
  const threats = foes.filter((u) => home(u.y)).sort((a, c) => towerDist(b, side, a) - towerDist(b, side, c));
  const playable = hand.map((c, i) => (c && c.cost <= p.aura ? { ...c, slot: i, a: ANIMALS[c.id] } : null)).filter(Boolean);
  const jitter = () => (rng() - 0.5) * TILE * (2.2 - 1.8 * skill);

  // 1. défendre : un ennemi est entré chez nous
  if (threats.length) {
    const t = threats[0], danger = threats.reduce((n, u) => n + ANIMALS[u.aid].cost * (u.hp / u.maxHp), 0);
    const defenders = b.units.filter((u) => !u.dead && u.side === side && Math.hypot(u.x - t.x, u.y - t.y) < 4 * TILE).reduce((n, u) => n + ANIMALS[u.aid].cost * (u.hp / u.maxHp), 0);
    if (defenders < danger * 0.9 && rng() < 0.5 + 0.5 * skill) {
      const opts = playable.filter((c) => c.a.targets !== 'buildings' && (!t.air || c.a.targets === 'all'));
      if (opts.length) {
        // la carte dont le coût est le plus proche de la menace (un peu au-dessus si possible)
        opts.sort((x, y) => Math.abs(x.cost - danger * 0.9) - Math.abs(y.cost - danger * 0.9));
        const c = opts[0], back = RANGED.includes(c.id) ? 3.2 : 1.1;
        const ty = t.y + (side === 0 ? back : -back) * TILE;
        const pos = clampDeploy(b, side, t.x + jitter() * 0.5, ty + jitter() * 0.4);
        if (!deploy(b, side, c.slot, pos.x, pos.y)) { ai.think += 0.4; return; }
      }
    }
    // nos animaux sont partis loin et une tour souffre : coup de sifflet (les bons adversaires seulement)
    const away = b.units.filter((u) => !u.dead && u.side === side && !home(u.y)).length;
    if (skill > 0.45 && away >= 2 && danger > 5 && rng() < 0.25 * skill) order(b, side, 'defend');
    return;
  }

  // 2. attaquer : on attend d'avoir assez d'Aura pour une vraie poussée (les débutants jouent plus tôt et moins bien)
  const pushing = b.units.filter((u) => !u.dead && u.side === side && !home(u.y));
  const want = pushing.length ? 3 + 2 * (1 - skill) : 6.5 + 2.5 * skill;
  if (p.aura < Math.min(9.6, want) && p.aura < 9.6) return;
  if (!playable.length) return;
  // couloir : celui dont la tour adverse est la plus faible, ou là où nos animaux poussent déjà
  const foeSide = (lane) => b.towers.find((t) => t.side !== side && t.lane === lane);
  if (pushing.length) ai.lane = pushing[0].x < MID_X ? 'left' : 'right';
  else if (rng() < 0.35) { const L = foeSide('left'), R = foeSide('right'); ai.lane = L.dead && !R.dead ? 'left' : R.dead && !L.dead ? 'right' : L.hp / L.maxHp < R.hp / R.maxHp - 0.1 ? 'left' : R.hp / R.maxHp < L.hp / L.maxHp - 0.1 ? 'right' : rng() < 0.5 ? 'left' : 'right'; }
  const lx = ai.lane === 'left' ? BRIDGES[0] : BRIDGES[1];
  let c;
  if (pushing.length) {          // soutien derrière l'attaque en cours
    c = pick(playable, (x) => (RANGED.includes(x.id) ? 3 : x.a.targets === 'buildings' ? 2 : 1) + rng());
    const lead = pushing[0];
    const pos = RANGED.includes(c.id) || !home(lead.y) ? { x: lx + jitter(), y: mine(RIVER[1] + 40) } : { x: lead.x + jitter(), y: lead.y + (side === 0 ? 2 : -2) * TILE };
    const q = clampDeploy(b, side, pos.x, pos.y);
    deploy(b, side, c.slot, q.x, q.y); return;
  }
  // nouvelle attaque : un costaud derrière ses tours (il prend le temps d'arriver), ou un fonceur au pont
  c = pick(playable, (x) => (TANKS.includes(x.id) ? 3 : x.a.targets === 'buildings' ? 2.4 : 1) + x.cost * 0.15 + rng() * 1.2);
  const tank = TANKS.includes(c.id);
  const y = tank && c.cost >= 5 ? mine(1345) : c.a.targets === 'buildings' || c.a.air ? mine(RIVER[1] + 30) : mine(1040);
  const q = clampDeploy(b, side, (ai.lane === 'left' ? 175 : 766) + jitter(), y + jitter() * 0.5);
  deploy(b, side, c.slot, q.x, q.y);
}

function pick(list, score) { let best = list[0], bs = -Infinity; for (const x of list) { const s = score(x); if (s > bs) { bs = s; best = x; } } return best; }
function towerDist(b, side, u) {
  let d = Infinity;
  for (const t of b.towers) if (t.side === side && !t.dead) d = Math.min(d, Math.hypot(t.x - u.x, t.y - u.y));
  return d;
}
