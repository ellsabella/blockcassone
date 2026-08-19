// Normie genesis pool: select 1,679 token ids with the same seeded-PRNG style as
// dev/cc0-proof/select-pools.mjs (mulberry32(fnv1a(`${SEED}:normie`)), SEED
// 'blockcassone-normie-genesis-v1'), validated against the live chain, and fetch each
// id's 200-byte raw bitmap from NormiesStorage.
//
// Selection: candidates are drawn (distinct) from the actual Normie id range [0, 10000)
// — supply is sparse (burns/never-minted gaps), so each candidate is checked with
// isTokenDataSet(id) on the STORAGE contract (the same source of truth NormieAdapter
// uses); invalid draws are discarded and the PRNG simply keeps drawing, so the final
// 1,679-id list is fully deterministic given the seed + chain state.
//
// Outputs:
//   data/normie-pool.json            {count, tokenIds}  (ascending)
//   data/normie-raw-full/<id>.hex    0x + 400 hex chars (200 bytes, same format as
//                                    data/normie-raw-5555.hex), one per pool id
//   data/normie-raw-full/failures.json  ids that failed after retries (run continues)
//
// Resumable: if data/normie-pool.json already holds POOL_COUNT ids the selection is
// reused verbatim; raw fetch skips any <id>.hex that already validates.
// Env: ETH_RPC_URL (required), SELECT_SEED, POOL_COUNT, CONCURRENCY, RETRIES.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sha3 from 'js-sha3';
const { keccak_256 } = sha3;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POOL_PATH = path.join(REPO, 'data', 'normie-pool.json');
const OUT_DIR = path.join(REPO, 'data', 'normie-raw-full');
const FAILURES_PATH = path.join(OUT_DIR, 'failures.json');

const RPC = process.env.ETH_RPC_URL || process.env.RPC_URL || '';
if (!RPC) { console.error('Set ETH_RPC_URL (or RPC_URL).'); process.exit(1); }

const NORMIES = '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438'; // NormieAddresses.NORMIES
const STORAGE = '0x1B976bAf51cF51F0e369C070d47FBc47A706e602'; // NormieAddresses.NORMIES_STORAGE
const ID_START = 0, ID_SPAN = 10000; // actual Normie id range: ids live in [0, 9999]

const SEED = process.env.SELECT_SEED || 'blockcassone-normie-genesis-v1';
const POOL_COUNT = Number(process.env.POOL_COUNT || 1679);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));
const RETRIES = Math.max(0, Number(process.env.RETRIES || 6));

