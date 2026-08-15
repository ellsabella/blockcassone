#!/usr/bin/env node
// FULL-STRENGTH Sepolia validation driver: 4096-slot world, real pools (2,417 CC0
// payloads + 1,679 Normie candidates), real SeaDrop. Runs sample mints through all
// four phases (not a sellout — the world stays mintable), bakes mock-Normie art for
// every minted cube, exercises move + merge, and writes an OCC review report.
// Resumable via data/sepolia-full/state.json; rerun skips completed steps.
//
//   node scripts/full-driver.mjs [--fresh]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseEther, getAddress } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(repoRoot, 'data', 'sepolia-full');
const STATE = path.join(DIR, 'state.json');
const RPC = process.env.BLOCKCASSONE_RPC_URL;
const FUNDER_PK = process.env.DEV_THROWAWAY_PRIVATE;
if (!RPC || !FUNDER_PK) { console.error('Need BLOCKCASSONE_RPC_URL + DEV_THROWAWAY_PRIVATE.'); process.exit(1); }

const PRICE = parseEther('0.0001');
const SEADROP = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
const pub = createPublicClient({ transport: http(RPC) });
const funder = privateKeyToAccount(FUNDER_PK.startsWith('0x') ? FUNDER_PK : `0x${FUNDER_PK}`);
const wallet = pk => createWalletClient({ account: privateKeyToAccount(pk), transport: http(RPC) });

const MINTPARAMS_ABI = { type: 'tuple', components: [
  { name: 'mintPrice', type: 'uint256' }, { name: 'maxTotalMintableByWallet', type: 'uint256' },
  { name: 'startTime', type: 'uint256' }, { name: 'endTime', type: 'uint256' },
  { name: 'dropStageIndex', type: 'uint256' }, { name: 'maxTokenSupplyForStage', type: 'uint256' },
  { name: 'feeBps', type: 'uint256' }, { name: 'restrictFeeRecipients', type: 'bool' } ] };
