// La jauge d'XP de la barre du haut. Quand le joueur gagne de l'expérience (défi du jour, amélioration, combat), des
// étoiles violettes partent de l'endroit du gain et filent vers la jauge. À chaque étoile qui arrive, la jauge monte
// d'un cran avec un petit tintement, une note plus haut que le précédent. Un niveau gagné fait déborder la jauge :
// anneau, « Niveau N ! », petit arpège, puis elle repart de zéro.
// Pendant l'animation, la jauge est recopiée dans le calque #fly (au-dessus des fenêtres) : elle reste bien visible
// même quand une fenêtre assombrit le menu.
import { $, h, clamp, rand, fmt } from '../core/utils.js';
import { S } from '../core/save.js';
import { chime } from '../core/audio.js';
import { xpNeed } from '../data/economy.js';

const BAR = { x: 97, y: 23, w: 151, h: 37 }, BADGE = [57, 40];     // la jauge et l'étoile du niveau, en px de scène
const FROM = [470, 760];                                             // départ des étoiles quand on ne le précise pas

let shown = null;            // ce que la jauge affiche : { level, xp }
let from = null;             // d'où partent les étoiles du prochain gain
let hold = 0;                // > 0 : le gain attend qu'on le libère (fenêtre d'amélioration encore ouverte)
let busy = false, queued = 0;
const waiters = [];

const base = (level) => { let t = 0; for (let l = 1; l < level; l++) t += xpNeed(l); return t; };   // XP cumulée au début d'un niveau
const total = (level, xp) => base(level) + xp;
function levelAt(t) { let level = 1, b = 0; while (t >= b + xpNeed(level)) { b += xpNeed(level); level++; } return { level, xp: t - b }; }
const gainOf = () => total(S.level, S.xp) - total(shown.level, shown.xp);
const real = () => ({ lvl: $('tbLvl'), fill: $('tbXpFill'), txt: $('tbXp') });
function paint(el, level, xp) {
  const need = xpNeed(level);
  el.lvl.textContent = level;
  el.txt.textContent = fmt(Math.floor(xp + 1e-6)) + ' / ' + fmt(need);
  el.fill.style.width = (clamp(xp / need, 0, 1) * 100).toFixed(2) + '%';
}
function settle() { while (waiters.length) waiters.shift()(); }
function schedule() { if (!queued) queued = requestAnimationFrame(() => { queued = 0; run(); }); }

// Appelé à chaque rafraîchissement de la barre du haut. L'animation part à l'image suivante : l'appelant a le temps
// de dire d'où partent les étoiles (xpFrom), même si la sauvegarde a changé juste avant.
export function xpSync() {
  if (!shown || (!busy && gainOf() < 0)) { shown = { level: S.level, xp: S.xp }; paint(real(), S.level, S.xp); settle(); return; }
  if (busy) return;                          // l'animation en cours rattrapera la sauvegarde à la fin
  if (gainOf() === 0) { paint(real(), shown.level, shown.xp); settle(); return; }
  if (!hold) schedule();
}
// Point de départ des étoiles du prochain gain (px de scène)
export const xpFrom = (p) => { from = p; };
// Retient (true) puis libère (false) le prochain gain : il s'anime au moment voulu
export function xpHold(on) { hold = Math.max(0, hold + (on ? 1 : -1)); if (!hold && shown) xpSync(); }
// Se résout quand la jauge a fini de monter (on fête un niveau gagné après l'animation, pas pendant)
export function xpSettled() {
  if (!busy && !queued && !hold && (!shown || gainOf() <= 0 || $('scrMenu').hidden)) return Promise.resolve();
  return new Promise((res) => { waiters.push(res); setTimeout(res, 9000); });
}

function run() {
  if (busy || hold || !shown) return;
  const gain = gainOf();
  if (gain <= 0) { xpSync(); return; }
  if ($('scrMenu').hidden) { settle(); return; }          // en combat : on montrera le gain au retour dans le menu
  busy = true;
  const src = from || FROM; from = null;
  animate(gain, src).then(() => { busy = false; xpSync(); });
}

