// Cube-level glass aesthetic. Runs once per cube in 3D mode, independent of
// plane materials. Produces the "crystalline glass cube with internal nested
// boxes" look from the user's reference images:
//
//   1. Outer glass shell — a translucent 6-faced box covering the cube's
//      AABB, rendered through the stone-glass material (Schlick Fresnel +
//      faked sky reflection + specular).
//   2. Inner nested wireframe boxes — N axis-aligned wireframes shrinking
//      toward the cube centre, with seeded lateral offsets so they're not
//      perfectly concentric.
//   3. Inner translucent glass boxes — a smaller subset of the nested boxes
//      rendered as faceted glass at low alpha, so where they overlap with
//      the outer shell or with each other the regions read as denser.
//
// All randomness derives from motifIndex so a given cube always looks the
// same. Caching is keyed by motifIndex.

import { createMeshGL } from '../renderer/src/geometry.js';
import { createInstancedBillboardMesh } from './instanced-mesh.js';
import { mat4, identity } from '../renderer/src/math.js';
import { hash1 } from './tree-walker.js';

// --- Tuning ---
const INNER_BOX_COUNT     = 5;     // total nested wireframe boxes
const INNER_SCALE_BASE    = 0.86;  // outermost inner box, fraction of cube
const INNER_SCALE_RATIO   = 0.72;  // each subsequent box smaller by this factor
const INNER_OFFSET_FRAC   = 0.05;  // max lateral offset, fraction of cube extent
const INNER_GLASS_COUNT   = 2;     // how many of the inner boxes also get glass faces
const OUTER_GLASS_ALPHA   = 0.12;
const INNER_GLASS_ALPHA   = 0.10;
const WIRE_OPACITY        = 0.55;

// Surface-grid subdivision on each box face — like graph paper engraved in
// the glass. Per box level, controls how many lines per face per axis.
const FACE_GRID_OUTER     = 6;     // outer cube face: 6 subdivisions per axis
const FACE_GRID_INNER     = 4;     // inner nested boxes: 4 subdivisions
const FACE_GRID_OPACITY   = 0.20;  // fainter than the box outlines

// Sparkle billboards at every wireframe vertex. Catches the camera like
// reflections off glass corners.
const SPARKLE_SIZE        = 0.025; // world units
const SPARKLE_OPACITY     = 0.95;

const WHITE_TINT = new Float32Array([1.0, 1.0, 1.0]);
const WIRE_TINT  = new Float32Array([1.6, 1.7, 1.9]);   // cool over-driven for additive
const GRID_TINT  = new Float32Array([1.2, 1.4, 1.7]);   // dimmer cool for face grids
const SPARK_TINT = new Float32Array([2.4, 2.5, 2.7]);   // very bright for vertex sparks

// ---------------------------------------------------------------------------

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

