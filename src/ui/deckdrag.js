// Composer son deck en glissant les cartes. On pose le doigt sur une carte un court instant : elle se soulève et suit le
// doigt. Au-dessus du deck, les cartes s'écartent pour lui faire une place (ou celle qu'elle remplace s'efface si le deck
// est plein) ; sortie du deck, une carte le quitte. Au lâcher, la carte vole jusqu'à sa place et tout le monde glisse
// vers la sienne. Un toucher bref ouvre toujours la fiche, un geste vertical fait toujours défiler la liste.
import { $, h, clamp } from '../core/utils.js';
import { S } from '../core/save.js';
import { play, sfx } from '../core/audio.js';
import { DECK_SIZE } from '../data/cards.js';
import { setDeck } from '../game/progress.js';
import { view } from './stage.js';
import { cancelSwipe } from './menu.js';
import { toast } from './ui.js';

const HOLD = 150;            // ms d'appui avant que la carte se soulève (au doigt)
const EASE = 'cubic-bezier(.2,.9,.3,1.12)';
let P = null;                // doigt posé sur une carte, pas encore soulevée
let D = null;                // carte en cours de glissement
let cur = null;              // la liste affichée
let keepScroll = 0;          // défilement de la liste, gardé d'un affichage à l'autre
let blockUntil = 0;          // juste après un glissement, le toucher qui le termine n'ouvre pas de fiche
let afterRender = null;      // suite du lâcher, une fois la page redessinée

export const dragBusy = () => !!D || performance.now() < blockUntil;
const layer = () => $('dragLayer') || $('stage').appendChild(h('div', { id: 'dragLayer' }));
const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* pas de vibreur */ } };
const toStage = (r) => ({ x: (r.left - view.x) / view.scale, y: (r.top - view.y) / view.scale, w: r.width / view.scale, h: r.height / view.scale });
const cells = (list) => [...list.querySelectorAll('.cc[data-id]')];

// À appeler à chaque affichage de la page collection
export function bindDeckDrag(list) {
  if (D && !D.committing) abort();
  cur = list;
  const restore = () => { if (list.isConnected) list.scrollTop = keepScroll; };
  restore(); requestAnimationFrame(restore);
  list.addEventListener('scroll', () => { if (cur === list) keepScroll = list.scrollTop; }, { passive: true });
  list.addEventListener('pointerdown', (e) => down(e, list));
  list.addEventListener('pointermove', move);
  list.addEventListener('pointerup', up); list.addEventListener('pointercancel', cancel);
  list.addEventListener('touchmove', (e) => { if (D) e.preventDefault(); }, { passive: false });     // la liste ne défile pas sous une carte soulevée
  list.addEventListener('contextmenu', (e) => { if (P || D) e.preventDefault(); });
  if (afterRender) { const fn = afterRender; afterRender = null; fn(list); }
}

