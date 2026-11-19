// Se déplacer sur la carte : où l'on peut marcher, où est l'eau, et quel chemin prendre (par les ponts) pour aller
// d'un point à un autre. La grille vient de src/data/map.js : une case = CELL pixels de la carte.
// Les animaux aquatiques ont leur propre grille : la rivière, passages sous les ponts compris (SWIM).
import { GRID_RLE, SWIM_RLE, GW, GH, CELL } from '../data/map.js';

export const WATER = 7;
const N = GW * GH;
const unrle = (rle) => {
  const g = new Uint8Array(N); let i = 0, m;
  const re = /(\d)(?:([a-z])|\((\d+)\))/g;
  while ((m = re.exec(rle))) { const n = m[2] ? m[2].charCodeAt(0) - 96 : +m[3]; g.fill(+m[1], i, i + n); i += n; }
  return g;
};
export const GRID = unrle(GRID_RLE);
export const SWIM = unrle(SWIM_RLE);
const okLand = (c) => { const v = GRID[c]; return v > 0 && v < WATER; };
const ok = okLand;
const okSwim = (c) => SWIM[c] === 1;
export const cellOf = (x, y) => { const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : gy * GW + gx; };
// 0 interdit, 1 haut, 2 bas, 3 gauche, 4 droite, 5 centre, 6 pont, 7 eau
export const zoneAt = (x, y) => { const c = cellOf(x, y); return c < 0 ? 0 : GRID[c]; };
export const walkable = (x, y) => { const c = cellOf(x, y); return c >= 0 && ok(c); };
export const swimmable = (x, y) => { const c = cellOf(x, y); return c >= 0 && okSwim(c); };
const cx = (c) => (c % GW + 0.5) * CELL, cy = (c) => (Math.floor(c / GW) + 0.5) * CELL;

// ---------- distance à l'eau (pour l'éléphant qui y puise) : deux passes sur la grille ----------
export const WATER_CELLS = [];
const wd = new Float32Array(N), wsrc = new Int32Array(N);
(() => {
  for (let c = 0; c < N; c++) { if (GRID[c] === WATER) { wd[c] = 0; wsrc[c] = c; WATER_CELLS.push(c); } else { wd[c] = 1e9; wsrc[c] = -1; } }
  const relax = (c, n, d) => { if (wd[n] + d < wd[c]) { wd[c] = wd[n] + d; wsrc[c] = wsrc[n]; } };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = y * GW + x;
    if (x > 0) relax(c, c - 1, 1); if (y > 0) relax(c, c - GW, 1);
    if (x > 0 && y > 0) relax(c, c - GW - 1, 1.414); if (x < GW - 1 && y > 0) relax(c, c - GW + 1, 1.414);
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const c = y * GW + x;
    if (x < GW - 1) relax(c, c + 1, 1); if (y < GH - 1) relax(c, c + GW, 1);
    if (x < GW - 1 && y < GH - 1) relax(c, c + GW + 1, 1.414); if (x > 0 && y < GH - 1) relax(c, c + GW - 1, 1.414);
  }
})();
// Distance (px) jusqu'à l'eau la plus proche, et ce point d'eau
export function waterNear(x, y) {
  const c = cellOf(x, y); if (c < 0 || wsrc[c] < 0) return null;
  return { d: wd[c] * CELL, x: cx(wsrc[c]), y: cy(wsrc[c]) };
}

