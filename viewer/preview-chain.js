// Authoritative on-chain SVG previews for the Update Cube page.
// Calls CubeThumbnailRendererV1.previewThumbnailSVG(seed, slot, sourceTokenId,
// tonalPayload) via eth_call (no state change, free) and returns the SVG string —
// byte-identical to what re-basing onto that art would store. The thumbnail
// renderer address is derived from the V2 `renderer` in chain-config.json.

import { loadChainMintRecords } from './chain-cubes.js';

const THUMBNAIL_RENDERER_SELECTOR = 'ad125d79'; // thumbnailRenderer()
const PREVIEW_SELECTOR = 'f3d3c20b'; // previewThumbnailSVG(bytes32,uint32,uint256,bytes)
const THUMBNAIL_SVG_SELECTOR = '1df76ecc'; // thumbnailSVG(uint256)

let configPromise = null;
let thumbAddrPromise = null;

async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch('/data/chain-config.json')
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
