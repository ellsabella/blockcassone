// Empty-slot biome rendering.
//
// Each unminted Hilbert slot picks a biome from `ENVIRONMENTS` and renders a
// tinted floor grid plus one biome-specific accent (dunes, ripples, tufts,
// tree silhouettes, cracks, crystals). Built only from the existing `lines`
// and `plant-particle` materials so no new shaders are needed.
//
// The floor lies on the cube's UNIQUE-AXIS plane — the face whose axis appears
// only once among the cube's three placed planes (e.g. cube with planes XXY
// has Y as the unique axis, so the Y plane is the floor). Accents grow from
// the plane inward toward the cube interior, never outward.

import { createMeshGL, createPlane } from '/renderer/src/geometry.js';
import { createInstancedBillboardMesh } from './instanced-mesh.js';
import { hash1, walkTree, V } from './tree-walker.js';
import { worldPerp } from './materials/line-mesh.js';

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

// `hasFloor` (default true) controls whether the unique-axis grid renders.
// Set false for biomes whose accent already implies a ground (sand grains
// settling on the base plane, etc.) so the grid doesn't compete with them.
export const ENVIRONMENTS = [
  { name: 'desert', color: [0.95, 0.68, 0.32], floorOpacity: 0.85, hasFloor: false, accent: 'sand-grains',   accentColor: [1.00, 0.78, 0.42], accentOpacity: 0.95 },
  { name: 'water',  color: [0.22, 0.55, 0.92], floorOpacity: 0.95, hasFloor: false, accent: 'water-surface', accentColor: [0.32, 0.62, 0.94], accentOpacity: 0.90 },
  { name: 'grass',  color: [0.34, 0.78, 0.28], floorOpacity: 0.85, hasFloor: false, accent: 'grass-meadow',  accentColor: [0.34, 0.72, 0.30], accentOpacity: 0.72 },
  { name: 'forest', color: [0.18, 0.52, 0.24], floorOpacity: 0.80, hasFloor: false, accent: 'forest-canopy', accentColor: [0.34, 0.78, 0.40], accentOpacity: 0.95 },
  { name: 'mountain', color: [0.58, 0.58, 0.62], floorOpacity: 0.90, hasFloor: false, accent: 'mountain-range', accentColor: [0.62, 0.62, 0.66], accentOpacity: 0.55 },
  { name: 'ice',    color: [0.72, 0.92, 1.00], floorOpacity: 0.82, hasFloor: false, accent: 'ice-surface',   accentColor: [0.52, 0.76, 1.00], accentOpacity: 0.62 },
];

// Dev-time: bucket by street so the order-3 dev world gets 8 visible biomes.
// Final order-5 world will switch to neighbourhood — single accessor keeps
// that a one-line change.
export function environmentForSlot(motifIdx) {
  const street = Math.floor((Number(motifIdx) || 0) / 8);
  const idx = Math.floor(hash1([street + 1, 911, 37]) * ENVIRONMENTS.length) % ENVIRONMENTS.length;
  return ENVIRONMENTS[idx];
}

export function environmentNameForSlot(motifIdx) {
  return environmentForSlot(motifIdx).name;
}

// ----- Unique-axis plane resolution ----------------------------------------

function uniqueAxisPlane(cubePlanes) {
  if (!cubePlanes || cubePlanes.length === 0) return null;
  const count = { x: 0, y: 0, z: 0 };
  for (const p of cubePlanes) {
    if (count[p.axis] !== undefined) count[p.axis]++;
  }
  const ax = count.x === 1 ? 'x' : count.y === 1 ? 'y' : count.z === 1 ? 'z' : null;
  if (!ax) return null;
  return cubePlanes.find(p => p.axis === ax) || null;
}

