// Ensure every GTD-picked Normie is in the candidate pool (data/normie-pool.json).
// The candidate pool may exceed the 1,679 cap (the cap bounds draws, not candidates),
// so missing picks are APPENDED — reservations pull them out pre-finalize, and the
// L-1 guard requires in-pool membership at reserve time.
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('reserve-plan-mainnet.json', 'utf8')).plan || [];
const pool = JSON.parse(fs.readFileSync('data/normie-pool.json', 'utf8'));
const have = new Set(pool.tokenIds);
const picks = new Set();
for (const p of plan) {
  const cids = p.collectionIds || [];
  const sids = p.sourceIds || [];
  for (let i = 0; i < cids.length; i++) if (Number(cids[i]) === 0) picks.add(Number(sids[i]));
}
const missing = [...picks].filter(id => !have.has(id));
if (missing.length) {
  pool.tokenIds = [...pool.tokenIds, ...missing].sort((a, b) => a - b);
  pool.count = pool.tokenIds.length;
  fs.writeFileSync('data/normie-pool.json', JSON.stringify(pool, null, 0) + '\n');
}
console.log(`GTD Normie picks: ${picks.size}; already pooled: ${picks.size - missing.length}; injected: ${missing.length}; pool now ${pool.tokenIds.length}`);
