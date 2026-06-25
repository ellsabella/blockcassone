// Per-cube edge-point assignment — the generation side of 2D/3D parity.
// Each cube (motif) has 3 regular planes sharing two internal edges (2-3 and
// 4-5). We derive every plane's edge pattern from the cube's seed via sidePlan,
// so the unique (middle) plane's grown points equal the on-chain thumbnail's,
// and a sub on a shared edge is owned by exactly one plane (never both).
//
// edgePatterns[e][sub] === 1  =>  THIS plane owns the sub (grows a strand).
// The off-plane (non-owner) sub grows on its owner plane instead — in 3D every
// placed point sprouts exactly one strand, on whichever face owns it.

import { sidePlan, strandMask } from './side-plan.js';
import { keccak256 } from './keccak.js';

const EDGE_SUBS = 7; // CONFIG.edgeSubdivisions - 1, fixed to match the on-chain 7-bit edges

// Canonical edge id = the motif-local vertex pair (2-3 -> 23, 4-5 -> 45, ...),
// derived from the plane's actual vertex indices so it's independent of plane
// ordering. Shared internal edges are 23 (planes 0&1) and 45 (planes 1&2); the
// rest are sole-owned. The middle plane (motif-local verts 2-5) is always the
// bit-1 owner of a shared edge.
const isShared = (canon) => canon === 23 || canon === 45;

// Works on either a raw hilbert plane (.indices) or a serialized plane
// (.vertices.indices).
const indicesOf = (pl) => pl.indices || (pl.vertices && pl.vertices.indices);

/** Fill edgePatterns for one cube's three regular planes from its seed. */
export function assignMotifEdgePoints(planes3, seedHex) {
  // motif base = the cube's vertex 0 = the smallest index across its planes
  let base = Infinity;
  for (const pl of planes3) for (const idx of indicesOf(pl)) if (idx < base) base = idx;

  for (const plane of planes3) {
    const local = indicesOf(plane).map((i) => i - base);
    const isMiddle = Math.min(...local) === 2; // middle plane = verts 2,3,4,5
    plane.edgePatterns = [];
    for (let e = 0; e < 3; e++) {
      const canon = local[e] * 10 + local[e + 1];
      const mask = strandMask(sidePlan(seedHex, canon), isShared(canon), isMiddle);
      const arr = new Array(EDGE_SUBS);
      for (let s = 0; s < EDGE_SUBS; s++) arr[s] = (mask >> s) & 1;
      plane.edgePatterns.push(arr);
    }
  }
}

/** Overwrite every cube's edge patterns from a per-motif seed function. */
export function assignCubeEdgePoints(hilbert, motifSeed) {
  const numMotifs = hilbert.planes.length / 3;
  for (let m = 0; m < numMotifs; m++) {
    assignMotifEdgePoints(hilbert.planes.slice(m * 3, m * 3 + 3), motifSeed(m));
  }
}

/** Preview-world placeholder seed for an unminted slot: keccak256(uint256 slot). */
export function placeholderSeed(slot) {
  const b = new Uint8Array(32);
  let v = BigInt(slot);
  for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return '0x' + keccak256(b);
}