// Transform matrix that maps unit-local floor (y=0, x/z in [-0.5,0.5], +Y up)
// onto the cube's unique-axis plane. Local +Y points INWARD toward the cube
// interior so accents (trees/tufts at y>0) grow into the cube, not out of it.
function floorTransformForPlane(plane, cubeAABB) {
  const ax = plane.axis;
  const cx = plane.center.x, cy = plane.center.y, cz = plane.center.z;
  const cubeCenterX = (cubeAABB.mn[0] + cubeAABB.mx[0]) * 0.5;
  const cubeCenterY = (cubeAABB.mn[1] + cubeAABB.mx[1]) * 0.5;
  const cubeCenterZ = (cubeAABB.mn[2] + cubeAABB.mx[2]) * 0.5;
  const extX = cubeAABB.mx[0] - cubeAABB.mn[0];
  const extY = cubeAABB.mx[1] - cubeAABB.mn[1];
  const extZ = cubeAABB.mx[2] - cubeAABB.mn[2];

  let inward = 0;
  if (ax === 'x') inward = Math.sign(cubeCenterX - cx) || 1;
  else if (ax === 'y') inward = Math.sign(cubeCenterY - cy) || 1;
  else if (ax === 'z') inward = Math.sign(cubeCenterZ - cz) || 1;

  // Column-major 4x4. Columns: where local +X, +Y, +Z, origin go in world.
  const M = new Float32Array(16);
  if (ax === 'y') {
    // local +X → world +X, local +Y → world ±Y (inward), local +Z → world +Z
    M[0]  = extX;            M[5]  = inward * extY;   M[10] = extZ;
  } else if (ax === 'x') {
    // local +X → world +Y, local +Y → world ±X (inward), local +Z → world +Z
    M[1]  = extY;            M[4]  = inward * extX;   M[10] = extZ;
  } else /* z */ {
    // local +X → world +X, local +Y → world ±Z (inward), local +Z → world +Y
    M[0]  = extX;            M[6]  = inward * extZ;   M[9]  = extY;
  }
  M[12] = cx; M[13] = cy; M[14] = cz; M[15] = 1;
  return M;
}

// ----- Mesh builders (unit local space; y=0 is the floor plane) ------------

// 5x5 grid of additive line strands on the y=0 plane, extent ±0.5 in X and Z.
function buildFloorMesh(gl) {
  const segs = [];
  const grid = 5;
  for (let i = 0; i <= grid; i++) {
    const t = -0.5 + i / grid;
    segs.push(-0.5, 0, t,  0.5, 0, t);
    segs.push(t, 0, -0.5,  t, 0,  0.5);
  }
  return buildLineMesh(gl, segs, 0.0035);
}

function buildLineMesh(gl, flatSegs, halfWidth) {
  const hw = halfWidth;
  const positions = [];
  const alphas = [];
  const indices = [];
  let vi = 0;
  for (let i = 0; i < flatSegs.length; i += 6) {
    const p0x = flatSegs[i],   p0y = flatSegs[i+1], p0z = flatSegs[i+2];
    const p1x = flatSegs[i+3], p1y = flatSegs[i+4], p1z = flatSegs[i+5];
    const dx = p1x - p0x, dz = p1z - p0z;
    const dl = Math.sqrt(dx*dx + dz*dz);
    if (dl < 1e-9) continue;
    const px = -dz / dl, pz = dx / dl;
    positions.push(
      p0x - px*hw, p0y, p0z - pz*hw,
      p0x + px*hw, p0y, p0z + pz*hw,
      p1x - px*hw, p1y, p1z - pz*hw,
      p1x + px*hw, p1y, p1z + pz*hw,
    );
    alphas.push(1, 1, 1, 1);
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }
  if (positions.length === 0) return null;
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    indices:   new Uint16Array(indices),
  });
}

// Billboard cloud in unit local space; y > 0 grows inward into the cube.
function buildAccentBillboards(gl, env) {
  const rand = mulberry32(_stringSeed(env.name));
  let count, ySpread, size;
  switch (env.accent) {
    case 'tufts':    count = 22; ySpread = [0.05, 0.16]; size = 0.05; break;
    case 'trees':    count = 7;  ySpread = [0.05, 0.55]; size = 0.18; break;
    case 'crystals': count = 16; ySpread = [0.03, 0.18]; size = 0.05; break;
    default:         return null;
  }
  const inst = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const x = -0.42 + rand() * 0.84;
    const z = -0.42 + rand() * 0.84;
    const y = ySpread[0] + rand() * (ySpread[1] - ySpread[0]);
    const seed = rand();
    const sz = size * (0.7 + 0.6 * rand());
    const depth = env.accent === 'trees' ? 0.9 : 0.6;
    inst[i*6 + 0] = x;
    inst[i*6 + 1] = y;
    inst[i*6 + 2] = z;
    inst[i*6 + 3] = sz;
    inst[i*6 + 4] = seed;
    inst[i*6 + 5] = depth;
  }
  return createInstancedBillboardMesh(gl, inst);
}

