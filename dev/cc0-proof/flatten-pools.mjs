// Full-strength CC0 pool flattening — every token id in data/cc0/pool-{runner,skull,pepe,
// noun,kevin}.json (2,417 ids selected by select-pools.mjs) is decoded from mainnet via
// the PROVEN per-collection paths in flatten.mjs (imported, not re-implemented) and
// flattened with the repo's canonical banding/packing into the on-chain 400-byte 2-bit
// tonal payload. One file per token: data/cc0-full/<key>/<id>.hex (0x + 800 hex chars).
//
// Ops behaviour:
//   - RPC:      ETH_RPC_URL (or RPC_URL) — set BEFORE the dynamic import of flatten.mjs
//               so its module-level RPC constant picks it up (it defaults to localhost).
//   - Resumable: ids whose .hex already exists with exactly 802 chars (0x + 800) are skipped.
//   - Retries:  per-id retry with exponential backoff (RETRIES, default 6) — covers
//               429/5xx/network blips since decodes are idempotent view calls.
//   - Failures: ids that still fail after retries land in data/cc0-full/failures.json
//               and the run CONTINUES (no silent substitution — report + re-run).
//   - Progress: a line every 25 ids per collection.
// Env knobs: CONCURRENCY (default 4), RETRIES (default 6), ONLY=<key[,key]>, LIMIT=<n per pool>.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.RPC_URL = process.env.RPC_URL || process.env.ETH_RPC_URL || '';
if (!process.env.RPC_URL) { console.error('Set ETH_RPC_URL (or RPC_URL).'); process.exit(1); }

// Dynamic import AFTER RPC_URL is resolved — flatten.mjs reads it at module scope.
const { crGrid, skullGrid, nounGrid, pepeGrid, kevinGrid, flatten } = await import('./flatten.mjs');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POOL_DIR = path.join(REPO, 'data', 'cc0');
const OUT_DIR = path.join(REPO, 'data', 'cc0-full');
const FAILURES_PATH = path.join(OUT_DIR, 'failures.json');

const DECODER = { runner: crGrid, skull: skullGrid, noun: nounGrid, pepe: pepeGrid, kevin: kevinGrid };
const KEYS_ALL = ['runner', 'skull', 'pepe', 'noun', 'kevin'];
const KEYS = process.env.ONLY ? process.env.ONLY.split(',').map(s => s.trim()) : KEYS_ALL;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const RETRIES = Math.max(0, Number(process.env.RETRIES || 6));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toHex = u8 => '0x' + Buffer.from(u8).toString('hex');

async function flattenOne(key, id) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const g = await DECODER[key](id);
      const f = flatten(g.colors, g.size);
      if (f.payload.length !== 400) throw new Error(`payload ${f.payload.length} bytes != 400`);
      return toHex(f.payload); // 0x + 800 hex chars
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) {
        const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

// Valid existing output = 0x-prefixed 800 hex chars (802 total), i.e. 400 bytes.
async function alreadyDone(file) {
  try {
    const s = (await fs.readFile(file, 'utf8')).trim();
    return /^0x[0-9a-f]{800}$/i.test(s);
  } catch { return false; }
}

const t0 = Date.now();
const failures = [];
let grandDone = 0, grandSkipped = 0, grandFailed = 0;

for (const key of KEYS) {
  const pool = JSON.parse(await fs.readFile(path.join(POOL_DIR, `pool-${key}.json`), 'utf8'));
  const ids = pool.tokenIds.slice(0, LIMIT);
  const dir = path.join(OUT_DIR, key);
  await fs.mkdir(dir, { recursive: true });

  let done = 0, skipped = 0, failed = 0, processed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const file = path.join(dir, `${id}.hex`);
      if (await alreadyDone(file)) { skipped++; }
      else {
        try {
          const hex = await flattenOne(key, id);
          await fs.writeFile(file, hex);
          done++;
        } catch (e) {
          failed++;
          failures.push({ key, collectionId: pool.collectionId, contract: pool.contract, id, error: String(e.message || e) });
          console.error(`  !! ${key} #${id} FAILED after ${RETRIES + 1} attempts: ${e.message || e}`);
        }
      }
      processed++;
      if (processed % 25 === 0 || processed === ids.length) {
        const dt = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[${key}] ${processed}/${ids.length}  (new ${done}, skipped ${skipped}, failed ${failed})  t=${dt}s`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  grandDone += done; grandSkipped += skipped; grandFailed += failed;
  console.log(`=== ${key}: ${ids.length} ids -> new ${done}, skipped ${skipped}, failed ${failed}`);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(FAILURES_PATH, JSON.stringify({ createdAt: new Date().toISOString(), count: failures.length, failures }, null, 2) + '\n');
const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nTOTAL: new ${grandDone}, skipped ${grandSkipped}, failed ${grandFailed} in ${mins} min -> data/cc0-full/<key>/<id>.hex`);
console.log(`failures -> ${FAILURES_PATH}${failures.length ? '  (RE-RUN to retry, or report the ids)' : ' (empty)'}`);
if (failures.length) process.exitCode = 2;
