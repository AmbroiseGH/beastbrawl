// La carte vivante : eau qui miroite et qui coule, cascades, bannières au vent, spectateurs qui sautent dans les
// tribunes, torches, feuilles, ombres de nuages. Tout est dessiné par-dessus l'image de fond, en
// coordonnées de la carte (1024 × 1536, en hauteur) ; rien ici ne touche au jeu lui-même.
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

// Tuile de reflets (réseau de lignes claires qui se raccorde sur ses bords), calculée une fois
function causticTile(n = 128, cells = 4) {
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
    d[o] = 235; d[o + 1] = 250; d[o + 2] = 255; d[o + 3] = Math.round(255 * v * v);
  }
  g.putImageData(id, 0, 0);
  return cv;
}

export class MapFx {
  constructor() {
    this.t = 0; this.cheer = 0; this.tile = null; this.wc = null; this.glints = []; this.leaves = []; this.embers = []; this.streaks = []; this.rings = [];
    this.crowd = CROWD.map(([x, y], i) => ({ x, y, ph: (i * 2.399) % 6.283, sp: 3.2 + ((i * 7) % 10) * 0.22, amp: 1.2 + ((i * 13) % 7) * 0.22, hop: 0 }));
    this.clouds = [0, 1, 2].map((i) => ({ x: 100 + i * 380, y: 260 + i * 480, r: 210 + i * 30, v: 9 + i * 3 }));
  }
  reset() { this.glints.length = 0; this.leaves.length = 0; this.embers.length = 0; this.streaks.length = 0; this.rings.length = 0; this.cheer = 0; }
  // les tribunes s'enflamment (k de 0 à 1) : tour prise, jauge qui grimpe, fin du combat
  excite(k) { this.cheer = Math.min(1.6, Math.max(this.cheer, k)); }