function down(e, list) {
  if (P || D || !e.isPrimary || e.button > 0) return;
  const el = e.target.closest && e.target.closest('.cc[data-id]');
  if (!el || el.classList.contains('locked') || !list.contains(el)) return;
  P = { id: el.dataset.id, el, list, pid: e.pointerId, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse', timer: 0 };
  if (!P.mouse) { el.classList.add('held'); P.timer = setTimeout(() => { if (P) pickup(P.x, P.y); }, HOLD); }
}
function clearP() { if (!P) return; clearTimeout(P.timer); P.el.classList.remove('held'); P = null; }

function move(e) {
  if (D) { if (e.pointerId === D.pid) { D.px = e.clientX; D.py = e.clientY; } return; }
  if (!P || e.pointerId !== P.pid) return;
  const far = Math.hypot(e.clientX - P.x, e.clientY - P.y);
  if (P.mouse) { if (far > 5) pickup(e.clientX, e.clientY); return; }
  if (far > 9) clearP();          // le doigt est parti avant que la carte se soulève : c'est un défilement ou un changement de page
}
function up(e) {
  if (D) { if (e.pointerId === D.pid) drop(); return; }
  if (P && e.pointerId === P.pid) clearP();
}
function cancel(e) {
  if (D) { if (e.pointerId === D.pid) { D.plan = null; drop(true); } return; }
  if (P && e.pointerId === P.pid) clearP();
}

// Filet de sécurité : si le lâcher n'arrive pas jusqu'à la liste (doigt relevé ailleurs, fenêtre quittée), la carte ne reste jamais en l'air
addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
addEventListener('blur', () => { clearP(); if (D && !D.committing) { D.plan = null; drop(true); } });

// ---------- la carte se soulève ----------
function pickup(px, py) {
  const { id, el, list, pid } = P; clearTimeout(P.timer); el.classList.remove('held'); P = null;
  const grid = list.querySelector('.co-grid.deck'); if (!grid || !el.isConnected) return;
  cancelSwipe();
  try { list.setPointerCapture(pid); } catch (er) { /* rien */ }
  const r = el.getBoundingClientRect(), g = grid.getBoundingClientRect(), sc = view.scale, st = toStage(r);
  const ghost = el.cloneNode(true); ghost.classList.remove('held', 'up'); ghost.classList.add('drag-ghost'); ghost.removeAttribute('data-id');
  ghost.style.width = st.w + 'px';
  layer().append(ghost);
  const deck = S.deck.slice(), src = deck.includes(id) ? 'deck' : 'col';
  D = {
    id, el, list, grid, pid, ghost, deck, src, plan: null, key: '', committing: false,
    px, py, ox: px - r.left, oy: py - r.top + 14 * sc,             // la carte reste sous le doigt là où on l'a prise, un peu remontée
    gx: st.x, gy: st.y, vx: 0, tilt: 0, s: 1, w: st.w, h: st.h, last: performance.now(), raf: 0,
    slots: [...grid.children].slice(0, DECK_SIZE).map((c) => { const b = c.getBoundingClientRect(); return { x: (b.left - g.left) / sc, y: (b.top - g.top) / sc, w: b.width / sc, h: b.height / sc }; }),
    mark: h('div', { class: 'drop-slot' }, h('span', { class: 't' }, '+')),
  };
  D.mark.hidden = true; grid.append(D.mark);
  el.classList.add('drag-src'); list.classList.add('dragging');
  play('card_flip', { v: 0.45, rate: 1.3 }); buzz(12);
  D.raf = requestAnimationFrame(loop);
}

// ---------- pendant le glissement ----------
function loop(now) {
  if (!D || D.committing) return;
  if (!D.list.isConnected) { abort(); return; }            // on a quitté la page en tenant une carte
  D.raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - D.last) / 1000); D.last = now;
  const sc = view.scale, lr = D.list.getBoundingClientRect();
  // la liste défile toute seule quand la carte approche de son bord haut ou bas
  const zone = 130 * sc, top = lr.top + zone - D.py, bot = D.py - (lr.bottom - zone);
  if (top > 0) D.list.scrollTop -= clamp(top / zone, 0, 1.4) * 900 * dt; else if (bot > 0) D.list.scrollTop += clamp(bot / zone, 0, 1.4) * 900 * dt;
  // la carte suit le doigt, penchée dans le sens du mouvement
  const tx = (D.px - D.ox - view.x) / sc, ty = (D.py - D.oy - view.y) / sc, f = 1 - Math.exp(-dt * 38), x0 = D.gx;
  D.gx += (tx - D.gx) * f; D.gy += (ty - D.gy) * f;
  D.vx += ((D.gx - x0) / Math.max(dt, 0.001) - D.vx) * (1 - Math.exp(-dt * 14));
  D.tilt += (clamp(D.vx * 0.012, -13, 13) - D.tilt) * (1 - Math.exp(-dt * 12));
  D.s += (1.12 - D.s) * (1 - Math.exp(-dt * 20));
  D.ghost.style.transform = `translate3d(${D.gx}px,${D.gy}px,0) rotate(${D.tilt}deg) scale(${D.s})`;
  // où tomberait la carte ?
  const g = D.grid.getBoundingClientRect(), cx = D.gx * sc + view.x + D.w * sc / 2, cy = D.gy * sc + view.y + D.h * sc * 0.42, m = 34 * sc;
  const inDeck = cx > g.left - m && cx < g.right + m && cy > g.top - m && cy < g.bottom + m && cy > lr.top - m && cy < lr.bottom + m;
  let plan = null, out = null, at = -1;
  if (inDeck) {
    const full = D.deck.length >= DECK_SIZE, max = D.src === 'deck' ? D.deck.length - 1 : full ? DECK_SIZE - 1 : D.deck.length;
    let best = 1e9;
    D.slots.forEach((s, i) => { const d = Math.hypot(g.left + (s.x + s.w / 2) * sc - cx, g.top + (s.y + s.h * 0.42) * sc - cy); if (d < best) { best = d; at = i; } });
    at = Math.min(at, max);            // au-dessus d'une case vide : à la suite des cartes
    if (D.src === 'deck') { plan = D.deck.filter((x) => x !== D.id); plan.splice(at, 0, D.id); }
    else if (full) { out = D.deck[at]; plan = D.deck.slice(); plan[at] = D.id; }
    else { plan = D.deck.slice(); plan.splice(at, 0, D.id); }
  } else if (D.src === 'deck' && D.deck.length > 1) plan = D.deck.filter((x) => x !== D.id);       // sortie du deck : elle le quitte
  const key = plan ? plan.join() : '';
  if (key !== D.key) { if (D.key !== '' || key !== D.deck.join()) play('tick', { v: 0.22, rate: 1.25 }); D.key = key; D.plan = plan; D.out = out; preview(); }
}

