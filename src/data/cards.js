// Cartes, raretés, cages (coffres) et offres de la boutique : tous les chiffres sont ici.
import { ANIMALS, ANIMAL_IDS, MAX_LEVEL } from './animals.js';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'ultimate'];
export const RARITY = {
  common: { name: 'Commune', color: '#3fa9ff', dark: '#0f4fa8', glow: '#9fe0ff', coinK: 1 },
  rare: { name: 'Rare', color: '#ff9a2e', dark: '#b4520a', glow: '#ffd08a', coinK: 1.5 },
  epic: { name: 'Épique', color: '#c25cff', dark: '#5e1fa8', glow: '#e6b8ff', coinK: 2 },
  legendary: { name: 'Légendaire', color: '#ffd23f', dark: '#b07a00', glow: '#fff3b0', coinK: 3 },
  ultimate: { name: 'Ultime', color: '#ff6ad5', dark: '#7a1fa8', glow: '#ffffff', coinK: 4, rainbow: true },
};
export const rarityOf = (id) => ANIMALS[id].rarity;
export const ofRarity = (r) => ANIMAL_IDS.filter((id) => ANIMALS[id].rarity === r);

// Cartes nécessaires pour passer du niveau n au niveau n+1 (case n-1), comme dans Clash Royale
export const CARDS_NEED = {
  common: [2, 4, 10, 20, 50, 100, 200, 400, 800, 1000],
  rare: [1, 2, 4, 10, 20, 50, 100, 200, 400, 500],
  epic: [1, 2, 4, 6, 10, 20, 40, 60, 100, 150],
  legendary: [1, 1, 2, 3, 4, 6, 10, 15, 20, 30],
  ultimate: [1, 1, 1, 2, 2, 3, 4, 6, 8, 10],
};
const COINS = [50, 150, 400, 1000, 2000, 4000, 8000, 15000, 25000, 40000];
export function upgradeCost(id, level) {
  if (level >= MAX_LEVEL) return null;
  const r = rarityOf(id);
  return { cards: CARDS_NEED[r][level - 1], coins: Math.round(COINS[level - 1] * RARITY[r].coinK / 10) * 10, xp: 10 * level };
}

// ---------- les cages ----------
// odds : chance qu'une carte soit commune, rare, épique, légendaire, ultime (en %). Toutes les cages peuvent tout donner.
export const CHEST_IDS = ['rustique', 'sauvage', 'blindee', 'doree', 'cornes', 'cristalline', 'royale'];
export const CHESTS = {
  rustique: { name: 'Cage Rustique', tier: 'Commune', gems: 50, time: 3 * 60, cards: 6, stacks: 2, coins: 60, gemsIn: [0, 0], odds: [89.4, 9, 1.4, 0.18, 0.02], color: '#c98a4a' },
  sauvage: { name: 'Cage Sauvage', tier: 'Peu commune', gems: 100, time: 15 * 60, cards: 10, stacks: 3, coins: 120, gemsIn: [0, 0], odds: [85, 12.5, 2.2, 0.27, 0.03], color: '#7ccf3a' },
  blindee: { name: 'Cage Blindée', tier: 'Rare', gems: 200, time: 60 * 60, cards: 18, stacks: 3, coins: 300, gemsIn: [0, 2], odds: [78, 18, 3.4, 0.54, 0.06], color: '#5aa0ff' },
  doree: { name: 'Cage Dorée', tier: 'Héroïque', gems: 400, time: 3 * 3600, cards: 35, stacks: 4, coins: 700, gemsIn: [2, 6], odds: [70, 23, 6, 0.9, 0.1], color: '#ffc21f' },
  cornes: { name: 'Cage à Cornes', tier: 'Épique', gems: 800, time: 8 * 3600, cards: 60, stacks: 4, coins: 1500, gemsIn: [6, 12], odds: [60, 28, 10, 1.75, 0.25], color: '#ff5a3a' },
  cristalline: { name: 'Cage Cristalline', tier: 'Légendaire', gems: 1200, time: 12 * 3600, cards: 100, stacks: 5, coins: 3000, gemsIn: [12, 25], odds: [50, 32, 14, 3.4, 0.6], color: '#4fd8ff' },
  royale: { name: 'Cage Royale', tier: 'Mythique', gems: 2000, time: 24 * 3600, cards: 160, stacks: 6, coins: 6000, gemsIn: [25, 50], odds: [40, 35, 18, 6, 1], color: '#ffd23f' },
};
export const CHEST_SLOTS = 4;
// Ordre des cages gagnées en combat (comme le cycle de Clash Royale) : R rustique, S sauvage, B blindée, D dorée, C cornes, X cristalline, Y royale
const CYCLE = 'RSRRSBRSRDRSRRBSRSCRSRRBSRDRSRXRSRBSRRSRDSRBRSRRSY';
const LETTER = { R: 'rustique', S: 'sauvage', B: 'blindee', D: 'doree', C: 'cornes', X: 'cristalline', Y: 'royale' };
export const cycleChest = (i) => LETTER[CYCLE[((i % CYCLE.length) + CYCLE.length) % CYCLE.length]];
// Ouvrir tout de suite : 1 gemme par tranche de 6 minutes restantes (au moins 1) ; une patte fait gagner 2 minutes
export const gemsToOpen = (sec) => Math.max(1, Math.ceil(sec / 360));
export const PAW_SECONDS = 120;