// --- 3D value noise (CPU mirror of sand-grain.vert.glsl::vnoise) -----------
// Hash returns a vec3 in [-1,1]^3 by sampling the 1D `hash1` along 3 offsets.
// Same characteristic as the GLSL hash3 — both seed off sin-based hashes so
// CPU placement and GPU motion live in the "same" perceptual noise space.
function hash3(x, y, z) {
  return [
    -1 + 2 * hash1([x + 127.1, y + 311.7,  z + 74.7 ]),
    -1 + 2 * hash1([x + 269.5, y + 183.3,  z + 246.1]),
    -1 + 2 * hash1([x + 113.5, y + 271.9,  z + 124.6]),
  ];
}

function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  function corner(dx, dy, dz) {
    const h = hash3(ix + dx, iy + dy, iz + dz);
    return h[0] * (fx - dx) + h[1] * (fy - dy) + h[2] * (fz - dz);
  }
  const n000 = corner(0, 0, 0), n100 = corner(1, 0, 0);
  const n010 = corner(0, 1, 0), n110 = corner(1, 1, 0);
  const n001 = corner(0, 0, 1), n101 = corner(1, 0, 1);
  const n011 = corner(0, 1, 1), n111 = corner(1, 1, 1);
  const a = n000 * (1 - ux) + n100 * ux;
  const b = n010 * (1 - ux) + n110 * ux;
  const c = n001 * (1 - ux) + n101 * ux;
  const d = n011 * (1 - ux) + n111 * ux;
  return (a * (1 - uy) + b * uy) * (1 - uz) + (c * (1 - uy) + d * uy) * uz;
}

// Dune-noise parameters. These MUST match the uniforms passed to the dune
// ground recipe below — CPU placement and GPU displacement need to agree on
// the same surface so grains actually sit on it.
const DUNE_SCALE = 2.6;
const DUNE_AMP   = 0.18;

// CPU mirror of smooth-ground.vert.glsl::hill(xz). Returns the raw two-octave
// noise sum (un-normalized), matching the GLSL function exactly.
function duneHeight(x, z) {
  const qx = x * DUNE_SCALE, qz = z * DUNE_SCALE;
  const n1 = vnoise3(qx, 0, qz);
  // GLSL: vnoise(q * 2.4 + vec3(11, 0, 5))
  const n2 = vnoise3(qx * 2.4 + 11, 0, qz * 2.4 + 5);
  return n1 * 0.65 + n2 * 0.25;
}

// Desert: a dense band of sand-grain billboards arranged along the noise
// surface. No ground mesh — the dune SHAPE is read from how the grains
// distribute. For each cell of an XZ lattice we sample the same hill()
// function (CPU mirror of smooth-ground.vert.glsl) and drop several grains
// in a thin vertical band centred on the surface so the dune layer has
// perceived depth rather than reading as a 2D sheet.
//
// The shader `sand-grain.vert.glsl` drifts each grain through a vector noise
// field driven by uTime — so the band subtly shimmers without breaking the
// dune silhouette.
function buildSandGrains(gl, env) {
  const rand = mulberry32(_stringSeed(env.name));
  const GRID            = 56;     // 56*56 = 3136 cells across the floor
  const GRAINS_PER_CELL = 4;      // → ~12.5k grains total per cube
  const BAND_BELOW      = 0.012;  // grains buried slightly into the surface
  const BAND_ABOVE      = 0.045;  // windblown grains floating above
  const out = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      for (let g = 0; g < GRAINS_PER_CELL; g++) {
        const x = -0.5 + (i + rand()) / GRID;
        const z = -0.5 + (j + rand()) / GRID;
        const h = duneHeight(x, z);
        const surfaceY = h * DUNE_AMP;
        // Vertical jitter spans below→above the surface for thickness.
        const yOff = -BAND_BELOW + rand() * (BAND_BELOW + BAND_ABOVE);
        // Bias the offset toward the surface (square the random) so most
        // grains cluster on the layer mid-line and only a few float wide.
        const yBias = Math.pow(Math.abs(yOff) / (BAND_BELOW + BAND_ABOVE), 0.6) * Math.sign(yOff);
        const grainY = Math.max(0.001, surfaceY + yBias * (BAND_BELOW + BAND_ABOVE));
        // Smaller grains in valleys (packed sand), slightly larger on crests.
        const crestBias = 0.80 + 0.35 * Math.max(0, h);
        const sz = (0.010 + 0.015 * rand()) * crestBias;
        out.push(x, grainY, z, sz, rand(), 0.0);
      }
    }
  }
  if (out.length === 0) return null;
  return createInstancedBillboardMesh(gl, new Float32Array(out));
}