// Les cartes du deck se rangent comme elles le seront après le lâcher ; un cadre marque la place de la carte tenue
function preview() {
  const { plan, deck, slots, grid, list, id, mark } = D;
  const kids = [...grid.children].slice(0, DECK_SIZE);
  kids.forEach((c, i) => {
    const cid = c.dataset.id; c.classList.remove('leaving', 'covered'); c.style.transform = ''; c.style.zIndex = '';
    if (!cid) { if (plan && i < plan.length) c.classList.add('covered'); return; }          // une case vide qui va être prise
    if (cid === id || !plan) return;
    const j = plan.indexOf(cid);
    if (j < 0) { c.classList.add('leaving'); return; }
    if (j !== i && slots[j]) { c.style.transform = `translate(${slots[j].x - slots[i].x}px,${slots[j].y - slots[i].y}px)`; c.style.zIndex = '1'; }
  });
  const leaves = !!plan && !plan.includes(id), k = !plan ? (D.src === 'deck' ? deck.indexOf(id) : -1) : leaves ? plan.length : plan.indexOf(id), s = slots[k];
  mark.hidden = !s; mark.classList.toggle('out', leaves || !plan);
  if (s) Object.assign(mark.style, { left: s.x - grid.clientLeft + 'px', top: s.y - grid.clientTop + 'px', width: s.w + 'px', height: s.w * 1.375 + 'px' });
  grid.classList.toggle('drop-hot', !!plan && !leaves);
  list.classList.toggle('drop-out', leaves);
}
function clearPreview() {
  const { grid, list, mark } = D;
  [...grid.children].forEach((c) => { c.classList.remove('leaving', 'covered'); c.style.transform = ''; c.style.zIndex = ''; });
  mark.remove(); grid.classList.remove('drop-hot'); list.classList.remove('drop-out');
  setTimeout(() => list.classList.remove('dragging'), 260);        // le temps que les cartes reprennent leur place en douceur
}

