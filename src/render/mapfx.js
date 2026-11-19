// La carte vivante : eau qui miroite et qui coule, cascades, bannières au vent, spectateurs qui sautent dans les
// tribunes, torches, et ce qui flotte dans l'air. Chaque arène a son ambiance (THEMES) : feuilles sur l'Île Tropicale,
// rivière de chocolat et vermicelles au Royaume Sucré, poussière et virevoltants au Canyon Brûlant, lave qui luit et
// bouillonne, fumée des petits volcans et cendres au Volcan Rugissant, pétales et éclats d'or au Palais Royal.
// Tout est dessiné par-dessus l'image de fond, en coordonnées de la carte (1024 × 1536, en hauteur) ; rien ici ne
// touche au jeu lui-même.
import { IMG } from '../core/assets.js';
import { rand } from '../core/utils.js';
import { MAP_W, MAP_H, MAP_K, CELL, GW, CROWD } from '../data/map.js';
import { WATER_CELLS } from '../game/nav.js';

// bannières : [x, y, largeur, hauteur] de chaque étoffe dans l'image
const BANNERS = [[318, 6, 68, 102], [638, 6, 68, 102], [54, 204, 66, 112], [904, 204, 66, 112], [34, 1328, 88, 134], [902, 1328, 88, 134], [317, 1404, 69, 124], [634, 1404, 69, 124]];
// torches : le milieu de chaque flamme peinte
const TORCHES = [[280, 60], [743, 61], [374, 169], [650, 170], [36, 1054], [988, 1054], [282, 1425], [742, 1425]];
// cascades : la bande où l'eau tombe (sl : elle penche de sl pixel par pixel de chute), et le pied de la chute
const FALLS = [{ x: 212, y: 210, w: 36, h: 62, sl: 0.28, px: 244, py: 282 }, { x: 776, y: 210, w: 36, h: 62, sl: -0.3, px: 778, py: 283 }];

// Ambiance de chaque arène (id de src/data/arenas.js). tile : couleur des reflets de l'eau ; wa : leur force ; flow : vitesse
// du courant ; glint : éclats de soleil sur l'eau (rien : des bulles de lave) ; fall, foam, ring, bubble : filets des
// cascades, écume, remous et gouttes (« r,g,b ») ; deep : l'ombre sous un nageur ; air : ce qui vole au-dessus de l'arène
const THEMES = {
  arena: { tile: [235, 250, 255], wa: 0.36, flow: 1, glint: '255,255,255', fall: '255,255,255', foam: '255,255,255', ring: '235,250,255', bubble: '220,245,255', deep: '10,40,90', air: 'leaves' },
  bonbons: { tile: [255, 238, 214], wa: 0.22, flow: 0.55, glint: '255,242,222', fall: '255,230,200', foam: '255,244,228', ring: '255,232,205', bubble: '255,236,214', deep: '60,24,8', air: 'sprinkles' },
  desert: { tile: [225, 255, 250], wa: 0.32, flow: 0.9, glint: '255,255,255', fall: '255,255,255', foam: '255,255,255', ring: '225,250,248', bubble: '220,250,245', deep: '8,50,60', air: 'dust' },
  volcan: { tile: [255, 206, 104], wa: 0.42, flow: 0.35, glint: null, fall: '255,228,136', foam: '255,214,112', ring: '255,190,90', bubble: '255,212,120', deep: '90,16,0', air: 'ash', lava: true },
  royal: { tile: [240, 250, 255], wa: 0.4, flow: 1, glint: '255,255,255', fall: '255,255,255', foam: '255,255,255', ring: '235,250,255', bubble: '220,245,255', deep: '10,40,90', air: 'petals', twinkle: true },
};
const LEAVES = ['#7ed321', '#b8e04a', '#f5c04a', '#5fbf3a', '#ff9a4a'];
const PETALS = ['#ff8fb8', '#ffc2d8', '#ff5d8f', '#fff0f5', '#e85b9a'];
const SPRINKLES = ['#ff6fb1', '#7ad7ff', '#ffe066', '#9dff8a', '#ffffff', '#c98bff', '#ff9a4a'];
const ASH = ['#6b6470', '#8a8290', '#4e4a55', '#a39aa8'];

