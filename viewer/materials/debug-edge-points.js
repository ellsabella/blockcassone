// Debug visualization for geometry sanity checks.
//   Edge bits (21 possible per plane) — glow in the plane's axis colour
//   Plane corners (v0..v3)           — glow in white, slightly larger
// Both use the additive `edge-glow` billboard material; the two sets are
// cached separately so each plane contributes two scene items.

import { createInstancedBillboardMesh } from '../instanced-mesh.js';
import { mat4, identity } from '/renderer/src/math.js';

const BIT_SIZE    = 0.030;
const CORNER_SIZE = 0.055;
const CORNER_COL  = new Float32Array([2.5, 2.5, 2.5]);  // bright white for corners

function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors && CONFIG.axisColors[axis])
    ? CONFIG.axisColors[axis].hex
    : '#ffffff';
  const r = parseInt(hex.substr(1, 2), 16) / 255;
  const g = parseInt(hex.substr(3, 2), 16) / 255;
  const b = parseInt(hex.substr(5, 2), 16) / 255;
  // Over-drive so additive blend reads as saturated coloured glow.
  return new Float32Array([
    Math.min(3.0, r * 2.2 + 0.3),
    Math.min(3.0, g * 2.2 + 0.3),
    Math.min(3.0, b * 2.2 + 0.3),
  ]);
}

function buildBitsMesh(plane, gl, meshes) {
  const key = `debug-bits-${plane.id}`;
  if (meshes[key]) return key;
  const pos = plane.vertices.positions;
  const instances = [];
  for (let bi = 0; bi < 21; bi++) {
    const edge = (bi / 7) | 0;
    const sub  = bi - edge * 7;
    const pattern = plane.edgePatterns[edge] || [];
    if (pattern[sub] !== 1) continue;
    const t = (sub + 1) / 8;
    const v0 = pos[edge];
    const v1 = pos[edge + 1];
    instances.push(
      v0.x + (v1.x - v0.x) * t,
      v0.y + (v1.y - v0.y) * t,
      v0.z + (v1.z - v0.z) * t,
      BIT_SIZE,
      bi * 0.173,
      1.0,
    );
  }
  if (instances.length === 0) return null;
  meshes[key] = createInstancedBillboardMesh(gl, new Float32Array(instances));
  return key;
}

function buildCornersMesh(plane, gl, meshes) {
  const key = `debug-corners-${plane.id}`;
  if (meshes[key]) return key;
  const pos = plane.vertices.positions;
  const instances = [];
  for (let i = 0; i < 4; i++) {
    instances.push(
      pos[i].x, pos[i].y, pos[i].z,
      CORNER_SIZE,
      i * 0.211 + 0.7,
      1.0,
    );
  }
  meshes[key] = createInstancedBillboardMesh(gl, new Float32Array(instances));
  return key;
}

export function buildEdgePointDebug(plane, gl, meshes) {
  const transform = mat4(); identity(transform);
  const items = [];

  const bitsKey = buildBitsMesh(plane, gl, meshes);
  if (bitsKey) {
    items.push({
      mesh: bitsKey,
      material: 'edge-glow',
      transform,
      blend: 'additive',
      uniforms: { uTint: axisColorLinear(plane.axis), uOpacity: 1.0 },
    });
  }

  const cornersKey = buildCornersMesh(plane, gl, meshes);
  items.push({
    mesh: cornersKey,
    material: 'edge-glow',
    transform,
    blend: 'additive',
    uniforms: { uTint: CORNER_COL, uOpacity: 1.0 },
  });

  return items;
}
