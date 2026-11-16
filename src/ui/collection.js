// Collection : le deck de 8 cartes, toutes les cartes du jeu (avec leur progression), la fiche de chaque animal
// avec un petit aperçu animé de ses attaques, l'amélioration et la composition du deck (en glissant les cartes : deckdrag.js).
import { $, h, fmt, clamp, rand, wait, TEST } from '../core/utils.js';
import { S } from '../core/save.js';
import { sfx, play } from '../core/audio.js';
import { IMG, DATA, unitAssets } from '../core/assets.js';
import { ANIMALS, ORDER, MAX_LEVEL, statsAt } from '../data/animals.js';
import { RARITY, CHESTS, upgradeCost, DECK_SIZE } from '../data/cards.js';
import { owned, levelOf, cardsOf, upgradeAnimal, upgradeReady, setDeck, offers } from '../game/progress.js';
import { register, render } from './menu.js';
import { modal, p, toast } from './ui.js';
import { celebrate, pct } from './pages.js';
import { drawUnitFrame, label } from '../render/view.js';
import { bindDeckDrag, dragBusy } from './deckdrag.js';

// ---------- la page ----------
register('collection', (pg) => {
  const n = ORDER.filter(owned).length;
  pg.append(h('div', { class: 'ctr t co-count sm', style: { left: '752px', top: '351px' }, html: `<span style="color:var(--gold)">${n}</span> / ${ORDER.length}` }));
  const deck = S.deck.filter(owned), rest = ORDER.filter((id) => !deck.includes(id));
  const avg = deck.length ? deck.reduce((t, id) => t + ANIMALS[id].cost, 0) / deck.length : 0;
  const list = h('div', { class: 'co-list' },
    h('div', { class: 'co-head' }, h('div', { class: 't sm' }, `Mon deck (${deck.length}/${DECK_SIZE})`), h('div', { class: 't xs cream', html: `Coût moyen <b class="co-aura">${avg.toFixed(1).replace('.', ',')}</b>` })),
    h('div', { class: 'co-grid deck' }, deck.map(cardCell), Array.from({ length: DECK_SIZE - deck.length }, () => h('div', { class: 'cc empty' }, h('div', { class: 'cc-card' }, h('span', { class: 't' }, '+'))))),
    h('div', { class: 'co-head' }, h('div', { class: 't sm' }, 'Collection'), h('div', { class: 't xs cream' }, 'Maintiens une carte pour la glisser')),
    h('div', { class: 'co-grid' }, rest.map(cardCell)));
  pg.append(list);
  bindDeckDrag(list);
});

// Une carte de la grille : image, coût en Aura, niveau, barre de cartes (verte quand l'amélioration est possible)
function cardCell(id) {
  const a = ANIMALS[id], has = owned(id);
  const open = () => { if (dragBusy()) return; sfx.click(); cardSheet(id); };       // (pas de fiche au lâcher d'une carte qu'on vient de glisser)
  if (!has) return h('button', { class: 'cc locked', 'aria-label': a.name, dataset: { id }, onclick: open },
    h('div', { class: 'cc-card' }, h('img', { src: `assets/cards/${id}.webp`, alt: '', draggable: 'false' }), h('i', { class: 'cc-lock' })),
    h('div', { class: 'cc-info t xs' }, 'Dans les cages'));
  const lv = levelOf(id), need = upgradeCost(id, lv), got = cardsOf(id), ready = upgradeReady(id);
  return h('button', { class: 'cc' + (ready ? ' up' : ''), 'aria-label': a.name, dataset: { id }, onclick: open },
    h('div', { class: 'cc-card' }, h('img', { src: `assets/cards/${id}.webp`, alt: '', draggable: 'false' }), h('div', { class: 'cc-cost t' }, a.cost), ready ? h('i', { class: 'cc-arrow' }) : null),
    h('div', { class: 'cc-lv t xs' }, lv >= MAX_LEVEL ? 'Niv. max' : 'Niv. ' + lv),
    h('div', { class: 'cc-bar' + (ready ? ' full' : '') }, h('b', { style: { width: (need ? Math.min(100, got / need.cards * 100) : 100) + '%' } }), h('span', { class: 't xs' }, need ? `${fmt(got)}/${fmt(need.cards)}` : 'MAX')));
}

