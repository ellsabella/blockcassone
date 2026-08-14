#!/usr/bin/env node
// Sepolia dress-rehearsal driver: runs the ENTIRE 4-phase drop against the real
// SeaDrop 1.0 singleton, then move + consolidate + merge, and writes a report for
// manual OnChainChecker review. Resumable: each step records into
// data/rehearsal/state.json; rerunning skips completed steps.
//
//   node scripts/rehearsal-driver.mjs            # runs (or resumes) the whole rehearsal
//   node scripts/rehearsal-driver.mjs --fresh    # wipe state and start a new rehearsal
//
// Cast of wallets (ephemeral, funded from DEV_THROWAWAY): gtd1 (2 chosen picks,
// mints in-window), gtd2 (1 chosen pick, PLANNED NO-SHOW -> strict release +
// 5-total rollover), p2a/p2b (guaranteed slot, random), f1..f3 (FCFS cap 8),
// pub1/pub2 (public). World = 47 slots, all real art.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, getAddress } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(repoRoot, 'data', 'rehearsal');
const STATE = path.join(DIR, 'state.json');
const RPC = process.env.BLOCKCASSONE_RPC_URL;
const FUNDER_PK = process.env.DEV_THROWAWAY_PRIVATE;
if (!RPC || !FUNDER_PK) { console.error('Need BLOCKCASSONE_RPC_URL + DEV_THROWAWAY_PRIVATE in env.'); process.exit(1); }

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
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
];
const MINTER_ABI = [
  { type: 'function', name: 'reservationRemaining', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'releaseReservations', stateMutability: 'nonpayable', inputs: [{ type: 'address[]' }], outputs: [] },
  { type: 'function', name: 'mintedCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'gtdEndTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'poolRemaining', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
];
const STORE_ABI = [
  { type: 'function', name: 'setChunk', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] },
  { type: 'function', name: 'setChunkCount', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'chunkCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const state = fs.existsSync(STATE) && !process.argv.includes('--fresh') ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { done: {}, results: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
const step = async (name, fn) => {
  if (state.done[name]) { log(`step ${name}: already done, skipping`); return; }
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
    log(`waiting for ${label} (chain ${now} -> ${ts}, ~${ts - now}s)`);
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
  try { await fn(); state.results[label] = 'UNEXPECTED SUCCESS'; log(`NEGATIVE CHECK ${label}: !! unexpectedly succeeded`); }
  catch (e) { const m = (e.shortMessage || e.message || '').split('\n')[0]; state.results[label] = `reverted: ${m}`; log(`negative check ${label}: correctly reverted (${m})`); }
  save();
}

// ---------- steps ----------

async function prep() {
  fs.mkdirSync(DIR, { recursive: true });
  const T0 = await chainNow();
  const sched = { T0, gtdEnd: T0 + 30 * 60, p2End: T0 + 38 * 60, p3End: T0 + 46 * 60, pubEnd: T0 + 30 * 24 * 3600 };
  const names = ['gtd1', 'gtd2', 'p2a', 'p2b', 'f1', 'f2', 'f3', 'pub1', 'pub2'];
  // Reuse wallets from a prior (aborted) run when present — they're already funded.
  const wallets = state.wallets && names.every(n => state.wallets[n]) ? state.wallets : {};
  if (!Object.keys(wallets).length) {
    for (const n of names) { const pk = generatePrivateKey(); wallets[n] = { pk, addr: privateKeyToAccount(pk).address }; }
  }
  state.sched = sched; state.wallets = wallets;
  fs.writeFileSync(path.join(DIR, 'gtd-counts.json'), JSON.stringify([
    { wallet: wallets.gtd1.addr, count: 2 }, { wallet: wallets.gtd2.addr, count: 1 }]));
  fs.writeFileSync(path.join(DIR, 'stages.json'), JSON.stringify([
    { name: 'guaranteed-random', wallets: [{ wallet: wallets.p2a.addr, count: 1 }, { wallet: wallets.p2b.addr, count: 2 }], start: sched.gtdEnd, end: sched.p2End, cap: 1, stage: 2 },
    { name: 'fcfs', wallets: [wallets.f1.addr, wallets.f2.addr, wallets.f3.addr], start: sched.p2End, end: sched.p3End, cap: 8, stage: 3 },
  ], null, 2));
  const gas = await pub.getGasPrice();
  log(`schedule: GTD ends +30m, P2 ends +38m, P3 ends +46m; gas price ${formatEther(gas * 1000000n)} eth/Mgas`);
  save();
}

function tree() {
  const s = state.sched;
  const r = spawnSync('node', ['allowlist/merkle.mjs', '--counts', 'data/rehearsal/gtd-counts.json',
    '--start', String(s.T0), '--end', String(s.gtdEnd), '--price', '0.0001',
    '--fcfs-config', 'data/rehearsal/stages.json', '--gtd-rollover', 'guaranteed-random',
    '--out-dir', 'data/rehearsal'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`merkle.mjs failed:\n${r.stdout}\n${r.stderr}`);
  console.log(r.stdout.trim());
  state.root = fs.readFileSync(path.join(DIR, 'allowlist-root.txt'), 'utf8').trim();
  save();
}

async function fund() {
  const w = createWalletClient({ account: funder, transport: http(RPC) });
  for (const [n, info] of Object.entries(state.wallets)) {
    const bal = await pub.getBalance({ address: info.addr });
    if (bal > parseEther('0.005')) { log(`${n} already funded`); continue; }
    const hash = await w.sendTransaction({ to: info.addr, value: parseEther('0.012'), chain: null });
    await pub.waitForTransactionReceipt({ hash });
    log(`funded ${n} ${info.addr}`);
  }
}

function deploy() {
  const s = state.sched;
  const r = spawnSync(`${process.env.HOME}/.foundry/bin/forge`, ['script',
    'contracts/script/DeploySepoliaRehearsal.s.sol:DeploySepoliaRehearsal',
    '--rpc-url', RPC, '--private-key', FUNDER_PK, '--broadcast', '--slow', '-vv'],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env,
      BLOCKCASSONE_ALLOWLIST_ROOT: state.root,
      BLOCKCASSONE_GTD_END: String(s.gtdEnd),
      BLOCKCASSONE_PUBLIC_START: String(s.p3End),
      BLOCKCASSONE_PUBLIC_END: String(s.pubEnd),
      BLOCKCASSONE_MINT_PRICE: PRICE.toString(),
      BLOCKCASSONE_FEE_RECIPIENT: funder.address,
      BLOCKCASSONE_GTD1: state.wallets.gtd1.addr,
      BLOCKCASSONE_GTD2: state.wallets.gtd2.addr,
    }, timeout: 25 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(DIR, 'deploy-log.txt'), out);
  if (r.status !== 0) throw new Error(`forge script failed (see data/rehearsal/deploy-log.txt): ${out.slice(-800)}`);
  state.contracts = JSON.parse(fs.readFileSync(path.join(DIR, 'contracts.json'), 'utf8'));
  log(`deployed: CubeNFT ${state.contracts.cubeNft}, minter ${state.contracts.genesisMinter}`);
  save();
}

async function chunks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/token-renderer/renderer-chunks.json'), 'utf8'));
  const store = state.contracts.rendererAssetStore;
  const gas = await pub.getGasPrice();
  const estCost = gas * 4000000n * BigInt(manifest.chunkCount);
  if (estCost > parseEther('0.15')) {
    state.results.chunks = `SKIPPED (gas too high: est ${formatEther(estCost)} ETH) — animation_url will not render; SVG image unaffected`;
    log(state.results.chunks); save(); return;
  }
  const w = createWalletClient({ account: funder, transport: http(RPC) });
  // Script chunks live at ids scriptStartChunkId..; the HEAD slot (id 0) stays
  // EMPTY so CubeRendererV2 uses its baked-in default HTML head. chunkCount is
  // auto-tracked by the store (highest id + 1) — never force it lower.
  for (let i = 0; i < manifest.chunks.length; i++) {
    await send(w, { address: store, abi: STORE_ABI, functionName: 'setChunk', args: [BigInt(manifest.scriptStartChunkId + i), manifest.chunks[i]] });
    log(`chunk id ${manifest.scriptStartChunkId + i} (${i + 1}/${manifest.chunks.length}) uploaded`);
  }
  state.results.chunks = `uploaded ${manifest.chunks.length} script chunks at ids ${manifest.scriptStartChunkId}+`;
  save();
}

const proofs = () => JSON.parse(fs.readFileSync(path.join(DIR, 'allowlist-proofs.json'), 'utf8'));
const leafFor = (addr, stage) => {
  const e = proofs().find(p => p.wallet === addr.toLowerCase() && p.stage === stage);
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
  log(`${who} minted ${qty} via ${stage} leaf`);
}
async function mintPublic(who, qty) {
  const { pk } = state.wallets[who];
  await send(wallet(pk), { address: SEADROP, abi: SEADROP_ABI, functionName: 'mintPublic',
    args: [state.contracts.cubeNft, funder.address, '0x0000000000000000000000000000000000000000', BigInt(qty)],
    value: PRICE * BigInt(qty) });
  log(`${who} minted ${qty} via public`);
}

async function phaseGtd() {
  // Negative checks: later stages + public are NotActive; a fat quantity trips the leaf cap.
  await expectRevert('public-mint-during-gtd', () => mintPublic('pub1', 1));
  await expectRevert('fcfs-leaf-during-gtd', () => mintAllowList('f1', 'fcfs', 1));
  await expectRevert('gtd-overmint-beyond-cap', () => mintAllowList('gtd1', 'gtd', 3));
  // Happy path: gtd1 mints exactly their 2 chosen Normies (5555 + 1250).
  await mintAllowList('gtd1', 'gtd', 2);
  const rem = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'reservationRemaining', args: [state.wallets.gtd1.addr] });
  if (Number(rem) !== 0) throw new Error('gtd1 reservations not fully consumed');
  state.results.gtd = 'gtd1 minted chosen art (2); gtd2 is the planned no-show';
  save();
}

