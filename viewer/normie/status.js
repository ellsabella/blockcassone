// Normie identity — cube-to-normie-ID mapping and normie/non-normie classification.

import { isAssignedNormieCube, normieIdFromAssignedNft, walletInventoryLoaded } from '../wallet-nfts.js';
import { getAllPlanes } from './api.js';

export function isNormieCube(motifIdx) {
  const walletAssigned = isAssignedNormieCube(motifIdx);
  if (walletAssigned !== null) return walletAssigned;
  let h = Math.imul((motifIdx + 1) >>> 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  h  = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h % 100) < 62;
}

function normieIdForPlane(plane) {
  let h = (plane.id * 2654435761) >>> 0;
  h ^= h >>> 16;
  h  = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % 10000;
}

export function normieIdForCube(motifIdx) {
  if (walletInventoryLoaded()) return normieIdFromAssignedNft(motifIdx);
  if (!isNormieCube(motifIdx)) return null;
  const allPlanes = getAllPlanes();
  if (!allPlanes) return 0;
  const cubePlanes = allPlanes.filter(p => p.hierarchy?.motifIndex === motifIdx);
  if (cubePlanes.length === 0) return 0;
  const axisCounts = {};
  for (const p of cubePlanes) axisCounts[p.axis] = (axisCounts[p.axis] || 0) + 1;
  const uniqueAxis  = Object.keys(axisCounts).find(ax => axisCounts[ax] === 1);
  const uniquePlane = uniqueAxis ? cubePlanes.find(p => p.axis === uniqueAxis) : cubePlanes[0];
  return normieIdForPlane(uniquePlane);
}