// Tire le contenu d'une cage. rng() renvoie un nombre entre 0 et 1. arena : arène du joueur (plus de pièces plus haut).
// Renvoie { coins, gems, cards: [{ id, n }] } avec les cartes rangées de la moins rare à la plus rare.
export function rollChest(tier, arena = 1, rng = Math.random) {
  const C = CHESTS[tier], cum = [];
  let s = 0; for (const o of C.odds) { s += o; cum.push(s); }
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < C.cards; i++) { const x = rng() * s; counts[cum.findIndex((c) => x < c)]++; }
  if (!counts[0]) { counts[0] = 1; counts[counts.findIndex((n, i) => i > 0 && n > 0)]--; }     // toujours au moins une carte commune
  const stacks = [];
  RARITIES.forEach((r, ri) => {
    let n = counts[ri]; if (!n) return;
    const pool = ofRarity(r).slice();
    const k = Math.max(1, Math.min(pool.length, ri === 0 ? Math.min(3, Math.ceil(n / 4)) : n >= 8 ? 2 : 1));
    for (let j = 0; j < k; j++) {
      const id = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const take = j === k - 1 ? n : Math.max(1, Math.round(n * (0.4 + rng() * 0.3)));
      stacks.push({ id, n: take, r: ri }); n -= take;
    }
  });
  // trop de piles différentes : on regroupe les plus petites piles communes
  while (stacks.length > C.stacks) {
    const commons = stacks.filter((x) => x.r === 0).sort((a, b) => a.n - b.n);
    if (commons.length < 2) break;
    const [a, b] = commons; b.n += a.n; stacks.splice(stacks.indexOf(a), 1);
  }
  stacks.sort((a, b) => a.r - b.r || a.n - b.n);
  const k = 1 + 0.25 * (arena - 1);
  const coins = Math.round(C.coins * k * (0.85 + rng() * 0.3));
  const gems = C.gemsIn[1] ? C.gemsIn[0] + Math.floor(rng() * (C.gemsIn[1] - C.gemsIn[0] + 1)) : 0;
  return { tier, coins, gems, cards: stacks.map(({ id, n }) => ({ id, n })) };
}

// Cage de bienvenue des joueurs de la version 1 : le Chaton, le Bulldog et le Cochon rejoignent le Singe de départ
export const WELCOME = { tier: 'sauvage', coins: 150, gems: 0, cards: [{ id: 'kitten', n: 4 }, { id: 'bulldog', n: 3 }, { id: 'pig', n: 1 }], welcome: true };
// Coffre en bois de la fin du tutoriel (cage rustique) : des communes, dont le poisson clown, et quelques rares. Avec les 2
// singes, le Singe de départ peut passer au niveau 2 tout de suite.
export const STARTER = { tier: 'rustique', coins: 200, gems: 0, welcome: true, title: 'Coffre en bois', sub: 'Cadeau de Barnabé !',
  cards: [{ id: 'monkey', n: 2 }, { id: 'kitten', n: 4 }, { id: 'bulldog', n: 3 }, { id: 'clownfish', n: 4 }, { id: 'pig', n: 1 }, { id: 'octo', n: 1 }] };

// ---------- boutique : trois offres de cartes du jour, payées en pièces ----------
export const OFFERS = [
  { rarity: 'common', label: 'Basique', n: 50, price: 5000 },
  { rarity: 'rare', label: 'Costaud', n: 20, price: 20000 },
  { rarity: 'epic', label: 'Monstrueux', n: 10, price: 50000 },
];
// Les animaux du jour (les mêmes toute la journée pour un joueur donné)
export function dailyOffers(day, seed) {
  let h = 2166136261 >>> 0;
  for (const ch of day + seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return OFFERS.map((o, i) => { const pool = ofRarity(o.rarity); return { ...o, id: pool[(h >>> (i * 5)) % pool.length] }; });
}
export const DECK_SIZE = 8;
