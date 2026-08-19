#!/usr/bin/env node
// Post-GTD reservation release keeper. Once the on-chain GTD window (`gtdEndTime`)
// passes, `releaseReservations` is PERMISSIONLESS — so this can run with any funded
// key, no owner interaction during a fast-moving mint. It returns every no-show's
// unminted reservations to the draw pool; without that, near sellout the public tail
// reverts `IncompletePublicFill` (nobody loses funds, but the last mints are blocked).
//
// Reads the GTD wallet list from reserve-plan.json (the same file that fed
// reserveSources + merkle.mjs), keeps only wallets with unminted reservations, waits
// for the window to close, then releases in batches. Idempotent — safe to re-run.
//
//   node release-keeper.mjs --minter 0x… --rpc <url> [--in reserve-plan.json] [--batch 100]
//   node release-keeper.mjs … --execute        # sends txs (KEEPER_PRIVATE_KEY or OWNER_PRIVATE_KEY)
//                                              # default is a dry run: prints what it would release
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = n => args.includes(`--${n}`);

const ABI = [
  { type: 'function', name: 'gtdEndTime', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'reservationRemaining', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'releaseReservations', stateMutability: 'nonpayable', inputs: [{ type: 'address[]' }], outputs: [] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const minter = flag('minter'), rpc = flag('rpc');
  if (!minter || !rpc) { console.error('Missing --minter / --rpc.'); process.exit(1); }
  const batchSize = Number(flag('batch') || 100);
  const pollSecs = Number(flag('poll') || 30);

  const plan = JSON.parse(fs.readFileSync(flag('in') || 'reserve-plan.json', 'utf8'));
  const rows = Array.isArray(plan) ? plan : plan.plan;
  const wallets = [...new Set(rows.map(p => p.wallet.toLowerCase()))];
  console.log(`${wallets.length} GTD wallets in the plan.`);

  const client = createPublicClient({ transport: http(rpc) });
  const read = (functionName, argsArr = []) =>
    client.readContract({ address: minter, abi: ABI, functionName, args: argsArr });

  const gtdEnd = Number(await read('gtdEndTime'));
  if (gtdEnd === 0) {
    console.error('gtdEndTime is 0 (no window configured): releaseReservations is owner-only on-chain. Aborting.');
    process.exit(1);
  }

  // Wait on CHAIN time (block timestamps), not wall-clock — that's what the contract checks.
  for (;;) {
    const now = Number((await client.getBlock()).timestamp);
    if (now > gtdEnd) break;
    console.log(`GTD window open (chain time ${now} <= gtdEndTime ${gtdEnd}) — waiting ${pollSecs}s…`);
    await sleep(pollSecs * 1000);
  }
  console.log(`GTD window closed (gtdEndTime ${gtdEnd}).`);

  const pending = [];
  for (const w of wallets) {
    const rem = Number(await read('reservationRemaining', [w]));
    if (rem > 0) pending.push({ wallet: w, remaining: rem });
  }
  const totalRes = pending.reduce((a, p) => a + p.remaining, 0);
  console.log(`${pending.length} wallets hold ${totalRes} unminted reservations.`);
  if (!pending.length) { console.log('Nothing to release.'); return; }

  if (!has('execute')) {
    pending.forEach(p => console.log(`  would release ${p.remaining} from ${p.wallet}`));
    console.log('Dry run only — re-run with --execute to send.');
    return;
  }

  const pk = process.env.KEEPER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY;
  if (!pk) { console.error('Set KEEPER_PRIVATE_KEY (any funded key — the call is permissionless).'); process.exit(1); }
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, transport: http(rpc) });

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize).map(p => p.wallet);
    const hash = await wallet.writeContract({
      address: minter, abi: ABI, functionName: 'releaseReservations', args: [batch], chain: null,
    });
    const rcpt = await client.waitForTransactionReceipt({ hash });
    console.log(`released batch ${i / batchSize + 1} (${batch.length} wallets) — ${rcpt.status} ${hash}`);
    if (rcpt.status !== 'success') process.exit(1);
  }
  console.log('All unminted reservations released back to the draw pool.');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
