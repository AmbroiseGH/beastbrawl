// Pages d'accueil (les quatre emplacements de coffres) et de boutique (offres de cartes en pièces, coffres en gemmes).
// La collection est dans collection.js.
import { $, h, fmt } from '../core/utils.js';
import { S } from '../core/save.js';
import { sfx, play } from '../core/audio.js';
import { ANIMALS } from '../data/animals.js';
import { RARITY, RARITIES, CHESTS, PAW_SECONDS, gemsToOpen, upgradeCost } from '../data/cards.js';
import { arenaOf, arenaRange, ARENAS } from '../data/economy.js';
import { chestIcon } from '../core/assets.js';
import { owned, levelOf, cardsOf, questsReady, dailyReady, anyUpgrade, chestLeft, chestReady, unlocking, startUnlock, speedUp,
  openCost, openSlot, buyChest, offers, buyOffer } from '../game/progress.js';
import { register, render } from './menu.js';
import { modal, p, toast } from './ui.js';
import { openChestAnim } from './chest.js';
import { ambient } from './ambient.js';

export const hit = (x, y, w, hgt, onclick, label) => h('button', { class: 'hit', 'aria-label': label, style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hgt + 'px' }, onclick: () => { sfx.click(); onclick(); } });
export const ctr = (x, y, cls, text) => h('div', { class: 'ctr t ' + cls, style: { left: x + 'px', top: y + 'px' } }, text);
const badge = (x, y, n) => h('div', { class: 'badge t xs', style: { left: x + 'px', top: y + 'px' } }, n);
export const handlers = {};   // branchés par popups.js : fight, quests, road, friends, mail, stats, settings, profile

// Durée lisible : « 3 h 05 », « 12 min », « 4 min 05 s », « 45 s »
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec >= 3600) { const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return hh + ' h' + (m ? ' ' + String(m).padStart(2, '0') : ''); }
  if (sec >= 60) { const m = Math.floor(sec / 60), s = sec % 60; return m + ' min' + (s && m < 10 ? ' ' + String(s).padStart(2, '0') + ' s' : ''); }
  return sec + ' s';
}
// Pourcentage à la française : « 43 % », « 8,1 % », « 0,12 % »
export function pct(x) {
  const v = x >= 10 ? Math.round(x) : x >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;
  return String(v).replace('.', ',') + ' %';
}

