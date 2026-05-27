import { NORMIES_CONTRACT, getWalletState, nftKey } from './wallet-nfts.js';
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

export function resetMintSimulation() {
  minted = [];
  mintedNormieIds = new Set();
  occupiedSlots = new Set();
  mintedSourceKeys = new Set();
  notify();
}

export function clearMintSimulationSilent() {
  minted = [];
  mintedNormieIds = new Set();
  occupiedSlots = new Set();
  mintedSourceKeys = new Set();
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

function mintOne(nft, slot) {
  const cube = {
    cubeId: minted.length + 1,
    slot,
    nft,
    sourceKey: nftKey(nft),
    sourceKind: nft.isNormie ? 'normie' : 'external',
  };
  minted.push(cube);
  occupiedSlots.add(slot);
  mintedSourceKeys.add(cube.sourceKey);
  if (nft.isNormie && nft.normieId !== null && nft.normieId !== undefined) mintedNormieIds.add(nft.normieId);
  return cube;
}

export function simulateMintBatch(count, allSlots) {
  const wallet = getWalletState();
  if (!wallet.loaded) throw new Error('Load wallet NFTs before minting');
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  if (requested <= 0) return [];

  const mintedNow = [];
  const normies = normiePrioritySources(wallet);
  const normieCount = Math.min(requested, normies.length);
  const sources = normies.slice(0, normieCount);
  if (sources.length < requested) {
    sources.push(...externalSources(wallet, requested - sources.length, minted.length));
  }

  for (const nft of sources) {
    const slot = pickSlot(allSlots, minted.length, nftKey(nft));
    if (slot === null || slot === undefined) break;
    mintedNow.push(mintOne(nft, slot));
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
