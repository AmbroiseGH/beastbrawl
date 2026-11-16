// Les animaux du jeu : tous les chiffres d'équilibrage des combats sont ici.
// Unités : 1 case = TILE pixels de la carte (voir src/game/rt.js), secondes, points de vie.
//   rarity    : common | rare | epic | legendary | ultimate (voir src/data/cards.js)
//   cost      : prix en Aura pour le poser
//   count     : nombre d'animaux posés par la carte
//   hp, dmg   : points de vie et dégâts par coup au niveau 1
//   hitEvery  : temps entre deux coups (s)
//   range     : portée (cases, de bord à bord) ; sight : distance à laquelle il repère un ennemi (cases)
//   speed     : vitesse (cases par seconde) ; radius : rayon du corps (cases) ; mass : qui pousse qui
//   air       : true = il vole (il passe au-dessus de l'eau ; seuls ceux qui visent les airs peuvent le toucher)
//   targets   : 'all' (sol et air) ou 'ground' (sol seulement)
//   attacks   : normal (chaque coup), special (un coup sur « every », ou une compétence à part), melee (de tout près)
//       anim : animation de la planche (atk1 ou atk2) ; dur : durée (s) ; windup : moment où le coup part (s)
//       mult : multiplicateur de dégâts ; splash : rayon (cases) des dégâts de zone, splashMult : part des dégâts
//       proj : projectile (clé d'effet) ; projSpeed : vitesse (cases/s) ; stun : étourdissement (s) ; knock : recul (cases)
//       heal : soin d'un allié (chaton) ; shield : bouclier posé sur les alliés autour { r, amount, dur }
//       guard : l'orang-outan se protège la tête { dur, cd, taunt } ; cloud : nuage de poison { r, dps, dur, linger }
//       rage : le gorille gagne des dégâts à chaque cri { add, max } ; plate : le rhinocéros gagne de la résistance { add, max }
//       spray : jet d'eau de l'éléphant { range, charges, near } ; slow : ralentissement { k, dur }

