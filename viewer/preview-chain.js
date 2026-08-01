// Authoritative on-chain SVG previews for the Update Cube page.
// Calls CubeThumbnailRendererV1.previewThumbnailSVG(seed, slot, sourceTokenId,
// tonalPayload) via eth_call (no state change, free) and returns the SVG string —
// byte-identical to what re-basing onto that art would store. The thumbnail
// renderer address is derived from the V2 `renderer` in chain-config.json.

import { loadChainMintRecords } from './chain-cubes.js';
import { keccak256 } from '../core/keccak.js';
import { startRpc } from './perf-metrics.js';

const CUSTOMIZE_SELECTOR = 'c029bfed'; // customizeCube(uint256,address,uint256,bytes,(...),bytes)
const MINT_EXTERNAL_SELECTOR = '4c92acf4'; // mintExternalERC721CubeWithPayload(address,uint256,uint32,bytes32,bytes,(...),bytes)
// keccak256("BLOCKCASSONE_NON_NORMIE_TONAL_BANDS_2BIT_V1") — NonNormieArt.TONAL_BANDS_2BIT_HASH_DOMAIN
const TONAL_HASH_DOMAIN = '2424f34564746cf332e7899072209873d7b38b19d87170b49d20de18f6a251dd';
const THUMBNAIL_RENDERER_SELECTOR = 'ad125d79'; // thumbnailRenderer()
const PREVIEW_SELECTOR = '7aa0522a'; // previewThumbnailSVG(bytes32,uint32,address,uint256,bytes)
const THUMBNAIL_SVG_SELECTOR = '1df76ecc'; // thumbnailSVG(uint256)

let configPromise = null;
let thumbAddrPromise = null;

async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch('/data/chain-config.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return configPromise;
}

async function ethCall(cfg, to, data) {
  const endpoint = cfg.directRpc ? (cfg.rpcUrl || 'http://127.0.0.1:8545') : '/api/chain-rpc';
  const done = startRpc('eth_call', 1);
  let ok = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'eth_call error');
    ok = true;
    return j.result;
  } finally {
    done(ok);
  }
}

async function thumbnailRendererAddress(cfg) {
  if (!cfg.renderer) throw new Error('chain-config.json has no "renderer" address — deploy the contracts and point it at the local CubeRendererV2.');
  if (!thumbAddrPromise) {
    thumbAddrPromise = ethCall(cfg, cfg.renderer, '0x' + THUMBNAIL_RENDERER_SELECTOR)
      .then(r => '0x' + String(r).replace(/^0x/, '').slice(-40))
      .catch(err => { thumbAddrPromise = null; throw err; });
  }
  return thumbAddrPromise;
}

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const seedWord = (seed) => String(seed).replace(/^0x/, '').padStart(64, '0').slice(-64);
const addrWord = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');

// Generic JSON-RPC (eth_signTypedData_v4 / eth_sendTransaction), via the proxy.
async function rpcRaw(cfg, method, params) {
  const endpoint = cfg.directRpc ? (cfg.rpcUrl || 'http://127.0.0.1:8545') : '/api/chain-rpc';
  const done = startRpc(method, 1);
  let ok = false;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || `${method} error`);
    ok = true;
    return j.result;
  } finally {
    done(ok);
  }
}

// ABI-encode customizeCube. The Attestation struct is all-static (10 words), so it
// inlines in the head; only tonalBands2Bit + signature are dynamic tails.
function encodeCustomize(cubeId, sourceContract, sourceTokenId, payload, att, signature) {
  let tonalHex = '';
  for (let i = 0; i < payload.length; i++) tonalHex += payload[i].toString(16).padStart(2, '0');
  const tonalEnc = word(payload.length) + padRight32(tonalHex);
  const sigHex = String(signature).replace(/^0x/, '');
  const sigEnc = word(sigHex.length / 2) + padRight32(sigHex);
  const offsetTonal = 15 * 32; // 4 leading words + 10 attestation words + 1 sig-offset word
  const offsetSig = offsetTonal + tonalEnc.length / 2;
  const head =
    word(cubeId) + addrWord(sourceContract) + word(sourceTokenId) + word(offsetTonal)
    + addrWord(att.minter) + addrWord(att.sourceContract) + word(att.sourceTokenId)
    + word(att.payloadVersion) + word(att.agentic ? 1 : 0) + word(att.agentId)
    + word(att.flatteningVersion) + seedWord(att.payloadHash) + word(att.nonce) + word(att.deadline)
    + word(offsetSig);
  return '0x' + CUSTOMIZE_SELECTOR + head + tonalEnc + sigEnc;
}