async function phaseP2() {
  await waitUntil(state.sched.gtdEnd + 15, 'GTD window close');
  // Permissionless strict release, sent by an unrelated wallet (pub2).
  await send(wallet(state.wallets.pub2.pk), { address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'releaseReservations', args: [[state.wallets.gtd2.addr]] });
  const rem = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'reservationRemaining', args: [state.wallets.gtd2.addr] });
  if (Number(rem) !== 0) throw new Error('gtd2 release failed');
  log('gtd2 no-show reservation released by pub2 (permissionless)');
  await mintAllowList('gtd1', 'guaranteed-random', 3); // rollover leaf cap 5 total: 2 GTD + 3 here
  await expectRevert('gtd1-beyond-rollover-cap', () => mintAllowList('gtd1', 'guaranteed-random', 1));
  await mintAllowList('gtd2', 'guaranteed-random', 5); // no-show: full 5, all random
  await mintAllowList('p2a', 'guaranteed-random', 1);
  await mintAllowList('p2b', 'guaranteed-random', 2);
  state.results.p2 = 'release permissionless OK; rollover caps enforced (5 total)';
  save();
}

async function phaseP3() {
  await waitUntil(state.sched.p2End + 15, 'P2 window close');
  await expectRevert('p2-leaf-after-window', () => mintAllowList('p2a', 'guaranteed-random', 1));
  for (const f of ['f1', 'f2', 'f3']) await mintAllowList(f, 'fcfs', 8);
  state.results.p3 = 'fcfs 3x8 minted';
  save();
}

