import {
  NORMIES_CONTRACT,
  getWalletState,
  nftKey,
} from './wallet-nfts.js';
import { compactNormieArt } from './art-snapshot.js';
import { loadChainMintRecords } from './chain-cubes.js';
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
let onMintReady = null;
let mintStateSource = 'dev';

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
  const nft = {
    chain: source.chain,
    chainId: Number(source.chainId || 0),
    contract: String(source.contract || '').toLowerCase(),
    tokenId: String(source.tokenId || ''),
    name: record.cc0?.projectName ? `${record.cc0.projectName} Seed #${source.tokenId || '?'}` : `${sourceKind === 'normie' ? 'Normie' : 'Source'} #${source.tokenId || '?'}`,
    collection: record.cc0?.projectName || '',
    imageUrl: '',
    isNormie: sourceKind === 'normie',
    isCC0Seed: sourceKind === 'cc0',
    normieId: sourceKind === 'normie' ? Number(source.tokenId) : null,
    cc0ProjectId: record.cc0?.projectId || '',
    cc0ProjectName: record.cc0?.projectName || '',
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
  };
}

function rebuildIndexes() {
  mintedNormieIds = new Set();
  occupiedSlots = new Set();
  for (const cube of minted) {
    occupiedSlots.add(cube.slot);
    if (cube.sourceKind === 'normie' && cube.nft.normieId !== null && cube.nft.normieId !== undefined) {
      mintedNormieIds.add(cube.nft.normieId);
    }
  }
}

function setMintedFromRecords(records) {
  minted = (records || [])
    .map(cubeFromRecord)
    .filter(cube => Number.isInteger(cube.cubeId) && Number.isInteger(cube.slot))
    .sort((a, b) => a.cubeId - b.cubeId);
  for (const cube of minted) {
    if (cube.nft?.isNormie && cube.nft.art?.k === 'n') hydrateNormieArtSnapshot(cube.nft.art);
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

export function mintedStateSource() {
  return mintStateSource;
}

export function getMintedCubeForSlot(slot) {
  return minted.find(cube => cube.slot === slot) || null;
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

function availableSlots(allSlots) {
  return allSlots.filter(slot => !occupiedSlots.has(slot));
}

function pickSlot(allSlots, mintIndex, sourceKey) {
  const open = availableSlots(allSlots);
  if (open.length === 0) return null;
  let seed = 0;
  for (let i = 0; i < sourceKey.length; i++) seed = (seed + sourceKey.charCodeAt(i) * (i + 17)) >>> 0;
  const idx = Math.floor(hash1(seed, mintIndex, open.length) * open.length) % open.length;
  return open[idx];
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

async function allowlistNormieSources(wallet) {
  const snapshotIds = await snapshotNormieIdsForWallet(wallet.address);
  const ids = snapshotIds.length || snapshotHasEntries()
    ? snapshotIds
    : wallet.normies.map(nft => nft.normieId);
  return ids
    .filter(id => Number.isInteger(id) && !mintedNormieIds.has(id))
    .sort((a, b) => a - b)
    .map(normieSourceFromId);
}

async function publicNormieSources() {
  const snapshotIds = await snapshotAllNormieIds();
  return snapshotIds
    .filter(id => Number.isInteger(id) && !mintedNormieIds.has(id))
    .sort((a, b) => a - b)
    .map(normieSourceFromId);
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
  const availableSources = phase === 'public'
    ? await publicNormieSources()
    : await allowlistNormieSources(wallet);
  const sources = availableSources.slice(0, requested);

  const records = [];
  for (const nft of sources) {
    const slot = pickSlot(allSlots, minted.length + records.length, nft.sourceKey || nftKey(nft));
    if (slot === null || slot === undefined) break;
    records.push(await recordForMint(nft, slot, wallet.address));
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
  return {
    total: minted.length,
    normies,
    cc0,
    external,
    slots: occupiedSlots.size,
  };
}

export function nftIsNormieContract(nft) {
  return String(nft?.contract || '').toLowerCase() === NORMIES_CONTRACT;
}
