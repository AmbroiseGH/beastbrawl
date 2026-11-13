// Les menus : barre du haut (niveau, pièces, pattes, rubis), barre du bas, et la page affichée entre les deux.
// On passe d'une page à l'autre en la faisant glisser, au doigt ou avec la barre du bas : les deux barres restent fixes.
import { $, h, fmt, fmtShort } from '../core/utils.js';
import { S, onChange } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { xpNeed } from '../data/economy.js';
import { W, view, setBackdrop } from './stage.js';

export const TABS = ['shop', 'collection', 'main', 'clan', 'ranked'];   // de gauche à droite, comme dans la barre du bas
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

// ---------- la zone qui glisse ----------
// Chaque page est un « panneau » (son fond + ses boutons). La zone visible des panneaux est découpée pour laisser
// fixes la barre du haut et la barre du bas, dessinées dans le fond de la page active (y compris l'icône de
// l'onglet actif, qui dépasse de la barre).
const SLIDE_MS = +new URLSearchParams(location.search).get('slide') || 300;      // ?slide=3000 : au ralenti, pour vérifier l'animation
const EASE = 'cubic-bezier(.22,.82,.28,1)';
const TOP_EDGE = [[0, 84], [104, 84], [104, 70], [778, 70], [778, 78], [850, 78], [850, 70], [941, 70]];   // sous l'étoile, les jauges et le rubis
const NAV_Y = 1500;
// tuile active : [début, fin, haut de la tuile, début de l'icône, fin de l'icône, haut de l'icône]
const NOTCH = { shop: [0, 220, 1500, 45, 190, 1488], collection: [176, 402, 1494, 215, 370, 1464], main: [346, 598, 1494, 405, 538, 1470], clan: [541, 752, 1495, 582, 705, 1468], ranked: [712, 941, 1497, 770, 905, 1465] };
// Sous cette icône, chaque panneau montre une pastille de décor reconstruit (assets/ui/navpatch_*.webp) : l'icône ne glisse pas avec la page
const patchBox = (t) => { const [a, b, , , , iy] = NOTCH[t], x = Math.max(0, a - 6), y = iy - 6; return { left: x + 'px', top: y + 'px', width: (Math.min(941, b + 6) - x) + 'px', height: (NAV_Y - y) + 'px' }; };
function clipFor(t) {
  const [a, b, ty, c, d, iy] = NOTCH[t];
  const pts = [...TOP_EDGE, [941, NAV_Y], [b, NAV_Y], [b, ty], [d, ty], [d, iy], [c, iy], [c, ty], [a, ty], [a, NAV_Y], [0, NAV_Y]];
  return 'polygon(' + pts.map(([x, y]) => x + 'px ' + y + 'px').join(',') + ')';
}

let cur = null;        // panneau de la page active { el, pg, tab }
let side = null;       // panneau voisin pendant un glissement { el, pg, tab, dir }
let leaving = null;    // panneau qui sort pendant l'animation
let timer = 0;

function mount(t) {
  const pg = h('div', { class: 'pg' });
  const el = h('div', { class: 'pane' }, h('div', { class: 'pbg', style: { backgroundImage: `url('assets/bg/${t}.webp')` } }),
    h('div', { class: 'ppatch', style: { ...patchBox(t), backgroundImage: `url('assets/ui/navpatch_${t}.webp')` } }), pg);
  pages[t] && pages[t](pg);
  $('slider').append(el);
  return { el, pg, tab: t };
}
const place = (p, x, anim) => { p.el.style.transition = anim ? `transform ${SLIDE_MS}ms ${EASE}` : 'none'; p.el.style.transform = x ? `translate3d(${x}px,0,0)` : 'none'; };
// Les éléments marqués « fixed » (pastilles posées sur la barre du bas) ne glissent pas avec la page
function liftFixed() {
  const box = $('pageFixed'); box.textContent = '';
  if (cur) cur.pg.querySelectorAll('.fixed').forEach((el) => box.append(el));
}
// Barres fixes : fond de la page active, zones cliquables de la barre du bas, découpe de la zone qui glisse
function chrome(t) {
  const url = 'assets/bg/' + t + '.webp';
  $('menuBg').style.backgroundImage = `url('${url}')`; setBackdrop(url);
  $('slider').style.clipPath = clipFor(t);
  const nav = $('nav'); nav.textContent = '';
  NAV[t].forEach(([x0, x1], i) => nav.append(h('button', { class: 'hit', 'aria-label': TABS[i], style: { left: x0 + 'px', top: '0', width: (x1 - x0) + 'px', height: '172px' }, onclick: () => go(TABS[i]) })));
}
// Termine tout de suite une animation en cours
function settle() {
  clearTimeout(timer); timer = 0;
  if (leaving) { leaving.el.remove(); leaving = null; }
  if (side) { side.el.remove(); side = null; }
  if (cur) place(cur, 0);
}
function showSide(t, dir) {
  if (side && side.tab === t) return;
  if (side) side.el.remove();
  side = mount(t); side.dir = dir; place(side, dir * W);
}
// La page voisine devient la page active et finit de glisser en place
function commit() {
  const from = cur, to = side; side = null;
  from.pg.removeAttribute('id'); to.pg.id = 'page';
  cur = to; leaving = from; tab = to.tab;
  chrome(tab); liftFixed(); refreshTop();
  void to.el.offsetWidth;                       // la position de départ est prise en compte avant l'animation
  place(from, -to.dir * W, true); place(to, 0, true);
  clearTimeout(timer); timer = setTimeout(settle, SLIDE_MS + 40);
}
// Le glissement est abandonné : tout revient à sa place
function cancel() {
  place(cur, 0, true);
  if (side) place(side, side.dir * W, true);
  clearTimeout(timer); timer = setTimeout(settle, SLIDE_MS + 40);
}