export const ANIMALS = {
  kitten: {
    name: 'Chaton', rarity: 'common', cost: 2, count: 1, role: 'Soigneur',
    hp: 320, dmg: 46, hitEvery: 1.15, range: 4.5, sight: 6.5, speed: 1.35, radius: 0.4, mass: 2, air: false, targets: 'all', healer: true,
    attacks: {
      normal: { anim: 'atk1', name: 'Bisou volant', dur: 0.62, windup: 0.32, mult: 1, proj: 'hearts', projSpeed: 9, heal: 105 },
      special: { anim: 'atk2', name: 'Bouclier câlin', every: 3, dur: 0.85, windup: 0.45, mult: 1, proj: 'hearts', projSpeed: 9, heal: 105, shield: { r: 2.8, amount: 170, dur: 6 } },
    },
    desc: 'Le soigneur de la bande : ses bisous rendent des points de vie à l\'allié le plus blessé. Sans blessé à soigner, il les envoie sur l\'ennemi.',
    talent: 'Bouclier câlin : un bisou sur trois pose un bouclier vert sur tous les alliés autour de lui.',
  },
  monkey: {
    name: 'Singe', rarity: 'common', cost: 3, count: 2, role: 'Duo rapide',
    hp: 410, dmg: 66, hitEvery: 0.8, range: 0.5, sight: 5.5, speed: 1.5, radius: 0.38, mass: 3, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de queue', dur: 0.5, windup: 0.24, mult: 1 },
      special: { anim: 'atk2', name: 'Coup du poirier', every: 4, dur: 0.7, windup: 0.4, mult: 2.2, knock: 0.6 },
    },
    desc: 'Deux singes teigneux qui frappent très vite. Parfaits pour casser une boîte ou vider la jauge adverse.',
    talent: 'Coup du poirier : leur 4ᵉ coup fait plus de deux fois plus mal et repousse la cible.',
  },
  bulldog: {
    name: 'Bulldog', rarity: 'common', cost: 4, count: 1, role: 'Garde du corps',
    hp: 1500, dmg: 105, hitEvery: 1.4, range: 0.5, sight: 5.5, speed: 1.0, radius: 0.54, mass: 8, air: false, targets: 'ground', taunt: 3,
    attacks: {
      normal: { anim: 'atk1', name: 'Morsure', dur: 0.62, windup: 0.32, mult: 1 },
      special: { anim: 'atk2', name: 'Roulade', every: 3, dur: 0.85, windup: 0.45, mult: 1, splash: 1.3, splashMult: 0.8, stun: 0.7, knock: 0.5, around: true },
    },
    desc: 'Un mur de muscles. Il encaisse en première ligne pendant que les autres frappent.',
    talent: 'Protecteur : les ennemis proches le visent en priorité. Son 3ᵉ coup est une roulade qui étourdit tout autour.',
  },
  pig: {
    name: 'Cochon', rarity: 'rare', cost: 4, count: 1, role: 'Empoisonneur',
    hp: 1100, dmg: 120, hitEvery: 1.4, range: 0.6, sight: 5.5, speed: 1.6, radius: 0.52, mass: 6, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Ruade de boue', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Rot toxique', every: 3, dur: 0.85, windup: 0.42, mult: 0.6, cloud: { r: 2.0, dps: 58, dur: 5, linger: 3 } },
    },
    desc: 'Rapide et mal élevé. Il rote un nuage vert qui empoisonne tous les ennemis qui le traversent.',
    talent: 'Rot toxique : un coup sur trois lâche un nuage. Le poison continue de ronger ses victimes 3 s après leur sortie du nuage.',
  },
  orang: {
    name: 'Orang-outan', rarity: 'rare', cost: 5, count: 1, role: 'Tank lanceur',
    hp: 1750, dmg: 118, hitEvery: 1.7, range: 5, sight: 6, speed: 1.0, radius: 0.56, mass: 9, air: false, targets: 'all',
    attacks: {
      normal: { anim: 'atk2', name: 'Caillou', dur: 0.9, windup: 0.5, mult: 1, proj: 'rocks2', projSpeed: 7.5, splash: 0.8, splashMult: 0.5, arc: true, knock: 0.25 },
      special: { anim: 'atk1', name: 'Tête à l\'abri', dur: 2.4, windup: 9, mult: 0, guard: { dur: 2.4, cd: 8, taunt: 4 } },
    },
    desc: 'Un tank qui tape de loin : ses cailloux repoussent très légèrement ceux qu\'ils touchent, au sol comme dans les airs.',
    talent: 'Tête à l\'abri : quand on le frappe, il se protège la tête et devient invulnérable 2,4 s. Les ennemis proches s\'acharnent sur lui pour rien.',
  },
  alligator: {
    name: 'Alligator', rarity: 'epic', cost: 5, count: 1, role: 'Canon de verre',
    hp: 640, dmg: 390, hitEvery: 1.3, range: 0.8, sight: 5.5, speed: 1.2, radius: 0.62, mass: 7, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Mâchoire', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Queue tournoyante', every: 3, dur: 0.9, windup: 0.5, mult: 0.8, splash: 1.7, splashMult: 1, knock: 0.6, around: true },
    },
    desc: 'Des dégâts énormes, mais très peu de points de vie. Protège-le et il broie tout : animaux, boîtes, tours et cible.',
    talent: 'Queue tournoyante : son 3ᵉ coup balaie tous les ennemis autour de lui et les repousse.',
  },
  eagle: {
    name: 'Aigle', rarity: 'epic', cost: 4, count: 1, role: 'Volant souffleur',
    hp: 720, dmg: 100, hitEvery: 1.35, range: 4, sight: 6.5, speed: 1.6, radius: 0.56, mass: 4, air: true, targets: 'all',
    attacks: {
      normal: { anim: 'atk2', name: 'Bourrasque', dur: 0.8, windup: 0.42, mult: 1, proj: 'gust', projSpeed: 10, splash: 1.1, splashMult: 0.5, knock: 0.85, gust: true },
      melee: { anim: 'atk1', name: 'Serres', dur: 0.56, windup: 0.28, mult: 1.3 },
    },
    desc: 'Il survole les rivières sans passer par les ponts. Ses bourrasques repoussent les ennemis, bien plus fort que les cailloux de l\'orang-outan.',
    talent: 'Bourrasque : chaque rafale repousse la cible et ceux qui l\'entourent. Idéal pour écarter les ennemis de la cible ou d\'une tour.',
  },
  gorilla: {
    name: 'Gorille', rarity: 'legendary', cost: 7, count: 1, role: 'Colosse',
    hp: 3200, dmg: 225, hitEvery: 1.6, range: 0.8, sight: 5.5, speed: 0.9, radius: 0.74, mass: 14, air: false, targets: 'ground',
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de poing', dur: 0.75, windup: 0.4, mult: 1, splash: 1.1, splashMult: 0.5 },
      special: { anim: 'atk2', name: 'Hurlement', every: 4, dur: 1.0, windup: 0.5, mult: 0.5, splash: 2, splashMult: 1, around: true, rage: { add: 0.14, max: 7 } },
    },
    desc: 'Le roi de la jungle. Chacun de ses coups fait trembler le sol, et plus le combat dure, plus il cogne fort.',
    talent: 'Hurlement : son 4ᵉ coup est un cri aux éclats rouges. Chaque cri augmente ses dégâts de 14 % pour le reste du combat (jusqu\'à 7 fois).',
  },
  rhino: {
    name: 'Rhinocéros', rarity: 'legendary', cost: 6, count: 1, role: 'Blindé',
    hp: 2600, dmg: 190, hitEvery: 1.4, range: 0.7, sight: 5.5, speed: 1.1, radius: 0.7, mass: 13, air: false, targets: 'ground', charge: { after: 2.5, speed: 2.1, mult: 2, knock: 1 },
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de corne', dur: 0.7, windup: 0.36, mult: 1 },
      special: { anim: 'atk2', name: 'Carapace de métal', every: 4, dur: 1.0, windup: 0.4, mult: 1.2, plate: { add: 0.09, max: 6, dur: 3 } },
    },
    desc: 'Lancé à pleine vitesse, plus rien ne l\'arrête. Et plus il se bat, plus il devient dur à abattre.',
    talent: 'Carapace de métal : à son 4ᵉ coup, sa carapace devient métallique. Chaque fois, il subit 9 % de dégâts en moins pour le reste du combat (jusqu\'à 6 fois). Charge : après quelques pas, son premier coup fait double dégâts.',
  },
  elephant: {
    name: 'Éléphant', rarity: 'ultimate', cost: 9, count: 1, role: 'Arroseur géant',
    hp: 5000, dmg: 300, hitEvery: 1.8, range: 0.9, sight: 6.5, speed: 0.75, radius: 0.9, mass: 20, air: false, targets: 'all',
    attacks: {
      normal: { anim: 'atk2', name: 'Coup de trompe', dur: 0.85, windup: 0.45, mult: 1, splash: 1.5, splashMult: 0.6 },
      special: { anim: 'atk1', name: 'Trompe à eau', dur: 1.05, windup: 0.6, mult: 0.55, splash: 1.9, splashMult: 1, slow: { k: 0.5, dur: 3.5 }, spray: { range: 4.4, charges: 3, near: 2.6, every: 0.8 }, water: true },
    },
    desc: 'Une montagne. Il puise de l\'eau dans les rivières de l\'arène, puis asperge les ennemis de loin, ce qui les ralentit.',
    talent: 'Trompe à eau : près d\'une rivière, il remplit sa trompe (3 jets). Chaque jet mouille un groupe d\'ennemis et les ralentit de moitié pendant 3,5 s.',
  },
};

