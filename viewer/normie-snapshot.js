import { NORMIES_CONTRACT } from './wallet-nfts.js';

let snapshotCache = null;
let snapshotFetch = null;

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSnapshot(raw) {
  const holders = Array.isArray(raw?.holders) ? raw.holders : [];
  const byWallet = new Map();
  for (const row of holders) {
    const wallet = normalizeAddress(row.wallet || row.address || row.owner);
    if (!wallet) continue;
    const normies = Array.isArray(row.normies || row.tokenIds || row.tokens)
      ? (row.normies || row.tokenIds || row.tokens)
      : [];
    const ids = normies
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id >= 0)
      .sort((a, b) => a - b);
    if (ids.length) byWallet.set(wallet, ids);
  }
  return {
    schema: raw?.schema || 'blockcassone.normie-snapshot.v1',
    snapshotBlock: raw?.snapshotBlock ?? null,
    chainId: Number(raw?.chainId || 1),
    normiesContract: normalizeAddress(raw?.normiesContract || NORMIES_CONTRACT),
    byWallet,
  };
}

export async function loadNormieSnapshot() {
  if (snapshotCache) return snapshotCache;
  if (!snapshotFetch) {
    snapshotFetch = fetch('/data/normie-snapshot.json')
      .then(res => res.ok ? res.json() : null)
      .then(raw => normalizeSnapshot(raw || {}))
      .catch(() => normalizeSnapshot({}));
  }
  snapshotCache = await snapshotFetch;
  return snapshotCache;
}

export async function snapshotNormieIdsForWallet(walletAddress) {
  const snapshot = await loadNormieSnapshot();
  return (snapshot.byWallet.get(normalizeAddress(walletAddress)) || []).slice();
}

export async function snapshotAllNormieIds() {
  const snapshot = await loadNormieSnapshot();
  const ids = [];
  for (const walletIds of snapshot.byWallet.values()) ids.push(...walletIds);
  return ids.sort((a, b) => a - b);
}

export function snapshotHasEntries() {
  return Boolean(snapshotCache && snapshotCache.byWallet.size > 0);
}
