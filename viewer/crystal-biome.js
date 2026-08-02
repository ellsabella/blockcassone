// Empty-slot biomes, rebuilt from the cube ecosystem's own primitives.
//
// Instead of six bespoke natural-scene shaders, each unminted slot renders a
// GLASS-CRYSTAL FORMATION (reusing cube-glass's nested-box renderer) — a crystal
// *growth* on the slot floor, so an empty plot reads in the same visual language
// as a populated cube but is clearly unformed (no outer shell, no source art).
//
// Orientation matches minted cubes + the old biomes: the crystal is built in
// unit-local floor space (x,z in [-0.5,0.5], y=0 = floor, +Y grows INWARD) and
// transformed onto the cube's UNIQUE-AXIS plane — NOT world-space bottom.
//
// The on-chain Environment trait (core/cube-env.js `environmentIdForStreet`,
// 0..5, rarity-weighted) selects the crystal CHARACTER: layout + tint + density.
// Stone walkers tracing the same procedural shape are added in a second pass.
//
// Replaces viewer/environments.js (+ its ~10 biome shaders) — same
// `buildEmptySlotItems` signature, so main.js's call site is unchanged.

import { buildGlassBoxItems } from './cube-glass.js';
import { buildWalkerItemsFromFilled } from './materials/stone-walker.js';
import { environmentIdForStreet } from '../core/cube-env.js';

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const vec3 = (a, k = 1) => new Float32Array([a[0] * k, a[1] * k, a[2] * k]);

// ----- Unique-axis floor plane (ported from the old environments.js) --------
// The floor lies on the cube's unique-axis plane — the face whose axis appears
// only once among the cube's three placed planes.

function uniqueAxisPlane(cubePlanes) {
  if (!cubePlanes || cubePlanes.length === 0) return null;
  const count = { x: 0, y: 0, z: 0 };
  for (const p of cubePlanes) if (count[p.axis] !== undefined) count[p.axis]++;
  const ax = count.x === 1 ? 'x' : count.y === 1 ? 'y' : count.z === 1 ? 'z' : null;
  if (!ax) return null;
  return cubePlanes.find(p => p.axis === ax) || null;
}

// Column-major 4x4 mapping unit-local floor (y=0, x/z in [-0.5,0.5], +Y inward)
// onto the cube's unique-axis plane. Local +Y points toward the cube interior so
// the crystal grows into the slot, not out of it.
function floorTransformForPlane(plane, cubeAABB) {
  const ax = plane.axis;
  const cx = plane.center.x, cy = plane.center.y, cz = plane.center.z;
  const ctrX = (cubeAABB.mn[0] + cubeAABB.mx[0]) * 0.5;
  const ctrY = (cubeAABB.mn[1] + cubeAABB.mx[1]) * 0.5;
  const ctrZ = (cubeAABB.mn[2] + cubeAABB.mx[2]) * 0.5;
  const extX = cubeAABB.mx[0] - cubeAABB.mn[0];
  const extY = cubeAABB.mx[1] - cubeAABB.mn[1];
  const extZ = cubeAABB.mx[2] - cubeAABB.mn[2];

  let inward = 0;
  if (ax === 'x') inward = Math.sign(ctrX - cx) || 1;
  else if (ax === 'y') inward = Math.sign(ctrY - cy) || 1;
  else inward = Math.sign(ctrZ - cz) || 1;

  const M = new Float32Array(16);
  if (ax === 'y') {
    M[0] = extX;            M[5] = inward * extY;   M[10] = extZ;
  } else if (ax === 'x') {
    M[1] = extY;            M[4] = inward * extX;   M[10] = extZ;
  } else {
    M[0] = extX;            M[6] = inward * extZ;   M[9]  = extY;
  }
  M[12] = cx; M[13] = cy; M[14] = cz; M[15] = 1;
  return M;
}

