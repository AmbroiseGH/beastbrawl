// Le tutoriel de Barnabé, le singe qui pousse les catapultes et le personnage récurrent du jeu (il s'appelait le
// tutomonkey : ses images en gardent le nom, assets/ui/tuto_*.webp et le sprite « tutomonkey ») :
//   1. il se présente et fait le tour des menus (une grande bulle par endroit, le reste de l'écran assombri) ;
//   2. combat d'entraînement contre un bot facile : à chaque explication, le combat se fige et la caméra va sur ce dont il
//      parle (la zone bleue, le camp rouge, la catapulte, l'eau des nageurs, les boîtes et les tours, la tente…) ; un
//      toucher et ça repart. Quand il attend un geste (poser, donner un ordre, la catapulte), une petite bulle le rappelle ;
//   3. un coffre en bois (coffre rustique) qui s'ouvre tout de suite : de quoi commencer, des communes et quelques rares.
// Les nouveaux joueurs le font après avoir choisi leur pseudo ; les autres se le voient proposer une fois, et le
// retrouvent dans les paramètres. Le coffre n'est donné qu'une fois (S.tuto.chest).
import { $, h, wait } from '../core/utils.js';
import { S, changed } from '../core/save.js';
import { sfx, play } from '../core/audio.js';
import { ANIMALS } from '../data/animals.js';
import { HUD } from '../render/view.js';
import { handOf } from '../game/rt.js';
import { starterChest } from '../game/progress.js';
import { startFight } from './battle.js';
import { showMenu, go, render } from './menu.js';
import { openChestAnim } from './chest.js';

// Ses humeurs : le portrait et la voix. Content, il garde sa voix d'origine (v_tuto) en alternance avec la nouvelle.
const PT = { happy: 'assets/ui/tuto_happy.webp', think: 'assets/ui/tuto_think.webp', scared: 'assets/ui/tuto_scared.webp' };
const MOOD = { happy: ['happy', ['v_tuto', 'v_barn_happy']], cheer: ['happy', ['v_barn_cheer']], think: ['think', ['v_barn_think']], scared: ['scared', ['v_barn_scared']] };
const said = {};
const portrait = (mood) => PT[(MOOD[mood] || MOOD.happy)[0]];
function talk(mood, v = 0.6) {
  const list = (MOOD[mood] || MOOD.happy)[1], k = said[mood] = ((said[mood] ?? -1) + 1) % list.length;
  play(list[k], { v, rate: 0.96 + Math.random() * 0.1 });
}
let busy = false;
// espaces insécables devant ! ? : ; (le signe ne part pas seul à la ligne)
const fr = (s) => s.replace(/ ([!?:;])/g, '\u00a0$1');

// ---------- les bulles ----------
// Une grande bulle de Barnabé : lui debout à droite, la bulle par-dessus ses jambes, en bas de l'écran (ou en haut :
// at = 'high', d'office si l'endroit montré est en bas). Le reste de l'écran est assombri (à peine en combat : soft), sauf
// « spot » ([x, y, l, h] en px de scène). Se résout au toucher (n'importe où, au bout de « hold » secondes), ou au
// bouton « btn » s'il y en a un (vrai), ou au bouton « alt » (faux).
function bubble({ pt = null, mood = null, text, spot = null, btn = null, alt = null, at = null, soft = false, hold = 0.45 }) {
  mood = mood || pt || 'happy';
  return new Promise((resolve) => {
    const low = at ? at === 'low' : !spot || spot[1] + spot[3] / 2 < 836;       // la bulle se met du côté opposé à l'endroit montré
    const bub = h('div', { class: 'tu-bub' }, h('div', { class: 'tu-name t' }, 'Barnabé'), h('div', { html: fr(text) }));
    const box = h('div', { class: 'tu-box ' + (low ? 'low' : 'high') }, h('img', { class: 'tu-pt ' + mood, src: portrait(mood), alt: '' }), bub);
    const el = h('div', { class: 'tu-ov' + (soft ? (spot ? ' soft' : ' soft bare') : spot ? '' : ' dim') }, spot ? h('div', { class: 'tu-spot', style: { left: spot[0] + 'px', top: spot[1] + 'px', width: spot[2] + 'px', height: spot[3] + 'px' } }) : null, box);
    const t0 = performance.now();
    const finish = (v) => { if (el.out) return; el.out = true; sfx.click(); el.classList.add('out'); setTimeout(() => el.remove(), 220); resolve(v); };
    if (btn || alt) bub.append(h('div', { class: 'tu-btns' }, alt ? h('button', { class: 'btn red small t sm', onclick: (e) => { e.stopPropagation(); finish(false); } }, alt) : null,
      btn ? h('button', { class: 'btn green small t sm', onclick: (e) => { e.stopPropagation(); finish(true); } }, btn) : null));
    else {
      bub.append(h('div', { class: 'tu-more t xs' }, 'Touche pour continuer ▸'));
      el.addEventListener('pointerdown', () => { if (performance.now() - t0 > hold * 1000) finish(true); });
    }
    $('modals').append(el);
    talk(mood);
  });
}