  // ---------- sous les animaux : eau, cascades, bannières, tribunes, torches ----------
  ground(c, R, dt) {
    this.t += dt; const t = this.t;
    this.cheer = Math.max(0, this.cheer - dt * 0.35);
    this.water(c, R, t);
    this.falls(c, R, dt, t);
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

  // Eau : deux nappes de reflets qui glissent l'une sur l'autre, découpées par le masque de l'eau, puis des éclats
  water(c, R, t) {
    const mask = IMG.water; if (!mask || !mask.width) return;
    if (!this.tile) { this.tile = causticTile(); this.wc = document.createElement('canvas'); }
    const S = 0.5, x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0)), x1 = Math.min(MAP_W, Math.ceil(R.x1)), y1 = Math.min(MAP_H, Math.ceil(R.y1));
    const w = x1 - x0, h = y1 - y0; if (w <= 2 || h <= 2) return;
    const wc = this.wc, cw = Math.ceil(w * S), ch = Math.ceil(h * S);
    if (wc.width < cw || wc.height < ch) { wc.width = Math.max(wc.width, cw + 16); wc.height = Math.max(wc.height, ch + 16); }
    const g = wc.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, wc.width, wc.height);
    if (!this.pat) this.pat = g.createPattern(this.tile, 'repeat');
    g.fillStyle = this.pat;
    const layer = (sc, ox, oy, al) => { g.setTransform(S * sc, 0, 0, S * sc, (-x0 + ox) * S, (-y0 + oy) * S); g.globalAlpha = al; g.fillRect((x0 - ox) / sc, (y0 - oy) / sc, w / sc + 2, h / sc + 2); };
    layer(0.62, t * 7, t * 4, 0.85); g.globalCompositeOperation = 'lighter'; layer(0.9, -t * 5, t * 6.5, 0.6);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, x0, y0, w, h, 0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.36 + 0.06 * Math.sin(t * 1.3);
    c.drawImage(wc, 0, 0, cw, ch, x0, y0, w, h);
    c.globalAlpha = 1;
    // éclats de soleil qui naissent et meurent sur l'eau visible
    const G = this.glints;
    if (G.length < 26 && WATER_CELLS.length) for (let k = 0; k < 2; k++) {
      const cell = WATER_CELLS[Math.floor(Math.random() * WATER_CELLS.length)], gx = (cell % GW + Math.random()) * CELL, gy = (Math.floor(cell / GW) + Math.random()) * CELL;
      if (gx > R.x0 && gx < R.x1 && gy > R.y0 && gy < R.y1) G.push({ x: gx, y: gy, age: 0, life: rand(0.6, 1.4), s: rand(4, 9) });
    }
    for (let i = G.length - 1; i >= 0; i--) {
      const q = G[i]; q.age += 1 / 60; if (q.age >= q.life) { G.splice(i, 1); continue; }
      const k = Math.sin(q.age / q.life * Math.PI), s = q.s * (0.5 + 0.8 * k);
      c.globalAlpha = 0.8 * k; c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(q.x, q.y, s * 1.5, s * 0.22, 0, 0, 6.3); c.fill(); c.beginPath(); c.ellipse(q.x, q.y, s * 0.2, s * 0.8, 0, 0, 6.3); c.fill();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }

  // Cascades : filets d'eau qui tombent, écume et ronds dans le bassin
  falls(c, R, dt, t) {
    for (let i = 0; i < FALLS.length; i++) {
      const F = FALLS[i]; if (F.x > R.x1 + 40 || F.x + F.w < R.x0 - 40 || F.y > R.y1 + 80 || F.y + F.h < R.y0 - 40) continue;
      if (Math.random() < dt * 34) this.streaks.push({ f: i, x: F.x + rand(2, F.w - 2), y: F.y + rand(0, 8), v: rand(70, 110), len: rand(6, 14), a: rand(0.35, 0.8) });
      if (Math.random() < dt * 2.2) this.rings.push({ x: F.px + rand(-8, 8), y: F.py + rand(-2, 4), age: 0, life: rand(0.9, 1.5) });
      // écume au pied de la chute
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (let k = 0; k < 7; k++) { const a = t * 3 + k * 0.9 + i, r = 3 + 1.6 * Math.sin(t * 7 + k * 2); c.beginPath(); c.arc(F.px + Math.cos(a) * 14 * (0.5 + 0.5 * Math.sin(k * 3 + t)), F.py - 4 + Math.sin(a * 1.3) * 3.5, r, 0, 6.3); c.fill(); }
    }
    c.lineCap = 'round';
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i], F = FALLS[s.f]; s.y += s.v * dt; s.x += s.v * dt * F.sl;
      if (s.y > F.y + F.h) { this.streaks.splice(i, 1); continue; }
      const e = Math.min(F.y + F.h, s.y + s.len);
      c.strokeStyle = `rgba(255,255,255,${s.a})`; c.lineWidth = 2; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + (e - s.y) * F.sl, e); c.stroke();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.age += dt; if (r.age >= r.life) { this.rings.splice(i, 1); continue; }
      const k = r.age / r.life; c.strokeStyle = `rgba(255,255,255,${0.55 * (1 - k)})`; c.lineWidth = 1.8;
      c.beginPath(); c.ellipse(r.x, r.y, 8 + 32 * k, (8 + 32 * k) * 0.42, 0, 0, 6.3); c.stroke();
    }
    c.lineCap = 'butt';
  }
  // Un rond dans l'eau (éléphant qui puise, animal qui passe près de la rive)
  ripple(x, y) { this.rings.push({ x, y, age: 0, life: 1.1 }); }

  // ---------- par-dessus les animaux : feuilles dans le vent, ombres de nuages ----------
  sky(c, R, dt) {
    const t = this.t;
    const L = this.leaves;
    if (L.length < 16 && Math.random() < dt * 2.6) L.push({ x: rand(R.x0, R.x1 + 120), y: R.y0 - 12 + rand(0, (R.y1 - R.y0) * 0.5), vx: rand(-46, -22), vy: rand(16, 36), rot: rand(0, 6), vr: rand(-3, 3), age: 0, life: rand(5, 9), s: rand(4, 6.6), col: ['#7ed321', '#b8e04a', '#f5c04a', '#5fbf3a', '#ff9a4a'][Math.floor(Math.random() * 5)], ph: rand(0, 6) });
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i]; l.age += dt; if (l.age >= l.life || l.x < R.x0 - 40 || l.y > R.y1 + 30) { L.splice(i, 1); continue; }
      const sway = Math.sin(t * 2.2 + l.ph); l.x += (l.vx + sway * 20) * dt; l.y += (l.vy + Math.cos(t * 2.2 + l.ph) * 8) * dt; l.rot += (l.vr + sway * 2) * dt;
      const a = Math.min(1, l.age * 2, (l.life - l.age) * 1.5);
      c.save(); c.translate(l.x, l.y); c.rotate(l.rot); c.scale(1, 0.45 + 0.4 * Math.abs(Math.sin(t * 3 + l.ph)));
      c.globalAlpha = a * 0.3; c.fillStyle = '#140a1e'; c.beginPath(); c.ellipse(6, 32, l.s, l.s * 0.5, 0, 0, 6.3); c.fill();
      c.globalAlpha = a; c.fillStyle = l.col; c.beginPath(); c.moveTo(-l.s, 0); c.quadraticCurveTo(0, -l.s * 0.9, l.s, 0); c.quadraticCurveTo(0, l.s * 0.9, -l.s, 0); c.fill();
      c.strokeStyle = 'rgba(40,70,10,.5)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(-l.s, 0); c.lineTo(l.s, 0); c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    // ombres de nuages qui traversent lentement l'arène
    for (const cl of this.clouds) {
      cl.x += cl.v * dt; if (cl.x - cl.r * 1.6 > MAP_W) { cl.x = -cl.r * 1.6; cl.y = rand(100, MAP_H - 100); }
      if (cl.x + cl.r * 1.6 < R.x0 || cl.x - cl.r * 1.6 > R.x1) continue;
      c.save(); c.translate(cl.x, cl.y); c.scale(1.6, 0.8);
      const g = c.createRadialGradient(0, 0, cl.r * 0.2, 0, 0, cl.r); g.addColorStop(0, 'rgba(18,10,46,.13)'); g.addColorStop(1, 'rgba(18,10,46,0)');
      c.fillStyle = g; c.fillRect(-cl.r, -cl.r, cl.r * 2, cl.r * 2); c.restore();
    }
  }
}
