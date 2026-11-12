// Pages d'accueil, de boutique et de collection.
import { h, fmt } from '../core/utils.js';
import { S } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { ANIMALS, MAX_LEVEL, statsAt, TEAM_SLOTS } from '../data/animals.js';
import { arenaOf, arenaRange, SHOP, playable, upgradeCost } from '../data/economy.js';
import { owned, levelOf, buyAnimal, upgradeAnimal, canUpgrade, questsReady, dailyReady, anyUpgrade } from '../game/progress.js';
import { register, go } from './menu.js';
import { modal, p, toast, ask } from './ui.js';

const hit = (x, y, w, hgt, onclick, label) => h('button', { class: 'hit', 'aria-label': label, style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hgt + 'px' }, onclick: () => { sfx.click(); onclick(); } });
const ctr = (x, y, cls, text) => h('div', { class: 'ctr t ' + cls, style: { left: x + 'px', top: y + 'px' } }, text);
const badge = (x, y, n) => h('div', { class: 'badge t xs', style: { left: x + 'px', top: y + 'px' } }, n);
export const handlers = {};   // branchés par main.js : fight, quests, road, friends, mail, stats, settings, profile, arena

// ---------- accueil ----------
register('main', (pg) => {
  const arena = arenaOf(S.trophies), [lo, hi] = arenaRange(arena);
  pg.append(
    h('div', { class: 'mn-name t' }, S.name || 'Dresseur'),
    h('div', { class: 'mn-clan t sm' }, h('i'), S.clan ? S.clan.name : 'Sans clan'),
    ctr(713, 142, 'mn-tro', fmt(S.trophies)),
    ctr(472, 1090, 'mn-arena', 'Arène ' + arena),
    ctr(506, 1153, 'mn-range sm', hi === null ? fmt(lo) + ' +' : fmt(lo) + ' - ' + fmt(hi)),
    h('div', { class: 'mn-shine' }),
    hit(20, 92, 418, 112, () => handlers.profile(), 'Profil'),
    hit(548, 96, 250, 98, () => handlers.road(), 'Trophées'),
    hit(816, 96, 108, 98, () => handlers.settings(), 'Menu'),
    hit(18, 606, 126, 124, () => handlers.quests(), 'Quêtes'),
    hit(18, 746, 126, 124, () => handlers.road(), 'Route des trophées'),
    hit(18, 888, 126, 124, () => handlers.friends(), 'Amis'),
    hit(800, 606, 126, 124, () => handlers.mail(), 'Cadeaux'),
    hit(800, 746, 126, 124, () => handlers.stats(), 'Succès'),
    hit(800, 888, 126, 124, () => handlers.settings(), 'Paramètres'),
    hit(210, 610, 520, 400, () => handlers.road(), 'Arène'),
    h('button', { class: 'hit mn-fight', 'aria-label': 'Combattre', id: 'btnFight', style: { left: '140px', top: '1240px', width: '652px', height: '200px', borderRadius: '70px' }, onclick: () => handlers.fight() }),
  );
  if (S.streak >= 2) pg.append(ctr(470, 1212, 'mn-streak sm', '🔥 Série de ' + S.streak + ' victoires'));
  const q = questsReady(); if (q) pg.append(badge(104, 596, q));
  if (!dailyReady()) pg.append(h('div', { style: { position: 'absolute', left: '872px', top: '594px', width: '60px', height: '60px', borderRadius: '50%', background: '#3b4a6b', border: '4px solid #1a2238' } }));
  if (anyUpgrade()) pg.append(h('div', { class: 'badge t xs', style: { left: '300px', top: '1494px' } }, '!'));
});

