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
export function setBackdrop(url) { $('backdrop').style.backgroundImage = url ? `url('${url}')` : ''; }
