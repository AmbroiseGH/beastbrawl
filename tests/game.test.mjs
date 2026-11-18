// Tests sans navigateur : moteur de combat en temps réel, cages et cartes, sauvegarde. Lancer avec « npm test ».
import assert from 'node:assert/strict';

// le jeu lit l'adresse de la page et le stockage du navigateur : on en donne de faux
const store = {};
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };

const { createBattle, step, deploy, handOf, summary, command, damage, deployZones, setCata, canDeploy, clampDeploy, TICK, TILE, DURATION, OVERTIME, BASE, SIEGE, CATA_ROAD, GOLD, goldAir } = await import('../src/game/rt.js');
const { findPath, walkable, swimmable, zoneAt, los } = await import('../src/game/nav.js');
const { makeAI, aiStep } = await import('../src/game/ai.js');
const { makeRng } = await import('../src/core/rng.js');
const { ANIMAL_IDS, ANIMALS, MAX_LEVEL } = await import('../src/data/animals.js');
const { CHESTS, CHEST_IDS, RARITIES, rollChest, upgradeCost, dailyOffers } = await import('../src/data/cards.js');
const { makeBot, validDeck } = await import('../src/data/bots.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// ---------- combat ----------
function play(seed, d0, d1, s0 = 0.5, s1 = 0.5, onEvent = null) {
  const b = createBattle({ decks: [d0.map((id) => ({ id, level: 1 })), d1.map((id) => ({ id, level: 1 }))], towerLevels: [1, 1], seed });
  const r = makeRng(seed + 7), a0 = makeAI(0, s0, r), a1 = makeAI(1, s1, r);
  const log = [];
  let n = 0;
  while (!b.over && n < (DURATION + OVERTIME + 5) / TICK) {
    aiStep(b, a0, TICK); aiStep(b, a1, TICK); step(b); n++;
    for (const e of b.events) {
      if (e.type === 'tower_take' || e.type === 'crate_break' || e.type === 'end' || e.type === 'catapult' || e.type === 'cata_break') log.push(e.type + ':' + e.side + ':' + (e.bonus || e.winner || '') + '@' + b.t.toFixed(2));
      if (onEvent) onEvent(e, b);
    }
    b.events.length = 0;
    if (n % 15 === 0) for (const u of b.units) if (!u.dead && !u.air && u.spawn <= 0) {
      if (u.swim) assert.ok(swimmable(u.x, u.y), `${u.aid} hors de l'eau en ${Math.round(u.x)},${Math.round(u.y)}`);
      else assert.ok(walkable(u.x, u.y), `${u.aid} hors du sol en ${Math.round(u.x)},${Math.round(u.y)}`);
    }
  }
  return { b, log, s: summary(b, 0) };
}
const campBattle = (seed = 5, d0 = ['monkey'], d1 = ['monkey']) => createBattle({ decks: [d0.map((id) => ({ id, level: 1 })), d1.map((id) => ({ id, level: 1 }))], seed });
const run = (b, sec, fn) => { let n = 0; while (!b.over && n < sec / TICK) { step(b); if (fn) for (const e of b.events) fn(e); b.events.length = 0; n++; } };
const hits = { side: 0, aid: 'monkey', a: { mult: 1 } };

await test('un combat entre deux ordinateurs va jusqu\'au bout : les catapultes tirent, les camps encaissent, les nageurs restent dans l\'eau', () => {
  let shots = 0, hurt = 0, moved = 0, fish = 0;
  for (let i = 0; i < 8; i++) {
    const deck = [...ANIMAL_IDS].sort(() => makeRng(40 + i)() - 0.5);
    const { b, s } = play(1000 + i, deck.slice(0, 8), deck.slice(3, 11), 0.5, 0.6, (e) => {
      if (e.type === 'catapult') shots++; if (e.type === 'cata_move') moved++; if (e.type === 'deploy' && e.swim) fish++;
    });
    assert.ok(b.over, 'le combat doit se terminer');
    assert.ok(['camp', 'time', 'overtime', 'tie'].includes(b.why), b.why);
    if (b.camps.some((c) => c.hp < c.maxHp)) hurt++;
    assert.equal(s.mode, 'camps'); assert.ok(s.crowns >= 0 && s.crowns <= 3 && s.lost >= 0 && s.lost <= 3 && s.gauge >= 0 && s.gauge <= 100);
    if (!s.draw) assert.equal(s.win, b.winner === 0);
    if (b.why === 'time' || b.why === 'overtime') { const r = (k) => b.camps[k].hp / b.camps[k].maxHp; assert.ok(b.winner === 0 ? r(0) > r(1) : r(1) > r(0), 'le camp le moins abîmé gagne'); }
  }
  assert.ok(shots > 0, 'au moins un tir de catapulte depuis le centre'); assert.ok(moved > 0, 'les catapultes bougent'); assert.ok(hurt >= 5, 'les camps sont attaqués');
  assert.ok(fish > 0, 'des nageurs sont mis à l\'eau');
});

await test('la même graine redonne exactement le même combat', () => {
  const d0 = ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'dolphin'], d1 = ['rhino', 'elephant', 'kitten', 'clownfish', 'octo', 'pig', 'orang', 'eagle'];
  const a = play(77, d0, d1), b = play(77, d0, d1);
  assert.deepEqual(a.log, b.log);
  assert.equal(a.b.t, b.b.t);
});

