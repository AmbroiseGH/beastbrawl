// Les menus : barre du haut (niveau, pièces, pattes, rubis), barre du bas, et les pages entre les deux.
// Les cinq pages sont rangées côte à côte, dans l'ordre de la barre du bas. On passe de l'une à l'autre en faisant
// glisser la rangée, au doigt ou en touchant la barre du bas : les deux barres restent fixes.
import { $, h, fmt, fmtShort, clamp } from '../core/utils.js';
import { S, onChange } from '../core/save.js';
import { sfx } from '../core/audio.js';
import { IMG } from '../core/assets.js';
import { xpNeed } from '../data/economy.js';
import { W, H, view, onResize, setBackdrop, warmBackdrop } from './stage.js';

export const TABS = ['shop', 'collection', 'main', 'clan', 'ranked'];   // de gauche à droite, comme dans la barre du bas
const BGKEY = { shop: 'bgShop', collection: 'bgCollection', main: 'bgMain', clan: 'bgClan', ranked: 'bgRanked' };
// zones cliquables de la barre du bas (x de début et de fin de chaque tuile), selon l'onglet actif
const NAV = {
  main: [[0, 178], [182, 345], [348, 596], [600, 760], [765, 941]],
  shop: [[0, 218], [222, 392], [396, 578], [582, 756], [760, 941]],
  collection: [[0, 176], [178, 400], [404, 582], [586, 758], [762, 941]],
  clan: [[0, 178], [182, 345], [350, 540], [543, 750], [755, 941]],
  ranked: [[0, 178], [182, 347], [349, 535], [535, 713], [713, 941]],
};
const pages = {};          // nom → fonction(page) qui dessine les textes et les boutons de la page
const actions = {};        // boutons de la barre du haut
let tab = 'main';          // la page active
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

// ---------- le décor ----------
// Les fonds des cinq pages (les maquettes, avec les deux barres) sont dessinés sur un seul canvas, à partir d'images
// décodées une fois pour toutes pendant le chargement. Pendant un glissement, rien n'est créé ni chargé : chaque image
// affichée est complète, il ne peut pas y avoir d'écran vide entre deux pages.
const cv = $('menuCv'), ctx = cv.getContext('2d', { alpha: false });
let K = 1;                                          // pixels du canvas par unité de scène
const TOP_EDGE = [[0, 84], [104, 84], [104, 70], [778, 70], [778, 78], [850, 78], [850, 70], [941, 70]];   // bas de la barre du haut : sous l'étoile, les jauges et le rubis
const NAV_Y = 1500;                                 // haut de la barre du bas
// L'icône de l'onglet actif dépasse de la barre du bas et mord sur la page. Pour que la page glisse dessous, trois
// petites images par onglet, dans le même cadre [x, y, largeur, hauteur] (fabriquées par build_navcap.py) :
// navcap_* l'icône détourée, navfill_* le décor reconstruit dessous, navring_* l'icône avec son liseré de décor.
const ICON = { shop: [53, 1487, 115, 13], collection: [178, 1463, 220, 37], main: [345, 1467, 253, 33], clan: [544, 1464, 204, 36], ranked: [748, 1461, 160, 39] };
const RING_PX = 28;                                 // l'icône retrouve son liseré quand sa page est à moins de 28 px de sa place
const SRC = {};                                     // onglet → { bg, cap, ring, patch } : les images décodées, à leur taille d'origine
let FIT = null;                                     // les mêmes, mises une fois pour toutes à la taille du canvas : { k, bg, cap, ring, patch, box }