// Build + EIP-712-sign a FlatteningAttestation for `payload` deriving from the
// wallet token (sourceContract,sourceTokenId), minted by `owner`. Shared by both
// the fresh external mint and the re-base (customize). Dev flow: the node signs
// with the unlocked attestationSigner. Returns { att, signature }.
async function signFlatteningAttestation(cfg, { owner, sourceContract, sourceTokenId, payload }) {
  // On-chain hashTonalBands2Bit = keccak256(abi.encode(DOMAIN, payload)). Rebuild
  // that exact preimage (domain word + bytes offset/length/data) and hash it
  // client-side so attestation.payloadHash matches byte-for-byte — no RPC round
  // trip. core/keccak.js is the byte-exact Solidity twin (verified multi-block).
  const preimage = TONAL_HASH_DOMAIN + word(64) + word(payload.length) + padRight32(bytesToHex(payload));
  const payloadHash = '0x' + keccak256(hexToBytes(preimage));
  const att = {
    minter: owner,
    sourceContract,
    sourceTokenId: BigInt(sourceTokenId),
    payloadVersion: 1,
    agentic: false,
    agentId: 0n,
    flatteningVersion: 1,
    payloadHash,
    nonce: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Attestation: [
        { name: 'minter', type: 'address' },
        { name: 'sourceContract', type: 'address' },
        { name: 'sourceTokenId', type: 'uint256' },
        { name: 'payloadVersion', type: 'uint8' },
        { name: 'agentic', type: 'bool' },
        { name: 'agentId', type: 'uint256' },
        { name: 'flatteningVersion', type: 'uint16' },
        { name: 'payloadHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Attestation',
    domain: {
      name: 'BlockcassoneFlattening',
      version: '1',
      chainId: Number(cfg.chainId || 1),
      verifyingContract: cfg.flatteningAttestation,
    },
    message: {
      minter: att.minter,
      sourceContract: att.sourceContract,
      sourceTokenId: att.sourceTokenId.toString(),
      payloadVersion: att.payloadVersion,
      agentic: att.agentic,
      agentId: att.agentId.toString(),
      flatteningVersion: att.flatteningVersion,
      payloadHash: att.payloadHash,
      nonce: att.nonce.toString(),
      deadline: att.deadline.toString(),
    },
  };
  // Anvil accepts the typed data as an object; some builds want a JSON string.
  let signature;
  try {
    signature = await rpcRaw(cfg, 'eth_signTypedData_v4', [cfg.attestationSigner, typedData]);
  } catch (e) {
    signature = await rpcRaw(cfg, 'eth_signTypedData_v4', [cfg.attestationSigner, JSON.stringify(typedData)]);
  }
  return { att, signature };
}

// Re-base cube `cubeId` (owned by `owner`) onto the wallet token
// (sourceContract,sourceTokenId) with the flattened `payload`. Dev flow: Anvil
// signs the EIP-712 attestation (unlocked signer) and sends the tx (unlocked owner).
export async function customizeCube({ cubeId, owner, sourceContract, sourceTokenId, payload }) {
  const cfg = await loadConfig();
  if (!cfg.cubeMintController || !cfg.flatteningAttestation || !cfg.attestationSigner) {
    throw new Error('chain-config.json missing customize addresses — redeploy with the customize stack');
  }
  const { att, signature } = await signFlatteningAttestation(cfg, { owner, sourceContract, sourceTokenId, payload });
  const data = encodeCustomize(cubeId, sourceContract, sourceTokenId, payload, att, signature);
  return sendTx(cfg, owner, cfg.cubeMintController, data, 'customizeCube');
}

// ABI-encode mintExternalERC721CubeWithPayload. Same inline-Attestation layout as
// encodeCustomize, but leads with sourceContract/sourceTokenId/slot/seed (5 words)
// instead of cubeId (1 word), so offsetTonal = 16 words.
function encodeMintExternal(sourceContract, sourceTokenId, slot, seed, payload, att, signature) {
  const tonalEnc = word(payload.length) + padRight32(bytesToHex(payload));
  const sigHex = String(signature).replace(/^0x/, '');
  const sigEnc = word(sigHex.length / 2) + padRight32(sigHex);
  const offsetTonal = 16 * 32; // 5 leading words + 10 attestation words + 1 sig-offset word
  const offsetSig = offsetTonal + tonalEnc.length / 2;
  const head =
    addrWord(sourceContract) + word(sourceTokenId) + word(slot) + seedWord(seed) + word(offsetTonal)
    + addrWord(att.minter) + addrWord(att.sourceContract) + word(att.sourceTokenId)
    + word(att.payloadVersion) + word(att.agentic ? 1 : 0) + word(att.agentId)
    + word(att.flatteningVersion) + seedWord(att.payloadHash) + word(att.nonce) + word(att.deadline)
    + word(offsetSig);
  return '0x' + MINT_EXTERNAL_SELECTOR + head + tonalEnc + sigEnc;
}

// Mint a NEW cube from a wallet-held external token (sourceContract,sourceTokenId)
// with the flattened `payload`, at `slot`. `owner` must OWN the source token — the
// mint reverts otherwise. Dev/local: a mainnet-fork Anvil with the holder
// impersonated, or a mock external ERC-721 minted to `owner`. Dev flow: the node
// signs the EIP-712 attestation (unlocked signer) and sends the tx (unlocked owner).
export async function mintExternalCubeOnChain({ slot, owner, sourceContract, sourceTokenId, payload, seed }) {
  const cfg = await loadConfig();
  if (!cfg.cubeMintController || !cfg.flatteningAttestation || !cfg.attestationSigner) {
    throw new Error('chain-config.json missing mint addresses — redeploy with the customize stack');
  }
  const sd = seed || ('0x' + word(BigInt(sourceTokenId) * 2654435761n + BigInt(Date.now())).slice(-64));
  const { att, signature } = await signFlatteningAttestation(cfg, { owner, sourceContract, sourceTokenId, payload });
  const data = encodeMintExternal(sourceContract, sourceTokenId, slot, sd, payload, att, signature);
  return sendTx(cfg, owner, cfg.cubeMintController, data, 'mintExternalERC721CubeWithPayload');
}

// Route eth_sendTransaction through a connected wallet (EIP-1193) when set — the
// holder signs + sends from their own account. Left null in local dev, where sendTx
// falls back to the unlocked-account node RPC. See viewer/wallet.js.
let txSender = null;
export function setTransactionSender(fn) { txSender = fn; }

// Send a tx + wait for the receipt. eth_sendTransaction returns a hash even when
// the tx reverts on mine, so verify status and, on revert, replay as eth_call to
// surface the real reason.
async function sendTx(cfg, from, to, data, label, value) {
  const tx = { from, to, data };
  if (value != null) tx.value = value; // hex quantity (e.g. '0x38d7ea4c68000'); omitted = 0
  const txHash = txSender
    ? await txSender(tx)
    : await rpcRaw(cfg, 'eth_sendTransaction', [tx]);
  let receipt = null;
  for (let i = 0; i < 40 && !receipt; i++) {
    receipt = await rpcRaw(cfg, 'eth_getTransactionReceipt', [txHash]);
    if (!receipt) await new Promise(r => setTimeout(r, 150));
  }
  if (receipt && receipt.status === '0x0') {
    let reason = 'reverted';
    try { await rpcRaw(cfg, 'eth_call', [tx, receipt.blockNumber || 'latest']); }
    catch (e) { reason = String(e?.message || e); }
    throw new Error(`${label || 'tx'} reverted: ${reason}`);
  }
  return txHash;
}

// Move a cube the caller owns to a vacant slot (CubeNFT.moveCube).
// Dev/local only: mint a fresh mock Normie + a cube at an EXPLICIT slot, so the
// Big Cube page can preview a specific colour combo on-chain (colour = f(slot)).
// Needs the LocalMockNormies dev contract (its mint() is unguarded) — on a mainnet
// fork the real Normies has no public mint, so this won't work there. `owner` must
// be an unlocked Anvil account (defaults to acct #0, which owns the mock + sends).
const DEV_MINT_OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export async function mintNormieCubeOnChain({ slot, owner = DEV_MINT_OWNER, normieId, seed }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft || !cfg.normies) throw new Error('chain-config.json missing cubeNft/normies');
  // Keep it a VALID Normie id (0..9999, 4-digit label) and clear of the genesis
  // sample ids (0..7); unique per slot. 100000+slot produced impossible ids.
  const nid = normieId != null ? Number(normieId) : 1000 + Number(slot);
  const sd = seed || ('0x' + word(BigInt(nid) * 2654435761n + BigInt(Date.now())).slice(-64));
  // 1) mint the source Normie on the mock so it has art + ownership
  await sendTx(cfg, owner, cfg.normies, '0x40c10f19' + addrWord(owner) + word(nid), 'mockNormieMint');
  // 2) mint the cube at the chosen slot (caller owns the Normie; not owner-gated)
  await sendTx(cfg, owner, cfg.cubeNft, '0xd3cdc267' + word(nid) + word(slot) + seedWord(sd), 'mintNormieCube');
  return { cubeOwner: owner, normieId: nid, slot: Number(slot), seed: sd };
}

// Split an eth_call result into `n` 32-byte words as BigInts.
function decodeWords(result, n) {
  const hex = String(result || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i < n; i++) out.push(BigInt('0x' + (hex.slice(i * 64, i * 64 + 64) || '0')));
  return out;
}
const hexQuantity = (n) => '0x' + BigInt(n).toString(16); // minimal hex for tx.value

// Live fee + split for a moveCube (CubeNFT.quoteMove). victim == 0x0 for a vacant
// move or a free self-swap. All amounts are BigInt wei.
export async function quoteMove({ cubeId, newSlot }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const res = await ethCall(cfg, cfg.cubeNft, '0x70b01a20' + word(cubeId) + word(newSlot));
  const [fee, victimWord, victimShare, houseShare] = decodeWords(res, 4);
  return { fee, victim: '0x' + victimWord.toString(16).padStart(40, '0').slice(-40), victimShare, houseShare };
}

// Live fee + vacant-plot count for a mergeStreet (CubeNFT.quoteMerge). BigInt wei.
export async function quoteMerge({ street }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const res = await ethCall(cfg, cfg.cubeNft, '0x2130e9c3' + word(street));
  const [fee, emptyPlots] = decodeWords(res, 2);
  return { fee, emptyPlots };
}

// Move a cube to a vacant slot, or displace an occupant in a street you own >=5/8 of
// (CubeNFT.moveCube is payable — the fee is quoted on-chain and sent as msg.value).
export async function moveCube({ cubeId, owner, newSlot }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const { fee } = await quoteMove({ cubeId, newSlot });
  const data = '0x42ba6aa6' + word(cubeId) + word(newSlot);
  return sendTx(cfg, owner, cfg.cubeNft, data, 'moveCube', hexQuantity(fee));
}

// Merge every occupied plot of a street the caller solely owns (CubeNFT.mergeStreet is
// payable — free at 8/8, else baseFee per vacant plot, quoted on-chain and sent as value).
export async function mergeStreet({ street, owner, leaderCubeId }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const { fee } = await quoteMerge({ street });
  // mergeStreet(uint32) auto-picks the lowest plot; mergeStreet(uint32,uint256)
  // uses the owner-chosen leader cube as the street SVG.
  const data = leaderCubeId
    ? '0x991b9e12' + word(street) + word(leaderCubeId)
    : '0x6ea3aa45' + word(street);
  return sendTx(cfg, owner, cfg.cubeNft, data, 'mergeStreet', hexQuantity(fee));
}

function bytesToHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function padRight32(hex) {
  const rem = hex.length % 64;
  return rem === 0 ? hex : hex + '0'.repeat(64 - rem);
}

function decodeString(ret) {
  const hex = String(ret || '').replace(/^0x/, '');
  if (hex.length < 128) return '';
  const len = Number(BigInt('0x' + hex.slice(64, 128))); // [offset][length][data…]
  const dataHex = hex.slice(128, 128 + len * 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2) || '00', 16);
  return new TextDecoder().decode(bytes);
}