// ---------- boutique ----------
const SHOP_POS = [];   // rectangles des cartes (x, y, largeur, hauteur) puis du bouton de prix
(() => {
  const xs = [[35, 318], [332, 612], [627, 908]], ys = [[400, 665], [682, 948], [965, 1235]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) SHOP_POS.push({ card: [xs[c][0], ys[r][0], xs[c][1] - xs[c][0], ys[r][1] - ys[r][0]], price: [xs[c][0] + 27, ys[r][1] - 75, xs[c][1] - xs[c][0] - 54, 66] });
  SHOP_POS.push({ card: [35, 1250, 875, 228], price: [530, 1352, 335, 88] });
})();
register('shop', (pg) => {
  SHOP.forEach((it, i) => {
    const P = SHOP_POS[i], [x, y, w, hh] = P.card;
    if (playable(it.id)) {
      pg.append(hit(x, y, w, hh, () => animalSheet(it.id), it.name));
      if (owned(it.id)) pg.append(h('div', { class: 'sh-own t sm', style: { left: P.price[0] + 'px', top: P.price[1] + 'px', width: P.price[2] + 'px', height: P.price[3] + 'px' } }, 'Possédé ✓'));
      else if (S.coins >= it.price) pg.append(h('div', { class: 'sh-new t sm', style: { left: (x + w - 150) + 'px', top: (y + 4) + 'px' } }, 'Achetable !'));
    } else {
      pg.append(h('div', { class: 'sh-soon', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } }, h('span', { class: 't sm' }, 'Bientôt')),
        hit(x, y, w, hh, () => toast(it.name + ' arrive dans une prochaine mise à jour !'), it.name));
    }
  });
});

// ---------- collection ----------
// décalages des cartes par rapport à celle du singe (mesurés sur la maquette)
const COL = { monkey: { dx: 0, bx: 0 }, bulldog: { dx: 589, bx: 594 } };
const GREY = [[294, 0, 299, 0], [5, 303, 0, 284], [298, 303, 299, 284], [591, 303, 597, 284]];   // chaton, alligator, orang-outan, cochon
register('collection', (pg) => {
  const n = Object.keys(S.animals).length;
  pg.append(h('div', { class: 'ctr t co-count sm', style: { left: '752px', top: '351px' }, html: `<span style="color:var(--gold)">${n}</span> / 10` }));
  for (const id of ['monkey', 'bulldog']) {
    const { dx, bx } = COL[id];
    if (!owned(id)) {
      pg.append(h('div', { class: 'co-locked', style: { left: '622px', top: '416px', width: '296px', height: '296px', backgroundImage: "url('assets/ui/coll_bulldog_locked.webp')" } }),
        h('div', { class: 'co-lock', style: { left: (820) + 'px', top: '418px' } }),
        ctr(196 + bx, 674, 'co-soon xs', 'Boutique'),
        hit(628, 422, 284, 284, () => animalSheet(id), ANIMALS[id].name));
      continue;
    }
    const lv = levelOf(id), cost = upgradeCost(lv), ratio = cost ? Math.min(1, S.paws / cost.paws) : 1, ok = canUpgrade(id);
    pg.append(
      ctr(254 + dx, 448, 'co-lvl sm', 'Niv. ' + lv),
      h('div', { class: 'co-bar' + (cost && S.paws >= cost.paws ? ' full' : ''), style: { left: (99 + bx) + 'px', top: '656px', width: '193px' } }, h('b', { style: { width: Math.round(ratio * 100) + '%' } })),
      ctr(196 + bx, 674, 'co-bartxt xs', cost ? fmt(S.paws) + ' / ' + fmt(cost.paws) : 'MAX'),
      hit(33 + dx - (id === 'bulldog' ? -6 : 0), 422, 284, 284, () => animalSheet(id), ANIMALS[id].name),
    );
    if (ok) pg.append(h('div', { class: 'co-up', style: { left: (40 + dx) + 'px', top: '400px' } }));
  }
  GREY.forEach(([dx, dy, bx, by], i) => {
    pg.append(h('div', { class: 'co-lock', style: { left: (228 + dx) + 'px', top: (418 + dy) + 'px' } }), ctr(196 + bx, 674 + by, 'co-soon xs', 'Bientôt'),
      hit(33 + dx, 422 + dy, 284, 284, () => toast('Cet animal arrive dans une prochaine mise à jour !'), 'Bientôt'));
  });
  [[35, 1005], [335, 1005], [632, 1005], [35, 1215]].forEach(([x, y]) => pg.append(hit(x, y, 284, 190, () => toast('Cet animal arrive dans une prochaine mise à jour !'), 'Bientôt')));
});

