import { NORMIES_CONTRACT, getWalletState, loadAgentBindingForNft, nftKey } from './wallet-nfts.js';
import { hashInt as hash1 } from './tree-walker.js';

let minted = [];
let mintedNormieIds = new Set();
let occupiedSlots = new Set();
let mintedSourceKeys = new Set();
let onMintReady = null;

function notify() {
  if (onMintReady) onMintReady();
}

export function setMintDataReadyCallback(cb) {
  onMintReady = cb;
}

function sourceKeyFromRecord(record) {
  const source = record.source || {};
  return `${source.chain}:${String(source.contract || '').toLowerCase()}:${source.tokenId}`;
}

function cubeFromRecord(record) {
  const source = record.source || {};
  const sourceKind = record.sourceKind === 'normie' ? 'normie' : 'external';
  const nft = {
    chain: source.chain,
    contract: String(source.contract || '').toLowerCase(),
    tokenId: String(source.tokenId || ''),
    name: `${sourceKind === 'normie' ? 'Normie' : 'Source'} #${source.tokenId || '?'}`,
    collection: '',
    imageUrl: '',
    isNormie: sourceKind === 'normie',
    normieId: sourceKind === 'normie' ? Number(source.tokenId) : null,
    isSvgArt: false,
    agentic: Boolean(record.agentic),
    agentId: record.agentId ? String(record.agentId) : '',
    agentBinding: null,
    agentBindingLoaded: Boolean(record.agentic),
    shadow: true,
  };

  return {
    cubeId: Number(record.cubeId),
    slot: Number(record.slot),
    wallet: String(record.wallet || '').toLowerCase(),
    nft,
    sourceKey: sourceKeyFromRecord(record),
    sourceKind,
    shadow: true,
  };
}

function rebuildIndexes() {
  mintedNormieIds = new Set();
  occupiedSlots = new Set();
  mintedSourceKeys = new Set();
  for (const cube of minted) {
    occupiedSlots.add(cube.slot);
    mintedSourceKeys.add(cube.sourceKey);
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

function normiePrioritySources(wallet) {
  return wallet.normies
    .filter(nft => nft.normieId !== null && nft.normieId !== undefined && !mintedNormieIds.has(nft.normieId))
    .sort((a, b) => a.normieId - b.normieId);
}

function externalSources(wallet, count, startIndex) {
  const candidates = wallet.nonNormies.filter(nft => !mintedSourceKeys.has(nftKey(nft)));
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count && picked.length < candidates.length; i++) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let j = 0; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const score = hash1(j + 1, startIndex + i + 1, candidates.length + 11);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break;
    used.add(bestIdx);
    picked.push(candidates[bestIdx]);
  }
  return picked;
}

function recordForMint(nft, slot, walletAddress) {
  const sourceKind = nft.isNormie ? 'normie' : 'external';
  return {
    slot,
    wallet: walletAddress,
    sourceKind,
    source: {
      chain: nft.chain,
      contract: nft.contract,
      tokenId: String(nft.tokenId),
    },
    agentic: Boolean(nft.agentic),
    agentId: nft.agentId ? String(nft.agentId) : '',
  };
}

export async function simulateMintBatch(count, allSlots) {
  const wallet = getWalletState();
  if (!wallet.loaded) throw new Error('Load wallet NFTs before minting');
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  if (requested <= 0) return [];

  const normies = normiePrioritySources(wallet);
  const normieCount = Math.min(requested, normies.length);
  const sources = normies.slice(0, normieCount);
  if (sources.length < requested) {
    sources.push(...externalSources(wallet, requested - sources.length, minted.length));
  }

  await Promise.all(sources.filter(nft => !nft.isNormie).map(nft => loadAgentBindingForNft(nft)));

  const records = [];
  for (const nft of sources) {
    const slot = pickSlot(allSlots, minted.length + records.length, nftKey(nft));
    if (slot === null || slot === undefined) break;
    records.push(recordForMint(nft, slot, wallet.address));
    occupiedSlots.add(slot);
  }

  if (records.length === 0) return [];
  const sourceByKey = new Map(sources.map(nft => [nftKey(nft), nft]));
  const state = await appendMintRecords(records);
  const before = minted.length;
  setMintedFromRecords(state.mints || []);
  const mintedNow = minted.slice(before);
  for (const cube of mintedNow) {
    const nft = sourceByKey.get(cube.sourceKey);
    if (nft) {
      cube.nft = nft;
      cube.shadow = false;
    }
  }
  notify();
  return mintedNow;
}

export function mintSimulationSummary() {
  const normies = minted.filter(c => c.sourceKind === 'normie').length;
  const external = minted.length - normies;
  return {
    total: minted.length,
    normies,
    external,
    slots: occupiedSlots.size,
  };
}

export function nftIsNormieContract(nft) {
  return String(nft?.contract || '').toLowerCase() === NORMIES_CONTRACT;
}
