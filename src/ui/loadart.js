// L'écran de chargement prend vie : l'image reste la même, mais de légères déformations la font bouger (l'aigle bat des
// ailes, le tigre et le gorille respirent, le poing du gorille se lève, le serpent ondule, la cascade coule, les drapeaux
// flottent, les rochers flottent dans l'air). Un seul dessin WebGL par image : chaque pixel va chercher sa couleur un peu
// à côté, selon des « déformeurs » posés sur l'image (zones douces, sans couture). Sans WebGL : l'image fixe reste.
import { TEST } from '../core/utils.js';
import { view } from './stage.js';

const SRC = 'assets/bg/loading.webp', W = 941, H = 1672, N = 20;
const TAU = Math.PI * 2;
// Déformeurs, en pixels de la scène (941 × 1672). zone : centre et rayons de l'ellipse où ils agissent (bord adouci).
//   rot : pivot, angle(t) ; grow : centre, échelle(t) ; move : décalage(t) ; wave : ondulation horizontale ; flow : cascade
const S = (period, phase = 0) => (t) => Math.sin(TAU * t / period + phase);
const DEF = [
  // l'aigle : il plane (monte et descend), ses ailes battent autour des épaules
  { zone: [545, 545, 300, 175], move: (t) => [0, 6 * S(1.6)(t)] },
  { zone: [392, 505, 150, 105], rot: [515, 575], ang: (t) => 0.075 * S(1.6, 0.6)(t) },
  { zone: [690, 488, 150, 115], rot: [570, 572], ang: (t) => -0.075 * S(1.6, 0.6)(t) },
  // le tigre : il respire, la tête rugit (petit mouvement), la patte se crispe
  { zone: [215, 990, 270, 340], grow: [215, 1150], k: (t) => 0.011 * S(2.3)(t) },
  { zone: [330, 905, 175, 165], rot: [285, 1010], ang: (t) => 0.022 * S(2.3, 0.9)(t) },
  { zone: [215, 1245, 130, 120], move: (t) => [2 * S(1.15, 0.4)(t), -3.5 * Math.max(0, S(1.15, 0.4)(t))] },
  // le gorille : il respire, la tête bouge, le poing levé tape l'air
  { zone: [705, 1115, 260, 330], grow: [705, 1300], k: (t) => 0.012 * S(2.5, 1.7)(t) },
  { zone: [640, 905, 170, 150], rot: [660, 1010], ang: (t) => -0.02 * S(2.5, 2.4)(t) },
  { zone: [835, 650, 125, 120], move: (t) => [0, -7 * S(1.25)(t)] },
  // le serpent : la tête ondule, la langue vibre
  { zone: [165, 545, 175, 120], rot: [40, 640], ang: (t) => 0.035 * S(1.9)(t) },
  { zone: [215, 610, 45, 45], move: (t) => [0, 2.2 * S(0.18)(t)] },
  // les drapeaux des deux tours et les nuages
  { zone: [52, 385, 52, 72], wave: [3.2, 0.055, 5.5, 330] },
  { zone: [872, 370, 58, 90], wave: [3.6, 0.05, 5, 300] },
  { zone: [470, 60, 470, 110], move: (t) => [10 * S(14)(t), 0] },
  // les rochers qui volent
  { zone: [420, 1070, 50, 45], move: (t) => [1.5 * S(2.1, 1)(t), 5 * S(2.1)(t)] },
  { zone: [440, 1245, 70, 55], move: (t) => [-2 * S(2.6, 2)(t), 6 * S(2.6, 0.5)(t)] },
  { zone: [372, 1360, 45, 40], move: (t) => [0, 4 * S(1.9, 2.2)(t)] },
  // le feuillage du bas et des côtés
  { zone: [470, 1640, 470, 70], wave: [2.5, 0.03, 2.2, 1580] },
  // la cascade : l'eau descend (deux phases fondues, sans couture)
  { zone: [515, 925, 52, 190], flow: 26 },
];