// Petite bulle du combat, en haut de l'écran : elle rappelle ce qu'il faut faire et laisse jouer (un toucher dessus la ferme)
function battleBubble() {
  let el = null, txt = null, img = null, cur = '';
  const self = {
    show(mood, text) {
      if (!el) {
        img = h('img', { class: 'tu-bpt', src: portrait(mood), alt: '' }); txt = h('div', { class: 'tu-btxt' });
        el = h('div', { class: 'tu-bat out' }, h('div', { class: 'tu-bbub', onpointerdown: (e) => { e.stopPropagation(); self.hide(); } }, txt), img);
        $('bHud').append(el);
      }
      if (cur === text && self.open) return;
      cur = text; img.src = portrait(mood); txt.innerHTML = fr(text);
      el.classList.remove('out', 'in'); void el.offsetWidth; el.classList.add('in');
      talk(mood, 0.5);
    },
    hide() { if (el) el.classList.add('out'); cur = ''; },
    remove() { if (el) el.remove(); el = null; cur = ''; },
    get open() { return !!el && !el.classList.contains('out'); },
  };
  return self;
}

// ---------- le combat d'entraînement ----------
// Le deck prêté pour l'entraînement (les cartes du joueur ne changent pas), et le bot facile
const DEMO_DECK = ['monkey', 'kitten', 'bulldog', 'clownfish', 'pig', 'octo'].map((id) => ({ id, level: 1 }));
const DEMO_BOT = { name: 'Robot d\'entraînement', trophies: 0, clanName: 'Barnabé', avatar: 'monkey', skill: 0, bot: true,
  deck: ['monkey', 'kitten', 'bulldog', 'pig'].map((id) => ({ id, level: 1 })) };