// ---------- accueil ----------
// Accueil tropical (maquette « main ») : plaque du joueur, trophées (coupe en noix de coco), île de l'arène, panneau de
// l'arène, bouton Combattre, et la rangée des 4 emplacements de coffres au-dessus de la barre du bas.
const SLOT_X = [55, 268, 480, 693], SLOT_Y = 1286, SLOT_W = 190, SLOT_H = 171;
const SIDE_L = 15, SIDE_R = 797, SIDE_Y = [615, 755, 895], SIDE_W = 130, SIDE_H = 110;   // les trois cases de chaque côté
register('main', (pg) => {
  const arena = arenaOf(S.trophies), [lo, hi] = arenaRange(arena);
  pg.append(
    ambient(),
    h('div', { class: 'mn-name t' }, S.name || 'Dresseur'),
    h('div', { class: 'mn-clan t sm' }, h('i'), S.clan ? S.clan.name : 'Sans clan'),
    ctr(712, 146, 'mn-tro', fmt(S.trophies)),
    ctr(473, 998, 'mn-arena', 'Arène ' + arena),
    ctr(495, 1055, 'mn-range sm', hi === null ? fmt(lo) + ' +' : fmt(lo) + ' - ' + fmt(hi)),
    h('div', { class: 'mn-shine' }),
    hit(20, 92, 408, 110, () => handlers.profile(), 'Profil'),
    hit(548, 94, 250, 104, () => handlers.road(), 'Trophées'),
    hit(812, 94, 116, 104, () => handlers.settings(), 'Menu'),
    hit(SIDE_L, SIDE_Y[0], SIDE_W, SIDE_H, () => handlers.quests(), 'Quêtes'),
    hit(SIDE_L, SIDE_Y[1], SIDE_W, SIDE_H, () => handlers.road(), 'Route des trophées'),
    hit(SIDE_L, SIDE_Y[2], SIDE_W, SIDE_H, () => handlers.friends(), 'Amis'),
    hit(SIDE_R, SIDE_Y[0], SIDE_W, SIDE_H, () => handlers.mail(), 'Cadeau du jour'),
    hit(SIDE_R, SIDE_Y[1], SIDE_W, SIDE_H, () => handlers.stats(), 'Succès'),
    hit(SIDE_R, SIDE_Y[2], SIDE_W, SIDE_H, () => handlers.settings(), 'Paramètres'),
    hit(180, 560, 580, 390, () => handlers.road(), ARENAS[arena - 1].name),
    hit(280, 962, 380, 128, () => handlers.road(), 'Arène ' + arena),
    h('button', { class: 'hit mn-fight', 'aria-label': 'Combattre', id: 'btnFight', style: { left: '212px', top: '1101px', width: '509px', height: '152px', borderRadius: '56px' }, onclick: () => handlers.fight() }),
  );
  if (S.streak >= 2) pg.append(h('div', { class: 'mn-streak t xs' }, '🔥 ' + S.streak + ' victoires'));
  for (let i = 0; i < 4; i++) pg.append(chestSlot(i));
  const q = questsReady(); if (q) pg.append(badge(118, 600, q));
  if (dailyReady()) pg.append(badge(904, 622, '!'));
  if (anyUpgrade()) pg.append(h('div', { class: 'badge fixed t xs', style: { left: '318px', top: '1498px' } }, '!'));   // posée sur la barre du bas : ne glisse pas
});

// Un emplacement de coffre : vide, fermé, en train de se débloquer (minuteur) ou prêt à ouvrir
function chestSlot(i) {
  const c = S.chests[i], x = SLOT_X[i];
  if (!c) return hit(x, SLOT_Y, SLOT_W, SLOT_H, () => toast('Gagne des combats pour remporter des coffres !'), 'Emplacement vide');
  const C = CHESTS[c.tier], ready = chestReady(c), run = !!c.start && !ready, busy = unlocking() >= 0;
  const kids = [h('img', { class: 'cs-img', src: chestIcon(c.tier), alt: '', draggable: 'false' }), h('div', { class: 'cs-name t xs' }, C.name.replace('Coffre ', ''))];
  if (ready) kids.push(h('div', { class: 'cs-open t sm' }, 'Ouvrir !'));
  else if (run) kids.push(h('div', { class: 'cs-time t xs', dataset: { end: c.end } }, fmtTime(chestLeft(c))), h('div', { class: 'cs-gem t xs', html: `${openCost(i)}<i class="ico ruby"></i>` }));
  else kids.push(h('div', { class: 'cs-lock t xs' + (busy ? ' wait' : '') }, busy ? fmtTime(C.time) : 'Débloquer'), busy ? null : h('div', { class: 'cs-dur t xs' }, fmtTime(C.time)));
  return h('button', { class: 'cslot' + (ready ? ' ready' : run ? ' run' : busy ? ' wait' : ''), 'aria-label': C.name, style: { left: x + 'px', top: SLOT_Y + 'px', width: SLOT_W + 'px', height: SLOT_H + 'px' }, onclick: () => { sfx.click(); chestTap(i); } }, kids);
}

