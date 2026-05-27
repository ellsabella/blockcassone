// Shared 2D-plane helpers used by all three glass-etching generators
// (stone, water, forest). Each plane is an axis-aligned quad in 3D; we
// project to a plane-local 2D (UV) frame for ring/curve generation, then
// project segments back to world space and clip to the plane outline.

import { V } from '../tree-walker.js';

// Orthonormal in-plane basis (T, B) plus normal N.
//   T = unit vector along v0→v1 (the plane's first edge)
//   N = T × (v0→v3), normalised — the plane's outward normal
//   B = N × T, the second in-plane axis (orthogonal to T)
export function planeBasis(plane) {
  const p = plane.vertices.positions;
  const e1 = [p[1].x - p[0].x, p[1].y - p[0].y, p[1].z - p[0].z];
  const e2 = [p[3].x - p[0].x, p[3].y - p[0].y, p[3].z - p[0].z];
  const N = V.norm(V.cross(e1, e2));
  const T = V.norm(e1);
  const B = V.norm(V.cross(N, T));
  return { N, T, B };
}

// Centroid of the plane's 4 corners (world space).
export function planeCentre(plane) {
  const p = plane.vertices.positions;
  return [
    (p[0].x + p[1].x + p[2].x + p[3].x) * 0.25,
    (p[0].y + p[1].y + p[2].y + p[3].y) * 0.25,
    (p[0].z + p[1].z + p[2].z + p[3].z) * 0.25,
  ];
}

// World-space point → plane-local UV.
export function toUV(p, pc, T, B) {
  const dx = p[0] - pc[0], dy = p[1] - pc[1], dz = p[2] - pc[2];
  return [
    dx * T[0] + dy * T[1] + dz * T[2],
    dx * B[0] + dy * B[1] + dz * B[2],
  ];
}

// Plane-grid UV → world space (bilinear over the 4 corners).
export function uvToWorld(u, v, p) {
  return [
    p[0].x + u * (p[1].x - p[0].x) + v * (p[3].x - p[0].x),
    p[0].y + u * (p[1].y - p[0].y) + v * (p[3].y - p[0].y),
    p[0].z + u * (p[1].z - p[0].z) + v * (p[3].z - p[0].z),
  ];
}


// World-space positions of every active edge bit on this plane, returned in
// plane-local UV coordinates. Each bit is annotated with `{ uv, edge, sub }`
// so callers can use the source edge for seeding / inward direction.
export function collectActiveBitsUV(plane, pc, T, B) {
  const bits = [];
  const pos  = plane.vertices.positions;
  for (let edge = 0; edge < 3; edge++) {
    const pattern = plane.edgePatterns[edge] || [];
    const v0 = pos[edge];
    const v1 = pos[edge + 1];
    for (let sub = 0; sub < 7; sub++) {
      if (pattern[sub] !== 1) continue;
      const t = (sub + 1) / 8;
      const world = [
        v0.x + (v1.x - v0.x) * t,
        v0.y + (v1.y - v0.y) * t,
        v0.z + (v1.z - v0.z) * t,
      ];
      bits.push({ uv: toUV(world, pc, T, B), edge, sub });
    }
  }
  return bits;
}

// Signed twice-area of a polygon. Positive ⇔ CCW winding.
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

export function ensureCCW(poly) {
  return signedArea(poly) >= 0 ? poly : poly.slice().reverse();
}

// Plane outline as a CCW polygon in UV — used as the clipping window so
// nothing leaks past the plane edge.
export function planePolyUV(plane, pc, T, B) {
  const poly = plane.vertices.positions.map(v => toUV([v.x, v.y, v.z], pc, T, B));
  return ensureCCW(poly);
}

// Liang–Barsky clip of segment a→b against a CCW convex polygon.
// Returns [aClip, bClip] in 2D, or null if fully outside.
export function clipSegment(a, b, poly) {
  let tEnter = 0, tLeave = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    const ex = p2[0] - p1[0], ey = p2[1] - p1[1];
    const nx = ey, ny = -ex;                        // outward normal for CCW
    const denom = dx * nx + dy * ny;
    const num   = (p1[0] - a[0]) * nx + (p1[1] - a[1]) * ny;
    if (Math.abs(denom) < 1e-12) {
      if (num < 0) return null;                     // parallel & outside
      continue;
    }
    const t = num / denom;
    if (denom > 0) { if (t < tLeave) tLeave = t; }
    else           { if (t > tEnter) tEnter = t; }
    if (tEnter > tLeave) return null;
  }
  return [
    [a[0] + tEnter * dx, a[1] + tEnter * dy],
    [a[0] + tLeave * dx, a[1] + tLeave * dy],
  ];
}
