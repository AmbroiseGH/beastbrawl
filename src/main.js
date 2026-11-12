// Beast Brawl! — démarrage : écran du studio Michigan, chargement, puis le menu.
import { $, wait, DEBUG, TEST, pick } from './core/utils.js';
import { load, S, changed } from './core/save.js';
import { loadAll } from './core/assets.js';
import { unlock, playFile, sfx } from './core/audio.js';
import { fit } from './ui/stage.js';
import { showMenu } from './ui/menu.js';
import './ui/pages.js';
import './ui/social.js';
import { wire, firstVisit } from './ui/popups.js';
import { readInbox } from './ui/social.js';
import { Net } from './online/net.js';

const TIPS = [
  'Astuce : place tes Bulldogs devant, ils attirent les coups.',
  'Astuce : le Singe fouette tous les ennemis autour de lui. Entoure-le d\'ennemis !',
  'Astuce : gagne avec presque toute ton équipe debout pour décrocher 3 étoiles.',
  'Astuce : chaque animal mis K.-O. te rapporte des pattes pour améliorer ton équipe.',
  'Astuce : une série de victoires augmente tes gains de pièces.',
  'Astuce : la Roulade du Bulldog étourdit sa cible et blesse autour d\'elle.',
];

load();
if (DEBUG) document.body.classList.add('debug');
fit();
$('ldTip').textContent = pick(TIPS);

// l'écran du studio : logo qui brille + jingle, puis le chargement apparaît
function splash() {
  const el = $('splash');
  if (!el) return Promise.resolve();
  if (TEST) { el.remove(); return Promise.resolve(); }
  const soundOk = () => {
    try {
      if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy('mediaelement') === 'allowed';
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
      const c = new C(), ok = c.state === 'running'; c.close(); return ok;
    } catch (e) { return false; }
  };
  return new Promise((resolve) => {
    const play = async () => {
      el.onpointerdown = null; removeEventListener('keydown', onKey);
      $('spHint').hidden = true;
      el.classList.add('sp-on');
      playFile('assets/audio/eagle.mp3', 0.9);
      await wait(2150);
      el.classList.add('sp-out');
      playFile('assets/audio/jingle.mp3', 0.75);
      await wait(500);
      el.remove(); resolve();
    };
    const onTouch = () => { unlock(); play(); };
    const onKey = (e) => { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); onTouch(); } };
    if (!S.settings.sfx || soundOk()) { play(); return; }
    $('spHint').hidden = false;       // le navigateur bloque le son : on attend un premier toucher
    el.onpointerdown = onTouch; addEventListener('keydown', onKey);
  });
}

async function boot() {
  let prog = 0;
  const loading = loadAll((k) => { prog = k; $('ldFill').style.width = Math.round(k * 100) + '%'; $('ldText').textContent = 'Chargement… ' + Math.round(k * 100) + ' %'; });
  const t0 = performance.now();
  const online = Net.init().catch(() => false);             // jeu en ligne : on se signale au serveur pendant le chargement
  await splash();
  await loading;
  if (!TEST) await wait(Math.max(0, 1400 - (performance.now() - t0)));   // le temps de voir l'écran de chargement
  $('ldText').textContent = 'Prêt !';
  if (!TEST) await wait(350);
  wire();
  showMenu('main');
  await firstVisit();
  if (await online) readInbox().catch(() => {});      // messages reçus : attaques subies, invitations, nouveaux amis
}
boot().catch((e) => { console.error(e); $('ldText').textContent = 'Erreur de chargement. Recharge la page.'; });

// application installable + jouable hors ligne
if ('serviceWorker' in navigator && location.protocol === 'https:' && !TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('contextmenu', (e) => e.preventDefault());
