#!/usr/bin/env node
// Bridge: approved allowlist submissions → on-chain reserveSources() calls.
//
// The contract's reserveSources() TRUSTS the owner (no ownership check on-chain), so
// this tool re-verifies, live on mainnet, that each requested source is still owned by
// the wallet (directly or via a current delegate.xyz delegation) BEFORE it's reserved.
// A source sold since registration, or a forged claim, is dropped with a reason.
//
//   node reserve.mjs --minter 0xMINTER [--in final.json] [--rpc URL]     # DRY RUN (default): verify + write reserve-plan.json
//   node reserve.mjs --minter 0xMINTER --execute                          # send the txs (needs OWNER_PRIVATE_KEY)
//
// Dry run makes NO transactions. It writes a per-wallet plan incl. ready-to-send calldata
// (submit via your Safe / `cast send` / hardware wallet) and a rejects report. Idempotent:
// wallets that already have reservations on-chain are skipped.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeFunctionData, getAddress, recoverTypedDataAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from './src/config.js';
import { localStore } from './api.mjs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = n => args.includes(`--${n}`);

const RPC = flag('rpc') || process.env.ETH_RPC_URL;
const MINTER = flag('minter') || process.env.MINTER_ADDRESS;
const IN = flag('in');
const OUT = flag('out') || 'reserve-plan.json';
const EXECUTE = has('execute');
const ZERO_RIGHTS = `0x${'00'.repeat(32)}`;

if (!RPC) { console.error('Missing --rpc or ETH_RPC_URL'); process.exit(1); }
if (!MINTER) { console.error('Missing --minter or MINTER_ADDRESS'); process.exit(1); }

const MINTER_ABI = [
  { type: 'function', name: 'reserveSources', stateMutability: 'nonpayable', inputs: [{ name: 'wallet', type: 'address' }, { name: 'collectionIds', type: 'uint8[]' }, { name: 'sourceIds', type: 'uint256[]' }], outputs: [] },
  { type: 'function', name: 'reservationCount', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'finalized', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
];
const ERC721_ABI = [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }];
const DELEGATE_ABI = [{ type: 'function', name: 'checkDelegateForERC721', stateMutability: 'view', inputs: [{ name: 'to', type: 'address' }, { name: 'from', type: 'address' }, { name: 'contract_', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'rights', type: 'bytes32' }], outputs: [{ type: 'bool' }] }];

const pub = createPublicClient({ chain: mainnet, transport: http(RPC) });
const nameOf = cid => CONFIG.collections[cid]?.name || `#${cid}`;
const keyOf = s => `${s.collectionId}:${s.tokenId}`;

async function ownsSource(wallet, contractAddr, tokenId) {
  let owner;
  try { owner = await pub.readContract({ address: getAddress(contractAddr), abi: ERC721_ABI, functionName: 'ownerOf', args: [BigInt(tokenId)] }); }
  catch (e) { return { ok: false, reason: `ownerOf reverted (${e.shortMessage || e.message})` }; }
  if (getAddress(owner) === getAddress(wallet)) return { ok: true, via: 'wallet' };
  try {
    const del = await pub.readContract({ address: getAddress(CONFIG.delegateRegistryV2), abi: DELEGATE_ABI, functionName: 'checkDelegateForERC721', args: [getAddress(wallet), getAddress(owner), getAddress(contractAddr), BigInt(tokenId), ZERO_RIGHTS] });
    if (del) return { ok: true, via: `delegated (vault ${owner})` };
  } catch { /* registry read failed → treat as not delegated */ }
  return { ok: false, reason: `held by ${owner}, no live delegation to ${wallet}` };
}

async function verifySig(r) {
  try {
    const signer = await recoverTypedDataAddress({
      domain: CONFIG.eip712Domain, types: CONFIG.eip712Types, primaryType: 'Attestation',
      message: {
        wallet: r.wallet, vaults: r.vaults || [],
        sources: (r.sources || []).map(s => ({ collectionId: Number(s.collectionId), tokenId: BigInt(s.tokenId), contractAddr: s.contractAddr })),
        issuedAt: BigInt(r.issuedAt), nonce: r.nonce,
      },
      signature: r.signature,
    });
    return getAddress(signer) === getAddress(r.wallet);
  } catch { return false; }
}

async function readReservationCount(wallet) {
  try { return Number(await pub.readContract({ address: getAddress(MINTER), abi: MINTER_ABI, functionName: 'reservationCount', args: [getAddress(wallet)] })); }
  catch { return null; } // minter unreadable (e.g. dry-run against a not-yet-deployed address)
}

