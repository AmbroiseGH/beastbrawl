// L'adversaire contrôlé par le jeu : il dépense son Aura comme un joueur, se bat au centre, va chercher les boîtes et
// les tours latérales, défend son camp, pousse parfois par un flanc, met ses nageurs à l'eau, décide où va sa catapulte
// (défendre le camp ou tirer depuis le centre), va casser la boîte dorée, et donne des ordres à ses animaux (les bons
// adversaires seulement).
// skill va de 0 (débutant, lent et maladroit) à 1 (rapide et précis).
import { ANIMALS } from '../data/animals.js';
import { deploy, command, setCata, handOf, clampDeploy, deployZones, behind, TILE, BASE, HOME_ZONE, CATA_ROAD } from './rt.js';
import { nearest, zoneAt } from './nav.js';

const TANKS = ['bulldog', 'gorilla', 'rhino', 'elephant', 'orang'];
const BACK = ['kitten', 'orang', 'eagle'];
const BREAKERS = { monkey: 3, alligator: 3, pig: 2.2, gorilla: 2, rhino: 1.8, elephant: 1.6, bulldog: 1, eagle: 1, orang: 0.8, kitten: 0.2, clownfish: 0.4, octo: 0.5, dolphin: 0.6 };
const CEN = { x: 512, y: 768 };                  // le milieu de l'île centrale, là où les catapultes viennent tirer

export function makeAI(side, skill = 0.5, rng = Math.random) {
  return { side, skill: Math.max(0, Math.min(1, skill)), rng, think: 1.2 + rng() * 2, plan: 'centre', planT: 6 + rng() * 6, lane: rng() < 0.5 ? 'L' : 'R',
    crateDone: false, microT: 3, campT: 0, cataT: 12 + rng() * 10 - 8 * skill, push: '', water: rng() < 0.5 ? 'L' : 'R', goldT: 1 };
}
// Points de pose (côté rouge, en haut ; le côté bleu est le miroir) : bouche du pont central, bouts de la zone près des
// ponts latéraux, et l'eau du camp de chaque côté pour les nageurs
const SPOT = { centre: [512, 428], L: [306, 418], R: [718, 418], back: [512, 300], waterL: [262, 282], waterR: [762, 282] };
const spot = (side, key) => { const [x, y] = SPOT[key]; return { x, y: side === 1 ? y : 1536 - y }; };
// Une poussée par un flanc s'arrête juste après le petit pont, chez l'adversaire, avant de foncer sur son camp
const WAY = { 1: { L: [330, 1112], R: [694, 1112] }, 0: { L: [312, 420], R: [712, 420] } };
const way = (side, lane) => { const [x, y] = WAY[side][lane]; return nearest(x, y, [HOME_ZONE[1 - side]]) || { x, y }; };

