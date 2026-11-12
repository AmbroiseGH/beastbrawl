// Adversaires contrôlés par le jeu : noms, clans et équipes selon le niveau du joueur.
import { COLS, ROWS } from './arena.js';
import { TEAM_SLOTS, MAX_LEVEL } from './animals.js';

export const BOT_NAMES = ['Zarko', 'MimiLaFurie', 'TontonGriffe', 'Rugissime', 'PattesDeFer', 'Kali_97', 'LeoLeFou', 'CrocMignon', 'Baloo2000', 'NinaRoar',
  'Griffouille', 'SirWoof', 'BananaKing', 'Loupiote', 'MaxLaMenace', 'Tigrou_bzh', 'PetitGrizzly', 'Rex_77', 'LunaSauvage', 'Kiwi', 'Momo_Z', 'DocMolaire',
  'Toutou38', 'Sashimi', 'ElGato', 'Biscotte', 'Yuna', 'Capuche', 'Grognon', 'Pixelle', 'Noisette', 'Bagheera_', 'Tornade', 'Mistigri', 'Zoulou', 'Papaye'];
export const BOT_CLANS = ['Beast Club', 'Primal Force', 'Jungle Elite', 'Savage Team', 'Wild Beasts', 'Les Crocs Dorés', 'Meute du Nord', 'Team Tonnerre'];
export const AVATARS = ['tiger', 'gorilla', 'eagle', 'bulldog', 'monkey', 'croc', 'orang', 'tiger2'];

// Quelques formations types. b = bulldog, m = singe ; « col,ligne » avec la ligne 0 devant.
const SHAPES = [
  'b:1,0 b:3,0 m:0,1 m:2,1 m:4,1', 'b:2,0 m:0,1 m:1,1 m:3,1 m:4,1', 'b:1,0 b:2,0 b:3,0 m:1,2 m:3,2', 'b:2,0 b:2,1 m:0,0 m:4,0 m:2,2',
  'b:0,0 b:1,0 b:0,1 m:1,1 m:0,2', 'b:3,0 b:4,0 m:4,1 m:3,1 m:2,0', 'b:0,0 b:4,0 m:1,1 m:2,0 m:3,1', 'b:2,0 m:1,0 m:3,0 m:0,1 m:4,1',
  'b:1,1 b:3,1 m:0,0 m:2,0 m:4,0', 'b:0,0 b:2,0 b:4,0 m:1,1 m:3,1',
];
const MONKEY_SHAPES = ['m:0,0 m:1,0 m:2,0 m:3,0 m:4,0', 'm:1,0 m:2,0 m:3,0 m:1,1 m:3,1', 'm:0,0 m:4,0 m:2,0 m:1,1 m:3,1', 'm:0,1 m:1,0 m:2,1 m:3,0 m:4,1', 'm:2,0 m:1,1 m:2,1 m:3,1 m:2,2'];
const parse = (str) => str.split(' ').map((p) => { const [k, c, r] = p.split(/[:,]/); return { id: k === 'b' ? 'bulldog' : 'monkey', col: +c, row: +r }; });

// Fabrique un adversaire. rng : générateur (Math.random ou à graine). ease : de -1 (facile) à +1 (difficile).
export function makeBot(rng, { trophies, playerLevels, hasBulldog, ease = 0 }) {
  const name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
  const bulldogs = hasBulldog || trophies >= 120;
  const shape = parse((bulldogs ? SHAPES : MONKEY_SHAPES)[Math.floor(rng() * (bulldogs ? SHAPES.length : MONKEY_SHAPES.length))]);
  // niveau moyen proche de celui du joueur, un peu au-dessus quand il enchaîne les victoires
  const avg = (playerLevels.monkey + (playerLevels.bulldog || playerLevels.monkey)) / 2;
  const base = Math.max(1, Math.round(avg + ease * 0.9 + (rng() - 0.55)));
  let units = shape.map((u) => ({ ...u, level: Math.max(1, Math.min(MAX_LEVEL, base + (rng() < 0.25 ? -1 : 0))) }));
  if (ease < -0.5 && units.length > 4 && rng() < 0.6) units = units.slice(0, 4);     // adversaire affaibli après plusieurs défaites
  if (rng() < 0.5) units = units.map((u) => ({ ...u, col: COLS - 1 - u.col }));       // miroir gauche-droite
  const t = Math.max(0, Math.round(trophies + (rng() - 0.5) * 80 + ease * 30));
  return { name, clanName: rng() < 0.7 ? BOT_CLANS[Math.floor(rng() * BOT_CLANS.length)] : '', avatar: AVATARS[Math.floor(rng() * AVATARS.length)], trophies: t, units, bot: true };
}

// Formation valide ? (dans la grille, pas deux animaux sur la même case, pas plus de slots que permis)
export function validTeam(units, slotsOf) {
  const seen = new Set(); let slots = 0;
  for (const u of units) {
    if (!(u.col >= 0 && u.col < COLS && u.row >= 0 && u.row < ROWS)) return false;
    const k = u.col + ',' + u.row; if (seen.has(k)) return false; seen.add(k);
    slots += slotsOf(u.id);
  }
  return slots > 0 && slots <= TEAM_SLOTS;
}

// Faux classement du serveur quand le jeu est hors ligne : des bots autour d'un sommet fixe
export function botLeaderboard() {
  const out = []; let seed = 12345;
  const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 30; i++) out.push({ name: BOT_NAMES[i % BOT_NAMES.length], clanName: BOT_CLANS[Math.floor(r() * BOT_CLANS.length)], avatar: AVATARS[Math.floor(r() * AVATARS.length)], trophies: Math.round(2950 - i * 78 - r() * 40), bot: true });
  return out;
}