// The on-chain thumbnail SVG of an existing cube (the owned-cubes row).
export async function cubeThumbnailSVG(cubeId) {
  const cfg = await loadConfig();
  if (!cfg.renderer) throw new Error('chain-config.json has no "renderer" address');
  return decodeString(await ethCall(cfg, cfg.renderer, '0x' + THUMBNAIL_SVG_SELECTOR + word(cubeId)));
}

// The cube's full on-chain animation (data:text/html;base64 …) — the real 3D that any cube
// renders to marketplaces, self-contained. In dev without RendererAssetStore chunks the
// contract returns its own "asset chunks not installed" fallback screen (honest, not blank).
export async function cubeAnimationURI(cubeId) {
  const cfg = await loadConfig();
  if (!cfg.renderer) throw new Error('chain-config.json has no "renderer" address');
  return decodeString(await ethCall(cfg, cfg.renderer, '0x5209ec17' + word(cubeId)));
}

// Cubes minted on the local chain. For dev, optionally filter by owner; the
// returned cubes are the candidate targets to overwrite (cubeId + seed + slot).
export async function loadOwnedCubes(owner) {
  const result = await loadChainMintRecords();
  console.info('[preview-chain] loadChainMintRecords →', {
    enabled: result?.enabled,
    cubeNft: result?.config?.cubeNft,
    count: result?.records?.length || 0,
  });
  const records = (result && result.records) || [];
  const own = owner ? String(owner).toLowerCase() : null;
  return records
    .filter(r => !own || String(r.wallet || '').toLowerCase() === own)
    .map(r => ({ cubeId: r.cubeId, slot: r.slot, seed: r.seed, sourceTokenId: r.source?.tokenId, owner: r.wallet }));
}