export function render() {
  if (!cur) return;
  cur.pg.textContent = '';
  pages[tab] && pages[tab](cur.pg);
  liftFixed(); refreshTop();
}

// Va sur une page. Sans « silent », la page arrive en glissant depuis son côté de la barre du bas.
export function go(t, silent) {
  if (!pages[t]) return;
  settle();
  if (cur && t === tab) { render(); return; }
  if (silent || !cur || $('scrMenu').hidden) {
    if (cur) cur.el.remove();
    tab = t; cur = mount(t); cur.pg.id = 'page';
    chrome(t); liftFixed(); refreshTop();
    return;
  }
  sfx.click();
  showSide(t, TABS.indexOf(t) > TABS.indexOf(tab) ? 1 : -1);
  commit();
}

export function showMenu(t = 'main') {
  $('scrLoading').hidden = true; $('scrBattle').hidden = true; $('scrMenu').hidden = false;
  go(t, true);
}

// ---------- changer de page au doigt ----------
let g = null, lastSwipe = 0;
function bindSwipe() {
  const scr = $('scrMenu');
  scr.addEventListener('pointerdown', (e) => {
    if (g || !cur || !e.isPrimary || e.button > 0) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, base: 0, dx: 0, px: e.clientX, pt: performance.now(), v: 0 };
  });
  scr.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = (e.clientX - g.x) / view.scale, dy = (e.clientY - g.y) / view.scale;
    if (!g.drag) {
      if (Math.abs(dy) > 26 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }     // geste vertical : on fait défiler une liste, pas les pages
      if (Math.abs(dx) < 18 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      g.drag = true; g.base = dx; settle();
      try { scr.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
    }
    const now = performance.now();
    if (now > g.pt) { g.v = 0.6 * g.v + 0.4 * ((e.clientX - g.px) / view.scale) / (now - g.pt); g.px = e.clientX; g.pt = now; }
    let d = dx - g.base;
    const dir = d < 0 ? 1 : -1, next = TABS[TABS.indexOf(tab) + dir];
    if (next) showSide(next, dir); else { d *= 0.22; if (side) { side.el.remove(); side = null; } }   // au bout de la rangée : la page résiste
    g.dx = d;
    place(cur, d); if (side) place(side, d + side.dir * W);
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const was = g; g = null;
    if (!was.drag) return;
    lastSwipe = performance.now();
    const far = Math.abs(was.dx) > W * 0.2, flick = Math.abs(was.v) > 0.45 && Math.abs(was.dx) > 36 && (was.v < 0) === (was.dx < 0);
    if (side && e.type !== 'pointercancel' && (far || flick)) { sfx.whoosh(); commit(); } else cancel();
  };
  scr.addEventListener('pointerup', end); scr.addEventListener('pointercancel', end);
  // un glissement qui commence sur un bouton ne doit pas l'activer
  scr.addEventListener('click', (e) => { if (performance.now() - lastSwipe < 60) { e.stopPropagation(); e.preventDefault(); } }, true);
  // au clavier (ordinateur) : flèches gauche et droite
  addEventListener('keydown', (e) => {
    if ($('scrMenu').hidden || $('modals').childElementCount || !cur) return;
    const next = e.key === 'ArrowRight' ? TABS[TABS.indexOf(tab) + 1] : e.key === 'ArrowLeft' ? TABS[TABS.indexOf(tab) - 1] : null;
    if (next) go(next);
  });
}
bindSwipe();

$('topbar').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) { sfx.click(); actions[b.dataset.act](); } });
onChange(() => { if (!$('scrMenu').hidden) render(); });