// Les explications pendant le combat. Une étape attend son moment : « after » secondes de jeu depuis la précédente, puis
// « when » (ce qui doit se passer), au plus « most » secondes de plus, après quoi elle passe quand même (ou est sautée :
// « need »). Barnabé explique alors (ex) : le combat se fige, la caméra va sur « focus » ([x, y, zoom] de la carte), « spot »
// entoure un bouton, « zone » montre où poser. Une étape qui attend un geste (until) laisse ensuite une petite bulle de
// rappel (remind), qui revient toutes les « again » secondes ; au bout de « dur » secondes on passe à la suite. Une étape
// déjà faite (le joueur a pris de l'avance) ou sans objet (skip) est sautée. Les alertes (camp attaqué, catapulte cassée,
// boîte dorée…) passent entre deux.
function demoGuide(onEnd) {
  const small = battleBubble();
  let api = null, i = 0, on = false, t = 0, ta = 0, rest = 9, busyEx = false, over = false, smallT = 0;
  const alerts = [], seen = {};
  const nm = (id) => ANIMALS[id].name.toLowerCase();
  const mine = (b) => b.units.filter((u) => u.side === 0 && !u.dead);
  const pad = (r, p = 8) => [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];
  const S0 = HUD.slots[0], S3 = HUD.slots[3], HAND = [S0[0] - 8, S0[1] - 8, S3[0] + S3[2] - S0[0] + 16, S0[3] + 16];
  const swimSlot = (b) => handOf(b, 0).findIndex((c) => c && ANIMALS[c.id].swim);
  const STEPS = [
    { after: 2.4, until: (e) => e.type === 'deploy' && e.side === 0, remind: 'Glisse une carte dans ta <b>zone bleue</b> !', again: 10,
      ex: { mood: 'happy', text: 'C\'est parti ! Glisse une carte de ta main jusqu\'à ta <b>zone bleue</b> pour poser un animal.', focus: [512, 1214, 1.2], at: 'high', zone: true, spot: HAND } },
    { after: 1.8, ex: { mood: 'cheer', text: 'Bravo ! Tes animaux foncent tout seuls vers le <b>camp rouge</b>, tout en haut. Détruis-le pour gagner !', focus: [512, 239, 1.3], at: 'low' } },
    { after: 4, when: (b) => mine(b).length > 0, most: 12, need: true,
      until: (e) => e.type === 'order' && e.side === 0 && !e.free, remind: 'Touche un de tes animaux, puis <b>sa cible</b>.', again: 12, dur: 24, min: 1.5,
      ex: { mood: 'think', text: 'Tu peux aussi donner des ordres : touche un de tes animaux, puis <b>sa cible</b> (un animal, une boîte, le camp…).',
        focus: (b) => { const u = mine(b).sort((p, q) => p.y - q.y)[0]; return u ? [u.x, u.y - 30, 1.45] : null; } } },
    { after: 2.5, skip: (b) => b.catas[0].want === 'centre',
      until: (e) => e.type === 'cata_order' && e.side === 0 && e.want === 'centre', remind: 'Touche le bouton <b>Catapulte</b>, en bas à droite !', again: 12, dur: 30, min: 1.5,
      then: () => api.glowCata(25),
      ex: { mood: 'happy', text: 'Voici ma <b>catapulte</b> : elle garde ton camp. Touche le bouton <b>Catapulte</b> et je la pousse au centre !',
        focus: (b) => [b.catas[0].x, b.catas[0].y - 40, 1.4], at: 'high', spot: pad(HUD.cata) } },
    { after: 1, when: (b) => b.catas[0].at === 'centre' && !b.catas[0].dead, most: 30, need: true,
      ex: { mood: 'happy', text: 'Au centre, elle lance un <b>rocher</b> sur le camp rouge toutes les 11 secondes. Protège-la : si on la casse, je la répare !',
        focus: (b) => [b.catas[0].x, b.catas[0].y - 40, 1.3] } },
    { after: 4, when: (b) => swimSlot(b) >= 0, most: 20,
      ex: { mood: 'think', text: `Le <b>${nm('clownfish')}</b> et le <b>${nm('octo')}</b> nagent : pose-les dans <b>l'eau de ton camp</b>. Seuls les volants et les nageurs peuvent les toucher !`,
        focus: [512, 1316, 1.2], at: 'high', zone: 'swim', spot: (b) => { const k = swimSlot(b); return k >= 0 ? pad(HUD.slots[k], 6) : null; } } },
    { after: 6, ex: { mood: 'happy', text: 'Casse les <b>boîtes</b> pour des bonus, et prends les <b>tours</b> des côtés : leur singe lancera des pierres pour toi.', at: 'low',
      focus: (b) => { const n = (l) => b.crates.filter((c) => !c.dead && (c.x < 512) === l).length; return [n(true) >= n(false) ? 252 : 772, 844, 1.35]; } } },
    { after: 5, when: (b) => mine(b).some((u) => u.hp < u.maxHp * 0.6), most: 25,
      ex: { mood: 'think', text: 'Un animal blessé ? <b>Siffler</b> le ramène à la tente pour se soigner. Siffle encore pour le renvoyer au combat !', focus: [512, 1316, 1.2], at: 'high', spot: pad(HUD.whistle) } },
    { after: 6, ex: { mood: 'happy', text: 'Le camp en retard reçoit un <b>coup de pouce</b> : plus d\'Aura, une catapulte plus rapide… et parfois une <b>boîte dorée</b> ! À toi de jouer !', at: 'high', spot: [226, 1600, 596, 64] } },
  ];
  const reminder = (s) => { small.show('happy', s.remind); ta = 0; };
  const next = () => { i++; on = false; t = 0; small.hide(); smallT = 0; };
  // Barnabé explique : combat figé, caméra sur l'endroit, grande bulle ; un toucher, la caméra revient et le combat repart
  async function explain(x) {
    busyEx = true; small.hide(); smallT = 0;
    const b = api.b, cam = api.camSave(), f = typeof x.focus === 'function' ? x.focus(b) : x.focus;
    api.freeze(true);
    let at = x.at || 'low';
    if (f) {        // la bulle prend une moitié de l'écran : l'endroit montré va dans l'autre
      const p = api.focus(f[0], f[1], f[2], at === 'high' ? 1070 : 560);
      if (!x.at && p.y > 860) { at = 'high'; api.focus(f[0], f[1], f[2], 1070); }       // la caméra ne descend pas plus : la bulle monte
    }
    if (x.zone) api.zone(1e9, x.zone === 'swim');
    await bubble({ mood: x.mood, text: x.text, spot: typeof x.spot === 'function' ? x.spot(b) : x.spot, at, soft: true, hold: 0.7 });
    if (over) return;
    if (x.zone) api.zone(3.5, x.zone === 'swim');
    api.freeze(false);
    if (f) api.camBack(cam);
    busyEx = false; rest = 0;
  }
  return {
    start(a) { api = a; },
    tick(dt) {
      if (over || !api || !api.b || busyEx) return;
      const b = api.b;
      t += dt; ta += dt; rest += dt;
      if (smallT > 0 && (smallT -= dt) <= 0) { small.hide(); const s = STEPS[i]; if (on && s && s.until && !s.hit) reminder(s); }
      // une alerte passe dès que possible (mais pas collée à l'explication d'avant)
      if (alerts.length && rest > 1.2 && b.t >= alerts[0].at) {
        const al = alerts.shift();
        if (al.ex) explain(al.ex).then(() => { const s = STEPS[i]; if (on && s && s.until && !s.hit && !over) reminder(s); });
        else { small.show(al.mood, al.text); smallT = al.dur; }
        return;
      }
      if (!on) {
        while (i < STEPS.length && (STEPS[i].hit || (STEPS[i].skip && STEPS[i].skip(b)))) { i++; t = 0; }
        const s = STEPS[i];
        if (!s || t < (s.after || 2) || rest < 2.5 || smallT > 0) return;
        if (s.when && !s.when(b)) { if (t < (s.after || 2) + (s.most || 20)) return; if (s.need) { i++; t = 0; return; } }
        on = true; t = 0;
        explain(s.ex).then(() => { if (over) return; if (s.then) s.then(); if (s.until && !s.hit) reminder(s); t = 0; });
        return;
      }
      const s = STEPS[i];
      if (!s.until) { next(); return; }
      if (s.hit && t >= (s.min || 0)) { next(); return; }
      if (s.again && ta > s.again && smallT <= 0) reminder(s);       // rien n'est fait : la bulle revient
      if (s.dur && t > s.dur) next();
    },
    event(e) {
      if (over || !api) return;
      for (let k = i; k < STEPS.length; k++) { const s = STEPS[k]; if (s.until && !s.hit && s.until(e)) s.hit = true; }
      const once = (key, al) => { if (!seen[key]) { seen[key] = 1; alerts.push({ at: 0, ...al }); } };
      if (e.type === 'hit' && e.kind === 'camp' && e.side === 0) once('camp', { ex: { mood: 'scared', text: 'Aïe, <b>ton camp</b> est attaqué ! Envoie des animaux le défendre.', focus: [512, 1316, 1.25], at: 'high' } });
      if (e.type === 'cata_break' && e.side === 0) once('break', { ex: { mood: 'scared', text: 'Oh non, ma <b>catapulte</b> est cassée ! Je la répare, ça prend quelques secondes…', focus: [e.x, e.y - 40, 1.35] } });
      if (e.type === 'cata_fixed' && e.side === 0) once('fixed', { mood: 'cheer', text: 'Réparée ! Elle repart au travail.', dur: 3 });
      if (e.type === 'deploy' && e.side === 0 && e.swim) once('swim', { mood: 'cheer', text: 'Plouf ! Tes nageurs suivent la rivière jusqu\'au camp rouge.', dur: 3.5 });
      if (e.type === 'gold_drop') {        // on la laisse tomber avant d'en parler
        const ours = e.side === 0;
        once('gold', { at: api.b.t + 1.3, ex: { mood: ours ? 'cheer' : 'think', focus: [e.x, e.y - 40, 1.4], text: ours
          ? 'Une <b>boîte dorée</b> ! Elle tombe chez le camp en retard : casse-la, son <b>singe doré</b> lancera des bananes qui soignent tes animaux !'
          : 'Une <b>boîte dorée</b> chez l\'adversaire : il est en retard. Celui qui la casse reçoit un <b>singe doré</b> qui soigne ses animaux. Prends-la-lui !' } });
      }
    },
    done(res) { over = true; small.remove(); onEnd(res); },
  };
}

