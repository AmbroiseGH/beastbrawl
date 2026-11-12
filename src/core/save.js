// La sauvegarde du joueur (dans le navigateur). Toute la progression est ici.
import { uid } from './utils.js';

const KEY = 'beastbrawl.v1';
const fresh = () => ({
  v: 1, uid: uid(12), name: '', avatar: 'tiger',
  level: 1, xp: 0, coins: 2000, paws: 0, rubies: 20, trophies: 0, best: 0,
  animals: { monkey: { level: 1 } },
  formation: [{ id: 'monkey', col: 0, row: 0 }, { id: 'monkey', col: 1, row: 0 }, { id: 'monkey', col: 2, row: 0 }, { id: 'monkey', col: 3, row: 0 }, { id: 'monkey', col: 4, row: 0 }],
  wins: 0, losses: 0, streak: 0, lossRun: 0, bestStreak: 0, kos: 0, stars: 0, fights: 0, upgrades: 0,
  quests: { day: '', list: [], done: {} }, starter: {}, daily: { last: '', streak: 0 }, firstWinDay: '',
  settings: { music: true, sfx: true, volume: 0.7, speed: 1 },
  clan: null, friends: [], seenIntro: false, mail: [],
});

export let S = fresh();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); S = Object.assign(fresh(), d); S.settings = Object.assign(fresh().settings, d.settings || {}); }
  } catch (e) { console.warn('sauvegarde illisible, nouvelle partie', e); S = fresh(); }
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
