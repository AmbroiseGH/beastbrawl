// Progression du joueur : gains, niveaux, quêtes, cadeau du jour, cartes, améliorations, cages et boutique.
import { S, changed } from '../core/save.js';
import { today } from '../core/utils.js';
import { ANIMALS, MAX_LEVEL } from '../data/animals.js';
import { xpNeed, levelReward, fightRewards, arenaOf, DAILY, DAILY_QUESTS, STARTER_QUESTS } from '../data/economy.js';
import { upgradeCost, CHESTS, CHEST_SLOTS, cycleChest, rollChest, gemsToOpen, PAW_SECONDS, dailyOffers, DECK_SIZE, WELCOME, STARTER } from '../data/cards.js';

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

// ---------- cartes et animaux ----------
export const owned = (id) => !!S.cards[id];
export const levelOf = (id) => (S.cards[id] ? S.cards[id].level : 1);
export const cardsOf = (id) => (S.cards[id] ? S.cards[id].count : 0);
export const deckLevels = () => S.deck.filter(owned).map((id) => ({ id, level: levelOf(id) }));
// Ajoute des cartes. Un animal jamais obtenu est débloqué (sa première carte le débloque, comme dans Clash Royale).
// Renvoie { isNew, level, count } pour l'animation d'ouverture.
export function addCards(id, n) {
  if (!ANIMALS[id] || n <= 0) return null;
  let c = S.cards[id], isNew = false;
  if (!c) { c = S.cards[id] = { level: 1, count: n - 1 }; isNew = true; if (S.deck.length < DECK_SIZE && !S.deck.includes(id)) S.deck.push(id); }
  else c.count += n;
  return { isNew, level: c.level, count: c.count };
}
export function canUpgrade(id) {
  if (!owned(id)) return false;
  const c = upgradeCost(id, levelOf(id)); return !!c && cardsOf(id) >= c.cards && S.coins >= c.coins;
}
export const upgradeReady = (id) => { if (!owned(id)) return false; const c = upgradeCost(id, levelOf(id)); return !!c && cardsOf(id) >= c.cards; };
export function upgradeAnimal(id) {
  if (!owned(id)) return 'non';
  const lv = levelOf(id), c = upgradeCost(id, lv);
  if (!c || lv >= MAX_LEVEL) return 'max';
  if (cardsOf(id) < c.cards) return 'cartes';
  if (S.coins < c.coins) return 'pieces';
  S.cards[id].count -= c.cards; S.coins -= c.coins; S.cards[id].level = lv + 1; S.upgrades++;
  track('upgrades', 1); const ups = grant({ xp: c.xp }, true); changed(); return ups.length ? ups : 'ok';
}
export const anyUpgrade = () => Object.keys(S.cards).some(upgradeReady);
// Deck : ajoute, retire ou échange une carte
export function setDeck(list) { S.deck = list.filter((id, i) => owned(id) && list.indexOf(id) === i).slice(0, DECK_SIZE); if (!S.deck.length) S.deck = [Object.keys(S.cards)[0]]; changed(); }