async function main() {
  const subs = IN ? JSON.parse(fs.readFileSync(IN, 'utf8')) : localStore(process.env).rows();
  console.log(`Loaded ${subs.length} submission(s). Minter ${MINTER}. ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}.\n`);

  let finalized = null;
  try { finalized = await pub.readContract({ address: getAddress(MINTER), abi: MINTER_ABI, functionName: 'finalized', args: [] }); } catch { }
  if (finalized === true) { console.error('Minter is FINALIZED — reserveSources will revert. Aborting.'); process.exit(1); }
  if (finalized === null) console.warn('⚠  Could not read minter state (finalized/reservationCount) — proceeding without idempotency checks.\n');

  const plan = [];
  const rejects = [];
  const totals = {};

  for (const r of subs) {
    const wallet = getAddress(r.wallet);
    const sigOk = r.signature ? await verifySig(r) : false;

    const already = await readReservationCount(wallet);
    if (already && already > 0) { rejects.push({ wallet, reason: `already reserved on-chain (${already})` }); continue; }

    // dedupe + cap + collection/contract integrity + ownership
    const seen = new Set();
    const verified = [];
    for (const s of r.sources || []) {
      if (verified.length >= CONFIG.gtdCapPerWallet) { rejects.push({ wallet, source: keyOf(s), reason: `over cap (${CONFIG.gtdCapPerWallet})` }); continue; }
      if (seen.has(keyOf(s))) continue;
      seen.add(keyOf(s));
      const expected = CONFIG.collections[s.collectionId]?.address;
      if (!expected || getAddress(expected) !== getAddress(s.contractAddr)) { rejects.push({ wallet, source: keyOf(s), reason: 'collectionId/contract mismatch' }); continue; }
      const own = await ownsSource(wallet, s.contractAddr, s.tokenId);
      if (!own.ok) { rejects.push({ wallet, source: `${nameOf(s.collectionId)} #${s.tokenId}`, reason: own.reason, sigOk }); continue; }
      verified.push({ collectionId: Number(s.collectionId), tokenId: String(s.tokenId), via: own.via });
    }
    if (!verified.length) continue;

    const collectionIds = verified.map(v => v.collectionId);
    const sourceIds = verified.map(v => BigInt(v.tokenId));
    const calldata = encodeFunctionData({ abi: MINTER_ABI, functionName: 'reserveSources', args: [wallet, collectionIds, sourceIds] });
    for (const v of verified) totals[nameOf(v.collectionId)] = (totals[nameOf(v.collectionId)] || 0) + 1;
    plan.push({ wallet, sigOk, artworks: verified.map(v => `${nameOf(v.collectionId)} #${v.tokenId} (${v.via})`), collectionIds, sourceIds: verified.map(v => v.tokenId), calldata });
  }

  // ---- report ----
  console.log(`Plan: reserve for ${plan.length} wallet(s), ${Object.values(totals).reduce((a, b) => a + b, 0)} artwork(s).`);
  for (const [k, n] of Object.entries(totals)) console.log(`   ${k}: ${n}`);
  const badSig = plan.filter(p => !p.sigOk);
  if (badSig.length) console.log(`\n⚠  ${badSig.length} wallet(s) verified by ownership but with an invalid/missing signature (listed in plan; ownership is the gate).`);
  if (rejects.length) {
    console.log(`\nRejected ${rejects.length}:`);
    for (const x of rejects) console.log(`   ${x.wallet}${x.source ? ' · ' + x.source : ''} — ${x.reason}`);
  }

  if (!EXECUTE) {
    fs.writeFileSync(OUT, JSON.stringify({ minter: MINTER, generatedAt: new Date().toISOString(), plan, rejects, totals }, null, 2));
    console.log(`\nDry run. Wrote ${OUT}. Execute with --execute (OWNER_PRIVATE_KEY), or submit each plan[].calldata to ${MINTER} via your Safe / cast send.`);
    return;
  }

  // ---- execute ----
  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) { console.error('\n--execute needs OWNER_PRIVATE_KEY in env.'); process.exit(1); }
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(RPC) });
  console.log(`\nExecuting as ${account.address} …`);
  for (const p of plan) {
    try {
      const hash = await wallet.writeContract({ address: getAddress(MINTER), abi: MINTER_ABI, functionName: 'reserveSources', args: [getAddress(p.wallet), p.collectionIds, p.sourceIds.map(BigInt)] });
      const rc = await pub.waitForTransactionReceipt({ hash });
      console.log(`   ${p.wallet} → ${p.artworks.length} reserved  ${hash} [${rc.status}]`);
    } catch (e) {
      console.log(`   ${p.wallet} FAILED — ${e.shortMessage || e.message} (e.g. SourceNotInPool = art not in the genesis pool, or MissingSourcePayload)`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
