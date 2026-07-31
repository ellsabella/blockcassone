// Dev pathway: place the 16 flattened CC0 samples into the Big-Cube world so you
// can walk the world and see the real skulls/runners rendered as cubes. Writes a
// data/world-snapshot.json of external-cube records (same shape the indexer bakes),
// so the viewer renders them with 0 RPC. Backs up any existing snapshot once.
import fs from 'node:fs/promises';
import sha3 from 'js-sha3';
import { compactNonNormieArt } from '../../viewer/art-snapshot.js';
const { keccak_256 } = sha3;

const HERE = new URL('./', import.meta.url);
const REPO = new URL('../../', import.meta.url);
// Must match data/chain-config.json cubeNft, else the viewer rejects the snapshot.
const CUBE_NFT = '0xd969897adeb947a22e9621db2db186e6ea11140f';

const samples = JSON.parse(await fs.readFile(new URL('./out/manifest.json', HERE), 'utf8'));

const records = samples.map((s, i) => {
  const tonal = Uint8Array.from(Buffer.from(s.payloadHex.replace(/^0x/, ''), 'hex'));
  const payloadHash = '0x' + keccak_256(tonal);
  return {
    cubeId: i + 1,
    slot: i, // slots 0..N-1 — a findable contiguous cluster along the first streets
    wallet: '0x00000000000000000000000000000000c0ffee00',
    sourceKind: 'external',
    sourceKindNumber: 2,
    source: { chain: 'ethereum', chainId: 1, contract: s.contract, tokenId: String(s.id) },
    cc0: null,
    agentic: false,
    agentId: '',
    seed: s.seed,
    art: compactNonNormieArt({ id: s.id, tonal, payloadHash }),
    _chain: { rendererVersion: 1, payloadVersion: 1, mintedAt: Math.floor(Date.now() / 1000) },
  };
});

const snapPath = new URL('data/world-snapshot.json', REPO);
try {
  await fs.copyFile(snapPath, new URL('data/world-snapshot.prev.json', REPO));
  console.log('backed up existing snapshot -> data/world-snapshot.prev.json');
} catch { /* none to back up */ }

await fs.writeFile(snapPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  chainId: 1,
  cubeNft: CUBE_NFT,
  count: records.length,
  records,
}, null, 2) + '\n');

console.log(`wrote data/world-snapshot.json: ${records.length} CC0 cubes at slots 0..${records.length - 1}`);
for (const r of records) console.log(`  slot ${String(r.slot).padStart(2)}  ${r.source.tokenId.padStart(5)}  ${samples[r.cubeId - 1].contractName}`);
