import { createMeshGL } from '../renderer/src/geometry.js';
import { mat4, identity } from '../renderer/src/math.js';
import { hash1, V } from './tree-walker.js';
import { makePlanePixelFn, buildVoxelMesh, ensureBannerFont, renderBannerTexture } from './normies-manager.js';
import { otsuRecursiveBands, otsuMultiLevelThresholds } from './nft-art-grid.js?v=20260826-3';
import { buildWalkGlowMeshWS, buildWalkCoreMeshWS } from './materials/stone-walker.js';
import { planeBasis, uvToWorld, artCorners } from './materials/plane-2d.js';
import { buildIdLabelFor } from './normie/label.js';

const { add: vadd, sub: vsub, scale: vscale, dot: vdot, cross: vcross, len: vlen, norm: vnorm } = V;

// Grid + assignment come from INJECTED resolvers (setNonNormieResolvers) rather than
// importing the wallet/fetch module, so this file carries no network code and can
// live in the on-chain production bundle. The dev viewer injects the wallet-nfts
// accessors; the production animation injects tonal-derived ones.
let _getGrid = () => null;
let _getAssignment = () => null;
export function setNonNormieResolvers(r) {
  if (r && r.getGrid) _getGrid = r.getGrid;
  if (r && r.getAssignment) _getAssignment = r.getAssignment;
}
const getNonNormieGridForCube = (idx) => _getGrid(idx);
const getWalletAssignmentForCube = (idx) => _getAssignment(idx);

// Network-free grid straight from the embedded 2-bit tonal payload (400 bytes,
// base64) — the production path (no fetch, no flatten). Carries exact bands so the
// contours match the on-chain thumbnail.
export function gridFromTonal(b64) {
  const s = atob(String(b64 || ''));
  if (s.length !== 400) return null;
  const bands = new Uint8Array(1600), bits = new Uint8Array(1600), grayscale = new Float32Array(1600);
  for (let i = 0; i < 1600; i++) {
    const b = (s.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
    bands[i] = b; bits[i] = b > 0 ? 1 : 0; grayscale[i] = b / 3;
  }
  return { gridSize: 40, depthLayers: 40, kind: 'pixel', discarded: false, bits, grayscale, bands };
}

const RED = new Float32Array([1.0, 0.02, 0.02]);
const VOXEL_RED = new Float32Array([1.0, 0.08, 0.04]);
// Per-band alpha: edge/sparse voxels (band 0) brightest, solid interior dimmest.
const VOXEL_BAND_ALPHAS = [1.0, 0.75, 0.50, 0.25, 0.10];
const CORE_WIDTH = 0.000315;
const GLOW_WIDTH = 0.0112;
const LINE_OPACITY = 0.95;
const GLOW_OPACITY = 0.62;
const NEON_WHITE_WIDTH   = 0.004;
const NEON_WHITE_OPACITY = 0.5;
const NEON_WHITE_TINT    = new Float32Array([1.4, 1.4, 1.4]);

const SAT_BOOST = 2.6;
const HDR_GAIN = 1.8;
const WALK_MIN = 12;
const WALK_MAX = 22;
const WALK_TERMINATE_PROB = 0.006;
const WALK_MAX_SURFACE_STEPS = 6;
const WALK_CORE_WIDTH = 0.0015;
const WALK_GLOW_WIDTH = 0.014;
const WALK_LINE_OPACITY = 0.65;
const WALK_GLOW_OPACITY = 0.12;
const WALK_SAFETY_STEPS = 4000;
const artPlaneLogCache = new Set();

function logOnce(key, level, msg, data) {
  if (artPlaneLogCache.has(key)) return;
  artPlaneLogCache.add(key);
  console[level](msg, data);
}

function luminescentTint(tint) {
  const lum = tint[0]*0.299 + tint[1]*0.587 + tint[2]*0.114;
  return new Float32Array([
    (lum + (tint[0]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[1]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[2]-lum)*SAT_BOOST)*HDR_GAIN,
  ]);
}

function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors?.[axis])
    ? CONFIG.axisColors[axis].hex : '#ffffff';
  const r = parseInt(hex.substr(1, 2), 16) / 255;
  const g = parseInt(hex.substr(3, 2), 16) / 255;
  const b = parseInt(hex.substr(5, 2), 16) / 255;
  return new Float32Array([r, g, b]);
}

function binaryMaskFromGrayscale(grayscale, threshold, size) {
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    mask[i] = grayscale[i] >= threshold ? 1 : 0;
  }
  return mask;
}