// Water surface. A tessellated XZ plane at y=0 in unit cube local space —
// `createPlane` already emits exactly that, so we just feed it to the GL
// mesh creator. The `water-surface` shader handles the noise-driven wave
// displacement and the env-cubemap reflection per fragment. The plane is
// shared across every water cube; per-cube orientation comes from `uM`
// (which rotates onto the unique-axis face) and per-cube lighting from
// the uCubeCenter/uCubeHalfSize uniforms set on each scene item.
function buildWaterSurface(gl) {
  const SEG = 36;
  const plane = createPlane(1.0, 1.0, SEG, SEG);
  return createMeshGL(gl, plane);
}

// Smooth-terrain plane. Shared mesh for grass-meadow's hillside AND desert-
// dunes' sand bed — both feed it to the smooth-ground vert/frag pair with
// different uAmp + uTint. Same plane shape as water but the smooth-ground
// vert uses a lower-frequency, higher-amplitude noise sum so the surface
// reads as rolling terrain rather than ripples.
function buildSmoothTerrain(gl) {
  const SEG = 28;
  const plane = createPlane(1.0, 1.0, SEG, SEG);
  return createMeshGL(gl, plane);
}

// Ridge terrain plane. Shared mesh for mountain-range AND ice-surface — both
// drive the same ridge-noise vertex shader, only their frag shaders differ.
// Finely tessellated because ridge noise has sharp transitions that need
// extra verts to read crisply.
function buildRidgeTerrain(gl) {
  const SEG = 48;
  const plane = createPlane(1.0, 1.0, SEG, SEG);
  return createMeshGL(gl, plane);
}

// Grass blades. One shared mesh containing N quadratic-Bezier strips in unit
// cube local space. Each strip is 2*(SEGS+1) verts wide; the vert shader
// applies time-varying lateral sway sampled from a wind noise field. Per-
// vertex attributes are packed into createMeshGL's standard slots:
//   positions  -> aPosition   (rest position on the bezier)
//   normals    -> aRoot       (root XYZ — shared by every vertex of one blade)
//   alphas     -> aAlong      (u along blade [0,1])
//   variants   -> aSeed       (per-blade phase seed)
function buildGrassBlades(gl, env) {
  const rand = mulberry32(_stringSeed(env.name + ':blades'));
  // Index budget: Uint16Array caps at 65535 entries. Each blade uses
  // SEGS * 6 indices, so the count is sized to stay safely under the cap
  // while reading as a thick meadow rather than scattered tufts.
  const N      = 2700;
  const SEGS   = 4;        // along-blade segments → SEGS+1 rings of 2 verts
  const W_ROOT = 0.0042;
  const W_TIP  = 0.0010;
  const H_MIN  = 0.09;
  const H_MAX  = 0.17;

  const positions = [];
  const roots     = [];
  const alongs    = [];
  const seeds     = [];
  const indices   = [];
  let vi = 0;

  for (let b = 0; b < N; b++) {
    // Root anywhere inside the unit floor, with a small inset so blades stay
    // off the cube edges.
    const rx = -0.45 + rand() * 0.90;
    const rz = -0.45 + rand() * 0.90;
    const H  = H_MIN + rand() * (H_MAX - H_MIN);

    // Bezier control points. P1 is offset laterally so the blade has a
    // resting bend; bendAngle decorrelates blade orientations.
    const bendAngle = rand() * Math.PI * 2;
    const bendMag   = 0.015 + rand() * 0.030;
    const bx = Math.cos(bendAngle) * bendMag;
    const bz = Math.sin(bendAngle) * bendMag;
    const P0 = [rx,            0.0,        rz           ];
    const P1 = [rx + bx,       H * 0.55,   rz + bz      ];
    const P2 = [rx + bx * 1.5, H,          rz + bz * 1.5];

    // Across-blade direction (in the local y=0 plane, perpendicular to bend).
    const perpAngle = bendAngle + Math.PI * 0.5;
    const px = Math.cos(perpAngle);
    const pz = Math.sin(perpAngle);

    const seed = rand();

    for (let s = 0; s <= SEGS; s++) {
      const u   = s / SEGS;
      const omu = 1 - u;
      // Quadratic Bezier point P(u).
      const cx = omu * omu * P0[0] + 2 * omu * u * P1[0] + u * u * P2[0];
      const cy = omu * omu * P0[1] + 2 * omu * u * P1[1] + u * u * P2[1];
      const cz = omu * omu * P0[2] + 2 * omu * u * P1[2] + u * u * P2[2];

      const w = W_ROOT * (1 - u) + W_TIP * u;

      // Two vertices: left, right of the spine.
      positions.push(cx - px * w * 0.5, cy, cz - pz * w * 0.5);
      positions.push(cx + px * w * 0.5, cy, cz + pz * w * 0.5);
      roots.push(rx, 0, rz, rx, 0, rz);
      alongs.push(u, u);
      seeds.push(seed, seed);

      if (s < SEGS) {
        // Two triangles per segment of the strip.
        indices.push(vi, vi + 1, vi + 2);
        indices.push(vi + 1, vi + 3, vi + 2);
      }
      vi += 2;
    }
  }

  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    normals:   new Float32Array(roots),
    alphas:    new Float32Array(alongs),
    variants:  new Float32Array(seeds),
    indices:   new Uint16Array(indices),
  });
}

