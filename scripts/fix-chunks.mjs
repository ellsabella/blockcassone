// Repair the rehearsal RendererAssetStore chunk layout: script chunks belong at
// ids scriptStartChunkId..(start+N-1) with the HEAD slot (id 0) EMPTY so
// CubeRendererV2 falls back to its baked-in default HTML head. chunkCount is
// auto-tracked as highest-id+1 by the store — do NOT force it lower.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.BLOCKCASSONE_RPC_URL;
const PK = process.env.DEV_THROWAWAY_PRIVATE;
const manifest = JSON.parse(fs.readFileSync('dist/token-renderer/renderer-chunks.json', 'utf8'));
const { rendererAssetStore } = JSON.parse(fs.readFileSync('data/rehearsal/contracts.json', 'utf8'));

const ABI = [
  { type: 'function', name: 'setChunk', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] },
  { type: 'function', name: 'chunkCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'chunk', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
];
const pub = createPublicClient({ transport: http(RPC) });
const w = createWalletClient({ account: privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`), transport: http(RPC) });

const send = async (fn, args) => {
  const hash = await w.writeContract({ address: rendererAssetStore, abi: ABI, functionName: fn, args, chain: null });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${fn} reverted`);
};

const start = manifest.scriptStartChunkId; // 1
for (let i = 0; i < manifest.chunks.length; i++) {
  await send('setChunk', [BigInt(start + i), manifest.chunks[i]]);
  console.log(`chunk id ${start + i} <- script chunk ${i} (${manifest.chunks[i].length} chars)`);
}
await send('setChunk', [0n, '']); // clear the head slot -> default on-chain head
console.log('chunk id 0 cleared (default HTML head fallback)');

const count = await pub.readContract({ address: rendererAssetStore, abi: ABI, functionName: 'chunkCount' });
const head = await pub.readContract({ address: rendererAssetStore, abi: ABI, functionName: 'chunk', args: [0n] });
const last = await pub.readContract({ address: rendererAssetStore, abi: ABI, functionName: 'chunk', args: [BigInt(start + manifest.chunks.length - 1)] });
console.log(`final chunkCount=${count} (want ${start + manifest.chunks.length}), head len=${head.length} (want 0), last chunk len=${last.length}`);