export const ANIMAL_IDS = Object.keys(ANIMALS);
// ordre d'affichage dans la collection (par rareté, puis par coût)
export const ORDER = ['kitten', 'monkey', 'bulldog', 'pig', 'orang', 'alligator', 'eagle', 'gorilla', 'rhino', 'elephant'];

export const MAX_LEVEL = 11;
export const LEVEL_GROWTH = 1.1;  // +10 % de PV et de dégâts par niveau

const grow = (level) => { let k = 1; for (let i = 1; i < Math.max(1, level); i++) k *= LEVEL_GROWTH; return k; };   // même résultat sur tous les navigateurs
// Statistiques d'un animal à un niveau donné (k : multiplicateur du niveau, pour les soins, boucliers et poisons)
export const levelK = grow;
export function statsAt(id, level = 1) {
  const a = ANIMALS[id], k = grow(level);
  const heal = a.attacks.normal.heal || 0;
  return { ...a, id, level, k, hp: Math.round(a.hp * k), dmg: Math.round(a.dmg * k), heal: heal ? Math.round(heal * k) : 0 };
}
// Structures de la carte. Leurs points de vie suivent le niveau moyen des deux decks.
export const STRUCTS = {
  crate: { hp: 420, respawn: 50 },                                   // boîte à bonus
  tower: { hp: 1500, retake: 1.25, dmg: 105, hitEvery: 2.3, range: 21, splash: 1.0, splashMult: 0.5, knock: 0.2 },   // tour latérale et son orang-outan
  gauge: { hp: 30000 },                                              // dégâts à infliger à la cible pour remplir une jauge à 100 %
};
