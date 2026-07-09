// Indexer config — reads the same data/chain-config.json the viewer uses, so it
// points at whatever CubeNFT was last deployed (local fork or, later, mainnet).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..'); // indexer/src -> repo root

export function loadConfig() {
  // INDEXER_CHAIN_CONFIG lets us point at an alternate config (e.g. a genesis
  // deploy on a side anvil) without disturbing the viewer's data/chain-config.json.
  const path = resolve(REPO_ROOT, process.env.INDEXER_CHAIN_CONFIG || 'data/chain-config.json');
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${path} — deploy the contracts first (${err.message})`);
  }
  const cubeNft = raw.cubeNft;
  if (!cubeNft) throw new Error('chain-config.json has no "cubeNft" — deploy the contracts first');

  return {
    rpcUrl: process.env.INDEXER_RPC_URL || raw.rpcUrl || 'http://127.0.0.1:8545',
    chainId: Number(raw.chainId || 1),
    cubeNft,
    cubeMintController: raw.cubeMintController || null,
    normieStorage: raw.normieStorage || null,
    nonNormieStore: raw.nonNormieStore || null,   // NonNormieArtStore (external/CC0 tonal art)
    // Backfill window. Default 0n; override for big/mainnet forks to skip the
    // pre-deploy range (INDEXER_FROM_BLOCK=<deploy block>).
    fromBlock: process.env.INDEXER_FROM_BLOCK != null ? BigInt(process.env.INDEXER_FROM_BLOCK) : 0n,
    snapshotOut: resolve(REPO_ROOT, process.env.INDEXER_SNAPSHOT_OUT || 'data/world-snapshot.json'),
    // Per-cube art/lifecycle history (mint origin + every re-base + moves), served as a
    // separate lean file so the overview snapshot stays small; the UI fetches it for a
    // cube's detail view.
    historyOut: resolve(REPO_ROOT, process.env.INDEXER_HISTORY_OUT || 'data/cube-history.json'),
  };
}
