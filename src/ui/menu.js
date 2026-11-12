// Les menus : barre du haut (niveau, pièces, pattes, rubis), barre du bas, et la page affichée entre les deux.
import { $, h, fmt, fmtShort } from '../core/utils.js';
import { S, onChange } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { xpNeed } from '../data/economy.js';
import { setBackdrop } from './stage.js';

export const TABS = ['shop', 'collection', 'main', 'clan', 'ranked'];
// zones cliquables de la barre du bas (x de début et de fin de chaque tuile), selon l'onglet actif
const NAV = {
  main: [[0, 178], [182, 345], [348, 596], [600, 760], [765, 941]],
  shop: [[0, 218], [222, 392], [396, 578], [582, 756], [760, 941]],
  collection: [[0, 176], [178, 400], [404, 582], [586, 758], [762, 941]],
  clan: [[0, 178], [182, 345], [350, 540], [543, 750], [755, 941]],
  ranked: [[0, 178], [182, 347], [349, 535], [535, 713], [713, 941]],
};
const pages = {};          // nom → fonction(page) qui dessine la page
const actions = {};        // boutons de la barre du haut
let tab = 'main';
export const current = () => tab;
export const register = (name, fn) => { pages[name] = fn; };
export const onAction = (name, fn) => { actions[name] = fn; };

const last = { coins: -1, paws: -1, rubies: -1, level: -1 };
export function refreshTop() {
  const need = xpNeed(S.level);
  $('tbLvl').textContent = S.level;
  $('tbXp').textContent = fmt(S.xp) + ' / ' + fmt(need);
  $('tbXpFill').style.width = Math.round(Math.min(1, S.xp / need) * 100) + '%';
  for (const [k, id] of [['coins', 'tbCoins'], ['paws', 'tbPaws'], ['rubies', 'tbRubies']]) {
    const el = $(id); el.textContent = fmtShort(S[k]);
    if (last[k] >= 0 && S[k] !== last[k]) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    last[k] = S[k];
  }
  if (last.level >= 0 && S.level !== last.level) { $('tbLvl').classList.remove('pop'); void $('tbLvl').offsetWidth; $('tbLvl').classList.add('pop'); }
  last.level = S.level;
}

export function render() {
  const page = $('page');
  page.className = 'pg-' + tab; page.textContent = '';
  pages[tab] && pages[tab](page);
  refreshTop();
}

export function go(t, silent) {
  if (!pages[t]) return;
  if (!silent && t !== tab) sfx.click();
  tab = t;
  const url = 'assets/bg/' + t + '.webp';
  $('menuBg').style.backgroundImage = `url('${url}')`; setBackdrop(url);
  const nav = $('nav'); nav.textContent = '';
  NAV[t].forEach(([x0, x1], i) => nav.append(h('button', { class: 'hit', 'aria-label': TABS[i], style: { left: x0 + 'px', top: '0', width: (x1 - x0) + 'px', height: '172px' }, onclick: () => go(TABS[i]) })));
  render();
  const pg = $('page'); pg.classList.remove('pg-in'); void pg.offsetWidth; pg.classList.add('pg-in');
}

export function showMenu(t = 'main') {
  $('scrLoading').hidden = true; $('scrBattle').hidden = true; $('scrMenu').hidden = false;
  go(t, true);
}

$('topbar').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) { sfx.click(); actions[b.dataset.act](); } });
onChange(() => { if (!$('scrMenu').hidden) render(); });
