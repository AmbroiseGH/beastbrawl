// Briques d'interface : fenêtres, messages brefs, objets qui volent vers un compteur.
import { $, h, wait, rand } from '../core/utils.js';
import { sfx } from '../core/audio.js';

// Ouvre une fenêtre. opts : { title, color ('red' | 'purple' | 'yellow'), body (élément ou liste), buttons, closable, wide, onClose }
// Renvoie { el, close, body }.
export function modal(opts) {
  const body = h('div', { class: 'body' }, opts.body || []);
  const panel = h('div', { class: 'panel ' + (opts.color || '') + (opts.wide ? ' wide' : '') },
    opts.title ? h('div', { class: 'title t' }, opts.title) : null, body);
  const veil = h('div', { class: 'veil' }, panel);
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; veil.remove(); opts.onClose && opts.onClose(v); };
  if (opts.closable !== false) {
    panel.append(h('button', { class: 'close', 'aria-label': 'Fermer', onclick: () => { sfx.back(); close(); } }));
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) { sfx.back(); close(); } });
  }
  if (opts.buttons && opts.buttons.length) {
    panel.append(h('div', { class: 'row' }, opts.buttons.map((b) => h('button', { class: 'btn t ' + (b.color || 'yellow') + (b.small ? ' small' : ''), onclick: () => { sfx.click(); if (!b.keep) close(b.value); b.onclick && b.onclick(); } }, b.html ? h('span', { html: b.html }) : b.label))));
  }
  $('modals').append(veil);
  return { el: panel, close, body };
}
export const p = (html, cls = '') => h('p', { class: cls, html });

export function ask(title, text, yes = 'Oui', no = 'Non') {
  return new Promise((res) => {
    modal({ title, body: [p(text)], closable: false, buttons: [{ label: no, color: 'red', value: false }, { label: yes, color: 'green', value: true }], onClose: (v) => res(!!v) });
  });
}
export function prompt(title, text, value = '', max = 14, okLabel = 'Valider') {
  return new Promise((res) => {
    const input = h('input', { class: 'field', maxlength: max, value, spellcheck: 'false', autocomplete: 'off' });
    const m = modal({ title, body: [text ? p(text) : null, input], buttons: [{ label: okLabel, color: 'green', keep: true, onclick: () => { const v = input.value.trim().replace(/\s+/g, ' '); if (v.length >= 2) m.close(v); else toast('Au moins 2 caractères'); } }], onClose: (v) => res(v || null) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = input.value.trim(); if (v.length >= 2) m.close(v); } e.stopPropagation(); });
    setTimeout(() => input.focus(), 250);
  });
}

export function toast(html) {
  const t = h('div', { class: 'toast t sm', html });
  $('toasts').append(t); setTimeout(() => t.remove(), 2500);
}

// Fait voler n icônes d'un point vers un compteur. kind : 'coin' | 'paw' | 'ruby' | 'xp' | 'trophy'
const ICON = { coin: 'cur_coin', paw: 'cur_paw', ruby: 'cur_ruby', xp: 'cur_xp', trophy: 'ic_trophy', star: 'ic_star' };
export const TARGET = { coin: [354, 40], paw: [606, 40], ruby: [818, 40], xp: [58, 40], trophy: [600, 144] };
export async function fly(kind, from, to, n = 8, onArrive) {
  const layer = $('fly'); to = to || TARGET[kind];
  for (let i = 0; i < n; i++) {
    const el = h('i', { style: { backgroundImage: `url('assets/ui/${ICON[kind]}.webp')`, left: from[0] + 'px', top: from[1] + 'px' } });
    layer.append(el);
    const mx = from[0] + rand(-110, 110), my = from[1] + rand(-120, 60);
    const anim = el.animate([
      { transform: 'translate(0,0) scale(.3)', opacity: 0 },
      { transform: `translate(${mx - from[0]}px,${my - from[1]}px) scale(1.15)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${to[0] - from[0]}px,${to[1] - from[1]}px) scale(.7)`, opacity: 1 },
    ], { duration: 620 + i * 14, delay: i * 45, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
    anim.onfinish = () => { el.remove(); onArrive && onArrive(i); };
  }
  await wait(620 + n * 59);
}

// Texte d'une récompense : « 1 500 🪙 · 10 🐾 »
export function rewardHtml(r, fmtFn = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')) {
  const out = [];
  if (r.coins) out.push(`${fmtFn(r.coins)}<i class="ico coin"></i>`);
  if (r.paws) out.push(`${fmtFn(r.paws)}<i class="ico paw"></i>`);
  if (r.rubies) out.push(`${fmtFn(r.rubies)}<i class="ico ruby"></i>`);
  if (r.xp) out.push(`${fmtFn(r.xp)}<i class="ico xp"></i>`);
  return out.join(' ');
}
