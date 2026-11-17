// Beast Brawl! — démarrage : logo Michigan Studios, chargement avec le jingle, puis le menu.
import { $, wait, DEBUG, TEST, pick } from './core/utils.js';
import { load, S, changed } from './core/save.js';
import { loadAll } from './core/assets.js';
import { unlock, playFile, loadSfx, loadSound, play } from './core/audio.js';
import { fit } from './ui/stage.js';
import { showMenu, prepare } from './ui/menu.js';
import { studioLogo } from './ui/logo.js';
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

// Jingle du chargement (créé avec Soundza). Il passe par WebAudio, débloqué par le toucher du logo s'il en a fallu un ;
// si le son reste bloqué malgré tout, on attend un toucher à la fin du chargement.
// Il accompagne le chargement : la barre se remplit pendant la musique et touche 100 % au cri du gorille (ROAR_S), puis le
// menu arrive quand le cri retombe (MENU_S). Le gros du chargement se fait pendant le logo ; s'il traîne, la barre l'attend.
const INTRO = 'assets/audio/intro.mp3', INTRO_MS = 3300;      // la musique du menu arrive à la fin du jingle
const ROAR_S = 2.45, MENU_S = 2.95;
function playIntro(force) {
  if (TEST || !S.settings.sfx) return null;
  if (play('intro', { v: 0.85, force })) return { ok: Promise.resolve(true), pause() {} };
  return playFile(INTRO, 0.85);
}
function tapToPlay() {
  const scr = $('scrLoading'), txt = $('ldText');
  txt.textContent = 'Touche l\'écran pour jouer'; txt.classList.add('tap'); scr.classList.add('tap');
  return new Promise((resolve) => {
    const go = (e) => {
      if (e.type === 'keydown' && !['Enter', ' ', 'Escape'].includes(e.key)) return;
      if (e.type === 'keydown') e.preventDefault();
      scr.removeEventListener('pointerdown', go); removeEventListener('keydown', go);
      txt.classList.remove('tap'); scr.classList.remove('tap');
      unlock(); resolve(playIntro(true));                   // le jingle part dans le toucher même (iPhone)
    };
    scr.addEventListener('pointerdown', go); addEventListener('keydown', go);
  });
}

async function boot() {
  let prog = 0, t0 = 0, span = TEST ? 0.001 : 1.2;
  // la barre affichée : le chargement réel, sans aller plus vite que le jingle (span : secondes pour aller à 100 %)
  const bar = () => {
    const k = Math.min(prog, t0 ? (performance.now() - t0) / 1000 / span : 0);
    $('ldFill').style.width = Math.round(k * 100) + '%'; $('ldText').textContent = 'Chargement… ' + Math.round(k * 100) + ' %';
    return k;
  };
  // tout se charge pendant le logo
  const loading = loadAll((k) => { prog = k; });
  const online = Net.init().catch(() => false);             // jeu en ligne : on se signale au serveur pendant le chargement
  const jingle = TEST ? null : loadSound('intro', INTRO);
  const sounds = loadSfx();                                  // bruitages décodés une fois pour toutes
  await studioLogo();
  if (jingle) await Promise.race([jingle, wait(400)]);
  t0 = performance.now();
  let intro = playIntro(), introAt = t0;
  if (intro) { span = ROAR_S; intro.ok.then((ok) => { if (!ok) span = 1.2; }); }      // le jingle part avec l'écran de chargement : la barre suit la musique
  let ready = false;
  (async () => { await loading; await Promise.race([sounds, wait(TEST ? 0 : 2500)]); await prepare(); ready = true; })();   // (prepare : décor des menus)
  await new Promise((res) => { const f = () => { if (bar() >= 1 && ready) res(); else requestAnimationFrame(f); }; f(); });
  if (intro && !(await Promise.race([intro.ok, wait(600)]))) {
    intro.pause();                                           // son bloqué : un toucher lance le jingle
    intro = await tapToPlay(); introAt = performance.now();
    $('ldText').textContent = 'Prêt !';
    await wait(900);
  } else {
    $('ldText').textContent = 'Prêt !';                      // au cri du gorille
    if (!TEST) await wait(intro ? Math.max(250, MENU_S * 1000 - (performance.now() - t0)) : 350);
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
