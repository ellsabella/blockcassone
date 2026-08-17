// Post-RegisterSnapshotAndReservations verification: every plan wallet's on-chain
// reservationCount matches its plan row; per-collection reserved counts; pool math.
import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';
const plan = JSON.parse(fs.readFileSync('data/mainnet/reserve-plan.json', 'utf8')).plan || [];
const { MultiSourceGenesisMinter: MINTER } = JSON.parse(fs.readFileSync('data/mainnet/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(process.env.ETH_RPC_URL) });
const ABI = [
  { type: 'function', name: 'reservationCount', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reservedCount', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'poolRemaining', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'publicRemaining', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalPublicRemaining', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reservationAt', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint8' }, { type: 'uint256' }] },
];
const r = (fn, args = []) => pub.readContract({ address: MINTER, abi: ABI, functionName: fn, args });

let fail = 0;
let totalReserved = 0;
for (const p of plan) {
  const want = (p.sourceIds || []).length;
  const got = Number(await r('reservationCount', [getAddress(p.wallet)]));
  totalReserved += got;
  if (got !== want) { fail++; console.log(`FAIL ${p.wallet}: ${got} != ${want}`); }
}
console.log(`wallets checked: ${plan.length}, total reserved sources on-chain: ${totalReserved} (want 81), mismatches: ${fail}`);

const wantReserved = { 0: 37, 1: 8, 2: 22, 3: 12, 4: 0, 5: 2 };
for (let c = 0; c <= 5; c++) {
  const got = Number(await r('reservedCount', [c]));
  const ok = got === wantReserved[c];
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FAIL'} reservedCount[${c}] = ${got} (want ${wantReserved[c]})`);
}
console.log(`normie candidate pool remaining: ${await r('publicRemaining')} (want 1670 = 1707 - 37 reserved)`);
console.log(`totalPublicRemaining: ${await r('totalPublicRemaining')}`);

// Spot-check the first wallet's first reservation matches the plan exactly.
const p0 = plan[0];
const [c0, s0] = await r('reservationAt', [getAddress(p0.wallet), 0n]);
console.log(`spot: ${p0.wallet} reservation[0] = collection ${c0}, source #${s0} (plan: ${p0.collectionIds[0]}, #${p0.sourceIds[0]})`);
console.log(fail ? `\n${fail} FAILURES — STOP` : '\nALL RESERVATION CHECKS PASS — ready for handoff');