async function phasePublic() {
  await waitUntil(state.sched.p3End + 15, 'public open');
  await mintPublic('pub1', 8);
  await mintPublic('pub2', 1); // 46/47 — leave ONE slot vacant for the move test
  await expectRevert('overmint-past-remaining-supply', () => mintPublic('pub2', 2));
  const minted = await pub.readContract({ address: state.contracts.genesisMinter, abi: MINTER_ABI, functionName: 'mintedCount' });
  log(`public done: ${minted}/47 minted (1 slot intentionally vacant)`);
  state.results.public = `minted ${minted}/47`;
  save();
}

async function tokenMap() {
  const cube = state.contracts.cubeNft;
  const next = Number(await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'nextCubeId' }));
  const label = {}; for (const [n, i] of Object.entries(state.wallets)) label[getAddress(i.addr)] = n;
  label[getAddress(funder.address)] = 'funder';
  const srcName = {}; srcName[getAddress(state.contracts.normies)] = 'Normie';
  const ccNames = ['Chain Runners', '1337 skulls', 'Baby Pepes', 'Nouns', 'OnChainKevin'];
  for (let i = 1; i <= 5; i++) srcName[getAddress(state.contracts[`cc0_${i}`])] = ccNames[i - 1];
  const rows = [];
  for (let id = 1; id < next; id++) {
    let owner = null;
    try { owner = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'ownerOf', args: [BigInt(id)] }); } catch { /* burned */ }
    const d = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'cubeDataUnchecked', args: [BigInt(id)] });
    rows.push({ id, owner: owner ? (label[getAddress(owner)] || owner) : 'BURNED(merged)', slot: d.slot, street: Math.floor(d.slot / 8),
      source: srcName[getAddress(d.sourceContract)] || d.sourceContract, sourceTokenId: Number(d.sourceTokenId), sourceKind: d.sourceKind });
  }
  return rows;
}

