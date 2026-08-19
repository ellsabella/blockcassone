// Deterministically replace a pool id that failed the on-chain-art gate: re-run the
// same seeded PRNG with a larger count and take the first extra candidate not already
// pooled. Auditable: replacement follows from (seed, pool, badId) alone.
//   node scripts/substitute-pool-id.mjs <key> <badId>
import fs from 'node:fs';

const [key, badRaw] = process.argv.slice(2);
const bad = Number(badRaw);
const POOLS = { runner: [1, 10000, 1], skull: [1, 7331, 2], pepe: [1, 20000, 3], noun: [0, 1968, 4], kevin: [1, 2000, 5] };
if (!POOLS[key] || !bad) { console.error('usage: substitute-pool-id.mjs <key> <badId>'); process.exit(1); }
const [startId, supply] = POOLS[key];
const SEED = process.env.SELECT_SEED || 'blockcassone-cc0-genesis-v1';

function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function mulberry32(a) { return function () { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const poolPath = `data/cc0/pool-${key}.json`;
const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
if (!pool.tokenIds.includes(bad)) { console.error(`${bad} not in ${poolPath}`); process.exit(1); }
const have = new Set(pool.tokenIds);

// Walk the seeded stream past everything drawn before; first fresh candidate wins.
const rand = mulberry32(fnv1a(`${SEED}:${key}`));
const seen = new Set();
let replacement = null;
for (let guard = 0; guard < supply * 20 && replacement === null; guard++) {
  const id = startId + Math.floor(rand() * supply);
  if (seen.has(id)) continue;
  seen.add(id);
  if (id === bad || have.has(id)) continue;
  replacement = id;
}
if (replacement === null) { console.error('stream exhausted'); process.exit(1); }
pool.tokenIds = pool.tokenIds.filter(i => i !== bad).concat(replacement).sort((a, b) => a - b);
fs.writeFileSync(poolPath, JSON.stringify(pool, null, 0) + '\n');
console.log(`${key}: replaced #${bad} -> #${replacement} (deterministic redraw); flatten it next.`);