const ready = (im) => !!im && im.width > 0;
function sizeCanvas() {
  const k = clamp(view.scale * (window.devicePixelRatio || 1), 0.2, 1);       // un pixel du canvas par pixel de l'écran, sans dépasser la taille des maquettes
  const w = Math.round(W * k), hh = Math.round(H * k);
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  K = cv.width / W; ctx.imageSmoothingQuality = 'high';
}
// Met le décor à la taille exacte du canvas : au repos comme en mouvement, chaque image est recopiée pixel pour pixel
async function fitImages() {
  const w = cv.width, hh = cv.height, k = w / W;
  if (FIT && FIT.k === k) return;
  const bgs = await Promise.all(TABS.map(async (t) => {
    const im = SRC[t].bg;
    try { if (w < W && ready(im) && window.createImageBitmap) return await createImageBitmap(im, { resizeWidth: w, resizeHeight: hh, resizeQuality: 'low' }); } catch (e) { /* on garde l'image d'origine */ }
    return im;
  }));
  if (cv.width !== w || cv.height !== hh) return;   // l'écran a encore changé de taille entre-temps : un autre réglage suit
  const fit = { k, bg: {}, cap: {}, ring: {}, patch: {}, box: {} };
  TABS.forEach((t, i) => {
    const { cap, ring, patch } = SRC[t], bg = bgs[i], [px, py, pw, ph] = ICON[t];
    const bx = Math.floor(px * k), by = Math.floor(py * k), bw = Math.ceil((px + pw) * k) - bx, bh = Math.ceil((py + ph) * k) - by;
    // un morceau du cadre de l'icône : « base » (le décor ou sa version reconstruite) découpé selon la transparence de « shape »
    const piece = (base, shape) => {
      const c = document.createElement('canvas'); c.width = bw; c.height = bh;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      if (!ready(base) || !ready(shape)) return c;
      if (base === bg) x.drawImage(bg, -bx, -by, w, hh); else x.drawImage(base, px * k - bx, py * k - by, pw * k, ph * k);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(shape, px * k - bx, py * k - by, pw * k, ph * k);
      return c;
    };
    fit.bg[t] = bg; fit.box[t] = [bx, by, bw, bh];
    fit.cap[t] = piece(bg, cap); fit.ring[t] = piece(bg, ring); fit.patch[t] = piece(patch, ring);
  });
  const stale = FIT; FIT = fit;
  if (stale) TABS.forEach((t) => { const im = stale.bg[t]; if (im !== SRC[t].bg && im !== fit.bg[t] && im.close) im.close(); });   // anciennes images réduites
  if (panes[tab]) layout();
}
// Décode les images du décor (à appeler une fois, après le chargement et avant d'afficher les menus)
export async function prepare() {
  const bitmap = async (im) => { try { if (ready(im) && window.createImageBitmap) return await createImageBitmap(im); } catch (e) { /* on garde l'image d'origine */ } return im; };
  await Promise.all(TABS.map(async (t) => {
    const [bg, cap, ring, patch] = await Promise.all([IMG[BGKEY[t]], IMG['navcap_' + t], IMG['navring_' + t], IMG['navfill_' + t]].map(bitmap));
    SRC[t] = { bg, cap, ring, patch };
  }));
  warmBackdrop(TABS.map((t) => IMG[BGKEY[t]]));
  sizeCanvas();
  await fitImages();
  // chaque décor est dessiné une première fois ici, sous l'écran de chargement, pour être déjà prêt au premier glissement
  if (FIT) TABS.forEach((t, i) => { if (ready(FIT.bg[t])) ctx.drawImage(FIT.bg[t], i * cv.width / TABS.length, 0, cv.width / TABS.length, cv.height); });
}
// Décalage, en pixels du canvas, de la page n° i (toujours un nombre entier : le décor reste net pendant qu'il glisse)
const shift = (i) => Math.round((i - pos) * cv.width);
function paint() {
  const idx = TABS.indexOf(tab), w = cv.width, hh = cv.height;
  if (!FIT || !ready(FIT.bg[tab])) { ctx.fillStyle = '#0b1430'; ctx.fillRect(0, 0, w, hh); return; }
  ctx.drawImage(FIT.bg[tab], 0, 0, w, hh);
  if (pos === idx) return;                          // la rangée est posée : la maquette de la page active, telle quelle
  const s = K / FIT.k;                              // vaut 1, sauf pendant un changement de taille de l'écran
  const icon = (img, t, x) => { const [bx, by, bw, bh] = FIT.box[t]; ctx.drawImage(img, x + bx * s, by * s, bw * s, bh * s); };
  // entre les deux barres : les pages qui traversent l'écran, sans l'icône de leur propre onglet
  ctx.save(); ctx.beginPath();
  TOP_EDGE.forEach(([x, y], i) => (i ? ctx.lineTo(x * K, y * K) : ctx.moveTo(x * K, y * K)));
  ctx.lineTo(w, NAV_Y * K); ctx.lineTo(0, NAV_Y * K); ctx.closePath(); ctx.clip();
  const i0 = Math.floor(pos);
  for (const i of [i0, i0 + 1]) {
    const t = TABS[i]; if (!t || !ready(FIT.bg[t])) continue;
    ctx.drawImage(FIT.bg[t], shift(i), 0, w, hh); icon(FIT.patch[t], t, shift(i));
  }
  ctx.restore();
  // par-dessus : l'icône de l'onglet actif, fixe
  const near = clamp(1 - (Math.abs(pos - idx) * W - 1) / RING_PX, 0, 1);
  if (near > 0) { ctx.globalAlpha = near; icon(FIT.ring[tab], tab, 0); ctx.globalAlpha = 1; }
  icon(FIT.cap[tab], tab, 0);
}

