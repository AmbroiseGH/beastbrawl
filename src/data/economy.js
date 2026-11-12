// Récompenses, prix et progression : tous les chiffres de l'économie sont ici.
import { ANIMALS, MAX_LEVEL } from './animals.js';

// Niveau du joueur : XP nécessaire pour passer du niveau n au suivant (100 au niveau 1)
export const xpNeed = (level) => Math.round(100 * Math.pow(level, 1.4) / 10) * 10;
export const levelReward = (level) => ({ coins: 1000 * level, rubies: 5 });

// Arènes : une nouvelle arène tous les 300 trophées
export const ARENA_STEP = 300, ARENA_MAX = 10;
export const arenaOf = (trophies) => Math.min(ARENA_MAX, Math.floor(trophies / ARENA_STEP) + 1);
export const arenaRange = (arena) => arena >= ARENA_MAX ? [(arena - 1) * ARENA_STEP, null] : [(arena - 1) * ARENA_STEP, arena * ARENA_STEP - 1];

// Étoiles d'une victoire selon la part de l'équipe encore debout
export const starsFor = (survivors, total) => { const r = survivors / Math.max(1, total); return r >= 0.6 ? 3 : r >= 0.3 ? 2 : 1; };

// Récompenses d'un combat. ranked = false pour les combats amicaux (amis, clan) : pas de trophées.
export function fightRewards({ win, stars, kos, streak, arena, ranked, oppTrophies, trophies, firstWin }) {
  const r = { coins: 0, xp: 0, paws: 0, rubies: 0, trophies: 0, streakBonus: 0 };
  if (win) {
    const base = 900 + 150 * (stars - 1) + 150 * (arena - 1);
    r.streakBonus = Math.round(base * Math.min(0.5, 0.1 * Math.max(0, streak - 1)));
    r.coins = base + r.streakBonus;
    r.xp = 40 + 10 * stars;
    r.paws = 5 + 2 * kos;
    r.rubies = (stars === 3 ? 1 : 0) + (firstWin ? 5 : 0);
    if (ranked) r.trophies = Math.max(24, Math.min(36, 30 + Math.round((oppTrophies - trophies) / 25)));
  } else {
    r.coins = 250 + 40 * kos;
    r.xp = 15;
    r.paws = 2 * kos;
    if (ranked) r.trophies = -Math.min(trophies, Math.max(14, Math.min(26, 20 - Math.round((oppTrophies - trophies) / 25))));
  }
  if (!ranked) { r.coins = Math.round(r.coins * 0.5); r.paws = Math.round(r.paws * 0.5); r.rubies = 0; }
  return r;
}

// Améliorer un animal : du niveau n au niveau n+1
const PAWS = [10, 20, 40, 70, 110, 160, 220, 300, 400, 520, 660, 820, 1000, 1200];
export function upgradeCost(level) {
  if (level >= MAX_LEVEL) return null;
  return { paws: PAWS[level - 1], coins: Math.round(800 * Math.pow(level, 1.5) / 100) * 100 };
}

// Boutique : les dix animaux de la maquette, dans l'ordre des cartes. Seuls le singe et le bulldog sont jouables.
export const SHOP = [
  { id: 'monkey', name: 'Singe', price: 10000 }, { id: 'chaton', name: 'Chaton', price: 5000 }, { id: 'bulldog', name: 'Bulldog', price: 15000 },
  { id: 'alligator', name: 'Alligator', price: 30000 }, { id: 'orangutan', name: 'Orang-outan', price: 50000 }, { id: 'cochon', name: 'Cochon', price: 30000 },
  { id: 'gorille', name: 'Gorille', price: 500000 }, { id: 'rhinoceros', name: 'Rhinocéros', price: 300000 }, { id: 'aigle', name: 'Aigle', price: 200000 },
  { id: 'elephant', name: 'Éléphant', price: 1000000 },
];
export const playable = (id) => !!ANIMALS[id];

// Échanges des boutons « + »
export const EXCHANGE = {
  coins: [{ rubies: 10, get: 2500 }, { rubies: 40, get: 12000 }, { rubies: 100, get: 35000 }],
  paws: [{ rubies: 10, get: 30 }, { rubies: 40, get: 140 }, { rubies: 100, get: 400 }],
};

// Cadeau du jour : il grossit quand on revient plusieurs jours de suite (7 paliers)
export const DAILY = [
  { coins: 1500, paws: 10, rubies: 2 }, { coins: 2000, paws: 15, rubies: 3 }, { coins: 2500, paws: 20, rubies: 4 }, { coins: 3000, paws: 25, rubies: 5 },
  { coins: 4000, paws: 30, rubies: 6 }, { coins: 5000, paws: 40, rubies: 8 }, { coins: 8000, paws: 60, rubies: 15 },
];

// Quêtes du jour (3 tirées au hasard chaque jour) et quêtes de départ (une seule fois)
export const DAILY_QUESTS = [
  { id: 'win3', text: 'Gagne 3 combats', stat: 'wins', goal: 3, reward: { coins: 2500 } },
  { id: 'fight5', text: 'Joue 5 combats', stat: 'fights', goal: 5, reward: { coins: 1500, paws: 10 } },
  { id: 'ko15', text: 'Mets 15 animaux K.-O.', stat: 'kos', goal: 15, reward: { paws: 25 } },
  { id: 'stars6', text: 'Gagne 6 étoiles', stat: 'stars', goal: 6, reward: { rubies: 5 } },
  { id: 'streak2', text: 'Gagne 2 combats de suite', stat: 'streakMax', goal: 2, reward: { coins: 2000, rubies: 2 } },
  { id: 'up1', text: 'Améliore un animal', stat: 'upgrades', goal: 1, reward: { coins: 2000 } },
];
export const STARTER_QUESTS = [
  { id: 's_win', text: 'Remporte ta première victoire', stat: 'wins', goal: 1, reward: { coins: 5000 } },
  { id: 's_up', text: 'Améliore le Singe au niveau 2', check: (S) => S.animals.monkey && S.animals.monkey.level >= 2, reward: { coins: 3000, paws: 15 } },
  { id: 's_bulldog', text: 'Achète le Bulldog dans la boutique', check: (S) => !!S.animals.bulldog, reward: { rubies: 10, paws: 20 } },
  { id: 's_3stars', text: 'Gagne un combat avec 3 étoiles', stat: 'threeStars', goal: 1, reward: { coins: 3000, rubies: 3 } },
  { id: 's_arena2', text: 'Atteins l\'Arène 2 (300 trophées)', check: (S) => S.best >= 300, reward: { coins: 8000, rubies: 10 } },
  { id: 's_clan', text: 'Rejoins ou crée un clan', check: (S) => !!S.clan, reward: { coins: 2000, rubies: 5 } },
];

// Coffre de victoire : trois cartes face cachée, le joueur en retourne une
export function chestCards(rng, arena) {
  const one = () => {
    const x = rng();
    if (x < 0.5) return { coins: Math.round((400 + rng() * 900 + 100 * arena) / 50) * 50 };
    if (x < 0.85) return { paws: 6 + Math.floor(rng() * 16) };
    return { rubies: 2 + Math.floor(rng() * 4) };
  };
  return [one(), one(), one()];
}