async function moveAndMerge() {
  const cube = state.contracts.cubeNft;
  const rows = await tokenMap();
  // The one vacant slot (never allocated).
  let vacant = -1;
  for (let s = 0; s < 47; s++) {
    const c = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'cubeForSlot', args: [s] });
    if (Number(c) === 0) { vacant = s; break; }
  }
  if (vacant < 0) throw new Error('no vacant slot found');
  // f2 owns 3 plots on street 0 (backfilled after wrap); move one to the vacant slot,
  // transfer the other two to gtd1, then gtd1 (now sole owner of street 0) merges.
  const f2Street0 = rows.filter(r => r.owner === 'f2' && r.street === 0);
  if (f2Street0.length === 0) throw new Error('expected f2 plots on street 0 — check allocation assumptions');
  const mover = f2Street0[0];
  await send(wallet(state.wallets.f2.pk), { address: cube, abi: CUBE_ABI, functionName: 'moveCube', args: [BigInt(mover.id), vacant], value: parseEther('0.002') });
  log(`moved cube #${mover.id} from slot ${mover.slot} to vacant slot ${vacant} (move mechanics + fee)`);
  for (const r of f2Street0.slice(1)) {
    await send(wallet(state.wallets.f2.pk), { address: cube, abi: CUBE_ABI, functionName: 'transferFrom', args: [state.wallets.f2.addr, state.wallets.gtd1.addr, BigInt(r.id)] });
    log(`consolidation: cube #${r.id} transferred f2 -> gtd1`);
  }
  const hash = await wallet(state.wallets.gtd1.pk).writeContract({ address: cube, abi: CUBE_ABI, functionName: 'mergeStreet', args: [0], value: parseEther('0.005'), chain: null });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error('merge reverted');
  // The street token is the newest cube id.
  const next = Number(await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'nextCubeId' }));
  const streetToken = next - 1;
  const [street, occ] = await pub.readContract({ address: cube, abi: CUBE_ABI, functionName: 'streetPlots', args: [BigInt(streetToken)] });
  log(`MERGED street ${street} -> street token #${streetToken} (${occ} plots)`);
  state.results.merge = { streetToken, street: Number(street), occupied: Number(occ), movedCube: mover.id, vacatedSlot: mover.slot, movedToSlot: vacant };
  save();
}

async function report() {
  const rows = await tokenMap();
  const c = state.contracts;
  const uriCheck = {};
  const streetTokenId = state.results.merge ? state.results.merge.streetToken : -1;
  const ccNamesSet = new Set(['Chain Runners', '1337 skulls', 'Baby Pepes', 'Nouns', 'OnChainKevin']);
  for (const probe of [
    rows.find(r => r.source === 'Normie' && r.owner !== 'BURNED(merged)'),
    rows.find(r => ccNamesSet.has(r.source) && r.owner !== 'BURNED(merged)' && r.id !== streetTokenId),
    state.results.merge && rows.find(r => r.id === streetTokenId),
  ]) {
    if (!probe) continue;
    try {
      const uri = await pub.readContract({ address: c.cubeNft, abi: CUBE_ABI, functionName: 'tokenURI', args: [BigInt(probe.id)] });
      uriCheck[probe.id] = `OK (${uri.length} chars)`;
    } catch (e) { uriCheck[probe.id] = `FAILED via RPC (${(e.shortMessage || '').slice(0, 80)}) — check in OnChainChecker`; }
  }
  const lines = [];
  lines.push('# Sepolia Dress Rehearsal — Report', '');
  lines.push(`- CubeNFT: \`${c.cubeNft}\``, `- Minter: \`${c.genesisMinter}\``, `- Renderer: \`${c.renderer}\``, `- SeaDrop (real): \`${c.seaDrop}\``, '');
  lines.push('## Phase results', '');
  for (const [k, v] of Object.entries(state.results)) lines.push(`- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  lines.push('', '## tokenURI spot checks', '');
  for (const [id, r] of Object.entries(uriCheck)) lines.push(`- cube #${id}: ${r}`);
  lines.push('', '## Token map', '', '| cube | owner | slot | street | source | sourceTokenId |', '|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.id} | ${r.owner} | ${r.slot} | ${r.street} | ${r.source} | ${r.sourceTokenId} |`);
  lines.push('', '## Inspect', '', `OnChainChecker: collection \`${c.cubeNft}\` on Sepolia (chain 11155111).`);
  if (state.results.merge) lines.push(`Merged street token: **#${state.results.merge.streetToken}** (burned plots render inside it).`);
  fs.writeFileSync(path.join(DIR, 'REPORT.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify({ contracts: c, results: state.results, tokens: rows }, null, 2));
  log(`report written: data/rehearsal/REPORT.md`);
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
  await step('moveMerge', moveAndMerge);
  await step('report', report);
  log('REHEARSAL COMPLETE — see data/rehearsal/REPORT.md');
}

main().catch(e => { console.error(e); process.exit(1); });
