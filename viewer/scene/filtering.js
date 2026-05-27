// Scene filtering — pure predicates that take explicit state params rather than reading globals.

import {
  isNormieCube, normieIdForCube,
  ensureNormieStatusFetched, getNormieCategory,
} from '../normies-manager.js';
import { isMintedSlot } from '../mint-simulator.js';

export function ensureMotifCategory(motifIdx) {
  if (!isNormieCube(motifIdx)) return null;
  const id = normieIdForCube(motifIdx);
  ensureNormieStatusFetched(id);
  return getNormieCategory(id);
}

export function motifPassesCubeType(motifIdx, cubeTypeFilter) {
  if (!isMintedSlot(motifIdx)) return false;
  if (cubeTypeFilter === 'all') return true;
  const isNormie = isNormieCube(motifIdx);
  return cubeTypeFilter === 'normie' ? isNormie : !isNormie;
}

export function motifPassesCategory(motifIdx, categoryFilter, cubeTypeFilter) {
  if (!motifPassesCubeType(motifIdx, cubeTypeFilter)) return false;
  if (!isNormieCube(motifIdx)) return categoryFilter === null;
  if (categoryFilter === null) return true;
  return ensureMotifCategory(motifIdx) === categoryFilter;
}

export function visibleMotifs(uniqueMotifs, categoryFilter, cubeTypeFilter) {
  if (categoryFilter === null) return uniqueMotifs.filter(m => motifPassesCubeType(m, cubeTypeFilter));
  return uniqueMotifs.filter(m => motifPassesCategory(m, categoryFilter, cubeTypeFilter));
}

export function visiblePlanes(serializedPlanes, categoryFilter, cubeTypeFilter) {
  if (categoryFilter === null)
    return serializedPlanes.filter(p => motifPassesCubeType(p.hierarchy.motifIndex, cubeTypeFilter));
  return serializedPlanes.filter(p => motifPassesCategory(p.hierarchy.motifIndex, categoryFilter, cubeTypeFilter));
}

export function categoryCounts(uniqueMotifs, categoryFilter, cubeTypeFilter) {
  const counts = [0, 0, 0, 0, 0];
  let pending = 0, normie = 0, nonNormie = 0;
  for (const motifIdx of uniqueMotifs) {
    if (!isMintedSlot(motifIdx)) continue;
    if (isNormieCube(motifIdx)) normie++;
    else { nonNormie++; continue; }
    const cat = ensureMotifCategory(motifIdx);
    if (cat === null || cat === undefined) pending++;
    else if (cat >= 0 && cat <= 4) counts[cat]++;
  }
  return { counts, pending, normie, nonNormie };
}
