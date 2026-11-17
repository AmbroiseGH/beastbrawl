// Tests sans navigateur : moteur de combat en temps réel, cages et cartes, sauvegarde. Lancer avec « npm test ».
import assert from 'node:assert/strict';

// le jeu lit l'adresse de la page et le stockage du navigateur : on en donne de faux
const store = {};
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };

const { createBattle, step, deploy, handOf, summary, command, damage, deployZones, TICK, TILE, DURATION, OVERTIME, BASE } = await import('../src/game/rt.js');
const { findPath, walkable, zoneAt, los } = await import('../src/game/nav.js');
const { makeAI, aiStep } = await import('../src/game/ai.js');
const { makeRng } = await import('../src/core/rng.js');
const { ANIMAL_IDS, ANIMALS, MAX_LEVEL } = await import('../src/data/animals.js');
const { CHESTS, CHEST_IDS, RARITIES, rollChest, upgradeCost, dailyOffers } = await import('../src/data/cards.js');
const { makeBot, validDeck } = await import('../src/data/bots.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// ---------- combat ----------
function play(seed, d0, d1, s0 = 0.5, s1 = 0.5) {
  const b = createBattle({ decks: [d0.map((id) => ({ id, level: 1 })), d1.map((id) => ({ id, level: 1 }))], towerLevels: [1, 1], seed });
  const r = makeRng(seed + 7), a0 = makeAI(0, s0, r), a1 = makeAI(1, s1, r);
  const log = [];
  let n = 0;
  while (!b.over && n < (DURATION + OVERTIME + 5) / TICK) {
    aiStep(b, a0, TICK); aiStep(b, a1, TICK); step(b); n++;
    for (const e of b.events) if (e.type === 'tower_take' || e.type === 'crate_break' || e.type === 'end') log.push(e.type + ':' + e.side + ':' + (e.bonus || e.winner || '') + '@' + b.t.toFixed(2));
    b.events.length = 0;
    if (n % 15 === 0) for (const u of b.units) if (!u.dead && !u.air && u.spawn <= 0) assert.ok(walkable(u.x, u.y), `${u.aid} hors du sol en ${Math.round(u.x)},${Math.round(u.y)}`);
  }
  return { b, log, s: summary(b, 0) };
}

await test('un combat entre deux ordinateurs va jusqu\'au bout', () => {
  for (let i = 0; i < 6; i++) {
    const deck = [...ANIMAL_IDS].sort(() => makeRng(i)() - 0.5);
    const { b, s } = play(1000 + i, deck.slice(0, 8), deck.slice(2, 10));
    assert.ok(b.over, 'le combat doit se terminer');
    assert.ok(s.crowns >= 0 && s.crowns <= 3 && s.lost >= 0 && s.lost <= 3);
    assert.ok(s.gauge >= 0 && s.gauge <= 100 && s.foeGauge >= 0 && s.foeGauge <= 100);
    if (!s.draw) assert.equal(s.win, b.winner === 0);
    if (b.why === 'time' || b.why === 'overtime') assert.ok(b.winner === 0 ? b.players[0].gauge > b.players[1].gauge : b.players[1].gauge > b.players[0].gauge, 'la jauge la plus remplie gagne');
  }
});

await test('la même graine redonne exactement le même combat', () => {
  const d0 = ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla'], d1 = ['rhino', 'elephant', 'kitten', 'monkey', 'bulldog', 'pig', 'orang', 'eagle'];
  const a = play(77, d0, d1), b = play(77, d0, d1);
  assert.deepEqual(a.log, b.log);
  assert.equal(a.b.t, b.b.t);
});

await test('poser une carte coûte de l\'Aura et respecte la zone de pose (bleue, en bas)', () => {
  const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }, { id: 'kitten', level: 1 }, { id: 'bulldog', level: 1 }, { id: 'pig', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 5 });
  const p = b.players[0], slot = handOf(b, 0).findIndex((c) => c && c.id === 'bulldog');
  assert.equal(p.aura, 5);
  assert.equal(deploy(b, 0, slot, 767, 230), 'zone', 'pas de pose chez l\'adversaire');
  assert.equal(deploy(b, 0, slot, 767, 500), 'zone', 'pas de pose au centre');
  assert.equal(deploy(b, 0, slot, 160, 470), 'zone', 'pas de pose près d\'une tour qu\'on ne tient pas');
  assert.equal(deploy(b, 0, slot, 767, 790), '');
  assert.equal(p.aura, 1);
  const s2 = handOf(b, 0).findIndex((c) => c && c.cost > 1);
  assert.equal(deploy(b, 0, s2, 767, 790), 'aura');
  assert.equal(b.units.filter((u) => u.side === 0).length, 1);
});

