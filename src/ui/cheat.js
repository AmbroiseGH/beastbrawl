// Code de triche de l'accueil : logo Beast Brawl ×3, roue des paramètres ×3, logo ×3, bouton social (amis) ×3
// → +100 000 pièces et +100 000 gemmes.
import { $ } from '../core/utils.js';
import { play } from '../core/audio.js';
import { toStage } from './stage.js';
import { current, render } from './menu.js';
import { grant } from '../game/progress.js';
import { showGain } from './popups.js';
import { toast } from './ui.js';

const ZONES = {
  logo: [235, 165, 705, 505],
  gear: [807, 806, 920, 908],
  social: [22, 806, 138, 908],
};
const SEQ = ['logo', 'logo', 'logo', 'gear', 'gear', 'gear', 'logo', 'logo', 'logo', 'social', 'social', 'social'];
const GAP = 2000;                 // ms maximum entre deux appuis
let i = 0, lastT = 0, eatClick = false;

const zoneAt = (x, y) => Object.keys(ZONES).find((k) => { const [a, b, c, d] = ZONES[k]; return x >= a && x <= c && y >= b && y <= d; });

document.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || $('scrMenu').hidden || current() !== 'main' || !e.target.closest || !e.target.closest('#scrMenu')) return;
  const { x, y } = toStage(e), z = zoneAt(x, y), now = performance.now();
  if (now - lastT > GAP) i = 0;
  lastT = now;
  if (z !== SEQ[i]) { i = z === SEQ[0] ? 1 : 0; return; }
  // au milieu du code, les appuis sur la roue et le bouton social n'ouvrent pas leur fenêtre
  if (i >= 3 && z !== 'logo') { e.stopPropagation(); eatClick = true; setTimeout(() => { eatClick = false; }, 800); }
  i++;
  if (i < SEQ.length) return;
  i = 0;
  grant({ coins: 100000, rubies: 100000 });
  render();
  showGain({ coins: 100000, rubies: 100000 }, [470, 340]);
  play('levelup');
  toast('Code de triche activé : +100 000 pièces et +100 000 gemmes !');
}, true);

document.addEventListener('click', (e) => { if (eatClick) { eatClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
