// Le tutoriel du tutomonkey, le singe qui pousse les catapultes et le personnage récurrent du jeu :
//   1. il se présente et fait le tour des menus (une bulle par endroit, le reste de l'écran assombri) ;
//   2. combat d'entraînement contre un bot facile, avec ses bulles au bon moment (poser, donner un ordre, la catapulte,
//      les nageurs, les boîtes et les tours, Siffler, le coup de pouce) ;
//   3. un coffre en bois (cage rustique) qui s'ouvre tout de suite : de quoi commencer, des communes et quelques rares.
// Les nouveaux joueurs le font après avoir choisi leur pseudo ; les autres se le voient proposer une fois, et le
// retrouvent dans les paramètres. Le coffre n'est donné qu'une fois (S.tuto.chest).
import { $, h, wait } from '../core/utils.js';
import { S, changed } from '../core/save.js';
import { sfx, play } from '../core/audio.js';
import { ANIMALS } from '../data/animals.js';
import { starterChest } from '../game/progress.js';
import { startFight } from './battle.js';
import { showMenu, go, render } from './menu.js';
import { openChestAnim } from './chest.js';

const PT = { happy: 'assets/ui/tuto_happy.webp', think: 'assets/ui/tuto_think.webp', scared: 'assets/ui/tuto_scared.webp' };
let busy = false;

// ---------- les bulles ----------
// Une bulle du tutomonkey, en grand (menus) : le reste de l'écran est assombri, sauf « spot » ([x, y, l, h] en px de scène).
// Se résout au toucher (n'importe où), ou au bouton « btn » s'il y en a un (vrai), ou au bouton « alt » (faux).
function bubble({ pt = 'happy', text, spot = null, btn = null, alt = null, at = null }) {
  return new Promise((resolve) => {
    const low = at ? at === 'low' : !spot || spot[1] + spot[3] / 2 < 836;       // la bulle se met du côté opposé à l'endroit montré
    const bub = h('div', { class: 'tu-bub' }, h('div', { html: text }));
    const box = h('div', { class: 'tu-box ' + (low ? 'low' : 'high') }, h('img', { class: 'tu-pt', src: PT[pt], alt: '' }), bub);
    const el = h('div', { class: 'tu-ov' + (spot ? '' : ' dim') }, spot ? h('div', { class: 'tu-spot', style: { left: spot[0] + 'px', top: spot[1] + 'px', width: spot[2] + 'px', height: spot[3] + 'px' } }) : null, box);
    const t0 = performance.now();
    const finish = (v) => { if (el.out) return; el.out = true; sfx.click(); el.classList.add('out'); setTimeout(() => el.remove(), 220); resolve(v); };
    if (btn || alt) bub.append(h('div', { class: 'tu-btns' }, alt ? h('button', { class: 'btn red small t sm', onclick: (e) => { e.stopPropagation(); finish(false); } }, alt) : null,
      btn ? h('button', { class: 'btn green small t sm', onclick: (e) => { e.stopPropagation(); finish(true); } }, btn) : null));
    else {
      bub.append(h('div', { class: 'tu-more t xs' }, 'Touche pour continuer ▸'));
      el.addEventListener('pointerdown', () => { if (performance.now() - t0 > 450) finish(true); });
    }
    $('modals').append(el);
    play('v_tuto', { v: 0.5, rate: 0.95 + Math.random() * 0.15 });
  });
}

