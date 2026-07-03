// Shared chain helpers used by both the one-shot backfill and the live watcher.
import { writeFileSync } from 'node:fs';
import { CUBE_MINTED, CUBE_MOVED, CUBE_CUSTOMIZED, TRANSFER } from './events.js';

// All four v1 events live on the CubeNFT address.
export async function fetchLogs(client, cfg, fromBlock, toBlock) {
  const opts = { address: cfg.cubeNft, fromBlock, toBlock };
  const [minted, moved, customized, transfers] = await Promise.all([
    client.getLogs({ ...opts, event: CUBE_MINTED }),
    client.getLogs({ ...opts, event: CUBE_MOVED }),
    client.getLogs({ ...opts, event: CUBE_CUSTOMIZED }),
    client.getLogs({ ...opts, event: TRANSFER }),
  ]);
  return { minted, moved, customized, transfers };
}

// Block timestamps for the (deduped) blocks that carried mints → mintedAt.
export async function fetchMintTimestamps(client, mintedLogs) {
  const blockNums = [...new Set(mintedLogs.map((l) => l.blockNumber))];
  const blocks = await Promise.all(blockNums.map((bn) => client.getBlock({ blockNumber: bn })));
  return new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));
}

// Partition a mixed watchEvent batch by event name.
export function groupByEvent(logs) {
  const g = { minted: [], moved: [], customized: [], transfers: [] };
  for (const l of logs) {
    if (l.eventName === 'CubeMinted') g.minted.push(l);
    else if (l.eventName === 'CubeMoved') g.moved.push(l);
    else if (l.eventName === 'CubeCustomized') g.customized.push(l);
    else if (l.eventName === 'Transfer') g.transfers.push(l);
  }
  return g;
}

export function writeSnapshot(cfg, worldState) {
  writeFileSync(cfg.snapshotOut, JSON.stringify(worldState.toSnapshot(cfg), null, 2) + '\n');
}
