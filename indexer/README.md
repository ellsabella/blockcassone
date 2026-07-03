# Big Cube indexer

Follows the CubeNFT contract's events and serves a cached world snapshot so the
viewer stops re-scanning the chain (~3 eth_calls/cube, ~12k at 4096) on every
load. See the design spec in `../BIG_CUBE_WORLD_PLAN.md` → "Indexer design".

Runs against whatever `../data/chain-config.json` points at — the local anvil
fork for dev, a real RPC/VPS later. Same code either way.

## Milestone 1 — backfill → snapshot (this)

```bash
cd indexer
npm install
npm run backfill    # reads chain-config.json, writes ../data/world-snapshot.json
```

Env overrides: `INDEXER_RPC_URL`, `INDEXER_FROM_BLOCK` (skip the pre-deploy range
on a big/mainnet fork), `INDEXER_SNAPSHOT_OUT`.

The snapshot `records[]` mirror `viewer/chain-cubes.js` `recordFromChain`, so the
viewer can read it as a drop-in for `loadChainMintRecords()` (milestone 2).

## Roadmap
- **M1** backfill → `world-snapshot.json` *(here)*
- **M2** viewer reads the snapshot behind a flag; confirm HUD RPC drops
- **M3** live updates via WebSocket `eth_subscribe`
- **M4** art cache (flattened payload / normie bytes fetched once per id)
- **M5** VPS + reorg-safety + CDN
