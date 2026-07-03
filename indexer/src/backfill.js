// One-shot backfill: read all historical CubeNFT logs, fold into a world
// snapshot, write data/world-snapshot.json, exit. For a live snapshot that stays
// current, use `npm start` (src/index.js) instead.
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import { WorldState } from './snapshot.js';
import { fetchLogs, fetchMintTimestamps, writeSnapshot } from './chain.js';

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
  ws.setBlockTimestamps(await fetchMintTimestamps(client, batch.minted));
  ws.applyLogs(batch);
  writeSnapshot(cfg, ws);
  console.log(`[indexer] wrote ${ws.count()} cube records → ${cfg.snapshotOut}`);
}

main().catch((err) => {
  console.error('[indexer] backfill failed:', err?.message || err);
  process.exit(1);
});