await test('les animaux au sol vont d\'une tente à l\'autre par les ponts', () => {
  for (const [x0, y0, x1, y1] of [[767, 800, 767, 190], [767, 800, 160, 520], [600, 780, 1372, 520], [767, 800, 505, 241]]) {
    const pts = findPath(x0, y0, x1, y1);
    assert.ok(pts && pts.length > 1);
    let bridge = false, px = x0, py = y0;
    for (const [x, y] of pts) {
      assert.ok(los(px, py, x, y), 'le chemin passe par le sol');
      for (let k = 1; k <= 24; k++) if (zoneAt(px + (x - px) * k / 24, py + (y - py) * k / 24) === 6) bridge = true;
      px = x; py = y;
    }
    assert.ok(bridge, 'le chemin emprunte un pont');
  }
});

await test('remplir sa jauge en frappant la cible termine le combat avec 3 étoiles', () => {
  const b = createBattle({ decks: [[{ id: 'pig', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 9 });
  b.players[0].gauge = 99; b.players[1].gauge = 40;
  damage(b, b.machine, b.gaugeHp * 0.004, { side: 0, aid: 'pig' });
  assert.ok(Math.abs(b.players[1].gauge - 39.6) < 1e-6, 'la jauge adverse descend d\'autant');
  deploy(b, 0, 0, 767, 790);
  let n = 0; while (!b.over && n < 90 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(b.over); assert.equal(b.winner, 0); assert.equal(b.why, 'full');
  assert.equal(summary(b, 0).crowns, 3);
});

// ---------- mode camps ----------
const campBattle = (seed = 5, d0 = ['monkey'], d1 = ['monkey']) => createBattle({ decks: [d0.map((id) => ({ id, level: 1 })), d1.map((id) => ({ id, level: 1 }))], seed, mode: 'camps' });
const run = (b, sec, fn) => { let n = 0; while (!b.over && n < sec / TICK) { step(b); if (fn) for (const e of b.events) fn(e); b.events.length = 0; n++; } };

await test('mode camps : un combat entre deux ordinateurs va jusqu\'au bout, la catapulte tire et les camps encaissent', () => {
  let shots = 0, hurt = 0;
  for (let i = 0; i < 6; i++) {
    const deck = [...ANIMAL_IDS].sort(() => makeRng(40 + i)() - 0.5).slice(0, 8);
    const b = campBattle(2000 + i, deck, deck), a0 = makeAI(0, 0.5, makeRng(77 + i)), a1 = makeAI(1, 0.6, makeRng(177 + i));
    let n = 0;
    while (!b.over && n < (DURATION + OVERTIME + 5) / TICK) {
      aiStep(b, a0, TICK); aiStep(b, a1, TICK); step(b); n++;
      for (const e of b.events) if (e.type === 'catapult') shots++;
      b.events.length = 0;
      if (n % 15 === 0) for (const u of b.units) if (!u.dead && !u.air && u.spawn <= 0) assert.ok(walkable(u.x, u.y), `${u.aid} hors du sol en ${Math.round(u.x)},${Math.round(u.y)}`);
    }
    assert.ok(b.over, 'le combat doit se terminer');
    assert.ok(['camp', 'time', 'overtime', 'tie'].includes(b.why), b.why);
    if (b.camps.some((c) => c.hp < c.maxHp)) hurt++;
    const s = summary(b, 0);
    assert.equal(s.mode, 'camps'); assert.ok(s.crowns >= 0 && s.crowns <= 3 && s.gauge >= 0 && s.gauge <= 100);
  }
  assert.ok(shots > 0, 'au moins un tir de catapulte'); assert.ok(hurt >= 4, 'les camps sont attaqués');
});

await test('mode camps : sans ordre ni ennemi en vue, un animal marche vers le camp adverse', () => {
  const b = campBattle(6);
  deploy(b, 0, 0, 767, 790);
  run(b, 2);
  const u = b.units.find((x) => x.side === 0);
  assert.equal(u.target, b.camps[1].id);
});

await test('mode camps : le garde lance des pierres sur l\'ennemi qui approche du camp, jamais sur les siens', () => {
  const b = campBattle(7);
  deploy(b, 0, 0, 700, 800); deploy(b, 1, 0, 767, 230);
  const mine = b.units.find((x) => x.side === 0), foe = b.units.find((x) => x.side === 1);
  foe.x = 767; foe.y = 760; foe.order = { x: 767, y: 760 };           // notre singe est plus près du camp que l'ennemi
  const targets = [];
  run(b, 3, (e) => { if (e.type === 'shot' && e.camp) { assert.equal(e.side, 0); targets.push(b.camps[0].target); } });
  assert.ok(targets.length >= 1, 'le garde tire');
  for (const t of targets) assert.equal(t, foe.id);
  assert.ok(foe.hp < foe.maxHp, 'l\'ennemi est touché'); assert.notEqual(b.camps[0].target, mine.id);
});

await test('mode camps : la machine charge la catapulte de chaque camp, un tir enlève 12 % du camp adverse, le camp mené charge plus vite', () => {
  const b = campBattle(8), c1 = b.camps[1], info = { side: 0, aid: 'monkey', a: { mult: 1 } };
  damage(b, b.machine, b.gaugeHp * 0.5, info);
  assert.ok(Math.abs(b.players[0].gauge - 50) < 1e-6); assert.equal(b.players[1].gauge, 0, 'charges indépendantes');
  damage(b, b.machine, b.gaugeHp * 0.5, info);
  assert.ok(b.events.some((e) => e.type === 'catapult' && e.side === 0)); assert.equal(b.players[0].gauge, 0, 'la charge repart de zéro');
  assert.ok(b.projs.some((p) => p.key === 'boulder' && p.target === c1.id));
  run(b, 2);
  assert.equal(c1.hp, Math.round(c1.maxHp * 0.88));
  b.camps[0].hp = Math.round(b.camps[0].maxHp * 0.7);         // 18 points de retard : la charge va 2,2 fois plus vite
  damage(b, b.machine, b.gaugeHp * 0.1, info);
  assert.ok(Math.abs(b.players[0].gauge - 22) < 0.05, String(b.players[0].gauge));
});

await test('mode camps : le camp mené recharge son Aura plus vite', () => {
  const b = campBattle(9);
  b.camps[0].hp = Math.round(b.camps[0].maxHp * 0.6);          // 40 points de retard : +50 %
  b.players[0].aura = 0; b.players[1].aura = 0;
  run(b, 3);
  assert.ok(Math.abs(b.players[0].aura / b.players[1].aura - 1.5) < 0.01, String(b.players[0].aura / b.players[1].aura));
});

await test('mode camps : camp détruit = victoire à 3 étoiles ; au temps, le camp le moins abîmé gagne ; en mort subite, le premier camp touché perd', () => {
  let b = campBattle(10);
  damage(b, b.camps[1], b.camps[1].hp + 10, { side: 0, aid: 'monkey', a: { mult: 1 } });
  assert.ok(b.over && b.camps[1].dead); assert.equal(b.winner, 0); assert.equal(b.why, 'camp');
  let s = summary(b, 0); assert.equal(s.crowns, 3); assert.equal(s.gauge, 100); assert.equal(s.lost, 0);
  b = campBattle(11);
  b.camps[1].hp = Math.round(b.camps[1].maxHp * 0.45); b.camps[0].hp = Math.round(b.camps[0].maxHp * 0.8); b.clock = 0.01;
  run(b, 0.1);
  assert.ok(b.over); assert.equal(b.winner, 0); assert.equal(b.why, 'time');
  s = summary(b, 0); assert.equal(s.crowns, 2); assert.equal(s.lost, 0); assert.equal(summary(b, 1).crowns, 0);
  b = campBattle(12); b.clock = 0.01;
  run(b, 0.1);
  assert.ok(b.overtime && !b.over, 'égalité : mort subite');
  damage(b, b.camps[0], 1, { side: 1, aid: 'monkey', a: { mult: 1 } });
  assert.ok(b.over); assert.equal(b.winner, 1); assert.equal(b.why, 'overtime');
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

await test('une tour cassée passe au camp qui l\'a cassée : on peut poser à côté et son orang-outan tire', () => {
  const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 3 });
  const t = b.towers[0];
  damage(b, t, t.hp + 1, { side: 0, aid: 'monkey', a: { mult: 1 } });
  assert.equal(t.side, 0); assert.ok(deployZones(b, 0).includes(3));
  assert.ok(b.events.some((e) => e.type === 'tower_take' && e.side === 0));
  b.events.length = 0;
  assert.equal(deploy(b, 1, 0, 700, 250), '');
  let shot = false, n = 0;
  while (!shot && n < 20 / TICK) { step(b); shot = b.events.some((e) => e.type === 'shot' && e.side === 0); b.events.length = 0; n++; }
  assert.ok(shot, 'l\'orang-outan de la tour lance des pierres sur l\'adversaire');
});

await test('un ordre d\'attaque envoie l\'animal sur sa cible, Siffler le ramène à la tente', () => {
  const b = createBattle({ decks: [[{ id: 'bulldog', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 4 });
  deploy(b, 0, 0, 767, 790);
  const u = b.units[0], crate = b.crates.find((c) => c.y > 700 && c.x < 700);
  assert.equal(command(b, 0, [u.id], { ref: crate.id }), 1);
  let n = 0; while (crate.hp === crate.maxHp && n < 30 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(crate.hp < crate.maxHp || crate.dead, 'le bulldog frappe la boîte demandée');
  command(b, 0, [u.id], { x: 767, y: 560 });
  n = 0; while (Math.hypot(u.x - 767, u.y - 560) > 20 && n < 30 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(Math.hypot(u.x - 767, u.y - 560) <= 20, 'il va où on l\'envoie');
  command(b, 0, [u.id], { home: true });
  n = 0; while (Math.hypot(u.x - BASE[0].x, u.y - BASE[0].y) > 4 * TILE && n < 40 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(Math.hypot(u.x - BASE[0].x, u.y - BASE[0].y) <= 4 * TILE, 'il rentre à la tente');
});

await test('compétences : l\'orang-outan se protège la tête, le cochon empoisonne, l\'éléphant puise de l\'eau', () => {
  const b = createBattle({ decks: [[{ id: 'orang', level: 1 }, { id: 'pig', level: 1 }, { id: 'elephant', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 8 });
  b.players[0].aura = 10;
  const slot = (id) => handOf(b, 0).findIndex((c) => c && c.id === id);
  deploy(b, 0, slot('orang'), 767, 790);
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
  deploy(b, 0, slot('elephant'), 767, 790);
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