// Tuile de reflets (réseau de lignes claires qui se raccorde sur ses bords), calculée une fois par couleur
const TILES = {};
function causticTile(rgb, n = 128, cells = 4) {
  const key = rgb.join(','); if (TILES[key]) return TILES[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), id = g.createImageData(n, n), d = id.data, pts = [];
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < cells * cells; i++) pts.push([((i % cells) + 0.15 + 0.7 * rnd()) / cells * n, (Math.floor(i / cells) + 0.15 + 0.7 * rnd()) / cells * n]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let f1 = 1e9, f2 = 1e9;
    for (const [px, py] of pts) {
      let dx = Math.abs(x - px), dy = Math.abs(y - py); if (dx > n / 2) dx = n - dx; if (dy > n / 2) dy = n - dy;
      const q = dx * dx + dy * dy; if (q < f1) { f2 = f1; f1 = q; } else if (q < f2) f2 = q;
    }
    const e = Math.sqrt(f2) - Math.sqrt(f1), v = Math.max(0, 1 - e / 7), o = (y * n + x) * 4;
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.round(255 * v * v);
  }
  g.putImageData(id, 0, 0);
  return (TILES[key] = cv);
}
const inR = (R, x, y, m = 0) => x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m;
// petite étoile à quatre branches (éclat d'or, de gemme ou de sucre)
function star(c, x, y, s, a, col = '255,246,206') {
  c.fillStyle = `rgba(${col},${a})`;
  c.beginPath(); c.ellipse(x, y, s * 1.6, s * 0.2, 0, 0, 6.3); c.fill();
  c.beginPath(); c.ellipse(x, y, s * 0.2, s * 1.6, 0, 0, 6.3); c.fill();
  c.fillStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.arc(x, y, s * 0.34, 0, 6.3); c.fill();
}

export class MapFx {
  constructor() {
    this.t = 0; this.cheer = 0; this.wc = null; this.glints = []; this.leaves = []; this.embers = []; this.streaks = []; this.rings = [];
    this.dust = []; this.tw = []; this.puffs = []; this.drops = []; this.weed = null; this.weedT = 6;
    this.clouds = [0, 1, 2].map((i) => ({ x: 100 + i * 380, y: 260 + i * 480, r: 210 + i * 30, v: 9 + i * 3 }));
    this.setArena(null);
  }
  setArena(A) {
    this.A = A; this.th = THEMES[A ? A.id : 'arena'] || THEMES.arena; this.pat = null;
    this.crowd = (A && A.crowd ? A.crowd : CROWD).map(([x, y], i) => ({ x, y, ph: (i * 2.399) % 6.283, sp: 3.2 + ((i * 7) % 10) * 0.22, amp: 1.2 + ((i * 13) % 7) * 0.22, hop: 0 }));
  }
  reset(A) {
    if (A !== undefined) this.setArena(A);
    for (const k of ['glints', 'leaves', 'embers', 'streaks', 'rings', 'dust', 'tw', 'puffs', 'drops']) this[k].length = 0;
    this.cheer = 0; this.weed = null; this.weedT = rand(4, 9);
  }
  // les tribunes s'enflamment (k de 0 à 1) : tour prise, jauge qui grimpe, fin du combat
  excite(k) { this.cheer = Math.min(1.6, Math.max(this.cheer, k)); }