// ---------- fiche d'un animal ----------
const SPEED = (v) => (v < 0.95 ? 'Lente' : v < 1.25 ? 'Moyenne' : v < 1.7 ? 'Rapide' : 'Très rapide');
const TARGET = { all: 'Sol et air', ground: 'Sol', buildings: 'Structures' };
const dec = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
export function cardSheet(id) {
  const a = ANIMALS[id], R = RARITY[a.rarity], has = owned(id), lv = levelOf(id), s = statsAt(id, lv), nx = has && lv < MAX_LEVEL ? statsAt(id, lv + 1) : null;
  const need = has ? upgradeCost(id, lv) : null, got = cardsOf(id), inDeck = S.deck.includes(id);
  const prev = attackPreview(id);
  const stat = (lbl, v, up) => h('div', { class: 'stat t xs' }, lbl, h('span', null, h('b', null, v), up ? h('em', null, '+' + up) : null));
  const sp = a.attacks.special;
  const body = [
    prev.el,
    h('div', { class: 'cd-tags' },
      h('span', { class: 'cd-rar t xs', style: { background: R.color } }, R.name),
      h('span', { class: 'cd-tag t xs' }, a.role),
      h('span', { class: 'cd-tag aura t xs' }, a.cost + ' d\'Aura'),
      a.count > 1 ? h('span', { class: 'cd-tag t xs' }, '×' + a.count) : null,
      has ? h('span', { class: 'cd-tag lv t xs' }, 'Niveau ' + lv) : null),
    p(a.desc, 'small'),
    h('div', { class: 'stats' },
      stat('Points de vie', fmt(s.hp), nx && fmt(nx.hp - s.hp)), stat('Dégâts', fmt(s.dmg), nx && fmt(nx.dmg - s.dmg)),
      stat('Un coup toutes les', dec(a.hitEvery) + ' s'), stat('Portée', a.range <= 1 ? 'Mêlée' : dec(a.range)),
      stat('Vitesse', SPEED(a.speed)), stat('Cible', TARGET[a.targets]),
      s.heal ? stat('Soin', fmt(s.heal), nx && fmt(nx.heal - s.heal)) : null, a.air ? stat('Déplacement', 'Vol') : null),
    h('div', { class: 'cd-talent' }, h('div', { class: 't xs gold' }, sp ? 'Spécial : ' + sp.name + (sp.every ? ` (1 coup sur ${sp.every})` : '') : 'Talent'), p(a.talent, 'small')),
  ];
  const buttons = [];
  if (!has) {
    const sold = offers().find((o) => o.id === id && !o.bought);
    const odds = Object.values(CHESTS).map((C) => C.odds[['common', 'rare', 'epic', 'legendary', 'ultimate'].indexOf(a.rarity)]);
    body.push(p(sold ? `En vente aujourd'hui dans la <span style="color:var(--gold)">boutique</span> !` : `Trouve-le dans les cages : ${pct(odds[0])} par carte dans une Cage Rustique, jusqu'à ${pct(odds[odds.length - 1])} dans une Cage Royale.`, 'small'));
  } else {
    const ratio = need ? Math.min(1, got / need.cards) : 1, full = need && got >= need.cards;
    body.push(h('div', { class: 'cd-prog' }, h('div', { class: 'cc-bar big' + (full ? ' full' : '') }, h('b', { style: { width: ratio * 100 + '%' } }), h('span', { class: 't xs' }, need ? `${fmt(got)} / ${fmt(need.cards)} cartes` : 'Niveau maximum'))));
    if (need) {
      const okC = S.coins >= need.coins;
      buttons.push({ html: full ? `Améliorer <i class="ico coin"></i>${fmt(need.coins)}` : `Encore ${fmt(need.cards - got)} cartes`, color: full ? (okC ? 'green' : 'stone') : 'stone', keep: true, onclick: () => {
        const r = upgradeAnimal(id);
        if (r === 'cartes') { sfx.error(); toast(`Il te faut ${fmt(need.cards - got)} cartes de plus. Ouvre des cages !`); return; }
        if (r === 'pieces') { sfx.error(); toast(`Il te manque ${fmt(need.coins - S.coins)}<i class="ico coin"></i>.`); return; }
        if (r === 'max' || r === 'non') return;
        m.close(); upgradeShow(id, lv, Array.isArray(r) ? r : []);
      } });
    }
    if (inDeck && S.deck.length > 1) buttons.push({ label: 'Retirer', color: 'red', small: true, onclick: () => { setDeck(S.deck.filter((x) => x !== id)); sfx.back(); toast(a.name + ' quitte ton deck'); } });
    else if (!inDeck && S.deck.length < DECK_SIZE) buttons.push({ label: 'Au deck', color: 'blue', small: true, onclick: () => { setDeck([...S.deck, id]); sfx.place(); toast(a.name + ' rejoint ton deck !'); } });
    else if (!inDeck) buttons.push({ label: 'Échanger', color: 'blue', small: true, keep: true, onclick: () => swapPicker(m, id) });
  }
  const m = modal({ title: a.name, color: { common: '', rare: 'yellow', epic: 'purple', legendary: 'yellow', ultimate: 'red' }[a.rarity], wide: true, body, buttons, onClose: prev.stop });
  m.el.classList.add('cd', 'r-' + a.rarity);
}