// ---------- le tour des menus ----------
const TOUR = [
  { spot: [0, 0, 941, 86], mood: 'happy', text: 'En haut : ton <b>niveau</b>, tes <b>pièces</b>, tes <b>pattes</b> et tes <b>gemmes</b>. Elles servent à améliorer tes animaux et à ouvrir des coffres.' },
  { spot: [204, 1094, 525, 166], mood: 'cheer', text: '<b>Combattre</b> : un duel de 3 minutes contre un autre dresseur. Gagne pour monter en trophées et changer d\'arène !' },
  { spot: [22, 1262, 897, 214], mood: 'think', text: 'Chaque victoire rapporte un <b>coffre</b>. Il s\'ouvre ici, avec le temps… ou des gemmes si tu es pressé.' },
  { spot: [8, 606, 144, 410], mood: 'happy', text: 'Ici, tes <b>quêtes</b>, la <b>route des trophées</b> et tes <b>amis</b>. De l\'autre côté : le cadeau du jour, tes succès et les réglages.' },
  { spot: [173, 1500, 173, 172], mood: 'happy', text: 'La <b>Collection</b> : tes animaux, ton deck de 8 cartes et leurs améliorations.' },
  { spot: [0, 1500, 173, 172], mood: 'think', text: 'La <b>Boutique</b> : de nouvelles offres chaque jour.' },
  { spot: [596, 1500, 345, 172], mood: 'happy', text: 'Le <b>Clan</b> pour jouer entre amis, et le <b>classement</b> des meilleurs dresseurs.' },
];

