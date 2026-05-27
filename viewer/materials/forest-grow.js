// Shared tree grower for forest line bundles AND particle clouds, so both
// follow the exact same branch geometry. Output is a flat list of segments
// — each consumer turns those into its own visual.
//
// Properties:
//   • Inward bias toward the cube centre at every step.
//   • Per-branch jittered LENGTH (children of the same fork are not equal).
//   • Per-branch jittered ANGLE (the ±spread is sampled independently for
//     each child).
//   • Refraction at mirror-slice plane crossings: the segment is truncated
//     and two children diverge with their own jittered angles + lengths.
//   • Boundary clamping: strands that would exit the cube terminate cleanly.
//
// Determinism: all randomness derives from `seedBase + bi*… + segIdx*…`,
// so independent callers (lines, particles) producing the same parameters
// get the identical segment list.

import { rotAxis, hash1, V } from '../tree-walker.js';

export const FOREST_PARAMS = {
  TRUNK_LEN_FRAC : 0.22,    // mean trunk length, fraction of cube diagonal
  TRUNK_LEN_MIN  : 0.30,    // per-tree multiplier: stubby trees (0.30 × base)
  TRUNK_LEN_MAX  : 2.20,    // per-tree multiplier: trees that nearly cross the cube

  SPREAD         : 0.32,    // mean fork half-angle (rad)
  SPREAD_JITTER  : 0.55,    // each child's angle = SPREAD × (1 ± this)
  DECAY          : 0.70,    // mean child-length / parent-length
  DECAY_JITTER   : 0.50,    // each child's length × (1 ± this)

  // Inward bias is sampled per-tree from [MIN, MAX]. With MIN=0 some trees
  // shoot straight in their initial direction with no centre pull, so they
  // can punch all the way across the cube. With MAX>0 others spiral inward.
  INWARD_BIAS_MIN : 0.00,
  INWARD_BIAS_MAX : 0.55,

  // Per-tree initial-direction perturbation. The trunk's starting direction
  // gets rotated by ±DIR_VAR rad around two perpendicular axes — so trees
  // don't all dive straight inward from their plane.
  INIT_DIR_VAR    : 1.10,   // rad — large because we want real direction variety

  REFRACT_ANGLE   : 0.45,
  REFRACT_JITTER  : 0.45,
  REFRACT_DECAY   : 0.85,
  MAX_DEPTH       : 4,
};

const FOREST_STRAND_FRACTION = 0.5;

// --- Cube AABB --------------------------------------------------------------

export function cubeAABB(hilbert, motifIdx) {
  const base = motifIdx * 8;
  const mn = [ Infinity,  Infinity,  Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const v = hilbert.rawVertices[base + i];
    if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x;
    if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y;
    if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
  }
  return {
    mn, mx,
    centre: [(mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5],
    scale:  Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]),
  };
}

// --- Geometry helpers -------------------------------------------------------

const HIT_EPS = 1e-3;

function bendToward(dir, target, bias) {
  if (bias <= 0) return dir;
  return V.norm([
    dir[0] * (1 - bias) + target[0] * bias,
    dir[1] * (1 - bias) + target[1] * bias,
    dir[2] * (1 - bias) + target[2] * bias,
  ]);
}

function bendAroundNormal(dir, normal, angle) {
  const axis = V.cross(normal, dir);
  if (V.len(axis) < 1e-4) return dir;
  return V.norm(rotAxis(dir, V.norm(axis), angle));
}

function planeHit(a, b, slicesByAxis) {
  let bestT = Infinity, bestAxis = null;
  for (let k = 0; k < 3; k++) {
    const ax = k === 0 ? 'x' : k === 1 ? 'y' : 'z';
    const slices = slicesByAxis[ax];
    if (!slices || slices.length === 0) continue;
    const da = a[k], db = b[k];
    const dd = db - da;
    if (Math.abs(dd) < 1e-9) continue;
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (Math.abs(da - s) < 1e-4) continue;
      if ((da < s && db > s) || (da > s && db < s)) {
        const t = (s - da) / dd;
        if (t > HIT_EPS && t < bestT) { bestT = t; bestAxis = k; }
      }
    }
  }
  if (bestAxis === null) return null;
  const n = [0, 0, 0]; n[bestAxis] = 1;
  return {
    t: bestT,
    point: [
      a[0] + (b[0] - a[0]) * bestT,
      a[1] + (b[1] - a[1]) * bestT,
      a[2] + (b[2] - a[2]) * bestT,
    ],
    normal: n,
  };
}