// Forest canopy.
//
// Reuses the same `walkTree` depth-3 binary-tree traversal that drives normie
// forest planes — a single trunk forks twice, giving 1+2+4+8 = 15 segments
// per tree. Branches render as additive line strands (lines material). Leaves
// are blob clouds at each branch tip: a mix of soft halos and brighter inner
// particles via the existing plant-particle material's depth marker.
//
// The structure is generated once per biome (deterministic from seed) and
// cached so the branches + leaves recipe parts share the same data.

const _forestCache = new Map();

function ensureForestData(env) {
  const cached = _forestCache.get(env.name);
  if (cached) return cached;

  const rand = mulberry32(_stringSeed(env.name + ':forest'));
  const N_TREES = 14;

  const segments  = [];   // [{a, b, depth}] across all trees
  const leafSites = [];   // [{pos, treeSeed}] one per tip (depth=3 end)

  for (let t = 0; t < N_TREES; t++) {
    const rx = -0.40 + rand() * 0.80;
    const rz = -0.40 + rand() * 0.80;
    const root = [rx, 0, rz];

    const len0   = 0.20 + rand() * 0.09;
    const spread = 0.55 + rand() * 0.30;
    const decay  = 0.66 + rand() * 0.09;

    // Slight lean — most trees mostly upright, a few canted.
    const lean      = (rand() - 0.5) * 0.32;
    const leanAngle = rand() * Math.PI * 2;
    const fwd = V.norm([Math.cos(leanAngle) * lean, 1.0, Math.sin(leanAngle) * lean]);

    // Spread axis perpendicular to fwd so forks open sideways rather than fold.
    let upAx = V.cross(fwd, [1, 0, 0]);
    if (V.len(upAx) < 0.1) upAx = V.cross(fwd, [0, 0, 1]);
    upAx = V.norm(upAx);

    const treeSeed = rand();

    walkTree(root, fwd, upAx, len0, spread, decay, (a, b, depth) => {
      segments.push({ a, b, depth });
      if (depth === 3) leafSites.push({ pos: b, seed: treeSeed + segments.length * 0.013 });
    });
  }

  const data = { segments, leafSites };
  _forestCache.set(env.name, data);
  return data;
}

// Per-depth trunk widths: thick at depth 0, taper down at each fork. Inlined
// rather than calling buildCoreLineMesh four times because we want one mesh
// for the whole forest, not four scene items.
const BRANCH_WIDTH_BY_DEPTH = [0.024, 0.015, 0.0095, 0.0060];

