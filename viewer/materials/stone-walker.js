// Stone-plane 3D random walk on the normie voxel lattice.
//
// From each convex corner of the normie shape on a stone plane face, fire a
// perpendicular ray into the cube until it hits the first filled normie voxel.
// Then perform a random walk along the 40×40×40 voxel grid edges, terminating
// when a previously-drawn edge is encountered or the cube boundary is reached.
// All walks for one cube share a single occupied-edge set so cross-path
// termination works across stone planes.

import { hash1 }      from '../tree-walker.js';
import { mat4, identity } from '../../renderer/src/math.js';
import { buildCoreLineMesh, buildGlowLineMesh, planePerpFn } from './line-mesh.js';
import {
  normieIdForCube,
  makePlanePixelFn,
  getPlanePixelArray,
  ensurePixelsFetched,
  ensureNormieStatusFetched,
  getNormieCategory,
  isNormieCube,
  getNormieIdLabelCells,
} from '../normies-manager.js';

// ---- Tuning ----------------------------------------------------------------
const LINE_WIDTH     = 0.0015;
const GLOW_WIDTH     = 0.014;
const AWAKE_GLOW_WIDTH = 0.017;
const LINE_OPACITY   = 0.65;
const GLOW_OPACITY   = 0.12;
const MIN_WALKS      = 40;
const MAX_WALKS      = 42;
const AWAKE_MIN_WALKS = 42;
const AWAKE_MAX_WALKS = 46;
const ELITE_MIN_WALKS = 56;
const ELITE_MAX_WALKS = 62;
const TERMINATE_PROB = 0.006;
const MAX_SURFACE_STEPS = 6;  // edges traced on one glass cube before departing

// ---- Helpers ---------------------------------------------------------------

function axisColor(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors?.[axis]?.hex) || '#ffffff';
  return new Float32Array([
    parseInt(hex.substr(1, 2), 16) / 255,
    parseInt(hex.substr(3, 2), 16) / 255,
    parseInt(hex.substr(5, 2), 16) / 255,
  ]);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function voxelIdx(xi, yi, zi) { return xi * 1600 + yi * 40 + zi; }

function nodeToWorld(node, mn, vs) {
  return [mn[0] + node[0] * vs[0], mn[1] + node[1] * vs[1], mn[2] + node[2] * vs[2]];
}