// Deck plein : on choisit la carte qui laisse sa place
function swapPicker(m, id) {
  const old = m.body.querySelector('.cd-swap'); if (old) { old.remove(); return; }
  const row = h('div', { class: 'cd-swap' }, h('div', { class: 't xs gold' }, 'Touche la carte à remplacer'),
    h('div', { class: 'cd-swaprow' }, S.deck.map((d) => h('button', { class: 'cd-mini', onclick: () => {
      setDeck(S.deck.map((x) => (x === d ? id : x))); sfx.place(); m.close(); toast(`${ANIMALS[id].name} remplace ${ANIMALS[d].name}`);
    } }, h('img', { src: `assets/cards/${d}.webp`, alt: ANIMALS[d].name })))));
  m.body.append(row); row.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ---------- amélioration : la carte monte de niveau, les rayons tournent, les chiffres grimpent ----------
function upgradeShow(id, from, ups) {
  const a = ANIMALS[id], R = RARITY[a.rarity], s0 = statsAt(id, from), s1 = statsAt(id, from + 1);
  const row = (lbl, x, y) => h('div', { class: 'up-row t sm' }, lbl, h('span', null, fmt(x)), h('i'), h('b', null, fmt(y)));
  const el = h('div', { class: 'upg-ov', style: { '--c': R.color, '--g': R.glow } },
    h('div', { class: 'upg-rays' }),
    h('div', { class: 'upg-card' }, h('img', { src: `assets/cards/${id}.webp`, alt: '' }), h('div', { class: 'upg-shine' })),
    h('div', { class: 'upg-lv t' }, h('span', null, 'Niveau ' + from), h('i'), h('b', null, String(from + 1))),
    h('div', { class: 'upg-stats' }, row('Points de vie', s0.hp, s1.hp), row('Dégâts', s0.dmg, s1.dmg), s0.heal ? row('Soin', s0.heal, s1.heal) : null),
    h('div', { class: 'upg-tap t xs' }, 'Touche pour continuer'));
  $('modals').append(el);
  sfx.upgrade(); play('levelup', { at: 0.55 }); play('v_' + id, { at: 0.75, v: 0.7 });
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 260); render(); for (const u of ups) celebrate('Niveau ' + u.level + ' atteint !', null, `Récompense : ${fmt(u.coins)}<i class="ico coin"></i> ${u.rubies}<i class="ico ruby"></i>`); };
  setTimeout(() => el.addEventListener('pointerdown', close), 700);
  if (TEST) setTimeout(close, 900);
}