function findSilhouetteEdgesForSize(bits, size) {
  if (!bits || bits.length !== size * size) return [];
  const at = (row, col) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return 0;
    return bits[row * size + col];
  };
  const segs = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!at(row, col)) continue;
      const u0 = col / size, u1 = (col + 1) / size;
      const v0 = row / size, v1 = (row + 1) / size;
      if (!at(row, col - 1)) segs.push({ ua: u0, va: v0, ub: u0, vb: v1 });
      if (!at(row, col + 1)) segs.push({ ua: u1, va: v0, ub: u1, vb: v1 });
      if (!at(row - 1, col)) segs.push({ ua: u0, va: v0, ub: u1, vb: v0 });
      if (!at(row + 1, col)) segs.push({ ua: u0, va: v1, ub: u1, vb: v1 });
    }
  }
  return segs;
}

function findBandContourEdges(bands, size) {
  if (!bands || bands.length !== size * size) return [];
  const segs = [];
  for (let row = 0; row < size; row++) {
    for (let col = 1; col < size; col++) {
      if (bands[row * size + (col - 1)] === bands[row * size + col]) continue;
      const u = col / size;
      segs.push({ ua: u, va: row / size, ub: u, vb: (row + 1) / size });
    }
  }
  for (let row = 1; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (bands[(row - 1) * size + col] === bands[row * size + col]) continue;
      const v = row / size;
      segs.push({ ua: col / size, va: v, ub: (col + 1) / size, vb: v });
    }
  }
  return segs;
}

const OUTLINE_SIZE = 40;

// Unified outline for all grid types: downsample to 40×40, apply 2-level Otsu (3 bands),
// draw edges between any adjacent cells in different bands. Falls back to 1-level silhouette
// if the 3-band pass produces nothing (e.g. very uniform images).
function getOutlineSegs(grid) {
  // Exact stored tonal bands (the on-chain 2-bit payload) take priority over
  // re-Otsu-ing the grayscale, so the cube contours match the thumbnail exactly.
  if (grid.bands && (grid.gridSize || OUTLINE_SIZE) === OUTLINE_SIZE) {
    const segs = findBandContourEdges(grid.bands, OUTLINE_SIZE);
    if (segs.length > 0) return segs;
  }
  const grayscale = grid.grayscale;
  if (!grayscale) return [];
  const rawSize = grid.gridSize || OUTLINE_SIZE;
  const gs40 = rawSize > OUTLINE_SIZE
    ? downsampleGrayscale(grayscale, rawSize, OUTLINE_SIZE)
    : grayscale;
  const thresholds = otsuMultiLevelThresholds(gs40, 2) || [];
  const bands = new Uint8Array(OUTLINE_SIZE * OUTLINE_SIZE);
  for (let i = 0; i < bands.length; i++) {
    let b = 0;
    for (const t of thresholds) { if (gs40[i] >= t) b++; }
    bands[i] = b;
  }
  const segs = findBandContourEdges(bands, OUTLINE_SIZE);
  if (segs.length > 0) return segs;
  // Fallback: single Otsu threshold → silhouette of the foreground region.
  const t1 = otsuMultiLevelThresholds(gs40, 1);
  const mask = binaryMaskFromGrayscale(gs40, (t1 && t1[0]) ?? 0.5, OUTLINE_SIZE);
  return findSilhouetteEdgesForSize(mask, OUTLINE_SIZE);
}

// Returns the binary mask and effective size to use for walker candidate selection.
// Smooth art is downsampled to 40×40 + Otsu; pixel art uses grid.bits unless trivial.
function getWalkMask(grid) {
  const rawSize = grid.gridSize || 40;
  if (grid.kind !== 'smooth' && grid.bits) {
    let ones = 0;
    for (let i = 0; i < grid.bits.length; i++) ones += grid.bits[i];
    if (ones > 0 && ones < grid.bits.length) return { mask: grid.bits, size: rawSize };
  }
  const gs = (grid.kind === 'smooth' && rawSize > 40)
    ? downsampleGrayscale(grid.grayscale, rawSize, 40)
    : grid.grayscale;
  const sz = (grid.kind === 'smooth') ? 40 : rawSize;
  const otsuTs = otsuMultiLevelThresholds(gs, 1);
  const t = (otsuTs && otsuTs.length > 0) ? otsuTs[0] : 0.5;
  return { mask: binaryMaskFromGrayscale(gs, t, sz), size: sz };
}

