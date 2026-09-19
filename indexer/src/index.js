// Live indexer: backfill the snapshot (with baked-in Normie art), then keep it
// current by watching CubeNFT events and re-writing data/world-snapshot.json on
// each new batch. Long-running — leave it in a terminal (Ctrl+C to stop).
//
// Uses viem's watchEvent. Over an http transport it polls (eth_getFilterChanges);
// swap the transport to webSocket(ws://…) for true eth_subscribe push — the rest
// of the code is unchanged.
//
// Hardening (so a launch-time RPC hiccup can NEVER strand a move/merge):
//   1. Fold-always — applyLogs() is in-memory and cannot fail, so every delivered
//      event lands in WorldState even if the chain reads (timestamps/art) 429; only
//      the snapshot WRITE is retried. A transient error can no longer drop an event.
//   2. Periodic full re-sync — every RESYNC_MS we re-read ALL events from the deploy
//      block into a fresh fold and adopt it, so anything the watch itself misses
//      self-heals within one interval (no manual restart). Cheap: block timestamps
//      are immutable (reused across syncs) and baked art is cached.
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import { WorldState } from './snapshot.js';
import { CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER, STREET_MERGED, NON_NORMIE_PAYLOAD_RECORDED, SOURCE_PAYLOAD_RECORDED } from './events.js';
import { fetchLogs, fetchBlockTimestamps, groupByEvent, buildAndWriteSnapshot } from './chain.js';
import { NormieArtCache, NonNormieArtCache } from './art.js';

const POLL_MS = Number(process.env.INDEXER_POLL_MS || 1000);
const RESYNC_MS = Number(process.env.INDEXER_RESYNC_MS || 60000); // safety-net full re-read

// Retry a chain op through transient failures (Alchemy 429s during launch). Backs off linearly.
async function withRetry(fn, tries = 4, baseMs = 400) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) { last = err; if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1))); }
  }
  throw last;
}

// Read every event from the deploy block into a FRESH WorldState and write the snapshot.
// `seedTs` reuses already-known (immutable) block timestamps so a re-sync only fetches
// timestamps for blocks it hasn't seen. `artCache`/`nonNormieArtCache` persist, so baked
// art is a cache hit on re-syncs.
async function fullBackfill(client, cfg, artCache, nonNormieArtCache, seedTs) {
  const ws = new WorldState();
  ws.setNormiesContract(cfg.normies);
  if (seedTs) for (const [bn, t] of seedTs) ws.tsByBlock.set(String(bn), t);
  const latest = await client.getBlockNumber();
  const batch = await fetchLogs(client, cfg, cfg.fromBlock, latest);
  const evLogs = [...batch.minted, ...batch.moved, ...batch.customized];
  const uncached = evLogs.filter((l) => !ws.tsByBlock.has(String(l.blockNumber)));
  if (uncached.length) ws.setBlockTimestamps(await fetchBlockTimestamps(client, uncached));
  ws.applyLogs(batch);
  const snap = await buildAndWriteSnapshot(client, cfg, ws, artCache, nonNormieArtCache);
  return { ws, snap, latest };
}

async function main() {
  const cfg = loadConfig();
  const client = createPublicClient({ transport: http(cfg.rpcUrl), pollingInterval: POLL_MS });
  const artCache = new NormieArtCache(cfg);
  const nonNormieArtCache = new NonNormieArtCache(cfg);

  // Initial backfill (retried — a launch-time 429 must not leave the snapshot empty).
  let { ws, snap, latest } = await withRetry(() => fullBackfill(client, cfg, artCache, nonNormieArtCache));
  console.log(
    `[indexer] backfilled ${snap.count} records (art baked: ${snap.records.filter((r) => r.art).length}) ` +
    `@ block ${latest} → ${cfg.snapshotOut}`
  );
  console.log(`[indexer] watching CubeNFT ${cfg.cubeNft}${cfg.nonNormieStore ? ' + art store ' + cfg.nonNormieStore : ''} (poll ${POLL_MS}ms, re-sync ${RESYNC_MS}ms)… Ctrl+C to stop`);

  // Live fold. applyLogs() runs even if timestamps fail, so a delivered event ALWAYS lands in
  // WorldState; only the snapshot write is retried. Worst case the file is a beat late — the
  // event is never lost, and the next write (or a re-sync) flushes it.
  const onLogs = async (logs) => {
    const grouped = groupByEvent(logs);
    try {
      const need = [...grouped.minted, ...grouped.moved, ...grouped.customized];
      if (need.length) ws.setBlockTimestamps(await withRetry(() => fetchBlockTimestamps(client, need)));
    } catch (err) {
      console.error('[indexer] block timestamps failed (folding anyway):', err?.message || err);
    }
    ws.applyLogs(grouped); // in-memory, cannot fail → the event is now recorded
    try {
      const s = await withRetry(() => buildAndWriteSnapshot(client, cfg, ws, artCache, nonNormieArtCache));
      const last = logs[logs.length - 1];
      console.log(`[indexer] +${logs.length} logs @ block ${last?.blockNumber} → ${s.count} records`);
    } catch (err) {
      console.error('[indexer] snapshot write failed (kept in memory; next event or re-sync writes it):', err?.message || err);
    }
  };
  const onError = (err) => console.error('[indexer] watch error:', err?.message || err);

  // Cube lifecycle events live on the token; art-payload events on the store.
  client.watchEvent({
    address: cfg.cubeNft,
    events: [CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER, STREET_MERGED],
    pollingInterval: POLL_MS, onLogs, onError,
  });
  if (cfg.nonNormieStore) {
    client.watchEvent({
      address: cfg.nonNormieStore,
      events: [NON_NORMIE_PAYLOAD_RECORDED, SOURCE_PAYLOAD_RECORDED],
      pollingInterval: POLL_MS, onLogs, onError,
    });
  }

  // Safety net: re-read all events and adopt a fresh fold. The watch keeps its own cursor and
  // continues past `latest` on the new state, so every block is covered by either the re-sync
  // (<= latest) or the watch (> latest) — no gap. Self-heals any watch-level miss.
  setInterval(async () => {
    try {
      const fresh = await withRetry(() => fullBackfill(client, cfg, artCache, nonNormieArtCache, ws.tsByBlock));
      ws = fresh.ws; // onLogs closes over `ws`, so it continues from the corrected base
    } catch (err) {
      console.error('[indexer] re-sync failed (will retry next interval):', err?.message || err);
    }
  }, RESYNC_MS);
}

main().catch((err) => {
  console.error('[indexer] failed:', err?.message || err);
  process.exit(1);
});