// ---------- la rangée de pages ----------
const SLOW = (+new URLSearchParams(location.search).get('slide') || 300) / 300;   // ?slide=3000 : dix fois plus lent, pour vérifier le glissement
const panes = {};          // onglet → { el, pg } : les pages affichées (la page active, et pendant un glissement celles qui traversent l'écran)
let pos = TABS.indexOf(tab);   // position de la rangée, en pages : 0 = boutique … 4 = classé, entre deux pendant un glissement
let vel = 0;               // vitesse de la rangée, en pages par seconde
let omega = 30;            // raideur du ressort qui amène la rangée sur la page active
let raf = 0, lastT = 0, shown = -1;   // shown : position de la rangée au dernier dessin
let g = null;              // le geste en cours (doigt posé)
const dragging = () => !!g && g.drag;

function fill(t) { const p = panes[t]; p.pg.textContent = ''; pages[t] && pages[t](p.pg); }
function mount(t) {
  if (!panes[t]) {
    const pg = h('div', { class: 'pg' }), el = h('div', { class: 'pane', 'data-tab': t }, pg);
    panes[t] = { el, pg }; fill(t);
    el.style.transform = `translate3d(${shift(TABS.indexOf(t)) / K}px,0,0)`;
    $('slider').append(el);
  }
  return panes[t];
}
function unmount(t) { if (panes[t]) { panes[t].el.remove(); delete panes[t]; } }
// Les éléments marqués « fixed » (pastilles posées sur la barre du bas) ne glissent pas : ceux de la page active sont recopiés à part
function liftFixed() {
  const p = panes[tab];
  $('pageFixed').replaceChildren(...(p ? [...p.pg.querySelectorAll('.fixed')].map((el) => el.cloneNode(true)) : []));
}
// Change de page active : barre du bas (zones cliquables, pastilles) et barre du haut
function setTab(t) {
  if (panes[tab]) panes[tab].pg.removeAttribute('id');
  tab = t; mount(t).pg.id = 'page';
  const nav = $('nav'); nav.textContent = '';
  NAV[t].forEach(([x0, x1], i) => nav.append(h('button', { class: 'hit', 'aria-label': TABS[i], style: { left: x0 + 'px', top: '0', width: (x1 - x0) + 'px', height: '172px' }, onclick: () => go(TABS[i]) })));
  liftFixed(); refreshTop();
}
// Place les pages et redessine le décor pour la position actuelle de la rangée
function layout() {
  const idx = TABS.indexOf(tab), still = pos === idx && !dragging();
  for (const t of Object.keys(panes)) {
    const i = TABS.indexOf(t);
    if (t !== tab && (still || (!dragging() && Math.abs(i - pos) >= 1))) { unmount(t); continue; }   // sortie de l'écran
    panes[t].el.style.transform = `translate3d(${shift(i) / K}px,0,0)`;
  }
  paint(); shown = pos;
  const i0 = Math.floor(pos), f = pos - i0;
  setBackdrop(IMG[BGKEY[TABS[i0]]], f > 0 ? IMG[BGKEY[TABS[i0 + 1]]] : null, f);
}
// Une image de l'animation : la rangée suit le doigt, ou rejoint la page active comme tirée par un ressort (sans rebond)
function frame(now) {
  raf = 0;
  const dt = clamp((now - lastT) / 1000, 0, 0.05) / SLOW; lastT = now;
  const idx = TABS.indexOf(tab);
  if (!dragging()) {
    const x = pos - idx, tmp = (vel + omega * x) * dt, e = Math.exp(-omega * dt);
    pos = clamp(idx + (x + tmp) * e, 0, TABS.length - 1); vel = (vel - omega * tmp) * e;
    if (Math.abs(pos - idx) * W < 0.4 && Math.abs(vel) * W < 30) { pos = idx; vel = 0; }
  }
  if (pos !== shown || !dragging()) layout();       // doigt posé sans bouger : rien à redessiner
  if (pos !== idx || dragging()) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf) { lastT = performance.now() - 16; raf = requestAnimationFrame(frame); } }

// Redessine les pages affichées (après un changement de la sauvegarde ou une réponse du serveur) ; avec « t », seulement celle-là
export function render(t) {
  for (const k of Object.keys(panes)) if (!t || k === t) fill(k);
  if (!t || t === tab) { liftFixed(); refreshTop(); }
}