await test('poser une carte coûte de l\'Aura et respecte la zone de pose (bleue, en bas) ; les nageurs, seulement dans l\'eau du camp', () => {
  const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }, { id: 'kitten', level: 1 }, { id: 'bulldog', level: 1 }, { id: 'clownfish', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 5 });
  const p = b.players[0], slot = handOf(b, 0).findIndex((c) => c && c.id === 'bulldog');
  assert.equal(p.aura, 5);
  assert.equal(deploy(b, 0, slot, 512, 330), 'zone', 'pas de pose chez l\'adversaire');
  assert.equal(deploy(b, 0, slot, 512, 700), 'zone', 'pas de pose au centre');
  assert.equal(deploy(b, 0, slot, 230, 700), 'zone', 'pas de pose près d\'une tour qu\'on ne tient pas');
  assert.equal(deploy(b, 0, slot, 316, 1316), 'zone', 'pas d\'animal terrestre dans l\'eau');
  assert.equal(deploy(b, 0, slot, 512, 1150), '');
  assert.equal(p.aura, 1);
  const s2 = handOf(b, 0).findIndex((c) => c && c.cost > 1);
  assert.equal(deploy(b, 0, s2, 512, 1150), 'aura');
  assert.equal(b.units.filter((u) => u.side === 0).length, 1);
  p.aura = 10;
  const fs = handOf(b, 0).findIndex((c) => c && c.id === 'clownfish');
  assert.ok(fs >= 0);
  assert.equal(deploy(b, 0, fs, 512, 1150), 'zone', 'pas de nageur sur la terre');
  assert.equal(deploy(b, 0, fs, 340, 212), 'zone', 'pas de nageur dans l\'eau du camp adverse');
  assert.ok(canDeploy(b, 0, 316, 1316, 'clownfish') && canDeploy(b, 1, 340, 212, 'clownfish'));
  assert.ok(!canDeploy(b, 0, 300, 1000, 'clownfish'), 'les nageurs se posent près du camp, pas plus loin');
  const q = clampDeploy(b, 0, 512, 1150, 'clownfish');
  assert.ok(swimmable(q.x, q.y) && canDeploy(b, 0, q.x, q.y, 'clownfish'), 'le doigt qui déborde retombe dans l\'eau du camp');
  assert.equal(deploy(b, 0, fs, q.x, q.y), '');
  assert.equal(b.units.filter((u) => u.aid === 'clownfish').length, 2, 'deux poissons clowns');
});

