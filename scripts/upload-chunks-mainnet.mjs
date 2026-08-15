// Mainnet renderer-chunk upload, signed with a private key (the dev uploader uses
// unlocked eth_sendTransaction — local/Anvil only). Layout: script chunks at ids
// scriptStartChunkId..N (chunk 0 = head slot stays EMPTY on a fresh store so the
// baked on-chain default head is used); chunkCount auto-tracks.
//   BLOCKCASSONE_STORE=0x… DEPLOYER_PK=env-name node scripts/upload-chunks-mainnet.mjs
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.ETH_RPC_URL;
const STORE = process.env.BLOCKCASSONE_STORE;
const PK = process.env.MAINNET_DEPLOYER_PRIVATE;
if (!RPC || !STORE || !PK) { console.error('Need ETH_RPC_URL, BLOCKCASSONE_STORE, MAINNET_DEPLOYER_PRIVATE.'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync('dist/token-renderer/renderer-chunks.json', 'utf8'));
const pub = createPublicClient({ transport: http(RPC) });
const w = createWalletClient({ account: privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`), transport: http(RPC) });
const ABI = [
  { type: 'function', name: 'setChunk', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] },
  { type: 'function', name: 'chunk', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'chunkCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

for (let i = 0; i < manifest.chunks.length; i++) {
  const id = BigInt(manifest.scriptStartChunkId + i);
  const existing = await pub.readContract({ address: STORE, abi: ABI, functionName: 'chunk', args: [id] });
  if (existing === manifest.chunks[i]) { console.log(`chunk ${id}: already correct, skip`); continue; }
  const hash = await w.writeContract({ address: STORE, abi: ABI, functionName: 'setChunk', args: [id, manifest.chunks[i]], chain: null });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`chunk ${id} reverted`);
  console.log(`chunk ${id}: uploaded (${manifest.chunks[i].length} chars)`);
}
const head = await pub.readContract({ address: STORE, abi: ABI, functionName: 'chunk', args: [0n] });
const count = await pub.readContract({ address: STORE, abi: ABI, functionName: 'chunkCount' });
console.log(`done: chunkCount=${count} (want ${manifest.scriptStartChunkId + manifest.chunks.length}), head len=${head.length} (want 0)`);
