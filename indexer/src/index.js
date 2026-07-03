// Live indexer: backfill the snapshot, then keep it current by watching CubeNFT
// events and re-writing data/world-snapshot.json on each new batch. Long-running
// — leave it in a terminal (Ctrl+C to stop). No more manual re-backfills.
//
// Uses viem's watchEvent. Over an http transport it polls (eth_getFilterChanges);
// swap the transport to webSocket(ws://…) for true eth_subscribe push — the rest
// of the code is unchanged.
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import { WorldState } from './snapshot.js';
import { CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER } from './events.js';
import { fetchLogs, fetchMintTimestamps, groupByEvent, writeSnapshot } from './chain.js';

const POLL_MS = Number(process.env.INDEXER_POLL_MS || 1000);

async function main() {
  const cfg = loadConfig();
  const client = createPublicClient({ transport: http(cfg.rpcUrl), pollingInterval: POLL_MS });

  const ws = new WorldState();

  // Initial backfill.
  const latest = await client.getBlockNumber();
  const batch = await fetchLogs(client, cfg, cfg.fromBlock, latest);
  ws.setBlockTimestamps(await fetchMintTimestamps(client, batch.minted));
  ws.applyLogs(batch);
  writeSnapshot(cfg, ws);
  console.log(
    `[indexer] backfilled ${ws.count()} records @ block ${latest} → ${cfg.snapshotOut}`
  );
  console.log(`[indexer] watching CubeNFT ${cfg.cubeNft} for new events (poll ${POLL_MS}ms)… Ctrl+C to stop`);

  // Live updates. watchEvent delivers only NEW logs from the current tip forward.
  client.watchEvent({
    address: cfg.cubeNft,
    events: [CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER],
    pollingInterval: POLL_MS,
    onLogs: async (logs) => {
      try {
        const grouped = groupByEvent(logs);
        if (grouped.minted.length) {
          ws.setBlockTimestamps(await fetchMintTimestamps(client, grouped.minted));
        }
        ws.applyLogs(grouped);
        writeSnapshot(cfg, ws);
        const last = logs[logs.length - 1];
        console.log(`[indexer] +${logs.length} logs @ block ${last?.blockNumber} → ${ws.count()} records`);
      } catch (err) {
        console.error('[indexer] update failed:', err?.message || err);
      }
    },
    onError: (err) => console.error('[indexer] watch error:', err?.message || err),
  });
}

main().catch((err) => {
  console.error('[indexer] failed:', err?.message || err);
  process.exit(1);
});
