// Récompenses, prix et progression : tous les chiffres de l'économie sont ici.
// (les cartes, les cages et la boutique sont dans cards.js)

// Niveau du joueur : XP nécessaire pour passer du niveau n au suivant (100 au niveau 1)
export const xpNeed = (level) => Math.round(100 * Math.pow(level, 1.4) / 10) * 10;
export const levelReward = (level) => ({ coins: 500 * level, rubies: 5 });

// Arènes : une nouvelle arène tous les 300 trophées, chacune avec son décor et sa musique
export const ARENA_STEP = 300, ARENA_MAX = 5;
export const ARENAS = [
  { name: 'Savane Ardente', music: 'fight1' },
  { name: 'Jungle Profonde', music: 'fight2' },
  { name: 'Plage Tropicale', music: 'fight3' },
  { name: 'Pics Glacés', music: 'fight4' },
  { name: 'Volcan Rugissant', music: 'fight1' },
];
export const arenaOf = (trophies) => Math.min(ARENA_MAX, Math.floor(trophies / ARENA_STEP) + 1);
export const arenaRange = (arena) => arena >= ARENA_MAX ? [(arena - 1) * ARENA_STEP, null] : [(arena - 1) * ARENA_STEP, arena * ARENA_STEP - 1];

// Récompenses d'un combat. crowns : couronnes gagnées (0 à 3). ranked = false pour les combats amicaux : ni trophées ni cage.
export function fightRewards({ win, draw, crowns, kos, streak, arena, ranked, oppTrophies, trophies, firstWin }) {
  const r = { coins: 0, xp: 0, paws: 0, rubies: 0, trophies: 0, streakBonus: 0 };
  const k = 1 + 0.25 * (arena - 1);
  if (win) {
    const base = Math.round((250 + 100 * crowns) * k);
    r.streakBonus = Math.round(base * Math.min(0.5, 0.1 * Math.max(0, streak - 1)));
    r.coins = base + r.streakBonus;
    r.xp = 30 + 10 * crowns;
    r.rubies = (crowns === 3 ? 1 : 0) + (firstWin ? 5 : 0);
    if (ranked) r.trophies = Math.max(24, Math.min(36, 30 + Math.round((oppTrophies - trophies) / 25)));
  } else if (draw) {
    r.coins = Math.round(120 * k); r.xp = 15;
  } else {
    r.coins = Math.round((60 + 30 * crowns) * k);
    r.xp = 10 + 5 * crowns;
    if (ranked) r.trophies = -Math.min(trophies, Math.max(14, Math.min(26, 20 - Math.round((oppTrophies - trophies) / 25))));
  }
  r.paws = Math.min(30, kos);
  if (!ranked) { r.coins = Math.round(r.coins * 0.5); r.paws = Math.round(r.paws * 0.5); r.rubies = 0; }
  return r;
}

// Échanges des boutons « + » (les rubis s'appellent maintenant des gemmes)
export const EXCHANGE = {
  coins: [{ rubies: 10, get: 1000 }, { rubies: 40, get: 5000 }, { rubies: 100, get: 14000 }],
  paws: [{ rubies: 10, get: 30 }, { rubies: 40, get: 140 }, { rubies: 100, get: 400 }],
};

// Cadeau du jour : il grossit quand on revient plusieurs jours de suite (7 paliers)
export const DAILY = [
  { coins: 500, paws: 10, rubies: 5 }, { coins: 750, paws: 15, rubies: 8 }, { coins: 1000, paws: 20, rubies: 10 }, { coins: 1500, paws: 25, rubies: 12 },
  { coins: 2000, paws: 30, rubies: 15 }, { coins: 3000, paws: 40, rubies: 20 }, { coins: 5000, paws: 60, rubies: 40 },
];

// Quêtes du jour (3 tirées au hasard chaque jour) et quêtes de départ (une seule fois)
export const DAILY_QUESTS = [
  { id: 'win3', text: 'Gagne 3 combats', stat: 'wins', goal: 3, reward: { coins: 1000, rubies: 5, xp: 60 } },
  { id: 'fight5', text: 'Joue 5 combats', stat: 'fights', goal: 5, reward: { coins: 800, paws: 15, xp: 40 } },
  { id: 'ko25', text: 'Mets 25 animaux K.-O.', stat: 'kos', goal: 25, reward: { paws: 30, xp: 40 } },
  { id: 'crowns6', text: 'Gagne 6 couronnes', stat: 'crowns', goal: 6, reward: { rubies: 10, xp: 50 } },
  { id: 'streak2', text: 'Gagne 2 combats de suite', stat: 'streakMax', goal: 2, reward: { coins: 1000, rubies: 5, xp: 60 } },
  { id: 'up1', text: 'Améliore un animal', stat: 'upgrades', goal: 1, reward: { coins: 1000, xp: 30 } },
  { id: 'chest2', text: 'Ouvre 2 cages', stat: 'chests', goal: 2, reward: { coins: 600, rubies: 5, xp: 30 } },
  { id: 'aura60', text: 'Dépense 60 d\'Aura', stat: 'aura', goal: 60, reward: { coins: 800, paws: 10, xp: 40 } },
];
export const STARTER_QUESTS = [
  { id: 's_win', text: 'Remporte ta première victoire', stat: 'wins', goal: 1, reward: { coins: 1000, rubies: 10 } },
  { id: 's_chest', text: 'Ouvre ta première cage', stat: 'chests', goal: 1, reward: { coins: 500, rubies: 10 } },
  { id: 's_up', text: 'Améliore un animal au niveau 2', check: (S) => Object.values(S.cards || {}).some((c) => c.level >= 2), reward: { coins: 1000, paws: 20 } },
  { id: 's_3crowns', text: 'Gagne un combat avec 3 couronnes', stat: 'threeCrowns', goal: 1, reward: { coins: 2000, rubies: 15 } },
  { id: 's_six', text: 'Possède 6 animaux différents', check: (S) => Object.keys(S.cards || {}).length >= 6, reward: { rubies: 30 } },
  { id: 's_arena2', text: 'Atteins l\'Arène 2 (300 trophées)', check: (S) => S.best >= 300, reward: { coins: 3000, rubies: 20 } },
  { id: 's_clan', text: 'Rejoins ou crée un clan', check: (S) => !!S.clan, reward: { coins: 1000, rubies: 10 } },
];
