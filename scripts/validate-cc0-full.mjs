// Validation for the full-strength art data set:
//   - every pool id has data/cc0-full/<key>/<id>.hex with exactly 0x + 800 hex chars
//   - no stray files, per-collection + total counts, total bytes
//   - byte-identity cross-check against the previously proven data/cc0/<i>.hex samples
//     wherever a pool id coincides with an original proof sample (same algorithm ⇒ same bytes)
import fs from 'node:fs';

const keys = ['runner', 'skull', 'pepe', 'noun', 'kevin'];
let total = 0, bytes = 0, bad = 0;
for (const k of keys) {
  const pool = JSON.parse(fs.readFileSync(`data/cc0/pool-${k}.json`, 'utf8'));
  let n = 0;
  for (const id of pool.tokenIds) {
    const f = `data/cc0-full/${k}/${id}.hex`;
    const s = fs.readFileSync(f, 'utf8');
    if (!/^0x[0-9a-f]{800}$/.test(s)) { bad++; console.log('BAD', f, s.length); }
    n++; bytes += Buffer.byteLength(s);
  }
  const onDisk = fs.readdirSync(`data/cc0-full/${k}`).filter(x => x.endsWith('.hex')).length;
  console.log(`${k.padEnd(7)} pool ${String(pool.tokenIds.length).padStart(4)}  validated ${n}  onDisk ${onDisk}${onDisk !== n ? '  <-- STRAYS' : ''}`);
  total += n;
}
console.log(`TOTAL validated ${total}  bad ${bad}  fileBytes ${bytes}`);

const order = JSON.parse(fs.readFileSync('data/cc0/order.json', 'utf8'));
let matched = 0, identical = 0;
for (const o of order) {
  const kind = o.name.split('-')[0];
  const pool = JSON.parse(fs.readFileSync(`data/cc0/pool-${kind}.json`, 'utf8'));
  if (!pool.tokenIds.includes(o.id)) continue;
  matched++;
  const a = fs.readFileSync(`data/cc0/${o.i}.hex`, 'utf8').trim();
  const b = fs.readFileSync(`data/cc0-full/${kind}/${o.id}.hex`, 'utf8').trim();
  if (a === b) identical++; else console.log('MISMATCH vs proven sample:', o.name);
}
console.log(`overlap with proven samples: ${matched}  byte-identical: ${identical}`);
