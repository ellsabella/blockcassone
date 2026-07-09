// Shared chain helpers used by both the one-shot backfill and the live watcher.
import { writeFileSync } from 'node:fs';
import { CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER, NON_NORMIE_PAYLOAD_RECORDED, SOURCE_PAYLOAD_RECORDED } from './events.js';

// Cube events live on the CubeNFT address; the payload events on the art store.
export async function fetchLogs(client, cfg, fromBlock, toBlock) {
  const range = { fromBlock, toBlock };
  const cube = { ...range, address: cfg.cubeNft };
  const store = cfg.nonNormieStore ? { ...range, address: cfg.nonNormieStore } : null;
  const [minted, moved, customized, transfers, payloadRecorded, sourcePayloadRecorded] = await Promise.all([
    client.getLogs({ ...cube, event: CUBE_MINTED }),
    client.getLogs({ ...cube, event: CUBE_MOVED }),
    client.getLogs({ ...cube, event: CUBE_CUSTOMIZED }),
    client.getLogs({ ...cube, event: TRANSFER }),
    store ? client.getLogs({ ...store, event: NON_NORMIE_PAYLOAD_RECORDED }) : Promise.resolve([]),
    store ? client.getLogs({ ...store, event: SOURCE_PAYLOAD_RECORDED }) : Promise.resolve([]),
  ]);
  return { minted, moved, customized, transfers, payloadRecorded, sourcePayloadRecorded };
}

// Block timestamps for the (deduped) blocks in a flat log array. Used for mintedAt AND
// every history entry's `ts`, so pass all history-bearing logs (mints + moves + rebases).
export async function fetchBlockTimestamps(client, logs) {
  const blockNums = [...new Set(logs.map((l) => l.blockNumber))];
  const blocks = await Promise.all(blockNums.map((bn) => client.getBlock({ blockNumber: bn })));
  return new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));
}

// Partition a mixed watchEvent batch by event name.
export function groupByEvent(logs) {
  const g = { minted: [], moved: [], customized: [], transfers: [], payloadRecorded: [], sourcePayloadRecorded: [] };
  for (const l of logs) {
    if (l.eventName === 'CubeMinted') g.minted.push(l);
    else if (l.eventName === 'CubeMoved') g.moved.push(l);
    else if (l.eventName === 'CubeCustomized') g.customized.push(l);
    else if (l.eventName === 'Transfer') g.transfers.push(l);
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