const SEADROP_ABI = [
  { type: 'function', name: 'mintPublic', stateMutability: 'payable',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'mintAllowList', stateMutability: 'payable',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, MINTPARAMS_ABI, { type: 'bytes32[]' }], outputs: [] },
];
const CUBE_ABI = [
  { type: 'function', name: 'nextCubeId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'cubeForSlot', stateMutability: 'view', inputs: [{ type: 'uint32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'cubeDataUnchecked', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'slot', type: 'uint32' }, { name: 'sourceKind', type: 'uint8' }, { name: 'rendererVersion', type: 'uint8' },
      { name: 'payloadVersion', type: 'uint8' }, { name: 'agentic', type: 'bool' }, { name: 'agentId', type: 'uint256' },
      { name: 'mintedAt', type: 'uint64' }, { name: 'sourceChainId', type: 'uint256' }, { name: 'sourceContract', type: 'address' },
      { name: 'sourceTokenId', type: 'uint256' }, { name: 'seed', type: 'bytes32' } ] }] },
  { type: 'function', name: 'moveCube', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'mergeStreet', stateMutability: 'payable', inputs: [{ type: 'uint32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'streetPlots', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint32' }, { type: 'uint8' }, { type: 'uint256[8]' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];
const MINTER_ABI = [
  { type: 'function', name: 'reservationRemaining', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'releaseReservations', stateMutability: 'nonpayable', inputs: [{ type: 'address[]' }], outputs: [] },
  { type: 'function', name: 'mintedCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalPublicRemaining', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];
const STORE_ABI = [
  { type: 'function', name: 'setChunk', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] },
];
const NORMIES_ABI = [
  { type: 'function', name: 'mintWithDataBatch', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256[]' }, { type: 'bytes[]' }], outputs: [] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const state = fs.existsSync(STATE) && !process.argv.includes('--fresh') ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { done: {}, results: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
const step = async (name, fn) => {
  if (state.done[name]) { log(`step ${name}: already done`); return; }
  log(`step ${name}: starting`);
  await fn();
  state.done[name] = true; save();
  log(`step ${name}: DONE`);
};
async function chainNow() { return Number((await pub.getBlock()).timestamp); }
async function waitUntil(ts, label) {
  for (;;) {
    const now = await chainNow();
    if (now >= ts) return;
    log(`waiting for ${label} (~${ts - now}s)`);
    await sleep(Math.min((ts - now) * 1000, 30000));
  }
}
async function send(w, req) {
  const hash = await w.writeContract({ ...req, chain: null });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`tx reverted: ${hash}`);
  return hash;
}
async function expectRevert(label, fn) {
  try { await fn(); state.results[label] = 'UNEXPECTED SUCCESS'; log(`NEGATIVE ${label}: !! succeeded`); }
  catch (e) { state.results[label] = `reverted: ${(e.shortMessage || e.message || '').split('\n')[0]}`; log(`negative ${label}: reverted (ok)`); }
  save();
}

async function prep() {
  fs.mkdirSync(DIR, { recursive: true });
  const T0 = await chainNow();
  state.sched = { T0, gtdEnd: T0 + 45 * 60, p2End: T0 + 53 * 60, p3End: T0 + 61 * 60, pubEnd: T0 + 30 * 24 * 3600 };
  const names = ['gtd1', 'gtd2', 'p2a', 'f1', 'pub1', 'pub2'];
  const wallets = state.wallets && names.every(n => state.wallets[n]) ? state.wallets : {};
  if (!Object.keys(wallets).length) {
    for (const n of names) { const pk = generatePrivateKey(); wallets[n] = { pk, addr: privateKeyToAccount(pk).address }; }
  }
  state.wallets = wallets;
  fs.writeFileSync(path.join(DIR, 'gtd-counts.json'), JSON.stringify([
    { wallet: wallets.gtd1.addr, count: 2 }, { wallet: wallets.gtd2.addr, count: 1 }]));
  fs.writeFileSync(path.join(DIR, 'stages.json'), JSON.stringify([
    { name: 'guaranteed-random', wallets: [{ wallet: wallets.p2a.addr, count: 1 }], start: state.sched.gtdEnd, end: state.sched.p2End, cap: 1, stage: 2 },
    { name: 'fcfs', wallets: [wallets.f1.addr], start: state.sched.p2End, end: state.sched.p3End, cap: 8, stage: 3 },
  ], null, 2));
  save();
}

function tree() {
  const s = state.sched;
  const r = spawnSync('node', ['allowlist/merkle.mjs', '--counts', 'data/sepolia-full/gtd-counts.json',
    '--start', String(s.T0), '--end', String(s.gtdEnd), '--price', '0.0001',
    '--fcfs-config', 'data/sepolia-full/stages.json', '--gtd-rollover', 'guaranteed-random',
    '--out-dir', 'data/sepolia-full'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`merkle.mjs failed:\n${r.stdout}\n${r.stderr}`);
  console.log(r.stdout.trim());
  state.root = fs.readFileSync(path.join(DIR, 'allowlist-root.txt'), 'utf8').trim();
  save();
}

async function fund() {
  const w = createWalletClient({ account: funder, transport: http(RPC) });
  for (const [n, info] of Object.entries(state.wallets)) {
    const bal = await pub.getBalance({ address: info.addr });
    if (bal > parseEther('0.01')) { log(`${n} already funded`); continue; }
    const hash = await w.sendTransaction({ to: info.addr, value: parseEther('0.02'), chain: null });
    await pub.waitForTransactionReceipt({ hash });
    log(`funded ${n}`);
  }
}

function deploy() {
  const s = state.sched;
  // On retry, --resume replays the saved broadcast plan and skips already-mined
  // txs — a mid-deploy failure (gas, 429s) costs nothing on the rerun.
  const args = ['script',
    'contracts/script/DeploySepoliaFull.s.sol:DeploySepoliaFull',
    '--rpc-url', RPC, '--private-key', FUNDER_PK, '--broadcast', '--slow', '-vv'];
  if (state.deployStarted) args.push('--resume');
  state.deployStarted = true; save();
  const r = spawnSync(`${process.env.HOME}/.foundry/bin/forge`, args,
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env,
      BLOCKCASSONE_ALLOWLIST_ROOT: state.root,
      BLOCKCASSONE_GTD_END: String(s.gtdEnd),
      BLOCKCASSONE_PUBLIC_START: String(s.p3End),
      BLOCKCASSONE_PUBLIC_END: String(s.pubEnd),
      BLOCKCASSONE_MINT_PRICE: PRICE.toString(),
      BLOCKCASSONE_GTD1: state.wallets.gtd1.addr,
      BLOCKCASSONE_GTD2: state.wallets.gtd2.addr,
    }, timeout: 55 * 60 * 1000 });
  fs.writeFileSync(path.join(DIR, 'deploy-log.txt'), (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) throw new Error(`forge script failed (data/sepolia-full/deploy-log.txt): ${((r.stdout || '') + (r.stderr || '')).slice(-600)}`);
  state.contracts = JSON.parse(fs.readFileSync(path.join(DIR, 'contracts.json'), 'utf8'));
  log(`deployed CubeNFT ${state.contracts.cubeNft}, remaining ${state.contracts.totalSlots} slots`);
  save();
}

async function chunks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/token-renderer/renderer-chunks.json'), 'utf8'));
  const w = createWalletClient({ account: funder, transport: http(RPC) });
  for (let i = 0; i < manifest.chunks.length; i++) {
    await send(w, { address: state.contracts.rendererAssetStore, abi: STORE_ABI, functionName: 'setChunk', args: [BigInt(manifest.scriptStartChunkId + i), manifest.chunks[i]] });
    log(`chunk id ${manifest.scriptStartChunkId + i} uploaded`);
  }
}

const leafFor = (addr, stage) => {
  const e = JSON.parse(fs.readFileSync(path.join(DIR, 'allowlist-proofs.json'), 'utf8'))
    .find(p => p.wallet === addr.toLowerCase() && p.stage === stage);
  if (!e) throw new Error(`no ${stage} leaf for ${addr}`);
  const mp = e.mintParams;
  return { proof: e.proof, params: { mintPrice: BigInt(mp.mintPrice), maxTotalMintableByWallet: BigInt(mp.maxTotalMintableByWallet),
    startTime: BigInt(mp.startTime), endTime: BigInt(mp.endTime), dropStageIndex: BigInt(mp.dropStageIndex),
    maxTokenSupplyForStage: BigInt(mp.maxTokenSupplyForStage), feeBps: BigInt(mp.feeBps), restrictFeeRecipients: mp.restrictFeeRecipients } };
};
async function mintAllowList(who, stage, qty) {
  const { pk, addr } = state.wallets[who];
  const { proof, params } = leafFor(addr, stage);
  await send(wallet(pk), { address: SEADROP, abi: SEADROP_ABI, functionName: 'mintAllowList',
    args: [state.contracts.cubeNft, funder.address, '0x0000000000000000000000000000000000000000', BigInt(qty), params, proof],
    value: PRICE * BigInt(qty) });
  log(`${who} minted ${qty} (${stage})`);
}
async function mintPublic(who, qty) {
  await send(wallet(state.wallets[who].pk), { address: SEADROP, abi: SEADROP_ABI, functionName: 'mintPublic',
    args: [state.contracts.cubeNft, funder.address, '0x0000000000000000000000000000000000000000', BigInt(qty)],
    value: PRICE * BigInt(qty) });
  log(`${who} minted ${qty} (public)`);
}

async function phaseGtd() {
  await expectRevert('public-during-gtd', () => mintPublic('pub1', 1));
  await expectRevert('fcfs-during-gtd', () => mintAllowList('f1', 'fcfs', 1));
  await expectRevert('gtd-overcap', () => mintAllowList('gtd1', 'gtd', 3));
  await mintAllowList('gtd1', 'gtd', 2);
  const rem = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'reservationRemaining', args: [state.wallets.gtd1.addr] });
  if (Number(rem) !== 0) throw new Error('gtd1 reservations not consumed');
  state.results.gtd = `gtd1 minted chosen Normies #${state.contracts.gtd1ReservedA} + #${state.contracts.gtd1ReservedB}`;
  save();
}

