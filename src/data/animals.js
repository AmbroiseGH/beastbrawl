// Les animaux du jeu : tous les chiffres d'équilibrage des combats sont ici.
// Unités : 1 case = TILE pixels de terrain (voir src/game/rt.js), secondes, points de vie.
//   rarity    : common | rare | epic | legendary | ultimate (voir src/data/cards.js)
//   cost      : prix en Aura pour le poser
//   count     : nombre d'animaux posés par la carte
//   hp, dmg   : points de vie et dégâts par coup au niveau 1
//   hitEvery  : temps entre deux coups (s)
//   range     : portée (cases, de bord à bord) ; sight : distance à laquelle il repère un ennemi (cases)
//   speed     : vitesse (cases par seconde) ; radius : rayon du corps (cases) ; mass : qui pousse qui
//   air       : true = il vole (seuls les animaux qui visent les airs et les tours peuvent le toucher)
//   targets   : 'all' (sol et air), 'ground' (sol seulement) ou 'buildings' (ne s'intéresse qu'aux structures)
//   attacks   : normal (chaque coup) et special (un coup sur « every »)
//       anim : animation de la planche (atk1 ou atk2) ; dur : durée (s) ; windup : moment où le coup part (s)
//       mult : multiplicateur de dégâts ; splash : rayon (cases) des dégâts de zone, splashMult : part des dégâts
//       proj : projectile (clé d'effet) ; projSpeed : vitesse (cases/s) ; stun : étourdissement (s) ; knock : recul (cases)
//       heal / healR : soin des alliés autour ; buff : bonus de dégâts et de vitesse des alliés ; armor : réduction de dégâts
//       cloud : nuage toxique { r, dps, dur }