function boundaryHit(a, b, aabb) {
  let bestT = Infinity, bestAxis = null;
  for (let k = 0; k < 3; k++) {
    const da = a[k], db = b[k];
    const dd = db - da;
    if (Math.abs(dd) < 1e-9) continue;
    for (const s of [aabb.mn[k], aabb.mx[k]]) {
      if (Math.abs(da - s) < 1e-4) continue;
      if ((da < s && db > s) || (da > s && db < s)) {
        const t = (s - da) / dd;
        if (t > HIT_EPS && t < bestT) { bestT = t; bestAxis = k; }
      }
    }
  }
  if (bestAxis === null) return null;
  return {
    t: bestT,
    point: [
      a[0] + (b[0] - a[0]) * bestT,
      a[1] + (b[1] - a[1]) * bestT,
      a[2] + (b[2] - a[2]) * bestT,
    ],
  };
}

// Sample a value in [1 - jitter, 1 + jitter] using a hash key.
function jitterMul(seed, jitter) {
  return 1 + (hash1([seed, 0, 0]) - 0.5) * 2 * jitter;
}

// --- Grower -----------------------------------------------------------------

// Walk one tree from `root` with initial direction `initDir`. Pushes
// segments into `out`. `bi` and `seedBase` make the random sequence
// reproducible per (plane, edge-bit). Each segment's `segIdx` is the
// flat traversal order (unique within this tree).
function growOne(root, initDir, treeUp, seedBase, bi, params, slicesByAxis, aabb, out) {
  const baseSeed = seedBase + bi * 0.137;
  let segIdx = 0;

  // Per-tree variations — sampled once per tree so the SAME tree is
  // internally consistent but DIFFERENT trees vary widely.
  const tSeed   = seedBase + bi * 0.413 + 0.713;
  const lenMul  = params.TRUNK_LEN_MIN
                + hash1([tSeed, 1, 0]) * (params.TRUNK_LEN_MAX - params.TRUNK_LEN_MIN);
  const treeBias = params.INWARD_BIAS_MIN
                 + hash1([tSeed, 2, 0]) * (params.INWARD_BIAS_MAX - params.INWARD_BIAS_MIN);

  // Perturb the trunk's initial direction by two independent rotations so
  // neighbouring trees don't all point the same way.
  const a1 = (hash1([tSeed, 3, 0]) - 0.5) * 2 * params.INIT_DIR_VAR;
  const a2 = (hash1([tSeed, 4, 0]) - 0.5) * 2 * params.INIT_DIR_VAR;
  let trunkDir = rotAxis(initDir, treeUp, a1);
  const perp = V.cross(trunkDir, treeUp);
  if (V.len(perp) > 1e-4) {
    trunkDir = rotAxis(trunkDir, V.norm(perp), a2);
  }
  trunkDir = V.norm(trunkDir);

  const trunkLen = params.TRUNK_LEN_FRAC * aabb.scale * lenMul;

  function grow(start, dir, length, depth) {
    if (depth > params.MAX_DEPTH || length < 1e-3) return;

    const toCentre  = V.norm(V.sub(aabb.centre, start));
    const biasedDir = bendToward(dir, toCentre, treeBias);

    const end = [
      start[0] + biasedDir[0] * length,
      start[1] + biasedDir[1] * length,
      start[2] + biasedDir[2] * length,
    ];

    const pHit = slicesByAxis ? planeHit(start, end, slicesByAxis) : null;
    const bHit = boundaryHit(start, end, aabb);
    let firstHit = null, kind = null;
    if (pHit) { firstHit = pHit; kind = 'plane'; }
    if (bHit && (!firstHit || bHit.t < firstHit.t)) {
      firstHit = bHit; kind = 'boundary';
    }

    const stop = firstHit ? firstHit.point : end;
    const myIdx = segIdx++;
    out.push({ a: start, b: stop, depth, bi, segIdx: myIdx });

    if (kind === 'boundary') return;

    // Per-branch jitter seeds. Each child gets independent angle + length.
    const sFork = baseSeed + myIdx * 0.071 + depth * 0.503;

    if (kind === 'plane') {
      const remaining = length * (1 - firstHit.t) * params.REFRACT_DECAY;
      const angA = params.REFRACT_ANGLE * jitterMul(sFork + 0.11, params.REFRACT_JITTER);
      const angB = params.REFRACT_ANGLE * jitterMul(sFork + 0.23, params.REFRACT_JITTER);
      const lenA = remaining * jitterMul(sFork + 0.41, params.DECAY_JITTER);
      const lenB = remaining * jitterMul(sFork + 0.53, params.DECAY_JITTER);
      const dirA = bendAroundNormal(biasedDir, firstHit.normal, +angA);
      const dirB = bendAroundNormal(biasedDir, firstHit.normal, -angB);
      grow(firstHit.point, dirA, Math.max(0, lenA), depth + 1);
      grow(firstHit.point, dirB, Math.max(0, lenB), depth + 1);
      return;
    }

    if (depth < params.MAX_DEPTH) {
      const angA  = params.SPREAD * jitterMul(sFork + 0.13, params.SPREAD_JITTER);
      const angB  = params.SPREAD * jitterMul(sFork + 0.27, params.SPREAD_JITTER);
      const lenA  = length * params.DECAY * jitterMul(sFork + 0.43, params.DECAY_JITTER);
      const lenB  = length * params.DECAY * jitterMul(sFork + 0.57, params.DECAY_JITTER);
      // Optionally rotate the splitting axis a bit per fork so successive
      // forks aren't all in the same plane.
      const twist = (hash1([sFork + 0.71, 0, 0]) - 0.5) * 0.9;
      const upHere = rotAxis(treeUp, biasedDir, twist);
      const fwdA = rotAxis(biasedDir, upHere, -angA);
      const fwdB = rotAxis(biasedDir, upHere,  angB);
      grow(end, fwdA, Math.max(0, lenA), depth + 1);
      grow(end, fwdB, Math.max(0, lenB), depth + 1);
    }
  }

  grow(root, trunkDir, trunkLen, 0);
}

