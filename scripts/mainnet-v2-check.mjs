// Post-DeployGenesisV2 verification: new addresses from the broadcast, reused infra
// from the superseded deployment, full wiring audit incl. the reuse seams.
import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';

const prev = JSON.parse(fs.readFileSync('data/mainnet/contracts.json', 'utf8'));
const run = JSON.parse(fs.readFileSync('broadcast/DeployGenesisV2.s.sol/1/run-latest.json', 'utf8'));
const byName = {};
for (const t of run.transactions || []) {
  if (t.transactionType === 'CREATE' && t.contractName) byName[t.contractName] = getAddress(t.contractAddress);
}
console.log('NEW:', JSON.stringify(byName, null, 2));

const pub = createPublicClient({ transport: http(process.env.ETH_RPC_URL) });
const abi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
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
  { type: 'function', name: 'assets', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'chunkCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'authorizedConsumer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'attestationSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];
const r = (a, fn, args = []) => pub.readContract({ address: a, abi, functionName: fn, args });

const SEADROP = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
const DEPLOYER = '0x5A1c0c3dE4754c726A2E4FB2EcE9F934FDB18dd2';
const A = byName;
const cubes = A.CubeNFT;
const checks = [
  ['name', await r(cubes, 'name'), 'TheBLOCK'],
  ['maxSupply', String(await r(cubes, 'maxSupply')), '4096'],
  ['owner', await r(cubes, 'owner'), DEPLOYER],
  ['renderer', await r(cubes, 'renderer'), A.CubeRendererV2],
  ['genesisMinter', await r(cubes, 'genesisMinter'), A.MultiSourceGenesisMinter],
  ['customizer', await r(cubes, 'customizer'), A.CubeMintController],
  ['artStore', await r(cubes, 'artStore'), A.NonNormieArtStore],
  ['agentRegistry (REUSED)', await r(cubes, 'agentStatusRegistry'), prev.AgentStatusRegistry],
  ['allowedSeaDrop', String(await r(cubes, 'allowedSeaDrop', [SEADROP])), 'true'],
  ['minter.owner', await r(A.MultiSourceGenesisMinter, 'owner'), DEPLOYER],
  ['minter.seaDrop==token', await r(A.MultiSourceGenesisMinter, 'seaDrop'), cubes],
  ['phase Closed', String(await r(A.MultiSourceGenesisMinter, 'phase')), '0'],
  ['finalized', String(await r(A.MultiSourceGenesisMinter, 'finalized')), 'false'],
  ['moves off', String(await r(cubes, 'movesEnabled')), 'false'],
  ['merges off', String(await r(cubes, 'mergesEnabled')), 'false'],
  ['customizes off', String(await r(cubes, 'customizesEnabled')), 'false'],
  ['artStore.owner==controller', await r(A.NonNormieArtStore, 'owner'), A.CubeMintController],
  ['renderer.assets == REUSED store', await r(A.CubeRendererV2, 'assets'), prev.RendererAssetStore],
  ['reused store chunkCount', String(await r(prev.RendererAssetStore, 'chunkCount')), '9'],
  ['attestation.consumer == NEW controller', await r(prev.FlatteningAttestation, 'authorizedConsumer'), A.CubeMintController],
  ['attestation.signer unchanged', (await r(prev.FlatteningAttestation, 'attestationSigner')).toLowerCase(), '0x013e2f9ca0be2a0497c50a2bda97de58052d9c16'],
];
let fail = 0;
for (const [label, got, want] of checks) {
  const ok = String(got) === String(want);
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}
fs.renameSync('data/mainnet/contracts.json', 'data/mainnet/contracts-v1-superseded.json');
fs.writeFileSync('data/mainnet/contracts.json', JSON.stringify({
  chainId: 1, seaDrop: SEADROP, deployer: DEPLOYER, ...byName,
  RendererAssetStore: prev.RendererAssetStore, AgentStatusRegistry: prev.AgentStatusRegistry,
  FlatteningAttestation: prev.FlatteningAttestation, CubeHilbertGeometry: prev.CubeHilbertGeometry,
  CubeFrameLayer: prev.CubeFrameLayer, CubeWalkerLayer: prev.CubeWalkerLayer,
}, null, 2));
console.log(fail ? `\n${fail} FAILED — STOP` : '\nALL V2 WIRING CHECKS PASS — CommitPools may proceed');