// Push a single 6-face box (from `mn` to `mx`) into pre-existing positions /
// normals / indices arrays. Outward face normals.
function pushBoxFaces(positions, normals, indices, baseRef, mn, mx) {
  const x0 = mn[0], y0 = mn[1], z0 = mn[2];
  const x1 = mx[0], y1 = mx[1], z1 = mx[2];

  const c000 = [x0, y0, z0], c100 = [x1, y0, z0];
  const c010 = [x0, y1, z0], c110 = [x1, y1, z0];
  const c001 = [x0, y0, z1], c101 = [x1, y0, z1];
  const c011 = [x0, y1, z1], c111 = [x1, y1, z1];

  const faces = [
    // 4 verts (CCW from outside)            outward normal
    [c001, c101, c111, c011,    [ 0,  0,  1]],   // +Z front
    [c100, c000, c010, c110,    [ 0,  0, -1]],   // -Z back
    [c000, c001, c011, c010,    [-1,  0,  0]],   // -X left
    [c101, c100, c110, c111,    [ 1,  0,  0]],   // +X right
    [c011, c111, c110, c010,    [ 0,  1,  0]],   // +Y top
    [c000, c100, c101, c001,    [ 0, -1,  0]],   // -Y bottom
  ];

  let base = baseRef.value;
  for (const f of faces) {
    const [p0, p1, p2, p3, n] = f;
    positions.push(p0[0], p0[1], p0[2],
                   p1[0], p1[1], p1[2],
                   p2[0], p2[1], p2[2],
                   p3[0], p3[1], p3[2]);
    for (let i = 0; i < 4; i++) normals.push(n[0], n[1], n[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  baseRef.value = base;
}

// Push a fine subdivision grid on each face of a box. Per face we emit
// `subdivs - 1` lines along each in-face axis (so excluding the boundary
// edges, which are already drawn by pushBoxWireEdges). Total per face =
// 2 * (subdivs - 1) lines.
function pushBoxFaceGrid(positions, alphas, mn, mx, subdivs) {
  if (subdivs < 2) return;
  const x0 = mn[0], y0 = mn[1], z0 = mn[2];
  const x1 = mx[0], y1 = mx[1], z1 = mx[2];

  const pushLine = (a, b) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    alphas.push(1.0, 1.0);
  };

  for (let i = 1; i < subdivs; i++) {
    const t = i / subdivs;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;

    // ±Z faces (z = z0 and z = z1) — grid along x and y.
    pushLine([x, y0, z0], [x, y1, z0]);
    pushLine([x, y0, z1], [x, y1, z1]);
    pushLine([x0, y, z0], [x1, y, z0]);
    pushLine([x0, y, z1], [x1, y, z1]);

    // ±Y faces (y = y0 and y = y1) — grid along x and z.
    pushLine([x, y0, z0], [x, y0, z1]);
    pushLine([x, y1, z0], [x, y1, z1]);
    pushLine([x0, y0, z], [x1, y0, z]);
    pushLine([x0, y1, z], [x1, y1, z]);

    // ±X faces (x = x0 and x = x1) — grid along y and z.
    pushLine([x0, y, z0], [x0, y, z1]);
    pushLine([x1, y, z0], [x1, y, z1]);
    pushLine([x0, y0, z], [x0, y1, z]);
    pushLine([x1, y0, z], [x1, y1, z]);
  }
}

// Push the 12 edges of a box (from `mn` to `mx`) into LINES position/alpha
// arrays.
function pushBoxWireEdges(positions, alphas, mn, mx) {
  const corners = [
    [mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]],
    [mn[0], mx[1], mn[2]], [mx[0], mx[1], mn[2]],
    [mn[0], mn[1], mx[2]], [mx[0], mn[1], mx[2]],
    [mn[0], mx[1], mx[2]], [mx[0], mx[1], mx[2]],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],   // along X
    [0, 2], [1, 3], [4, 6], [5, 7],   // along Y
    [0, 4], [1, 5], [2, 6], [3, 7],   // along Z
  ];
  for (const [a, b] of edges) {
    const pa = corners[a], pb = corners[b];
    positions.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
    alphas.push(1.0, 1.0);
  }
}

// Compute the AABBs of the inner nested boxes (used both by the wireframe
// builder and the inner-glass-faces builder).
function computeInnerBoxes(aabb, motifIdx) {
  const cx = (aabb.mn[0] + aabb.mx[0]) * 0.5;
  const cy = (aabb.mn[1] + aabb.mx[1]) * 0.5;
  const cz = (aabb.mn[2] + aabb.mx[2]) * 0.5;
  const sx = (aabb.mx[0] - aabb.mn[0]);
  const sy = (aabb.mx[1] - aabb.mn[1]);
  const sz = (aabb.mx[2] - aabb.mn[2]);

  const seed = motifIdx * 0.137 + 0.71;
  const boxes = [];
  for (let k = 0; k < INNER_BOX_COUNT; k++) {
    const scale = INNER_SCALE_BASE * Math.pow(INNER_SCALE_RATIO, k);
    const hx = sx * 0.5 * scale;
    const hy = sy * 0.5 * scale;
    const hz = sz * 0.5 * scale;
    const ox = (hash1([seed, k, 0]) - 0.5) * sx * INNER_OFFSET_FRAC;
    const oy = (hash1([seed, k, 1]) - 0.5) * sy * INNER_OFFSET_FRAC;
    const oz = (hash1([seed, k, 2]) - 0.5) * sz * INNER_OFFSET_FRAC;
    boxes.push({
      mn: [cx - hx + ox, cy - hy + oy, cz - hz + oz],
      mx: [cx + hx + ox, cy + hy + oy, cz + hz + oz],
    });
  }
  return boxes;
}

function buildOuterGlassMesh(gl, aabb) {
  const positions = [], normals = [], indices = [];
  const baseRef = { value: 0 };
  pushBoxFaces(positions, normals, indices, baseRef, aabb.mn, aabb.mx);
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices:   new Uint16Array(indices),
  });
}

function buildInnerGlassMesh(gl, innerBoxes) {
  if (innerBoxes.length === 0) return null;
  const positions = [], normals = [], indices = [];
  const baseRef = { value: 0 };
  for (const b of innerBoxes) {
    pushBoxFaces(positions, normals, indices, baseRef, b.mn, b.mx);
  }
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices:   new Uint16Array(indices),
  });
}

function buildInnerWiresMesh(gl, aabb, innerBoxes) {
  const positions = [], alphas = [];
  // Outermost cube wireframe is already drawn by the standalone wireframe
  // pass — emit only the inner nested boxes here.
  for (const b of innerBoxes) {
    pushBoxWireEdges(positions, alphas, b.mn, b.mx);
  }
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    mode:      'LINES',
  });
}

