// Upload the WebGL renderer chunks to the Sepolia RendererAssetStore, signing with the
// throwaway deployer (which owns the store). The stock upload-renderer-chunks.mjs uses
// eth_sendTransaction (unlocked account, local Anvil only); this signs raw txs via viem so
// it works against a public RPC. Reads DEV_THROWAWAY_PRIVATE + BLOCKCASSONE_RPC_URL from env.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, createPublicClient, http, encodeFunctionData, formatEther } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(repoRoot, 'data', 'chain-config.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'dist', 'token-renderer', 'renderer-chunks.json'), 'utf8'));

const rpc = process.env.BLOCKCASSONE_RPC_URL;
const pk = process.env.DEV_THROWAWAY_PRIVATE;
if (!rpc || !pk) throw new Error('Need BLOCKCASSONE_RPC_URL + DEV_THROWAWAY_PRIVATE in env');
const store = config.rendererAssetStore;
if (!/^0x[0-9a-fA-F]{40}$/.test(store || '')) throw new Error('chain-config.json missing rendererAssetStore');

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });

const abi = [
  { name: 'setChunk', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] },
  { name: 'setChunkCount', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { name: 'chunkCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

console.log(`deployer ${account.address} balance ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
console.log(`uploading ${manifest.chunks.length} chunks to ${store}`);

for (let i = 0; i < manifest.chunks.length; i++) {
  const chunkId = manifest.scriptStartChunkId + i;
  const data = encodeFunctionData({ abi, functionName: 'setChunk', args: [BigInt(chunkId), manifest.chunks[i]] });
  const hash = await wallet.sendTransaction({ to: store, data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`chunk ${chunkId}: ${Buffer.byteLength(manifest.chunks[i])} bytes  gas ${rc.gasUsed}  ${rc.status}`);
}

const cur = Number(await pub.readContract({ address: store, abi, functionName: 'chunkCount' }));
if (cur !== manifest.chunkCount) {
  const data = encodeFunctionData({ abi, functionName: 'setChunkCount', args: [BigInt(manifest.chunkCount)] });
  const hash = await wallet.sendTransaction({ to: store, data });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`chunkCount -> ${manifest.chunkCount}: ${hash}`);
} else {
  console.log(`chunkCount already ${cur}`);
}
console.log('done.');