function buildForestBranches(gl, env) {
  const { segments } = ensureForestData(env);
  if (!segments.length) return null;
  const positions = [];
  const alphas    = [];
  const indices   = [];
  let vi = 0;
  for (const s of segments) {
    const hw = BRANCH_WIDTH_BY_DEPTH[Math.min(s.depth, BRANCH_WIDTH_BY_DEPTH.length - 1)] * 0.5;
    const a = s.a, b = s.b;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dl = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dl < 1e-10) continue;
    const perp = worldPerp(dx / dl, dy / dl, dz / dl);
    if (!perp) continue;
    const [px, py, pz] = perp;
    positions.push(
      a[0] - px*hw, a[1] - py*hw, a[2] - pz*hw,
      a[0] + px*hw, a[1] + py*hw, a[2] + pz*hw,
      b[0] - px*hw, b[1] - py*hw, b[2] - pz*hw,
      b[0] + px*hw, b[1] + py*hw, b[2] + pz*hw,
    );
    alphas.push(1, 1, 1, 1);
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }
  if (!positions.length) return null;
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    indices:   new Uint16Array(indices),
  });
}

function buildForestLeaves(gl, env) {
  const { leafSites } = ensureForestData(env);
  const rand = mulberry32(_stringSeed(env.name + ':forest-leaves'));
  // Per tip: a few big soft halos + several bright inner particles. plant-
  // particle.frag treats aInstDepth > 1.0 as halo (dim, fuzzy puff) — perfect
  // for blob cloud volume; depth ≤ 1.0 stays as bright fine-leaf particles.
  const HALOS_PER_TIP   = 5;
  const LEAVES_PER_TIP  = 7;
  const HALO_RADIUS     = 0.040;
  const LEAF_RADIUS     = 0.032;
  const HALO_SIZE       = 0.095;
  const LEAF_SIZE       = 0.034;
  const HALO_DEPTH      = 1.3;
  const LEAF_DEPTH      = 0.85;

  const total = leafSites.length * (HALOS_PER_TIP + LEAVES_PER_TIP);
  const inst = new Float32Array(total * 6);
  let i = 0;
  for (const { pos } of leafSites) {
    for (let h = 0; h < HALOS_PER_TIP; h++) {
      const ox = (rand() - 0.5) * HALO_RADIUS * 2;
      const oy = (rand() - 0.5) * HALO_RADIUS * 1.4 + 0.006;
      const oz = (rand() - 0.5) * HALO_RADIUS * 2;
      const sz = HALO_SIZE * (0.7 + 0.55 * rand());
      inst[i*6+0] = pos[0] + ox;
      inst[i*6+1] = pos[1] + oy;
      inst[i*6+2] = pos[2] + oz;
      inst[i*6+3] = sz;
      inst[i*6+4] = rand();
      inst[i*6+5] = HALO_DEPTH;
      i++;
    }
    for (let j = 0; j < LEAVES_PER_TIP; j++) {
      const ox = (rand() - 0.5) * LEAF_RADIUS * 2;
      const oy = (rand() - 0.5) * LEAF_RADIUS * 1.4;
      const oz = (rand() - 0.5) * LEAF_RADIUS * 2;
      const sz = LEAF_SIZE * (0.65 + 0.7 * rand());
      inst[i*6+0] = pos[0] + ox;
      inst[i*6+1] = pos[1] + oy;
      inst[i*6+2] = pos[2] + oz;
      inst[i*6+3] = sz;
      inst[i*6+4] = rand();
      inst[i*6+5] = LEAF_DEPTH;
      i++;
    }
  }
  return createInstancedBillboardMesh(gl, inst);
}

function buildAccentLines(gl, env) {
  const rand = mulberry32(_stringSeed(env.name));
  const segs = [];
  if (env.accent === 'ripples') {
    for (let i = 0; i < 6; i++) {
      const y = 0.02 + rand() * 0.10;
      const z = -0.40 + rand() * 0.80;
      const x0 = -0.30 + rand() * 0.20;
      const x1 =  0.10 + rand() * 0.20;
      segs.push(x0, y, z,  x1, y, z);
    }
  } else if (env.accent === 'cracks') {
    for (let i = 0; i < 9; i++) {
      const cx = -0.35 + rand() * 0.70;
      const cz = -0.35 + rand() * 0.70;
      const a  = rand() * Math.PI;
      const r  = 0.06 + rand() * 0.10;
      const y  = 0.002;
      segs.push(cx - Math.cos(a)*r, y, cz - Math.sin(a)*r,
                cx + Math.cos(a)*r, y, cz + Math.sin(a)*r);
    }
  } else {
    return null;
  }
  return buildLineMesh(gl, segs, 0.0035);
}