// ---------- cages ----------
export const freeSlot = () => S.chests.findIndex((c) => !c);
export const unlocking = () => S.chests.findIndex((c) => c && c.start && Date.now() < c.end);
export const chestLeft = (c) => (c && c.start ? Math.max(0, (c.end - Date.now()) / 1000) : CHESTS[c.tier].time);
export const chestReady = (c) => !!c && !!c.start && Date.now() >= c.end;
// Cage gagnée en combat : elle va dans le premier emplacement libre (sinon rien)
export function winChest() {
  const i = freeSlot(); if (i < 0) return null;
  const tier = cycleChest(S.chestCycle++);
  S.chests[i] = { tier, start: 0, end: 0 };
  return { slot: i, tier };
}
export function startUnlock(i) {
  const c = S.chests[i]; if (!c || c.start || unlocking() >= 0) return false;
  c.start = Date.now(); c.end = c.start + CHESTS[c.tier].time * 1000; changed(); return true;
}
export function speedUp(i, paws) {
  const c = S.chests[i]; if (!c || !c.start) return 0;
  const left = chestLeft(c), use = Math.min(paws, S.paws, Math.ceil(left / PAW_SECONDS));
  if (use <= 0) return 0;
  S.paws -= use; c.end -= use * PAW_SECONDS * 1000; changed(); return use;
}
export const openCost = (i) => gemsToOpen(chestLeft(S.chests[i]));
// Ouvre la cage de l'emplacement i (prête, ou payée en gemmes). Renvoie le contenu, déjà ajouté à la collection.
export function openSlot(i, pay = false) {
  const c = S.chests[i]; if (!c) return null;
  if (!chestReady(c)) {
    if (!pay) return null;
    const g = openCost(i); if (S.rubies < g) return 'gemmes';
    S.rubies -= g;
  }
  S.chests[i] = null;
  return applyChest(rollChest(c.tier, arenaOf(S.trophies)));
}
// Cage achetée dans la boutique : ouverte tout de suite
export function buyChest(tier) {
  const C = CHESTS[tier]; if (S.rubies < C.gems) return 'gemmes';
  S.rubies -= C.gems;
  return applyChest(rollChest(tier, arenaOf(S.trophies)));
}
export function welcomeChest() { S.welcome = true; return applyChest({ ...WELCOME, cards: WELCOME.cards.map((x) => ({ ...x })) }); }
// Le coffre en bois de la fin du tutoriel (une seule fois) ; il remplace la cage de bienvenue
export function starterChest() { S.welcome = true; S.tuto = { ...(S.tuto || {}), chest: true }; return applyChest({ ...STARTER, cards: STARTER.cards.map((x) => ({ ...x })) }); }
function applyChest(loot) {
  loot.cards = loot.cards.map((x) => { const lvBefore = levelOf(x.id), had = cardsOf(x.id); const r = addCards(x.id, x.n); return { ...x, ...r, had, lvBefore }; });
  S.coins += loot.coins; S.rubies += loot.gems; S.opened++;
  track('chests', 1); changed();
  return loot;
}

// ---------- boutique ----------
export function offers() {
  if (S.shop.day !== today()) S.shop = { day: today(), bought: {} };
  return dailyOffers(today(), S.uid).map((o, i) => ({ ...o, bought: !!S.shop.bought[i], slot: i }));
}
export function buyOffer(slot) {
  const o = offers()[slot]; if (!o || o.bought) return 'non';
  if (S.coins < o.price) return 'pieces';
  S.coins -= o.price; S.shop.bought[slot] = 1;
  const r = addCards(o.id, o.n); changed();
  return { ...o, ...r };
}

// ---------- fin d'un combat ----------
// res : { win, draw, crowns, lost, kos } ; opp : { trophies } ; ranked : combat classé ou amical
export function applyFight(res, opp, ranked = true) {
  const firstWin = res.win && ranked && S.firstWinDay !== today();
  const before = { trophies: S.trophies, level: S.level, arena: arenaOf(S.trophies), coins: S.coins, paws: S.paws, rubies: S.rubies, xp: S.xp };
  if (ranked && !res.draw) S.streak = res.win ? S.streak + 1 : 0;
  const r = fightRewards({ win: res.win, draw: res.draw, crowns: res.crowns, kos: res.kos, streak: S.streak, arena: before.arena, ranked, oppTrophies: opp.trophies || 0, trophies: S.trophies, firstWin });
  S.fights++; if (res.win) S.wins++; else if (res.draw) S.draws = (S.draws || 0) + 1; else S.losses++;
  S.lossRun = ranked ? (res.win ? 0 : res.draw ? S.lossRun || 0 : (S.lossRun || 0) + 1) : (S.lossRun || 0);
  S.kos += res.kos; S.crowns += res.crowns; S.bestStreak = Math.max(S.bestStreak, S.streak);
  if (firstWin) S.firstWinDay = today();
  track('fights', 1); track('kos', res.kos); track('crowns', res.crowns); if (res.aura) track('aura', res.aura);
  if (res.win) { track('wins', 1); track('streakMax', S.streak, true); if (res.crowns === 3) track('threeCrowns', 1); }
  const chest = res.win && ranked ? winChest() : null;
  const ups = grant(r, true);
  changed();
  return { rewards: r, ups, firstWin, before, chest, full: res.win && ranked && !chest, arenaUp: arenaOf(S.trophies) > before.arena ? arenaOf(S.trophies) : 0, streak: S.streak };
}
