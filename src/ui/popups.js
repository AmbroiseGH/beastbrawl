// Fenêtres du menu : quêtes, cadeau du jour, route des trophées, succès, paramètres, profil, échanges.
import { h, fmt, today } from '../core/utils.js';
import { S, changed, reset } from '../core/save.js';
import { sfx, music } from '../core/audio.js';
import { ARENA_MAX, arenaOf, arenaRange, DAILY, EXCHANGE } from '../data/economy.js';
import { AVATARS } from '../data/bots.js';
import { dailyQuests, starterQuests, claimQuest, dailyReady, dailyStep, claimDaily, grant } from '../game/progress.js';
import { onAction, render } from './menu.js';
import { handlers, celebrate } from './pages.js';
import { modal, p, toast, ask, prompt, fly, rewardHtml, TARGET } from './ui.js';
import { startFight } from './battle.js';
import { friendsPopup } from './social.js';
import { Net } from '../online/net.js';

// Montre des gains : les icônes volent vers les compteurs du haut
export function showGain(r, from = [470, 836]) {
  sfx.reward();
  if (r.coins) fly('coin', from, TARGET.coin, Math.min(12, 4 + Math.round(r.coins / 800)), (i) => sfx.coin(i % 4));
  if (r.paws) fly('paw', from, TARGET.paw, Math.min(10, 3 + Math.round(r.paws / 6)));
  if (r.rubies) fly('ruby', from, TARGET.ruby, Math.min(8, 2 + r.rubies));
  if (r.xp) fly('xp', from, TARGET.xp, 4);
}
export function levelUps(ups) {
  for (const u of ups || []) celebrate('Niveau ' + u.level + ' atteint !', null, `Récompense : ${rewardHtml({ coins: u.coins, rubies: u.rubies })}`);
}

// ---------- quêtes ----------
function questRow(q, refresh) {
  const ratio = Math.min(1, q.value / q.goal);
  return h('div', { class: 'card q' + (q.claimed ? ' done' : '') },
    h('div', { class: 'txt' }, h('div', { class: 't xs' }, q.text), h('div', { class: 'bar' }, h('b', { style: { width: Math.round(ratio * 100) + '%' } }), h('span', { class: 't xs' }, q.value + ' / ' + q.goal))),
    q.claimed ? h('div', { class: 'rw t xs good' }, 'Fait ✓')
      : q.ready ? h('button', { class: 'btn green small t sm pulse', html: rewardHtml(q.reward), onclick: (e) => { const r = claimQuest(q); if (r) { const b = e.currentTarget.getBoundingClientRect(); showGain(r.reward); levelUps(r.ups); refresh(); } } })
        : h('div', { class: 'rw t xs', html: rewardHtml(q.reward) }));
}
export function questsPopup() {
  const m = modal({ title: 'Quêtes', color: 'purple', body: [] });
  const draw = () => {
    m.body.textContent = '';
    m.body.append(h('div', { class: 'sect t sm' }, 'Quêtes du jour'), ...dailyQuests().map((q) => questRow(q, draw)));
    const st = starterQuests().filter((q) => !q.claimed);
    if (st.length) m.body.append(h('div', { class: 'sect t sm' }, 'Premiers pas'), ...st.map((q) => questRow(q, draw)));
  };
  draw();
}

// ---------- cadeau du jour ----------
export function dailyPopup() {
  const ready = dailyReady(), step = dailyStep();
  const days = DAILY.map((r, i) => h('div', { class: 'day' + (i === 6 ? ' big' : '') + (ready ? (i < step ? ' got' : i === step ? ' now' : '') : (i <= step ? ' got' : '')) },
    h('div', { class: 'd t xs' }, 'Jour ' + (i + 1)), h('div', { class: 'r t xs', html: `<span>${fmt(r.coins)}<i class="ico coin"></i></span><span>${r.paws}<i class="ico paw"></i> ${r.rubies}<i class="ico ruby"></i></span>` })));
  const m = modal({ title: 'Cadeau du jour', color: 'yellow', body: [p(ready ? 'Reviens chaque jour : le cadeau grossit jusqu\'au 7ᵉ jour !' : 'Cadeau déjà pris aujourd\'hui. Reviens demain pour le suivant !', 'small'), h('div', { class: 'days' }, days)],
    buttons: ready ? [{ label: 'Prendre', color: 'green', onclick: () => { const r = claimDaily(); if (r) { showGain(r.reward); levelUps(r.ups); } } }] : [{ label: 'OK', color: 'blue' }] });
  return m;
}