// Generate every forest segment for one plane. Spawns one tree per
// active edge bit. Returns array of { a, b, depth, bi, segIdx }.
export function generateForestSegments(plane, hilbert, slicesByAxis, params = FOREST_PARAMS) {
  const aabb = cubeAABB(hilbert, plane.hierarchy.motifIndex);
  const pos  = plane.vertices.positions;

  const pc = [0, 0, 0];
  for (const v of pos) { pc[0] += v.x; pc[1] += v.y; pc[2] += v.z; }
  pc[0] *= 0.25; pc[1] *= 0.25; pc[2] *= 0.25;

  const inDir   = V.norm(V.sub(aabb.centre, pc));
  const seedBase = (plane.id || 0) * 0.137;
  const anyAxis = Math.abs(inDir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let upAxBase  = V.norm(V.cross(inDir, anyAxis));
  upAxBase      = rotAxis(upAxBase, inDir, seedBase * 6.2832);

  const out = [];
  for (let bi = 0; bi < 21; bi++) {
    const edge = (bi / 7) | 0;
    const sub  = bi - edge * 7;
    const pattern = plane.edgePatterns[edge] || [];
    if (pattern[sub] !== 1) continue;
    if (hash1([seedBase, bi, 999]) >= FOREST_STRAND_FRACTION) continue;

    const t = (sub + 1) / 8;
    const v0 = pos[edge];
    const v1 = pos[edge + 1];
    // Push root just inside the face so boundaryHit detects the starting
    // face correctly — without this, the starting face is skipped by the
    // 1e-4 epsilon and outward-pointing trunks escape undetected.
    const root = [
      v0.x + (v1.x - v0.x) * t + inDir[0] * 1e-3,
      v0.y + (v1.y - v0.y) * t + inDir[1] * 1e-3,
      v0.z + (v1.z - v0.z) * t + inDir[2] * 1e-3,
    ];
    const th = hash1([root[0]*11 + seedBase, root[1]*11, root[2]*11]);
    const treeUp = rotAxis(upAxBase, inDir, th * 6.2832);

    growOne(root, inDir, treeUp, seedBase, bi, params, slicesByAxis, aabb, out);
  }

  return { segments: out, aabb, inDir, seedBase };
}