// ---------- distance à la rivière navigable (portée des animaux aquatiques) ----------
const sd = new Float32Array(N), ssrc = new Int32Array(N);
(() => {
  for (let c = 0; c < N; c++) { if (okSwim(c)) { sd[c] = 0; ssrc[c] = c; } else { sd[c] = 1e9; ssrc[c] = -1; } }
  const relax = (c, n, d) => { if (sd[n] + d < sd[c]) { sd[c] = sd[n] + d; ssrc[c] = ssrc[n]; } };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = y * GW + x;
    if (x > 0) relax(c, c - 1, 1); if (y > 0) relax(c, c - GW, 1);
    if (x > 0 && y > 0) relax(c, c - GW - 1, 1.414); if (x < GW - 1 && y > 0) relax(c, c - GW + 1, 1.414);
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const c = y * GW + x;
    if (x < GW - 1) relax(c, c + 1, 1); if (y < GH - 1) relax(c, c + GW, 1);
    if (x < GW - 1 && y < GH - 1) relax(c, c + GW + 1, 1.414); if (x > 0 && y < GH - 1) relax(c, c + GW - 1, 1.414);
  }
})();
// Distance (px) jusqu'à la rivière navigable la plus proche, et ce point d'eau
export function swimNear(x, y) {
  const c = cellOf(Math.max(0, Math.min(GW * CELL - 1, x)), Math.max(0, Math.min(GH * CELL - 1, y))); if (c < 0 || ssrc[c] < 0) return null;
  return { d: sd[c] * CELL, x: cx(ssrc[c]), y: cy(ssrc[c]) };
}
// ---------- les ponts vus de la rivière : distance (px) au plus proche passage sous un tablier ----------
// Un nageur qui passe sous un pont disparaît (src/render/view.js) : il ne s'y arrête jamais (ni pour frapper, ni pour
// tenir une place), il va jusqu'à l'eau dégagée la plus proche.
const bd = new Float32Array(N);
(() => {
  for (let c = 0; c < N; c++) bd[c] = SWIM[c] === 1 && GRID[c] === 6 ? 0 : 1e9;
  const relax = (c, n, d) => { if (bd[n] + d < bd[c]) bd[c] = bd[n] + d; };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = y * GW + x;
    if (x > 0) relax(c, c - 1, 1); if (y > 0) relax(c, c - GW, 1);
    if (x > 0 && y > 0) relax(c, c - GW - 1, 1.414); if (x < GW - 1 && y > 0) relax(c, c - GW + 1, 1.414);
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const c = y * GW + x;
    if (x < GW - 1) relax(c, c + 1, 1); if (y < GH - 1) relax(c, c + GW, 1);
    if (x < GW - 1 && y < GH - 1) relax(c, c + GW + 1, 1.414); if (x > 0 && y < GH - 1) relax(c, c + GW - 1, 1.414);
  }
})();
export const CLEAR = 40;
export const bridgeNear = (x, y) => { const c = cellOf(x, y); return c < 0 ? 999 : bd[c] * CELL; };
export const bridgeExit = (x, y) => nearest(x, y, (px, py) => bridgeNear(px, py) >= CLEAR, true);

// Eau où chaque camp peut poser ses animaux aquatiques : le bout de la rivière, juste à côté de sa tente (bleue en bas,
// rouge en haut). Plus loin, un nageur posé irait trop vite chez l'adversaire.
// L'eau d'où un nageur peut frapper le camp « side » : un peu plus large que celle où l'on pose, mais pas jusqu'aux ponts
export const campWater = (side, x, y) => swimmable(x, y) && (side === 0 ? y >= 1123 && Math.hypot(x - 512, y - 1362) <= 406 : y <= 448 && Math.hypot(x - 512, y - 208) <= 406);
export const swimHome = (side, x, y) => swimmable(x, y) && (side === 0 ? y >= 1174 && Math.hypot(x - 512, y - 1362) <= 345 : y <= 397 && Math.hypot(x - 512, y - 208) <= 345);

// Y a-t-il du sol (ou de l'eau, pour un nageur) tout le long du segment ?
export function los(x0, y0, x1, y1, swim = false) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / (CELL * 0.5)), f = swim ? swimmable : walkable;
  for (let i = 1; i <= n; i++) { const t = i / n; if (!f(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
  return true;
}
// Le point de sol le plus proche (recherche par anneaux de cases). zones : liste de zones permises, ou rien ;
// ou une fonction (x, y) → vrai pour les cases permises ; swim : chercher dans la rivière navigable.
export function nearest(x, y, zones = null, swim = false) {
  const gx0 = Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), gy0 = Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)));
  const pass = swim ? okSwim : ok;
  const good = typeof zones === 'function' ? (c) => pass(c) && zones(cx(c), cy(c)) : (c) => pass(c) && (!zones || zones.includes(GRID[c]));
  if (good(gy0 * GW + gx0) && cellOf(x, y) === gy0 * GW + gx0) return { x, y };
  let best = -1, bd = Infinity;
  for (let r = 0; r < 90; r++) {
    for (let gy = gy0 - r; gy <= gy0 + r; gy++) {
      if (gy < 0 || gy >= GH) continue;
      const stepX = gy === gy0 - r || gy === gy0 + r ? 1 : 2 * r || 1;
      for (let gx = gx0 - r; gx <= gx0 + r; gx += stepX) {
        if (gx < 0 || gx >= GW) continue;
        const c = gy * GW + gx; if (!good(c)) continue;
        const d = Math.hypot(cx(c) - x, cy(c) - y); if (d < bd) { bd = d; best = c; }
      }
    }
    if (best >= 0 && bd <= (r + 0.5) * CELL) break;
  }
  return best < 0 ? null : { x: cx(best), y: cy(best) };
}