function _stringSeed(name) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ----- Public scene-item builder -------------------------------------------

// `cubePlanes` is the 3 serialized plane objects belonging to this motif.
// `cubeAABB` is `{ mn:[x,y,z], mx:[x,y,z] }` for the cube.
export function buildEmptySlotItems(motifIdx, cubePlanes, cubeAABB, gl, meshes) {
  const env = environmentForSlot(motifIdx);
  const plane = uniqueAxisPlane(cubePlanes);
  if (!plane) return [];

  const transform = floorTransformForPlane(plane, cubeAABB);
  const items = [];

  if (env.hasFloor !== false) {
    if (meshes.envFloor === undefined) {
      meshes.envFloor = buildFloorMesh(gl) || null;
    }
    if (meshes.envFloor) {
      items.push({
        mesh: 'envFloor',
        material: 'lines',
        transform,
        blend: 'additive',
        uniforms: {
          uBaseCol:     new Float32Array(env.color),
          uLineOpacity: env.floorOpacity,
        },
      });
    }
  }

  if (env.accent === 'none') return items;

  const recipe = ACCENT_RECIPES[env.accent];
  if (!recipe) return items;

  // Recipes are arrays of parts so one biome can emit several scene items
  // (e.g. grass: a displaced ground + a swaying blade strip). Single-part
  // accents just have a one-entry array.
  for (const part of recipe.parts) {
    const key = `envAccent-${env.name}-${part.keySuffix || 'main'}`;
    if (meshes[key] === undefined) {
      meshes[key] = part.build(gl, env) || null;
    }
    if (!meshes[key]) continue;
    items.push({
      mesh:     key,
      material: part.material,
      transform,
      blend:    part.blend || 'additive',
      uniforms: part.uniforms(env, cubeAABB),
      noCull:   part.noCull === true,
    });
  }

  return items;
}

// Per-cube light convention uniforms — feather-glass / normie-voxel both use
// (uCubeCenter + uPointLightPos[i] * uCubeHalfSize) so colored sliders light
// each cube locally. Materials that integrate point lights need both.
function cubeLightingUniforms(cubeAABB) {
  const center = new Float32Array([
    (cubeAABB.mn[0] + cubeAABB.mx[0]) * 0.5,
    (cubeAABB.mn[1] + cubeAABB.mx[1]) * 0.5,
    (cubeAABB.mn[2] + cubeAABB.mx[2]) * 0.5,
  ]);
  const halfSize = Math.max(
    cubeAABB.mx[0] - cubeAABB.mn[0],
    cubeAABB.mx[1] - cubeAABB.mn[1],
    cubeAABB.mx[2] - cubeAABB.mn[2],
  ) * 0.5;
  return { uCubeCenter: center, uCubeHalfSize: halfSize, uLightScale: 1.0 };
}

// Per-accent: which mesh builder to use, which material, and how to pack the
// accent's color/opacity into the shader's uniform names. Adding a new biome
// accent shader = one entry here.
const billboardUniforms = env => ({ uTint: new Float32Array(env.accentColor), uOpacity: env.accentOpacity });
const lineUniforms      = env => ({ uBaseCol: new Float32Array(env.accentColor), uLineOpacity: env.accentOpacity });