await test('les animaux au sol vont d\'une tente à l\'autre par les ponts, les nageurs par la rivière', () => {
  for (const [x0, y0, x1, y1] of [[512, 1150, 512, 300], [512, 1150, 230, 700], [420, 1180, 800, 700], [512, 1150, 684, 300]]) {
    const pts = findPath(x0, y0, x1, y1);
    assert.ok(pts && pts.length >= 1);
    let bridge = false, px = x0, py = y0;
    for (const [x, y] of pts) {
      assert.ok(los(px, py, x, y), 'le chemin passe par le sol');
      for (let k = 1; k <= 24; k++) if (zoneAt(px + (x - px) * k / 24, py + (y - py) * k / 24) === 6) bridge = true;
      px = x; py = y;
    }
    assert.ok(bridge, 'le chemin emprunte un pont');
  }
  // de l'eau du camp bleu jusqu'aux points d'où l'on attaque le camp rouge, des deux côtés
  for (const [x0, y0] of SIEGE[0]) for (const [x1, y1] of SIEGE[1]) {
    assert.ok(swimmable(x0, y0) && swimmable(x1, y1), 'points d\'eau dans la rivière');
    const pts = findPath(x0, y0, x1, y1, 0, null, true);
    let px = x0, py = y0;
    for (const [x, y] of pts) { assert.ok(los(px, py, x, y, true), 'le chemin reste dans l\'eau'); px = x; py = y; }
    assert.ok(Math.hypot(px - x1, py - y1) < 2, 'le nageur arrive au bout');
  }
});

// ---------- camps et catapultes ----------
await test('sans ordre ni ennemi en vue, un animal marche vers le camp adverse', () => {
  const b = campBattle(6);
  deploy(b, 0, 0, 512, 1150);
  run(b, 2);
  const u = b.units.find((x) => x.side === 0);
  assert.equal(u.target, b.camps[1].id);
});

await test('au camp, la catapulte bombarde l\'ennemi qui approche, jamais les siens, ni les volants ni les nageurs', () => {
  const b = campBattle(7);
  deploy(b, 0, 0, 600, 1230); deploy(b, 1, 0, 512, 330);
  const mine = b.units.find((x) => x.side === 0), foe = b.units.find((x) => x.side === 1);
  foe.x = 512; foe.y = 1110; foe.order = { x: 512, y: 1110 };          // notre singe est plus près du camp que l'ennemi
  const c = b.catas[0], targets = [];
  run(b, 4, (e) => { if (e.type === 'cata_fire') { assert.equal(e.side, 0); targets.push(c.target); } });
  assert.ok(targets.length >= 1, 'la catapulte tire');
  for (const t of targets) assert.equal(t, foe.id);
  assert.ok(foe.hp < foe.maxHp || foe.dead, 'l\'ennemi est touché'); assert.notEqual(c.target, mine.id);
  // un aigle et un poulpe tout près : la catapulte ne les vise pas
  const b2 = campBattle(8, ['monkey'], ['eagle', 'octo']);
  b2.players[1].aura = 10;
  const h = handOf(b2, 1);
  deploy(b2, 1, h.findIndex((x) => x && x.id === 'eagle'), 512, 330);
  const eg = b2.units.find((u) => u.aid === 'eagle'); eg.x = 512; eg.y = 1110; eg.spawn = 0; eg.order = { x: 512, y: 1110 };
  let fired = false;
  run(b2, 3, (e) => { if (e.type === 'cata_fire' && e.side === 0) fired = true; });
  assert.ok(!fired, 'pas de pierre sur un volant');
});

