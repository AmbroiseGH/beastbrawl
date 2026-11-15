// Beast Brawl! — démarrage : chargement avec le jingle, puis le menu.
import { $, wait, DEBUG, TEST, pick } from './core/utils.js';
import { load, S, changed } from './core/save.js';
import { loadAll } from './core/assets.js';
import { unlock, playFile, loadSfx } from './core/audio.js';
import { fit } from './ui/stage.js';
import { showMenu, prepare } from './ui/menu.js';
import './ui/pages.js';
import './ui/collection.js';
import './ui/social.js';
import './ui/cheat.js';
import { wire, firstVisit } from './ui/popups.js';
import { readInbox } from './ui/social.js';
import { Net } from './online/net.js';

const TIPS = [
  'Astuce : pose un Bulldog devant tes animaux fragiles, il attire les coups.',
  'Astuce : le Cochon ne s\'intéresse qu\'aux structures. Protège-le et il cassera tout !',
  'Astuce : siffle pour rappeler tes animaux quand l\'adversaire attaque ton camp.',
  'Astuce : pendant la dernière minute, l\'Aura se recharge deux fois plus vite.',
  'Astuce : l\'Aigle vole. Seuls le Chaton, l\'Orang-outan, l\'Aigle et les tours peuvent le toucher.',
  'Astuce : même une Cage Rustique peut cacher un animal ultime !',
  'Astuce : le Chaton soigne ses alliés un coup sur trois.',
  'Astuce : touche Attaquer puis une tour pour que tous tes animaux foncent dessus.',
];

load();
if (DEBUG) document.body.classList.add('debug');
fit();
$('ldTip').textContent = pick(TIPS);

// Jingle du lancement (créé avec Soundza). Si le navigateur bloque le son, on attend un toucher à la fin du chargement.
const INTRO = 'assets/audio/intro.mp3', INTRO_MS = 3300;      // la musique du menu arrive à la fin du jingle
function tapToPlay() {
  const scr = $('scrLoading'), txt = $('ldText');
  txt.textContent = 'Touche l\'écran pour jouer'; txt.classList.add('tap'); scr.classList.add('tap');
  return new Promise((resolve) => {
    const go = (e) => {
      if (e.type === 'keydown' && !['Enter', ' ', 'Escape'].includes(e.key)) return;
      if (e.type === 'keydown') e.preventDefault();
      scr.removeEventListener('pointerdown', go); removeEventListener('keydown', go);
      txt.classList.remove('tap'); scr.classList.remove('tap');
      unlock(); resolve();
    };
    scr.addEventListener('pointerdown', go); addEventListener('keydown', go);
  });
}

async function boot() {
  let prog = 0;
  const loading = loadAll((k) => { prog = k; $('ldFill').style.width = Math.round(k * 100) + '%'; $('ldText').textContent = 'Chargement… ' + Math.round(k * 100) + ' %'; });
  const t0 = performance.now();
  let intro = TEST ? null : playFile(INTRO, 0.85), introAt = t0;
  const online = Net.init().catch(() => false);             // jeu en ligne : on se signale au serveur pendant le chargement
  const sounds = loadSfx();                                  // bruitages décodés une fois pour toutes
  await loading;
  await Promise.race([sounds, wait(TEST ? 0 : 2500)]);
  await prepare();                                           // décor des menus prêt à dessiner
  if (!TEST) await wait(Math.max(0, 1400 - (performance.now() - t0)));   // le temps de voir l'écran de chargement
  if (intro && !(await Promise.race([intro.ok, wait(2000)]))) {
    intro.pause();                                           // son bloqué : un toucher lance le jingle
    await tapToPlay();
    intro = playFile(INTRO, 0.85); introAt = performance.now();
    $('ldText').textContent = 'Prêt !';
    await wait(900);
  } else {
    $('ldText').textContent = 'Prêt !';
    if (!TEST) await wait(350);
  }
  wire();
  showMenu('main', intro ? Math.max(0, INTRO_MS - (performance.now() - introAt)) : 0);
  await firstVisit();
  if (await online) readInbox().catch(() => {});      // messages reçus : attaques subies, invitations, nouveaux amis
}
boot().catch((e) => { console.error(e); $('ldText').textContent = 'Erreur de chargement. Recharge la page.'; });

// application installable + jouable hors ligne
if ('serviceWorker' in navigator && location.protocol === 'https:' && !TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('contextmenu', (e) => e.preventDefault());