// ---------- route des trophées ----------
export function roadPopup() {
  const cur = arenaOf(S.trophies), rows = [];
  for (let a = ARENA_MAX; a >= 1; a--) {
    const [lo] = arenaRange(a);
    rows.push(h('div', { class: 'ar t sm' + (a === cur ? ' cur' : a < cur ? ' done' : '') }, h('div', { class: 'n' }, 'Arène ' + a + (a === cur ? '  ◀ tu es ici' : '')), h('i'), fmt(lo) + (a === ARENA_MAX ? ' +' : '')));
  }
  modal({ title: 'Route des trophées', body: [p(`Tu as <span style="color:var(--gold)">${fmt(S.trophies)}</span><i class="ico trophy"></i> (record : ${fmt(S.best)}). Chaque arène augmente les pièces gagnées.`, 'small'), h('div', { class: 'road' }, rows)] });
}

// ---------- succès ----------
export function statsPopup() {
  const st = (l, v) => h('div', { class: 'stat t xs' }, l, h('b', null, v));
  const rate = S.fights ? Math.round(S.wins / S.fights * 100) + ' %' : '-';
  modal({ title: 'Succès', color: 'yellow', body: [h('div', { class: 'stats' }, st('Combats', fmt(S.fights)), st('Victoires', fmt(S.wins)), st('Taux de victoire', rate), st('Meilleure série', fmt(S.bestStreak)),
    st('Animaux K.-O.', fmt(S.kos)), st('Étoiles gagnées', fmt(S.stars)), st('Record de trophées', fmt(S.best)), st('Améliorations', fmt(S.upgrades)))] });
}

// ---------- paramètres ----------
export function settingsPopup() {
  const tog = (label, key) => { const sw = h('div', { class: 'switch' + (S.settings[key] ? ' on' : '') }); return h('button', { class: 'card toggle t sm', style: { width: '100%' }, onclick: () => { S.settings[key] = !S.settings[key]; sw.classList.toggle('on', S.settings[key]); changed(); if (key === 'music') music(false); sfx.click(); } }, label, sw); };
  const m = modal({ title: 'Paramètres', body: [tog('Bruitages', 'sfx'), tog('Musique', 'music'),
    h('div', { class: 'row' },
      h('button', { class: 'btn blue small t sm', onclick: () => { sfx.click(); m.close(); howTo(); } }, 'Comment jouer'),
      h('button', { class: 'btn purple small t sm', onclick: async () => { sfx.click(); const v = await prompt('Ton pseudo', '', S.name, 14); if (v) { S.name = v; changed(); Net.pushProfile(); } } }, 'Changer de pseudo'),
      h('button', { class: 'btn red small t sm', onclick: async () => { sfx.click(); if (await ask('Tout effacer ?', 'Ta progression sera perdue pour de bon.', 'Effacer', 'Annuler')) { reset(); location.reload(); } } }, 'Recommencer')),
    p(`Beast Brawl! version 1.0<br>Un jeu Michigan · ${Net.online() ? 'Connecté au serveur en ligne' : 'Mode hors ligne'}`, 'small')] });
}
export function howTo() {
  modal({ title: 'Comment jouer', color: 'purple', body: [
    p('1. Avant chaque combat, place tes animaux sur les <span style="color:#8fdcff">carrés bleus</span> de ton côté de l\'arène. Ton équipe compte 5 slots.'),
    p('2. Appuie sur <span style="color:var(--gold)">Combattre !</span> Les animaux se battent tout seuls jusqu\'à ce qu\'une équipe soit entièrement K.-O.'),
    p('3. Le <b>Bulldog</b> encaisse et attire les coups, le <b>Singe</b> frappe vite tout ce qui l\'entoure. À toi de trouver le bon placement !'),
    p('4. Gagne des pièces, des pattes et des trophées, améliore tes animaux dans la Collection et grimpe d\'arène en arène.', 'small')], buttons: [{ label: 'Compris !', color: 'green' }] });
}