await test('la catapulte va au centre puis revient, et du centre elle tire sur le camp adverse : 5 % par rocher, plus vite pour le camp mené', () => {
  const b = campBattle(9), c = b.catas[0], foe = b.camps[1];
  assert.equal(c.at, 'camp'); assert.equal(setCata(b, 0, 'centre'), true); assert.equal(setCata(b, 0, 'centre'), false);
  let arrived = 0, shot = 0;
  run(b, 16, (e) => { if (e.type === 'cata_arrive' && !arrived) arrived = b.t; if (e.type === 'catapult' && !shot) shot = b.t; });
  assert.ok(arrived > 6 && arrived < 12 && c.at === 'centre', 'elle arrive au centre en une dizaine de secondes');
  const [ex, ey] = CATA_ROAD[0][CATA_ROAD[0].length - 1];
  assert.ok(Math.hypot(c.x - ex, c.y - ey) < 1 && c.x < 512 && c.fy < 0, 'au centre, un peu à gauche, tournée vers le camp rouge');
  assert.ok(walkable(c.x, c.y));
  assert.ok(shot > arrived && shot < arrived + 5, 'premier tir peu après l\'arrivée');
  run(b, 2);
  assert.equal(foe.maxHp - foe.hp, Math.max(1, Math.round(foe.maxHp * 0.05)), 'un rocher enlève 5 % du camp');
  // le camp mené : la catapulte recharge deux fois plus vite
  const b2 = campBattle(10), c2 = b2.catas[0];
  b2.camps[0].hp = Math.round(b2.camps[0].maxHp * 0.6);
  setCata(b2, 0, 'centre'); setCata(b2, 1, 'centre');
  const n = [0, 0];
  run(b2, 60, (e) => { if (e.type === 'catapult') n[e.side]++; });
  assert.ok(n[0] >= n[1] * 1.6 && n[1] >= 3, n.join('/'));
  // retour au camp
  setCata(b2, 0, 'camp');
  run(b2, 15);
  assert.equal(c2.at, 'camp'); assert.ok(Math.hypot(c2.x - CATA_ROAD[0][0][0], c2.y - CATA_ROAD[0][0][1]) < 1);
});

await test('une catapulte cassée ne tire plus et ne se vise plus, puis le singe la répare ; les animaux qui passent près d\'elle l\'attaquent', () => {
  const b = campBattle(11), c = b.catas[1];
  setCata(b, 1, 'centre'); run(b, 12);
  assert.equal(c.at, 'centre');
  damage(b, c, c.hp + 5, hits);
  assert.ok(c.dead && b.events.some((e) => e.type === 'cata_break' && e.side === 1));
  assert.equal(b.players[0].breaks, 1);
  b.events.length = 0;
  let fired = false, fixed = false;
  run(b, 9.5, (e) => { if (e.type === 'catapult' && e.side === 1) fired = true; if (e.type === 'cata_fixed') fixed = true; });
  assert.ok(!fired && !fixed && c.dead, 'en réparation');
  run(b, 1);
  assert.ok(!c.dead && c.hp === c.maxHp, 'réparée, toute neuve');
  // un singe bleu qui monte au centre s'en prend à la catapulte rouge
  const q = clampDeploy(b, 0, 512, 1000);
  assert.equal(deploy(b, 0, 0, q.x, q.y), '');
  const u = b.units.find((x) => x.side === 0);
  let got = false; run(b, 12, () => { if (u.target === c.id) got = true; });
  assert.ok(got || c.hp < c.maxHp, 'le singe attaque la catapulte');
});

await test('le camp mené recharge son Aura plus vite', () => {
  const b = campBattle(12);
  b.camps[0].hp = Math.round(b.camps[0].maxHp * 0.6);          // 40 points de retard : +50 %
  b.players[0].aura = 0; b.players[1].aura = 0;
  run(b, 3);
  assert.ok(Math.abs(b.players[0].aura / b.players[1].aura - 1.5) < 0.01, String(b.players[0].aura / b.players[1].aura));
});