// Canonical edge key — smaller node string first so a→b and b→a map to same key.
function edgeKey(a, b) {
  const ka = `${a[0]},${a[1]},${a[2]}`;
  const kb = `${b[0]},${b[1]},${b[2]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// ---- Filled-voxel array ----------------------------------------------------
// voxel (xi,yi,zi) is filled if ALL cube planes vote 1.

function buildFilledArray(cubePlanes, pixelArrays, pixFns) {
  const filled = new Uint8Array(64000); // 40³
  const max    = cubePlanes.length;
  for (let xi = 0; xi < 40; xi++)
    for (let yi = 0; yi < 40; yi++)
      for (let zi = 0; zi < 40; zi++) {
        let score = 0;
        for (let p = 0; p < max; p++) score += pixelArrays[p][pixFns[p](xi, yi, zi)];
        if (score >= max) filled[voxelIdx(xi, yi, zi)] = 1;
      }
  return filled;
}

// ---- Glass column nodes ----------------------------------------------------
// Find every lattice node on the stone face where runInitialRay is guaranteed
// to hit glass.  For each node (a, faceIdx, b) on the face, we check the
// exact same clamped voxel column that runInitialRay reads: any yi step k
// with filled[clamp(a,0,39), k, clamp(b,0,39)] > 0.
// [p0, p1] are the two axes perpendicular to axIdx.

function glassColumnNodes(filled, axIdx, faceIdx) {
  const [p0, p1] = [0, 1, 2].filter(k => k !== axIdx);
  const nodes = [];
  for (let a = 0; a <= 40; a++) {
    const va = Math.min(a, 39);
    for (let b = 0; b <= 40; b++) {
      const vb = Math.min(b, 39);
      let hit = false;
      for (let k = 0; k < 40 && !hit; k++) {
        const vi = [0, 0, 0];
        vi[axIdx] = k; vi[p0] = va; vi[p1] = vb;
        if (filled[voxelIdx(vi[0], vi[1], vi[2])]) hit = true;
      }
      if (hit) {
        const node = [0, 0, 0];
        node[axIdx] = faceIdx; node[p0] = a; node[p1] = b;
        nodes.push(node);
      }
    }
  }
  return nodes;
}

// Pick n items from arr using deterministic Fisher-Yates (seeded by seedBase).
function pickRandom(arr, n, seedBase) {
  if (arr.length <= n) return [...arr];
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(hash1([seedBase, i, 0]) * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map(i => arr[i]);
}

// ---- Surface edge test -----------------------------------------------------
// An edge from node a to node b along axis ax is an "outer glass surface edge"
// if at least one of its 4 adjacent voxels (in the two perpendicular axes) is
// filled AND at least one is empty/out-of-bounds.
// These are exactly the edges that form the wireframe of the glass voxel cluster.

function isOuterSurfaceEdge(a, b, ax, filled) {
  const perp = [0, 1, 2].filter(k => k !== ax);
  const vAx  = Math.min(a[ax], b[ax]);   // voxel index along travel axis
  let hasFilled = false, hasEmpty = false;
  for (const d0 of [0, -1]) {
    for (const d1 of [0, -1]) {
      const v = [0, 0, 0];
      v[ax]      = vAx;
      v[perp[0]] = a[perp[0]] + d0;
      v[perp[1]] = a[perp[1]] + d1;
      if (v[0] < 0 || v[0] > 39 || v[1] < 0 || v[1] > 39 || v[2] < 0 || v[2] > 39) {
        hasEmpty = true;
      } else if (filled[voxelIdx(v[0], v[1], v[2])]) {
        hasFilled = true;
      } else {
        hasEmpty = true;
      }
    }
  }
  return hasFilled && hasEmpty;
}
// Returns true if node sits at the corner of any filled glass voxel.
// Each node has up to 8 adjacent voxels (one per octant offset by [0,-1]³).
function nodeIsOnGlassSurface(node, filled) {
  const [x, y, z] = node;
  for (const dx of [0, -1])
    for (const dy of [0, -1])
      for (const dz of [0, -1]) {
        const vx = x + dx, vy = y + dy, vz = z + dz;
        if (vx >= 0 && vx <= 39 && vy >= 0 && vy <= 39 && vz >= 0 && vz <= 39)
          if (filled[voxelIdx(vx, vy, vz)]) return true;
      }
  return false;
}

// Travel along axIdx in direction dir, stopping just BEFORE the first filled
// voxel so the walk starts flush against the glass voxel surface.

function runInitialRay(startNode, axIdx, dir, filled, occupied, allSegs) {
  let cur = [...startNode];

  for (let step = 0; step < 40; step++) {
    const nxt = [...cur];
    nxt[axIdx] += dir;

    if (nxt[axIdx] < 0 || nxt[axIdx] > 40) break;

    // Stop BEFORE entering a filled voxel so the walk starts at the surface.
    const vi = [clamp(cur[0], 0, 39), clamp(cur[1], 0, 39), clamp(cur[2], 0, 39)];
    vi[axIdx] = Math.min(cur[axIdx], nxt[axIdx]);
    if (filled[voxelIdx(vi[0], vi[1], vi[2])]) break;

    const ek = edgeKey(cur, nxt);
    if (occupied.has(ek)) break;
    occupied.add(ek);
    allSegs.push([...cur, ...nxt]);
    cur = nxt;
  }

  return cur;
}

// ---- Random walk -----------------------------------------------------------
// Two modes:
//   Surface — walks outer glass edges, prefers turns, max MAX_SURFACE_STEPS.
//   Flight  — travels straight until the next glass surface or cube boundary.
// Alternates: surface → flight → surface → ...

function runRandomWalk(startNode, initAxis, initDir, seed, occupied, allSegs, filled, maxSteps = Infinity) {
  let cur          = [...startNode];
  let s            = seed;
  let curAxis      = initAxis;
  let curDir       = initDir;
  let flying       = false;
  let surfaceSteps = 0;
  let flightSteps  = 0;
  let dbgSurfaceTurns = 0;
  let dbgGlassHits    = 0;
  const dbgStart      = [...startNode];

  let stepCount = 0;
  while (true) {
    if (stepCount++ >= maxSteps) break;
    s = hash1([s, 0, 0]);
    if (s < TERMINATE_PROB) break;

    if (!flying) {
      // ---- Surface mode: walk outer glass edges, prefer turns ----
      const turns     = [];
      const straights = [];
      for (let ax = 0; ax < 3; ax++) {
        for (const d of [-1, 1]) {
          const nxt = [...cur];
          nxt[ax] += d;
          if (nxt[ax] < 0 || nxt[ax] > 40) continue;
          const ek = edgeKey(cur, nxt);
          if (occupied.has(ek)) continue;
          if (!isOuterSurfaceEdge(cur, nxt, ax, filled)) continue;
          (ax === curAxis ? straights : turns).push({ nxt, ek, ax, d });
        }
      }

      const pool = turns.length > 0 ? turns : straights;
      if (pool.length === 0) {
        // No surface edges left — depart into empty space.
        flying = true;
        flightSteps = 0;
        continue;
      }

      s = hash1([s, 1, 0]);
      const choice = Math.min(Math.floor(s * pool.length), pool.length - 1);
      const { nxt, ek, ax, d } = pool[choice];
      occupied.add(ek);
      allSegs.push([...cur, ...nxt]);
      curAxis = ax;
      curDir  = d;
      cur     = nxt;
      dbgSurfaceTurns++;

      if (++surfaceSteps >= MAX_SURFACE_STEPS) {
        flying       = true;
        flightSteps  = 0;
        surfaceSteps = 0;
      }

    } else {
      // ---- Flight mode: straight line until next glass surface ----
      const nxt = [...cur];
      nxt[curAxis] += curDir;

      if (nxt[curAxis] < 0 || nxt[curAxis] > 40) break;  // hit boundary
      const ek = edgeKey(cur, nxt);
      if (occupied.has(ek)) break;

      // Stop just before entering a glass voxel — same as runInitialRay.
      const vi = [clamp(cur[0], 0, 39), clamp(cur[1], 0, 39), clamp(cur[2], 0, 39)];
      vi[curAxis] = Math.min(cur[curAxis], nxt[curAxis]);
      if (filled[voxelIdx(vi[0], vi[1], vi[2])]) {
        // Arrived at new glass surface head-on — switch back to surface mode.
        flying       = false;
        surfaceSteps = 0;
        continue;
      }

      occupied.add(ek);
      allSegs.push([...cur, ...nxt]);
      cur = nxt;
      flightSteps++;

      // After moving, check if we've arrived at any corner of a glass voxel.
      // This catches cubes that are adjacent to the flight path (not just head-on).
      // Require at least 1 flight step before landing on surface to avoid
      // immediately re-entering surface mode after departing a cube.
      if (flightSteps >= 1 && nodeIsOnGlassSurface(cur, filled)) {
        flying       = false;
        surfaceSteps = 0;
        dbgGlassHits++;
      }
    }
  }
  if (dbgSurfaceTurns === 0)
    console.log(`[stone-walk] walk from [${dbgStart}] ax=${initAxis} dir=${initDir}: 0 surface turns, ${dbgGlassHits} glass hits`);
}

// ---- Mesh builder ----------------------------------------------------------

function segsToFlat(allSegs, mn, vs) {
  const flat = new Float32Array(allSegs.length * 6);
  for (let i = 0; i < allSegs.length; i++) {
    const p0 = nodeToWorld(allSegs[i].slice(0, 3), mn, vs);
    const p1 = nodeToWorld(allSegs[i].slice(3, 6), mn, vs);
    flat[i*6]   = p0[0]; flat[i*6+1] = p0[1]; flat[i*6+2] = p0[2];
    flat[i*6+3] = p1[0]; flat[i*6+4] = p1[1]; flat[i*6+5] = p1[2];
  }
  return flat;
}

function buildWalkerMesh(gl, allSegs, mn, vs, normal) {
  if (allSegs.length === 0) return null;
  return buildCoreLineMesh(gl, segsToFlat(allSegs, mn, vs), planePerpFn(normal), LINE_WIDTH);
}

function buildWalkerGlowMesh(gl, allSegs, mn, vs, normal, width = GLOW_WIDTH, squareCaps = false) {
  if (allSegs.length === 0) return null;
  return buildGlowLineMesh(gl, segsToFlat(allSegs, mn, vs), planePerpFn(normal), width, squareCaps);
}

// ---- Shared world-space mesh builders (used by normie and non-normie alike) -

export function buildWalkGlowMeshWS(gl, flatSegs, normal, width = GLOW_WIDTH, squareCaps = false) {
  return buildGlowLineMesh(gl, flatSegs, planePerpFn(normal), width, squareCaps);
}

export function buildWalkCoreMeshWS(gl, flatSegs, normal, width = LINE_WIDTH) {
  return buildCoreLineMesh(gl, flatSegs, planePerpFn(normal), width);
}

// ---- Public builder --------------------------------------------------------

export function buildStoneWalker(motifIdx, hilbert, allPlanes, gl, meshes) {
  if (!isNormieCube(motifIdx)) return [];
  const normieId = normieIdForCube(motifIdx);
  ensureNormieStatusFetched(normieId);
  const category = getNormieCategory(normieId);
  const isAwake = category === 3 || category === 4;
  const isElite = category === 4;
  const styleKey = isAwake ? 'awake' : 'base';
  const builtKey  = `stone-walk-built-${motifIdx}-${styleKey}`;

  if (meshes[builtKey] === undefined) {
    const cubePlanes = allPlanes.filter(p => p.hierarchy?.motifIndex === motifIdx);

    if (cubePlanes.length === 0) {
      meshes[builtKey] = null;
      return [];
    }

    // Ensure all cube planes' pixel data is being fetched.
    ensurePixelsFetched(normieId);

    // Wait until all pixel arrays are available.
    const pixelArrays = cubePlanes.map(plane => getPlanePixelArray(plane, allPlanes));
    if (pixelArrays.some(px => !px)) return [];  // not ready yet

    // Cube AABB + voxel size.
    const base = motifIdx * 8;
    const mn   = [ Infinity,  Infinity,  Infinity];
    const mx   = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const v = hilbert.rawVertices[base + i];
      if (v.x < mn[0]) mn[0]=v.x; if (v.x > mx[0]) mx[0]=v.x;
      if (v.y < mn[1]) mn[1]=v.y; if (v.y > mx[1]) mx[1]=v.y;
      if (v.z < mn[2]) mn[2]=v.z; if (v.z > mx[2]) mx[2]=v.z;
    }
    const vs = [(mx[0]-mn[0])/40, (mx[1]-mn[1])/40, (mx[2]-mn[2])/40];

    // Build filled-voxel array (intersection of all cube planes).
    const pixFns = cubePlanes.map(p => makePlanePixelFn(p, mn, vs));
    const filled = buildFilledArray(cubePlanes, pixelArrays, pixFns);
    const filledCount = filled.reduce((s, v) => s + v, 0);
    if (filledCount === 0) { meshes[builtKey] = null; return []; }

    // Label cells (#NNNN bottom-right of every plane). Walks that project into
    // these cells on any plane are dropped so the ID stays readable.
    const labelCells = getNormieIdLabelCells(motifIdx);
    function nodeProjectsToLabel(x, y, z) {
      const xi = Math.max(0, Math.min(39, x));
      const yi = Math.max(0, Math.min(39, y));
      const zi = Math.max(0, Math.min(39, z));
      for (let i = 0; i < pixFns.length; i++) {
        if (labelCells.has(pixFns[i](xi, yi, zi))) return true;
      }
      return false;
    }

    let totalSegs = 0;

    // Per-plane segment arrays so each plane gets its own colored mesh.
    // Each plane also gets its own occupied-edge set so all planes receive
    // their full walk budget regardless of processing order.
    for (const plane of cubePlanes) {
      const planeSegs = [];
      const occupied  = new Set();   // per-plane: self-crossing termination only
      const meshKey   = `stone-walk-plane-${styleKey}-${plane.id}`;

      // Plane normal — used as the quad perpendicular in both mesh builders so
      // walk quads face outward from the plane and remain visible from the
      // face-on 2D camera regardless of segment direction.
      const pv = plane.vertices.positions;
      const du = [pv[1].x-pv[0].x, pv[1].y-pv[0].y, pv[1].z-pv[0].z];
      const dv = [pv[3].x-pv[0].x, pv[3].y-pv[0].y, pv[3].z-pv[0].z];
      const cn = [du[1]*dv[2]-du[2]*dv[1], du[2]*dv[0]-du[0]*dv[2], du[0]*dv[1]-du[1]*dv[0]];
      const cl = Math.sqrt(cn[0]*cn[0]+cn[1]*cn[1]+cn[2]*cn[2]) || 1;
      const planeNormal = [cn[0]/cl, cn[1]/cl, cn[2]/cl];

      // Face axis + direction.
      const axIdx   = plane.axis === 'x' ? 0 : plane.axis === 'y' ? 1 : 2;
      const p0      = plane.vertices.positions[0];
      const axVal   = axIdx === 0 ? p0.x : axIdx === 1 ? p0.y : p0.z;
      const faceIdx = Math.round((axVal - mn[axIdx]) / vs[axIdx]);
      const dir     = faceIdx === 0 ? 1 : -1;

      // Every candidate node is guaranteed to have glass in its perpendicular column.
      const candidates = glassColumnNodes(filled, axIdx, faceIdx);
      if (candidates.length === 0) {
        meshes[meshKey] = null;
        continue;
      }

      const seedBase = (plane.id || 0) * 0.137;
      const minWalks = isElite ? ELITE_MIN_WALKS : isAwake ? AWAKE_MIN_WALKS : MIN_WALKS;
      const maxWalks = isElite ? ELITE_MAX_WALKS : isAwake ? AWAKE_MAX_WALKS : MAX_WALKS;
      const nWalks   = minWalks + Math.floor(hash1([seedBase, 100, 0]) * (maxWalks - minWalks + 1));
      const selected = pickRandom(candidates, nWalks, seedBase);

      for (let wi = 0; wi < selected.length; wi++) {
        const startNode = selected[wi];
        const endNode   = runInitialRay(startNode, axIdx, dir, filled, occupied, planeSegs);
        const walkSeed  = seedBase + wi * 0.5731;
        runRandomWalk(endNode, axIdx, dir, walkSeed, occupied, planeSegs, filled);
      }

      // Drop segments whose either endpoint projects onto a label cell of any
      // cube plane. Cleaner than refusing steps inside the walker — leaves the
      // walk distribution otherwise untouched.
      const renderSegs = labelCells.size === 0 ? planeSegs : planeSegs.filter(seg =>
        !nodeProjectsToLabel(seg[0], seg[1], seg[2]) &&
        !nodeProjectsToLabel(seg[3], seg[4], seg[5])
      );

      totalSegs += renderSegs.length;
      const glowKey = `stone-walk-glow-${styleKey}-${plane.id}`;
      const haloKey = `stone-walk-halo-${styleKey}-${plane.id}`;
      meshes[meshKey] = buildWalkerMesh(gl, renderSegs, mn, vs, planeNormal);
      meshes[glowKey] = buildWalkerGlowMesh(gl, renderSegs, mn, vs, planeNormal, isAwake ? AWAKE_GLOW_WIDTH : GLOW_WIDTH, isAwake);
      meshes[haloKey] = isAwake
        ? buildWalkerGlowMesh(gl, renderSegs, mn, vs, planeNormal, AWAKE_GLOW_WIDTH * 1.55, true)
        : null;

      // Record touched voxel indices so build3DVoxels can boost their alpha.
      const touched = meshes[`stone-walk-touched-${motifIdx}`] || (meshes[`stone-walk-touched-${motifIdx}`] = new Set());
      for (const seg of renderSegs) {
        const vx = Math.max(0, Math.min(39, Math.min(seg[0], seg[3])));
        const vy = Math.max(0, Math.min(39, Math.min(seg[1], seg[4])));
        const vz = Math.max(0, Math.min(39, Math.min(seg[2], seg[5])));
        touched.add(vx * 1600 + vy * 40 + vz);
      }
    }

    meshes[`stone-walk-segs-${motifIdx}`] = totalSegs;
    meshes[builtKey] = true;
  }

  if (!meshes[builtKey]) return [];

  // One scene item per plane, each colored by its own axis.
  // Glow pass first (wide capsule SDF), core pass on top.
  const cubePlanes = allPlanes.filter(p => p.hierarchy?.motifIndex === motifIdx);
  const transform  = mat4(); identity(transform);
  const items = [];
  for (const plane of cubePlanes) {
    const meshKey = `stone-walk-plane-${styleKey}-${plane.id}`;
    const glowKey = `stone-walk-glow-${styleKey}-${plane.id}`;
    const haloKey = `stone-walk-halo-${styleKey}-${plane.id}`;
    const col = axisColor(plane.axis);
    const vividCol = isAwake
      ? new Float32Array([
          Math.min(2.2, col[0] * 1.85 + 0.18),
          Math.min(2.2, col[1] * 1.85 + 0.18),
          Math.min(2.2, col[2] * 1.85 + 0.18),
        ])
      : col;
    if (meshes[haloKey]) items.push({
      mesh: haloKey, material: 'normie-glow', transform, blend: 'additive',
      uniforms: { uTint: vividCol, uAlpha: 0.07 },
    });
    if (meshes[glowKey]) items.push({
      mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
      uniforms: { uTint: vividCol, uAlpha: isAwake ? 0.18 : GLOW_OPACITY },
    });
    if (meshes[meshKey]) items.push({
      mesh: meshKey, material: 'lines', transform, blend: 'additive',
      uniforms: { uBaseCol: vividCol, uLineOpacity: isAwake ? 0.72 : LINE_OPACITY },
    });
  }
  return items;
}

// ---- Walk a PROCEDURAL shape (empty-slot crystal biomes) --------------------
// Reuses the exact walk core, but on a caller-supplied `filled` voxel array
// instead of normie pixels. `mn`/`vs` are the local grid origin + voxel size the
// segments are emitted in; `transform` orients that local space onto the cube's
// unique-axis plane (same matrix the crystal glass uses). One shared occupied-
// edge set across all faces so cross-path termination works. Cached under
// `prefix`. Colour is a single tint (empty slots have no per-plane axis art).
export function buildWalkerItemsFromFilled(gl, meshes, prefix, filled, mn, vs, transform, seed, opts = {}) {
  const {
    walksPerFace = 4,
    maxSteps = 24,               // bound each walk — empty-slot traces stay short + cheap
    tint = new Float32Array([1.6, 1.7, 1.9]),
    coreOpacity = LINE_OPACITY,
    glowOpacity = GLOW_OPACITY,
    glowWidth = GLOW_WIDTH,
    normal = [0, 1, 0],
  } = opts;

  const builtKey = `${prefix}-built`;
  const coreKey  = `${prefix}-core`;
  const glowKey  = `${prefix}-glow`;

  if (meshes[builtKey] === undefined) {
    const allSegs = [];
    const occupied = new Set();
    let wi = 0;
    for (let axIdx = 0; axIdx < 3; axIdx++) {
      for (const faceIdx of [0, 40]) {
        const dir = faceIdx === 0 ? 1 : -1;
        const candidates = glassColumnNodes(filled, axIdx, faceIdx);
        if (candidates.length === 0) continue;
        const selected = pickRandom(candidates, walksPerFace, seed + axIdx * 13.1 + faceIdx * 0.07);
        for (const startNode of selected) {
          const end = runInitialRay(startNode, axIdx, dir, filled, occupied, allSegs);
          runRandomWalk(end, axIdx, dir, seed + wi * 0.5731 + 1.3, occupied, allSegs, filled, maxSteps);
          wi++;
        }
      }
    }
    meshes[coreKey] = buildWalkerMesh(gl, allSegs, mn, vs, normal);
    meshes[glowKey] = buildWalkerGlowMesh(gl, allSegs, mn, vs, normal, glowWidth, false);
    meshes[builtKey] = allSegs.length;
  }

  if (!meshes[builtKey]) return [];
  const xf = transform || identity(mat4());
  const items = [];
  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform: xf, blend: 'additive',
    uniforms: { uTint: tint, uAlpha: glowOpacity },
  });
  if (meshes[coreKey]) items.push({
    mesh: coreKey, material: 'lines', transform: xf, blend: 'additive',
    uniforms: { uBaseCol: tint, uLineOpacity: coreOpacity },
  });
  return items;
}