async function phaseP2() {
  await waitUntil(state.sched.gtdEnd + 15, 'GTD close');
  await send(wallet(state.wallets.pub2.pk), { address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'releaseReservations', args: [[state.wallets.gtd2.addr]] });
  log(`gtd2 no-show reservation (Runner #${state.contracts.gtd2Reserved}) released permissionlessly`);
  await mintAllowList('gtd1', 'guaranteed-random', 3);
  await expectRevert('gtd1-past-rollover-cap', () => mintAllowList('gtd1', 'guaranteed-random', 1));
  await mintAllowList('gtd2', 'guaranteed-random', 5);
  await mintAllowList('p2a', 'guaranteed-random', 1);
  state.results.p2 = 'permissionless release + rollover caps OK';
  save();
}

async function phaseP3() {
  await waitUntil(state.sched.p2End + 15, 'P2 close');
  await expectRevert('p2-leaf-expired', () => mintAllowList('p2a', 'guaranteed-random', 1));
  await mintAllowList('f1', 'fcfs', 8);
  save();
}

async function phasePublic() {
  await waitUntil(state.sched.p3End + 15, 'public open');
  await mintPublic('pub1', 8);
  await mintPublic('pub2', 8);
  const minted = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'mintedCount', args: [] });
  const remaining = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'totalPublicRemaining', args: [] });
  state.results.public = `minted ${minted}/4096, ${remaining} still publicly available`;
  save();
}