// Bulle du combat : petite, en haut de l'écran, elle laisse jouer (un toucher dessus la ferme)
function battleBubble() {
  let el = null, txt = null, img = null, cur = '';
  const self = {
    show(pt, text) {
      if (!el) {
        img = h('img', { class: 'tu-bpt', src: PT[pt], alt: '' }); txt = h('div', { class: 'tu-btxt' });
        el = h('div', { class: 'tu-bat out' }, h('div', { class: 'tu-bbub', onpointerdown: (e) => { e.stopPropagation(); self.hide(); } }, txt), img);
        $('bHud').append(el);
      }
      if (cur === text && self.open) return;
      cur = text; img.src = PT[pt]; txt.innerHTML = text;
      el.classList.remove('out', 'in'); void el.offsetWidth; el.classList.add('in');
      play('v_tuto', { v: 0.45, rate: 0.95 + Math.random() * 0.15 });
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
const DEMO_BOT = { name: 'Robot d\'entraînement', trophies: 0, clanName: 'Tutomonkey', avatar: 'monkey', skill: 0, bot: true,
  deck: ['monkey', 'kitten', 'bulldog', 'pig'].map((id) => ({ id, level: 1 })) };

// Les bulles pendant le combat. Une étape : portrait, texte, et soit une durée (dur), soit une action attendue (until),
// avec une durée maximale (dur) ou une bulle qui revient tant que rien n'est fait (again). Une étape déjà faite (le joueur
// a pris de l'avance) ou sans objet (skip) est sautée. Les alertes (camp attaqué, catapulte cassée) passent entre deux.
function demoGuide(onEnd) {
  const B = battleBubble();
  let api = null, i = 0, phase = 'gap', t = 0, pause = 0.8, alert = null, over = false;
  const alerts = [], seen = {};
  const nm = (id) => ANIMALS[id].name.toLowerCase();
  const STEPS = [
    { pt: 'happy', text: 'C\'est parti ! Glisse une carte dans ta <b>zone bleue</b> pour poser un animal.', until: (e) => e.type === 'deploy' && e.side === 0, again: 9, enter: () => { api.ui.zoneT = 3; } },
    { pt: 'happy', text: 'Bravo ! Tes animaux foncent tout seuls vers le <b>camp rouge</b>, tout en haut. Détruis-le pour gagner !', dur: 6 },
    { pt: 'think', text: 'Pour donner un ordre : touche un de tes animaux, puis <b>sa cible</b> (un animal, une boîte, le camp…).', until: (e) => e.type === 'order' && e.side === 0 && !e.free, dur: 16, min: 1.5 },
    { pt: 'happy', text: 'Ta <b>catapulte</b> garde ton camp. Touche le bouton <b>Catapulte</b>, en bas à droite : je la pousse au centre !', enter: () => api.glowCata(25),
      until: (e) => e.type === 'cata_order' && e.side === 0 && e.want === 'centre', dur: 25, min: 1.5 },
    { pt: 'happy', text: 'Au centre, elle lance un <b>rocher</b> sur le camp rouge toutes les 11 secondes. Protège-la : si on la casse, je la répare !', dur: 9, skip: (b) => b.catas[0].want !== 'centre' },
    { pt: 'think', text: `Le <b>${nm('clownfish')}</b> et le <b>${nm('octo')}</b> nagent : pose-les dans <b>l'eau de ton camp</b>. Seuls les volants et les nageurs peuvent les toucher !`, dur: 10 },
    { pt: 'happy', text: 'Casse les <b>boîtes</b> pour des bonus, et prends les <b>tours</b> des côtés : leur singe lancera des pierres pour toi.', dur: 8 },
    { pt: 'think', text: 'Un animal blessé ? <b>Siffler</b> le ramène à la tente pour se soigner.', dur: 7 },
    { pt: 'happy', text: 'Le camp qui a du retard reçoit un <b>coup de pouce</b> : plus d\'Aura et une catapulte plus rapide. À toi de jouer !', dur: 8 },
  ];
  const show = (s) => { B.show(s.pt, s.text); if (s.enter) s.enter(); };
  const advance = () => { i++; phase = 'gap'; pause = 1.1; t = 0; B.hide(); };
  return {
    start(a) { api = a; },
    tick(dt) {
      if (over || !api || !api.b) return;
      const b = api.b; t += dt;
      if (phase === 'gap') {
        pause -= dt; if (pause > 0) return;
        if (alerts.length && i > 0) { alert = alerts.shift(); B.show(alert.pt, alert.text); phase = 'alert'; t = 0; return; }
        while (i < STEPS.length && (STEPS[i].hit || (STEPS[i].skip && STEPS[i].skip(b)))) i++;
        if (i < STEPS.length) { show(STEPS[i]); phase = 'step'; t = 0; }
        return;
      }
      if (phase === 'alert') { if (t > alert.dur) { B.hide(); phase = 'gap'; pause = 0.8; } return; }
      const s = STEPS[i];
      if (s.until) {
        if (s.hit && t >= (s.min || 0)) advance();
        else if (s.again && t > s.again) { t = 0; show(s); }      // rien n'est fait : la bulle revient
        else if (s.dur && t > s.dur) advance();
      } else if (t > s.dur || (alerts.length && t > 3)) advance();  // une alerte écourte une bulle d'explication
    },
    event(e) {
      if (over || !api) return;
      for (let k = i; k < STEPS.length; k++) { const s = STEPS[k]; if (s.until && !s.hit && s.until(e)) s.hit = true; }
      const alertOnce = (key, al) => { if (!seen[key]) { seen[key] = 1; alerts.push(al); } };
      if (e.type === 'hit' && e.kind === 'camp' && e.side === 0) alertOnce('camp', { pt: 'scared', text: 'Aïe, <b>ton camp</b> est attaqué ! Envoie des animaux le défendre.', dur: 4.5 });
      if (e.type === 'cata_break' && e.side === 0) alertOnce('break', { pt: 'scared', text: 'Ma catapulte est cassée ! Je la répare, ça prend quelques secondes…', dur: 4.5 });
      if (e.type === 'cata_fixed' && e.side === 0) alertOnce('fixed', { pt: 'happy', text: 'Réparée ! Elle repart au travail.', dur: 3 });
      if (e.type === 'deploy' && e.side === 0 && e.swim) alertOnce('swim', { pt: 'happy', text: 'Plouf ! Tes nageurs suivent la rivière jusqu\'au camp rouge.', dur: 3.5 });
    },
    done(res) { over = true; B.remove(); onEnd(res); },
  };
}

// ---------- le tour des menus ----------
const TOUR = [
  { spot: [0, 0, 941, 86], pt: 'happy', text: 'En haut : ton <b>niveau</b>, tes <b>pièces</b>, tes <b>pattes</b> et tes <b>gemmes</b>. Elles servent à améliorer tes animaux et à ouvrir des cages.' },
  { spot: [160, 1034, 618, 172], pt: 'happy', text: '<b>Combattre</b> : un duel de 3 minutes contre un autre dresseur. Gagne pour monter en trophées et changer d\'arène !' },
  { spot: [40, 1226, 862, 228], pt: 'think', text: 'Chaque victoire rapporte une <b>cage</b>. Elle s\'ouvre ici, avec le temps… ou des gemmes si tu es pressé.' },
  { spot: [12, 548, 136, 370], pt: 'happy', text: 'Ici, tes <b>quêtes</b>, la <b>route des trophées</b> et tes <b>amis</b>. De l\'autre côté : le cadeau du jour, tes succès et les réglages.' },
  { spot: [182, 1500, 163, 172], pt: 'happy', text: 'La <b>Collection</b> : tes animaux, ton deck de 8 cartes et leurs améliorations.' },
  { spot: [0, 1500, 178, 172], pt: 'think', text: 'La <b>Boutique</b> : de nouvelles offres chaque jour.' },
  { spot: [600, 1500, 341, 172], pt: 'happy', text: 'Le <b>Clan</b> pour jouer entre amis, et le <b>classement</b> des meilleurs dresseurs.' },
];

// Lance tout le tutoriel. Se résout quand le joueur est de retour au menu.
export async function runTutorial() {
  if (busy) return; busy = true;
  try {
    S.tuto = { ...(S.tuto || {}), started: true }; changed();
    await Promise.all(Object.values(PT).map((src) => new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = src; })));
    go('main', true); await wait(250);
    await bubble({ pt: 'happy', text: 'Salut ! Moi, c\'est <b>Tutomonkey</b>. C\'est moi qui pousse les catapultes ! Je te fais visiter ?', btn: 'Allons-y !', at: 'low' });
    for (const st of TOUR) await bubble(st);
    await bubble({ pt: 'happy', text: 'Place à l\'<b>entraînement</b> ! Je t\'ai trouvé un adversaire facile. Je reste à côté de toi.', btn: 'Au combat !', at: 'low' });
    const res = await new Promise((resolve) => {
      startFight({ mode: 'demo', opp: DEMO_BOT, deck: DEMO_DECK, guide: demoGuide(resolve) }).then((ok) => { if (!ok) resolve({ win: false, failed: true }); });
    });
    if (res.failed) { busy = false; return; }          // le combat n'a pas pu se lancer (le message est déjà affiché) : on réessaiera
    showMenu('main'); render();
    await wait(500);
    await bubble({ pt: res.win ? 'happy' : 'think', text: res.win ? 'Bravo, tu as gagné ton premier combat ! Tu es fait pour ça.' : 'Pas grave, c\'était pour t\'entraîner ! Tu as vu l\'essentiel.', at: 'low' });
    if (!S.tuto.chest) {
      await bubble({ pt: 'happy', text: 'Voici un <b>coffre en bois</b> pour bien commencer : des cartes communes et quelques rares !', btn: 'Ouvrir !', at: 'low' });
      await openChestAnim(starterChest());
      render();
      await bubble({ pt: 'happy', text: 'Tes nouvelles cartes sont dans ton <b>deck</b> (Collection). Touche <b>Combattre</b> quand tu es prêt. Bonne chance !', spot: [160, 1034, 618, 172] });
    } else await bubble({ pt: 'happy', text: 'Tu connais tout ! Touche <b>Combattre</b> quand tu es prêt. Bonne chance !', spot: [160, 1034, 618, 172] });
    S.tuto = { ...S.tuto, done: true }; changed();
  } finally { busy = false; }
}

// Joueur qui connaît déjà le jeu : on lui propose le tutoriel une fois (catapultes, nageurs, tutomonkey)
export async function offerTutorial() {
  if (S.tuto) return;
  S.tuto = { offered: true }; changed();
  const yes = await bubble({ pt: 'happy', text: 'Nouveau : les <b>catapultes</b>, les <b>nageurs</b> et une nouvelle arène ! Moi, c\'est <b>Tutomonkey</b>. Un petit entraînement, avec un coffre en bois à la clé ?', btn: 'Montre-moi !', alt: 'Plus tard', at: 'low' });
  if (yes) await runTutorial();
}
export const tutoBusy = () => busy;