// ---------- A* sur la grille (8 voisins, sans couper les coins) ----------
const gS = new Float32Array(N), from = new Int32Array(N), seen = new Uint32Array(N), shut = new Uint32Array(N);
const heap = new Int32Array(N * 4), hf = new Float32Array(N * 4);
let gen = 0, hn = 0;
function push(c, f) { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; } heap[i] = c; hf[i] = f; }
function pop() {
  const top = heap[0]; hn--;
  if (hn > 0) {
    const c = heap[hn], f = hf[hn]; let i = 0;
    for (;;) { let k = 2 * i + 1; if (k >= hn) break; if (k + 1 < hn && hf[k + 1] < hf[k]) k++; if (hf[k] >= f) break; heap[i] = heap[k]; hf[i] = hf[k]; i = k; }
    heap[i] = c; hf[i] = f;
  }
  return top;
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
// Chemin de (sx, sy) vers (tx, ty). reach : on s'arrête dès qu'on est à moins de « reach » pixels du but (utile quand
// le but est une structure sur laquelle on ne marche pas) ; done(x, y) : autre façon de dire « on est arrivé ».
// swim : par la rivière (animaux aquatiques). Renvoie une liste de points [x, y] ou null.
export function findPath(sx, sy, tx, ty, reach = 0, done = null, swim = false) {
  const ok = swim ? okSwim : okLand, walk = swim ? swimmable : walkable, see = (a, b, c, d) => los(a, b, c, d, swim);
  let s = cellOf(sx, sy);
  if (s < 0 || !ok(s)) { const p = nearest(sx, sy, null, swim); if (!p) return null; s = cellOf(p.x, p.y); }
  let goal = cellOf(tx, ty);
  if (reach <= 0 && (goal < 0 || !ok(goal))) { const p = nearest(tx, ty, null, swim); if (!p) return null; tx = p.x; ty = p.y; goal = cellOf(tx, ty); }
  gen++; hn = 0;
  const hfn = (c) => { const dx = Math.abs(cx(c) - tx), dy = Math.abs(cy(c) - ty); return Math.max(0, (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) - reach) / CELL; };
  gS[s] = 0; from[s] = -1; seen[s] = gen; push(s, hfn(s));
  let end = -1, best = s, bh = hfn(s), guard = 0;
  while (hn > 0 && guard++ < N * 2) {
    const c = pop(); if (shut[c] === gen) continue; shut[c] = gen;
    const h0 = hfn(c); if (h0 < bh) { bh = h0; best = c; }
    if (c === goal || (done ? done(cx(c), cy(c)) : reach > 0 && Math.hypot(cx(c) - tx, cy(c) - ty) <= reach)) { end = c; break; }
    const x = c % GW, y = (c - x) / GW;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k]; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (!ok(n) || shut[n] === gen) continue;
      if (k >= 4 && (!ok(y * GW + nx) || !ok(ny * GW + x))) continue;
      const g = gS[c] + (k < 4 ? 1 : 1.414);
      if (seen[n] !== gen || g < gS[n]) { gS[n] = g; from[n] = c; seen[n] = gen; push(n, g + hfn(n)); }
    }
  }
  if (end < 0) end = best;              // but hors d'atteinte : on s'en approche au mieux
  const cells = []; for (let c = end; c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  // on tend le fil : on ne garde que les points où il faut tourner
  const pts = []; let ax = sx, ay = sy, i = 0;
  if (!walk(sx, sy)) { ax = cx(cells[0]); ay = cy(cells[0]); pts.push([ax, ay]); }
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !see(ax, ay, cx(cells[j]), cy(cells[j]))) j = i + 1 + ((j - i - 1) >> 1);
    while (j < cells.length - 1 && see(ax, ay, cx(cells[j + 1]), cy(cells[j + 1]))) j++;
    ax = cx(cells[j]); ay = cy(cells[j]); pts.push([ax, ay]); i = j;
  }
  if (!pts.length) pts.push([cx(end), cy(end)]);
  if (reach <= 0 && end === goal) pts[pts.length - 1] = [tx, ty];
  return pts;
}