// Va sur une page. Sans « silent », la rangée glisse jusqu'à elle.
export function go(t, silent) {
  if (!pages[t]) return;
  if (silent || !panes[tab] || $('scrMenu').hidden) {
    cancelAnimationFrame(raf); raf = 0; g = null;
    Object.keys(panes).forEach(unmount);
    pos = TABS.indexOf(t); vel = 0; setTab(t); layout();
    return;
  }
  if (t === tab) { if (pos === TABS.indexOf(t)) render(); return; }
  sfx.click();
  omega = 30 - 2.7 * clamp(Math.abs(TABS.indexOf(t) - pos) - 1, 0, 3);    // un peu plus posé quand on traverse plusieurs pages
  setTab(t); kick();
}

export function showMenu(t = 'main') {
  $('scrLoading').hidden = true; $('scrBattle').hidden = true; $('scrMenu').hidden = false;
  go(t, true);
}

// ---------- changer de page au doigt ----------
let lastSwipe = 0;
function bindSwipe() {
  const scr = $('scrMenu');
  scr.addEventListener('pointerdown', (e) => {
    if (dragging() || !panes[tab] || !e.isPrimary || e.button > 0) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, x0: 0, p0: 0, d: 0, px: e.clientX, pt: performance.now(), v: 0 };
  });
  scr.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = (e.clientX - g.x) / view.scale, dy = (e.clientY - g.y) / view.scale;
    if (!g.drag) {
      if (Math.abs(dy) > 26 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }     // geste vertical : on fait défiler une liste, pas les pages
      if (Math.abs(dx) < 18 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      g.drag = true; g.x0 = dx; g.p0 = pos; vel = 0;                                  // la rangée est prise là où elle se trouve, même en plein mouvement
      try { scr.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
    }
    const now = performance.now();
    if (now > g.pt) { g.v = 0.6 * g.v + 0.4 * ((e.clientX - g.px) / view.scale) / (now - g.pt); g.px = e.clientX; g.pt = now; }
    g.d = dx - g.x0;
    pos = clamp(g.p0 - g.d / W, 0, TABS.length - 1);                                  // au bout de la rangée, elle s'arrête net
    mount(TABS[Math.floor(pos)]); mount(TABS[Math.ceil(pos)]);
    kick();
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const was = g; g = null;
    if (!was.drag) return;
    lastSwipe = performance.now();
    const idx = TABS.indexOf(tab), lo = Math.floor(pos), hi = Math.ceil(pos), moved = pos - was.p0;
    const v = e.type === 'pointercancel' || performance.now() - was.pt > 90 ? 0 : -was.v * 1000 / W;      // vitesse du doigt, en pages par seconde
    let to = clamp(idx, lo, hi);
    if (e.type !== 'pointercancel') {
      if (Math.abs(v) > 0.48 && Math.abs(was.d) > 36 && (v > 0) === (moved > 0)) to = v > 0 ? hi : lo;     // coup de doigt rapide
      else if (Math.abs(moved) > 0.2) to = moved > 0 ? hi : lo;                                         // plus d'un cinquième de l'écran
    }
    if (to !== idx) { sfx.whoosh(); setTab(TABS[to]); }
    // la rangée repart à la vitesse du doigt, sans pouvoir dépasser la page visée
    const x = pos - to; omega = 30;
    vel = v * x >= 0 ? 0 : Math.sign(v) * Math.min(Math.abs(v), omega * Math.abs(x));
    kick();
  };
  scr.addEventListener('pointerup', end); scr.addEventListener('pointercancel', end);
  // un glissement qui commence sur un bouton ne doit pas l'activer
  scr.addEventListener('click', (e) => { if (performance.now() - lastSwipe < 60) { e.stopPropagation(); e.preventDefault(); } }, true);
  // au clavier (ordinateur) : flèches gauche et droite
  addEventListener('keydown', (e) => {
    if ($('scrMenu').hidden || $('modals').childElementCount || !panes[tab]) return;
    const next = e.key === 'ArrowRight' ? TABS[TABS.indexOf(tab) + 1] : e.key === 'ArrowLeft' ? TABS[TABS.indexOf(tab) - 1] : null;
    if (next) go(next);
  });
}
bindSwipe();

// Le canvas suit la taille de l'écran ; on le redessine aussi quand le jeu revient au premier plan
let fitTimer = 0;
onResize(() => { sizeCanvas(); if (panes[tab]) layout(); clearTimeout(fitTimer); if (FIT) fitTimer = setTimeout(fitImages, 120); });
addEventListener('visibilitychange', () => { if (!document.hidden && panes[tab]) layout(); });
addEventListener('pageshow', () => { if (panes[tab]) layout(); });
cv.addEventListener('contextrestored', () => { if (panes[tab]) layout(); });

$('topbar').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) { sfx.click(); actions[b.dataset.act](); } });
onChange(() => { if (!$('scrMenu').hidden) render(); });
