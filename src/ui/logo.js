// Ouverture du jeu : le logo Michigan Studios apparaît sur fond noir au son d'une guitare western, puis un reflet
// balaie les lettres de gauche à droite. Tout part tout seul, sans toucher l'écran. L'animation suit l'horloge du son
// (ce qu'on entend vraiment, retard du haut-parleur compris) : la lumière tombe pile sur la guitare. Si le navigateur
// interdit le son avant un premier toucher (iPhone…), le logo passe en silence et le son arrive au premier toucher.
import { $, wait, TEST } from '../core/utils.js';
import { S } from '../core/save.js';
import { loadSound, soundAllowed, soundReady, playSync, syncClock } from '../core/audio.js';
import { view } from './stage.js';

const IMG = 'assets/ui/logo_michigan2.webp', SOUND = 'assets/audio/logo.mp3', NEXT = 'assets/bg/loading.webp';
// Le canvas couvre une bande de la scène (941 × 560, à partir de y = 560) ; le logo y est centré.
const CW = 941, CH = 560, LW = 560, CX = CW / 2, CY = CH / 2;          // logo de 560 px de large (800 avant : trop grand)
// l'éclat final : en haut à droite du N (en fraction de l'image du logo)
const GLX = 0.972, GLY = 0.085;
// Calé sur la guitare : arpège jusqu'à 0,45 s (le logo arrive), accord qui sonne (le logo frappe), reflet, éclat, fondu.
// Les deux fondus de la fin (logo, puis noir) sont des transitions CSS : elles restent fluides même si le jeu calcule.
const LAND = 0.45, SWEEP0 = 0.52, SWEEP1 = 1.32, GLINT = 1.3, OUT0 = 2.3, FADE = 450;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const layer = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };

function decode(src) {
  return new Promise((res) => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
    im.onerror = () => res(null); im.src = src;
  });
}

// Les calques préparés une fois : lettres (dégradé argenté), masque, halo flou
function prepare(img, k) {
  const w = LW * k, hh = w * img.height / img.width;
  const mask = layer(w, hh), mc = mask.getContext('2d');
  mc.imageSmoothingQuality = 'high'; mc.drawImage(img, 0, 0, mask.width, mask.height);
  const base = layer(w, hh), bc = base.getContext('2d');
  bc.drawImage(mask, 0, 0);
  const g = bc.createLinearGradient(0, 0, 0, base.height);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#f1f2f7'); g.addColorStop(1, '#d9dce8');
  bc.globalCompositeOperation = 'source-in'; bc.fillStyle = g; bc.fillRect(0, 0, base.width, base.height);
  // halo : le masque réduit puis agrandi deux fois (un flou qui marche partout, même sans ctx.filter)
  const pad = Math.round(40 * k), blur = layer(w + 2 * pad, hh + 2 * pad), lc = blur.getContext('2d');
  const s1 = layer(blur.width / 8, blur.height / 8), s2 = layer(blur.width / 3, blur.height / 3);
  s1.getContext('2d').drawImage(mask, pad / 8, pad / 8, mask.width / 8, mask.height / 8);
  s2.getContext('2d').imageSmoothingQuality = 'high'; s2.getContext('2d').drawImage(s1, 0, 0, s2.width, s2.height);
  lc.imageSmoothingQuality = 'high'; lc.drawImage(s2, 0, 0, blur.width, blur.height);
  return { k, w, hh, pad, mask, base, blur, fx: layer(w + 2 * pad, hh + 2 * pad) };
}