export const ANIMALS = {
  kitten: {
    name: 'Chaton', rarity: 'common', cost: 2, count: 1, role: 'Soigneur à distance',
    hp: 300, dmg: 64, hitEvery: 1.1, range: 4.5, sight: 5.5, speed: 1.4, radius: 0.36, mass: 2, air: false, targets: 'all',
    attacks: {
      normal: { anim: 'atk1', name: 'Bisou volant', dur: 0.62, windup: 0.32, mult: 1, proj: 'hearts', projSpeed: 9 },
      special: { anim: 'atk2', name: 'Ronron', every: 3, dur: 0.85, windup: 0.45, mult: 1, proj: 'hearts', projSpeed: 9, heal: 95, healR: 2.6 },
    },
    desc: 'Mignon mais redoutable : il envoie des bisous ravageurs de loin, au sol comme dans les airs.',
    talent: 'Ronron : un coup sur trois soigne tous les alliés autour de lui.',
  },
  monkey: {
    name: 'Singe', rarity: 'common', cost: 3, count: 2, role: 'Duo rapide',
    hp: 410, dmg: 72, hitEvery: 0.8, range: 0.5, sight: 5.5, speed: 1.5, radius: 0.34, mass: 3, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de queue', dur: 0.5, windup: 0.24, mult: 1 },
      special: { anim: 'atk2', name: 'Coup du poirier', every: 4, dur: 0.7, windup: 0.4, mult: 2.2, knock: 0.6 },
    },
    desc: 'Deux singes teigneux qui frappent très vite.',
    talent: 'Coup du poirier : leur 4ᵉ coup fait plus de deux fois plus mal et repousse la cible.',
  },
  bulldog: {
    name: 'Bulldog', rarity: 'common', cost: 4, count: 1, role: 'Tank',
    hp: 1500, dmg: 105, hitEvery: 1.4, range: 0.5, sight: 5.5, speed: 1.0, radius: 0.48, mass: 8, air: false, targets: 'ground', taunt: 3,
    attacks: {
      normal: { anim: 'atk1', name: 'Morsure', dur: 0.62, windup: 0.32, mult: 1 },
      special: { anim: 'atk2', name: 'Roulade', every: 3, dur: 0.85, windup: 0.45, mult: 1, splash: 1.3, splashMult: 0.8, stun: 0.7, knock: 0.5 },
    },
    desc: 'Un mur de muscles. Il encaisse en première ligne pendant que les autres frappent.',
    talent: 'Protecteur : les ennemis proches le visent en priorité. Son 3ᵉ coup est une roulade qui étourdit tout autour.',
  },
  pig: {
    name: 'Cochon', rarity: 'rare', cost: 4, count: 1, role: 'Fonceur de tours',
    hp: 1100, dmg: 165, hitEvery: 1.5, range: 0.5, sight: 9, speed: 2.0, radius: 0.46, mass: 6, air: false, targets: 'buildings',
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de groin', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Pet toxique', every: 3, dur: 0.85, windup: 0.42, mult: 1, cloud: { r: 1.9, dps: 40, dur: 4 } },
    },
    desc: 'Il fonce droit sur les structures ennemies et ignore tout le reste.',
    talent: 'Pet toxique : un coup sur trois laisse un nuage qui empoisonne tout ce qui passe dedans.',
  },
  orang: {
    name: 'Orang-outan', rarity: 'rare', cost: 5, count: 1, role: 'Lanceur de rochers',
    hp: 1000, dmg: 150, hitEvery: 1.8, range: 5, sight: 6, speed: 1.0, radius: 0.5, mass: 7, air: false, targets: 'all',
    attacks: {
      normal: { anim: 'atk2', name: 'Rocher', dur: 0.9, windup: 0.5, mult: 1, proj: 'rocks2', projSpeed: 7, splash: 0.9, splashMult: 0.6, arc: true },
      melee: { anim: 'atk1', name: 'Coup de tête', dur: 0.75, windup: 0.38, mult: 1.2, knock: 0.4 },
    },
    desc: 'Il lance de gros rochers qui écrasent plusieurs ennemis. De près, il donne de grands coups de tête.',
    talent: 'Ses rochers touchent aussi les animaux qui volent, et blessent tous ceux qui sont autour de la cible.',
  },
  alligator: {
    name: 'Alligator', rarity: 'epic', cost: 5, count: 1, role: 'Broyeur',
    hp: 1700, dmg: 215, hitEvery: 1.5, range: 0.8, sight: 5.5, speed: 1.0, radius: 0.55, mass: 9, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Mâchoire', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Queue tournoyante', every: 3, dur: 0.9, windup: 0.5, mult: 1, splash: 1.7, splashMult: 0.9, knock: 0.8 },
    },
    desc: 'Une mâchoire qui broie tout. Rien ne lui résiste au corps à corps.',
    talent: 'Queue tournoyante : son 3ᵉ coup balaie tous les ennemis autour de lui et les repousse.',
  },
  eagle: {
    name: 'Aigle', rarity: 'epic', cost: 4, count: 1, role: 'Volant',
    hp: 720, dmg: 118, hitEvery: 1.0, range: 1.6, sight: 6, speed: 1.6, radius: 0.5, mass: 4, air: true, targets: 'all',
    attacks: {
      normal: { anim: 'atk1', name: 'Serres', dur: 0.56, windup: 0.28, mult: 1 },
      special: { anim: 'atk2', name: 'Bourrasque', every: 4, dur: 0.85, windup: 0.45, mult: 1.2, splash: 1.8, splashMult: 0.6, knock: 1.4, stun: 0.5, gust: true },
    },
    desc: 'Il survole la rivière et les animaux au sol. Seuls ceux qui visent les airs peuvent l\'atteindre.',
    talent: 'Bourrasque : un coup sur quatre souffle les ennemis autour de sa cible.',
  },
  gorilla: {
    name: 'Gorille', rarity: 'legendary', cost: 7, count: 1, role: 'Colosse',
    hp: 3200, dmg: 255, hitEvery: 1.6, range: 0.8, sight: 5.5, speed: 0.9, radius: 0.66, mass: 14, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de poing', dur: 0.75, windup: 0.4, mult: 1, splash: 1.1, splashMult: 0.5 },
      special: { anim: 'atk2', name: 'Cri de guerre', every: 4, dur: 1.0, windup: 0.5, mult: 1, splash: 2, splashMult: 1, buff: { r: 3.2, dmg: 0.35, speed: 0.35, dur: 5 } },
    },
    desc: 'Le roi de la jungle. Chacun de ses coups fait trembler le sol.',
    talent: 'Cri de guerre : son 4ᵉ coup frappe tout autour et rend ses alliés proches enragés (+35 % de dégâts et de vitesse).',
  },
  rhino: {
    name: 'Rhinocéros', rarity: 'legendary', cost: 6, count: 1, role: 'Charge',
    hp: 2600, dmg: 195, hitEvery: 1.4, range: 0.7, sight: 5.5, speed: 1.1, radius: 0.62, mass: 13, air: false, targets: 'ground', charge: { after: 2.5, speed: 2.1, mult: 2, knock: 1 },
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de corne', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Carapace', every: 4, dur: 1.0, windup: 0.4, mult: 1.3, armor: { cut: 0.5, dur: 4 } },
    },
    desc: 'Lancé à pleine vitesse, plus rien ne l\'arrête.',
    talent: 'Charge : après quelques pas, il accélère et son premier coup fait double dégâts. Carapace : son 4ᵉ coup le rend deux fois plus résistant pendant 4 s.',
  },
  elephant: {
    name: 'Éléphant', rarity: 'ultimate', cost: 9, count: 1, role: 'Démolisseur',
    hp: 5200, dmg: 330, hitEvery: 1.8, range: 0.9, sight: 9, speed: 0.75, radius: 0.8, mass: 20, air: false, targets: 'buildings',
    attacks: {
      normal: { anim: 'atk1', name: 'Piétinement', dur: 0.85, windup: 0.45, mult: 1, splash: 1.5, splashMult: 0.6, splashTroops: true },
      special: { anim: 'atk2', name: 'Trompe à eau', every: 3, dur: 1.05, windup: 0.55, mult: 1, splash: 2.3, splashMult: 1, splashTroops: true, knock: 2, stun: 0.8, water: true },
    },
    desc: 'Une montagne qui avance vers les structures ennemies. Tout ce qui s\'approche est piétiné.',
    talent: 'Trompe à eau : un coup sur trois balaie les animaux autour de lui, les repousse loin et les étourdit.',
  },
};

