// One-shot backfill: read all historical CubeNFT logs, fold into a world
// snapshot (with baked-in Normie art), write data/world-snapshot.json, exit. For
// a live snapshot that stays current, use `npm start` (src/index.js) instead.
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import { WorldState } from './snapshot.js';
import { fetchLogs, fetchBlockTimestamps, buildAndWriteSnapshot } from './chain.js';
import { NormieArtCache, NonNormieArtCache } from './art.js';
import { prerenderThumbnails } from './thumbs.js';

async function main() {
  const cfg = loadConfig();
  const client = createPublicClient({ transport: http(cfg.rpcUrl) });

  const latest = await client.getBlockNumber();
  console.log(`[indexer] backfill CubeNFT ${cfg.cubeNft}`);
  console.log(`[indexer] rpc=${cfg.rpcUrl} chainId=${cfg.chainId} blocks ${cfg.fromBlock}..${latest}`);

  const batch = await fetchLogs(client, cfg, cfg.fromBlock, latest);
  console.log(
    `[indexer] logs: minted=${batch.minted.length} moved=${batch.moved.length} ` +
    `customized=${batch.customized.length} transfers=${batch.transfers.length}`
  );

  const ws = new WorldState();
  ws.setBlockTimestamps(await fetchBlockTimestamps(client, [...batch.minted, ...batch.moved, ...batch.customized]));
  ws.applyLogs(batch);

  const artCache = new NormieArtCache(cfg);
  const nonNormieArtCache = new NonNormieArtCache(cfg);
  const snap = await buildAndWriteSnapshot(client, cfg, ws, artCache, nonNormieArtCache);
  const withArt = snap.records.filter((r) => r.art).length;
  console.log(`[indexer] wrote ${snap.count} cube records (art baked: ${withArt}) → ${cfg.snapshotOut}`);

  // Bake thumbnails for any cube without one. Invalidate CUSTOMIZED cubes (new
  // art) AND MOVED cubes (colour is slot-derived — a move changes the render).
  const staleIds = [...batch.customized, ...batch.moved]
    .map((l) => Number(l?.args?.cubeId ?? l?.args?.tokenId ?? 0))
    .filter((n) => Number.isInteger(n) && n > 0);
  await prerenderThumbnails(cfg, snap.records, staleIds);
}

main().catch((err) => {
  console.error('[indexer] backfill failed:', err?.message || err);
  process.exit(1);
});
