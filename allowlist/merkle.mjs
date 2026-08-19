#!/usr/bin/env node
// Allowlist merkle generator for the SeaDrop drop — ONE tree for BOTH gated stages,
// because SeaDrop stores a single merkle root per token:
//   - GTD leaves  (stage 1, window --start..--end): each winner capped at exactly their
//     reservation count, so they can only mint their guaranteed chosen art.
//   - FCFS leaves (stage 2, window --fcfs-start..--fcfs-end): the wider registered-
//     interest community, random art, cap --fcfs-cap (default 8).
// A wallet may appear in both stages (two leaves); SeaDrop's per-wallet counter is
// GLOBAL, so a GTD winner minting 5 reservations has 3 left under an 8-cap FCFS leaf.
// Output feeds `updateAllowList` (root) and the mint UI / allowListURI (proofs).
//
// Leaf/tree format matches OpenSea SeaDrop 1.0 (proven against the real contract in
// test/SeaDropForkE2E.t.sol): leaf = keccak256(abi.encode(minter, MintParams)); internal
// nodes = commutative keccak (sorted pair); odd node carries up.
//
//   node merkle.mjs --in reserve-plan.json --start <unix> --end <unix> [--out-dir .]
//   node merkle.mjs ... --fcfs fcfs-wallets.json --fcfs-start <unix> --fcfs-end <unix> [--fcfs-cap 8]
//   node merkle.mjs ... --fcfs-config stages.json             # SEVERAL gated phases in the one tree:
//                                                             # [{name, wallets: <file|[addrs|{wallet,count}]>, start, end, cap?, stage?, price?}, ...]
//                                                             # a {wallet,count} entry overrides the group cap (per-wallet guaranteed slots)
//   node merkle.mjs ... --gtd-rollover <groupName> [--gtd-rollover-cap 5]
//                                                             # also give every GTD winner a leaf in that group (random art,
//                                                             # cap = TOTAL incl. their GTD mints — strict-release rollover)
//   node merkle.mjs ... --verify-rpc <url> --minter <addr>   # assert each GTD leaf cap == on-chain reservationCount
//   node merkle.mjs --counts winners.json --start … --end …  # winners.json: [{wallet,count}]
//   node merkle.mjs --selftest                                # deterministic vectors (for cross-check)
import fs from 'node:fs';
import { createPublicClient, http, encodeAbiParameters, keccak256, parseEther } from 'viem';

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
// `winners` rows: {wallet, count, stage?, cfg?} — per-row cfg overrides the shared one
// (used to put GTD and FCFS leaves, with different windows/stages, in the same tree).
function generate(winners, cfg) {
  const entries = winners.map(w => ({
    wallet: norm(w.wallet), count: Number(w.count), stage: w.stage || 'gtd',
    params: makeParams(w.count, w.cfg || cfg),
  }));
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

// Gated-group wallets: JSON array of addresses or {wallet, count?} objects (count
// overrides the group cap — for "guaranteed slot" lists where wallets earned
// different amounts), or a text/csv file with one address per line (a leading
// `address,...` header row is skipped). Deduped; first entry wins on conflict.
function loadGroupWallets(source) {
  let list = source;
  if (!Array.isArray(source)) {
    const raw = fs.readFileSync(source, 'utf8');
    try { list = JSON.parse(raw); } catch {
      list = raw.split('\n').map(l => l.split(',')[0].trim()).filter(l => /^0x/i.test(l));
    }
  }
  const seen = new Map();
  for (const x of list) {
    const wallet = norm(typeof x === 'string' ? x : x.wallet);
    if (!seen.has(wallet)) seen.set(wallet, typeof x === 'object' && x.count != null ? Number(x.count) : undefined);
  }
  return [...seen.entries()].map(([wallet, count]) => ({ wallet, count }));
}

// The guarantee's tooling backstop: every GTD leaf cap must equal the wallet's baked
// on-chain reservation count — a fatter cap would let the surplus spill into a random
// draw once the GTD window ends (and revert inside it). Fails the build on mismatch.
async function verifyGtdCapsOnChain(gtdWinners, rpcUrl, minter) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const abi = [{ type: 'function', name: 'reservationCount', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
  const bad = [];
  for (const w of gtdWinners) {
    const onchain = await client.readContract({ address: minter, abi, functionName: 'reservationCount', args: [w.wallet] });
    if (Number(onchain) !== w.count) bad.push(`${w.wallet}: leaf cap ${w.count} != on-chain reservationCount ${onchain}`);
  }
  if (bad.length) throw new Error(`GTD cap/reservation mismatch:\n  ${bad.join('\n  ')}`);
  console.log(`on-chain verify OK: ${gtdWinners.length} GTD leaf caps match reservationCount.`);
}

async function main() {
  if (has('selftest')) {
    const cfg = { price: parseEther('0.0069'), start: 1000, end: 2000, stage: 1, maxSupply: 4096, feeBps: 500, restrict: true };
    const fcfsCfg = { ...cfg, start: 2000, end: 3000, stage: 2 };
    const { root, entries } = generate([
      { wallet: '0x0000000000000000000000000000000000000b1d', count: 1 },
      { wallet: '0x0000000000000000000000000000000000000b2d', count: 2 },
      { wallet: '0x0000000000000000000000000000000000000fcf', count: 8, stage: 'fcfs', cfg: fcfsCfg },
    ], cfg);
    console.log('root', root);
    entries.forEach(e => console.log(e.wallet, e.stage, 'cap', e.count, 'leaf', e.leaf, 'proof', e.proof));
    return;
  }

  const start = flag('start'), end = flag('end');
  if (!start || !end) { console.error('Missing --start / --end (unix seconds for the GTD window).'); process.exit(1); }
  const cfg = {
    price: parseEther(flag('price') || '0.0069'), start, end,
    stage: flag('stage') || 1, maxSupply: flag('max-supply') || 4096,
    feeBps: flag('fee-bps') || 500, restrict: !has('no-restrict-fees'),
  };
  const gtdWinners = loadWinners().filter(w => w.count > 0);
  if (!gtdWinners.length) { console.error('No winners with count > 0.'); process.exit(1); }

  // Tooling backstop for the chosen-art guarantee (see verifyGtdCapsOnChain).
  if (flag('verify-rpc')) {
    if (!flag('minter')) { console.error('--verify-rpc needs --minter <MultiSourceGenesisMinter addr>.'); process.exit(1); }
    await verifyGtdCapsOnChain(gtdWinners, flag('verify-rpc'), flag('minter'));
  } else {
    console.warn('WARN: no --verify-rpc — GTD leaf caps NOT checked against on-chain reservations.');
  }

  // Gated FCFS phase(s) (registered interest, random art) — same tree, each group
  // gets its own window + dropStageIndex. `--fcfs-config` takes N groups (e.g. an
  // early community FCFS then a wider one); `--fcfs` is the single-group shorthand.
  // Remember: per-wallet caps are CUMULATIVE across stages (SeaDrop's counter is
  // global), and maxTokenSupplyForStage bounds are vs the GLOBAL minted count.
  let rows = gtdWinners;
  const groups = [];
  if (flag('fcfs-config')) {
    const defs = JSON.parse(fs.readFileSync(flag('fcfs-config'), 'utf8'));
    if (!Array.isArray(defs) || !defs.length) { console.error('--fcfs-config must be a non-empty JSON array.'); process.exit(1); }
    defs.forEach((d, i) => {
      if (!d.start || !d.end || !d.wallets) { console.error(`fcfs-config[${i}]: needs wallets, start, end.`); process.exit(1); }
      groups.push({
        name: d.name || `fcfs${i + 1}`,
        wallets: loadGroupWallets(d.wallets),
        start: d.start, end: d.end, cap: Number(d.cap || 8), stage: d.stage || i + 2,
        price: d.price, maxSupply: d.maxSupply,
      });
    });
  } else if (flag('fcfs')) {
    const fs_ = flag('fcfs-start'), fe = flag('fcfs-end');
    if (!fs_ || !fe) { console.error('Missing --fcfs-start / --fcfs-end (unix seconds for the FCFS window).'); process.exit(1); }
    groups.push({
      name: 'fcfs', wallets: loadGroupWallets(flag('fcfs')), start: fs_, end: fe,
      cap: Number(flag('fcfs-cap') || 8), stage: flag('fcfs-stage') || 2, price: flag('fcfs-price'),
    });
  }
  // Strict-release rollover (user policy 2026-08-12): every GTD winner ALSO gets a
  // leaf in the named phase-2 group at a flat cap (default 5) — random art. The cap
  // is a TOTAL, not extra: SeaDrop's counter is cumulative, so 5/5 chosen picks
  // minted in GTD -> 0 here; a no-show -> 5 random; minted 3 -> tops up with 2.
  if (flag('gtd-rollover')) {
    const grp = groups.find(g => g.name === flag('gtd-rollover'));
    if (!grp) { console.error(`--gtd-rollover: no group named "${flag('gtd-rollover')}" in --fcfs-config.`); process.exit(1); }
    const cap = Number(flag('gtd-rollover-cap') || 5);
    const present = new Set(grp.wallets.map(w => w.wallet));
    let added = 0;
    for (const w of gtdWinners) {
      const wallet = norm(w.wallet);
      if (!present.has(wallet)) { grp.wallets.push({ wallet, count: cap }); added++; }
    }
    console.log(`gtd-rollover: ${added} GTD winners added to "${grp.name}" at cap ${cap} TOTAL (their GTD mints count against it).`);
  }

  for (const gset of groups) {
    if (Number(gset.start) <= Number(end)) console.warn(`WARN: ${gset.name} opens (${gset.start}) before the GTD window ends (${end}) — the on-chain gtdEndTime will still block random draws until it passes.`);
    const gCfg = {
      price: parseEther(gset.price || flag('price') || '0.0069'), start: gset.start, end: gset.end,
      stage: gset.stage, maxSupply: gset.maxSupply || flag('max-supply') || 4096,
      feeBps: flag('fee-bps') || 500, restrict: !has('no-restrict-fees'),
    };
    rows = rows.concat(gset.wallets.map(w => ({ wallet: w.wallet, count: w.count ?? gset.cap, stage: gset.name, cfg: gCfg })));
  }

  const { root, entries } = generate(rows, cfg);
  const outDir = flag('out-dir') || '.';
  fs.writeFileSync(`${outDir}/allowlist-root.txt`, root + '\n');
  fs.writeFileSync(`${outDir}/allowlist-proofs.json`, JSON.stringify(
    entries.map(e => ({ wallet: e.wallet, stage: e.stage, maxMintable: e.count, leaf: e.leaf, proof: e.proof, mintParams: serialize(e.params) })), null, 2));
  fs.writeFileSync(`${outDir}/allowlist.csv`, 'address,stage,maxMintable\n' + entries.map(e => `${e.wallet},${e.stage},${e.count}`).join('\n') + '\n');

  const gtd = entries.filter(e => e.stage === 'gtd');
  const byStage = {};
  entries.forEach(e => { byStage[e.stage] = (byStage[e.stage] || 0) + 1; });
  console.log(`${gtd.length} GTD winners (${gtd.reduce((a, e) => a + e.count, 0)} guaranteed spots); leaves per stage: ${Object.entries(byStage).map(([s, n]) => `${s}=${n}`).join(', ')}.`);
  console.log(`root  ${root}`);
  console.log(`wrote ${outDir}/allowlist-root.txt, allowlist-proofs.json, allowlist.csv`);
  console.log('ONE root covers ALL gated stages (SeaDrop holds a single root per token — never swap it mid-mint).');
  console.log('Set it via cubes.updateAllowList(seaDrop, {merkleRoot: root, ...}); serve allowlist-proofs.json for the mint UI / allowListURI.');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