async function tokenMap() {
  const cube = state.contracts.cubeNft;
  const next = Number(await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'nextCubeId' }));
  const label = {}; for (const [n, i] of Object.entries(state.wallets)) label[getAddress(i.addr)] = n;
  const srcName = {}; srcName[getAddress(state.contracts.normies)] = 'Normie';
  const cc = ['Chain Runners', '1337 skulls', 'Baby Pepes', 'Nouns', 'OnChainKevin'];
  for (let i = 1; i <= 5; i++) srcName[getAddress(state.contracts[`cc0_${i}`])] = cc[i - 1];
  const rows = [];
  for (let id = 1; id < next; id++) {
    let owner = null;
    try { owner = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'ownerOf', args: [BigInt(id)] }); } catch { }
    const d = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'cubeDataUnchecked', args: [BigInt(id)] });
    rows.push({ id, owner: owner ? (label[getAddress(owner)] || owner) : 'BURNED(merged)', slot: d.slot, street: Math.floor(d.slot / 8),
      source: srcName[getAddress(d.sourceContract)] || d.sourceContract, sourceTokenId: Number(d.sourceTokenId) });
  }
  return rows;
}

// Mock-Normie art is baked lazily: fetch every minted Normie-sourced cube's real
// 200-byte bitmap from data/normie-raw-full and store it in the mock so renders
// match mainnet. (Renderer reads art at view time only.)
async function bakeArt() {
  const rows = await tokenMap();
  const ids = [...new Set(rows.filter(r => r.source === 'Normie').map(r => r.sourceTokenId))];
  const missing = ids.filter(id => !fs.existsSync(path.join(repoRoot, 'data', 'normie-raw-full', `${id}.hex`)));
  if (missing.length) throw new Error(`no raw art for normie ids: ${missing.join(',')}`);
  const w = createWalletClient({ account: funder, transport: http(RPC) });
  for (let off = 0; off < ids.length; off += 40) {
    const batch = ids.slice(off, off + 40);
    const raws = batch.map(id => fs.readFileSync(path.join(repoRoot, 'data', 'normie-raw-full', `${id}.hex`), 'utf8').trim());
    await send(w, { address: state.contracts.normies, abi: NORMIES_ABI, functionName: 'mintWithDataBatch',
      args: [funder.address, batch.map(BigInt), raws] });
    log(`baked art for ${batch.length} normies`);
  }
  state.results.bakedNormieArt = ids.length;
  save();
}

