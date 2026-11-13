// Chargement des images, des atlas et des sons avant d'entrer dans le jeu.
export const IMG = {};     // images par nom
export const DATA = {};    // fichiers json par nom

const IMAGES = {
  arena: 'bg/arena.webp', bgMain: 'bg/main.webp', bgShop: 'bg/shop.webp', bgCollection: 'bg/collection.webp', bgClan: 'bg/clan.webp', bgRanked: 'bg/ranked.webp',
  monkey: 'units/monkey.webp', bulldog: 'units/bulldog.webp', trainerRed: 'units/trainer_red.webp', trainerBlue: 'units/trainer_blue.webp',
  fx: 'fx/fx.webp', font: 'fonts/bitmap.webp',
  sqBlue: 'ui/square_blue.webp', sqRed: 'ui/square_red.webp', sqGold: 'ui/square_gold.webp', sqGreen: 'ui/square_green.webp',
  cardMonkey: 'ui/card_monkey.webp', cardBulldog: 'ui/card_bulldog.webp',
  endVictory: 'ui/end_victory.webp', endDefeat: 'ui/end_defeat.webp', star1: 'ui/end_star1.webp', star2: 'ui/end_star2.webp', star3: 'ui/end_star3.webp',
  logo: 'ui/logo.webp', ptRed: 'ui/pt_red_happy.webp', ptRedSad: 'ui/pt_red_surprised.webp', ptRedThink: 'ui/pt_red_think.webp', ptBlue: 'ui/pt_blue.webp',
  coin: 'ui/cur_coin.webp', paw: 'ui/cur_paw.webp', ruby: 'ui/cur_ruby.webp', xp: 'ui/cur_xp.webp', trophy: 'ui/ic_trophy.webp', lock: 'ui/ic_lock.webp',
};
const UI_PRELOAD = ['btn_yellow', 'btn_green', 'btn_blue', 'btn_purple', 'btn_red', 'btn_stone', 'btn_wood', 'rib_blue', 'rib_red', 'rib_purple', 'rib_yellow',
  'ic_close', 'ic_ok', 'ic_info', 'ic_settings', 'ic_fast', 'ic_play', 'ic_pause', 'ic_back', 'ic_star', 'ic_crown', 'ic_shield_red', 'ic_shield_blue', 'ic_shield_swords',
  'frame_blue', 'frame_purple', 'frame_red', 'frame_stone', 'gem_blue', 'gem_green', 'gem_pink', 'gem_gold',
  'av_tiger', 'av_gorilla', 'av_eagle', 'av_tiger2', 'av_bulldog', 'av_monkey', 'av_croc', 'av_orang', 'tab1_off', 'tab2_on', 'tab3_on', 'coll_bulldog_locked',
  'navpatch_shop', 'navpatch_collection', 'navpatch_main', 'navpatch_clan', 'navpatch_ranked'];
const JSONS = { monkey: 'units/monkey.json', bulldog: 'units/bulldog.json', fx: 'fx/fx.json', font: 'fonts/bitmap.json' };

function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => (im.decode ? im.decode().catch(() => {}).then(() => res(im)) : res(im));
    im.onerror = () => { console.warn('image manquante :', src); res(im); };
    im.src = src;
  });
}

// onProgress(0…1). Ne rejette jamais : une image manquante n'empêche pas de jouer.
export async function loadAll(onProgress) {
  const jobs = [];
  for (const k in IMAGES) jobs.push(loadImage('assets/' + IMAGES[k]).then((im) => { IMG[k] = im; }));
  for (const n of UI_PRELOAD) jobs.push(loadImage('assets/ui/' + n + '.webp').then((im) => { IMG[n] = im; }));
  for (const k in JSONS) jobs.push(fetch('assets/' + JSONS[k]).then((r) => r.json()).then((j) => { DATA[k] = j; }).catch((e) => console.warn('json manquant :', k, e)));
  if (document.fonts && document.fonts.load) jobs.push(document.fonts.load('40px "Lilita One"').catch(() => {}));
  let done = 0;
  await Promise.all(jobs.map((j) => j.then(() => { done++; onProgress && onProgress(done / jobs.length); })));
}
