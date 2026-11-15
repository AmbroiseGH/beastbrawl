// Vie de la page d'accueil : lucioles, lueur et braises des torches, éclats sur le logo et les cascades.
// Un petit canvas posé sur la page (il glisse avec elle et ne capte pas les touchers) ; la boucle s'arrête d'elle-même
// quand la page est retirée, et ne dessine rien quand le menu est caché.
import { h, rand } from '../core/utils.js';

const W = 941, H = 1672, K = 0.6;                 // dessiné à 60 % : des lueurs douces n'ont pas besoin de plus
const TORCH = [[291, 770], [652, 770]];           // les deux flammes de l'îlot
const SPARK_ZONES = [[270, 250, 690, 500, 5], [800, 440, 872, 610, 2], [452, 846, 532, 900, 1]];   // logo, cascade, cascade de l'îlot : [x0, y0, x1, y1, poids]
const glows = {};
function glow(color) {
  if (glows[color]) return glows[color];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff'); g.addColorStop(0.2, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (glows[color] = c);
}

export function ambient() {
  const cv = h('canvas', { class: 'mn-fx' }); cv.width = Math.round(W * K); cv.height = Math.round(H * K);
  const c = cv.getContext('2d'), flies = [], embers = [], stars = [];
  for (let i = 0; i < 14; i++) flies.push({ x: rand(40, W - 40), y: rand(240, 1190), ph: rand(0, 6.3), sp: rand(0.25, 0.7), r: rand(10, 22), a: rand(0.35, 0.8), ax: rand(30, 90), ay: rand(20, 60) });
  const weight = SPARK_ZONES.reduce((s, z) => s + z[4], 0);
  let last = performance.now(), t = 0, away = 0;
  const dot = (x, y, r, col, a) => { c.globalAlpha = a; c.drawImage(glow(col), x - r, y - r, r * 2, r * 2); };
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!cv.isConnected) { away += dt; if (away > 2) return; } else away = 0;     // page retirée : on s'arrête
    requestAnimationFrame(loop);
    if (document.hidden || !cv.isConnected || cv.offsetParent === null) return;
    t += dt; c.setTransform(K, 0, 0, K, 0, 0); c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
    // torches : lueur qui vacille, braises qui montent
    for (const [x, y] of TORCH) {
      const f = 0.55 + 0.22 * Math.sin(t * 11 + x) + 0.14 * Math.sin(t * 23.7 + x * 2);
      dot(x, y, 105 + 16 * f, '#ff9a2e', 0.2 + 0.24 * f);
      if (Math.random() < dt * 5) embers.push({ x: x + rand(-12, 12), y: y - 6, vx: rand(-16, 16), vy: rand(-80, -40), life: rand(0.9, 1.7), age: 0, r: rand(4, 8) });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.age += dt; if (e.age >= e.life) { embers.splice(i, 1); continue; }
      e.x += (e.vx + Math.sin(t * 5 + i) * 14) * dt; e.y += e.vy * dt;
      dot(e.x, e.y, e.r * (1 - 0.5 * e.age / e.life), '#ffb23f', 0.9 * (1 - e.age / e.life));
    }
    // lucioles
    for (const m of flies) {
      const p = t * m.sp + m.ph, a = m.a * (0.45 + 0.55 * Math.sin(p * 2.3) ** 2);
      dot(m.x + Math.sin(p) * m.ax, m.y + Math.sin(p * 1.37 + 1) * m.ay, m.r, '#eaff8a', a * 0.8);
    }
    // éclats : une petite étoile à quatre branches qui s'allume puis s'éteint
    if (Math.random() < dt * 2.4) {
      let r = Math.random() * weight, z = SPARK_ZONES[0];
      for (const s of SPARK_ZONES) { if (r < s[4]) { z = s; break; } r -= s[4]; }
      stars.push({ x: rand(z[0], z[2]), y: rand(z[1], z[3]), age: 0, life: rand(0.5, 0.9), s: z === SPARK_ZONES[0] ? rand(16, 30) : rand(8, 14), rot: rand(-0.3, 0.3) });
    }
    c.fillStyle = '#fff';
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i]; s.age += dt; if (s.age >= s.life) { stars.splice(i, 1); continue; }
      const k = Math.sin(s.age / s.life * Math.PI), z = s.s * k;
      dot(s.x, s.y, z * 1.1, '#fff3b0', 0.55 * k);
      c.globalAlpha = 0.95 * k; c.save(); c.translate(s.x, s.y); c.rotate(s.rot + s.age * 0.8);
      c.beginPath(); c.ellipse(0, 0, z, z * 0.13, 0, 0, 6.2832); c.fill(); c.beginPath(); c.ellipse(0, 0, z * 0.13, z, 0, 0, 6.2832); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  };
  requestAnimationFrame(loop);
  return cv;
}
