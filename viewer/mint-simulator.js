import {
  NORMIES_CONTRACT,
  getWalletState,
  nftKey,
} from './wallet-nfts.js';
import { compactNormieArt } from './art-snapshot.js';
import { loadChainMintRecords } from './chain-cubes.js';
import { fetchWorldSnapshot } from './snapshot-fetch.js';
import { snapshotAllNormieIds, snapshotHasEntries, snapshotNormieIdsForWallet } from './normie-snapshot.js';
import {
  fetchNormiePixels,
  fetchNormieOriginalPixels,
  fetchNormieCanvasPixels,
  fetchNormieTraits,
} from './normies-api.js';
import { hydrateNormieArtSnapshot } from './normies-manager.js';
import { hashInt as hash1 } from './tree-walker.js';

let minted = [];
let mintedNormieIds = new Set();
let occupiedSlots = new Set();
let cubeBySlot = new Map();
let onMintReady = null;
let mintStateSource = 'dev';

// Genesis source collections + the locked allocation (matches
// MultiSourceGenesisMinter on-chain: Normie 41 / Runners 22 / Skulls 16 / Pepe 10
// / Nouns 8 / Kevin 3, over the 4096 supply). The public phase draws a weighted mix
// across these; the allowlist phase stays Normie-only (only Normie has a holder
// claim). CC0 collections are 'external' cubes whose art is the real flattened tonal
// payload (reused from the baked world snapshot's CC0 samples).
const NORMIE_COLLECTION = { key: 'normie', name: 'Normies', contract: NORMIES_CONTRACT, cap: 1679, model: 'normie' };
const CC0_COLLECTIONS = [
  { key: 'runner', name: 'Chain Runners', contract: '0x97597002980134bea46250aa0510c9b90d87a587', cap: 901, model: 'external' },
  { key: 'skull', name: '1337 skulls', contract: '0x9251dec8df720c2adf3b6f46d968107cbbadf4d4', cap: 655, model: 'external' },
  { key: 'pepe', name: 'Baby Pepes', contract: '0x9131d8c7a411d90c6b164d296440701a0e5b3178', cap: 410, model: 'external' },
  { key: 'noun', name: 'Nouns', contract: '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03', cap: 328, model: 'external' },
  { key: 'kevin', name: 'OnChainKevin', contract: '0x17b19c70bfca098da3f2efef6e7fa3a1c42f5429', cap: 123, model: 'external' },
];
const GENESIS_COLLECTIONS = [NORMIE_COLLECTION, ...CC0_COLLECTIONS];
// Lower-cased contracts of the six genesis source collections — the ONLY
// collections the Update picker hides (their tokens are mint-pool art).
export const GENESIS_SOURCE_CONTRACTS = Object.freeze(GENESIS_COLLECTIONS.map(c => String(c.contract).toLowerCase()));

// Real flattened CC0 art, grouped by source contract, loaded once from the baked
// world snapshot (data/world-snapshot.json). The sim cycles a collection's samples
// so simulated CC0 cubes render the true on-chain aesthetic, not a placeholder.
let cc0PoolCache = null;
async function loadCC0ArtPool() {
  if (cc0PoolCache) return cc0PoolCache;
  const pool = {};
  try {
    const snap = await fetchWorldSnapshot();
    for (const r of (snap?.records || [])) {
      if (r.sourceKind !== 'external' || !r.art) continue;
      const c = String(r.source?.contract || '').toLowerCase();
      (pool[c] = pool[c] || []).push({ tokenId: r.source.tokenId, art: r.art });
    }
  } catch { /* no snapshot -> CC0 collections simply won't be drawable */ }
  cc0PoolCache = pool;
  return cc0PoolCache;
}

function collectionMintedCounts() {
  const counts = {};
  for (const c of GENESIS_COLLECTIONS) counts[c.key] = 0;
  for (const cube of minted) {
    const contract = String(cube.nft?.contract || '').toLowerCase();
    const col = GENESIS_COLLECTIONS.find(c => c.contract === contract)
      || (cube.sourceKind === 'normie' ? NORMIE_COLLECTION : null);
    if (col) counts[col.key]++;
  }
  return counts;
}

function notify() {
  if (onMintReady) onMintReady();
}

export function setMintDataReadyCallback(cb) {
  onMintReady = cb;
}

function sourceKeyFromRecord(record) {
  const source = record.source || {};
  if (record.sourceKind === 'cc0') {
    return `cc0:${Number(source.chainId || 0)}:${String(source.contract || '').toLowerCase()}:${source.tokenId}`;
  }
  return `${source.chain}:${String(source.contract || '').toLowerCase()}:${source.tokenId}`;
}