// Fiche d'un coffre : ce qu'il peut contenir et les chances d'obtenir chaque rareté
export function chestInfo(tier) {
  const C = CHESTS[tier], arena = arenaOf(S.trophies), k = 1 + 0.25 * (arena - 1);
  const odds = C.odds.map((o, i) => (i === 0 ? 100 : 100 * (1 - Math.pow(1 - o / 100, C.cards))));   // chance d'au moins une carte de cette rareté
  return h('div', { class: 'ci' },
    h('div', { class: 'ci-top' },
      h('img', { class: 'ci-img', src: chestIcon(tier), alt: '' }),
      h('div', { class: 'ci-txt' },
        h('div', { class: 'ci-tier t sm', style: { color: C.color } }, 'Coffre ' + C.tier.toLowerCase()),
        h('div', { class: 't sm' }, C.cards + ' cartes'),
        h('div', { class: 't sm', html: `${fmt(C.coins * k * 0.85)} - ${fmt(C.coins * k * 1.15)}<i class="ico coin"></i>` }),
        C.gemsIn[1] ? h('div', { class: 't sm', html: `${C.gemsIn[0]} - ${C.gemsIn[1]}<i class="ico ruby"></i>` }) : null,
        h('div', { class: 't xs cream' }, 'Déblocage : ' + fmtTime(C.time)))),
    h('div', { class: 'ci-sub t xs' }, 'Chance d\'obtenir au moins une carte'),
    h('div', { class: 'ci-odds' }, RARITIES.map((r, i) => h('div', { class: 'ci-o r-' + r }, h('span', { class: 't xs' }, RARITY[r].name), h('b', { class: 't xs' }, pct(odds[i]))))));
}

async function chestTap(i) {
  const c = S.chests[i]; if (!c) return;
  if (chestReady(c)) { openFromSlot(i, false); return; }
  const C = CHESTS[c.tier], run = !!c.start, busy = unlocking();
  const body = [chestInfo(c.tier)], buttons = [];
  if (!run) {
    if (busy < 0) buttons.push({ label: 'Débloquer', color: 'green', onclick: () => { if (startUnlock(i)) { play('unlock'); toast(`${C.name} : prêt dans ${fmtTime(C.time)}`); } } });
    else body.push(p('Un autre coffre est déjà en train de se débloquer.', 'small'));
  } else {
    const left = chestLeft(c), need = Math.ceil(left / PAW_SECONDS), use = Math.min(need, S.paws);
    body.push(p(`Prêt dans <span style="color:var(--gold)">${fmtTime(left)}</span>`));
    if (use > 0) buttons.push({ html: `${fmt(use)}<i class="ico paw"></i> −${fmtTime(use * PAW_SECONDS)}`, color: 'blue', onclick: () => {
      const n = speedUp(i, use); if (n) { play('whoosh'); play('tick', { at: 0.1 }); toast(`−${fmtTime(n * PAW_SECONDS)} grâce à tes pattes !`); render(); }
    } });
  }
  const g = run ? openCost(i) : gemsToOpen(C.time);
  buttons.push({ html: `Ouvrir ${fmt(g)}<i class="ico ruby"></i>`, color: S.rubies >= g ? 'yellow' : 'stone', onclick: () => openFromSlot(i, true) });
  if (run) body.push(p('Chaque patte fait gagner 2 minutes.', 'small'));
  modal({ title: C.name, color: 'purple', body, buttons });
}
async function openFromSlot(i, pay) {
  const loot = openSlot(i, pay);
  if (loot === 'gemmes') { sfx.error(); toast('Pas assez de gemmes. Gagne-en avec les quêtes et le cadeau du jour !'); return; }
  if (!loot) return;
  await openChestAnim(loot);
  render();
}

// Temps restant avant les nouvelles offres de la boutique (minuit)
const resetText = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return 'Nouvelles offres dans ' + fmtTime((d - Date.now()) / 1000); };
// Les minuteurs des coffres défilent chaque seconde ; quand un coffre est prêt, la page se redessine
setInterval(() => {
  if ($('scrMenu').hidden) return;
  let ready = false;
  document.querySelectorAll('.cs-time').forEach((el) => {
    const left = (+el.dataset.end - Date.now()) / 1000;
    if (left <= 0) { ready = true; return; }
    el.textContent = fmtTime(left);
    const g = el.nextElementSibling; if (g) g.innerHTML = gemsToOpen(left) + '<i class="ico ruby"></i>';
  });
  const sh = document.querySelector('.of-reset');
  if (sh) sh.textContent = resetText();
  if (ready) { play('chest_land', { v: 0.5 }); render(); }
}, 1000);

