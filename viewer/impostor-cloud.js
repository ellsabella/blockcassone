// World-filling impostor cloud — LOD tier A.
//
// One glowing billboard dot per world slot so the whole Block reads as inhabited
// at range, instead of an empty lattice with a few detailed foci. Empty slots are
// tinted by their on-chain biome (environmentIdForStreet); occupied slots glow
// rainbow-by-region so real cubes pop as landmarks. Dots are grouped by tint and
// drawn with the existing instanced `edge-glow` material, so all ~4096 dots cost a
// handful of draw calls and zero new GL plumbing.
//
// Positions live in the same raw-Hilbert space (0..N) as the spine and camera, so
// the cloud registers exactly with the detailed cubes. Shared by the token-renderer
// hero and the Big Cube viewer.

import { createInstancedBillboardMesh } from './instanced-mesh.js';
import { environmentIdForStreet } from '../core/cube-env.js';
import { crystalTintForEnv } from './crystal-biome.js';
import { mat4, identity } from '../renderer/src/math.js';

// Center + max-axis extent of a slot's 8 raw Hilbert vertices (same as entry.js's
// cubeAABB, inlined here to keep this module self-contained).
function slotCenterSize(hilbert, m) {
  const base = m * 8;
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = hilbert.rawVertices[base + i];
    if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x;
    if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
    if (v.z < mnz) mnz = v.z; if (v.z > mxz) mxz = v.z;
  }
  return { cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, cz: (mnz + mxz) / 2, ext: Math.max(mxx - mnx, mxy - mny, mxz - mnz) };
}

function hslRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

// Returns draw items (blend 'additive'), each tagged `_cloud` + `_baseOpacity` so a
// caller can fade the whole cloud per frame by camera distance (distance LOD).
export function buildImpostorCloud(gl, hilbert, meshes, opts = {}) {
  const total = Math.floor(hilbert.rawVertices.length / 8);
  const {
    motifStart = 0,
    motifCount = total,
    occupiedSlots = new Set(),  // Set<motifIdx> of real cubes
    dotsForOccupied = true,     // false → no dot where a real cube sits (it renders itself)
    emptySize = 0.32,           // world-space dot radius (× slot extent)
    occupiedSize = 0.62,
    emptyOpacity = 0.42,
    occupiedOpacity = 1.0,
    regionSize = 512,
    keyPrefix = 'impostor',
  } = opts;

  const start = Math.max(0, motifStart);
  const end = Math.min(total, motifStart + motifCount);
  const buckets = new Map(); // tintKey -> { tint:[r,g,b], opacity, data:number[] }
  const bucketFor = (key, tint, opacity) => {
    let b = buckets.get(key);
    if (!b) { b = { tint, opacity, data: [] }; buckets.set(key, b); }
    return b;
  };

  for (let m = start; m < end; m++) {
    const isOcc = occupiedSlots.has(m);
    if (isOcc && !dotsForOccupied) continue; // a real cube sits here — no impostor dot at its centre
    const s = slotCenterSize(hilbert, m);
    if (isOcc) {
      const region = Math.floor(m / regionSize);
      const [r, g, b] = hslRgb(region / 8, 0.95, 0.6);
      bucketFor('occ-' + region, [r * 1.7, g * 1.7, b * 1.7], occupiedOpacity)
        .data.push(s.cx, s.cy, s.cz, occupiedSize * s.ext, m, 1.0);
    } else {
      const envId = environmentIdForStreet(Math.floor(m / 8));
      bucketFor('env-' + envId, crystalTintForEnv(envId), emptyOpacity)
        .data.push(s.cx, s.cy, s.cz, emptySize * s.ext, m, 1.0);
    }
  }

  const items = [];
  for (const [key, b] of buckets) {
    if (!b.data.length) continue;
    const mk = `${keyPrefix}-${key}-${start}-${end}`;
    if (meshes[mk] === undefined) meshes[mk] = createInstancedBillboardMesh(gl, new Float32Array(b.data));
    const transform = mat4(); identity(transform);
    items.push({
      mesh: mk, material: 'edge-glow', blend: 'additive', transform,
      uniforms: { uTint: new Float32Array(b.tint), uOpacity: b.opacity },
      _cloud: true, _baseOpacity: b.opacity,
    });
  }
  return items;
}
