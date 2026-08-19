// Extract deployed addresses from the mainnet broadcast and verify the full wiring
// on-chain. Writes data/mainnet/contracts.json (kept out of git — address stays
// quiet until the audit clears).
import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';

const run = JSON.parse(fs.readFileSync('broadcast/DeployGenesis.s.sol/1/run-latest.json', 'utf8'));
const byName = {};
for (const t of run.transactions || []) {
  if (t.transactionType === 'CREATE' && t.contractName) byName[t.contractName] = getAddress(t.contractAddress);
}
console.log('deployed:', JSON.stringify(byName, null, 2));

const pub = createPublicClient({ transport: http(process.env.ETH_RPC_URL) });
const A = byName;
const cubes = A.CubeNFT;
const abi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'maxSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'renderer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'genesisMinter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'customizer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agentStatusRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'artStore', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'allowedSeaDrop', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'seaDrop', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'phase', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'finalized', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'movesEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mergesEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'customizesEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'attestationSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];
const r = (addr, fn, args = []) => pub.readContract({ address: addr, abi, functionName: fn, args });

const SEADROP = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
const DEPLOYER = '0x5A1c0c3dE4754c726A2E4FB2EcE9F934FDB18dd2';
const ATTESTOR = '0x013e2f9ca0be2a0497c50a2bda97de58052d9c16';
const checks = [
  ['CubeNFT.name', await r(cubes, 'name'), 'TheBLOCK'],
  ['CubeNFT.symbol', await r(cubes, 'symbol'), 'BLOCK'],
  ['CubeNFT.maxSupply', String(await r(cubes, 'maxSupply')), '4096'],
  ['CubeNFT.owner', await r(cubes, 'owner'), DEPLOYER],
  ['CubeNFT.renderer', await r(cubes, 'renderer'), A.CubeRendererV2],
  ['CubeNFT.genesisMinter', await r(cubes, 'genesisMinter'), A.MultiSourceGenesisMinter],
  ['CubeNFT.customizer', await r(cubes, 'customizer'), A.CubeMintController],
  ['CubeNFT.artStore', await r(cubes, 'artStore'), A.NonNormieArtStore],
  ['CubeNFT.agentRegistry', await r(cubes, 'agentStatusRegistry'), A.AgentStatusRegistry],
  ['CubeNFT.allowedSeaDrop[SeaDrop]', String(await r(cubes, 'allowedSeaDrop', [SEADROP])), 'true'],
  ['Minter.owner', await r(A.MultiSourceGenesisMinter, 'owner'), DEPLOYER],
  ['Minter.seaDrop (== token)', await r(A.MultiSourceGenesisMinter, 'seaDrop'), cubes],
  ['Minter.phase (Closed=0)', String(await r(A.MultiSourceGenesisMinter, 'phase')), '0'],
  ['Minter.finalized', String(await r(A.MultiSourceGenesisMinter, 'finalized')), 'false'],
  ['movesEnabled', String(await r(cubes, 'movesEnabled')), 'false'],
  ['mergesEnabled', String(await r(cubes, 'mergesEnabled')), 'false'],
  ['customizesEnabled', String(await r(cubes, 'customizesEnabled')), 'false'],
  ['ArtStore.owner (== controller)', await r(A.NonNormieArtStore, 'owner'), A.CubeMintController],
  ['Attestation.signer', (await r(A.FlatteningAttestation, 'attestationSigner')).toLowerCase(), ATTESTOR.toLowerCase()],
  ['AssetStore.owner', await r(A.RendererAssetStore, 'owner'), DEPLOYER],
];
let fail = 0;
for (const [label, got, want] of checks) {
  const ok = String(got) === String(want);
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}
fs.mkdirSync('data/mainnet', { recursive: true });
fs.writeFileSync('data/mainnet/contracts.json', JSON.stringify({ chainId: 1, seaDrop: SEADROP, deployer: DEPLOYER, ...byName }, null, 2));
console.log(fail ? `\n${fail} CHECKS FAILED — STOP` : '\nALL WIRING CHECKS PASS — proceed to chunks');
