// Beast Brawl! — démarrage : logo Michigan Studios, chargement avec le jingle, puis le menu.
import { $, wait, DEBUG, TEST, pick } from './core/utils.js';
import { load, S, changed } from './core/save.js';
import { loadAll } from './core/assets.js';
import { loadSfx, loadSound, soundAllowed, playSync, syncClock } from './core/audio.js';
import { fit } from './ui/stage.js';
import { showMenu, prepare } from './ui/menu.js';
import { studioLogo } from './ui/logo.js';
import { startLoadingArt, stopLoadingArt } from './ui/loadart.js';
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
  'Astuce : au centre, ta catapulte lance un rocher sur le camp adverse toutes les 11 secondes.',
  'Astuce : la catapulte adverse vient au centre ? Casse-la, le temps que son singe la répare !',
  'Astuce : les nageurs ne craignent que les volants et les autres nageurs.',
  'Astuce : le camp le plus abîmé recharge son Aura plus vite. Rien n\'est jamais perdu !',
];

load();
if (DEBUG) document.body.classList.add('debug');
fit();
$('ldTip').textContent = pick(TIPS);

// Jingle du chargement (créé avec Soundza). Il part tout seul avec l'écran de chargement, sans toucher l'écran : la barre
// suit l'horloge du son (ce qu'on entend vraiment) et touche 100 % au cri du gorille (ROAR_S), puis le menu arrive quand le
// cri retombe (MENU_S). Si le navigateur interdit le son avant un premier toucher (iPhone…), tout passe en silence et la
// musique du menu démarre au premier toucher. Le gros du chargement se fait pendant le logo ; s'il traîne, la barre l'attend.
const INTRO = 'assets/audio/intro.mp3', INTRO_MS = 3300;      // la musique du menu arrive à la fin du jingle
const ROAR_S = 2.45, MENU_S = 2.95;

async function boot() {
  let prog = 0, clock = null, span = TEST ? 0.001 : 1.2;
  // la barre affichée : le chargement réel, sans aller plus vite que le jingle (span : secondes pour aller à 100 %)
  const bar = () => {
    const k = Math.min(prog, clock ? Math.max(0, clock()) / span : 0);
    $('ldFill').style.width = Math.round(k * 100) + '%'; $('ldText').textContent = 'Chargement… ' + Math.round(k * 100) + ' %';
    return k;
  };
  // tout se charge pendant le logo
  const loading = loadAll((k) => { prog = k; });
  const online = Net.init().catch(() => false);             // jeu en ligne : on se signale au serveur pendant le chargement
  const jingle = TEST ? null : loadSound('intro', INTRO);
  const sounds = loadSfx();                                  // bruitages décodés une fois pour toutes
  await studioLogo();
  startLoadingArt();                                         // les animaux de l'écran de chargement s'animent
  let at = -1;
  if (jingle && S.settings.sfx) { await Promise.race([jingle, wait(400)]); if (soundAllowed()) at = playSync('intro', 0.05, 0.85); }
  clock = syncClock(at);
  if (at >= 0) span = ROAR_S;                                // le jingle part avec l'écran de chargement : la barre suit la musique
  let ready = false;
  (async () => { await loading; await Promise.race([sounds, wait(TEST ? 0 : 2500)]); await prepare(); ready = true; })();   // (prepare : décor des menus)
  await new Promise((res) => { const f = () => { if (bar() >= 1 && ready) res(); else requestAnimationFrame(f); }; f(); });
  $('ldText').textContent = 'Prêt !';                        // au cri du gorille
  if (!TEST) await wait(at >= 0 ? Math.max(250, (MENU_S - clock()) * 1000) : 350);
  stopLoadingArt();
  wire();
  showMenu('main', at >= 0 ? Math.max(0, INTRO_MS - clock() * 1000) : 0);
  await firstVisit();
  if (await online) readInbox().catch(() => {});      // messages reçus : attaques subies, invitations, nouveaux amis
}
boot().catch((e) => { console.error(e); $('ldText').textContent = 'Erreur de chargement. Recharge la page.'; });

// application installable + jouable hors ligne
if ('serviceWorker' in navigator && location.protocol === 'https:' && !TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('contextmenu', (e) => e.preventDefault());