const ACCENT_RECIPES = {
  'tufts':       { parts: [{ build: buildAccentBillboards, material: 'plant-particle', uniforms: billboardUniforms }] },
  'trees':       { parts: [{ build: buildAccentBillboards, material: 'plant-particle', uniforms: billboardUniforms }] },
  'ripples':     { parts: [{ build: buildAccentLines,      material: 'lines',          uniforms: lineUniforms }] },
  // Particles-only desert. No ground mesh — the dune shape comes entirely
  // from the noise-driven distribution of thousands of grains in a thin band
  // along the surface. CPU side mirrors the GLSL hill() so grains sit on the
  // same field the other smooth-ground biomes use.
  'sand-grains': { parts: [
    { keySuffix: 'grains', build: buildSandGrains, material: 'sand-grain', blend: 'additive',
      // ~12.5k grains per cube additively blend up brightly; uOpacity scaled
      // down so the dune layer reads as a warm haze rather than blowing out.
      uniforms: env => ({
        uTint:    new Float32Array(env.accentColor),
        uOpacity: 0.45,
        uScale:   4.0,
        uSpeed:   0.35,
      }) },
  ]},
  'water-surface': { parts: [{ build: buildWaterSurface, material: 'water-surface', blend: 'alpha',
                               uniforms: (env, aabb) => ({ ...billboardUniforms(env), uScale: 5.5, uSpeed: 0.55, ...cubeLightingUniforms(aabb) }) }] },
  'forest-canopy': { parts: [
    { keySuffix: 'ground', build: buildSmoothTerrain, material: 'grass-ground', blend: 'alpha',
      uniforms: (env, aabb) => ({
        uTint:    new Float32Array(env.accentColor),
        uOpacity: 0.20,
        uScale:   2.4,
        uAmp:     0.18,
        ...cubeLightingUniforms(aabb),
      }) },
    { keySuffix: 'branches', build: buildForestBranches, material: 'lines', blend: 'additive',
      uniforms: env => ({
        // Warm brown for trunks/branches. Additive over the dark scene gives
        // a soft wood glow rather than a flat brown read; tune lower for less
        // glow.
        uBaseCol:     new Float32Array([0.55, 0.34, 0.18]),
        uLineOpacity: 0.85,
      }) },
    { keySuffix: 'leaves', build: buildForestLeaves, material: 'plant-particle', blend: 'additive',
      uniforms: env => ({
        uTint:    new Float32Array(env.accentColor),
        uOpacity: 0.65,
      }) },
  ]},
  'mountain-range': { parts: [{
    build: buildRidgeTerrain, material: 'mountain-range', blend: 'alpha',
    uniforms: (env, aabb) => ({
      uTint:    new Float32Array(env.accentColor),
      uOpacity: env.accentOpacity,
      uScale:   2.4,
      uAmp:     0.62,
      ...cubeLightingUniforms(aabb),
    }),
  }]},
  // Ice shares the ridge-terrain vertex stage with mountains but pushes uScale
  // higher (more shards per cube) and uAmp higher (taller spikes) for the
  // jagged crystal feel.
  'ice-surface': { parts: [{
    build: buildRidgeTerrain, material: 'ice-surface', blend: 'alpha',
    uniforms: (env, aabb) => ({
      uTint:    new Float32Array(env.accentColor),
      uOpacity: env.accentOpacity,
      uScale:   3.6,
      uAmp:     0.78,
      ...cubeLightingUniforms(aabb),
    }),
  }]},
  'grass-meadow': { parts: [
    // Ground: translucent hillside. Alpha blend disables depth-write so the
    // Hilbert path stays visible through it; with thousands of blades on top
    // the visual ordering still reads as "blades on a hill".
    { keySuffix: 'ground', build: buildSmoothTerrain, material: 'grass-ground', blend: 'alpha',
      uniforms: (env, aabb) => ({
        uTint:    new Float32Array(env.accentColor),
        uOpacity: 0.22,
        uScale:   2.8,
        uAmp:     0.20,
        ...cubeLightingUniforms(aabb),
      }) },
    // Blades: alpha-blended thin strips swaying in wind-noise field.
    { keySuffix: 'blades', build: buildGrassBlades, material: 'grass-blade', blend: 'alpha',
      uniforms: (env, aabb) => ({
        uTint:    new Float32Array(env.accentColor),
        uOpacity: env.accentOpacity,
        uScale:   3.4,
        uSpeed:   0.85,
        uAlpha:   0.045,
        ...cubeLightingUniforms(aabb),
      }) },
  ]},
};

// Backwards-compatible name kept for the cube-detail info row and the street
// stats overlay. Both keyed by street index today; both will move to
// neighbourhood when the final order-5 world lands.
export function environmentNameForStreet(streetIdx) {
  const motifIdx = (Number(streetIdx) || 0) * 8;
  return environmentNameForSlot(motifIdx);
}