// Fine face-grid lines for the outer cube + every inner box. Drawn at low
// opacity through the lines material — these are what give the glass its
// "graph paper engraved on every face" look.
function buildFaceGridMesh(gl, aabb, innerBoxes) {
  const positions = [], alphas = [];
  pushBoxFaceGrid(positions, alphas, aabb.mn, aabb.mx, FACE_GRID_OUTER);
  for (const b of innerBoxes) {
    pushBoxFaceGrid(positions, alphas, b.mn, b.mx, FACE_GRID_INNER);
  }
  if (positions.length === 0) return null;
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    mode:      'LINES',
  });
}

// Bright billboard sparkles at every corner of the outer cube + every inner
// box. Six floats per instance: (pos.xyz, size, seed, depth) — same layout
// as the existing edge-glow material expects.
function buildVertexSparklesMesh(gl, aabb, innerBoxes, motifIdx) {
  const corners = [];
  const pushCorners = (mn, mx) => {
    corners.push(
      [mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]],
      [mn[0], mx[1], mn[2]], [mx[0], mx[1], mn[2]],
      [mn[0], mn[1], mx[2]], [mx[0], mn[1], mx[2]],
      [mn[0], mx[1], mx[2]], [mx[0], mx[1], mx[2]],
    );
  };
  pushCorners(aabb.mn, aabb.mx);
  for (const b of innerBoxes) pushCorners(b.mn, b.mx);

  const data = new Float32Array(corners.length * 6);
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    const seed = motifIdx * 0.137 + i * 0.0173;
    data[i * 6 + 0] = c[0];
    data[i * 6 + 1] = c[1];
    data[i * 6 + 2] = c[2];
    data[i * 6 + 3] = SPARKLE_SIZE * (0.7 + hash1([seed, 1, 0]) * 0.6);
    data[i * 6 + 4] = seed;
    data[i * 6 + 5] = 1.0;
  }
  return createInstancedBillboardMesh(gl, data);
}

// ---------------------------------------------------------------------------

export function buildCubeGlass(motifIdx, hilbert, gl, meshes, mode) {
  if (mode !== '3D') return [];

  const aabb = cubeAABB(hilbert, motifIdx);
  const innerBoxes = computeInnerBoxes(aabb, motifIdx);

  const outerKey = `cube-outer-${motifIdx}`;
  const innerKey = `cube-inner-${motifIdx}`;
  const wireKey  = `cube-wires-${motifIdx}`;
  const gridKey  = `cube-grid-${motifIdx}`;
  const sparkKey = `cube-spark-${motifIdx}`;

  if (!meshes[outerKey]) meshes[outerKey] = buildOuterGlassMesh(gl, aabb);
  if (!meshes[innerKey]) {
    const m = buildInnerGlassMesh(gl, innerBoxes.slice(0, INNER_GLASS_COUNT));
    if (m) meshes[innerKey] = m;
  }
  if (!meshes[wireKey])  meshes[wireKey]  = buildInnerWiresMesh(gl, aabb, innerBoxes);
  if (!meshes[gridKey]) {
    const m = buildFaceGridMesh(gl, aabb, innerBoxes);
    if (m) meshes[gridKey] = m;
  }
  if (!meshes[sparkKey]) meshes[sparkKey] = buildVertexSparklesMesh(gl, aabb, innerBoxes, motifIdx);

  const transform = mat4(); identity(transform);
  const items = [];

  // Outer translucent glass shell.
  items.push({
    mesh: outerKey,
    material: 'stone-glass',
    transform,
    blend: 'alpha',
    uniforms: { uTint: WHITE_TINT, uAlpha: OUTER_GLASS_ALPHA },
  });

  // Inner translucent glass boxes (subset of the nested set).
  if (meshes[innerKey]) {
    items.push({
      mesh: innerKey,
      material: 'stone-glass',
      transform,
      blend: 'alpha',
      uniforms: { uTint: WHITE_TINT, uAlpha: INNER_GLASS_ALPHA },
    });
  }

  // All nested wireframes — additive so they read as bright wires.
  items.push({
    mesh: wireKey,
    material: 'lines',
    transform,
    blend: 'additive',
    uniforms: { uBaseCol: WIRE_TINT, uLineOpacity: WIRE_OPACITY },
  });

  // Fine face-grid lines on outer cube + every inner box — the engraved
  // graph-paper layer.
  if (meshes[gridKey]) {
    items.push({
      mesh: gridKey,
      material: 'lines',
      transform,
      blend: 'additive',
      uniforms: { uBaseCol: GRID_TINT, uLineOpacity: FACE_GRID_OPACITY },
    });
  }

  // Sparkle billboards at every wireframe vertex — bright glints that
  // catch the camera as it orbits.
  items.push({
    mesh: sparkKey,
    material: 'edge-glow',
    transform,
    blend: 'additive',
    uniforms: { uTint: SPARK_TINT, uOpacity: SPARKLE_OPACITY },
  });

  return items;
}
