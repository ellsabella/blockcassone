// Post-CommitPools verification: every STORED collection's pool must be exactly its
// cap and 100% art-backed (firstUncommittedPoolToken == (false,0)), and a sample
// payload must match the local file byte-for-byte.
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
const { MultiSourceGenesisMinter: MINTER, NonNormieArtStore: STORE } = JSON.parse(fs.readFileSync('data/mainnet/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(process.env.ETH_RPC_URL) });
const ABI = [
  { type: 'function', name: 'collectionAt', stateMutability: 'view', inputs: [{ type: 'uint8' }],
    outputs: [{ type: 'uint8' }, { type: 'address' }, { type: 'uint32' }, { type: 'uint32' }] },
  { type: 'function', name: 'poolRemaining', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'firstUncommittedPoolToken', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'bool' }, { type: 'uint256' }] },
  { type: 'function', name: 'totalPublicRemaining', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'sourcePayload', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bytes' }] },
];
const keys = ['runner', 'skull', 'pepe', 'noun', 'kevin'];
let fail = 0;
for (let c = 1; c <= 5; c++) {
  const key = keys[c - 1];
  const pool = JSON.parse(fs.readFileSync(`data/cc0/pool-${key}.json`, 'utf8')).tokenIds;
  const [, contractAddr, cap] = await pub.readContract({ address: MINTER, abi: ABI, functionName: 'collectionAt', args: [c] });
  const remaining = Number(await pub.readContract({ address: MINTER, abi: ABI, functionName: 'poolRemaining', args: [c] }));
  const [found, tok] = await pub.readContract({ address: MINTER, abi: ABI, functionName: 'firstUncommittedPoolToken', args: [c] });
  const sampleId = pool[Math.floor(pool.length / 2)];
  let sampleOk = false;
  try {
    const onchain = await pub.readContract({ address: STORE, abi: ABI, functionName: 'sourcePayload', args: [contractAddr, BigInt(sampleId)] });
    const local = fs.readFileSync(`data/cc0-full/${key}/${sampleId}.hex`, 'utf8').trim();
    sampleOk = onchain === local;
  } catch (e) { sampleOk = `read failed: ${(e.shortMessage || '').slice(0, 50)}`; }
  const ok = remaining === Number(cap) && remaining === pool.length && !found && sampleOk === true;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${key}: pool ${remaining}/${cap} uncommitted=${found ? tok : 'none'} sampleByteMatch(${sampleId})=${sampleOk}`);
}
const total = await pub.readContract({ address: MINTER, abi: ABI, functionName: 'totalPublicRemaining' });
console.log(`totalPublicRemaining: ${total} (want 2417 — Normie snapshot not yet registered, by design)`);
console.log(fail ? 'CHECKS FAILED — STOP' : 'ALL POOLS VERIFIED — Sunday scope complete, STOP line reached');
