// Vérifie la simulation : elle se termine toujours, elle est déterministe et équitable.
import { runBattle } from '../src/game/sim.js';
import { COLS, ROWS } from '../src/data/arena.js';
import { makeRng } from '../src/core/rng.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('ÉCHEC :', msg); } };
const T = (str) => ({ units: str.trim().split(/\s+/).map((p) => { const [k, c, r, l] = p.split(/[:,]/); return { id: k === 'b' ? 'bulldog' : 'monkey', col: +c, row: +r, level: +(l || 1) }; }) });

const classic = T('b:1,0 b:2,0 b:3,0 m:1,2 m:3,2');
// 1. déterminisme
const r1 = runBattle([classic, classic], 1234), r2 = runBattle([classic, classic], 1234);
ok(JSON.stringify(r1) === JSON.stringify(r2), 'même graine, même combat');

// 2. toujours une fin, durée raisonnable, équité sur des équipes miroir
const rng = makeRng(42);
const randomTeam = () => {
  const cells = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) { const j = rng.int(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { units: cells.slice(0, 5).map(([col, row]) => ({ id: rng() < 0.5 ? 'bulldog' : 'monkey', col, row, level: 1 })) };
};
let total = 0, maxT = 0, minT = 1e9, wins0 = 0; const N = 600;
for (let i = 0; i < N; i++) {
  const a = randomTeam();
  const r = runBattle([a, a], 1000 + i);
  ok(r.over, 'combat terminé (graine ' + (1000 + i) + ')');
  total += r.time; maxT = Math.max(maxT, r.time); minT = Math.min(minT, r.time);
  if (r.winner === 0) wins0++;
}
console.log(`miroir : durée moyenne ${(total / N).toFixed(1)} s (min ${minT.toFixed(1)}, max ${maxT.toFixed(1)}), camp 0 gagne ${(wins0 / N * 100).toFixed(0)} %`);
ok(wins0 / N > 0.42 && wins0 / N < 0.58, 'équité des deux camps');
ok(maxT < 60, 'aucun combat de plus de 60 s');

// 3. le placement et la composition comptent : comparaison de quelques formations
const forms = {
  'classique (3 bulldogs devant, 2 singes derrière)': classic,
  'singes devant': T('m:1,0 m:3,0 b:1,2 b:2,2 b:3,2'),
  '5 bulldogs': T('b:0,0 b:1,0 b:2,0 b:3,0 b:4,0'),
  '5 singes': T('m:0,2 m:1,2 m:2,2 m:3,2 m:4,2'),
  '2 bulldogs 3 singes': T('b:1,0 b:3,0 m:0,2 m:2,2 m:4,2'),
  'un coin': T('b:0,0 b:1,0 b:0,1 m:0,2 m:1,2'),
};
const names = Object.keys(forms);
for (const a of names) {
  let line = a.padEnd(50);
  for (const c of names) {
    let w = 0; const M = 60;
    for (let i = 0; i < M; i++) if (runBattle([forms[a], forms[c]], 77 + i).winner === 0) w++;
    line += String(Math.round(w / M * 100)).padStart(5) + '%';
  }
  console.log(line);
}
console.log(fails ? `${fails} échec(s)` : 'OK');
process.exit(fails ? 1 : 0);
