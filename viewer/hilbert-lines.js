// Hilbert path lines — neon green segments connecting the 8 Hilbert-path
// vertices of a motif's cube.  Rendered in both 2D and 3D modes; edge-point
// blobs are pushed after these so they appear on top under additive blending.
//
// Uses the same capsule-SDF glow pipeline as the normie outlines:
//   core pass  → 'lines' material (thin bright strip)
//   glow pass  → 'normie-glow' material (wide capsule-SDF Gaussian, smooth round caps)

import { mat4, identity } from '/renderer/src/math.js';
import { worldPerp, buildCoreLineMesh, buildGlowLineMesh } from './materials/line-mesh.js';

const GREEN        = new Float32Array([0.0, 1.0, 0.2]);
const CORE_WIDTH   = 0.003;
const GLOW_WIDTH   = 0.022;
const LINE_OPACITY = 0.95;
const GLOW_OPACITY = 0.65;
const SAT_BOOST    = 2.4;
const HDR_GAIN     = 1.6;

function luminescentTint(tint) {
  const lum = tint[0]*0.299 + tint[1]*0.587 + tint[2]*0.114;
  return new Float32Array([
    (lum + (tint[0]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[1]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[2]-lum)*SAT_BOOST)*HDR_GAIN,
  ]);
}

// Builds and caches a single mesh for all N-1 inter-cube connections along the
// Hilbert path: the segment from the last vertex of cube i to the first vertex
// of cube i+1, for every consecutive cube pair.
export function buildHilbertConnectors(hilbert, gl, meshes) {
  const lineKey = 'hilbert-connectors-line';
  const glowKey = 'hilbert-connectors-glow';

  if (meshes[lineKey] === undefined) {
    const nCubes = Math.floor(hilbert.rawVertices.length / 8);
    if (nCubes < 2) { meshes[lineKey] = null; meshes[glowKey] = null; }
    else {
      const flat = new Float32Array((nCubes - 1) * 6);
      for (let i = 0; i < nCubes - 1; i++) {
        const a = hilbert.rawVertices[i * 8 + 7];
        const b = hilbert.rawVertices[(i + 1) * 8];
        flat[i*6+0] = a.x; flat[i*6+1] = a.y; flat[i*6+2] = a.z;
        flat[i*6+3] = b.x; flat[i*6+4] = b.y; flat[i*6+5] = b.z;
      }
      meshes[lineKey] = buildCoreLineMesh(gl, flat, worldPerp, CORE_WIDTH);
      meshes[glowKey] = buildGlowLineMesh(gl, flat, worldPerp, GLOW_WIDTH);
    }
  }

  const lumColor  = luminescentTint(GREEN);
  const transform = mat4(); identity(transform);
  const items = [];
  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: lumColor, uAlpha: GLOW_OPACITY },
  });
  if (meshes[lineKey]) items.push({
    mesh: lineKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: lumColor, uLineOpacity: LINE_OPACITY },
  });
  return items;
}

// Full continuous Hilbert curve: every consecutive raw vertex, including both
// intra-cube motif segments and inter-cube connector segments. This is the
// empty mint-state scaffold.
export function buildFullHilbertPath(hilbert, gl, meshes) {
  const lineKey = 'hilbert-full-path-line';
  const glowKey = 'hilbert-full-path-glow';

  if (meshes[lineKey] === undefined) {
    const n = hilbert.rawVertices.length;
    if (n < 2) { meshes[lineKey] = null; meshes[glowKey] = null; }
    else {
      const flat = new Float32Array((n - 1) * 6);
      for (let i = 0; i < n - 1; i++) {
        const a = hilbert.rawVertices[i];
        const b = hilbert.rawVertices[i + 1];
        flat[i*6+0] = a.x; flat[i*6+1] = a.y; flat[i*6+2] = a.z;
        flat[i*6+3] = b.x; flat[i*6+4] = b.y; flat[i*6+5] = b.z;
      }
      meshes[lineKey] = buildCoreLineMesh(gl, flat, worldPerp, CORE_WIDTH * 0.82);
      meshes[glowKey] = buildGlowLineMesh(gl, flat, worldPerp, GLOW_WIDTH * 0.72);
    }
  }

  const lumColor = luminescentTint(GREEN);
  const transform = mat4(); identity(transform);
  const items = [];
  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: lumColor, uAlpha: GLOW_OPACITY * 0.62 },
  });
  if (meshes[lineKey]) items.push({
    mesh: lineKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: lumColor, uLineOpacity: LINE_OPACITY * 0.82 },
  });
  return items;
}
// Returns scene items: glow pass first, core pass second (renders on top under additive blend).
export function buildHilbertLines(motifIdx, hilbert, gl, meshes) {
  const lineKey = `hilbert-lines-line-${motifIdx}`;
  const glowKey = `hilbert-lines-glow-${motifIdx}`;

  if (meshes[lineKey] === undefined) {
    // 8 Hilbert-path vertices (raw integer coords, same space as everything else).
    const base = motifIdx * 8;
    // 8 Hilbert-path vertices → 7 consecutive segments.
    const flat = new Float32Array(7 * 6);
    for (let i = 0; i < 7; i++) {
      const a = hilbert.rawVertices[base + i];
      const b = hilbert.rawVertices[base + i + 1];
      flat[i*6+0] = a.x; flat[i*6+1] = a.y; flat[i*6+2] = a.z;
      flat[i*6+3] = b.x; flat[i*6+4] = b.y; flat[i*6+5] = b.z;
    }

    meshes[lineKey] = buildCoreLineMesh(gl, flat, worldPerp, CORE_WIDTH);
    meshes[glowKey] = buildGlowLineMesh(gl, flat, worldPerp, GLOW_WIDTH);
  }

  const lumColor  = luminescentTint(GREEN);
  const transform = mat4(); identity(transform);
  const items = [];

  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: lumColor, uAlpha: GLOW_OPACITY },
  });
  if (meshes[lineKey]) items.push({
    mesh: lineKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: lumColor, uLineOpacity: LINE_OPACITY },
  });
  return items;
}
