// One-time Normie art cache. Normie image bytes are immutable per tokenId, so we
// fetch rawImageData once from NormiesStorage, compact it with the viewer's EXACT
// codec (single source of truth — no format drift), and cache to disk. Baked into
// the snapshot so the viewer needs zero RPC for art.
//
// (Longer term this codec should live in core/ and be imported by both sides.)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './config.js';
import { compactNormieArtFromRaw } from '../../viewer/art-snapshot.js';

// Raw selector the viewer uses (viewer/chain-cubes.js SELECTORS.rawImageData).
// NB: this is NOT keccak("rawImageData(uint256)") (0x02cdab14) — the on-chain
// function has a different signature; we call the raw selector like the viewer.
const RAW_IMAGE_SELECTOR = '0x6985bf3c';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');

// Decode an ABI-encoded `bytes` return: [offset][length][data…].
function decodeAbiBytes(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (clean.length < 128) return new Uint8Array();
  const offset = Number(BigInt('0x' + clean.slice(0, 64)));
  const lenStart = offset * 2;
  const len = Number(BigInt('0x' + clean.slice(lenStart, lenStart + 64)));
  const dataHex = clean.slice(lenStart + 64, lenStart + 64 + len * 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2) || '00', 16);
  return out;
}

export class NormieArtCache {
  constructor(cfg) {
    this.cfg = cfg;
    this.path = resolve(REPO_ROOT, process.env.INDEXER_ART_CACHE || 'data/normie-art-cache.json');
    this.map = new Map(); // normieId(str) -> compact pixel art (agentic-neutral: a=0)
    this._load();
  }

  _load() {
    try {
      if (!existsSync(this.path)) return;
      const j = JSON.parse(readFileSync(this.path, 'utf8'));
      // Drop the cache if it was built against a different NormiesStorage.
      if (j?.normieStorage && this.cfg.normieStorage &&
          String(j.normieStorage).toLowerCase() !== String(this.cfg.normieStorage).toLowerCase()) return;
      if (j?.art) for (const [k, v] of Object.entries(j.art)) this.map.set(String(k), v);
    } catch { /* start empty */ }
  }

  _save() {
    const art = {};
    for (const [k, v] of this.map) art[k] = v;
    writeFileSync(this.path, JSON.stringify({ normieStorage: this.cfg.normieStorage, art }) + '\n');
  }

  get(normieId) { return this.map.get(String(normieId)) || null; }

  // Fetch + cache any not-yet-seen normie ids. Immutable, so only fetched once.
  async ensure(client, normieIds) {
    const missing = [...new Set(normieIds.map(String))].filter(id => /^\d+$/.test(id) && !this.map.has(id));
    if (!missing.length) return 0;
    for (const id of missing) {
      try {
        const { data } = await client.call({
          to: this.cfg.normieStorage,
          data: RAW_IMAGE_SELECTOR + word(id),
        });
        const raw = decodeAbiBytes(data);
        // Cache agentic-neutral pixels; the live agentic flag is applied per-record
        // at snapshot time (agentic can change; the pixels can't).
        const art = compactNormieArtFromRaw({ id: Number(id), raw, traits: null, agentic: false, agentId: '' });
        if (art) this.map.set(id, art);
      } catch (err) {
        console.warn(`[indexer] art fetch failed for normie ${id}:`, err?.message || err);
      }
    }
    this._save();
    return missing.length;
  }
}
