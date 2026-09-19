// Shared chain helpers used by both the one-shot backfill and the live watcher.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './config.js';
import { CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER, STREET_MERGED, NON_NORMIE_PAYLOAD_RECORDED, SOURCE_PAYLOAD_RECORDED } from './events.js';

// Cube events live on the CubeNFT address; the payload events on the art store.
export async function fetchLogs(client, cfg, fromBlock, toBlock) {
  const range = { fromBlock, toBlock };
  const cube = { ...range, address: cfg.cubeNft };
  const store = cfg.nonNormieStore ? { ...range, address: cfg.nonNormieStore } : null;
  const [minted, moved, customized, transfers, merged, payloadRecorded, sourcePayloadRecorded] = await Promise.all([
    client.getLogs({ ...cube, event: CUBE_MINTED }),
    client.getLogs({ ...cube, event: CUBE_MOVED }),
    client.getLogs({ ...cube, event: CUBE_CUSTOMIZED }),
    client.getLogs({ ...cube, event: TRANSFER }),
    client.getLogs({ ...cube, event: STREET_MERGED }),
    store ? client.getLogs({ ...store, event: NON_NORMIE_PAYLOAD_RECORDED }) : Promise.resolve([]),
    store ? client.getLogs({ ...store, event: SOURCE_PAYLOAD_RECORDED }) : Promise.resolve([]),
  ]);
  return { minted, moved, customized, transfers, merged, payloadRecorded, sourcePayloadRecorded };
}

// Block timestamps for the (deduped) blocks in a flat log array. Used for mintedAt AND
// every history entry's `ts`, so pass all history-bearing logs (mints + moves + rebases).
//
// Block timestamps are IMMUTABLE, so they're cached to disk — a periodic re-fold then only
// fetches timestamps for blocks it hasn't seen (was ~1600 getBlock calls EVERY run; now ~the
// handful of new event-blocks). getBlock is chunked to avoid hammering the RPC with 429s.
const BT_PATH = resolve(REPO_ROOT, process.env.INDEXER_BLOCK_TIMES_CACHE || 'data/block-times-cache.json');
let _btCache = null;
function btCache() {
  if (_btCache) return _btCache;
  _btCache = new Map();
  try { if (existsSync(BT_PATH)) { const j = JSON.parse(readFileSync(BT_PATH, 'utf8')); for (const k of Object.keys(j)) _btCache.set(k, j[k]); } } catch { /* corrupt/missing → rebuild */ }
  return _btCache;
}
function btSave() { try { const o = {}; for (const [k, v] of _btCache) o[k] = v; writeFileSync(BT_PATH, JSON.stringify(o)); } catch { /* best effort */ } }

export async function fetchBlockTimestamps(client, logs) {
  const cache = btCache();
  const blockNums = [...new Set(logs.map((l) => l.blockNumber))];
  const missing = blockNums.filter((bn) => !cache.has(String(bn)));
  if (missing.length) {
    const CHUNK = 20;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const blocks = await Promise.all(missing.slice(i, i + CHUNK).map((bn) => client.getBlock({ blockNumber: bn })));
      for (const b of blocks) cache.set(String(b.number), Number(b.timestamp));
    }
    btSave();
  }
  return new Map(blockNums.map((bn) => [bn, cache.get(String(bn))]));
}

// Partition a mixed watchEvent batch by event name.
export function groupByEvent(logs) {
  const g = { minted: [], moved: [], customized: [], transfers: [], merged: [], payloadRecorded: [], sourcePayloadRecorded: [] };
  for (const l of logs) {
    if (l.eventName === 'CubeMinted') g.minted.push(l);
    else if (l.eventName === 'CubeMoved') g.moved.push(l);
    else if (l.eventName === 'CubeCustomized') g.customized.push(l);
    else if (l.eventName === 'Transfer') g.transfers.push(l);
    else if (l.eventName === 'StreetMerged') g.merged.push(l);
    else if (l.eventName === 'NonNormiePayloadRecorded') g.payloadRecorded.push(l);
    else if (l.eventName === 'SourcePayloadRecorded') g.sourcePayloadRecorded.push(l);
  }
  return g;
}

// Build the snapshot from the fold, bake in cached Normie art (M4), write it.
// `artCache` optional — without it, records keep art:null (the viewer hydrates).
export async function buildAndWriteSnapshot(client, cfg, ws, artCache, nonNormieArtCache) {
  const snap = ws.toSnapshot(cfg);
  if (artCache) {
    const normieIds = snap.records.filter((r) => r.sourceKind === 'normie').map((r) => r.source.tokenId);
    await artCache.ensure(client, normieIds);
    for (const r of snap.records) {
      if (r.sourceKind !== 'normie') continue;
      const base = artCache.get(r.source.tokenId);
      if (!base) continue;
      // Cached pixels are agentic-neutral; apply the record's live agentic flag.
      const art = { ...base, a: r.agentic ? 1 : 0 };
      if (r.agentId) art.ai = String(r.agentId); else delete art.ai;
      r.art = art;
    }
  }
  if (nonNormieArtCache) {
    // External/CC0 cubes: bake the on-chain flattened tonal art, keyed by the
    // cube's current payloadHash (from the NonNormiePayloadRecorded fold).
    const entries = [];
    for (const r of snap.records) {
      if (r.sourceKind === 'normie') continue;
      const h = ws.payloadHashForRecord(r); // per-cube override, else source-keyed (genesis CC0)
      if (h) entries.push({ cubeId: r.cubeId, payloadHash: h });
    }
    await nonNormieArtCache.ensure(client, entries);
    for (const r of snap.records) {
      if (r.sourceKind === 'normie') continue;
      const base = nonNormieArtCache.get(ws.payloadHashForRecord(r));
      if (base) r.art = { ...base, id: r.cubeId }; // id-neutral cache -> this cube's id
    }
  }
  writeFileSync(cfg.snapshotOut, JSON.stringify(snap, null, 2) + '\n');
  // Per-cube art/lifecycle history, written alongside the overview snapshot.
  writeFileSync(cfg.historyOut, JSON.stringify(ws.toHistory(cfg), null, 2) + '\n');
  return snap;
}
