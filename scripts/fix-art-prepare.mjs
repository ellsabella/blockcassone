// Prepare the Sepolia art-store swap: enumerate every minted EXTERNAL cube on the
// full deployment, flatten CORRECTED payloads for their source ids (DNA-fixed
// runners; other decoders unchanged), and write the manifest the FixSepoliaArt
// forge script consumes.
import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';

// flatten.mjs reads RPC_URL at module scope (mainnet, for the source art) — set it
// BEFORE the dynamic import.
process.env.RPC_URL = process.env.RPC_URL || process.env.ETH_RPC_URL;
const { crGrid, skullGrid, pepeGrid, nounGrid, kevinGrid, flatten } = await import('../dev/cc0-proof/flatten.mjs');

const RPC = process.env.BLOCKCASSONE_RPC_URL; // Sepolia (reads the deployment)
const contracts = JSON.parse(fs.readFileSync('data/sepolia-full/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(RPC) });
const CUBE_ABI = [
  { type: 'function', name: 'nextCubeId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'cubeDataUnchecked', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'slot', type: 'uint32' }, { name: 'sourceKind', type: 'uint8' }, { name: 'rendererVersion', type: 'uint8' },
      { name: 'payloadVersion', type: 'uint8' }, { name: 'agentic', type: 'bool' }, { name: 'agentId', type: 'uint256' },
      { name: 'mintedAt', type: 'uint64' }, { name: 'sourceChainId', type: 'uint256' }, { name: 'sourceContract', type: 'address' },
      { name: 'sourceTokenId', type: 'uint256' }, { name: 'seed', type: 'bytes32' } ] }] },
];

const keyByAddr = {};
const grids = { runner: crGrid, skull: skullGrid, pepe: pepeGrid, noun: nounGrid, kevin: kevinGrid };
const keys = ['runner', 'skull', 'pepe', 'noun', 'kevin'];
for (let i = 1; i <= 5; i++) keyByAddr[getAddress(contracts[`cc0_${i}`])] = keys[i - 1];

const next = Number(await pub.readContract({ address: contracts.cubeNft, abi: CUBE_ABI, functionName: 'nextCubeId' }));
const perKey = { runner: new Set(), skull: new Set(), pepe: new Set(), noun: new Set(), kevin: new Set() };
for (let id = 1; id < next; id++) {
  const d = await pub.readContract({ address: contracts.cubeNft, abi: CUBE_ABI, functionName: 'cubeDataUnchecked', args: [BigInt(id)] });
  const key = keyByAddr[getAddress(d.sourceContract)];
  if (key) perKey[key].add(Number(d.sourceTokenId));
}

fs.mkdirSync('data/sepolia-full/fix-art', { recursive: true });
const manifest = {};
for (const key of keys) {
  const ids = [...perKey[key]].sort((a, b) => a - b);
  manifest[key] = ids;
  for (const id of ids) {
    const out = `data/sepolia-full/fix-art/${key}-${id}.hex`;
    if (fs.existsSync(out)) continue;
    // Corrected art comes from MAINNET (flatten.mjs RPC_URL).
    const grid = await grids[key](id);
    const f = flatten(grid.colors, grid.size);
    if (f.payload.length !== 400) throw new Error(`${key} ${id}: payload ${f.payload.length} != 400`);
    const hex = '0x' + Buffer.from(f.payload).toString('hex');
    fs.writeFileSync(out, hex + '\n');
    console.log(`flattened ${key} #${id}`);
  }
}
fs.writeFileSync('data/sepolia-full/fix-art/manifest.json', JSON.stringify(manifest, null, 2));
console.log('manifest:', JSON.stringify(Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length]))));