// ---------- lâcher ----------
function drop(cancelled) {
  const d = D; cancelAnimationFrame(d.raf);
  try { d.list.releasePointerCapture(d.pid); } catch (er) { /* rien */ }
  blockUntil = performance.now() + 380;
  const changed = d.plan && d.plan.join() !== d.deck.join();
  if (!changed) {            // rien ne change : la carte retourne d'où elle vient
    if (!cancelled && d.src === 'deck' && !d.plan && d.deck.length <= 1) { sfx.error(); toast('Ton deck doit garder au moins une carte.'); }
    clearPreview(); D = null;
    flyTo(d.ghost, d, d.el.isConnected ? toStage(d.el.getBoundingClientRect()) : null, () => { d.el.classList.remove('drag-src'); }, 230);
    return;
  }
  // l'état d'avant : où chaque carte se trouve à l'écran (rangement provisoire compris)
  d.committing = true;
  const first = new Map(); cells(d.list).forEach((c) => first.set(c.dataset.id, c.getBoundingClientRect()));
  const joins = d.plan.includes(d.id), out = d.out;
  keepScroll = d.list.scrollTop;
  afterRender = (list) => {
    const sc = view.scale;
    for (const c of cells(list)) {
      const a = first.get(c.dataset.id), cid = c.dataset.id; if (!a) continue;
      if (cid === d.id) { land(c, d, joins); continue; }
      const b = c.getBoundingClientRect(), dx = (a.left - b.left) / sc, dy = (a.top - b.top) / sc;
      if (Math.abs(dx) + Math.abs(dy) < 1.5 && cid !== out) continue;
      c.style.zIndex = '2';
      const an = c.animate([{ transform: `translate(${dx}px,${dy}px)${cid === out ? ' scale(.86)' : ''}`, opacity: cid === out ? 0.6 : 1 }, { transform: 'none', opacity: 1 }], { duration: cid === out ? 380 : 280, easing: EASE });
      an.onfinish = an.oncancel = () => { c.style.zIndex = ''; };
    }
  };
  D = null;
  setDeck(d.plan);            // la page est redessinée, puis afterRender anime le passage de l'ancien rangement au nouveau
  if (afterRender) { afterRender = null; d.ghost.remove(); }      // (page non redessinée : rien à animer)
}
// La carte tenue rejoint sa nouvelle place, qui l'attend cachée
function land(c, d, joins) {
  c.style.visibility = 'hidden';
  const b = c.getBoundingClientRect(), lr = (cur || c).getBoundingClientRect(), to = toStage(b);
  if (b.top > lr.bottom - 30 * view.scale || b.bottom < lr.top + 30 * view.scale) {       // sa place est hors de vue : elle file vers le bord et s'efface
    to.y = (clamp(b.top, lr.top - b.height * 0.5, lr.bottom - b.height * 0.5) - view.y) / view.scale; to.fade = true;
  }
  flyTo(d.ghost, d, to, () => {
    c.style.visibility = ''; c.classList.add('landed'); setTimeout(() => c.classList.remove('landed'), 420);
    const card = c.querySelector('.cc-card'); if (card) { const ring = h('i', { class: 'land-ring' + (joins ? '' : ' out') }); card.append(ring); setTimeout(() => ring.remove(), 460); }
    if (joins) { sfx.place(); buzz(10); } else sfx.back();
  }, 210);
}
function flyTo(ghost, d, to, done, ms) {
  if (!to) { ghost.remove(); done(); return; }
  const an = ghost.animate([{ transform: `translate3d(${d.gx}px,${d.gy}px,0) rotate(${d.tilt}deg) scale(${d.s})` }, { transform: `translate3d(${to.x}px,${to.y}px,0) rotate(0deg) scale(${to.fade ? 0.7 : 1})`, opacity: to.fade ? 0 : 1 }], { duration: ms, easing: 'cubic-bezier(.3,1.25,.5,1)', fill: 'forwards' });
  let ended = false; const end = () => { if (ended) return; ended = true; ghost.remove(); done(); };
  an.onfinish = end; an.oncancel = end; setTimeout(end, ms + 120);
}
// La page a été redessinée pour une autre raison pendant qu'on tenait une carte : on la repose sans rien changer
function abort() {
  const d = D; D = null; cancelAnimationFrame(d.raf); d.ghost.remove(); if (d.mark) d.mark.remove();
  blockUntil = performance.now() + 200;
}