  // ---------- sous les animaux : eau, cascades, lueur de la lave, bannières, tribunes, torches ----------
  ground(c, R, dt) {
    this.t += dt; const t = this.t;
    this.cheer = Math.max(0, this.cheer - dt * 0.35);
    this.water(c, R, t, dt);
    this.falls(c, R, dt, t);
    if (this.th.lava) this.lavaGlow(c, R, t);
    const map = IMG.map;
    if (map && map.width) {
      // bannières : chaque bande horizontale glisse un peu, de plus en plus vers le bas de l'étoffe
      for (let i = 0; i < BANNERS.length; i++) {
        const [x, y, w, h] = BANNERS[i]; if (x > R.x1 || x + w < R.x0 || y > R.y1 || y + h < R.y0) continue;
        const st = 3;
        for (let r = 6; r < h; r += st) {
          const k = r / h, dx = Math.sin(t * 2.3 + i * 1.3 - r * 0.11) * 2.6 * k * k + Math.sin(t * 5.1 + i - r * 0.3) * 0.5 * k;
          c.drawImage(map, (x - 3) * MAP_K, (y + r) * MAP_K, (w + 6) * MAP_K, st * MAP_K, x - 3 + dx, y + r, w + 6, st + 0.4);
        }
      }
      // spectateurs : chacun s'étire vers le haut à son rythme, tous ensemble quand l'arène s'enflamme
      const ex = this.cheer;
      for (const s of this.crowd) {
        if (s.x < R.x0 - 12 || s.x > R.x1 + 12 || s.y < R.y0 - 20 || s.y > R.y1 + 20) continue;
        const up = Math.max(0, Math.sin(t * s.sp * (1 + ex * 0.5) + s.ph)) * s.amp * (1 + ex * 2.2);
        if (up < 0.25) continue;
        const x0 = Math.max(0, s.x - 8), y0 = Math.max(0, s.y - 17), w = 16, h = 26;
        c.drawImage(map, x0 * MAP_K, y0 * MAP_K, w * MAP_K, h * MAP_K, x0, y0 - up, w, h + up);
      }
    }
    // torches : halo qui tremble et braises qui montent
    for (let i = 0; i < TORCHES.length; i++) {
      const [x, y] = TORCHES[i]; if (x < R.x0 - 60 || x > R.x1 + 60 || y < R.y0 - 60 || y > R.y1 + 60) continue;
      const f = 0.75 + 0.15 * Math.sin(t * 13 + i * 2) + 0.1 * Math.sin(t * 29 + i);
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(x, y, 1, x, y, 48 * f); g.addColorStop(0, `rgba(255,210,110,${0.55 * f})`); g.addColorStop(0.4, `rgba(255,140,40,${0.22 * f})`); g.addColorStop(1, 'rgba(255,90,0,0)');
      c.fillStyle = g; c.fillRect(x - 50, y - 50, 100, 100);
      // flamme : deux gouttes qui dansent
      for (let k = 0; k < 2; k++) {
        const hh = (13 + 4 * Math.sin(t * 17 + i + k * 2)) * (k ? 0.6 : 1), ww = (5.8 - k * 2.2), sx = Math.sin(t * 11 + i * 3 + k) * 1.7;
        c.fillStyle = k ? 'rgba(255,250,200,.85)' : 'rgba(255,170,40,.75)';
        c.beginPath(); c.moveTo(x - ww, y + 3); c.quadraticCurveTo(x - ww * 1.2, y - hh * 0.4, x + sx, y - hh); c.quadraticCurveTo(x + ww * 1.2, y - hh * 0.4, x + ww, y + 3); c.closePath(); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      if (Math.random() < dt * 5) this.embers.push({ x: x + rand(-4, 4), y: y - 6, vx: rand(-7, 7), vy: rand(-30, -16), age: 0, life: rand(0.6, 1.3) });
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i]; e.age += dt; if (e.age >= e.life) { this.embers.splice(i, 1); continue; }
      e.x += (e.vx + Math.sin(t * 6 + i) * 6) * dt; e.y += e.vy * dt;
      c.fillStyle = `rgba(255,${170 + Math.round(60 * (1 - e.age / e.life))},60,${0.9 * (1 - e.age / e.life)})`; c.fillRect(e.x - 1.2, e.y - 1.2, 2.4, 2.4);
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Eau (ou chocolat, ou lave) : deux nappes de reflets qui glissent l'une sur l'autre, découpées par le masque de
  // l'eau, puis des éclats de soleil (ou des bulles de lave qui gonflent et crèvent)
  water(c, R, t, dt) {
    const mask = IMG.water, th = this.th; if (!mask || !mask.width) return;
    if (!this.wc) this.wc = document.createElement('canvas');
    const S = 0.5, x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0)), x1 = Math.min(MAP_W, Math.ceil(R.x1)), y1 = Math.min(MAP_H, Math.ceil(R.y1));
    const w = x1 - x0, h = y1 - y0; if (w <= 2 || h <= 2) return;
    const wc = this.wc, cw = Math.ceil(w * S), ch = Math.ceil(h * S);
    if (wc.width < cw || wc.height < ch) { wc.width = Math.max(wc.width, cw + 16); wc.height = Math.max(wc.height, ch + 16); }
    const g = wc.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, wc.width, wc.height);
    if (!this.pat) this.pat = g.createPattern(causticTile(th.tile), 'repeat');
    g.fillStyle = this.pat;
    const f = th.flow, layer = (sc, ox, oy, al) => { g.setTransform(S * sc, 0, 0, S * sc, (-x0 + ox) * S, (-y0 + oy) * S); g.globalAlpha = al; g.fillRect((x0 - ox) / sc, (y0 - oy) / sc, w / sc + 2, h / sc + 2); };
    layer(0.62, t * 7 * f, t * 4 * f, 0.85); g.globalCompositeOperation = 'lighter'; layer(0.9, -t * 5 * f, t * 6.5 * f, 0.6);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, x0, y0, w, h, 0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = th.wa + 0.06 * Math.sin(t * 1.3);
    c.drawImage(wc, 0, 0, cw, ch, x0, y0, w, h);
    c.globalAlpha = 1;
    const G = this.glints;
    if (G.length < (th.lava ? 34 : 26) && WATER_CELLS.length) for (let k = 0; k < 2; k++) {
      const cell = WATER_CELLS[Math.floor(Math.random() * WATER_CELLS.length)], gx = (cell % GW + Math.random()) * CELL, gy = (Math.floor(cell / GW) + Math.random()) * CELL;
      if (gx > R.x0 && gx < R.x1 && gy > R.y0 && gy < R.y1) G.push({ x: gx, y: gy, age: 0, life: th.lava ? rand(0.9, 1.8) : rand(0.6, 1.4), s: th.lava ? rand(2.2, 5) : rand(4, 9) });
    }
    for (let i = G.length - 1; i >= 0; i--) {
      const q = G[i]; q.age += dt || 1 / 60; if (q.age >= q.life) { G.splice(i, 1); continue; }
      if (th.lava) {
        // bulle de lave : elle gonfle, brille, puis crève en un petit anneau
        const k = q.age / q.life;
        if (k < 0.78) {
          const r = q.s * (0.3 + 0.7 * k / 0.78);
          c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.9;
          c.fillStyle = 'rgba(150,34,0,.55)'; c.beginPath(); c.arc(q.x, q.y + r * 0.25, r * 1.1, 0, 6.3); c.fill();
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = 'rgba(255,214,110,.9)'; c.beginPath(); c.arc(q.x, q.y, r, 0, 6.3); c.fill();
          c.fillStyle = 'rgba(255,255,220,.8)'; c.beginPath(); c.arc(q.x - r * 0.3, q.y - r * 0.35, r * 0.32, 0, 6.3); c.fill();
        } else {
          const p = (k - 0.78) / 0.22; c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - p;
          c.strokeStyle = 'rgba(255,200,90,.9)'; c.lineWidth = 1.6; c.beginPath(); c.ellipse(q.x, q.y, q.s * (1 + 1.6 * p), q.s * (1 + 1.6 * p) * 0.5, 0, 0, 6.3); c.stroke();
        }
        continue;
      }
      const k = Math.sin(q.age / q.life * Math.PI), s = q.s * (0.5 + 0.8 * k);
      c.globalAlpha = 0.8 * k; c.fillStyle = `rgb(${th.glint})`;
      c.beginPath(); c.ellipse(q.x, q.y, s * 1.5, s * 0.22, 0, 0, 6.3); c.fill(); c.beginPath(); c.ellipse(q.x, q.y, s * 0.2, s * 0.8, 0, 0, 6.3); c.fill();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // Volcan : les fissures, les coulées et la rivière de lave luisent par vagues (deux calques qui pulsent tour à tour).
  // Les deux calques sont d'abord mêlés en petit (au quart de la carte), puis posés d'un seul coup sur l'arène.
  glowLayer(t) {
    const gl = IMG.glow; if (!gl || !gl.width) return null;
    const hw = gl.width / 2, hh = gl.height;
    if (!this.lc) this.lc = document.createElement('canvas');
    const cv = this.lc; if (cv.width !== hw || cv.height !== hh) { cv.width = hw; cv.height = hh; }
    if (this.lcT === t) return cv;
    this.lcT = t;
    const g = cv.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, hw, hh);
    g.globalAlpha = Math.max(0, 0.24 + 0.2 * Math.sin(t * 1.5) + 0.05 * Math.sin(t * 7.3)); g.drawImage(gl, 0, 0, hw, hh, 0, 0, hw, hh);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.max(0, 0.24 + 0.2 * Math.sin(t * 1.5 + 2.7) + 0.05 * Math.sin(t * 6.1 + 1)); g.drawImage(gl, hw, 0, hw, hh, 0, 0, hw, hh);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return cv;
  }
  lavaGlow(c, R, t) {
    const lc = this.glowLayer(t); if (!lc) return;
    const sx = lc.width / MAP_W, sy = lc.height / MAP_H;
    const x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0)), x1 = Math.min(MAP_W, Math.ceil(R.x1)), y1 = Math.min(MAP_H, Math.ceil(R.y1));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    c.globalCompositeOperation = 'lighter';
    c.drawImage(lc, x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy, x0, y0, x1 - x0, y1 - y0);
    c.globalCompositeOperation = 'source-over';
  }

  // Un petit volcan vient d'être redessiné devant les animaux (src/render/view.js) : sa lave luit avec le reste.
  // p : son rectangle dans l'atlas ; la lueur de chaque calque est découpée une fois à sa forme (pour ne pas éclairer
  // deux fois le sol autour), puis posée à chaque image avec l'intensité du moment.
  decoGlow(c, p) {
    const gl = IMG.glow, im = IMG.props; if (!this.th.lava || !p || !gl || !gl.width || !im || !im.width) return;
    const w = p[2], h = p[3], mx = p[4], my = p[5], mw = w / MAP_K, mh = h / MAP_K, t = this.t;
    if (!this.dg || this.dg.im !== im || this.dg.gl !== gl) this.dg = { im, gl, cut: new Map() };
    let cut = this.dg.cut.get(p);
    if (!cut) {
      const hw = gl.width / 2, sx = hw / MAP_W, sy = gl.height / MAP_H;
      cut = [0, 1].map((k) => {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.drawImage(gl, k * hw + mx * sx, my * sy, mw * sx, mh * sy, 0, 0, w, h);
        g.globalCompositeOperation = 'destination-in'; g.drawImage(im, p[0], p[1], w, h, 0, 0, w, h);
        return cv;
      });
      this.dg.cut.set(p, cut);
    }
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = Math.max(0, 0.24 + 0.2 * Math.sin(t * 1.5) + 0.05 * Math.sin(t * 7.3)); c.drawImage(cut[0], mx, my, mw, mh);
    c.globalAlpha = Math.max(0, 0.24 + 0.2 * Math.sin(t * 1.5 + 2.7) + 0.05 * Math.sin(t * 6.1 + 1)); c.drawImage(cut[1], mx, my, mw, mh);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // Cascades : filets qui tombent, écume et ronds dans le bassin (eau, chocolat ou lave selon l'arène)
  falls(c, R, dt, t) {
    const th = this.th;
    for (let i = 0; i < FALLS.length; i++) {
      const F = FALLS[i]; if (F.x > R.x1 + 40 || F.x + F.w < R.x0 - 40 || F.y > R.y1 + 80 || F.y + F.h < R.y0 - 40) continue;
      if (Math.random() < dt * 34) this.streaks.push({ f: i, x: F.x + rand(2, F.w - 2), y: F.y + rand(0, 8), v: rand(70, 110) * (th.lava ? 0.6 : 1), len: rand(6, 14), a: rand(0.35, 0.8) });
      if (Math.random() < dt * 2.2) this.rings.push({ x: F.px + rand(-8, 8), y: F.py + rand(-2, 4), age: 0, life: rand(0.9, 1.5) });
      if (th.lava) {     // la lave qui tombe éclaire le bassin
        c.globalCompositeOperation = 'lighter';
        const gg = c.createRadialGradient(F.px, F.py - 6, 2, F.px, F.py - 6, 44); gg.addColorStop(0, `rgba(255,190,80,${0.5 + 0.12 * Math.sin(t * 5 + i)})`); gg.addColorStop(1, 'rgba(255,90,0,0)');
        c.fillStyle = gg; c.fillRect(F.px - 46, F.py - 52, 92, 92); c.globalCompositeOperation = 'source-over';
      }
      // écume au pied de la chute
      c.fillStyle = `rgba(${th.foam},.75)`;
      for (let k = 0; k < 7; k++) { const a = t * 3 + k * 0.9 + i, r = 3 + 1.6 * Math.sin(t * 7 + k * 2); c.beginPath(); c.arc(F.px + Math.cos(a) * 14 * (0.5 + 0.5 * Math.sin(k * 3 + t)), F.py - 4 + Math.sin(a * 1.3) * 3.5, r, 0, 6.3); c.fill(); }
    }
    c.lineCap = 'round';
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i], F = FALLS[s.f]; s.y += s.v * dt; s.x += s.v * dt * F.sl;
      if (s.y > F.y + F.h) { this.streaks.splice(i, 1); continue; }
      const e = Math.min(F.y + F.h, s.y + s.len);
      c.strokeStyle = `rgba(${th.fall},${s.a})`; c.lineWidth = 2; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + (e - s.y) * F.sl, e); c.stroke();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.age += dt; if (r.age >= r.life) { this.rings.splice(i, 1); continue; }
      const k = r.age / r.life; c.strokeStyle = `rgba(${th.ring},${0.55 * (1 - k)})`; c.lineWidth = 1.8;
      c.beginPath(); c.ellipse(r.x, r.y, 8 + 32 * k, (8 + 32 * k) * 0.42, 0, 0, 6.3); c.stroke();
    }
    c.lineCap = 'butt';
  }
  // Un rond dans l'eau (éléphant qui puise, animal qui passe près de la rive)
  ripple(x, y) { this.rings.push({ x, y, age: 0, life: 1.1 }); }

  // ---------- par-dessus les animaux : ce qui vole dans l'air, fumée des volcans, éclats, ombres de nuages ----------
  sky(c, R, dt) {
    const t = this.t, th = this.th, air = th.air;
    if (air === 'leaves' || air === 'petals') this.flutter(c, R, dt, t, air === 'petals');
    else if (air === 'sprinkles') this.sprinkles(c, R, dt, t);
    else if (air === 'dust') this.sand(c, R, dt, t);
    else if (air === 'ash') this.ash(c, R, dt, t);
    if (th.twinkle || air === 'sprinkles') this.twinkles(c, R, dt);
    // ombres de nuages qui traversent lentement l'arène
    for (const cl of this.clouds) {
      cl.x += cl.v * dt; if (cl.x - cl.r * 1.6 > MAP_W) { cl.x = -cl.r * 1.6; cl.y = rand(100, MAP_H - 100); }
      if (cl.x + cl.r * 1.6 < R.x0 || cl.x - cl.r * 1.6 > R.x1) continue;
      c.save(); c.translate(cl.x, cl.y); c.scale(1.6, 0.8);
      const g = c.createRadialGradient(0, 0, cl.r * 0.2, 0, 0, cl.r); g.addColorStop(0, th.lava ? 'rgba(40,8,0,.14)' : 'rgba(18,10,46,.13)'); g.addColorStop(1, 'rgba(18,10,46,0)');
      c.fillStyle = g; c.fillRect(-cl.r, -cl.r, cl.r * 2, cl.r * 2); c.restore();
    }
  }

  // feuilles (Île Tropicale) ou pétales de rose (Palais Royal) portés par le vent, avec leur ombre au sol
  flutter(c, R, dt, t, petals) {
    const L = this.leaves, cols = petals ? PETALS : LEAVES;
    if (L.length < 16 && Math.random() < dt * 2.6) L.push({ x: rand(R.x0, R.x1 + 120), y: R.y0 - 12 + rand(0, (R.y1 - R.y0) * 0.5), vx: rand(-46, -22), vy: rand(16, 36), rot: rand(0, 6), vr: rand(-3, 3), age: 0, life: rand(5, 9), s: rand(4, 6.6) * (petals ? 0.85 : 1), col: cols[Math.floor(Math.random() * cols.length)], ph: rand(0, 6) });
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; l.age += dt; if (l.age >= l.life || l.x < R.x0 - 40 || l.y > R.y1 + 30) { L.splice(i, 1); continue; }
      const sway = Math.sin(t * 2.2 + l.ph); l.x += (l.vx + sway * 20) * dt; l.y += (l.vy + Math.cos(t * 2.2 + l.ph) * 8) * dt; l.rot += (l.vr + sway * 2) * dt;
      const a = Math.min(1, l.age * 2, (l.life - l.age) * 1.5);
      c.save(); c.translate(l.x, l.y); c.rotate(l.rot); c.scale(1, 0.45 + 0.4 * Math.abs(Math.sin(t * 3 + l.ph)));
      c.globalAlpha = a * 0.3; c.fillStyle = '#140a1e'; c.beginPath(); c.ellipse(6, 32, l.s, l.s * 0.5, 0, 0, 6.3); c.fill();
      c.globalAlpha = a; c.fillStyle = l.col;
      if (petals) { c.beginPath(); c.moveTo(-l.s, 0); c.bezierCurveTo(-l.s * 0.6, -l.s * 1.1, l.s * 0.9, -l.s * 0.8, l.s, 0); c.bezierCurveTo(l.s * 0.5, l.s * 0.7, -l.s * 0.5, l.s * 0.7, -l.s, 0); c.fill(); }
      else {
        c.beginPath(); c.moveTo(-l.s, 0); c.quadraticCurveTo(0, -l.s * 0.9, l.s, 0); c.quadraticCurveTo(0, l.s * 0.9, -l.s, 0); c.fill();
        c.strokeStyle = 'rgba(40,70,10,.5)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(-l.s, 0); c.lineTo(l.s, 0); c.stroke();
      }
      c.restore();
    }
    c.globalAlpha = 1;
  }

  // Royaume Sucré : des vermicelles de toutes les couleurs qui tombent en tournoyant
  sprinkles(c, R, dt, t) {
    const L = this.leaves;
    if (L.length < 24 && Math.random() < dt * 3.4) L.push({ x: rand(R.x0 - 40, R.x1 + 40), y: R.y0 - 10 + rand(0, (R.y1 - R.y0) * 0.45), vx: rand(-14, 14), vy: rand(20, 38), rot: rand(0, 6), vr: rand(-4, 4), age: 0, life: rand(4, 7), s: rand(3.6, 5.2), col: SPRINKLES[Math.floor(Math.random() * SPRINKLES.length)], ph: rand(0, 6) });
    c.lineCap = 'round';
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; l.age += dt; if (l.age >= l.life || l.y > R.y1 + 30) { L.splice(i, 1); continue; }
      l.x += (l.vx + Math.sin(t * 1.8 + l.ph) * 10) * dt; l.y += l.vy * dt; l.rot += l.vr * dt;
      const a = Math.min(1, l.age * 2, (l.life - l.age) * 1.5), dx = Math.cos(l.rot) * l.s * 0.75, dy = Math.sin(l.rot) * l.s * 0.75 * (0.5 + 0.5 * Math.abs(Math.sin(t * 3 + l.ph)));
      c.globalAlpha = a * 0.22; c.strokeStyle = '#3a1030'; c.lineWidth = l.s * 0.6; c.beginPath(); c.moveTo(l.x + 6 - dx, l.y + 30 - dy * 0.5); c.lineTo(l.x + 6 + dx, l.y + 30 + dy * 0.5); c.stroke();
      c.globalAlpha = a; c.strokeStyle = l.col; c.lineWidth = l.s * 0.62; c.beginPath(); c.moveTo(l.x - dx, l.y - dy); c.lineTo(l.x + dx, l.y + dy); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = l.s * 0.18; c.beginPath(); c.moveTo(l.x - dx * 0.6, l.y - dy * 0.6 - 0.8); c.lineTo(l.x + dx * 0.6, l.y + dy * 0.6 - 0.8); c.stroke();
    }
    c.lineCap = 'butt'; c.globalAlpha = 1;
  }

  // Canyon Brûlant : grains de sable qui filent avec le vent, et de temps en temps un virevoltant qui traverse l'arène
  sand(c, R, dt, t) {
    const D = this.dust;
    if (D.length < 50 && Math.random() < dt * 16) D.push({ x: R.x1 + rand(0, 40), y: rand(R.y0, R.y1), vx: -rand(60, 130), vy: rand(-6, 6), age: 0, life: rand(3, 6), s: rand(1.1, 2.4), ph: rand(0, 6) });
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i]; d.age += dt; if (d.age >= d.life || d.x < R.x0 - 20) { D.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += (d.vy + Math.sin(t * 3 + d.ph) * 10) * dt;
      const a = Math.min(1, d.age * 3, (d.life - d.age) * 2) * 0.6;
      c.fillStyle = `rgba(255,224,168,${a})`; c.fillRect(d.x, d.y, d.s * 2.6, d.s * 0.9);
    }
    // virevoltant : boule de brindilles qui roule et rebondit, avec son ombre
    this.weedT -= dt;
    if (!this.weed && this.weedT <= 0) { const y = rand(R.y0 + 140, R.y1 - 120); this.weed = { x: R.x1 + 30, y, r: rand(11, 15), vx: -rand(55, 85), rot: 0, ph: rand(0, 6) }; }
    const w = this.weed;
    if (w) {
      w.x += w.vx * dt; w.rot += w.vx / w.r * dt;
      if (w.x < R.x0 - 40) { this.weed = null; this.weedT = rand(9, 16); }
      else {
        const hop = Math.abs(Math.sin(t * 4.2 + w.ph)) * 9;
        c.globalAlpha = 0.28; c.fillStyle = '#2a1408'; c.beginPath(); c.ellipse(w.x, w.y + w.r * 0.9, w.r * (1 - hop / 30), w.r * 0.32, 0, 0, 6.3); c.fill(); c.globalAlpha = 1;
        c.save(); c.translate(w.x, w.y - hop); c.rotate(w.rot);
        c.lineWidth = 1.5;
        for (let k = 0; k < 7; k++) {
          c.strokeStyle = k % 2 ? '#b0773e' : '#7a4f24';
          c.beginPath(); c.arc(Math.cos(k * 2.3) * w.r * 0.22, Math.sin(k * 1.7) * w.r * 0.22, w.r * (0.55 + 0.07 * k), k * 0.9, k * 0.9 + 3.6); c.stroke();
        }
        c.restore();
      }
    }
  }

  // Volcan Rugissant : cendres qui tombent, braises qui montent de la lave, fumée et gerbes de lave des petits volcans
  ash(c, R, dt, t) {
    const L = this.leaves;
    if (L.length < 26 && Math.random() < dt * 4) L.push({ x: rand(R.x0 - 20, R.x1 + 80), y: R.y0 - 10 + rand(0, (R.y1 - R.y0) * 0.5), vx: rand(-20, -6), vy: rand(9, 20), rot: rand(0, 6), vr: rand(-2, 2), age: 0, life: rand(5, 9), s: rand(1.4, 2.8), col: ASH[Math.floor(Math.random() * ASH.length)], ph: rand(0, 6) });
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; l.age += dt; if (l.age >= l.life || l.y > R.y1 + 20) { L.splice(i, 1); continue; }
      l.x += (l.vx + Math.sin(t * 1.5 + l.ph) * 8) * dt; l.y += l.vy * dt; l.rot += l.vr * dt;
      c.globalAlpha = Math.min(1, l.age * 2, (l.life - l.age) * 1.5) * 0.8; c.fillStyle = l.col;
      c.beginPath(); c.ellipse(l.x, l.y, l.s, l.s * (0.45 + 0.4 * Math.abs(Math.sin(l.rot))), l.rot, 0, 6.3); c.fill();
    }
    c.globalAlpha = 1;
    // braises qui s'échappent de la rivière de lave
    const E = this.dust;
    if (E.length < 40 && WATER_CELLS.length && Math.random() < dt * 14) {
      const cell = WATER_CELLS[Math.floor(Math.random() * WATER_CELLS.length)], x = (cell % GW + Math.random()) * CELL, y = (Math.floor(cell / GW) + Math.random()) * CELL;
      if (inR(R, x, y)) E.push({ x, y, vx: rand(-8, 8), vy: -rand(22, 45), age: 0, life: rand(0.9, 1.9), s: rand(1.2, 2.2), ph: rand(0, 6) });
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = E.length - 1; i >= 0; i--) {
      const e = E[i]; e.age += dt; if (e.age >= e.life) { E.splice(i, 1); continue; }
      e.x += (e.vx + Math.sin(t * 5 + e.ph) * 7) * dt; e.y += e.vy * dt;
      const k = 1 - e.age / e.life; c.fillStyle = `rgba(255,${150 + Math.round(80 * k)},60,${0.9 * k})`; c.fillRect(e.x - e.s, e.y - e.s, e.s * 2, e.s * 2);
    }
    c.globalCompositeOperation = 'source-over';
    // les petits volcans : leur lave luit par-dessus leur image (redessinée devant les animaux), fumée, gerbes
    const decor = (this.A && this.A.decor) || [];
    for (const d of decor) {
      const p = this.A.props[d.prop]; if (!p) continue;
      const bx = p[4], by = p[5], bw = p[2] / MAP_K, bh = p[3] / MAP_K;
      if (!inR(R, bx + bw / 2, by + bh / 2, 120)) continue;
      const [tx, ty] = d.top;
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(tx, ty + 2, 1, tx, ty + 2, 24); g.addColorStop(0, `rgba(255,170,60,${0.4 + 0.15 * Math.sin(t * 3 + tx)})`); g.addColorStop(1, 'rgba(255,80,0,0)');
      c.fillStyle = g; c.fillRect(tx - 26, ty - 24, 52, 52); c.globalCompositeOperation = 'source-over';
      if (Math.random() < dt * 2.6) this.puffs.push({ x: tx + rand(-5, 5), y: ty, vx: rand(-4, 10), vy: -rand(16, 26), age: 0, life: rand(1.8, 2.8), r0: rand(5, 8), r1: rand(18, 26), g: rand(70, 110) });
      if (Math.random() < dt * 0.45) for (let k = 0; k < 6; k++) this.drops.push({ x: tx + rand(-4, 4), y: ty, vx: rand(-45, 45), vy: -rand(70, 130), age: 0, life: rand(0.7, 1.1), s: rand(1.6, 2.8) });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const s = this.puffs[i]; s.age += dt; if (s.age >= s.life) { this.puffs.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; const k = s.age / s.life, r = s.r0 + (s.r1 - s.r0) * k;
      c.globalAlpha = 0.42 * (1 - k) * Math.min(1, s.age * 4); c.fillStyle = `rgb(${s.g},${s.g - 8},${s.g - 4})`;
      c.beginPath(); c.arc(s.x, s.y, r, 0, 6.3); c.fill();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.age += dt; if (d.age >= d.life) { this.drops.splice(i, 1); continue; }
      d.vy += 300 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      c.fillStyle = `rgba(255,${190 - Math.round(70 * d.age / d.life)},70,${1 - d.age / d.life})`; c.beginPath(); c.arc(d.x, d.y, d.s, 0, 6.3); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // éclats qui scintillent : sur l'or et les gemmes du Palais, au hasard sur le sucre du Royaume Sucré
  twinkles(c, R, dt) {
    const T = this.tw, pts = this.A && this.A.sparkles;
    if (T.length < (pts ? 18 : 8) && Math.random() < dt * (pts ? 9 : 3)) {
      let x, y;
      if (pts && pts.length) [x, y] = pts[Math.floor(Math.random() * pts.length)];
      else { x = rand(R.x0, R.x1); y = rand(R.y0, R.y1); }
      if (inR(R, x, y)) T.push({ x, y, age: 0, life: rand(0.45, 0.9), s: rand(3.5, 7) });
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = T.length - 1; i >= 0; i--) {
      const q = T[i]; q.age += dt; if (q.age >= q.life) { T.splice(i, 1); continue; }
      const k = Math.sin(q.age / q.life * Math.PI); star(c, q.x, q.y, q.s * (0.4 + 0.6 * k), 0.9 * k);
    }
    c.globalCompositeOperation = 'source-over';
  }
}