// Une image de l'animation, au temps t (secondes depuis le début de la guitare)
function draw(ctx, L, t) {
  const { k, w, hh, pad, mask, base, blur, fx } = L;
  const fc = fx.getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const op = smooth(0, 0.32, t);
  if (op <= 0) return;
  const dl = t - LAND;
  let s = 1.1 - 0.1 * easeOut(t / LAND);
  if (dl > 0) s = 1 + 0.03 * Math.exp(-dl * 7) * Math.sin(Math.min(Math.PI, dl * Math.PI / 0.14));   // le coup de l'accord
  ctx.save();
  ctx.translate(CX * k, CY * k); ctx.scale(s, s); ctx.translate(-w / 2, -hh / 2);
  // éclair derrière le logo quand l'accord frappe
  const flash = dl > 0 ? Math.exp(-dl * 4.5) : 0;
  if (flash > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w * 0.62);
    rg.addColorStop(0, `rgba(255,236,200,${0.34 * flash * op})`); rg.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = rg; ctx.save(); ctx.translate(w / 2, hh / 2); ctx.scale(1, 0.55); ctx.translate(-w / 2, -hh / 2);
    ctx.fillRect(-w * 0.2, -hh, w * 1.4, hh * 3); ctx.restore();
    ctx.globalAlpha = 0.75 * flash * op; ctx.drawImage(blur, -pad, -pad);
  }
  // les lettres
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = op;
  ctx.drawImage(base, 0, 0);
  // le reflet : une bande inclinée qui traverse de gauche à droite (dorée dans les lettres, halo autour)
  const u = (t - SWEEP0) / (SWEEP1 - SWEEP0);
  if (u > 0 && u < 1) {
    const e = 0.5 - 0.5 * Math.cos(Math.PI * u), bx = -0.22 * w + e * 1.44 * w, bw = 0.075 * w;
    const band = (c, half, stops) => {
      c.save(); c.translate(bx + pad, pad + hh / 2); c.rotate(0.36);
      const g = c.createLinearGradient(-half, 0, half, 0); stops.forEach(([o, col]) => g.addColorStop(o, col));
      c.fillStyle = g; c.fillRect(-half, -hh * 1.5, 2 * half, hh * 3); c.restore();
    };
    // halo autour des lettres
    fc.globalCompositeOperation = 'source-over'; fc.clearRect(0, 0, fx.width, fx.height);
    band(fc, bw * 2.6, [[0, 'rgba(255,200,110,0)'], [0.5, 'rgba(255,214,140,1)'], [1, 'rgba(255,200,110,0)']]);
    fc.globalCompositeOperation = 'destination-in'; fc.drawImage(blur, 0, 0);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9 * op; ctx.drawImage(fx, -pad, -pad);
    // dans les lettres : la bande dorée, puis un filet blanc au centre
    fc.globalCompositeOperation = 'source-over'; fc.clearRect(0, 0, fx.width, fx.height);
    band(fc, bw, [[0, 'rgba(255,226,160,0)'], [0.32, 'rgba(255,226,160,.9)'], [0.5, 'rgba(255,255,255,1)'], [0.68, 'rgba(255,226,160,.9)'], [1, 'rgba(255,226,160,0)']]);
    fc.globalCompositeOperation = 'destination-in'; fc.drawImage(mask, pad, pad);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = op; ctx.drawImage(fx, -pad, -pad);
  }
  // l'éclat final, en haut à droite du N
  const gt = (t - GLINT) / 0.5;
  if (gt > 0 && gt < 1) {
    const a = Math.sin(Math.PI * gt) * op, gx = GLX * w, gy = GLY * hh, r = 46 * (LW / 800) * k * (0.6 + 0.4 * Math.sin(Math.PI * gt));
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 1.4);
    rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(0.25, 'rgba(255,230,170,.45)'); rg.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = rg; ctx.fillRect(gx - r * 1.5, gy - r * 1.5, r * 3, r * 3);
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(gt * 1.2);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath(); ctx.moveTo(-r * 1.6, 0); ctx.lineTo(0, -r * 0.09); ctx.lineTo(r * 1.6, 0); ctx.lineTo(0, r * 0.09); ctx.closePath(); ctx.fill();
      ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// Joue l'ouverture. Se résout quand l'écran noir a fini de s'effacer (l'écran de chargement est alors visible).
export async function studioLogo() {
  const scr = $('scrLogo');
  const done = () => { document.documentElement.classList.remove('intro'); };
  if (!scr) { done(); return; }
  if (TEST) { scr.remove(); done(); return; }
  const withSound = !!S.settings.sfx;
  const next = decode(NEXT);                          // l'écran de chargement, prêt à apparaître sans trou noir
  const [img] = await Promise.all([decode(IMG), withSound ? Promise.race([loadSound('logo', SOUND), wait(3500)]) : null]);
  if (!img) { scr.remove(); done(); return; }        // pas de logo (réseau coupé…) : on passe au chargement
  const cv = $('logoCv'), k = clamp(view.scale * (window.devicePixelRatio || 1), 0.6, 2.4);
  cv.width = Math.round(CW * k); cv.height = Math.round(CH * k);
  const ctx = cv.getContext('2d'), L = prepare(img, k);

  // la guitare part si le navigateur le permet (sinon : en silence, sans rien attendre) ; l'image suit le son
  let at = -1;
  if (withSound && (soundAllowed() || await soundReady(300))) at = playSync('logo', 0.06);
  const clock = syncClock(at);
  await new Promise((resolve) => {
    const frame = () => {
      const t = Math.max(0, clock());
      draw(ctx, L, Math.min(t, OUT0));
      if (t < OUT0) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  cv.classList.add('out');                           // le logo s'éteint…
  await Promise.all([wait(FADE), Promise.race([next, wait(1500)])]);
  done(); scr.classList.add('out');                  // … puis le noir s'efface : l'écran de chargement apparaît
  await wait(FADE);
  scr.remove();
}