// seed: 0x bytes32 (or any hex). slot/sourceTokenId: number|bigint. sourceContract: 0x addr
// (drives the hex banner — the re-base target's contract). payload: Uint8Array(400).
export async function previewThumbnailSVG({ seed, slot, sourceContract, sourceTokenId, payload }) {
  const cfg = await loadConfig();
  const to = await thumbnailRendererAddress(cfg);
  const data = '0x' + PREVIEW_SELECTOR
    + seedWord(seed)
    + word(slot)
    + addrWord(sourceContract || '0x0000000000000000000000000000000000000000')
    + word(sourceTokenId)
    + word(160) // offset to the bytes arg (5 head words × 32)
    + word(payload.length)
    + padRight32(bytesToHex(payload));
  return decodeString(await ethCall(cfg, to, data));
}

// The three post-mint mechanic switches (owner-flipped on-chain). The Update page hides
// itself + its nav links when customizesEnabled is false; Streets/move use the others.
export async function contractFlags() {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) return { customizesEnabled: false, movesEnabled: false, mergesEnabled: false };
  const read = async (sel) => {
    try { return Boolean(BigInt(await ethCall(cfg, cfg.cubeNft, '0x' + sel) || '0x0')); }
    catch { return false; }
  };
  const [customizesEnabled, movesEnabled, mergesEnabled] = await Promise.all([
    read('c303b017'), read('bd593a6e'), read('41943a98'),
  ]);
  return { customizesEnabled, movesEnabled, mergesEnabled };
}

