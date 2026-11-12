// Générateur pseudo-aléatoire à graine (mulberry32) : la même graine redonne exactement le même combat,
// ce qui permet à deux joueurs en ligne de voir le même duel sans serveur de jeu.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.range = (lo, hi) => lo + next() * (hi - lo);
  return next;
}

// Graine aléatoire (non déterministe) pour lancer un nouveau combat.
export const newSeed = () => (Math.random() * 4294967296) >>> 0;

// Transforme un texte en graine (pour les duels en ligne : les deux joueurs partent du même identifiant).
export function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
