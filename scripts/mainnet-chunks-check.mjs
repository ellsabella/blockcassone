// Verify the mainnet RendererAssetStore matches the local manifest exactly.
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
const manifest = JSON.parse(fs.readFileSync('dist/token-renderer/renderer-chunks.json', 'utf8'));
const { RendererAssetStore } = JSON.parse(fs.readFileSync('data/mainnet/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(process.env.ETH_RPC_URL) });
const ABI = [
  { type: 'function', name: 'chunk', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'chunkCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];
const count = Number(await pub.readContract({ address: RendererAssetStore, abi: ABI, functionName: 'chunkCount' }));
const head = await pub.readContract({ address: RendererAssetStore, abi: ABI, functionName: 'chunk', args: [0n] });
let mismatch = 0;
for (let i = 0; i < manifest.chunks.length; i++) {
  const onchain = await pub.readContract({ address: RendererAssetStore, abi: ABI, functionName: 'chunk', args: [BigInt(manifest.scriptStartChunkId + i)] });
  if (onchain !== manifest.chunks[i]) { mismatch++; console.log(`MISMATCH chunk ${manifest.scriptStartChunkId + i}`); }
}
console.log(`chunkCount=${count} (want ${manifest.scriptStartChunkId + manifest.chunks.length}), head len=${head.length} (want 0), byte-mismatches=${mismatch}`);
console.log(count === manifest.scriptStartChunkId + manifest.chunks.length && head.length === 0 && mismatch === 0 ? 'CHUNKS VERIFIED — proceed to pools' : 'STOP — fix before pools');