// Attestation-free re-base onto an UNUSED pool source (a Normie's live art, or a CC0 token
// whose flattened payload is committed to the store). Not payable. CubeNFT.rebaseToPoolSource.
export async function rebaseToPoolSource({ cubeId, owner, sourceContract, sourceTokenId }) {
  const cfg = await loadConfig();
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const data = '0x8cd6cfbb' + word(cubeId) + addrWord(sourceContract) + word(sourceTokenId);
  return sendTx(cfg, owner, cfg.cubeNft, data, 'rebaseToPoolSource');
}

// ---- CC0 pool ("spin the wheel") ------------------------------------------
// The committed pool = every source with art in the NonNormieArtStore. We enumerate via its
// SourcePayloadRecorded logs, read a chosen source's 400-byte payload with the store's
// sourcePayload view (preview via previewThumbnailSVG), and commit with rebaseToPoolSource.
// Uniqueness is enforced on-chain (a taken source reverts on commit), so we just re-spin.
let _artStoreAddr = null, _poolCache = null;

async function rpcNode(cfg, method, params) {
  const endpoint = cfg.directRpc ? (cfg.rpcUrl || 'http://127.0.0.1:8545') : '/api/chain-rpc';
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || (method + ' error'));
  return j.result;
}

async function artStoreAddress(cfg) {
  if (_artStoreAddr) return _artStoreAddr;
  if (!cfg.cubeNft) throw new Error('chain-config.json has no "cubeNft"');
  const ret = await ethCall(cfg, cfg.cubeNft, '0x960acdbe'); // artStore()
  const addr = '0x' + String(ret).replace(/^0x/, '').slice(-40);
  if (/^0x0+$/.test(addr)) throw new Error('token has no art store set');
  return (_artStoreAddr = addr);
}