const sel = sig => '0x' + keccak_256(sig).slice(0, 8);
const SEL_TOTAL_SUPPLY = sel('totalSupply()');                 // 0x18160ddd
const SEL_IS_SET = sel('isTokenDataSet(uint256)');
const SEL_OWNER_OF = sel('ownerOf(uint256)');                  // 0x6352211e
const SEL_RAW = sel('getTokenRawImageData(uint256)');          // 0x6985bf3c
const word = v => BigInt(v).toString(16).padStart(64, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- seeded PRNG, byte-for-byte the select-pools.mjs style ----
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

let rpcId = 1;
async function ethCall(to, data) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      return j.result;
    } catch (e) {
      lastErr = e;
      // Reverts are a definitive answer (e.g. ownerOf on a burned id) — never retry.
      if (/revert/i.test(String(e.message || ''))) throw e;
      if (attempt < RETRIES) await sleep(Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

// Pool gate: the token must EXIST (not burned — ownerOf reverts on burned ids;
// isTokenDataSet stays true for them) AND have its art data set. Mirrors the
// mainnet policy where the pool derives from a holder snapshot (live tokens only).
async function isPoolable(id) {
  try {
    await ethCall(NORMIES, SEL_OWNER_OF + word(id));
  } catch (e) {
    if (/revert/i.test(String(e.message || ''))) return false; // burned / nonexistent
    throw e; // transport error — surface it
  }
  const res = await ethCall(STORAGE, SEL_IS_SET + word(id));
  return BigInt(res) === 1n;
}

function decodeBytes(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (clean.length < 128) return null;
  const offset = Number(BigInt('0x' + clean.slice(0, 64)));
  const lenStart = offset * 2;
  const len = Number(BigInt('0x' + clean.slice(lenStart, lenStart + 64)));
  return clean.slice(lenStart + 64, lenStart + 64 + len * 2); // hex chars, no 0x
}

async function mapLimit(values, limit, fn) {
  const out = new Array(values.length);
  let next = 0;
  async function workerLoop() { while (next < values.length) { const i = next++; out[i] = await fn(values[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, workerLoop));
  return out;
}

const t0 = Date.now();

// 1) totalSupply sanity log (main contract).
const supply = Number(BigInt(await ethCall(NORMIES, SEL_TOTAL_SUPPLY)));
console.log(`Normies totalSupply() = ${supply} (id range [${ID_START}, ${ID_START + ID_SPAN}))`);
if (POOL_COUNT > supply) { console.error(`POOL_COUNT ${POOL_COUNT} > totalSupply ${supply}`); process.exit(1); }

// 2) Selection (or reuse an existing pool file).
let tokenIds = null;
try {
  const existing = JSON.parse(await fs.readFile(POOL_PATH, 'utf8'));
  if (existing.count === POOL_COUNT && Array.isArray(existing.tokenIds) && existing.tokenIds.length === POOL_COUNT) {
    tokenIds = existing.tokenIds;
    console.log(`Reusing existing ${POOL_PATH} (${POOL_COUNT} ids).`);
  }
} catch { /* no pool file yet */ }

if (!tokenIds) {
  const rand = mulberry32(fnv1a(`${SEED}:normie`));
  const seen = new Set();
  const accepted = [];
  const isSetCache = new Map();
  let checked = 0, rejected = 0;
  // Draw distinct candidates in PRNG order; validate in batches (results applied in
  // draw order, so batching never changes the outcome — validity is per-id chain state).
  while (accepted.length < POOL_COUNT) {
    const batch = [];
    while (batch.length < 64) {
      const id = ID_START + Math.floor(rand() * ID_SPAN);
      if (seen.has(id)) continue; // distinct draws, same as select-pools' Set semantics
      seen.add(id); batch.push(id);
    }
    await mapLimit(batch, CONCURRENCY, async id => {
      isSetCache.set(id, await isPoolable(id));
    });
    for (const id of batch) {
      checked++;
      if (isSetCache.get(id)) { if (accepted.length < POOL_COUNT) accepted.push(id); }
      else rejected++;
      if (accepted.length === POOL_COUNT) break;
    }
    console.log(`  selection: ${accepted.length}/${POOL_COUNT} accepted (${checked} checked, ${rejected} data-unset/nonexistent)`);
  }
  tokenIds = [...accepted].sort((a, b) => a - b);
  await fs.writeFile(POOL_PATH, JSON.stringify({ count: tokenIds.length, tokenIds }, null, 0) + '\n');
  console.log(`Wrote ${POOL_PATH}: ${tokenIds.length} ids (${tokenIds[0]}..${tokenIds[tokenIds.length - 1]}), seed "${SEED}:normie".`);
}

// 3) Fetch raw art (resumable).
await fs.mkdir(OUT_DIR, { recursive: true });
const failures = [];
let done = 0, skipped = 0, failed = 0, processed = 0;
await mapLimit(tokenIds, CONCURRENCY, async id => {
  const file = path.join(OUT_DIR, `${id}.hex`);
  try {
    const cur = (await fs.readFile(file, 'utf8')).trim();
    if (/^0x[0-9a-f]{400}$/i.test(cur)) { skipped++; processed++; return; }
  } catch { /* not fetched yet */ }
  try {
    const dataHex = decodeBytes(await ethCall(STORAGE, SEL_RAW + word(id)));
    if (!dataHex || dataHex.length !== 400) throw new Error(`raw image ${dataHex ? dataHex.length / 2 : 0} bytes != 200`);
    await fs.writeFile(file, '0x' + dataHex.toLowerCase()); // same format as data/normie-raw-5555.hex
    done++;
  } catch (e) {
    failed++;
    failures.push({ id, error: String(e.message || e) });
    console.error(`  !! normie #${id} FAILED after ${RETRIES + 1} attempts: ${e.message || e}`);
  }
  processed++;
  if (processed % 25 === 0 || processed === tokenIds.length) {
    console.log(`[normie-raw] ${processed}/${tokenIds.length}  (new ${done}, skipped ${skipped}, failed ${failed})  t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
});

await fs.writeFile(FAILURES_PATH, JSON.stringify({ createdAt: new Date().toISOString(), count: failures.length, failures }, null, 2) + '\n');
console.log(`\nDONE: ${tokenIds.length} pool ids -> new ${done}, skipped ${skipped}, failed ${failed} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log(`failures -> ${FAILURES_PATH}${failures.length ? '  (RE-RUN to retry, or report the ids)' : ' (empty)'}`);
if (failures.length) process.exitCode = 2;