// Lance tout le tutoriel. Se résout quand le joueur est de retour au menu.
export async function runTutorial() {
  if (busy) return; busy = true;
  try {
    S.tuto = { ...(S.tuto || {}), started: true }; changed();
    await Promise.all(Object.values(PT).map((src) => new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = src; })));
    go('main', true); await wait(250);
    await bubble({ mood: 'cheer', text: 'Salut ! Moi, c\'est <b>Barnabé</b>. C\'est moi qui pousse les catapultes ! Je te fais visiter ?', btn: 'Allons-y !', at: 'low' });
    for (const st of TOUR) await bubble(st);
    await bubble({ mood: 'happy', text: 'Place à l\'<b>entraînement</b> ! Je t\'ai trouvé un adversaire facile. Je reste à côté de toi.', btn: 'Au combat !', at: 'low' });
    const res = await new Promise((resolve) => {
      startFight({ mode: 'demo', opp: DEMO_BOT, deck: DEMO_DECK, guide: demoGuide(resolve) }).then((ok) => { if (!ok) resolve({ win: false, failed: true }); });
    });
    if (res.failed) { busy = false; return; }          // le combat n'a pas pu se lancer (le message est déjà affiché) : on réessaiera
    showMenu('main'); render();
    await wait(500);
    await bubble({ mood: res.win ? 'cheer' : 'think', text: res.win ? 'Bravo, tu as gagné ton premier combat ! Tu es fait pour ça.' : 'Pas grave, c\'était pour t\'entraîner ! Tu as vu l\'essentiel.', at: 'low' });
    if (!S.tuto.chest) {
      await bubble({ mood: 'cheer', text: 'Voici un <b>coffre en bois</b> pour bien commencer : des cartes communes et quelques rares !', btn: 'Ouvrir !', at: 'low' });
      await openChestAnim(starterChest());
      render();
      await bubble({ mood: 'happy', text: 'Tes nouvelles cartes sont dans ton <b>deck</b> (Collection). Touche <b>Combattre</b> quand tu es prêt. Bonne chance !', spot: [204, 1094, 525, 166] });
    } else await bubble({ mood: 'happy', text: 'Tu connais tout ! Touche <b>Combattre</b> quand tu es prêt. Bonne chance !', spot: [204, 1094, 525, 166] });
    S.tuto = { ...S.tuto, done: true }; changed();
  } finally { busy = false; }
}

// Joueur qui connaît déjà le jeu : on lui propose le tutoriel une fois (catapultes, nageurs, Barnabé)
export async function offerTutorial() {
  if (S.tuto) return;
  S.tuto = { offered: true }; changed();
  const yes = await bubble({ mood: 'happy', text: 'Nouveau : les <b>catapultes</b>, les <b>nageurs</b> et une nouvelle arène ! Moi, c\'est <b>Barnabé</b>. Un petit entraînement, avec un coffre en bois à la clé ?', btn: 'Montre-moi !', alt: 'Plus tard', at: 'low' });
  if (yes) await runTutorial();
}
export const tutoBusy = () => busy;