// ---------- aperçu animé des attaques ----------
// L'animal (planche « _hd ») marche, donne son coup normal puis son coup spécial sur un mannequin d'entraînement.
const PW = 804, PH = 360;
function attackPreview(id) {
  const a = ANIMALS[id], R = RARITY[a.rarity], key = id + '_hd';
  const cv = h('canvas', { class: 'cd-prev', width: PW, height: PH });
  const ctx = cv.getContext('2d');
  const ranged = a.range > 2, gy = 318, ax = ranged ? 210 : 300, lift = a.air ? 34 : 0;
  const tx = ranged ? 660 : ax + (id === 'elephant' || id === 'gorilla' || id === 'rhino' ? 250 : 215);
  const atks = [a.attacks.normal, a.attacks.special, a.attacks.melee].filter(Boolean);
  // la suite : marche, puis chaque attaque, avec une petite pause entre deux
  const seq = [{ kind: 'walk', dur: 1.3 }];
  atks.forEach((k, i) => { seq.push({ kind: 'atk', atk: k, special: k === a.attacks.special, dur: Math.max(0.8, k.dur * 1.35) + 0.15 }); seq.push({ kind: 'idle', dur: 0.45 }); });
  const st = { i: 0, t: 0, time: 0, parts: [], proj: [], hitT: 0, wob: 0, fired: false, loops: 0, cap: '' };
  let raf = 0, last = performance.now(), alive = true, loaded = false;
  unitAssets(id, true).then(() => { loaded = true; }).catch(() => {});

  const fx = (k, x, y, o = {}) => { if (DATA.fx && DATA.fx[k]) st.parts.push({ k, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: -(o.delay || 0), life: o.life || 0.6, s0: o.s0 ?? 0.2, s1: o.s1 ?? 0.5, rot: o.rot || 0, a: o.a ?? 1, add: !!o.add }); };
  const burst = (k, x, y, n, o = {}) => { for (let i = 0; i < n; i++) { const an = rand(0, 6.283), sp = rand(o.sp0 || 80, o.sp1 || 260); fx(k, x, y, { vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g ?? 500, life: rand(0.5, 0.9), s0: o.s || 0.15, s1: (o.s || 0.15) * 0.4, rot: rand(0, 6), add: o.add }); } };
  const drawFx = (k, x, y, s, rot, al) => { const r = DATA.fx[k]; if (!r || !IMG.fx) return; ctx.globalAlpha = al; ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(IMG.fx, r[0], r[1], r[2], r[3], -r[2] * s / 2, -r[3] * s / 2, r[2] * s, r[3] * s); ctx.restore(); ctx.globalAlpha = 1; };
  const sound = (name, o) => { if (st.loops < 1) play(name, o); };   // les sons seulement au premier passage

  // ce que fait le coup quand il touche le mannequin (ou autour de l'animal)
  function impact(k, special) {
    const hx = tx, hy = gy - 110;
    if (k.guard) {      // l'orang-outan se protège la tête : rien ne le touche, rien ne part
      fx('ring_yellow', ax, gy - 10, { s0: 0.3, s1: 1.2, life: 0.7, add: true }); fx('shield', ax, gy - 160, { s0: 0.25, s1: 0.42, life: 1.1, a: 0.9 }); sound('shield', { v: 0.7, rate: 1.2 });
      return;
    }
    st.hitT = 0.25; st.wob = 1;
    sound(k.mult >= 2 || k.splash ? 'hit_heavy' : 'hit', { v: 0.6 });
    fx(k.proj ? 'burst_yellow' : (a.rarity === 'epic' || a.rarity === 'ultimate' ? 'slash_red' : 'claw_yellow'), hx, hy, { s0: 0.15, s1: 0.45, life: 0.35, add: true });
    if (k.splash) { fx('dust_ring', hx, gy - 6, { s0: 0.3, s1: 0.9 + k.splash * 0.3, life: 0.5 }); burst('rocks', hx, gy - 20, 5, { s: 0.12, up: 220 }); }
    if (k.stun) { fx('dizzy_stars', hx, gy - 225, { s0: 0.35, s1: 0.4, life: 1.2 }); sound('slam', { v: 0.5, at: 0.05 }); }
    if (k.knock) st.wob = 1.8;
    if (k.cloud) { for (let i = 0; i < 6; i++) fx('smoke_puff', hx + rand(-60, 60), gy - rand(20, 90), { s0: 0.2, s1: 0.5, life: 1.4, vy: -20, a: 0.75, delay: i * 0.05 }); fx('skull_green', hx, gy - 170, { s0: 0.08, s1: 0.16, life: 1, vy: -50 }); sound('poison', { v: 0.6 }); }
    if (k.gust) { fx('tornado', hx, gy - 90, { s0: 0.3, s1: 0.7, life: 0.7, a: 0.9 }); fx('wind_leaves', hx, gy - 90, { s0: 0.3, s1: 0.8, life: 0.6 }); sound('tornado', { v: 0.6 }); }
    if (k.water) { fx('ring_blue', hx, gy - 10, { s0: 0.3, s1: 1.4, life: 0.6, add: true }); burst('ice_burst', hx, gy - 80, 4, { s: 0.18, up: 200 }); sound('splash', { v: 0.7 }); }
    if (k.heal) { fx('ring_green', ax, gy - 10, { s0: 0.3, s1: 1.2, life: 0.7, add: true }); for (let i = 0; i < 5; i++) fx('heal_plus', ax + rand(-70, 70), gy - rand(40, 200), { s0: 0.08, s1: 0.14, life: 0.9, vy: -70, delay: i * 0.07 }); sound('heal', { v: 0.7 }); }
    if (k.buff) { fx('ring_red', ax, gy - 10, { s0: 0.3, s1: 1.4, life: 0.7, add: true }); for (let i = 0; i < 8; i++) fx('fire1', ax + rand(-70, 70), gy - rand(20, 180), { s0: 0.1, s1: 0.04, life: 0.6, vy: -120, delay: i * 0.05 }); sound('horn', { v: 0.5 }); }
    if (k.armor) { fx('shield', ax, gy - 120, { s0: 0.25, s1: 0.4, life: 1.1, a: 0.9 }); sound('shield', { v: 0.7 }); }
    if (k.shield) { fx('ring_green', ax, gy - 10, { s0: 0.3, s1: 1.3, life: 0.7, add: true }); fx('shield', ax, gy - 150 - lift, { s0: 0.2, s1: 0.36, life: 1, a: 0.9 }); sound('shield', { v: 0.6 }); }
    if (k.rage) { fx('ring_red', ax, gy - 10, { s0: 0.3, s1: 1.4, life: 0.7, add: true }); for (let i = 0; i < 8; i++) fx('fire1', ax + rand(-70, 70), gy - rand(20, 180), { s0: 0.1, s1: 0.04, life: 0.6, vy: -120, delay: i * 0.05 }); sound('slam', { v: 0.5 }); }
    if (k.plate) { fx('shield', ax, gy - 130, { s0: 0.25, s1: 0.4, life: 1.1, a: 0.9 }); for (let i = 0; i < 6; i++) fx('star_big', ax + rand(-60, 60), gy - rand(30, 140), { s0: 0.06, s1: 0.18, life: 0.4, add: true, delay: i * 0.06 }); sound('shield', { v: 0.7, rate: 0.8 }); }
    if (k.slow) burst('ice_burst', hx, gy - 80, 3, { s: 0.14, up: 160 });
  }
  function startAtk(k) {
    st.fired = false;
    sound(k.proj ? 'swish' : 'whoosh', { v: 0.5 });
    if (k.special || k === a.attacks.special) sound('v_' + id, { v: 0.55, at: 0.05 });
  }
  function fire(k) {
    if (k.proj) { st.proj.push({ k, x: ax + 70, y: gy - 130 - lift, t: 0, dur: k.arc ? 0.55 : 0.35 }); return; }
    impact(k);
  }

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (document.hidden || !cv.isConnected) return;
    st.time += dt; st.t += dt;
    const cur = seq[st.i];
    if (st.t >= cur.dur) { st.t = 0; st.i = (st.i + 1) % seq.length; if (st.i === 0) st.loops++; if (seq[st.i].kind === 'atk') startAtk(seq[st.i].atk); }
    const step = seq[st.i];
    if (step.kind === 'atk' && !st.fired && st.t >= step.atk.windup * 1.35) { st.fired = true; fire(step.atk); }
    // décor : fond aux couleurs de la rareté, sol, ombre
    const g = ctx.createRadialGradient(PW / 2, PH * 0.45, 40, PW / 2, PH * 0.45, PW * 0.65);
    g.addColorStop(0, R.color); g.addColorStop(1, R.dark);
    ctx.fillStyle = g; ctx.fillRect(0, 0, PW, PH);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff';
    for (let i = 0; i < 12; i++) { const an = st.time * 0.15 + i * 0.5236; ctx.beginPath(); ctx.moveTo(PW / 2, PH * 0.45); ctx.arc(PW / 2, PH * 0.45, PW, an, an + 0.18); ctx.fill(); }
    ctx.globalAlpha = 1;
    const gg = ctx.createLinearGradient(0, gy - 30, 0, PH); gg.addColorStop(0, 'rgba(20,12,8,0)'); gg.addColorStop(1, 'rgba(20,12,8,.65)');
    ctx.fillStyle = gg; ctx.fillRect(0, gy - 30, PW, PH);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(ax, gy + 4, 92, 18, 0, 0, 6.3); ctx.fill();
    dummy();
    // l'animal
    if (loaded) {
      let anim = 'walk_E', fi = 0;
      if (step.kind === 'walk') fi = Math.floor(st.time * 9);
      else if (step.kind === 'atk') { anim = step.atk.anim + '_E'; const n = DATA[key].anims[anim] ? DATA[key].anims[anim].length : 8; fi = Math.min(n - 1, Math.floor(st.t / (step.atk.dur * 1.35) * n)); }
      const bob = a.air ? Math.sin(st.time * 5) * 6 : 0;
      drawUnitFrame(ctx, key, anim, fi, ax, gy - lift + bob, 1);
    } else label(ctx, 'Chargement…', ax, gy - 100, 30, '#fff');
    // projectiles
    for (let i = st.proj.length - 1; i >= 0; i--) {
      const q = st.proj[i]; q.t += dt;
      const k = clamp(q.t / q.dur, 0, 1), x = q.x + (tx - q.x) * k, y = q.y + (gy - 110 - q.y) * k - (q.k.arc ? Math.sin(k * Math.PI) * 120 : 0);
      drawFx(q.k.proj === 'rocks2' ? 'rocks2' : q.k.proj === 'hearts' ? 'hearts' : 'rocks', x, y, q.k.proj === 'hearts' ? 0.16 : 0.22, q.t * 8, 1);
      if (k >= 1) { st.proj.splice(i, 1); impact(q.k); }
    }
    // effets
    for (let i = st.parts.length - 1; i >= 0; i--) {
      const q = st.parts[i]; q.age += dt; if (q.age < 0) continue; if (q.age >= q.life) { st.parts.splice(i, 1); continue; }
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      const t = q.age / q.life, s = q.s0 + (q.s1 - q.s0) * t, al = q.a * (t < 0.6 ? 1 : (1 - t) / 0.4);
      if (q.add) ctx.globalCompositeOperation = 'lighter';
      drawFx(q.k, q.x, q.y, s, q.rot, al);
      ctx.globalCompositeOperation = 'source-over';
    }
    // légende
    const capt = step.kind === 'walk' ? `Déplacement · ${SPEED(a.speed).toLowerCase()}` : step.kind === 'atk' ? (step.special ? '★ ' : '') + step.atk.name + (step.atk.every ? ` · 1 coup sur ${step.atk.every}` : '') : st.cap;
    if (step.kind !== 'idle') st.cap = capt;
    ctx.fillStyle = 'rgba(10,6,20,.55)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(PW / 2 - 300, 14, 600, 54, 18) : ctx.rect(PW / 2 - 300, 14, 600, 54); ctx.fill();
    label(ctx, st.cap, PW / 2, 42, 32, step.kind === 'atk' && step.special ? '#ffe14a' : '#fff');
  }
  // mannequin d'entraînement (une cible sur un piquet) qui bascule quand il est touché
  function dummy() {
    st.hitT = Math.max(0, st.hitT - 1 / 60); st.wob *= 0.93;
    const rot = Math.sin(st.time * 22) * 0.12 * st.wob;
    ctx.save(); ctx.translate(tx, gy); ctx.rotate(rot);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 4, 50, 12, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#7a4a22'; ctx.fillRect(-9, -150, 18, 150); ctx.strokeStyle = '#2a160a'; ctx.lineWidth = 5; ctx.strokeRect(-9, -150, 18, 150);
    ctx.fillStyle = '#c9a25a'; ctx.fillRect(-46, -128, 92, 18); ctx.strokeRect(-46, -128, 92, 18);
    const rings = ['#f4ead2', '#d8342a', '#f4ead2', '#d8342a'];
    rings.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -160, 62 - i * 15, 0, 6.3); ctx.fill(); });
    ctx.lineWidth = 6; ctx.strokeStyle = '#2a160a'; ctx.beginPath(); ctx.arc(0, -160, 62, 0, 6.3); ctx.stroke();
    if (st.hitT > 0) { ctx.globalAlpha = st.hitT * 2.5; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -160, 62, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  raf = requestAnimationFrame(frame);
  return { el: cv, stop: () => { alive = false; cancelAnimationFrame(raf); } };
}
