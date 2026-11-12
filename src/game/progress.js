// Progression du joueur : gains, niveaux, quêtes, cadeau du jour, achats et améliorations.
import { S, changed } from '../core/save.js';
import { today } from '../core/utils.js';
import { ANIMALS, MAX_LEVEL } from '../data/animals.js';
import { xpNeed, levelReward, fightRewards, upgradeCost, arenaOf, starsFor, DAILY, DAILY_QUESTS, STARTER_QUESTS, SHOP } from '../data/economy.js';

// Ajoute des gains. Renvoie la liste des niveaux gagnés (pour fêter ça à l'écran).
export function grant(r, silent) {
  const ups = [];
  if (r.coins) S.coins = Math.max(0, S.coins + r.coins);
  if (r.paws) S.paws = Math.max(0, S.paws + r.paws);
  if (r.rubies) S.rubies = Math.max(0, S.rubies + r.rubies);
  if (r.trophies) { S.trophies = Math.max(0, S.trophies + r.trophies); S.best = Math.max(S.best, S.trophies); }
  if (r.xp) {
    S.xp += r.xp;
    while (S.xp >= xpNeed(S.level)) {
      S.xp -= xpNeed(S.level); S.level++;
      const lr = levelReward(S.level); S.coins += lr.coins; S.rubies += lr.rubies; ups.push({ level: S.level, ...lr });
    }
  }
  if (!silent) changed();
  return ups;
}

// ---------- quêtes ----------
function rollQuests() {
  const d = today();
  if (S.quests.day === d && S.quests.list.length) return;
  const pool = DAILY_QUESTS.map((q) => q.id);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  S.quests = { day: d, list: pool.slice(0, 3), prog: {}, done: {} };
  changed();
}
export function track(stat, n = 1, max = false) {
  rollQuests();
  const p = S.quests.prog || (S.quests.prog = {});
  p[stat] = max ? Math.max(p[stat] || 0, n) : (p[stat] || 0) + n;
  const sp = S.starter.prog || (S.starter.prog = {});
  sp[stat] = max ? Math.max(sp[stat] || 0, n) : (sp[stat] || 0) + n;
}
export function dailyQuests() {
  rollQuests();
  return S.quests.list.map((id) => {
    const q = DAILY_QUESTS.find((x) => x.id === id); if (!q) return null;
    const v = Math.min(q.goal, (S.quests.prog || {})[q.stat] || 0);
    return { ...q, value: v, ready: v >= q.goal && !S.quests.done[id], claimed: !!S.quests.done[id], kind: 'daily' };
  }).filter(Boolean);
}
export function starterQuests() {
  return STARTER_QUESTS.map((q) => {
    const v = q.check ? (q.check(S) ? 1 : 0) : Math.min(q.goal, ((S.starter.prog || {})[q.stat]) || 0);
    const goal = q.check ? 1 : q.goal, claimed = !!(S.starter.done || {})[q.id];
    return { ...q, goal, value: v, ready: v >= goal && !claimed, claimed, kind: 'starter' };
  });
}
export function claimQuest(q) {
  if (!q.ready) return null;
  if (q.kind === 'daily') S.quests.done[q.id] = 1; else (S.starter.done || (S.starter.done = {}))[q.id] = 1;
  const ups = grant(q.reward);
  return { reward: q.reward, ups };
}
export const questsReady = () => dailyQuests().filter((q) => q.ready).length + starterQuests().filter((q) => q.ready).length;

// ---------- cadeau du jour ----------
export const dailyReady = () => S.daily.last !== today();
export function dailyStep() {      // palier du prochain cadeau (0 à 6)
  if (!S.daily.last) return 0;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yest = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  if (S.daily.last === today()) return (S.daily.streak - 1 + DAILY.length) % DAILY.length;
  return S.daily.last === yest ? S.daily.streak % DAILY.length : 0;
}
export function claimDaily() {
  if (!dailyReady()) return null;
  const step = dailyStep(), r = DAILY[step];
  S.daily = { last: today(), streak: step + 1 };
  const ups = grant(r);
  return { reward: r, step, ups };
}

// ---------- animaux ----------
export const owned = (id) => !!S.animals[id];
export const levelOf = (id) => (S.animals[id] ? S.animals[id].level : 1);
export function buyAnimal(id) {
  const item = SHOP.find((x) => x.id === id);
  if (!item || !ANIMALS[id] || owned(id)) return 'non';
  if (S.coins < item.price) return 'pauvre';
  S.coins -= item.price; S.animals[id] = { level: 1 }; changed(); return 'ok';
}
export function canUpgrade(id) {
  if (!owned(id)) return false;
  const c = upgradeCost(levelOf(id)); return !!c && S.paws >= c.paws && S.coins >= c.coins;
}
export function upgradeAnimal(id) {
  if (!owned(id)) return 'non';
  const lv = levelOf(id), c = upgradeCost(lv);
  if (!c || lv >= MAX_LEVEL) return 'max';
  if (S.paws < c.paws) return 'pattes';
  if (S.coins < c.coins) return 'pieces';
  S.paws -= c.paws; S.coins -= c.coins; S.animals[id].level = lv + 1; S.upgrades++;
  track('upgrades', 1); grant({ xp: 20 }, true); changed(); return 'ok';
}
export const anyUpgrade = () => Object.keys(S.animals).some(canUpgrade);

// ---------- fin d'un combat ----------
// res : { win, survivors, total, kos } ; opp : { trophies } ; ranked : combat classé ou amical
export function applyFight(res, opp, ranked = true) {
  const stars = res.win ? starsFor(res.survivors, res.total) : 0;
  const firstWin = res.win && ranked && S.firstWinDay !== today();
  const before = { trophies: S.trophies, level: S.level, arena: arenaOf(S.trophies), coins: S.coins, paws: S.paws, rubies: S.rubies, xp: S.xp };
  if (ranked) S.streak = res.win ? S.streak + 1 : 0;
  const r = fightRewards({ win: res.win, stars, kos: res.kos, streak: S.streak, arena: before.arena, ranked, oppTrophies: opp.trophies || 0, trophies: S.trophies, firstWin });
  S.fights++; if (res.win) S.wins++; else S.losses++;
  S.kos += res.kos; S.stars += stars; S.bestStreak = Math.max(S.bestStreak, S.streak);
  if (firstWin) S.firstWinDay = today();
  track('fights', 1); track('kos', res.kos); if (res.win) { track('wins', 1); track('stars', stars); track('streakMax', S.streak, true); if (stars === 3) track('threeStars', 1); }
  const ups = grant(r, true);
  changed();
  return { stars, rewards: r, ups, firstWin, before, arenaUp: arenaOf(S.trophies) > before.arena ? arenaOf(S.trophies) : 0, streak: S.streak };
}