const VS = 'attribute vec2 a;varying vec2 p;void main(){p=vec2((a.x+1.)*.5*' + W + '.,(1.-a.y)*.5*' + H + '.);gl_Position=vec4(a,0.,1.);}';
const FS = `precision mediump float;
varying vec2 p; uniform sampler2D tex; uniform vec4 Z[${N}]; uniform vec4 P[${N}]; uniform float T[${N}]; uniform float tm;
vec4 at(vec2 q){ return texture2D(tex, clamp(q / vec2(${W}., ${H}.), vec2(0.), vec2(1.))); }
void main(){
  vec2 u = vec2(0.); float fw = 0.; vec2 fz = vec2(0.);
  for (int i = 0; i < ${N}; i++) {
    float ty = T[i]; if (ty < 0.5) continue;
    vec4 z = Z[i]; float d = length((p - z.xy) / z.zw); if (d >= 1.) continue;
    float w = 1. - smoothstep(0.45, 1., d); vec4 q = P[i];
    if (ty < 1.5) { vec2 r = p - q.xy; float c = cos(q.z), s = sin(q.z); u += w * (r - vec2(c * r.x + s * r.y, -s * r.x + c * r.y)); }
    else if (ty < 2.5) { u += w * (p - q.xy) * (q.z / (1. + q.z)); }
    else if (ty < 3.5) { u += w * q.xy; }
    else if (ty < 4.5) { float ramp = clamp((p.y - q.w) / 120., 0., 1.); u.x += w * ramp * q.x * sin(q.y * p.y - q.z * tm); }
    else { fw = w; fz = q.xy; }
  }
  vec2 s = p - u;
  if (fw > 0.) {
    float ph = fract(tm / 0.9), a1 = ph * fz.x, a2 = fract(ph + .5) * fz.x, k = abs(ph * 2. - 1.);
    vec4 c1 = at(s - vec2(0., a1)), c2 = at(s - vec2(0., a2));
    gl_FragColor = mix(at(s), mix(c1, c2, k), fw * .85);
  } else gl_FragColor = at(s);
}`;

let st = null;
export function startLoadingArt(force = false) {
  if ((TEST && !force) || st) return;
  const scr = document.getElementById('scrLoading'); if (!scr) return;
  const cv = document.createElement('canvas'); cv.className = 'ld-art';
  const k = Math.max(0.5, Math.min(1.4, view.scale * (window.devicePixelRatio || 1)));
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  let gl = null;
  try { gl = cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
  if (!gl) return;
  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(o)); return null; } return o; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS); if (!vs || !fs) return;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const la = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
  const uZ = gl.getUniformLocation(pr, 'Z'), uP = gl.getUniformLocation(pr, 'P'), uT = gl.getUniformLocation(pr, 'T'), uTm = gl.getUniformLocation(pr, 'tm');
  const Z = new Float32Array(N * 4), P = new Float32Array(N * 4), T = new Float32Array(N);
  DEF.forEach((d, i) => { Z.set(d.zone, i * 4); T[i] = d.rot ? 1 : d.grow ? 2 : d.move ? 3 : d.wave ? 4 : 5; });
  gl.uniform4fv(uZ, Z); gl.uniform1fv(uT, T);
  st = { cv, gl, raf: 0, alive: true };
  const img = new Image(); img.decoding = 'async';
  img.onload = () => {
    if (!st || !st.alive) return;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.viewport(0, 0, cv.width, cv.height);
    const t0 = performance.now();
    const frame = (now) => {
      if (!st || !st.alive) return;
      const t = (now - t0) / 1000;
      DEF.forEach((d, i) => {
        const o = i * 4;
        if (d.rot) { P[o] = d.rot[0]; P[o + 1] = d.rot[1]; P[o + 2] = d.ang(t); }
        else if (d.grow) { P[o] = d.grow[0]; P[o + 1] = d.grow[1]; P[o + 2] = d.k(t); }
        else if (d.move) { const m = d.move(t); P[o] = m[0]; P[o + 1] = m[1]; }
        else if (d.wave) P.set(d.wave, o);
        else P[o] = d.flow;
      });
      gl.uniform4fv(uP, P); gl.uniform1f(uTm, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!cv.parentNode) { scr.insertBefore(cv, scr.firstChild); }     // posé après le premier dessin : aucun clignotement
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
  };
  img.src = SRC;
}
export function stopLoadingArt() {
  if (!st) return;
  st.alive = false; cancelAnimationFrame(st.raf);
  const { cv, gl } = st; st = null;
  setTimeout(() => { cv.remove(); const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }, 600);
}