export const ANIMAL_IDS = Object.keys(ANIMALS);
// ordre d'affichage dans la collection (par rareté, puis par coût)
export const ORDER = ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla', 'rhino', 'elephant'];

export const MAX_LEVEL = 11;
export const LEVEL_GROWTH = 1.1;  // +10 % de PV et de dégâts par niveau

const grow = (level) => { let k = 1; for (let i = 1; i < Math.max(1, level); i++) k *= LEVEL_GROWTH; return k; };   // même résultat sur tous les navigateurs
// Statistiques d'un animal à un niveau donné
export function statsAt(id, level = 1) {
  const a = ANIMALS[id], k = grow(level);
  return { ...a, id, level, hp: Math.round(a.hp * k), dmg: Math.round(a.dmg * k), heal: a.attacks.special && a.attacks.special.heal ? Math.round(a.attacks.special.heal * k) : 0 };
}
// Tours : leur niveau suit le niveau moyen du deck
export const TOWERS = {
  side: { hp: 2800, dmg: 95, hitEvery: 0.8, range: 7.5, radius: 1.15, proj: 'arrow' },
  main: { hp: 4400, dmg: 105, hitEvery: 1.0, range: 7, radius: 1.75, proj: 'cannon' },
};
export function towerAt(kind, level = 1) { const t = TOWERS[kind], k = grow(level); return { ...t, hp: Math.round(t.hp * k), dmg: Math.round(t.dmg * k) }; }
