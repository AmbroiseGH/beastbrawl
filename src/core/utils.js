// Petits outils partagés.
export const $ = (id) => document.getElementById(id);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const DEBUG = new URLSearchParams(location.search).has('debug');
export const TEST = new URLSearchParams(location.search).has('test');   // tests automatiques : pas d'écran du studio, pas d'attente

// Crée un élément : h('div', { class: 'x', onclick: fn, style: {...} }, enfant, enfant…)
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

// 12345 → « 12 345 » ; les grands nombres deviennent « 125 k », « 1,2 M » quand la place manque
export const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function fmtShort(n) {
  n = Math.round(n);
  if (n < 100000) return fmt(n);
  if (n < 1000000) return Math.floor(n / 1000) + ' k';
  return (Math.floor(n / 100000) / 10).toString().replace('.', ',') + ' M';
}
export const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const uid = (n = 10) => { const c = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

// Compte de a à b dans un élément (récompenses qui défilent)
export function countTo(el, from, to, ms = 700, f = fmt) {
  const t0 = performance.now();
  return new Promise((res) => {
    const tick = (t) => {
      const k = clamp((t - t0) / ms, 0, 1), e = 1 - (1 - k) * (1 - k);
      el.textContent = f(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick); else { el.textContent = f(to); res(); }
    };
    requestAnimationFrame(tick);
  });
}