await test('camp détruit = victoire à 3 étoiles ; au temps, le camp le moins abîmé gagne ; en mort subite, le premier camp touché perd', () => {
  let b = campBattle(13);
  damage(b, b.camps[1], b.camps[1].hp + 10, hits);
  assert.ok(b.over && b.camps[1].dead); assert.equal(b.winner, 0); assert.equal(b.why, 'camp');
  let s = summary(b, 0); assert.equal(s.crowns, 3); assert.equal(s.gauge, 100); assert.equal(s.lost, 0);
  b = campBattle(14);
  b.camps[1].hp = Math.round(b.camps[1].maxHp * 0.45); b.camps[0].hp = Math.round(b.camps[0].maxHp * 0.8); b.clock = 0.01;
  run(b, 0.1);
  assert.ok(b.over); assert.equal(b.winner, 0); assert.equal(b.why, 'time');
  s = summary(b, 0); assert.equal(s.crowns, 2); assert.equal(s.lost, 0); assert.equal(summary(b, 1).crowns, 0);
  b = campBattle(15); b.clock = 0.01;
  run(b, 0.1);
  assert.ok(b.overtime && !b.over, 'égalité : mort subite');
  damage(b, b.catas[0], 10, { side: 1, aid: 'monkey', a: { mult: 1 } });
  assert.ok(!b.over, 'toucher une catapulte ne compte pas');
  damage(b, b.camps[0], 1, { side: 1, aid: 'monkey', a: { mult: 1 } });
  assert.ok(b.over); assert.equal(b.winner, 1); assert.equal(b.why, 'overtime');
});

// ---------- les nageurs ----------
await test('les nageurs : seuls les volants et les autres nageurs les touchent, ils ne touchent pas les volants, ils restent dans l\'eau', () => {
  const b = campBattle(16, ['dolphin', 'octo', 'clownfish', 'eagle'], ['monkey', 'orang', 'eagle', 'kitten']);
  b.players[0].aura = 10; b.players[1].aura = 10;
  const h0 = handOf(b, 0), h1 = handOf(b, 1);
  deploy(b, 0, h0.findIndex((c) => c && c.id === 'dolphin'), 316, 1316);
  const d = b.units.find((u) => u.aid === 'dolphin'); d.spawn = 0;
  deploy(b, 1, h1.findIndex((c) => c && c.id === 'orang'), 512, 330);
  const o = b.units.find((u) => u.aid === 'orang'); o.spawn = 0; o.x = 350; o.y = 1230; o.order = { x: 350, y: 1230 };    // l'orang-outan au bord de l'eau, à côté du dauphin
  assert.ok(walkable(o.x, o.y));
  run(b, 6);
  assert.equal(d.hp, d.maxHp, 'l\'orang-outan (qui vise pourtant les airs) ne peut rien contre le dauphin');
  assert.ok(o.hp < o.maxHp, 'le dauphin, lui, l\'arrose');
  assert.ok(swimmable(d.x, d.y));
  b.players[1].aura = 10;
  deploy(b, 1, handOf(b, 1).findIndex((c) => c && c.id === 'eagle'), 512, 330);
  const eg = b.units.find((u) => u.aid === 'eagle'); eg.spawn = 0; eg.x = 380; eg.y = 1250; eg.order = { ref: d.id };
  const dhp = d.hp, ehp = eg.hp;
  run(b, 4);
  assert.ok(d.hp < dhp, 'l\'aigle touche le dauphin'); assert.equal(eg.hp, ehp, 'le dauphin ne touche pas l\'aigle');
  assert.ok(swimmable(d.x, d.y), 'repoussé par les bourrasques, il reste dans l\'eau');
});

