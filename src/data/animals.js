// Les animaux du jeu : tous les chiffres d'équilibrage sont ici.
// Unités : cases de la grille (1 case = 1 carré de placement), secondes, points de vie.
//   slots     : place prise dans l'équipe (5 slots au total)
//   price     : prix dans la boutique (pièces)
//   hp, dmg   : points de vie et dégâts par coup au niveau 1
//   atkEvery  : temps entre deux débuts d'attaque (s)
//   range     : portée, mesurée de bord à bord (cases)
//   speed     : vitesse de marche (cases par seconde)
//   radius    : rayon du corps (cases)
//   crit      : chance de coup critique (dégâts × CRIT_MULT)
//   dodge     : chance d'esquiver un coup normal
//   knock     : recul infligé à la cible (cases)
//   taunt     : true = « Protecteur », les ennemis proches le visent en priorité
//   attacks   : normal (à chaque coup) et special (un coup sur « every »)
//       anim    : animation de la planche (atk1 ou atk2)
//       dur     : durée de l'animation (s) ; windup : moment où le coup porte (s)
//       mult    : multiplicateur de dégâts sur la cible
//       splash  : part des dégâts infligée aux autres ennemis à moins de splashR cases de l'attaquant
//       aoe     : rayon (cases) autour de la cible, les ennemis touchés prennent aoeMult × les dégâts
//       stun    : étourdissement de la cible (s)

export const ANIMALS = {
  monkey: {
    name: 'Singe', role: 'Attaquant', slots: 1, price: 10000, starter: true,
    hp: 800, dmg: 66, atkEvery: 0.62, range: 0.2, speed: 1.9, radius: 0.3, crit: 0.18, dodge: 0.1, knock: 0.05, taunt: false,
    attacks: {
      normal: { anim: 'atk1', name: 'Coup de queue', dur: 0.44, windup: 0.2, mult: 1, splash: 0.35, splashR: 0.95 },
      special: { anim: 'atk2', name: 'Coup du poirier', every: 4, dur: 0.6, windup: 0.36, mult: 2.4, knock: 0.3 },
    },
    desc: 'Rapide et teigneux. Sa queue fouette tous les ennemis autour de lui.',
    talent: 'Agile : attaque très vite, esquive parfois, et son 4ᵉ coup est un coup du poirier dévastateur.',
  },
  bulldog: {
    name: 'Bulldog', role: 'Tank', slots: 1, price: 15000, starter: false,
    hp: 1500, dmg: 58, atkEvery: 1.1, range: 0.2, speed: 1.3, radius: 0.36, crit: 0.08, dodge: 0, knock: 0.08, taunt: true,
    attacks: {
      normal: { anim: 'atk1', name: 'Morsure', dur: 0.55, windup: 0.3, mult: 1 },
      special: { anim: 'atk2', name: 'Roulade', every: 3, dur: 0.8, windup: 0.42, mult: 1.6, aoe: 1.0, aoeMult: 0.7, knock: 0.5, stun: 0.7 },
    },
    desc: 'Un mur de muscles. Il encaisse en première ligne et mord fort.',
    talent: 'Protecteur : les ennemis proches le visent en priorité. Son 3ᵉ coup est une roulade qui étourdit.',
  },
};

export const ANIMAL_IDS = Object.keys(ANIMALS);

// Les animaux annoncés dans la boutique mais pas encore jouables (ordre de la maquette)
export const COMING_SOON = ['chaton', 'alligator', 'orangutan', 'cochon', 'gorille', 'rhinoceros', 'aigle', 'elephant'];

export const TEAM_SLOTS = 5;      // slots d'équipe
export const MAX_LEVEL = 15;
export const LEVEL_GROWTH = 1.1;  // +10 % de PV et de dégâts par niveau
export const CRIT_MULT = 1.8;

// Statistiques d'un animal à un niveau donné
export function statsAt(id, level = 1) {
  const a = ANIMALS[id];
  let k = 1; // multiplication répétée : résultat identique sur tous les navigateurs (duels en ligne)
  for (let i = 1; i < Math.max(1, level); i++) k *= LEVEL_GROWTH;
  return { ...a, id, level, hp: Math.round(a.hp * k), dmg: Math.round(a.dmg * k) };
}

// Puissance affichée (un seul chiffre pour comparer deux équipes)
export function powerOf(id, level = 1) {
  const s = statsAt(id, level);
  return Math.round((s.hp * 0.35 + (s.dmg / s.atkEvery) * 4.2) / 10) * 10;
}
