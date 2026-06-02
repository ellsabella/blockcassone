import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUT_PATH = path.join(REPO_ROOT, 'data', 'normie-snapshot.json');
const NORMIES_CONTRACT = (process.env.NORMIES_CONTRACT || '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438').toLowerCase();
const RPC_URL = process.env.ETH_RPC_URL || process.env.RPC_URL || '';
const TOKEN_START = Math.max(0, Number(process.env.NORMIE_TOKEN_START || 0));
const TOKEN_END = Math.max(TOKEN_START, Number(process.env.NORMIE_TOKEN_END || 9999));
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.SNAPSHOT_CONCURRENCY || 8)));
const RETRIES = Math.max(0, Number(process.env.SNAPSHOT_RETRIES || 4));

if (!RPC_URL) {
  console.error('Missing ETH_RPC_URL or RPC_URL.');
  process.exit(1);
}

function ownerOfCalldata(tokenId) {
  return `0x6352211e${BigInt(tokenId).toString(16).padStart(64, '0')}`;
}

function uintCalldata(selector) {
  return selector;
}

function addressFromReturn(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (clean.length < 64) return '';
  return `0x${clean.slice(-40)}`.toLowerCase();
}

function uintFromReturn(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (!clean) return null;
  return Number(BigInt(`0x${clean}`));
}

function isMissingTokenError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('invalid token id')
    || message.includes('owner query for nonexistent token')
    || message.includes('nonexistent token');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let rpcId = 1;
async function rpc(method, params) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.result;
    } catch (error) {
      lastError = error;
      if (isMissingTokenError(error) || attempt === RETRIES) break;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function totalSupply(blockTag) {
  try {
    const result = await rpc('eth_call', [{
      to: NORMIES_CONTRACT,
      data: uintCalldata('0x18160ddd'),
    }, blockTag]);
    return uintFromReturn(result);
  } catch (error) {
    console.warn(`totalSupply unavailable: ${error.message}`);
    return null;
  }
}

async function ownerOf(tokenId, blockTag) {
  try {
    const result = await rpc('eth_call', [{
      to: NORMIES_CONTRACT,
      data: ownerOfCalldata(tokenId),
    }, blockTag]);
    return addressFromReturn(result);
  } catch (error) {
    if (isMissingTokenError(error)) return '';
    throw error;
  }
}

async function mapLimit(values, limit, fn) {
  const out = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const i = next++;
      out[i] = await fn(values[i], i);
      if ((i + 1) % 100 === 0) console.log(`snapshot progress ${i + 1}/${values.length}`);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

const latestBlockHex = await rpc('eth_blockNumber', []);
const latestBlock = Number(BigInt(latestBlockHex));
const blockTag = process.env.SNAPSHOT_BLOCK
  ? `0x${BigInt(process.env.SNAPSHOT_BLOCK).toString(16)}`
  : latestBlockHex;
const snapshotBlock = Number(BigInt(blockTag));
const expectedTotalSupply = await totalSupply(blockTag);

const tokenIds = [];
for (let tokenId = TOKEN_START; tokenId <= TOKEN_END; tokenId++) tokenIds.push(tokenId);

console.log(`Taking Normie snapshot ${TOKEN_START}-${TOKEN_END} at block ${snapshotBlock} (${tokenIds.length} ownerOf calls).`);
if (expectedTotalSupply !== null) console.log(`Normies totalSupply at block ${snapshotBlock}: ${expectedTotalSupply}.`);
const rows = await mapLimit(tokenIds, CONCURRENCY, async tokenId => {
  const owner = await ownerOf(tokenId, blockTag);
  return owner ? { tokenId, owner } : null;
});

const byOwner = new Map();
for (const row of rows) {
  if (!row) continue;
  if (!byOwner.has(row.owner)) byOwner.set(row.owner, []);
  byOwner.get(row.owner).push(row.tokenId);
}

const holders = [...byOwner.entries()]
  .map(([wallet, normies]) => ({ wallet, normies: normies.sort((a, b) => a - b) }))
  .sort((a, b) => a.wallet.localeCompare(b.wallet));

const snapshot = {
  schema: 'blockcassone.normie-snapshot.v1',
  createdAt: new Date().toISOString(),
  snapshotBlock,
  chainId: 1,
  normiesContract: NORMIES_CONTRACT,
  tokenStart: TOKEN_START,
  tokenEnd: TOKEN_END,
  totalSupply: expectedTotalSupply,
  holders,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${OUT_PATH}: ${holders.length} holders, ${rows.filter(Boolean).length} tokens.`);
console.log(`Latest block when script started: ${latestBlock}`);

if (expectedTotalSupply !== null && rows.filter(Boolean).length !== expectedTotalSupply) {
  console.error(`Snapshot token count mismatch: found ${rows.filter(Boolean).length}, totalSupply is ${expectedTotalSupply}.`);
  process.exitCode = 1;
}