async function moveAndMerge() {
  const cube = state.contracts.cubeNft;
  const rows = await tokenMap();
  // Move: pub1 relocates one cube to a far vacant street (plenty of vacancy at 35/4096).
  const mover = rows.find(r => r.owner === 'pub1');
  await send(wallet(state.wallets.pub1.pk), { address: cube, abi: CUBE_ABI, functionName: 'moveCube', args: [BigInt(mover.id), 4000], value: parseEther('0.002') });
  log(`moved cube #${mover.id} slot ${mover.slot} -> 4000 (street 500)`);
  // Merge: gtd1 minted 5 -> anchors street 0 slots 0-4, sole owner, 3 vacant plots.
  const hash = await wallet(state.wallets.gtd1.pk).writeContract({ address: cube, abi: CUBE_ABI, functionName: 'mergeStreet', args: [0], value: parseEther('0.01'), chain: null });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error('merge reverted');
  const next = Number(await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'nextCubeId' }));
  const streetToken = next - 1;
  const [street, occ] = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'streetPlots', args: [BigInt(streetToken)] });
  state.results.merge = { streetToken, street: Number(street), occupied: Number(occ), movedCube: mover.id, movedToSlot: 4000 };
  log(`merged street ${street} -> token #${streetToken} (${occ} plots)`);
  save();
}

async function report() {
  const rows = await tokenMap();
  const c = state.contracts;
  const uriCheck = {};
  const streetTokenId = state.results.merge ? state.results.merge.streetToken : -1;
  for (const probe of [
    rows.find(r => r.source === 'Normie' && r.owner !== 'BURNED(merged)' && r.id !== streetTokenId),
    rows.find(r => r.source !== 'Normie' && typeof r.source === 'string' && r.owner !== 'BURNED(merged)' && r.id !== streetTokenId),
    rows.find(r => r.id === streetTokenId),
  ]) {
    if (!probe) continue;
    try {
      const uri = await pub.readContract({ address: c.cubeNft, abi: CUBE_ABI, functionName: 'tokenURI', args: [BigInt(probe.id)] });
      uriCheck[probe.id] = `OK (${uri.length} chars, ${uri.slice(0, 29)})`;
    } catch (e) { uriCheck[probe.id] = `RPC render failed (${(e.shortMessage || '').slice(0, 60)}) — check on OCC`; }
  }
  const lines = ['# TheBLOCK — FULL Sepolia Deployment Report', ''];
  lines.push(`- CubeNFT: \`${c.cubeNft}\` (4096 slots, full pools committed + finalized)`);
  lines.push(`- Minter: \`${c.genesisMinter}\``, `- SeaDrop (real): \`${c.seaDrop}\``, '');
  lines.push('## Results', '');
  for (const [k, v] of Object.entries(state.results)) lines.push(`- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  lines.push('', '## tokenURI spot checks', '');
  for (const [id, r] of Object.entries(uriCheck)) lines.push(`- cube #${id}: ${r}`);
  lines.push('', '## Token map', '', '| cube | owner | slot | street | source | sourceTokenId |', '|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.id} | ${r.owner} | ${r.slot} | ${r.street} | ${r.source} | ${r.sourceTokenId} |`);
  lines.push('', `OnChainChecker: \`${c.cubeNft}\` on Sepolia (11155111). Merged street token: #${streetTokenId}.`);
  fs.writeFileSync(path.join(DIR, 'REPORT.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify({ contracts: c, results: state.results, tokens: rows }, null, 2));
  log('report: data/sepolia-full/REPORT.md');
}

async function main() {
  await step('prep', prep);
  await step('tree', () => tree());
  await step('fund', fund);
  await step('deploy', () => deploy());
  await step('chunks', chunks);
  await step('gtd', phaseGtd);
  await step('p2', phaseP2);
  await step('p3', phaseP3);
  await step('public', phasePublic);
  await step('bakeArt', bakeArt);
  await step('moveMerge', moveAndMerge);
  await step('report', report);
  log('FULL DEPLOYMENT VALIDATION COMPLETE — data/sepolia-full/REPORT.md');
}

main().catch(e => { console.error(e); process.exit(1); });
