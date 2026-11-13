// La scène : un rectangle fixe de 941 × 1672 mis à l'échelle de l'écran et centré.
import { $ } from '../core/utils.js';
export const W = 941, H = 1672;
export const view = { scale: 1, x: 0, y: 0 };
const subs = new Set();
export const onResize = (fn) => { subs.add(fn); };

export function fit() {
  const vw = innerWidth, vh = innerHeight;
  const s = Math.min(vw / W, vh / H);
  view.scale = s; view.x = Math.round((vw - W * s) / 2); view.y = Math.round((vh - H * s) / 2);
  $('stage').style.transform = `translate(${view.x}px,${view.y}px) scale(${s})`;
  for (const fn of subs) fn(view);
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 200));

// Position d'un pointeur dans la scène
export const toStage = (e) => ({ x: (e.clientX - view.x) / view.scale, y: (e.clientY - view.y) / view.scale });
// ---------- le fond flou derrière la scène ----------
// On le voit sur les bords quand l'écran n'a pas les proportions du jeu. Chaque décor est flouté une seule fois, en tout
// petit, puis simplement étiré sur l'écran : passer d'un décor à l'autre ne demande ni chargement ni calcul, donc
// le fond ne peut jamais clignoter.
const BW = 96, BH = 170;
const soft = new Map();              // image → sa petite version floutée
let sigma = 0;                       // force du flou, en pixels du petit canvas
let shown = null;                    // ce qui est affiché : [décor, second décor, part du second]
const bcv = $('backdropCv'), bctx = bcv.getContext('2d', { alpha: false });
bcv.width = BW; bcv.height = BH;

// moyenne glissante de rayon r le long de chaque ligne (les bords sont prolongés)
function boxPass(a, b, n, step, lines, lineStep, r) {
  const win = 2 * r + 1;
  for (let l = 0; l < lines; l++) for (let c = 0; c < 3; c++) {
    const o = l * lineStep + c; let sum = 0;
    for (let i = -r; i <= r; i++) sum += a[o + Math.min(n - 1, Math.max(0, i)) * step];
    for (let i = 0; i < n; i++) {
      b[o + i * step] = sum / win;
      sum += a[o + Math.min(n - 1, i + r + 1) * step] - a[o + Math.max(0, i - r) * step];
    }
  }
}
function softOf(img) {
  if (soft.has(img)) return soft.get(img);
  const c = document.createElement('canvas'); c.width = BW; c.height = BH;
  const x = c.getContext('2d'); x.fillStyle = '#0b1430'; x.fillRect(0, 0, BW, BH);
  const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
  if (iw && ih) try {
    const k = Math.max(BW / iw, BH / ih); x.imageSmoothingQuality = 'high';
    x.drawImage(img, (BW - iw * k) / 2, (BH - ih * k) / 2, iw * k, ih * k);
    const id = x.getImageData(0, 0, BW, BH), d = id.data;
    let a = Float32Array.from(d), b = new Float32Array(d.length);
    const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));     // trois moyennes glissantes ≈ un flou gaussien
    for (let i = 0; i < 3; i++) { boxPass(a, b, BW, 4, BH, BW * 4, r); [a, b] = [b, a]; }
    for (let i = 0; i < 3; i++) { boxPass(a, b, BH, BW * 4, BW, 4, r); [a, b] = [b, a]; }
    for (let i = 0; i < d.length; i += 4) {                                             // assombri, couleurs un peu ravivées
      const R = a[i] * 0.55, G = a[i + 1] * 0.55, B = a[i + 2] * 0.55, L = 0.213 * R + 0.715 * G + 0.072 * B;
      d[i] = L + 1.2 * (R - L); d[i + 1] = L + 1.2 * (G - L); d[i + 2] = L + 1.2 * (B - L);
    }
    x.putImageData(id, 0, 0);
  } catch (e) { /* image illisible : fond uni */ }
  soft.set(img, c); return c;
}
function drawBackdrop() {
  if (!shown) { bctx.fillStyle = '#0b1430'; bctx.fillRect(0, 0, BW, BH); return; }
  const [a, b, mix] = shown;
  bctx.globalAlpha = 1; bctx.drawImage(softOf(a), 0, 0);
  if (b && mix > 0) { bctx.globalAlpha = Math.min(1, mix); bctx.drawImage(softOf(b), 0, 0); bctx.globalAlpha = 1; }
}
// Affiche le décor « a » flouté ; avec « b » et « mix » (0 à 1), un fondu de a vers b (pendant un changement de page)
export function setBackdrop(a, b, mix) { shown = a ? [a, b || null, b ? mix || 0 : 0] : null; drawBackdrop(); }
// Prépare à l'avance les versions floutées (pendant le chargement, pour ne rien calculer plus tard)
export function warmBackdrop(imgs) { imgs.forEach((im) => im && softOf(im)); }
// Le flou garde la même force à l'écran (environ 26 px) quelle que soit sa taille
onResize(() => {
  const s = Math.min(7, Math.max(2.5, 26 / Math.max((innerWidth + 80) / BW, (innerHeight + 80) / BH)));
  if (Math.abs(s - sigma) > 0.4) { sigma = s; const keep = [...soft.keys()]; soft.clear(); keep.forEach(softOf); drawBackdrop(); }
});