function cubeFromRecord(record) {
  const source = record.source || {};
  const sourceKind = record.sourceKind === 'normie' ? 'normie' : (record.sourceKind === 'cc0' ? 'cc0' : 'external');
  // Collection name: from the record if it carries one, else resolved from the
  // genesis collection table by source contract — so snapshot-loaded cubes label
  // "1337 skulls #6173" / "Chain Runners #…" instead of a bare "Source #…".
  const contractLc = String(source.contract || '').toLowerCase();
  const collectionName = record.cc0?.projectName
    || GENESIS_COLLECTIONS.find(c => c.contract.toLowerCase() === contractLc)?.name
    || '';
  const nft = {
    chain: source.chain,
    chainId: Number(source.chainId || 0),
    contract: contractLc,
    tokenId: String(source.tokenId || ''),
    name: record.cc0?.projectName ? `${record.cc0.projectName} Seed #${source.tokenId || '?'}` : `${sourceKind === 'normie' ? 'Normie' : (collectionName || 'Source')} #${source.tokenId || '?'}`,
    collection: collectionName,
    imageUrl: '',
    isNormie: sourceKind === 'normie',
    isCC0Seed: sourceKind === 'cc0',
    normieId: sourceKind === 'normie' ? Number(source.tokenId) : null,
    cc0ProjectId: record.cc0?.projectId || '',
    cc0ProjectName: record.cc0?.projectName || collectionName,
    cc0License: record.cc0?.license || '',
    cc0Provenance: record.cc0?.provenance || '',
    isSvgArt: false,
    agentic: Boolean(record.agentic),
    agentId: record.agentId ? String(record.agentId) : '',
    agentBinding: null,
    agentBindingLoaded: Boolean(record.agentic),
    art: record.art || null,
  };

  return {
    cubeId: Number(record.cubeId),
    slot: Number(record.slot),
    wallet: String(record.wallet || '').toLowerCase(),
    nft,
    sourceKey: sourceKeyFromRecord(record),
    sourceKind,
    seed: record.seed || null, // on-chain cube seed (real mints only) for edge-point parity
  };
}

function rebuildIndexes() {
  mintedNormieIds = new Set();
  occupiedSlots = new Set();
  cubeBySlot = new Map();
  for (const cube of minted) {
    occupiedSlots.add(cube.slot);
    cubeBySlot.set(cube.slot, cube);
    if (cube.sourceKind === 'normie' && cube.nft.normieId !== null && cube.nft.normieId !== undefined) {
      mintedNormieIds.add(cube.nft.normieId);
    }
  }
}

const _hydratedNormieArtIds = new Set(); // normie art is immutable per id — hydrate once, ever

function setMintedFromRecords(records) {
  minted = (records || [])
    .map(cubeFromRecord)
    .filter(cube => Number.isInteger(cube.cubeId) && Number.isInteger(cube.slot))
    .sort((a, b) => a.cubeId - b.cubeId);
  for (const cube of minted) {
    if (cube.nft?.isNormie && cube.nft.art?.k === 'n') {
      const id = cube.nft.normieId;
      if (id !== null && id !== undefined) {
        if (_hydratedNormieArtIds.has(id)) continue; // skip re-unpacking 4,800 bits per cube on every reload
        _hydratedNormieArtIds.add(id);
      }
      hydrateNormieArtSnapshot(cube.nft.art);
    }
  }
  rebuildIndexes();
}

async function fetchMintState() {
  const res = await fetch('/api/dev-mints');
  if (!res.ok) throw new Error(`dev mint state fetch failed ${res.status}`);
  return res.json();
}