// ---------- profil ----------
export function profilePopup() {
  const avs = h('div', { class: 'row', style: { gap: '12px', marginTop: '0' } }, AVATARS.map((a) => h('button', { class: 'lrow', style: { width: '96px', height: '96px', padding: '0', justifyContent: 'center', outline: S.avatar === a ? '6px solid #ffd23f' : 'none', background: `center/cover url('assets/ui/av_${a}.webp')` }, onclick: () => { S.avatar = a; changed(); Net.pushProfile(); sfx.pick(); m.close(); profilePopup(); } })));
  const m = modal({ title: S.name || 'Dresseur', color: 'purple', body: [p('Choisis ton avatar', 'small'), avs,
    p(`Niveau ${S.level} · ${fmt(S.trophies)}<i class="ico trophy"></i> · ${S.wins} victoires`, ''),
    p(`Ton code ami : <span style="color:var(--gold);-webkit-user-select:text;user-select:text">${S.uid.toUpperCase()}</span>`, 'small')],
    buttons: [{ label: 'Changer de pseudo', color: 'blue', small: true, onclick: async () => { const v = await prompt('Ton pseudo', '', S.name, 14); if (v) { S.name = v; changed(); Net.pushProfile(); } } }] });
}

// ---------- boutons « + » ----------
export function exchangePopup(kind) {
  if (kind === 'rubies') {
    modal({ title: 'Rubis', color: 'red', body: [p('Les rubis se gagnent en jouant :'), p('• 1 rubis par victoire à 3 étoiles<br>• 5 rubis pour la première victoire du jour<br>• les quêtes, le cadeau du jour et chaque niveau gagné', 'small'),
      p('Ils s\'échangent contre des pièces ou des pattes avec les boutons «&nbsp;+&nbsp;».', 'small')], buttons: [{ label: 'Voir les quêtes', color: 'purple', onclick: questsPopup }] });
    return;
  }
  const isC = kind === 'coins', ico = isC ? 'coin' : 'paw';
  const rows = EXCHANGE[kind].map((o) => h('div', { class: 'card q' }, h('div', { class: 'txt' }, h('div', { class: 't sm', style: { fontSize: '40px' }, html: `${fmt(o.get)}<i class="ico ${ico}"></i>` })),
    h('button', { class: 'btn small t sm ' + (S.rubies >= o.rubies ? 'green' : 'stone'), html: `${o.rubies}<i class="ico ruby"></i>`, onclick: () => {
      if (S.rubies < o.rubies) { sfx.error(); toast('Pas assez de rubis.'); return; }
      grant({ rubies: -o.rubies, [isC ? 'coins' : 'paws']: o.get }); sfx.buy(); showGain({ [isC ? 'coins' : 'paws']: o.get }); m.close();
    } })));
  const m = modal({ title: isC ? 'Pièces' : 'Pattes', color: 'yellow', body: [p(`Échange tes rubis (tu en as ${fmt(S.rubies)}<i class="ico ruby"></i>)`, 'small'), ...rows] });
}

// ---------- branchement des boutons du menu ----------
export function wire() {
  handlers.fight = () => startFight({ mode: 'ranked' });
  handlers.quests = questsPopup; handlers.road = roadPopup; handlers.friends = friendsPopup; handlers.mail = dailyPopup;
  handlers.stats = statsPopup; handlers.settings = settingsPopup; handlers.profile = profilePopup;
  onAction('plus-coins', () => exchangePopup('coins')); onAction('plus-paws', () => exchangePopup('paws')); onAction('plus-rubies', () => exchangePopup('rubies'));
}

// Première visite : on demande un pseudo, puis on explique le jeu. Ensuite : le cadeau du jour s'il attend.
export async function firstVisit() {
  if (new URLSearchParams(location.search).has('test')) { if (!S.name) { S.name = 'Testeur'; changed(); } return; }
  if (!S.name) {
    const v = await prompt('Bienvenue !', 'Choisis ton pseudo de dresseur', '', 14, 'C\'est parti !');
    S.name = v || 'Dresseur'; S.seenIntro = true; changed(); Net.pushProfile();
    howTo();
  } else if (dailyReady()) dailyPopup();
}