await test('un nageur descend la rivière et attaque le camp adverse depuis l\'eau (dégâts réduits sur les structures)', () => {
  for (const [side, x, y] of [[0, 316, 1316], [1, 340, 212]]) {
    const b = campBattle(17 + side, ['octo'], ['octo']);
    deploy(b, side, 0, ...Object.values(clampDeploy(b, side, x, y, 'octo')));
    const u = b.units.find((v) => v.side === side), camp = b.camps[1 - side];
    let first = 0, amount = 0;
    run(b, 80, (e) => { if (e.type === 'hit' && e.kind === 'camp' && e.side === 1 - side) { if (!first) { first = b.t; amount = e.amount; } } });
    assert.ok(first > 0, 'le poulpe ' + (side ? 'rouge' : 'bleu') + ' atteint le camp adverse (il est en ' + Math.round(u.x) + ',' + Math.round(u.y) + ')');
    assert.ok(camp.hp < camp.maxHp && swimmable(u.x, u.y));
    assert.ok(amount <= Math.round(ANIMALS.octo.dmg * 0.45 * 1.5), 'dégâts réduits : ' + amount);
  }
});

await test('une boîte cassée donne un bonus au camp qui l\'a cassée', () => {
  const seenB = new Set();
  for (let seed = 1; seed < 60; seed++) {
    const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }], [{ id: 'monkey', level: 1 }]], seed });
    const c = b.crates[0];
    damage(b, c, c.hp + 5, { side: 0, aid: 'monkey', a: { mult: 1 } });
    const e = b.events.find((x) => x.type === 'crate_break');
    assert.ok(c.dead && e && e.side === 0); assert.equal(b.players[0].crates, 1);
    seenB.add(e.bonus);
    if (e.bonus === 'monkey' || e.bonus === 'kitten') assert.ok(b.units.some((u) => u.side === 0 && u.aid === e.bonus && u.gift));
  }
  for (const k of ['monkey', 'kitten', 'fruit', 'rage', 'aura']) assert.ok(seenB.has(k), 'bonus ' + k);
});

await test('la boîte dorée tombe du côté du camp mené ; la casser libère le singe doré, qui saute l\'eau et soigne beaucoup les siens', () => {
  const tie = campBattle(20); tie.t = tie.gold.at + 1; run(tie, 1);
  assert.ok(!tie.gold.box, 'personne n\'est mené : pas de boîte');
  for (const side of [0, 1]) {
    const b = campBattle(21 + side, ['bulldog', 'monkey'], ['bulldog', 'monkey']);
    assert.ok(b.gold.at >= GOLD.from && b.gold.at <= GOLD.to);
    b.camps[side].hp = Math.round(b.camps[side].maxHp * 0.7);
    b.t = b.gold.at - 0.05;
    let drop = null; run(b, 0.2, (e) => { if (e.type === 'gold_drop') drop = e; });
    const box = b.gold.box;
    assert.ok(drop && drop.side === side && box, 'elle tombe chez le camp mené');
    assert.ok((side === 0 ? box.y > 768 : box.y < 768) && walkable(box.x, box.y) && zoneAt(box.x, box.y) !== 6, 'de son côté, sur la terre ferme');
    b.players[side].aura = 10;
    deploy(b, side, handOf(b, side).findIndex((c) => c && c.id === 'bulldog'), ...(side === 0 ? [512, 1150] : [512, 330]));
    const u = b.units.find((x) => x.side === side); u.spawn = 0; u.hp = Math.round(u.maxHp * 0.3);
    damage(b, box, box.hp + 5, { side, aid: 'monkey', a: { mult: 1 } });
    assert.ok(box.dead && b.gold.monkeys.length === 1 && b.gold.monkeys[0].side === side, 'le singe doré sort pour le camp qui l\'a cassée');
    const m = b.gold.monkeys[0];
    let healed = 0, thrown = 0, n = 0;
    while (n < 40 / TICK && !m.gone) {
      step(b); n++;
      for (const e of b.events) { if (e.type === 'heal' && e.uid === u.id) healed += e.amount; if (e.type === 'gold_throw') thrown++; }
      b.events.length = 0;
      if (!m.gone) assert.ok(walkable(m.x, m.y) || goldAir(m) || !swimmable(m.x, m.y), 'le singe doré ne marche pas dans l\'eau : il saute');
    }
    assert.ok(thrown >= 1 && healed >= u.maxHp * 0.4, 'les bananes soignent : +' + healed);
    assert.ok(m.gone && thrown <= GOLD.bananas, 'il repart après ses bananes');
    assert.ok(!b.gold.box || b.gold.box === box, 'une seule boîte par combat');
  }
});