// Une étoile (et sa traînée) qui jaillit de p0 puis file vers p3 ; onArrive quand elle touche la jauge
function flight(layer, p0, p3, dur, delay, made, onArrive) {
  const ang = rand(-Math.PI * 0.92, -Math.PI * 0.08), r = rand(120, 230);                  // jaillit vers le haut, d'un côté ou de l'autre
  const p1 = [p0[0] + Math.cos(ang) * r, p0[1] + Math.sin(ang) * r * 0.8];
  const c1 = [p1[0] + (p1[0] - p0[0]) * 0.7, p1[1] + (p1[1] - p0[1]) * 0.7], c2 = [p3[0] + rand(70, 230), p3[1] + rand(170, 330)];
  const spin = rand(200, 420) * (Math.random() < 0.5 ? -1 : 1), SPLIT = 0.3, K = 22;
  const at = (tau) => {      // position au temps tau (0 → 1) : jaillissement qui ralentit, puis piqué qui accélère vers la jauge
    if (tau < SPLIT) { const u = 1 - Math.pow(1 - tau / SPLIT, 3); return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, 0.3 + 0.9 * u]; }
    const u = Math.pow((tau - SPLIT) / (1 - SPLIT), 1.9), v = 1 - u;
    return [v * v * v * p1[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p3[0],
      v * v * v * p1[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p3[1], 1.2 - 0.62 * u];
  };
  // l'étoile de tête, puis deux reflets plus petits et plus pâles qui la suivent : la traînée
  [[1, 1, 0], [0.5, 0.78, 45], [0.25, 0.58, 90]].forEach(([op, sc, lag], j) => {
    const el = h('div', { class: 'xp-star' + (j ? ' ghost' : ''), style: { left: p0[0] + 'px', top: p0[1] + 'px' } });
    const frames = [];
    for (let k = 0; k <= K; k++) {
      const tau = k / K, [x, y, s] = at(tau);
      frames.push({ offset: tau, opacity: tau === 0 ? 0 : tau < 0.08 ? op * tau / 0.08 : op, transform: `translate(${(x - p0[0]).toFixed(1)}px,${(y - p0[1]).toFixed(1)}px) rotate(${(spin * tau).toFixed(1)}deg) scale(${(s * sc).toFixed(3)})` });
    }
    layer.append(el); made.push(el);
    el.animate(frames, { duration: dur, delay: delay + lag, easing: 'linear', fill: 'both' }).onfinish = () => { el.remove(); if (!j) onArrive(); };
  });
}
// Petit éclat là où une étoile touche la jauge
function spark(layer, x, y, big, made) {
  const el = h('div', { class: 'xp-spark', style: { left: x + 'px', top: y + 'px' } });
  layer.append(el); made.push(el);
  const s = big ? 1.9 : 1.15;
  el.animate([{ transform: 'scale(.2) rotate(0deg)', opacity: 1 }, { transform: `scale(${s}) rotate(40deg)`, opacity: 0.9, offset: 0.35 }, { transform: `scale(${s * 1.15}) rotate(60deg)`, opacity: 0 }],
    { duration: big ? 620 : 420, easing: 'ease-out' }).onfinish = () => el.remove();
}

function animate(gain, src) {
  return new Promise((done) => {
    const layer = $('fly'), t0 = total(shown.level, shown.xp), t1 = t0 + gain;
    const n = clamp(Math.round(gain / 8), 3, 10);
    // la copie de la jauge, au-dessus des fenêtres
    const fill = h('div', { class: 'tb-xpfill' }), lvl = h('div', { class: 'tb-lvl t' }), txt = h('div', { class: 'tb-xptxt t' });
    const glow = h('div', { class: 'xp-glow' }), tip = h('div', { class: 'xp-tip' });
    const hud = h('div', { class: 'xp-hud' }, glow, h('img', { class: 'xp-art', src: 'assets/ui/xp_hud.webp?v=2', alt: '' }), h('div', { class: 'tb-xp' }, fill), tip, lvl, txt);
    const plus = h('div', { class: 'xp-plus t' }, '+' + fmt(gain), h('span', { class: 'ico xp' }));
    const clone = { lvl, fill, txt }, made = [];
    let level = shown.level, cur = t0, goal = t0, arrived = 0, pause = 0, endAt = 0, raf = 0, last = performance.now(), labelEl = null, over = false;
    const tipAt = () => { tip.style.left = (BAR.x + clamp((cur - base(level)) / xpNeed(level), 0, 1) * BAR.w).toFixed(1) + 'px'; };   // l'éclat au bout de la jauge
    paint(clone, level, cur - base(level)); tipAt();
    layer.append(hud);
    $('topbar').classList.add('xp-busy');
    const pulse = (el, a, ms) => el.animate([{ opacity: a }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });

    // les étoiles : chacune vise le bout de la jauge tel qu'il sera quand elle arrivera
    for (let i = 0; i < n; i++) {
      const p = levelAt(t0 + gain * (i + 1) / n), to = [BAR.x + clamp(p.xp / xpNeed(p.level), 0.05, 1) * BAR.w, BAR.y + BAR.h / 2];
      flight(layer, src, to, rand(860, 1000), i * 95, made, () => {
        if (over) return;
        arrived++;
        goal = arrived >= n ? t1 : Math.min(t1, t0 + gain * arrived / n);
        chime(arrived - 1);
        spark(layer, to[0], to[1], false, made);
        pulse(glow, 0.9, 480); pulse(tip, 1, 360);
        if (arrived === 1) layer.append(plus);
      });
    }

    function levelUp(nl) {
      chime(5, { v: 0.9 }); chime(7, { at: 0.07, v: 0.9 }); chime(9, { at: 0.14, v: 0.9 }); chime(10, { at: 0.22, v: 1 });
      spark(layer, BAR.x + BAR.w, BAR.y + BAR.h / 2, true, made);
      pulse(glow, 1, 900);
      const ring = h('div', { class: 'xp-ring', style: { left: BADGE[0] + 'px', top: BADGE[1] + 'px' } });
      layer.append(ring); made.push(ring);
      ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => ring.remove();
      for (let k = 0; k < 8; k++) {          // une gerbe de petites étoiles autour de l'étoile du niveau
        const an = (k / 8) * Math.PI * 2 + rand(-0.2, 0.2), d = rand(90, 150);
        const st = h('div', { class: 'xp-star small', style: { left: BADGE[0] + 'px', top: BADGE[1] + 'px' } });
        layer.append(st); made.push(st);
        st.animate([{ transform: 'translate(0,0) scale(.3)', opacity: 1 }, { transform: `translate(${Math.cos(an) * d}px,${Math.sin(an) * d * 0.8 + 20}px) rotate(${rand(-180, 180)}deg) scale(.5)`, opacity: 0 }],
          { duration: rand(550, 750), easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => st.remove();
      }
      if (labelEl) labelEl.remove();
      labelEl = h('div', { class: 'xp-lvup t' }, 'Niveau ' + nl + ' !');
      layer.append(labelEl);
    }

    function finish() {
      if (over) return;
      over = true; cancelAnimationFrame(raf);
      shown = levelAt(t1);
      paint(real(), shown.level, shown.xp);
      $('topbar').classList.remove('xp-busy');
      for (const el of [hud, plus, labelEl]) if (el && el.isConnected) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
      setTimeout(() => { for (const el of [hud, plus, labelEl, ...made]) if (el) el.remove(); }, 360);
      done();
    }

    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      if ($('scrMenu').hidden) { finish(); return; }          // on est parti en combat : la jauge prend sa valeur finale
      raf = requestAnimationFrame(frame);
      if (pause > 0) {                                        // la jauge pleine reste un instant, puis repart de zéro
        pause -= dt;
        if (pause <= 0) { level++; paint(clone, level, cur - base(level)); }
        return;
      }
      cur += (goal - cur) * (1 - Math.exp(-dt * 10));
      if (goal - cur < 0.25) cur = goal;
      const next = base(level + 1);
      if (cur >= next) { cur = next; paint(clone, level, xpNeed(level)); lvl.textContent = level + 1; lvl.classList.remove('pop'); void lvl.offsetWidth; lvl.classList.add('pop'); levelUp(level + 1); pause = 0.45; return; }
      paint(clone, level, cur - base(level));
      tipAt();
      if (arrived >= n && cur === t1 && !endAt) endAt = now + (labelEl ? 700 : 450);
      if (endAt && now >= endAt) finish();
    };
    raf = requestAnimationFrame(frame);
    setTimeout(finish, 9000);                                 // garde-fou : rien ne reste bloqué
  });
}
