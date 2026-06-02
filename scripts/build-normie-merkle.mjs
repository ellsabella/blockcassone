import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { keccak_256 } = require('js-sha3');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'data', 'normie-snapshot.json');
const OUT_PATH = path.join(REPO_ROOT, 'data', 'normie-merkle.json');

function strip0x(value) {
  return String(value || '').replace(/^0x/i, '').toLowerCase();
}

function hex(buffer) {
  return `0x${Buffer.from(buffer).toString('hex')}`;
}

function wordFromBigInt(value) {
  const out = Buffer.alloc(32);
  out.writeBigUInt64BE(BigInt(value), 24);
  return out;
}

function wordFromAddress(address) {
  const clean = strip0x(address);
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`Invalid address: ${address}`);
  return Buffer.concat([Buffer.alloc(12), Buffer.from(clean, 'hex')]);
}

function wordFromBytes32(value) {
  const clean = strip0x(value);
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`Invalid bytes32: ${value}`);
  return Buffer.from(clean, 'hex');
}

function keccak256(data) {
  return Buffer.from(keccak_256.arrayBuffer(data));
}

function hashUintArray(values) {
  const head = wordFromBigInt(32);
  const len = wordFromBigInt(values.length);
  const body = Buffer.concat(values.map(wordFromBigInt));
  return hex(keccak256(Buffer.concat([head, len, body])));
}

function hashSnapshot(wallet, normies) {
  return hex(keccak256(Buffer.concat([
    wordFromAddress(wallet),
    wordFromBytes32(hashUintArray(normies)),
  ])));
}

function compareHex(a, b) {
  return strip0x(a).localeCompare(strip0x(b));
}

function hashPair(a, b) {
  const [left, right] = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return hex(keccak256(Buffer.concat([wordFromBytes32(left), wordFromBytes32(right)])));
}

function buildLayers(leaves) {
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

function proofForIndex(layers, index) {
  const proof = [];
  let idx = index;
  for (let level = 0; level < layers.length - 1; level++) {
    const sibling = idx ^ 1;
    if (sibling < layers[level].length) proof.push(layers[level][sibling]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function normalizeSnapshot(raw) {
  const holders = Array.isArray(raw.holders) ? raw.holders : [];
  return holders
    .map(row => ({
      wallet: `0x${strip0x(row.wallet || row.address || row.owner)}`,
      normies: (row.normies || row.tokenIds || row.tokens || [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id >= 0)
        .sort((a, b) => a - b),
    }))
    .filter(row => /^[0-9a-f]{40}$/.test(strip0x(row.wallet)) && row.normies.length)
    .sort((a, b) => compareHex(a.wallet, b.wallet));
}

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
const holders = normalizeSnapshot(snapshot);
const leaves = holders
  .map(row => ({ ...row, leaf: hashSnapshot(row.wallet, row.normies) }))
  .sort((a, b) => compareHex(a.leaf, b.leaf));
const layers = buildLayers(leaves.map(row => row.leaf));
const root = layers[layers.length - 1]?.[0] || '0x' + '00'.repeat(32);

const artifact = {
  schema: 'blockcassone.normie-merkle.v1',
  createdAt: new Date().toISOString(),
  snapshotBlock: snapshot.snapshotBlock ?? null,
  chainId: Number(snapshot.chainId || 1),
  normiesContract: snapshot.normiesContract,
  totalSupply: snapshot.totalSupply ?? null,
  holderCount: holders.length,
  tokenCount: holders.reduce((sum, row) => sum + row.normies.length, 0),
  hash: 'keccak256(abi.encode(wallet, keccak256(abi.encode(normieIds))))',
  tree: 'sorted-pairs',
  root,
  leaves: leaves.map((row, index) => ({
    wallet: row.wallet,
    normies: row.normies,
    leaf: row.leaf,
    proof: proofForIndex(layers, index),
  })),
};

fs.writeFileSync(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${OUT_PATH}`);
console.log(`root ${root}`);
console.log(`${artifact.holderCount} holders, ${artifact.tokenCount} normies`);
