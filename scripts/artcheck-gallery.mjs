// Pull every art-check token's live on-chain thumbnail into one local gallery page.
import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';

const RPC = process.env.BLOCKCASSONE_RPC_URL;
const c = JSON.parse(fs.readFileSync('data/sepolia-artcheck/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(RPC) });
const ABI = [
  { type: 'function', name: 'nextCubeId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'cubeDataUnchecked', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'slot', type: 'uint32' }, { name: 'sourceKind', type: 'uint8' }, { name: 'rendererVersion', type: 'uint8' },
      { name: 'payloadVersion', type: 'uint8' }, { name: 'agentic', type: 'bool' }, { name: 'agentId', type: 'uint256' },
      { name: 'mintedAt', type: 'uint64' }, { name: 'sourceChainId', type: 'uint256' }, { name: 'sourceContract', type: 'address' },
      { name: 'sourceTokenId', type: 'uint256' }, { name: 'seed', type: 'bytes32' } ] }] },
  { type: 'function', name: 'thumbnailSVG', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
];
const srcName = {};
srcName[getAddress(c.normies)] = 'Normie';
const cc = ['Chain Runners', '1337 skulls', 'Baby Pepes', 'Nouns', 'OnChainKevin'];
for (let i = 1; i <= 5; i++) srcName[getAddress(c[`cc0_${i}`])] = cc[i - 1];

// The art-check world seeds MOCK collections from the July sample files: mock id
// (1000+i etc.) carries the art of the July sample set's REAL token — the mock id
// itself means nothing on OpenSea. Map back so labels name the real source.
const JULY = {
  'Chain Runners': { start: 1000, ids: [1, 55, 200, 777, 1500, 3000, 5000, 9000] },
  '1337 skulls': { start: 2000, ids: [1, 337, 500, 1000, 1337, 3000, 5000, 7000] },
  'Baby Pepes': { start: 3000, ids: [1, 7, 33, 111] },
  'Nouns': { start: 4000, ids: [1, 42, 100, 250] },
  'OnChainKevin': { start: 5000, ids: [1, 42, 100, 500] },
};
const realId = (name, mockId) => {
  const m = JULY[name];
  if (!m) return null;
  const idx = Number(mockId) - m.start;
  return m.ids[idx] ?? null;
};

const next = Number(await pub.readContract({ address: c.cubeNft, abi: ABI, functionName: 'nextCubeId' }));
let html = `<meta charset=utf-8><title>TheBLOCK art check</title>
<body style="background:#0a0a0a;color:#eee;font-family:monospace">
<h2>TheBLOCK — Sepolia art check (audit-fixed contracts)</h2>
<p>CubeNFT ${c.cubeNft} · compare CC0 pieces against their originals on OpenSea</p>
<div style="display:flex;flex-wrap:wrap;gap:14px">`;
for (let id = 1; id < next; id++) {
  let burned = false;
  try { await pub.readContract({ address: c.cubeNft, abi: ABI, functionName: 'ownerOf', args: [BigInt(id)] }); }
  catch { burned = true; }
  const d = await pub.readContract({ address: c.cubeNft, abi: ABI, functionName: 'cubeDataUnchecked', args: [BigInt(id)] });
  const src = srcName[getAddress(d.sourceContract)] || '?';
  if (burned) {
    // Burned street plots have no thumbnail of their own — they render inside the
    // street token's animation view.
    const rb = realId(src, d.sourceTokenId);
    html += `<div style="width:270px;display:flex;align-items:center;justify-content:center;height:260px;border:1px dashed #444">
    <div>🔥 cube #${id} — ${src}${rb ? ` — REAL #${rb}` : ` #${d.sourceTokenId}`}<br>burned into street token</div></div>`;
    continue;
  }
  const svg = await pub.readContract({ address: c.renderer, abi: ABI, functionName: 'thumbnailSVG', args: [BigInt(id)] });
  fs.writeFileSync(`data/sepolia-artcheck/cube-${id}.svg`, svg);
  const rl = realId(src, d.sourceTokenId);
  html += `<div style="width:270px"><img width="260" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
  <div>cube #${id} — ${src}${rl ? ` — compare REAL #${rl} on OpenSea` : ` #${d.sourceTokenId}`}</div></div>`;
}
html += '</div>';
fs.writeFileSync('data/sepolia-artcheck/gallery.html', html);
console.log(`gallery: data/sepolia-artcheck/gallery.html (${next - 1} tokens)`);
