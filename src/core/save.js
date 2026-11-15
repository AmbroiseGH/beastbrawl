// La sauvegarde du joueur (dans le navigateur). Toute la progression est ici.
import { uid } from './utils.js';

const KEY = 'beastbrawl.v1';     // même clé qu'avant la mise à jour : l'ancienne progression est reprise (voir migrate)
const fresh = () => ({
  v: 2, uid: uid(12), name: '', avatar: 'tiger',
  level: 1, xp: 0, coins: 1000, paws: 0, rubies: 100, trophies: 0, best: 0,
  cards: { monkey: { level: 1, count: 0 } },     // animaux débloqués : niveau et cartes en réserve
  deck: ['monkey'],                              // les cartes emmenées au combat (8 au plus)
  chests: [null, null, null, null],              // les 4 emplacements de cages : { tier, start, end } ; start = 0 tant qu'elle n'est pas lancée
  chestCycle: 0, welcome: false, seen: {},       // seen : animaux déjà vus (pour « Nouveau ! »)
  shop: { day: '', bought: {} },
  wins: 0, losses: 0, draws: 0, streak: 0, lossRun: 0, bestStreak: 0, kos: 0, crowns: 0, fights: 0, upgrades: 0, opened: 0,
  quests: { day: '', list: [], done: {} }, starter: {}, daily: { last: '', streak: 0 }, firstWinDay: '',
  settings: { music: true, sfx: true, volume: 0.7 },
  clan: null, friends: [], seenIntro: false, mail: [],
});

export let S = fresh();

// Sauvegarde de la V1 (équipe sur une grille, améliorations aux pattes) : les animaux deviennent des cartes au même niveau
function migrate(d) {
  if (d.v >= 2) return d;
  const out = Object.assign(fresh(), d, { v: 2 });
  out.cards = {};
  for (const id of Object.keys(d.animals || {})) if (id === 'monkey' || id === 'bulldog') out.cards[id] = { level: Math.max(1, Math.min(11, d.animals[id].level | 0)), count: 0 };
  if (!out.cards.monkey) out.cards.monkey = { level: 1, count: 0 };
  out.deck = Object.keys(out.cards);
  out.crowns = d.stars || 0;
  out.rubies = (d.rubies || 0) + 50;            // petit cadeau de bienvenue dans la mise à jour
  out.welcome = false;                          // tout le monde reçoit la cage de bienvenue
  delete out.animals; delete out.formation; delete out.stars;
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = migrate(JSON.parse(raw)); S = Object.assign(fresh(), d); S.settings = Object.assign(fresh().settings, d.settings || {}); }
    else localStorage.setItem(KEY, JSON.stringify(S));      // première visite : on garde tout de suite l'identifiant du joueur
  } catch (e) { console.warn('sauvegarde illisible, nouvelle partie', e); S = fresh(); }
  if (!Array.isArray(S.chests) || S.chests.length !== 4) S.chests = [null, null, null, null];
  return S;
}
let timer = 0;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* stockage plein ou navigation privée */ } }, 60);
}
export function reset() { S = fresh(); try { localStorage.removeItem(KEY); } catch (e) { /* rien */ } return S; }

// abonnements : l'interface se redessine quand la sauvegarde change
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function changed() { save(); for (const fn of subs) fn(S); }