// ---------- boutique ----------
const OFFER_X = [30, 330, 630], OFFER_Y = 472, OFFER_W = 285, OFFER_H = 338;
// les 6 cases de coffres (2 rangées de 3) : vides dans le fond, nom, rareté, image et prix posés ici
const COFFRES = { rustique: [30, 918, 288, 234], sauvage: [327, 918, 285, 234], blindee: [623, 918, 289, 234],
  mystique: [30, 1168, 288, 234], dore: [327, 1168, 285, 234], royale: [623, 1168, 289, 234] };
register('shop', (pg) => {
  offers().forEach((o, i) => {
    const x = OFFER_X[i], a = ANIMALS[o.id], can = S.coins >= o.price;
    pg.append(h('div', { class: 'of r-' + o.rarity + (o.bought ? ' sold' : ''), style: { left: x + 'px', top: OFFER_Y + 'px', width: OFFER_W + 'px', height: OFFER_H + 'px' } },
      h('div', { class: 'of-name t sm' }, a.name),
      h('img', { class: 'of-card', src: `assets/cards/${o.id}.webp`, alt: '', draggable: 'false' }),   // la carte entière
      owned(o.id) ? null : h('div', { class: 'of-new t xs' }, 'Nouveau !'),
      h('div', { class: 'of-n t' }, '×' + o.n),
      o.bought ? h('div', { class: 'of-price sold t sm' }, 'Acheté ✓') : h('div', { class: 'of-price t sm' + (can ? '' : ' no'), html: `<i class="ico coin"></i>${fmt(o.price)}` })),
    hit(x, OFFER_Y, OFFER_W, OFFER_H, () => offerTap(o), a.name));
  });
  pg.append(h('div', { class: 'of-reset t xs' }, resetText()));   // écrit tout de suite : sinon la ligne n'apparaît qu'à la seconde suivante
  Object.entries(COFFRES).forEach(([tier, [x, y, w, hh]]) => {
    const C = CHESTS[tier];
    pg.append(h('div', { class: 'sc', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } },
      h('div', { class: 'sc-name t' }, C.name),
      h('div', { class: 'sc-tier t xs', style: { background: C.pill } }, '• ' + C.tier + ' •'),
      h('img', { class: 'sc-img', src: chestIcon(tier), alt: '', draggable: 'false' }),
      h('div', { class: 'sc-price t', html: `<i class="ico ruby"></i>${fmt(C.gems)}` })),
    hit(x, y, w, hh, () => cagePopup(tier), C.name));
  });
  pg.append(hit(836, 395, 76, 56, () => offersInfo(), 'À propos des offres'), hit(836, 838, 76, 56, () => cagesInfo(), 'À propos des coffres'));
});