// ----- Per-environment crystal character ------------------------------------
// `tint` is over-driven for additive wires/sparkles; `inner` is the softer
// translucent glass-face colour. Sizes are fractions of the cube extent.
// `glassCount` = how many boxes also get translucent stone-glass faces (the
// glass-voxel look); kept modest so overlapping transparency doesn't overdraw.
// Optional `sparkle`/`sparkBoost`/`grid`/`wire` override the shine defaults.
const CRYSTAL = [
  // 0 desert — more, smaller chunks filling more space (colour good)
  { tint: [1.5, 1.02, 0.5], inner: [1.0, 0.78, 0.42], count: 7, wMin: 0.07, wMax: 0.14, hMin: 0.03, hMax: 0.07, spread: 0.86, innerAlpha: 0.10, glassCount: 2, walks: 3 },
  // 1 water — larger, more translucent slabs filling more of the cube
  { tint: [0.5, 0.9, 1.6], inner: [0.34, 0.62, 1.0], count: 5, wMin: 0.16, wMax: 0.30, hMin: 0.03, hMax: 0.12, spread: 0.66, innerAlpha: 0.22, glassCount: 5, walks: 3 },
  // 2 grass — many tiny nubs hugging the floor; more walkers
  { tint: [0.6, 1.55, 0.62], inner: [0.34, 0.9, 0.4], count: 14, wMin: 0.03, wMax: 0.06, hMin: 0.02, hMax: 0.055, spread: 0.86, innerAlpha: 0.08, glassCount: 2, walks: 7 },
  // 3 forest — dense, small AND larger columns overlapping
  { tint: [0.46, 1.45, 0.56], inner: [0.3, 0.86, 0.4], count: 9, wMin: 0.04, wMax: 0.12, hMin: 0.18, hMax: 0.55, spread: 0.9, innerAlpha: 0.10, glassCount: 2, walks: 9 },
  // 4 mountain — diverse chunk massif (see crystalBoxes); more walkers
  { tint: [1.15, 1.2, 1.35], inner: [0.6, 0.62, 0.7], peak: true, innerAlpha: 0.12, glassCount: 3, walks: 6 },
  // 5 ice — many small shiny shards; extra sparkle + grid, strong glass
  { tint: [0.72, 1.45, 1.9], inner: [0.5, 0.86, 1.15], count: 16, wMin: 0.02, wMax: 0.045, hMin: 0.10, hMax: 0.34, spread: 0.5, innerAlpha: 0.15, glassCount: 6, walks: 5, sparkle: 1.0, sparkBoost: 1.9, grid: 0.24, wire: 0.65 },
];

// A single representative RGB per environment id (0..5) — the additive `tint`,
// reused for cheap impostors / minimap dots so their colour matches the biome.
export function crystalTintForEnv(envId) {
  return (CRYSTAL[envId] || CRYSTAL[2]).tint;
}

// Voxelize the unit-local crystal boxes into the 40^3 grid the walker walks.
// Local x,z in [-0.5,0.5] -> [0,40); local y in [0,1] -> [0,40).
function voxelizeLocal(boxes) {
  const filled = new Uint8Array(64000);
  const vi = (v) => Math.max(0, Math.min(39, Math.floor(v)));
  for (const b of boxes) {
    const x0 = vi((b.mn[0] + 0.5) * 40), x1 = vi((b.mx[0] + 0.5) * 40);
    const y0 = vi(b.mn[1] * 40),         y1 = vi(b.mx[1] * 40);
    const z0 = vi((b.mn[2] + 0.5) * 40), z1 = vi((b.mx[2] + 0.5) * 40);
    for (let xi = x0; xi <= x1; xi++)
      for (let yi = y0; yi <= y1; yi++)
        for (let zi = z0; zi <= z1; zi++)
          filled[xi * 1600 + yi * 40 + zi] = 1;
  }
  return filled;
}

// Walker grid origin + voxel size in the SAME unit-local floor space as the
// crystal boxes; the floor transform then orients both onto the plane.
const LOCAL_MN = [-0.5, 0, -0.5];
const LOCAL_VS = [1 / 40, 1 / 40, 1 / 40];