// [{ sourceContract, sourceTokenId }] for every committed pool source. Cached.
export async function poolSources() {
  if (_poolCache) return _poolCache;
  const cfg = await loadConfig();
  const store = await artStoreAddress(cfg);
  const logs = await rpcNode(cfg, 'eth_getLogs', [{
    address: store, fromBlock: 'earliest', toBlock: 'latest',
    topics: ['0x3b28c236850773c4634072ae961ae2ed0d5584bbba4daecd414cd6f2d6a45445'], // SourcePayloadRecorded
  }]);
  const seen = new Set(), out = [];
  for (const lg of (logs || [])) {
    const t = lg.topics || []; if (t.length < 3) continue;
    const sourceContract = '0x' + String(t[1]).replace(/^0x/, '').slice(-40);
    const sourceTokenId = BigInt(t[2]).toString();
    const k = sourceContract + ':' + sourceTokenId;
    if (!seen.has(k)) { seen.add(k); out.push({ sourceContract, sourceTokenId }); }
  }
  return (_poolCache = out);
}

// The committed 400-byte tonal payload of a pool source (Uint8Array; empty if none).
export async function poolSourcePayload({ sourceContract, sourceTokenId }) {
  const cfg = await loadConfig();
  const store = await artStoreAddress(cfg);
  const ret = await ethCall(cfg, store, '0xea4468b9' + addrWord(sourceContract) + word(sourceTokenId));
  const hex = String(ret || '').replace(/^0x/, '');
  if (hex.length < 128) return new Uint8Array(0);
  const len = Number(BigInt('0x' + hex.slice(64, 128)));
  return hexToBytes('0x' + hex.slice(128, 128 + len * 2));
}
