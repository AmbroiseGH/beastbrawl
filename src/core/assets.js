// Chargement des images et des atlas. Le nécessaire des menus est chargé au démarrage ; les grosses planches
// (animaux en combat, coffres, révélations, arènes) sont chargées à la demande avec ensure(), puis gardées.
import { ANIMAL_IDS } from '../data/animals.js';
import { CHEST_IDS } from '../data/cards.js';

export const IMG = {};     // images par nom
export const DATA = {};    // fichiers json par nom

const BOOT_IMAGES = {
  bgMain: 'bg/main2.webp', bgShop: 'bg/shop2.webp', bgCollection: 'bg/collection.webp', bgClan: 'bg/clan.webp', bgRanked: 'bg/ranked.webp',
  fx: 'fx/fx.webp', font: 'fonts/bitmap.webp',
  coin: 'ui/cur_coin.webp', paw: 'ui/cur_paw.webp', ruby: 'ui/cur_ruby.webp', xp: 'ui/cur_xp.webp', trophy: 'ui/ic_trophy.webp', lock: 'ui/ic_lock.webp', star: 'ui/ic_star.webp',
  ...Object.fromEntries(ANIMAL_IDS.map((id) => ['card_' + id, 'cards/' + id + '.webp'])),
  ...Object.fromEntries(ANIMAL_IDS.map((id) => ['pt_' + id, 'portraits/' + id + '.webp'])),
  ...Object.fromEntries(CHEST_IDS.map((id) => ['chest_' + id, 'chests/icon_' + id + '.webp'])),
};
const UI_PRELOAD = ['btn_yellow', 'btn_green', 'btn_blue', 'btn_purple', 'btn_red', 'btn_stone', 'btn_wood', 'rib_blue', 'rib_red', 'rib_purple', 'rib_yellow',
  'ic_close', 'ic_ok', 'ic_info', 'ic_settings', 'ic_play', 'ic_back', 'ic_crown', 'ic_shield_red', 'ic_shield_blue', 'ic_target',
  'av_tiger', 'av_gorilla', 'av_eagle', 'av_tiger2', 'av_bulldog', 'av_monkey', 'av_croc', 'av_orang', 'order_whistle', 'order_attack',
  ...['shop', 'collection', 'main', 'clan', 'ranked'].flatMap((t) => ['navcap_' + t, 'navring_' + t, 'navfill_' + t])];
const BOOT_JSONS = { fx: 'fx/fx.json', font: 'fonts/bitmap.json', arena: 'arena/arena.json', chestMeta: 'chests/meta.json?v=3', revealMeta: 'cards/reveal_meta.json?v=3' };

const pending = {};
function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => (im.decode ? im.decode().catch(() => {}).then(() => res(im)) : res(im));
    im.onerror = () => { console.warn('image manquante :', src); res(im); };
    im.src = src;
  });
}
// Charge une image une seule fois (les appels suivants attendent le même chargement)
export function image(key, path) {
  if (IMG[key]) return Promise.resolve(IMG[key]);
  return pending[key] || (pending[key] = loadImage('assets/' + path).then((im) => { IMG[key] = im; delete pending[key]; return im; }));
}
export function json(key, path) {
  if (DATA[key]) return Promise.resolve(DATA[key]);
  return pending['j:' + key] || (pending['j:' + key] = fetch('assets/' + path).then((r) => r.json()).then((j) => { DATA[key] = j; return j; }).catch((e) => { console.warn('json manquant :', key, e); return null; }).finally(() => delete pending['j:' + key]));
}
// Ce qu'il faut pour dessiner un animal en combat (hd : la grande planche de l'aperçu de la collection)
// (?v=2 : les planches du Singe et du Bulldog ont changé de forme, l'ancienne copie gardée hors ligne ne doit pas servir)
export const unitAssets = (id, hd) => { const k = hd ? id + '_hd' : id; return Promise.all([image(k, 'units/' + k + '.webp?v=3'), json(k, 'units/' + k + '.json?v=3')]); };
// Le décor d'une arène : terrain, six structures et leurs ruines, barre du bas
export function arenaAssets(n) {
  const jobs = [image('field' + n, 'arena/field' + n + '.webp?v=3'), image('hud', 'arena/hud.webp'), image('shield', 'arena/shield.webp'), image('crownRed', 'arena/crown_red.webp'), image('crownBlue', 'arena/crown_blue.webp')];
  for (const s of ['e_main', 'e_left', 'e_right', 'p_left', 'p_right', 'p_main']) jobs.push(image(`a${n}_${s}`, `arena/a${n}_${s}.webp`), image(`a${n}_${s}_ruin`, `arena/a${n}_${s}_ruin.webp`));
  return Promise.all(jobs);
}
// Planches haute définition (?v=3 : leur découpage a changé, l'ancienne copie gardée hors ligne ne doit pas servir)
export const chestAssets = (tier) => image('sheet_' + tier, 'chests/' + tier + '.webp?v=3');
export const revealAssets = (r) => image('reveal_' + r, 'cards/reveal_' + r + '.webp?v=3');
export const cardHd = (id) => image('cardhd_' + id, 'cards/' + id + '_hd.webp');      // grande carte, pour la révélation

// onProgress(0…1). Ne rejette jamais : une image manquante n'empêche pas de jouer.
export async function loadAll(onProgress) {
  const jobs = [];
  for (const k in BOOT_IMAGES) jobs.push(image(k, BOOT_IMAGES[k]));
  for (const n of UI_PRELOAD) jobs.push(image(n, 'ui/' + n + '.webp'));
  for (const k in BOOT_JSONS) jobs.push(json(k, BOOT_JSONS[k]));
  if (document.fonts && document.fonts.load) jobs.push(document.fonts.load('40px "Lilita One"').catch(() => {}));
  let done = 0;
  await Promise.all(jobs.map((j) => j.then(() => { done++; onProgress && onProgress(done / jobs.length); })));
}