await test('une tour cassée passe au camp qui l\'a cassée : on peut poser à côté et son singe tire', () => {
  const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 3 });
  const t = b.towers[0];
  damage(b, t, t.hp + 1, { side: 0, aid: 'monkey', a: { mult: 1 } });
  assert.equal(t.side, 0); assert.ok(deployZones(b, 0).includes(3));
  assert.ok(b.events.some((e) => e.type === 'tower_take' && e.side === 0));
  b.events.length = 0;
  assert.equal(deploy(b, 1, 0, 300, 400), '');
  let shot = false, n = 0;
  while (!shot && n < 20 / TICK) { step(b); shot = b.events.some((e) => e.type === 'shot' && e.side === 0); b.events.length = 0; n++; }
  assert.ok(shot, 'le singe de la tour lance des pierres sur l\'adversaire');
});

await test('un ordre d\'attaque envoie l\'animal sur sa cible, Siffler le ramène à la tente', () => {
  const b = createBattle({ decks: [[{ id: 'bulldog', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 4 });
  deploy(b, 0, 0, 512, 1150);
  const u = b.units[0], crate = b.crates.find((c) => c.y > 768 && c.x < 512);
  assert.equal(command(b, 0, [u.id], { ref: crate.id }), 1);
  let n = 0; while (crate.hp === crate.maxHp && n < 30 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(crate.hp < crate.maxHp || crate.dead, 'le bulldog frappe la boîte demandée');
  command(b, 0, [u.id], { x: 512, y: 640 });
  n = 0; while (Math.hypot(u.x - 512, u.y - 640) > 20 && n < 30 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(Math.hypot(u.x - 512, u.y - 640) <= 20, 'il va où on l\'envoie');
  command(b, 0, [u.id], { home: true });
  n = 0; while (Math.hypot(u.x - BASE[0].x, u.y - BASE[0].y) > 4 * TILE && n < 40 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(Math.hypot(u.x - BASE[0].x, u.y - BASE[0].y) <= 4 * TILE, 'il rentre à la tente');
});

await test('compétences : l\'orang-outan se protège la tête, le cochon empoisonne, l\'éléphant puise de l\'eau', () => {
  const b = createBattle({ decks: [[{ id: 'orang', level: 1 }, { id: 'pig', level: 1 }, { id: 'elephant', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 8 });
  b.players[0].aura = 10;
  const slot = (id) => handOf(b, 0).findIndex((c) => c && c.id === id);
  deploy(b, 0, slot('orang'), 512, 1150);
  const o = b.units[0]; o.spawn = 0;
  damage(b, o, 50, { side: 1, aid: 'monkey' });
  assert.ok(o.guardT > 0, 'il se protège dès qu\'on le frappe');
  const hp = o.hp; damage(b, o, 500, { side: 1, aid: 'monkey' });
  assert.equal(o.hp, hp, 'intouchable pendant qu\'il se protège');
  b.clouds.push({ side: 1, x: o.x, y: o.y, r: 60, dps: 100, linger: 2, t: 3, acc: 0, T: 3 });
  o.guardT = 0; o.guardCd = 99;
  let n = 0; while (!o.poison && n < 2 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(o.poison, 'le nuage empoisonne');
  b.players[0].aura = 10;
  deploy(b, 0, slot('elephant'), 512, 1150);
  const el = b.units.find((u) => u.aid === 'elephant');
  n = 0; while (el.water === 0 && n < 25 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(el.water > 0, 'l\'éléphant a puisé de l\'eau');
});

// ---------- cartes et cages ----------
await test('une cage donne le bon nombre de cartes, toujours au moins une commune', () => {
  const rng = makeRng(3);
  for (const tier of CHEST_IDS) for (let i = 0; i < 300; i++) {
    const loot = rollChest(tier, 1, rng), C = CHESTS[tier];
    assert.equal(loot.cards.reduce((n, c) => n + c.n, 0), C.cards);
    assert.equal(new Set(loot.cards.map((c) => c.id)).size, loot.cards.length, 'une pile par animal');
    assert.ok(loot.cards.some((c) => ANIMALS[c.id].rarity === 'common'));
    for (const c of loot.cards) assert.ok(ANIMALS[c.id] && c.n > 0);
    assert.ok(loot.coins > 0);
  }
});

await test('même la plus petite cage peut donner toutes les raretés, et les grandes en donnent plus', () => {
  const rng = makeRng(11), seen = (tier, n) => { const got = Object.fromEntries(RARITIES.map((r) => [r, 0])); let cards = 0; for (let i = 0; i < n; i++) for (const c of rollChest(tier, 1, rng).cards) { got[ANIMALS[c.id].rarity] += c.n; cards += c.n; } return { got, cards }; };
  const small = seen('rustique', 40000);
  for (const r of RARITIES) assert.ok(small.got[r] > 0, 'la Cage Rustique doit pouvoir donner une carte ' + r);
  assert.ok(small.got.ultimate / small.cards < 0.001, 'les cartes ultimes restent très rares');
  const big = seen('royale', 3000);
  assert.ok(big.got.legendary / big.cards > small.got.legendary / small.cards * 10);
});

await test('améliorer coûte de plus en plus de cartes et de pièces, jusqu\'au niveau max', () => {
  for (const id of ANIMAL_IDS) {
    let prev = { cards: 0, coins: 0 };
    for (let lv = 1; lv < MAX_LEVEL; lv++) { const c = upgradeCost(id, lv); assert.ok(c.cards >= prev.cards && c.coins > prev.coins); prev = c; }
    assert.equal(upgradeCost(id, MAX_LEVEL), null);
  }
});

await test('la boutique propose une commune, une rare et une épique, les mêmes toute la journée', () => {
  const a = dailyOffers('2026-11-15', 'abc'), b = dailyOffers('2026-11-15', 'abc');
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((o) => ANIMALS[o.id].rarity), ['common', 'rare', 'epic']);
});

await test('les bots ont un deck valide', () => {
  const rng = makeRng(4);
  for (let arena = 1; arena <= 5; arena++) for (let i = 0; i < 30; i++) {
    const bot = makeBot(rng, { trophies: arena * 300, level: 3, arena, first: i === 0 });
    assert.ok(validDeck(bot.deck)); assert.ok(bot.deck.some((c) => ANIMALS[c.id].targets === 'all'));
  }
});

// ---------- sauvegarde ----------
await test('une sauvegarde de la version 1 devient des cartes et reçoit la cage de bienvenue', async () => {
  store['beastbrawl.v1'] = JSON.stringify({ uid: 'x', name: 'Ancien', animals: { monkey: { level: 4 }, bulldog: { level: 3 } }, formation: [{ id: 'monkey', col: 1, row: 1 }], stars: 12, rubies: 30, trophies: 420 });
  const { load } = await import('../src/core/save.js');
  const S = load();
  assert.equal(S.v, 2); assert.equal(S.cards.monkey.level, 4); assert.equal(S.cards.bulldog.level, 3);
  assert.deepEqual(S.deck, ['monkey', 'bulldog']); assert.equal(S.crowns, 12); assert.equal(S.rubies, 80); assert.equal(S.welcome, false);
  assert.equal(S.animals, undefined); assert.equal(S.trophies, 420);
});

console.log(`\n${passed} tests réussis`);
