#!/usr/bin/env node
// GTD allowlist merkle generator for the SeaDrop drop. Each winner's leaf caps them at
// exactly their reservation count and pins the 0.0069 price — so a winner can only mint
// their guaranteed art, and only in the GTD window. Output feeds `updateAllowList` (root)
// and the mint UI / allowListURI (per-winner proofs).
//
// Leaf/tree format matches OpenSea SeaDrop 1.0 (proven against the real contract in
// test/SeaDropForkE2E.t.sol): leaf = keccak256(abi.encode(minter, MintParams)); internal
// nodes = commutative keccak (sorted pair); odd node carries up.
//
//   node merkle.mjs --in reserve-plan.json --start <unix> --end <unix> [--out-dir .]
//   node merkle.mjs --counts winners.json --start … --end …      # winners.json: [{wallet,count}]
//   node merkle.mjs --selftest                                    # deterministic vectors (for cross-check)
import fs from 'node:fs';
import { encodeAbiParameters, keccak256, parseEther } from 'viem';

// Lowercase + validate (the leaf encodes the 20 address bytes, case-insensitive).
const norm = a => { const s = String(a).toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(s)) throw new Error(`bad address: ${a}`); return s; };

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = n => args.includes(`--${n}`);

const MINTPARAMS = {
  type: 'tuple',
  components: [
    { name: 'mintPrice', type: 'uint256' },
    { name: 'maxTotalMintableByWallet', type: 'uint256' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'dropStageIndex', type: 'uint256' },
    { name: 'maxTokenSupplyForStage', type: 'uint256' },
    { name: 'feeBps', type: 'uint256' },
    { name: 'restrictFeeRecipients', type: 'bool' },
  ],
};

const leafOf = (wallet, p) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, MINTPARAMS], [norm(wallet), p]));

// commutative keccak of two bytes32 (sorted by numeric value) — matches OZ MerkleProof.
const hashPair = (a, b) => {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(('0x' + x.slice(2) + y.slice(2)));
};

function buildLayers(leaves) {
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  return layers;
}
function proofFor(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = idx ^ 1;
    if (sib < layers[l].length) proof.push(layers[l][sib]);
    idx = idx >> 1;
  }
  return proof;
}
const processProof = (leaf, proof) => proof.reduce((h, p) => hashPair(h, p), leaf);

function makeParams(cap, cfg) {
  return {
    mintPrice: cfg.price, maxTotalMintableByWallet: BigInt(cap),
    startTime: BigInt(cfg.start), endTime: BigInt(cfg.end),
    dropStageIndex: BigInt(cfg.stage), maxTokenSupplyForStage: BigInt(cfg.maxSupply),
    feeBps: BigInt(cfg.feeBps), restrictFeeRecipients: cfg.restrict,
  };
}

// Build root + per-winner proofs, then self-verify every proof reproduces the root.
function generate(winners, cfg) {
  const entries = winners.map(w => ({ wallet: norm(w.wallet), count: Number(w.count), params: makeParams(w.count, cfg) }));
  entries.forEach(e => { e.leaf = leafOf(e.wallet, e.params); });
  const layers = buildLayers(entries.map(e => e.leaf));
  const root = layers[layers.length - 1][0];
  entries.forEach((e, i) => {
    e.proof = proofFor(layers, i);
    if (processProof(e.leaf, e.proof) !== root) throw new Error(`self-verify FAILED for ${e.wallet}`);
  });
  return { root, entries };
}

const serialize = p => ({
  mintPrice: p.mintPrice.toString(), maxTotalMintableByWallet: p.maxTotalMintableByWallet.toString(),
  startTime: p.startTime.toString(), endTime: p.endTime.toString(), dropStageIndex: p.dropStageIndex.toString(),
  maxTokenSupplyForStage: p.maxTokenSupplyForStage.toString(), feeBps: p.feeBps.toString(), restrictFeeRecipients: p.restrictFeeRecipients,
});

function loadWinners() {
  if (flag('counts')) return JSON.parse(fs.readFileSync(flag('counts'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(flag('in') || 'reserve-plan.json', 'utf8'));
  const rows = Array.isArray(plan) ? plan : plan.plan;
  return rows.map(p => ({ wallet: p.wallet, count: (p.sourceIds || p.artworks || []).length }));
}

function main() {
  if (has('selftest')) {
    const cfg = { price: parseEther('0.0069'), start: 1000, end: 2000, stage: 1, maxSupply: 4096, feeBps: 500, restrict: true };
    const { root, entries } = generate([
      { wallet: '0x0000000000000000000000000000000000000b1d', count: 1 },
      { wallet: '0x0000000000000000000000000000000000000b2d', count: 2 },
    ], cfg);
    console.log('root', root);
    entries.forEach(e => console.log(e.wallet, 'cap', e.count, 'leaf', e.leaf, 'proof', e.proof));
    return;
  }

  const start = flag('start'), end = flag('end');
  if (!start || !end) { console.error('Missing --start / --end (unix seconds for the GTD window).'); process.exit(1); }
  const cfg = {
    price: parseEther(flag('price') || '0.0069'), start, end,
    stage: flag('stage') || 1, maxSupply: flag('max-supply') || 4096,
    feeBps: flag('fee-bps') || 500, restrict: !has('no-restrict-fees'),
  };
  const winners = loadWinners().filter(w => w.count > 0);
  if (!winners.length) { console.error('No winners with count > 0.'); process.exit(1); }

  const { root, entries } = generate(winners, cfg);
  const outDir = flag('out-dir') || '.';
  fs.writeFileSync(`${outDir}/allowlist-root.txt`, root + '\n');
  fs.writeFileSync(`${outDir}/allowlist-proofs.json`, JSON.stringify(
    entries.map(e => ({ wallet: e.wallet, maxMintable: e.count, leaf: e.leaf, proof: e.proof, mintParams: serialize(e.params) })), null, 2));
  fs.writeFileSync(`${outDir}/allowlist.csv`, 'address,maxMintable\n' + entries.map(e => `${e.wallet},${e.count}`).join('\n') + '\n');

  const total = entries.reduce((a, e) => a + e.count, 0);
  console.log(`${entries.length} winners, ${total} guaranteed spots.`);
  console.log(`root  ${root}`);
  console.log(`wrote ${outDir}/allowlist-root.txt, allowlist-proofs.json, allowlist.csv`);
  console.log('Set the root on-chain via cubes.updateAllowList(seaDrop, {merkleRoot: root, ...}); serve allowlist-proofs.json for the mint UI / allowListURI.');
}

main();