function offerTap(o) {
  const a = ANIMALS[o.id], R = RARITY[o.rarity];
  if (o.bought) { toast('Déjà acheté aujourd\'hui. Nouvelles offres demain !'); return; }
  const has = owned(o.id), need = has ? upgradeCost(o.id, levelOf(o.id)) : null;
  const body = [
    h('div', { class: 'of-big' }, h('img', { src: `assets/cards/${o.id}.webp`, alt: a.name }), h('div', { class: 'of-n t' }, '×' + o.n)),
    p(`${o.n} cartes <span style="color:${R.color}">${R.name.toLowerCase()}s</span> ${/^[aeiouyéèêàâîô]/i.test(a.name) ? 'd\'' : 'de '}${a.name}`),
    p(has ? `Tu en as ${fmt(cardsOf(o.id))}${need ? ' / ' + fmt(need.cards) + ' pour le niveau ' + (levelOf(o.id) + 1) : ''}.` : 'Tu n\'as pas encore cet animal : il rejoindra ta collection !', 'small'),
  ];
  const can = S.coins >= o.price;
  modal({ title: o.label, color: o.rarity === 'epic' ? 'purple' : o.rarity === 'rare' ? 'yellow' : '', body, buttons: [{ html: `<i class="ico coin"></i>${fmt(o.price)}`, color: can ? 'green' : 'stone', onclick: async () => {
    const r = buyOffer(o.slot);
    if (r === 'pieces') { sfx.error(); toast(`Il te manque ${fmt(o.price - S.coins)}<i class="ico coin"></i>. Gagne des combats !`); return; }
    if (!r || r === 'non') return;
    sfx.buy();
    await openChestAnim({ tier: 'rustique', direct: true, coins: 0, gems: 0, cards: [{ id: o.id, n: o.n, isNew: r.isNew, level: r.level, count: r.count, had: r.isNew ? 0 : r.count - o.n }] });
    render();
  } }] });
}

function cagePopup(tier) {
  const C = CHESTS[tier], can = S.rubies >= C.gems;
  modal({ title: C.name, color: 'purple', body: [chestInfo(tier), p('Acheté, il s\'ouvre tout de suite.', 'small')], buttons: [{ html: `${fmt(C.gems)}<i class="ico ruby"></i>`, color: can ? 'green' : 'stone', onclick: async () => {
    const loot = buyChest(tier);
    if (loot === 'gemmes') { sfx.error(); toast(`Il te manque ${fmt(C.gems - S.rubies)}<i class="ico ruby"></i>. Gagne des gemmes avec les quêtes et le cadeau du jour !`); return; }
    sfx.buy();
    await openChestAnim(loot);
    render();
  } }] });
}
function offersInfo() {
  modal({ title: 'Cartes d\'animaux', body: [p('Chaque jour, trois animaux sont en vente contre des pièces : un commun, un rare et un épique.'),
    p('Une offre ne s\'achète qu\'une fois par jour. Un animal que tu n\'as pas encore rejoint ta collection dès son achat !', 'small'),
    p('Les animaux légendaires et ultimes ne se trouvent que dans les coffres.', 'small')], buttons: [{ label: 'OK', color: 'blue' }] });
}
function cagesInfo() {
  const rows = Object.keys(CHESTS).map((t) => { const C = CHESTS[t]; return h('div', { class: 'ci-row' }, h('img', { src: chestIcon(t), alt: '' }), h('div', { class: 't xs' }, C.name), h('b', { class: 't xs' }, pct(C.odds[3] + C.odds[4]))); });
  modal({ title: 'Les coffres', body: [p('Tous les coffres peuvent contenir toutes les raretés, même le Coffre Rustique ! Plus le coffre est précieux, plus les cartes rares sont fréquentes.', 'small'),
    h('div', { class: 'ci-sub t xs' }, 'Chance qu\'une carte soit légendaire ou ultime'), h('div', { class: 'ci-list' }, rows),
    p('Gagne des coffres en remportant des combats classés : ils se rangent dans les 4 emplacements de l\'accueil.', 'small')], buttons: [{ label: 'OK', color: 'blue' }] });
}

// Petite fête plein écran (niveau gagné, arène débloquée)
// id : une carte d'animal à montrer ; img : ou une image (la nouvelle arène)
export function celebrate(title, id, sub, img) {
  play('levelup');
  const pic = id ? h('div', { class: 'cele-card pulse' }, h('img', { src: `assets/cards/${id}.webp`, alt: '' }))
    : img ? h('div', { class: 'cele-arena pulse' }, h('img', { src: img, alt: '' })) : null;
  modal({ title: 'Bravo !', color: 'yellow', body: [pic, p(title), sub ? p(sub, 'small') : null], buttons: [{ label: 'Super !', color: 'green' }] });
}
