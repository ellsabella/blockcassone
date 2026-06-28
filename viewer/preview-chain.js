// Authoritative on-chain SVG previews for the Update Cube page.
// Calls CubeThumbnailRendererV1.previewThumbnailSVG(seed, slot, sourceTokenId,
// tonalPayload) via eth_call (no state change, free) and returns the SVG string —
// byte-identical to what re-basing onto that art would store. The thumbnail
// renderer address is derived from the V2 `renderer` in chain-config.json.

import { loadChainMintRecords } from './chain-cubes.js';

const CUSTOMIZE_SELECTOR = 'c029bfed'; // customizeCube(uint256,address,uint256,bytes,(...),bytes)
const THUMBNAIL_RENDERER_SELECTOR = 'ad125d79'; // thumbnailRenderer()
const PREVIEW_SELECTOR = 'f3d3c20b'; // previewThumbnailSVG(bytes32,uint32,uint256,bytes)
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
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'eth_call error');
  return j.result;
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
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || `${method} error`);
  return j.result;
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

// Re-base cube `cubeId` (owned by `owner`) onto the wallet token
// (sourceContract,sourceTokenId) with the flattened `payload`. Dev flow: Anvil
// signs the EIP-712 attestation (unlocked signer) and sends the tx (unlocked owner).
export async function customizeCube({ cubeId, owner, sourceContract, sourceTokenId, payload }) {
  const cfg = await loadConfig();
  if (!cfg.cubeMintController || !cfg.flatteningAttestation || !cfg.attestationSigner) {
    throw new Error('chain-config.json missing customize addresses — redeploy with the customize stack');
  }
  // Hash the payload on the node (web3_sha3) so it equals the on-chain
  // keccak256(tonalBands2Bit) byte-for-byte (the browser keccak diverged on the
  // 400-byte multi-block input).
  let phex = '';
  for (let i = 0; i < payload.length; i++) phex += payload[i].toString(16).padStart(2, '0');
  const payloadHash = await rpcRaw(cfg, 'web3_sha3', ['0x' + phex]);
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
  const data = encodeCustomize(cubeId, sourceContract, sourceTokenId, payload, att, signature);
  const tx = { from: owner, to: cfg.cubeMintController, data };
  const txHash = await rpcRaw(cfg, 'eth_sendTransaction', [tx]);

  // eth_sendTransaction returns a hash even when the tx reverts on mine, so verify
  // the receipt; on revert, replay as eth_call to surface the actual reason.
  let receipt = null;
  for (let i = 0; i < 40 && !receipt; i++) {
    receipt = await rpcRaw(cfg, 'eth_getTransactionReceipt', [txHash]);
    if (!receipt) await new Promise(r => setTimeout(r, 150));
  }
  if (receipt && receipt.status === '0x0') {
    let reason = 'reverted';
    try {
      await rpcRaw(cfg, 'eth_call', [tx, receipt.blockNumber || 'latest']);
    } catch (e) {
      reason = String(e?.message || e);
    }
    throw new Error('customizeCube reverted: ' + reason);
  }
  return txHash;
}

function bytesToHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
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

// seed: 0x bytes32 (or any hex). slot/sourceTokenId: number|bigint. payload: Uint8Array(400).
export async function previewThumbnailSVG({ seed, slot, sourceTokenId, payload }) {
  const cfg = await loadConfig();
  const to = await thumbnailRendererAddress(cfg);
  const data = '0x' + PREVIEW_SELECTOR
    + seedWord(seed)
    + word(slot)
    + word(sourceTokenId)
    + word(128) // offset to the bytes arg (4 head words × 32)
    + word(payload.length)
    + padRight32(bytesToHex(payload));
  return decodeString(await ethCall(cfg, to, data));
}
