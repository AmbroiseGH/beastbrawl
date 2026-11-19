// Codes secrets de l'accueil : toucher les zones dans l'ordre, sans laisser plus de 2 secondes entre deux appuis.
//  - code de triche : logo Beast Brawl ×3, roue des paramètres ×3, logo ×3, bouton des amis ×3
//    → +100 000 pièces et +100 000 gemmes (autant de fois qu'on veut) ;
//  - bonus de bienvenue (le code à donner aux amis) : logo ×10, puis la roue des paramètres
//    → +50 000 pièces et +6 000 gemmes, une seule fois par joueur (S.codes.bienvenue, et une marque à part dans le
//    navigateur pour qu'une remise à zéro de la partie ne le redonne pas).
// En plein code, les appuis sur la roue et sur le bouton des amis n'ouvrent pas leur fenêtre.
import { $ } from '../core/utils.js';
import { S } from '../core/save.js';
import { play } from '../core/audio.js';
import { toStage } from './stage.js';
import { current, render } from './menu.js';
import { grant } from '../game/progress.js';
import { showGain } from './popups.js';
import { toast, modal, p, rewardHtml } from './ui.js';

// les zones de l'accueil tropical, en pixels de la scène (941 × 1672)
const ZONES = {
  logo: [195, 205, 745, 558],       // le logo Beast Brawl (sans la plaque du joueur au-dessus ni l'île en dessous)
  gear: [797, 895, 927, 1005],      // la roue des paramètres, en bas de la colonne de droite
  social: [15, 895, 145, 1005],     // le bouton des amis, en bas de la colonne de gauche
};
const rep = (z, n) => Array(n).fill(z);
const CHEAT = { coins: 100000, rubies: 100000 }, GIFT = { coins: 50000, rubies: 6000 };
const CODES = [
  { seq: [...rep('logo', 3), ...rep('gear', 3), ...rep('logo', 3), ...rep('social', 3)], run: cheat },
  { seq: [...rep('logo', 10), 'gear'], run: welcomeBonus },
];
const GAP = 2000;                 // ms maximum entre deux appuis
let hist = [], lastT = 0, eatClick = false;

const zoneAt = (x, y) => Object.keys(ZONES).find((k) => { const [a, b, c, d] = ZONES[k]; return x >= a && x <= c && y >= b && y <= d; });
// où en est-on d'un code : le plus long début du code par lequel se terminent les derniers appuis
function progress(seq) {
  for (let k = Math.min(seq.length, hist.length); k > 0; k--) {
    let ok = true;
    for (let j = 0; j < k && ok; j++) ok = hist[hist.length - k + j] === seq[j];
    if (ok) return k;
  }
  return 0;
}

function cheat() {
  grant(CHEAT);
  render();
  showGain(CHEAT, [470, 380]);
  play('levelup');
  toast('Code de triche activé : +100 000 pièces et +100 000 gemmes !');
}

const MARK = 'beastbrawl.bienvenue';
function welcomeBonus() {
  let had = !!(S.codes && S.codes.bienvenue);
  try { had = had || !!localStorage.getItem(MARK); } catch (e) { /* navigation privée */ }
  if (had) { play('error'); toast('Tu as déjà reçu ton bonus de bienvenue !'); return; }
  S.codes = { ...(S.codes || {}), bienvenue: Date.now() };
  try { localStorage.setItem(MARK, String(S.codes.bienvenue)); } catch (e) { /* navigation privée */ }
  grant(GIFT);                                 // sauvegardé tout de suite, même si on ferme le jeu sans toucher « Super ! »
  play('levelup');
  modal({ title: 'Bonus de bienvenue', color: 'yellow', closable: false,
    body: [p('Bienvenue dans Beast Brawl ! Voici de quoi bien démarrer :'), p(`+${rewardHtml({ coins: GIFT.coins })}<br>+${rewardHtml({ rubies: GIFT.rubies })}`, 'gift')],
    buttons: [{ label: 'Super !', color: 'green' }],
    onClose: () => { render(); showGain(GIFT, [470, 836]); } });
}

document.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || $('scrMenu').hidden || current() !== 'main' || !e.target.closest || !e.target.closest('#scrMenu')) return;
  if ($('modals').children.length) return;                  // une fenêtre est ouverte par-dessus l'accueil
  const { x, y } = toStage(e), z = zoneAt(x, y), now = performance.now();
  if (now - lastT > GAP) hist = [];
  lastT = now;
  if (!z) { hist = []; return; }
  hist.push(z); if (hist.length > 24) hist.shift();
  let eat = false, done = null;
  for (const c of CODES) {
    const k = progress(c.seq);
    if (z !== 'logo' && k >= 2) eat = true;
    if (k === c.seq.length) done = c;
  }
  if (eat) { e.stopPropagation(); eatClick = true; setTimeout(() => { eatClick = false; }, 800); }
  if (done) { hist = []; done.run(); }
}, true);

document.addEventListener('click', (e) => { if (eatClick) { eatClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
