// Internal glass slice planes — mirror-pair rule.
//
// For each axis A independently:
//   1. Collect every cube edge running parallel to A (deduped — multiple
//      planes can reference the same cube edge, those collapse).
//   2. For each sub-position (0..6), count how many A-parallel cube edges
//      have an active bit at that sub.
//   3. If MIN_MIRROR_COUNT or more share a bit, emit a glass plane
//      perpendicular to A at that coordinate.
//
// Visual intent: instead of evenly bisecting the cube wherever any edge
// point exists, planes only appear where the cube's bit pattern is mirror-
// symmetric across opposite edges along that axis. That ties slice
// placement to actual structural features of the data, so cubes with
// asymmetric patterns get few or no slices and symmetric cubes get rich
// internal articulation.

import { createMeshGL } from '../renderer/src/geometry.js';
import { mat4, identity } from '../renderer/src/math.js';

const SLICE_EPS         = 1e-4;
const MIN_MIRROR_COUNT  = 2;     // bump to 3/4 for stricter mirroring
const WHITE_TINT        = new Float32Array([1.0, 1.0, 1.0]);
const DEFAULT_ALPHA     = 0.32;

function cubeAABB(hilbert, motifIdx) {
  const base = motifIdx * 8;
  const mn = [ Infinity,  Infinity,  Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const v = hilbert.rawVertices[base + i];
    if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x;
    if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y;
    if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
  }
  return { mn, mx };
}

// Canonical key for a cube edge — sorted-endpoint string. Two plane edges
// referencing the same physical cube edge produce the same key regardless
// of vertex order.
function canonEdge(v0, v1) {
  const a = `${v0.x},${v0.y},${v0.z}`;
  const b = `${v1.x},${v1.y},${v1.z}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Collect unique cube edges across all planes belonging to this cube. For
// each edge we capture its axis, its endpoints, and the union of all bit
// patterns observed for it across the planes.
function harvestCubeEdges(cubePlanes) {
  const edges = new Map();
  for (const plane of cubePlanes) {
    const pos = plane.vertices.positions;
    for (let edge = 0; edge < 3; edge++) {
      const pattern = plane.edgePatterns[edge] || [];
      const v0 = pos[edge], v1 = pos[edge + 1];
      const dx = Math.abs(v1.x - v0.x);
      const dy = Math.abs(v1.y - v0.y);
      const dz = Math.abs(v1.z - v0.z);
      let axis;
      if (dx >= dy && dx >= dz) axis = 'x';
      else if (dy >= dz)        axis = 'y';
      else                      axis = 'z';

      const key = canonEdge(v0, v1);
      const existing = edges.get(key);
      if (!existing) {
        const bits = new Array(7).fill(0);
        for (let i = 0; i < 7; i++) if (pattern[i] === 1) bits[i] = 1;
        edges.set(key, { axis, v0, v1, bits });
      } else {
        for (let i = 0; i < 7; i++) {
          if (pattern[i] === 1) existing.bits[i] = 1;
        }
      }
    }
  }
  return edges;
}

// For each axis: scan sub-positions, count how many parallel edges share
// an active bit, and emit a slice coordinate when count ≥ MIN_MIRROR_COUNT.
// Returns { x: Set<coord>, y: Set<coord>, z: Set<coord> }.
function findMirrorSlices(cubeEdges) {
  const byAxis = { x: [], y: [], z: [] };
  for (const e of cubeEdges.values()) byAxis[e.axis].push(e);

  const slices = { x: new Set(), y: new Set(), z: new Set() };
  for (const axis of ['x', 'y', 'z']) {
    const axisEdges = byAxis[axis];
    if (axisEdges.length < MIN_MIRROR_COUNT) continue;

    for (let sub = 0; sub < 7; sub++) {
      const t = (sub + 1) / 8;
      let count = 0;
      let coord = null;
      for (const e of axisEdges) {
        if (e.bits[sub] !== 1) continue;
        count++;
        if (coord === null) {
          coord = e.v0[axis] + (e.v1[axis] - e.v0[axis]) * t;
        }
      }
      if (count >= MIN_MIRROR_COUNT && coord !== null) {
        slices[axis].add(Math.round(coord / SLICE_EPS) * SLICE_EPS);
      }
    }
  }
  return slices;
}

// ---------------------------------------------------------------------------

// Pure: returns the mirror-slice coordinates as sorted arrays per axis.
// Shared with forest growth (which needs the same geometry to refract on).
export function computeMirrorSlices(motifIdx, hilbert, allPlanes) {
  const cubePlanes = allPlanes.filter(p =>
    p.hierarchy && p.hierarchy.motifIndex === motifIdx
  );
  if (cubePlanes.length === 0) return { x: [], y: [], z: [] };
  const cubeEdges = harvestCubeEdges(cubePlanes);
  const setSlices = findMirrorSlices(cubeEdges);
  return {
    x: [...setSlices.x].sort((a, b) => a - b),
    y: [...setSlices.y].sort((a, b) => a - b),
    z: [...setSlices.z].sort((a, b) => a - b),
  };
}


