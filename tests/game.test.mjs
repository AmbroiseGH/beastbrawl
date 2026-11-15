// Tests sans navigateur : moteur de combat en temps réel, cages et cartes, sauvegarde. Lancer avec « npm test ».
import assert from 'node:assert/strict';

// le jeu lit l'adresse de la page et le stockage du navigateur : on en donne de faux
const store = {};
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };

const { createBattle, step, deploy, handOf, summary, TICK, DURATION, OVERTIME } = await import('../src/game/rt.js');
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
    for (const e of b.events) if (e.type === 'tower_down' || e.type === 'end') log.push(e.type + ':' + e.side + ':' + (e.winner ?? '') + '@' + b.t.toFixed(2));
    b.events.length = 0;
  }
  return { b, log, s: summary(b, 0) };
}

await test('un combat entre deux ordinateurs va jusqu\'au bout', () => {
  for (let i = 0; i < 6; i++) {
    const deck = [...ANIMAL_IDS].sort(() => makeRng(i)() - 0.5);
    const { b, s } = play(1000 + i, deck.slice(0, 8), deck.slice(2, 10));
    assert.ok(b.over, 'le combat doit se terminer');
    assert.ok(s.crowns >= 0 && s.crowns <= 3 && s.lost >= 0 && s.lost <= 3);
    if (!s.draw) assert.equal(s.win, b.winner === 0);
  }
});

await test('la même graine redonne exactement le même combat', () => {
  const d0 = ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla'], d1 = ['rhino', 'elephant', 'kitten', 'monkey', 'bulldog', 'pig', 'orang', 'eagle'];
  const a = play(77, d0, d1), b = play(77, d0, d1);
  assert.deepEqual(a.log, b.log);
  assert.equal(a.b.t, b.b.t);
});

await test('poser une carte coûte de l\'Aura et respecte la zone de pose', () => {
  const b = createBattle({ decks: [[{ id: 'monkey', level: 1 }, { id: 'kitten', level: 1 }, { id: 'bulldog', level: 1 }, { id: 'pig', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 5 });
  const p = b.players[0], slot = handOf(b, 0).findIndex((c) => c && c.id === 'bulldog');
  assert.equal(p.aura, 5);
  assert.equal(deploy(b, 0, slot, 400, 300), 'zone', 'pas de pose chez l\'adversaire');
  assert.equal(deploy(b, 0, slot, 400, 1100), '');
  assert.equal(p.aura, 1);
  const s2 = handOf(b, 0).findIndex((c) => c && c.cost > 1);
  assert.equal(deploy(b, 0, s2, 400, 1100), 'aura');
  assert.equal(b.units.filter((u) => u.side === 0).length, 1);
});

await test('casser la structure principale termine le combat avec 3 couronnes', () => {
  const b = createBattle({ decks: [[{ id: 'pig', level: 1 }], [{ id: 'monkey', level: 1 }]], seed: 9 });
  for (const t of b.towers) if (t.side === 1) t.hp = 1;
  deploy(b, 0, 0, 470, 1000);
  let n = 0; while (!b.over && n < 60 / TICK) { step(b); b.events.length = 0; n++; }
  assert.ok(b.over); assert.equal(b.winner, 0);
  assert.equal(summary(b, 0).crowns, 3);
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
