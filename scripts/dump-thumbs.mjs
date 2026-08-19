// Dump live on-chain thumbnails as clean SVG files (viem returns the raw string —
// no cast-style quote escaping).
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
const RPC = process.env.BLOCKCASSONE_RPC_URL;
const contracts = JSON.parse(fs.readFileSync('data/sepolia-full/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(RPC) });
const ABI = [
  { type: 'function', name: 'renderer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'thumbnailSVG', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
];
const renderer = await pub.readContract({ address: contracts.cubeNft, abi: ABI, functionName: 'renderer' });
fs.mkdirSync('data/sepolia-full/thumbs', { recursive: true });
for (const id of [11, 15, 16, 17, 19, 29]) {
  const svg = await pub.readContract({ address: renderer, abi: ABI, functionName: 'thumbnailSVG', args: [BigInt(id)] });
  fs.writeFileSync(`data/sepolia-full/thumbs/cube-${id}.svg`, svg);
  console.log(`cube ${id}: ${svg.length} chars, starts ${JSON.stringify(svg.slice(0, 40))}`);
}
