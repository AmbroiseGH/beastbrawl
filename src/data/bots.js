// Adversaires contrôlés par le jeu : noms, clans, decks et niveau de jeu selon les trophées du joueur.
import { ANIMALS, MAX_LEVEL } from './animals.js';
import { DECK_SIZE } from './cards.js';

export const BOT_NAMES = ['Zarko', 'MimiLaFurie', 'TontonGriffe', 'Rugissime', 'PattesDeFer', 'Kali_97', 'LeoLeFou', 'CrocMignon', 'Baloo2000', 'NinaRoar',
  'Griffouille', 'SirWoof', 'BananaKing', 'Loupiote', 'MaxLaMenace', 'Tigrou_bzh', 'PetitGrizzly', 'Rex_77', 'LunaSauvage', 'Kiwi', 'Momo_Z', 'DocMolaire',
  'Toutou38', 'Sashimi', 'ElGato', 'Biscotte', 'Yuna', 'Capuche', 'Grognon', 'Pixelle', 'Noisette', 'Bagheera_', 'Tornade', 'Mistigri', 'Zoulou', 'Papaye'];
export const BOT_CLANS = ['Beast Club', 'Primal Force', 'Jungle Elite', 'Savage Team', 'Wild Beasts', 'Les Crocs Dorés', 'Meute du Nord', 'Team Tonnerre'];
export const AVATARS = ['tiger', 'gorilla', 'eagle', 'bulldog', 'monkey', 'croc', 'orang', 'tiger2'];

// Animaux que les bots peuvent avoir selon l'arène (les plus rares arrivent plus haut)
const POOL = {
  1: ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'clownfish', 'kitten', 'monkey', 'bulldog'],
  2: ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'clownfish', 'octo'],
  3: ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla', 'rhino', 'clownfish', 'octo', 'dolphin'],
  4: ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla', 'rhino', 'elephant', 'clownfish', 'octo', 'dolphin'],
};

// Fabrique un adversaire. rng : générateur. level : niveau moyen du deck du joueur. ease : de -1 (facile) à +1 (difficile).
export function makeBot(rng, { trophies, level = 1, arena = 1, ease = 0, first = false }) {
  const name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
  const pool = (POOL[Math.min(4, arena)] || POOL[1]).slice();
  const deck = [];
  const size = first ? 4 : Math.min(DECK_SIZE, 6 + Math.min(2, arena));
  while (deck.length < size && pool.length) { const id = pool.splice(Math.floor(rng() * pool.length), 1)[0]; if (!deck.includes(id)) deck.push(id); }
  if (!deck.some((id) => ANIMALS[id].targets === 'all')) deck[deck.length - 1] = 'kitten';     // de quoi toucher les volants
  const base = Math.max(1, Math.min(MAX_LEVEL, Math.round(level + ease * 0.8 + (rng() - 0.6) * 0.8)));
  const cards = deck.filter((id, i) => deck.indexOf(id) === i).map((id) => ({ id, level: first ? 1 : Math.max(1, Math.min(MAX_LEVEL, base - (ANIMALS[id].rarity === 'legendary' || ANIMALS[id].rarity === 'ultimate' ? 1 : 0) + (rng() < 0.2 ? -1 : 0))) }));
  const skill = first ? 0.05 : Math.max(0.1, Math.min(0.95, 0.3 + 0.12 * (arena - 1) + ease * 0.25 + (rng() - 0.5) * 0.15));
  const t = Math.max(0, Math.round(trophies + (rng() - 0.5) * 80 + ease * 30));
  return { name, clanName: rng() < 0.7 ? BOT_CLANS[Math.floor(rng() * BOT_CLANS.length)] : '', avatar: AVATARS[Math.floor(rng() * AVATARS.length)], trophies: t, deck: cards, skill, bot: true };
}

// Deck valide ? (animaux connus, pas de doublon, entre 1 et 8 cartes)
export function validDeck(deck) {
  if (!Array.isArray(deck) || !deck.length || deck.length > DECK_SIZE) return false;
  const seen = new Set();
  for (const c of deck) { if (!c || !ANIMALS[c.id] || seen.has(c.id)) return false; seen.add(c.id); }
  return true;
}

// Faux classement du serveur quand le jeu est hors ligne : des bots autour d'un sommet fixe
export function botLeaderboard() {
  const out = []; let seed = 12345;
  const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 30; i++) out.push({ name: BOT_NAMES[i % BOT_NAMES.length], clanName: BOT_CLANS[Math.floor(r() * BOT_CLANS.length)], avatar: AVATARS[Math.floor(r() * AVATARS.length)], trophies: Math.round(1950 - i * 52 - r() * 30), bot: true });
  return out;
}