export function aiStep(b, ai, dt) {
  if (b.over) return;
  ai.planT -= dt; ai.microT -= dt; ai.campT -= dt; ai.cataT -= dt; ai.goldT -= dt;
  ai.think -= dt; if (ai.think > 0) return;
  const { side, skill, rng } = ai;
  ai.think = 1.1 - 0.6 * skill + rng() * 0.5;
  const p = b.players[side], hand = handOf(b, side);
  const mine = b.units.filter((u) => !u.dead && u.side === side), foes = b.units.filter((u) => !u.dead && u.side !== side);
  const weight = (list) => list.reduce((n, u) => n + ANIMALS[u.aid].cost * (u.hp / u.maxHp) / (ANIMALS[u.aid].count || 1), 0);
  const near = (list, x, y, r) => list.filter((u) => Math.hypot(u.x - x, u.y - y) < r * TILE);
  const playable = hand.map((c, i) => (c && c.cost <= p.aura ? { ...c, slot: i, a: ANIMALS[c.id] } : null)).filter(Boolean);
  const jitter = (k = 1) => (rng() - 0.5) * TILE * (2.4 - 1.6 * skill) * k;
  const put = (c, pos, ref) => {
    const q = clampDeploy(b, side, pos.x + jitter(), pos.y + jitter(0.5), c.id), n0 = b.nextId;
    if (deploy(b, side, c.slot, q.x, q.y)) return false;
    if (ref) command(b, side, b.units.filter((u) => u.id >= n0 && u.side === side).map((u) => u.id), { ref });
    return true;
  };
  const swimmers = (list) => list.filter((u) => u.swim);
  const myHalf = (u) => (side === 0 ? u.y > 768 : u.y < 768);
  const hb = BASE[side], losing = behind(b, side) - behind(b, 1 - side);

  // ---------- ordres aux animaux déjà sur le terrain ----------
  if (ai.microT <= 0 && skill > 0.3) {
    ai.microT = 2.2 - skill;
    // un animal cher et très abîmé rentre se soigner à la tente, et repart une fois remis
    for (const u of mine) {
      const cost = ANIMALS[u.aid].cost, r = u.hp / u.maxHp, atHome = u.order && u.order.home;
      if (!atHome && skill > 0.55 && cost >= 5 && r < 0.22 && Math.hypot(u.x - hb.x, u.y - hb.y) > 6 * TILE && rng() < 0.6) command(b, side, [u.id], { home: true });
      else if (atHome && (r > 0.8 || b.camps[1 - side].hp / b.camps[1 - side].maxHp < 0.2)) command(b, side, [u.id], null);
    }
    // le soigneur adverse d'abord : ceux qui se battent près de lui le prennent pour cible
    if (skill > 0.5) {
      const healer = foes.find((u) => u.s.healer);
      if (healer) { const ids = near(mine, healer.x, healer.y, 5).filter((u) => !u.order && !u.swim && u.target !== healer.id).map((u) => u.id); if (ids.length && rng() < 0.5) command(b, side, ids, { ref: healer.id }); }
    }
    // la catapulte adverse tire depuis le centre : ceux qui sont tout près vont la casser
    const fc = b.catas[1 - side];
    if (!fc.dead && fc.at !== 'camp' && rng() < 0.3 + 0.5 * skill) {
      const ids = near(mine, fc.x, fc.y, 6).filter((u) => !u.order && u.target !== fc.id && (!u.swim || Math.hypot(u.x - fc.x, u.y - fc.y) < (u.s.range + 1) * TILE)).slice(0, 3).map((u) => u.id);
      if (ids.length) command(b, side, ids, { ref: fc.id });
    }
  }

  // ---------- la boîte dorée : ceux qui sont à côté vont la casser ; tombée chez nous, on pose de quoi la casser ----------
  const gb = b.gold && b.gold.box;
  if (gb && !gb.dead && ai.goldT <= 0) {
    ai.goldT = 2.6 - 1.6 * skill + rng();
    const ours = gb.for === side;
    const ids = near(mine, gb.x, gb.y, ours ? 9 : 5).filter((u) => !u.swim && u.target !== gb.id && !(u.order && u.order.home)).slice(0, ours ? 4 : 2).map((u) => u.id);
    if (ids.length && rng() < 0.45 + 0.5 * skill) command(b, side, ids, { ref: gb.id });
    else if (ours && !ids.length && rng() < 0.35 + 0.45 * skill) {
      const c = playable.filter((x) => !x.a.swim && !x.a.air).sort((x, y) => (BREAKERS[y.id] || 0) - (BREAKERS[x.id] || 0))[0];
      if (c && put(c, { x: gb.x, y: gb.y + (side === 0 ? 70 : -70) }, gb.id)) return;
    }
  }

  // ---------- relâcher ceux qui ont passé un flanc ----------
  if (ai.campT <= 0) {
    ai.campT = 1.6 - skill;
    for (const u of mine) if (u.order && u.order.x !== undefined && Math.hypot(u.x - u.order.x, u.y - u.order.y) < 2.4 * TILE) command(b, side, [u.id], null);
  }

  // ---------- la catapulte : au centre quand on peut, au camp quand il est menacé ----------
  const cata = b.catas[side];
  const homeThreat = weight(near(foes.filter((u) => !u.air && !u.swim), hb.x, hb.y, 9)), homeGuard = weight(near(mine, hb.x, hb.y, 9));
  if (ai.cataT <= 0) {
    ai.cataT = 2.4 - 1.4 * skill + rng() * 1.5;
    const [cx, cy] = CATA_ROAD[side][CATA_ROAD[side].length - 1];
    const cFoe = weight(near(foes, cx, cy, 5)), cMine = weight(near(mine, cx, cy, 5));
    if (cata.want === 'centre') {
      // retour au camp : il est attaqué et personne ne le défend, ou le centre est perdu d'avance
      if ((homeThreat > homeGuard + 1.5 && rng() < 0.4 + 0.5 * skill) || (cFoe > cMine * 2 + 4 && cata.hp < cata.maxHp * 0.5 && rng() < skill)) setCata(b, side, 'camp');
    } else if (skill > 0.02 && b.t > 20 - 10 * skill && homeThreat <= homeGuard + 0.5 && cFoe <= cMine * 1.3 + 2 && rng() < 0.35 + 0.5 * skill) setCata(b, side, 'centre');
  }

  // ---------- quel objectif ? ----------
  const atCentre = weight(near(mine, CEN.x, CEN.y, 5)), foeCentre = weight(near(foes, CEN.x, CEN.y, 5));
  if (ai.planT <= 0) {
    ai.planT = 9 + rng() * 8 - 3 * skill;
    const free = b.towers.filter((t) => t.side !== side);
    const wantTower = free.length && rng() < (0.18 + 0.5 * skill) * (losing > 30 ? 0.5 : 1) * (b.clock < 25 ? 0.3 : 1);
    if (wantTower) {
      // la tour la moins gardée (et de préférence celle qui n'est encore à personne)
      free.sort((t, s) => (weight(near(foes, t.x, t.y, 6)) + (t.side >= 0 ? 2 : 0)) - (weight(near(foes, s.x, s.y, 6)) + (s.side >= 0 ? 2 : 0)));
      ai.plan = 'tower'; ai.lane = free[0].lane;
    } else ai.plan = 'centre';
    // le couloir des prochaines poussées : souvent le centre, sinon le flanc le moins gardé
    const fw = (l) => weight(foes.filter((u) => (l === 'L' ? u.x < 340 : u.x > 684)));
    ai.push = rng() < 0.55 - 0.15 * skill ? 'centre' : fw('L') <= fw('R') ? 'L' : 'R';
    ai.water = rng() < 0.5 ? 'L' : 'R';
  }
  if (ai.plan === 'tower') { const t = b.towers.find((x) => x.lane === ai.lane); if (!t || t.side === side) ai.plan = 'centre'; }
  if (losing > 35) ai.plan = 'centre';

  // ---------- poser une carte ----------
  if (!playable.length) return;
  // des nageurs adverses dans notre eau : on répond avec un nageur ou un volant (les seuls qui peuvent les toucher)
  const wet = swimmers(foes).filter(myHalf);
  if (wet.length && rng() < 0.4 + 0.6 * skill) {
    const ans = playable.filter((c) => c.a.swim || c.a.air);
    if (ans.length) {
      const c = pick(ans, (x) => x.cost * 0.3 + rng()), w = wet[0];
      if (c.a.swim) { if (put(c, { x: w.x, y: w.y })) return; }
      else if (put(c, { x: w.x, y: side === 0 ? Math.max(w.y, 1100) : Math.min(w.y, 436) }, w.id)) return;
    }
  }
  // une boîte dans une zone où l'on peut poser (l'île d'une tour qu'on tient), quand on a de l'Aura à ne savoir qu'en faire
  const homeCrate = b.crates.filter((c) => !c.dead && deployZones(b, side).includes(zoneAt(c.x, c.y + 30)));
  if (homeCrate.length && (b.t < 14 || p.aura > 9) && rng() < 0.35 + 0.4 * skill && !near(mine, homeCrate[0].x, homeCrate[0].y, 4).length) {
    const c = pick(playable.filter((x) => !x.a.swim), (x) => (BREAKERS[x.id] || 1) - x.cost * 0.45 + rng() * 0.5);
    if (c && c.cost <= 4) { const cr = homeCrate[Math.floor(rng() * homeCrate.length)]; if (put(c, { x: cr.x + (cr.x < 512 ? 70 : -70), y: cr.y + (side === 1 ? 50 : -50) })) return; }
  }
  // notre camp est attaqué : on le défend d'abord
  if (homeThreat > homeGuard * 1.1 + 0.5 && rng() < 0.6 + 0.4 * skill) {
    const land = playable.filter((x) => !x.a.swim);
    if (land.length) {
      const c = pick(land, (x) => (TANKS.includes(x.id) ? 1.5 : 1) + Math.min(x.cost, homeThreat) * 0.35 + rng());
      if (put(c, spot(side, 'back'))) return;
    }
  }
  // le centre est menacé : on répond tout de suite, avec ce qui tient le choc
  const threat = foeCentre > atCentre * 1.1 + 1 || losing > 20;
  if (threat && rng() < 0.55 + 0.45 * skill) {
    const land = playable.filter((x) => !x.a.swim);
    if (land.length) {
      const c = pick(land, (x) => (TANKS.includes(x.id) ? 2 : 1) + (BACK.includes(x.id) && atCentre > 2 ? 1.5 : 0) + Math.min(x.cost, foeCentre) * 0.3 + rng());
      put(c, BACK.includes(c.id) ? spot(side, 'back') : spot(side, 'centre')); return;
    }
  }
  // sinon on attend d'avoir de quoi lancer une vraie poussée (les débutants jouent plus tôt et moins bien)
  const pushing = mine.filter((u) => !u.order || !u.order.home).length;
  const want = pushing ? 3.5 + 2 * (1 - skill) : 6 + 2.5 * skill;
  if (p.aura < Math.min(9.5, want)) return;
  // un nageur de temps en temps : il descend la rivière jusqu'au camp adverse
  const fish = playable.filter((x) => x.a.swim);
  if (fish.length && rng() < 0.3 + (swimmers(mine).length ? 0 : 0.2)) { const c = pick(fish, (x) => x.cost * 0.2 + rng()); if (put(c, spot(side, ai.water === 'L' ? 'waterL' : 'waterR'))) return; }
  const land = playable.filter((x) => !x.a.swim);
  if (!land.length) { const c = fish[0]; if (c) put(c, spot(side, ai.water === 'L' ? 'waterL' : 'waterR')); return; }
  if (ai.plan === 'tower') {
    const t = b.towers.find((x) => x.lane === ai.lane);
    const c = pick(land, (x) => (BREAKERS[x.id] || 1) + rng() * 1.2);
    // si on tient déjà la zone d'à côté on y pose directement, sinon au bout de notre zone, près du pont latéral
    put(c, spot(side, ai.lane), t.id); return;
  }
  if (ai.push && ai.push !== 'centre') {      // poussée par un flanc : on pose au bout de notre zone et on passe le petit pont
    const c = pick(land, (x) => (TANKS.includes(x.id) ? 2 : 1) + x.cost * 0.12 + rng() * 1.2), n0 = b.nextId;
    if (put(c, spot(side, ai.push))) { const w = way(side, ai.push); command(b, side, b.units.filter((u) => u.id >= n0 && u.side === side).map((u) => u.id), { x: w.x, y: w.y }); }
    return;
  }
  const front = near(mine, CEN.x, CEN.y, 6).some((u) => TANKS.includes(u.aid));
  const c = pick(land, (x) => (front ? (BACK.includes(x.id) ? 2.5 : (BREAKERS[x.id] || 1)) : TANKS.includes(x.id) ? 3 : 1) + x.cost * 0.12 + rng() * 1.2);
  put(c, BACK.includes(c.id) && front ? spot(side, 'back') : spot(side, 'centre'));
}

function pick(list, score) { let best = list[0], bs = -Infinity; for (const x of list) { const s = score(x); if (s > bs) { bs = s; best = x; } } return best; }
