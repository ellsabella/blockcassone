// Post-hoc observation for the Normie pool: isTokenDataSet() turned out to be true for
// (essentially) the whole 0..9999 id range even though totalSupply() < 10000, so the
// selection rejected nothing. This reports how many of the final pool ids are currently
// EXISTING tokens (ownerOf succeeds) vs burned/nonexistent — facts only, no pool change.
// Env: ETH_RPC_URL (required), CONCURRENCY.
import fs from 'node:fs';

const RPC = process.env.ETH_RPC_URL || process.env.RPC_URL || '';
if (!RPC) { console.error('Set ETH_RPC_URL.'); process.exit(1); }
const NORMIES = '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));
const word = v => BigInt(v).toString(16).padStart(64, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let rpcId = 1;
async function ownerOf(id) {
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'eth_call', params: [{ to: NORMIES, data: '0x6352211e' + word(id) }, 'latest'] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) {
        const m = String(j.error.message || '').toLowerCase();
        if (m.includes('nonexistent') || m.includes('invalid token') || m.includes('revert')) return false;
        throw new Error(j.error.message);
      }
      return true;
    } catch (e) { if (attempt === 5) return null; await sleep(Math.min(20_000, 500 * 2 ** attempt)); }
  }
}

const ids = JSON.parse(fs.readFileSync('data/normie-pool.json', 'utf8')).tokenIds;
let exists = 0, burned = 0, unknown = 0, next = 0;
const burnedIds = [];
async function worker() {
  while (next < ids.length) {
    const i = next++;
    const r = await ownerOf(ids[i]);
    if (r === true) exists++; else if (r === false) { burned++; burnedIds.push(ids[i]); } else unknown++;
    const n = exists + burned + unknown;
    if (n % 200 === 0) console.log(`  ${n}/${ids.length} (exists ${exists}, burned/nonexistent ${burned}, unknown ${unknown})`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`pool ids: ${ids.length}  currently existing: ${exists}  burned/nonexistent: ${burned}  unknown(rpc): ${unknown}`);
if (burned) console.log('burned/nonexistent ids:', burnedIds.sort((a, b) => a - b).join(','));