// Crystal box list in UNIT-LOCAL floor space: x,z in [-0.5,0.5], y=0 is the
// floor, +Y grows inward. floorTransformForPlane maps this onto the plane.
function crystalBoxes(motifIdx, p) {
  const rand = mulberry32((motifIdx * 2654435761 + 0x9e37) >>> 0);
  const box = (cx, cz, hx, hz, base, top) => ({ mn: [cx - hx, base, cz - hz], mx: [cx + hx, top, cz + hz] });
  const boxes = [];

  if (p.peak) {
    // Diverse chunk massif — scattered angular blocks of varied size and height
    // filling much of the cube. No two mountains alike, none boringly regular.
    const n = 5 + Math.floor(rand() * 5);    // 5..9 chunks
    for (let k = 0; k < n; k++) {
      const cx = clamp((rand() - 0.5) * 0.62, -0.34, 0.34);
      const cz = clamp((rand() - 0.5) * 0.62, -0.34, 0.34);
      const hx = 0.07 + rand() * 0.20;       // diverse widths
      const hz = 0.07 + rand() * 0.20;
      const h  = 0.14 + rand() * 0.62;       // diverse heights; some fill the cube
      boxes.push(box(cx, cz, hx, hz, 0.01, 0.01 + h));
    }
    return boxes;
  }
  for (let i = 0; i < p.count; i++) {
    const cx = clamp((rand() - 0.5) * p.spread, -0.36, 0.36);
    const cz = clamp((rand() - 0.5) * p.spread, -0.36, 0.36);
    const hx = p.wMin + rand() * (p.wMax - p.wMin);
    const hz = hx * (0.7 + 0.6 * rand());       // slight anisotropy
    const h  = p.hMin + rand() * (p.hMax - p.hMin);
    boxes.push(box(cx, cz, hx, hz, 0.01, 0.01 + h));
  }
  return boxes;
}

// Public builder — same signature as the old environments.js export.
export function buildEmptySlotItems(motifIdx, cubePlanes, cubeAABB, gl, meshes) {
  if (!cubeAABB) return [];
  const plane = uniqueAxisPlane(cubePlanes);
  if (!plane) return [];

  const envId = environmentIdForStreet(Math.floor((Number(motifIdx) || 0) / 8));
  const p = CRYSTAL[envId] || CRYSTAL[2];
  const boxes = crystalBoxes(motifIdx, p);
  if (boxes.length === 0) return [];

  const transform = floorTransformForPlane(plane, cubeAABB);

  const glass = buildGlassBoxItems(gl, meshes, `crystal-${motifIdx}`, null, boxes, {
    includeOuter: false,                        // crystal growth, not a full glass cube
    innerGlassCount: Math.min(boxes.length, p.glassCount || 2),
    transform,
    outerTint: vec3(p.inner),
    wireTint:  vec3(p.tint),
    gridTint:  vec3(p.tint, 0.7),
    sparkTint: vec3(p.tint, p.sparkBoost ?? 1.3),
    innerAlpha: p.innerAlpha,
    wireOpacity: p.wire ?? 0.5,
    gridOpacity: p.grid ?? 0.14,
    sparkleOpacity: p.sparkle ?? 0.85,
    seed: motifIdx,
  });

  // Stone walkers trace the same crystal (voxelized), oriented by the same
  // transform — the "life" moving over the formation. Quieter than the wires.
  const filled = voxelizeLocal(boxes);
  const walkers = buildWalkerItemsFromFilled(
    gl, meshes, `crystalwalk-${motifIdx}`, filled, LOCAL_MN, LOCAL_VS, transform, motifIdx,
    { walksPerFace: p.walks || 3, tint: vec3(p.tint, 0.85), glowOpacity: 0.10, coreOpacity: 0.5 },
  );

  return [...glass, ...walkers];
}
