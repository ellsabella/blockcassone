// Genesis CC0 pool token-ID SELECTION (Phase-0 prep, fork-free).
//
// Picks the token ids that will back each CC0 collection's genesis allocation, evenly
// spaced across the collection's supply so the on-chain art is a representative spread
// rather than clustered at low ids. Writes data/cc0/pool-<key>.json = { collectionId,
// contract, tokenIds }, consumed by flatten-pools.mjs (which flattens each id against a
// mainnet fork) and then the on-chain commit (setSourcePayloadBatch).
//
// Supplies confirmed by the user (2026-07-08); all pure CC0, sequential ids, no burns to
// validate. Normie is NOT here — it's the
// live-art collection (collection 0): no art pool to preselect/store; its cubes come from
// the snapshot (allowlist + public pull) and the renderer reads Normie art live on-chain.
// Selection is algorithmic (evenly spaced across each supply); swap to a curated id list
// per collection here if you'd rather hand-pick hero tokens.
import fs from 'node:fs/promises';

const HEXDIR = new URL('../../data/cc0/', import.meta.url);

// collectionId matches MultiSourceGenesisMinter registration order (0 = Normie).
// Supplies re-confirmed LIVE via totalSupply() 2026-08-15 (scripts/cc0-supplies.sh):
// the 2026-07-08 figures under-stated skulls (7000→7331), nouns (1900→1968, they
// mint daily — re-check before the mainnet commit) and kevin (1900→2000), which
// silently excluded the top of those id ranges from the draw.
const COLLECTIONS = [
  { key: 'runner', collectionId: 1, name: 'Chain Runners', contract: '0x97597002980134bea46250aa0510c9b90d87a587', startId: 1, supply: 10000, count: 901 },
  { key: 'skull', collectionId: 2, name: '1337 skulls', contract: '0x9251dec8df720c2adf3b6f46d968107cbbadf4d4', startId: 1, supply: 7331, count: 655 },
  { key: 'pepe', collectionId: 3, name: 'Baby Pepes', contract: '0x9131d8c7a411d90c6b164d296440701a0e5b3178', startId: 1, supply: 20000, count: 410 },
  { key: 'noun', collectionId: 4, name: 'Nouns', contract: '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03', startId: 0, supply: 1968, count: 328 },
  { key: 'kevin', collectionId: 5, name: 'OnChainKevin', contract: '0x17b19c70bfca098da3f2efef6e7fa3a1c42f5429', startId: 1, supply: 2000, count: 123 },
];

// Deterministic, seeded PRNG (mulberry32) so the selection is reproducible/auditable
// from the committed SELECT_SEED but is otherwise pseudo-random (not an engineered
// spread). Change SELECT_SEED to re-roll.
const SELECT_SEED = process.env.SELECT_SEED || 'blockcassone-cc0-genesis-v1';
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `count` DISTINCT ids drawn by PRNG from [startId, startId+supply), sorted ascending.
function prngSelect(key, startId, supply, count) {
  if (count > supply) throw new Error(`count ${count} > supply ${supply}`);
  const rand = mulberry32(fnv1a(`${SELECT_SEED}:${key}`));
  const picked = new Set();
  while (picked.size < count) picked.add(startId + Math.floor(rand() * supply));
  return [...picked].sort((a, b) => a - b);
}

// GTD winners' verified chosen artworks MUST be in the committed pool
// (reserveSources requires a committed payload, and reserving pulls the id out of
// the pool). REQUIRE_PLAN=reserve-plan.json injects them: required ids first, then
// the seeded-PRNG fill tops up to the cap. Fill draws stay on the same seed, so the
// selection remains reproducible given (seed, plan).
const REQUIRED = {}; // collectionId -> Set(ids)
if (process.env.REQUIRE_PLAN) {
  const plan = JSON.parse(await fs.readFile(process.env.REQUIRE_PLAN, 'utf8')).plan || [];
  for (const p of plan) {
    const cids = p.collectionIds || [];
    const sids = p.sourceIds || [];
    for (let i = 0; i < cids.length; i++) {
      if (Number(cids[i]) === 0) continue; // Normie picks live in the snapshot pool, not here
      (REQUIRED[cids[i]] ||= new Set()).add(Number(sids[i]));
    }
  }
  console.log('required GTD picks per collectionId:',
    Object.fromEntries(Object.entries(REQUIRED).map(([k, v]) => [k, v.size])));
}

let totalSelected = 0;
for (const c of COLLECTIONS) {
  const required = [...(REQUIRED[c.collectionId] || [])];
  for (const id of required) {
    if (id < c.startId || id >= c.startId + c.supply) throw new Error(`${c.key}: required id ${id} out of range`);
  }
  if (required.length > c.count) throw new Error(`${c.key}: ${required.length} required > cap ${c.count}`);
  const fill = prngSelect(c.key, c.startId, c.supply, c.count).filter(id => !REQUIRED[c.collectionId]?.has(id));
  const tokenIds = [...required, ...fill].slice(0, c.count).sort((a, b) => a - b);
  if (tokenIds.length !== c.count) {
    console.warn(`  ⚠️ ${c.key}: selected ${tokenIds.length} distinct ids (wanted ${c.count}) — spacing collided; widen supply or curate.`);
  }
  await fs.writeFile(
    new URL(`./pool-${c.key}.json`, HEXDIR),
    JSON.stringify({ collectionId: c.collectionId, name: c.name, contract: c.contract, count: tokenIds.length, tokenIds }, null, 0) + '\n'
  );
  totalSelected += tokenIds.length;
  console.log(`  ${c.key.padEnd(7)} collection ${c.collectionId}  ${String(tokenIds.length).padStart(4)} ids  (${tokenIds[0]}..${tokenIds[tokenIds.length - 1]})  -> data/cc0/pool-${c.key}.json`);
}
console.log(`\nselected ${totalSelected} CC0 pool tokens (target 2417). NEXT: flatten (flatten-pools.mjs, needs a mainnet fork), then commit via setSourcePayloadBatch.`);
console.log(`note: seeded-PRNG selection (SELECT_SEED="${SELECT_SEED}"), reproducible + auditable. Swap COLLECTIONS to curated id lists if you prefer hero tokens.`);