function cubeBoundsFromPlanes(motifIdx, allPlanes) {
  const mn = [ Infinity,  Infinity,  Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const plane of (allPlanes || [])) {
    if (plane.hierarchy?.motifIndex !== motifIdx) continue;
    for (const p of plane.vertices.positions) {
      if (p.x < mn[0]) mn[0] = p.x; if (p.x > mx[0]) mx[0] = p.x;
      if (p.y < mn[1]) mn[1] = p.y; if (p.y > mx[1]) mx[1] = p.y;
      if (p.z < mn[2]) mn[2] = p.z; if (p.z > mx[2]) mx[2] = p.z;
    }
  }
  if (!Number.isFinite(mn[0])) return null;
  return {
    mn,
    mx,
    center: [(mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5],
    halfSize: Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5,
  };
}

function findMainPlane(motifIdx, allPlanes) {
  const cubePlanes = (allPlanes || []).filter(p => p.hierarchy?.motifIndex === motifIdx);
  if (cubePlanes.length === 0) return null;
  const axisCounts = {};
  for (const p of cubePlanes) axisCounts[p.axis] = (axisCounts[p.axis] || 0) + 1;
  const uniqueAxis = Object.keys(axisCounts).find(ax => axisCounts[ax] === 1);
  return uniqueAxis ? cubePlanes.find(p => p.axis === uniqueAxis) : cubePlanes[0];
}

function isMainPlane(plane, allPlanes) {
  const mainPlane = findMainPlane(plane.hierarchy?.motifIndex, allPlanes);
  return !mainPlane || mainPlane.id === plane.id;
}

function edgeKey3D(a, b) {
  const ka = `${a[0]},${a[1]},${a[2]}`;
  const kb = `${b[0]},${b[1]},${b[2]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function isValidWalkCell(col, row, dz, bands, size, layers) {
  if (col < 0 || col >= size || row < 0 || row >= size) return false;
  if (dz < 0 || dz >= layers) return false;
  return bands[row * size + col] >= 1;
}

function pickRandomDeterministic(arr, n, seedBase) {
  if (arr.length <= n) return [...arr];
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(hash1([seedBase, i, 0]) * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map(i => arr[i]);
}

function runWalkOnBands(start, initAxis, initDir, bands, size, layers, occupied, segs, seed) {
  let cur = [...start];
  let curAxis = initAxis;
  let curDir = initDir;
  let s = seed;
  let flying = false;
  let surfaceSteps = 0;

  for (let safety = 0; safety < WALK_SAFETY_STEPS; safety++) {
    s = hash1([s, 0, 0]);
    if (s < WALK_TERMINATE_PROB) break;

    if (!flying) {
      const turns = [];
      const straights = [];
      for (let ax = 0; ax < 3; ax++) {
        for (let d = -1; d <= 1; d += 2) {
          const nxt = [cur[0], cur[1], cur[2]];
          nxt[ax] += d;
          if (!isValidWalkCell(nxt[0], nxt[1], nxt[2], bands, size, layers)) continue;
          const ek = edgeKey3D(cur, nxt);
          if (occupied.has(ek)) continue;
          (ax === curAxis ? straights : turns).push({ nxt, ek, ax, d });
        }
      }

      const pool = turns.length > 0 ? turns : straights;
      if (pool.length === 0) { flying = true; surfaceSteps = 0; continue; }

      s = hash1([s, 1, 0]);
      const choice = Math.min(Math.floor(s * pool.length), pool.length - 1);
      const { nxt, ek, ax, d } = pool[choice];
      occupied.add(ek);
      segs.push([cur[0], cur[1], cur[2], nxt[0], nxt[1], nxt[2]]);
      cur = nxt; curAxis = ax; curDir = d;
      if (++surfaceSteps >= WALK_MAX_SURFACE_STEPS) { flying = true; surfaceSteps = 0; }

    } else {
      // Flight: travel straight in last col/row direction through empty 2D cells.
      const flyAx = curAxis === 2 ? 0 : curAxis;
      const nxt = [cur[0], cur[1], cur[2]];
      nxt[flyAx] += curDir;
      if (nxt[flyAx] < 0 || nxt[flyAx] >= size) break;
      if (isValidWalkCell(nxt[0], nxt[1], nxt[2], bands, size, layers)) {
        // Arrived at a filled cell — land on surface.
        flying = false; surfaceSteps = 0; continue;
      }
      const ek = edgeKey3D(cur, nxt);
      if (occupied.has(ek)) break;
      occupied.add(ek);
      segs.push([cur[0], cur[1], cur[2], nxt[0], nxt[1], nxt[2]]);
      cur = nxt;
    }
  }
}

export function buildNonNormieWalker(plane, allPlanes, gl, meshes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return [];

  const grid = getNonNormieGridForCube(motifIdx);
  if (!grid || grid.discarded || grid.error) return [];
  if (!grid.grayscale && !grid.bits) return [];

  const bounds = cubeBoundsFromPlanes(motifIdx, allPlanes);
  if (!bounds) return [];

  const layers = grid.depthLayers || 8;

  const walkerKey = `non-normie-walker-${plane.id}`;
  const walkerGlowKey = `non-normie-walker-glow-${plane.id}`;

  if (meshes[walkerKey] === undefined) {
    const { mask, size } = getWalkMask(grid);
    const candidates = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (mask[row * size + col] < 1) continue;
        for (let dz = 0; dz < layers; dz++) {
          candidates.push([col, row, dz]);
        }
      }
    }
    if (candidates.length === 0) {
      meshes[walkerKey] = null;
      meshes[walkerGlowKey] = null;
      return [];
    }

    const seedBase = (plane.id || 0) * 0.137 + 0.91;
    const nWalks = WALK_MIN + Math.floor(hash1([seedBase, 100, 0]) * (WALK_MAX - WALK_MIN + 1));
    const selected = pickRandomDeterministic(candidates, nWalks, seedBase);

    const occupied = new Set();
    const cellSegs = [];
    for (let wi = 0; wi < selected.length; wi++) {
      const start = selected[wi];
      const initAxis = Math.floor(hash1([seedBase, wi, 7]) * 3) % 3;
      const initDir  = hash1([seedBase, wi, 8]) < 0.5 ? -1 : 1;
      const walkSeed = seedBase + wi * 0.5731;
      runWalkOnBands(start, initAxis, initDir, mask, size, layers, occupied, cellSegs, walkSeed);
    }

    if (cellSegs.length === 0) {
      meshes[walkerKey] = null;
      meshes[walkerGlowKey] = null;
      void (`[non-normie-walker] plane ${plane.id} cube ${motifIdx}: no walk segments`, {
        candidates: candidates.length,
        walks: nWalks,
      });
      return [];
    }

    const p = artCorners(plane);
    let n = planeBasis(plane).N;
    const planeCenter = uvToWorld(0.5, 0.5, p);
    if (vdot(vsub(bounds.center, planeCenter), n) < 0) n = vscale(n, -1);
    const depth = Math.max(1e-4, vdot(vsub(bounds.center, planeCenter), n) + bounds.halfSize);
    const dCell = vscale(n, depth / layers);

    const flat = new Float32Array(cellSegs.length * 6);
    let fi = 0;
    for (const seg of cellSegs) {
      const onA = uvToWorld(seg[0] / size, seg[1] / size, p);
      const a = vadd(onA, vscale(dCell, seg[2]));
      const onB = uvToWorld(seg[3] / size, seg[4] / size, p);
      const b = vadd(onB, vscale(dCell, seg[5]));
      flat[fi++] = a[0]; flat[fi++] = a[1]; flat[fi++] = a[2];
      flat[fi++] = b[0]; flat[fi++] = b[1]; flat[fi++] = b[2];
    }

    meshes[walkerKey]     = buildWalkCoreMeshWS(gl, flat, n, WALK_CORE_WIDTH);
    meshes[walkerGlowKey] = buildWalkGlowMeshWS(gl, flat, n, WALK_GLOW_WIDTH);

    void (`[non-normie-walker] plane ${plane.id} cube ${motifIdx}: built random walks`, {
      planeAxis: plane.axis,
      nft: `${nft.contract}:${nft.tokenId}`,
      kind: grid.kind || 'pixel',
      candidates: candidates.length,
      walks: nWalks,
      segments: cellSegs.length,
      gridSize: size,
      depthLayers: layers,
    });
  }

  if (!meshes[walkerKey] && !meshes[walkerGlowKey]) return [];

  const col = luminescentTint(axisColorLinear(plane.axis));
  const transform = mat4(); identity(transform);
  const items = [];
  if (meshes[walkerGlowKey]) items.push({
    mesh: walkerGlowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: col, uAlpha: WALK_GLOW_OPACITY },
  });
  if (meshes[walkerKey]) items.push({
    mesh: walkerKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: col, uLineOpacity: WALK_LINE_OPACITY },
  });
  return items;
}

function downsampleGrayscale(src, srcSize, dstSize) {
  const factor = srcSize / dstSize;
  const dst = new Float32Array(dstSize * dstSize);
  for (let row = 0; row < dstSize; row++) {
    for (let col = 0; col < dstSize; col++) {
      const r0 = Math.floor(row * factor), r1 = Math.min(srcSize, Math.ceil((row + 1) * factor));
      const c0 = Math.floor(col * factor), c1 = Math.min(srcSize, Math.ceil((col + 1) * factor));
      let sum = 0, count = 0;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) { sum += src[r * srcSize + c]; count++; }
      }
      dst[row * dstSize + col] = count > 0 ? sum / count : 0;
    }
  }
  return dst;
}

function buildArtworkVoxelMesh(gl, motifIdx, allPlanes, bounds, grid, meshes) {
  if (!grid?.grayscale) return null;
  const cubePlanes = (allPlanes || []).filter(p => p.hierarchy?.motifIndex === motifIdx);
  if (cubePlanes.length === 0) return null;

  // makePlanePixelFn is hardcoded to 40×40 — downsample smooth 120×120 grids to match.
  const TARGET_SIZE = 40;
  const rawSize = grid.gridSize || TARGET_SIZE;
  const grayscale40 = rawSize > TARGET_SIZE
    ? downsampleGrayscale(grid.grayscale, rawSize, TARGET_SIZE)
    : grid.grayscale;
  const srcSize = TARGET_SIZE;

  // Run intersection at half resolution to cap voxel count.
  // Flat-color images fill most of the volume; full 40³ = 64K voxels is too heavy.
  const size = Math.ceil(srcSize / 2); // 20

  const mn = bounds.mn;
  const mx = bounds.mx;
  const voxelSize = [
    (mx[0] - mn[0]) / size,
    (mx[1] - mn[1]) / size,
    (mx[2] - mn[2]) / size,
  ];

  // Otsu threshold → minority class: always select the smaller region (foreground, not background).
  const otsuTs = otsuMultiLevelThresholds(grayscale40, 1);
  const otsuT = (otsuTs && otsuTs.length > 0) ? otsuTs[0] : 0.5;
  const planeMask = binaryMaskFromGrayscale(grayscale40, otsuT, srcSize);
  let onCount = 0;
  for (let i = 0; i < planeMask.length; i++) onCount += planeMask[i];
  if (onCount * 2 > planeMask.length) {
    for (let i = 0; i < planeMask.length; i++) planeMask[i] ^= 1;
  }
  // Projection functions must sample from the original srcSize grid.
  const srcVoxelSize = [
    (mx[0] - mn[0]) / srcSize,
    (mx[1] - mn[1]) / srcSize,
    (mx[2] - mn[2]) / srcSize,
  ];
  const planePixelFns = cubePlanes.map(pl => makePlanePixelFn(pl, mn, srcVoxelSize, artCorners(pl)));
  const maxScore = cubePlanes.length;

  // 3D boolean intersection at reduced resolution.
  const filled = new Uint8Array(size * size * size);
  for (let xi = 0; xi < size; xi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let zi = 0; zi < size; zi++) {
        // Map reduced-resolution voxel centre back to srcSize coordinate space.
        const sxi = xi * 2 + 1, syi = yi * 2 + 1, szi = zi * 2 + 1;
        let score = 0;
        for (let p = 0; p < cubePlanes.length; p++) {
          score += planeMask[planePixelFns[p](sxi, syi, szi)];
        }
        if (score >= maxScore) filled[xi * size * size + yi * size + zi] = 1;
      }
    }
  }

  // Per-voxel pseudo-grayscale: 8-neighbor density projected from each plane.
  // Sparse/edge voxels get low values → high alpha (bright); dense interior gets high values → dim.
  const voxelGrayscale = new Float32Array(size * size * size);
  const grayscaleSamples = [];
  for (let xi = 0; xi < size; xi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let zi = 0; zi < size; zi++) {
        const vi = xi * size * size + yi * size + zi;
        if (!filled[vi]) continue;
        const sxi = xi * 2 + 1, syi = yi * 2 + 1, szi = zi * 2 + 1;
        let sum = 0;
        for (let pp = 0; pp < cubePlanes.length; pp++) {
          const pidx = planePixelFns[pp](sxi, syi, szi);
          const pcol = pidx % srcSize;
          const prow = (pidx / srcSize) | 0;
          let count = 0, possible = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const r = prow + dr, c = pcol + dc;
              if (r < 0 || r >= srcSize || c < 0 || c >= srcSize) continue;
              possible++;
              count += planeMask[r * srcSize + c];
            }
          }
          sum += possible > 0 ? count / possible : 0;
        }
        const g = sum / cubePlanes.length;
        voxelGrayscale[vi] = g;
        grayscaleSamples.push(g);
      }
    }
  }

  const numBands = VOXEL_BAND_ALPHAS.length;
  const bandThresholds = grayscaleSamples.length >= numBands
    ? otsuRecursiveBands(new Float32Array(grayscaleSamples), numBands)
    : Array.from({ length: numBands - 1 }, (_, i) => (i + 1) / numBands);

  // Collect center/alpha/variant tuples first (minimal allocations), then
  // pre-allocate typed arrays for the final geometry in one pass.
  // Alpha uses the same compound formula as normie voxels: falloff × variety ×
  // interiorMult × denseMult × band — so only surface voxels near the cube
  // centre remain visible; buried interior and peripheral voxels fade out.
  const ci = (size - 1) / 2;

  function filledAt3D(xi, yi, zi) {
    if (xi < 0 || xi >= size || yi < 0 || yi >= size || zi < 0 || zi >= size) return 0;
    return filled[xi * size * size + yi * size + zi];
  }

  const centers = [];
  const alphaValues = [];
  const variantValues = [];

  for (let xi = 0; xi < size; xi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let zi = 0; zi < size; zi++) {
        const vi = xi * size * size + yi * size + zi;
        if (!filled[vi]) continue;

        // Chebyshev distance from grid centre, normalised [0..1].
        const t = Math.max(
          Math.abs(xi - ci) / ci,
          Math.abs(yi - ci) / ci,
          Math.abs(zi - ci) / ci,
        );
        const falloff = 0.90 - 0.85 * t;

        // Interior suppression: surface voxels bright, buried voxels dim.
        const axisN =
          filledAt3D(xi-1, yi, zi) + filledAt3D(xi+1, yi, zi) +
          filledAt3D(xi, yi-1, zi) + filledAt3D(xi, yi+1, zi) +
          filledAt3D(xi, yi, zi-1) + filledAt3D(xi, yi, zi+1);
        let n26 = 0;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              if (dx !== 0 || dy !== 0 || dz !== 0)
                n26 += filledAt3D(xi+dx, yi+dy, zi+dz);
        const interiorMult = 1.0 - 0.84 * Math.pow(axisN / 6, 1.35);
        const denseMult    = 1.0 - 0.38 * Math.pow(n26 / 26, 1.05);

        // Deterministic per-voxel variety.
        let h = ((xi * 73856093) ^ (yi * 19349663) ^ (zi * 83492791)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        const rand = h / 0xFFFFFFFF;
        const variety = 0.35 + rand * 0.65;

        const g = voxelGrayscale[vi];
        let band = numBands - 1;
        for (let b = 0; b < bandThresholds.length; b++) {
          if (g <= bandThresholds[b]) { band = b; break; }
        }

        centers.push([
          mn[0] + (xi + 0.5) * voxelSize[0],
          mn[1] + (yi + 0.5) * voxelSize[1],
          mn[2] + (zi + 0.5) * voxelSize[2],
        ]);
        alphaValues.push(falloff * variety * interiorMult * denseMult * VOXEL_BAND_ALPHAS[band]);
        variantValues.push(rand);
      }
    }
  }

  if (centers.length === 0) return null;
  return buildVoxelMesh(gl, centers, alphaValues, variantValues, voxelSize);
}

export function buildNonNormieArtworkPlane(plane, allPlanes, gl, meshes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft) {
    logOnce(`no-wallet:${motifIdx}`, 'debug', `[non-normie-art] cube ${motifIdx}: no wallet assignment yet`);
    return [];
  }
  if (nft.isNormie) return [];

  const grid = getNonNormieGridForCube(motifIdx);
  if (!grid) {
    logOnce(`waiting:${motifIdx}`, 'info', `[non-normie-art] cube ${motifIdx}: waiting for artwork grid`, {
      planeId: plane.id,
      nft: `${nft.contract}:${nft.tokenId}`,
      imageUrl: nft.imageUrl,
      name: nft.name,
    });
    return [];
  }
  if (grid.error) {
    logOnce(`error:${motifIdx}`, 'warn', `[non-normie-art] cube ${motifIdx}: artwork grid failed`, {
      error: grid.error,
      nft: `${nft.contract}:${nft.tokenId}`,
      imageUrl: nft.imageUrl,
    });
    return [];
  }
  if (grid.discarded) {
    logOnce(`discarded:${motifIdx}`, 'info', `[non-normie-art] cube ${motifIdx}: artwork discarded`, {
      reason: grid.reason,
      inferredGrid: grid.pixelGrid ? `${grid.pixelGrid.gridW}x${grid.pixelGrid.gridH}` : null,
      score: grid.pixelGrid?.score,
      flatness: grid.pixelGrid?.flatness,
      nft: `${nft.contract}:${nft.tokenId}`,
      name: nft.name,
    });
    return [];
  }
  if (!grid.bits && !grid.grayscale) return [];

  const lineKey      = `non-normie-art-line-${plane.id}`;
  const glowKey      = `non-normie-art-glow-${plane.id}`;
  const whiteGlowKey = `non-normie-art-white-${plane.id}`;
  const voxelKey = `non-normie-art-voxels-${motifIdx}`;
  const infoKey = `non-normie-art-voxels-info-${motifIdx}`;

  const isPixelGrid = grid.kind === 'pixel';
  const planeIsMain = isMainPlane(plane, allPlanes);

  if (meshes[lineKey] === undefined) {
    const segs = getOutlineSegs(grid);
    void (`[non-normie-art] cube ${motifIdx}: building artwork outline`, {
      planeId: plane.id,
      planeAxis: plane.axis,
      nft: `${nft.contract}:${nft.tokenId}`,
      kind: grid.kind || 'pixel',
      gridSize: OUTLINE_SIZE,
      segments: segs.length,
      name: nft.name,
    });
    const flat = new Float32Array(segs.length * 6);
    const p = artCorners(plane);
    let i = 0;
    for (const { ua, va, ub, vb } of segs) {
      const a = uvToWorld(ua, va, p);
      const b = uvToWorld(ub, vb, p);
      flat[i++] = a[0]; flat[i++] = a[1]; flat[i++] = a[2];
      flat[i++] = b[0]; flat[i++] = b[1]; flat[i++] = b[2];
    }

    const normal = planeBasis(plane).N;
    meshes[lineKey]      = buildWalkCoreMeshWS(gl, flat, normal, CORE_WIDTH);
    meshes[glowKey]      = buildWalkGlowMeshWS(gl, flat, normal, GLOW_WIDTH);
    meshes[whiteGlowKey] = buildWalkGlowMeshWS(gl, flat, normal, NEON_WHITE_WIDTH);
  }

  // Voxel volume: main plane only — one volume per cube.
  if (planeIsMain && meshes[voxelKey] === undefined) {
    const bounds = cubeBoundsFromPlanes(motifIdx, allPlanes);
    if (bounds) {
      meshes[infoKey] = {
        center: new Float32Array(bounds.center),
        halfSize: bounds.halfSize,
      };
      meshes[voxelKey] = buildArtworkVoxelMesh(gl, motifIdx, allPlanes, bounds, grid, meshes);
      void (`[non-normie-art] cube ${motifIdx}: building 3D intersection voxels`, {
        planeId: plane.id,
        nft: `${nft.contract}:${nft.tokenId}`,
        kind: grid.kind || 'pixel',
        rawGridSize: grid.gridSize || 40,
        voxelGridSize: 40,
        depthMode: '3d-intersection',
        inferredGrid: grid.pixelGrid ? `${grid.pixelGrid.gridW}x${grid.pixelGrid.gridH}` : null,
        planes: allPlanes.filter(p => p.hierarchy?.motifIndex === motifIdx).length,
      });
    } else {
      meshes[voxelKey] = null;
    }
  }

  // Outline (silhouette + contour bands) takes its colour from the plane's
  // axis — same R/G/B-by-X/Y/Z mapping as Normies. Voxel volume and walks
  // intentionally stay red so the non-Normie aesthetic remains distinct.
  const col = luminescentTint(axisColorLinear(plane.axis));
  const transform = mat4(); identity(transform);
  const items = [];
  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: col, uAlpha: GLOW_OPACITY },
  });
  if (meshes[whiteGlowKey]) items.push({
    mesh: whiteGlowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: NEON_WHITE_TINT, uAlpha: NEON_WHITE_OPACITY },
  });
  if (meshes[lineKey]) items.push({
    mesh: lineKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: col, uLineOpacity: LINE_OPACITY },
  });
  if (meshes[voxelKey] && meshes[infoKey]) items.push({
    mesh: voxelKey, material: 'normie-voxel', transform, blend: 'alpha',
    uniforms: {
      uTint: VOXEL_RED,
      uAlpha: 0.22,
      uLightScale: 1.0,
      uCubeCenter: meshes[infoKey].center,
      uCubeHalfSize: meshes[infoKey].halfSize,
    },
  });
  return items;
}

// Source-token "#NNNN" label for non-Normie cubes (matches the thumbnail's label),
// drawn alongside the contract banner in the plane's axis colour.
export function buildNonNormieIdLabel(plane, allPlanes, gl, meshes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return [];
  return buildIdLabelFor(plane, gl, meshes, Number(nft.tokenId) || 0, 'nonnormie-id');
}

// Source-contract banner — the cube's source collection address as a hex strip.
// Used for EVERY cube (Normie shows the Normies contract, non-Normie its source),
// so the banner is consistent across all artwork.
export function buildNonNormieBanner(plane, allPlanes, gl, meshes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || !nft.contract) return [];
  if (!ensureBannerFont()) return [];

  const raw = String(nft.contract || '');
  const hex = (raw.startsWith('0x') || raw.startsWith('0X')) ? raw.slice(2) : raw;
  const text = hex.slice(0, 40).toUpperCase();
  if (!text) return [];

  const bounds = cubeBoundsFromPlanes(motifIdx, allPlanes);
  if (!bounds) return [];
  const { mn, mx } = bounds;
  const cubeCenter = [(mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5];
  const halfExtent = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5;

  const p = artCorners(plane);
  const uVec = [p[1].x-p[0].x, p[1].y-p[0].y, p[1].z-p[0].z];
  const vVec = [p[3].x-p[0].x, p[3].y-p[0].y, p[3].z-p[0].z];
  let nx = uVec[1]*vVec[2] - uVec[2]*vVec[1];
  let ny = uVec[2]*vVec[0] - uVec[0]*vVec[2];
  let nz = uVec[0]*vVec[1] - uVec[1]*vVec[0];
  const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const pc = uvToWorld(0.5, 0.5, p);
  const toCenter = [cubeCenter[0]-pc[0], cubeCenter[1]-pc[1], cubeCenter[2]-pc[2]];
  if (nx*toCenter[0] + ny*toCenter[1] + nz*toCenter[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const depthDist = Math.max(1e-4, nx*toCenter[0] + ny*toCenter[1] + nz*toCenter[2] + halfExtent);

  const bannerWCells = 3;
  const seed = (plane.id || 0) * 0.137 + 1.71;
  const uStart = Math.floor(hash1([seed, 11, 0]) * (40 - bannerWCells + 1));
  const vPos   = Math.floor(hash1([seed, 22, 0]) * 40);

  const nearLeft  = uvToWorld(uStart / 40,                   (vPos + 0.5) / 40, p);
  const nearRight = uvToWorld((uStart + bannerWCells) / 40,  (vPos + 0.5) / 40, p);
  const farLeft   = [nearLeft[0]  + nx*depthDist, nearLeft[1]  + ny*depthDist, nearLeft[2]  + nz*depthDist];
  const farRight  = [nearRight[0] + nx*depthDist, nearRight[1] + ny*depthDist, nearRight[2] + nz*depthDist];

  const meshKey = `non-normie-banner-quad-${plane.id}`;
  const texKey  = `non-normie-banner-tex-${plane.id}`;
  if (meshes[meshKey] === undefined) {
    const positions = new Float32Array([
      nearLeft[0],  nearLeft[1],  nearLeft[2],
      nearRight[0], nearRight[1], nearRight[2],
      farRight[0],  farRight[1],  farRight[2],
      farLeft[0],   farLeft[1],   farLeft[2],
    ]);
    const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    meshes[meshKey] = createMeshGL(gl, { positions, uvs, indices });
    meshes[texKey]  = renderBannerTexture(gl, text);
  }

  const transform = mat4(); identity(transform);
  const tex = meshes[texKey];
  return [
    {
      mesh: meshKey, material: 'text-banner', transform, blend: 'additive',
      uniforms: { uTint: NEON_WHITE_TINT, uAlpha: 0.7, uMode: 0 },
      samplers: { uTextTex: tex },
    },
    {
      mesh: meshKey, material: 'text-banner', transform, blend: 'alpha',
      transparentLayer: 1,
      uniforms: { uTint: NEON_WHITE_TINT, uAlpha: 0.15, uMode: 1 },
      samplers: { uTextTex: tex },
    },
  ];
}