// ---------- fiche d'un animal (statistiques, achat, amélioration) ----------
const IMGS = { monkey: 'card_monkey', bulldog: 'card_bulldog' };
export function animalSheet(id) {
  const a = ANIMALS[id], has = owned(id), lv = levelOf(id), s = statsAt(id, lv), nx = lv < MAX_LEVEL ? statsAt(id, lv + 1) : null;
  const cost = has ? upgradeCost(lv) : null, item = SHOP.find((x) => x.id === id);
  const stat = (label, v, up) => h('div', { class: 'stat t xs' }, label, h('span', null, h('b', null, v), has && up ? h('em', null, '+' + up) : null));
  const body = [
    h('div', { class: 'an-top' },
      h('div', { class: 'an-pic' }, h('img', { src: `assets/ui/${IMGS[id]}.webp`, alt: a.name }), has ? h('div', { class: 'lv t xs' }, 'Niv. ' + lv) : null),
      h('div', { class: 'an-info' }, h('div', { class: 'nm t' }, a.name), h('div', { class: 'role t sm' }, a.role), h('div', { class: 'slots t xs' }, `Prend ${a.slots} slot sur ${TEAM_SLOTS}`), p(a.desc, 'an-desc small'))),
    h('div', { class: 'stats' },
      stat('Points de vie', fmt(s.hp), nx && fmt(nx.hp - s.hp)), stat('Dégâts', fmt(s.dmg), nx && fmt(nx.dmg - s.dmg)),
      stat('Cadence', (1 / a.atkEvery).toFixed(1).replace('.', ',') + ' / s'), stat('Vitesse', a.speed.toFixed(1).replace('.', ','))),
    p(a.talent, 'small'),
  ];
  let m;
  if (!has) {
    const can = S.coins >= item.price;
    body.push(h('div', { class: 'cost t sm' }, h('span', { class: can ? '' : 'no', html: `${fmt(item.price)}<i class="ico coin"></i>` })));
    m = modal({ title: a.name, color: 'purple', body, buttons: [{ label: 'Acheter', color: can ? 'green' : 'stone', keep: true, onclick: () => {
      const r = buyAnimal(id);
      if (r === 'ok') { sfx.buy(); m.close(); celebrate(a.name + ' rejoint ton équipe !', id, 'Place-le dans ta formation au prochain combat.'); }
      else { sfx.error(); toast(`Il te manque ${fmt(item.price - S.coins)}<i class="ico coin"></i>. Gagne des combats !`); }
    } }] });
  } else if (cost) {
    const okP = S.paws >= cost.paws, okC = S.coins >= cost.coins;
    body.push(h('div', { class: 'cost t sm' }, h('span', { class: okP ? '' : 'no', html: `${fmt(cost.paws)}<i class="ico paw"></i>` }), h('span', { class: okC ? '' : 'no', html: `${fmt(cost.coins)}<i class="ico coin"></i>` })));
    m = modal({ title: a.name, color: 'purple', body, buttons: [{ label: 'Améliorer', color: okP && okC ? 'green' : 'stone', keep: true, onclick: () => {
      const r = upgradeAnimal(id);
      if (r === 'ok') { sfx.upgrade(); m.close(); celebrate(a.name + ' passe au niveau ' + levelOf(id) + ' !', id, '+10 % de points de vie et de dégâts'); }
      else { sfx.error(); toast(r === 'pattes' ? `Il te manque ${fmt(cost.paws - S.paws)}<i class="ico paw"></i>. Mets des animaux K.-O. pour en gagner !` : `Il te manque ${fmt(cost.coins - S.coins)}<i class="ico coin"></i>.`); }
    } }] });
  } else m = modal({ title: a.name, color: 'purple', body: [...body, p('Niveau maximum atteint !')] });
}

// Petite fête plein écran (achat, amélioration, niveau gagné)
export function celebrate(title, id, sub) {
  const pic = id ? h('div', { class: 'an-pic pulse', style: { margin: '0 auto 20px' } }, h('img', { src: `assets/ui/${IMGS[id]}.webp`, alt: '' })) : null;
  modal({ title: 'Bravo !', color: 'yellow', body: [pic, p(title), sub ? p(sub, 'small') : null], buttons: [{ label: 'Super !', color: 'green' }] });
}
