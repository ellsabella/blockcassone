// Validation for the Normie genesis pool + raw art:
//   - data/normie-pool.json: exactly {count, tokenIds}, count matches, ids distinct,
//     ascending, within [0, 9999]
//   - every pool id has data/normie-raw-full/<id>.hex with exactly 0x + 400 hex chars
//     (200 bytes, the format of data/normie-raw-5555.hex)
//   - byte-identity cross-check against the existing data/normie-raw-<id>.hex singles
//     wherever a pool id coincides with one
import fs from 'node:fs';

const pool = JSON.parse(fs.readFileSync('data/normie-pool.json', 'utf8'));
const ids = pool.tokenIds;
const distinct = new Set(ids).size;
const sorted = ids.every((v, i) => i === 0 || ids[i - 1] < v);
const inRange = ids.every(v => Number.isInteger(v) && v >= 0 && v <= 9999);
console.log(`pool: count=${pool.count} ids=${ids.length} distinct=${distinct} ascending=${sorted} inRange=${inRange} keys=${Object.keys(pool).join(',')}`);

let bad = 0, bytes = 0;
for (const id of ids) {
  const s = fs.readFileSync(`data/normie-raw-full/${id}.hex`, 'utf8');
  if (!/^0x[0-9a-f]{400}$/.test(s)) { bad++; console.log('BAD', id, s.length); }
  bytes += Buffer.byteLength(s);
}
const onDisk = fs.readdirSync('data/normie-raw-full').filter(x => x.endsWith('.hex')).length;
console.log(`raw: validated ${ids.length}  bad ${bad}  onDisk ${onDisk}  fileBytes ${bytes}`);

let matched = 0, identical = 0;
for (const f of fs.readdirSync('data')) {
  const m = f.match(/^normie-raw-(\d+)\.hex$/);
  if (!m) continue;
  const id = Number(m[1]);
  if (!ids.includes(id)) continue;
  matched++;
  const a = fs.readFileSync(`data/${f}`, 'utf8').trim().toLowerCase();
  const b = fs.readFileSync(`data/normie-raw-full/${id}.hex`, 'utf8').trim();
  if (a === b) identical++; else console.log('MISMATCH vs existing single:', id);
}
console.log(`overlap with existing data/normie-raw-*.hex singles: ${matched}  byte-identical: ${identical}`);
