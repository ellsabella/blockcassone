import { readFile } from 'node:fs/promises';
import { inflateNonNormieArt } from '../../viewer/art-snapshot.js';

const snap = JSON.parse(await readFile(new URL('../../data/world-snapshot.json', import.meta.url), 'utf8'));
const arr = Array.isArray(snap) ? snap : (snap.records || snap.cubes || Object.values(snap));

function ascii(bits) {
  let s = '';
  for (let r = 0; r < 40; r++) {
    let line = '';
    for (let c = 0; c < 40; c++) line += bits[r * 40 + c] ? '#' : '.';
    s += line + '\n';
  }
  return s;
}
// lit cells in the outer 4-cell ring — a 32-native pad leaves this exactly 0
function margin4(bits) {
  let n = 0;
  for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++)
    if (bits[r * 40 + c] && (r < 4 || r > 35 || c < 4 || c > 35)) n++;
  return n;
}

const labels = { 0: 'runner', 8: 'skull', 16: 'noun', 24: 'kevin', 20: 'pepe(72)' };
for (const slot of [0, 8, 16, 24, 20]) {
  const r = arr.find(x => x.slot === slot) || arr[slot];
  const inf = r && inflateNonNormieArt(r.art);
  if (!inf) { console.log(`slot ${slot}: no x-art (${r && r.art && r.art.k})`); continue; }
  const bits = inf.grid.bits;
  console.log(`\n=== slot ${slot} ${labels[slot]}  art.id=${r.art.id}  ones=${inf.grid.ones}  outer4-margin-lit=${margin4(bits)} ===`);
  if (slot === 8) console.log(ascii(bits));
}