async function appendMintRecords(records) {
  const res = await fetch('/api/dev-mints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mints: records }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`dev mint save failed ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

async function clearMintRecords() {
  const res = await fetch('/api/dev-mints', { method: 'DELETE' });
  if (!res.ok) throw new Error(`dev mint reset failed ${res.status}`);
  return res.json();
}

export async function loadMintSimulation() {
  const chainState = await loadChainMintRecords();
  if (chainState.enabled) {
    mintStateSource = 'chain';
    setMintedFromRecords(chainState.records || []);
    notify();
    return getMintedCubes();
  }

  mintStateSource = 'dev';
  const state = await fetchMintState();
  setMintedFromRecords(state.mints || []);
  notify();
  return getMintedCubes();
}

export async function resetMintSimulation() {
  const state = await clearMintRecords();
  setMintedFromRecords(state.mints || []);
  notify();
}

export function clearMintSimulationSilent() {
  setMintedFromRecords([]);
}

export function getMintedCubes() {
  return minted.slice();
}

// Non-copying accessors for per-frame hot paths — treat as READ-ONLY.
export function mintedCount() {
  return minted.length;
}

export function mintedStateSource() {
  return mintStateSource;
}

export function getMintedCubeForSlot(slot) {
  // O(1): called per motif per rebuild (dim policy, category checks) — a linear
  // find here made rebuilds O(minted²) at scale.
  return cubeBySlot.get(slot) || null;
}

export function isMintedSlot(slot) {
  return occupiedSlots.has(slot);
}

export function mintSimulationLoaded() {
  return minted.length > 0;
}

export function sourceNftForSlot(slot) {
  return getMintedCubeForSlot(slot)?.nft || null;
}

// Plot allocation — a faithful JS port of GenesisMinterBase._allocateSlot so the sim
// clusters cubes exactly like the on-chain mint: a new wallet anchors the lowest street
// with no mints yet (spreading wallets across the world); a wallet packs up to
// MAX_PER_WALLET_PER_STREET plots per street then spills forward to the next (a
// contiguous run); once every street is seeded it wraps and backfills the frontier. So
// a street ends up shared by ~2 wallets and no one can solo-fill (hence merge needs
// consolidation). State is rebuilt from the persisted mints each batch.
const PLOTS_PER_STREET = 8;
const MAX_PER_WALLET_PER_STREET = 5; // matches the on-chain constant

function makeAllocator(worldSize) {
  const totalStreets = Math.ceil(worldSize / PLOTS_PER_STREET);
  const streetFill = new Map();
  const walletStreet = new Map();
  const walletCount = new Map();

  const capOf = (street) => {
    const used = street * PLOTS_PER_STREET;
    if (used >= worldSize) return 0;
    const remaining = worldSize - used;
    return remaining >= PLOTS_PER_STREET ? PLOTS_PER_STREET : remaining;
  };

  // Rebuild street fill + per-wallet pointers from the already-minted cubes.
  const byWalletMaxStreet = new Map();
  for (const cube of minted) {
    const s = Math.floor(cube.slot / PLOTS_PER_STREET);
    streetFill.set(s, (streetFill.get(s) || 0) + 1);
    const w = String(cube.wallet || '').toLowerCase();
    if (!byWalletMaxStreet.has(w) || s > byWalletMaxStreet.get(w)) byWalletMaxStreet.set(w, s);
  }
  for (const [w, maxStreet] of byWalletMaxStreet) {
    walletStreet.set(w, maxStreet);
    const cnt = minted.filter(c => String(c.wallet || '').toLowerCase() === w
      && Math.floor(c.slot / PLOTS_PER_STREET) === maxStreet).length;
    walletCount.set(w, cnt);
  }

  let seedCursor = 0;
  while (seedCursor < totalStreets && (streetFill.get(seedCursor) || 0) > 0) seedCursor++;
  let frontier = 0;
  while (frontier < totalStreets && (streetFill.get(frontier) || 0) >= capOf(frontier)) frontier++;

  function newWalletHome() {
    while (seedCursor < totalStreets && (streetFill.get(seedCursor) || 0) > 0) seedCursor++;
    return seedCursor < totalStreets ? seedCursor : frontier;
  }

  return {
    allocate(wallet) {
      const w = String(wallet || '').toLowerCase();
      let s;
      let cnt;
      if (!walletStreet.has(w)) {
        s = newWalletHome();
        cnt = 0;
      } else {
        s = walletStreet.get(w);
        cnt = walletCount.get(w);
        if (cnt >= MAX_PER_WALLET_PER_STREET) { s += 1; cnt = 0; }
      }
      while (s < totalStreets && (streetFill.get(s) || 0) >= capOf(s)) { s += 1; cnt = 0; }
      if (s >= totalStreets) return null; // no vacant plot for this wallet

      const fill = streetFill.get(s) || 0;
      const slot = s * PLOTS_PER_STREET + fill;
      streetFill.set(s, fill + 1);
      walletStreet.set(w, s);
      walletCount.set(w, cnt + 1);
      while (frontier < totalStreets && (streetFill.get(frontier) || 0) >= capOf(frontier)) frontier++;
      return slot;
    },
  };
}

// Synthetic minting wallets for the multi-wallet preview: index 0 = the loaded wallet,
// the rest are deterministic address-like stand-ins so the spread/street-sharing is
// visible without loading many real wallets.
function syntheticWallet(i) {
  if (i === 0) return null; // caller substitutes the loaded address
  const h = hashText(`sim-wallet:${i}`).toString(16).padStart(8, '0');
  return `0x${h.repeat(5)}`.slice(0, 42);
}

function normieSourceFromId(id) {
  return {
    chain: 'ethereum',
    chainId: 1,
    contract: NORMIES_CONTRACT,
    tokenId: String(id),
    name: `Normie #${id}`,
    collection: 'Normies',
    imageUrl: '',
    animationUrl: '',
    unsupportedMedia: false,
    isNormie: true,
    normieId: id,
    isSvgArt: false,
    agentic: false,
    agentId: '',
  };
}

function hashText(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function rankedNormieSources(ids, seedText) {
  const seed = hashText(seedText);
  return ids
    .filter(id => Number.isInteger(id) && !mintedNormieIds.has(id))
    .map(id => ({
      id,
      rank: hash1(seed, id, mintedNormieIds.size),
    }))
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
    .map(row => normieSourceFromId(row.id));
}

async function allowlistNormieSources(wallet) {
  const snapshotIds = await snapshotNormieIdsForWallet(wallet.address);
  const ids = snapshotIds.length || snapshotHasEntries()
    ? snapshotIds
    : wallet.normies.map(nft => nft.normieId);
  return rankedNormieSources(ids, `allowlist:${wallet.address || ''}`);
}

async function publicNormieSources() {
  const snapshotIds = await snapshotAllNormieIds();
  return rankedNormieSources(snapshotIds, 'public:normies');
}

function cc0SourceFrom(col, sample) {
  return {
    chain: 'ethereum',
    chainId: 1,
    contract: col.contract,
    tokenId: String(sample.tokenId),
    name: `${col.name} #${sample.tokenId}`,
    collection: col.name,
    imageUrl: '',
    animationUrl: '',
    unsupportedMedia: false,
    isNormie: false,
    isCC0Seed: false,
    normieId: null,
    agentic: false,
    agentId: '',
    art: sample.art,
    sourceKey: `ethereum:${col.contract}:${sample.tokenId}`,
    sourceKind: 'external',
  };
}

// Public phase: draw `count` sources across all genesis collections, weighted by each
// collection's REMAINING allocation (cap - already minted), exactly like the on-chain
// weighted pull — so a full mint lands on the allocation and each collection sells out
// at its cap. Normie picks pull the next ranked snapshot Normie; CC0 picks cycle that
// collection's real flattened art samples.
async function publicMultiSourceSources(count) {
  const pool = await loadCC0ArtPool();
  const rankedNormies = await publicNormieSources();
  const batchCounts = collectionMintedCounts();
  const ccCursor = {};
  let normieCursor = 0;
  const out = [];

  for (let i = 0; i < count; i++) {
    const remaining = GENESIS_COLLECTIONS.map((c) => {
      const rem = Math.max(0, c.cap - (batchCounts[c.key] || 0));
      if (rem === 0) return 0;
      if (c.model === 'normie') return normieCursor < rankedNormies.length ? rem : 0;
      return (pool[c.contract] || []).length > 0 ? rem : 0;
    });
    const total = remaining.reduce((a, b) => a + b, 0);
    if (total === 0) break;

    const r = Math.floor(hash1(hashText(`public:${minted.length}:${i}`), i, total) * total) % total;
    let acc = 0;
    let pick = 0;
    for (let k = 0; k < GENESIS_COLLECTIONS.length; k++) {
      if (r < acc + remaining[k]) { pick = k; break; }
      acc += remaining[k];
    }
    const col = GENESIS_COLLECTIONS[pick];

    if (col.model === 'normie') {
      out.push(rankedNormies[normieCursor++]);
    } else {
      const samples = pool[col.contract];
      const sample = samples[(ccCursor[col.key] || 0) % samples.length];
      ccCursor[col.key] = (ccCursor[col.key] || 0) + 1;
      out.push(cc0SourceFrom(col, sample));
    }
    batchCounts[col.key] = (batchCounts[col.key] || 0) + 1;
  }
  return out;
}

async function compactArtForMint(nft) {
  if (nft.isNormie) {
    const id = Number(nft.normieId);
    const [current, original, canvas, traits] = await Promise.all([
      fetchNormiePixels(id),
      fetchNormieOriginalPixels(id),
      fetchNormieCanvasPixels(id),
      fetchNormieTraits(id).catch(() => null),
    ]);
    return compactNormieArt({
      id,
      current,
      original,
      canvas,
      traits,
      agentic: nft.agentic,
      agentId: nft.agentId,
    });
  }
  return nft.art || null;
}

async function recordForMint(nft, slot, walletAddress) {
  // CC0 genesis cubes are external-sourced and carry their pre-flattened tonal art.
  if (!nft.isNormie) {
    return {
      slot,
      wallet: walletAddress,
      sourceKind: 'external',
      source: {
        chain: nft.chain || 'ethereum',
        chainId: nft.chainId || 1,
        contract: nft.contract,
        tokenId: String(nft.tokenId),
      },
      cc0: null,
      agentic: false,
      agentId: '',
      art: nft.art || null,
    };
  }
  return {
    slot,
    wallet: walletAddress,
    sourceKind: 'normie',
    source: {
      chain: nft.chain,
      chainId: nft.chainId || (nft.chain === 'ethereum' ? 1 : 0),
      contract: nft.contract,
      tokenId: String(nft.tokenId),
    },
    cc0: null,
    agentic: Boolean(nft.agentic),
    agentId: nft.agentId ? String(nft.agentId) : '',
    art: await compactArtForMint(nft),
  };
}

export async function simulateMintBatch(count, allSlots, options = {}) {
  const wallet = getWalletState();
  if (!wallet.loaded) throw new Error('Load wallet NFTs before minting');
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  if (requested <= 0) return [];

  const phase = options.phase === 'public' ? 'public' : 'allowlist';

  // Public = weighted multi-collection draw (already sized to `requested`); allowlist =
  // "mint your snapshot Normies" (Normie-only, capped by the wallet's remaining ones).
  let sources;
  if (phase === 'public') {
    sources = await publicMultiSourceSources(requested);
  } else {
    const availableSources = await allowlistNormieSources(wallet);
    if (requested > availableSources.length) {
      const noun = availableSources.length === 1 ? 'cube' : 'cubes';
      throw new Error(
        `Allowlist mint limit is ${availableSources.length} remaining Normie ${noun} for this wallet`
      );
    }
    sources = availableSources.slice(0, requested);
  }

  // Place plots with the real on-chain allocator. Public phase may spread across
  // several synthetic minting wallets (index 0 = the loaded wallet) so the world-spread
  // + street-sharing is visible; allowlist stays the single loaded wallet.
  const alloc = makeAllocator(allSlots.length);
  const walletsCount = phase === 'public'
    ? Math.max(1, Math.min(sources.length || 1, Math.floor(Number(options.wallets) || 1)))
    : 1;
  const loaded = String(wallet.address || '').toLowerCase();
  const minterFor = (i) => {
    if (walletsCount <= 1) return loaded;
    const idx = Math.min(walletsCount - 1, Math.floor((i * walletsCount) / sources.length));
    return idx === 0 ? loaded : syntheticWallet(idx);
  };

  const records = [];
  for (let i = 0; i < sources.length; i++) {
    const minter = minterFor(i);
    const slot = alloc.allocate(minter);
    if (slot === null || slot === undefined) break;
    records.push(await recordForMint(sources[i], slot, minter));
    occupiedSlots.add(slot);
  }

  if (records.length === 0) return [];
  const sourceByKey = new Map(sources.map(nft => [nft.sourceKey || nftKey(nft), nft]));
  const state = await appendMintRecords(records);
  const before = minted.length;
  setMintedFromRecords(state.mints || []);
  const mintedNow = minted.slice(before);
  for (const cube of mintedNow) {
    const nft = sourceByKey.get(cube.sourceKey);
    if (nft) {
      cube.nft = { ...nft, art: cube.nft.art || nft.art || null };
      if (cube.nft.isNormie && cube.nft.art?.k === 'n') hydrateNormieArtSnapshot(cube.nft.art);
    }
  }
  notify();
  return mintedNow;
}

export function mintSimulationSummary() {
  const normies = minted.filter(c => c.sourceKind === 'normie').length;
  const cc0 = minted.filter(c => c.sourceKind === 'cc0').length;
  const external = minted.length - normies - cc0;
  // Per-genesis-collection breakdown (Normies + the 5 CC0 pools), so the UI can show
  // the multi-source mix. Any leftover non-genesis externals fall under `other`.
  const counts = collectionMintedCounts();
  const byCollection = GENESIS_COLLECTIONS
    .map(c => ({ key: c.key, name: c.name, count: counts[c.key] || 0 }))
    .filter(row => row.count > 0);
  const genesisTotal = byCollection.reduce((sum, row) => sum + row.count, 0);
  return {
    total: minted.length,
    normies,
    cc0,
    external,
    byCollection,
    other: minted.length - genesisTotal,
    slots: occupiedSlots.size,
  };
}

export function nftIsNormieContract(nft) {
  return String(nft?.contract || '').toLowerCase() === NORMIES_CONTRACT;
}
