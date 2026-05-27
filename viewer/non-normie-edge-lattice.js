import { mat4, identity } from '/renderer/src/math.js';
import { worldPerp, buildCoreLineMesh, buildGlowLineMesh } from './materials/line-mesh.js';

const CORE_WIDTH   = 0.0012;
const GLOW_WIDTH   = 0.0065;
const LINE_OPACITY = 0.24;
const GLOW_OPACITY = 0.055;
const TINT         = new Float32Array([1.0, 0.36, 0.08]);
const SAT_BOOST    = 1.7;
const HDR_GAIN     = 0.68;

function luminescentTint(tint) {
  const lum = tint[0]*0.299 + tint[1]*0.587 + tint[2]*0.114;
  return new Float32Array([
    (lum + (tint[0]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[1]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[2]-lum)*SAT_BOOST)*HDR_GAIN,
  ]);
}

function lerpVertex(a, b, t) {
  return [
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  ];
}

export function buildNonNormieEdgeLattice(motifIdx, hilbert, gl, meshes) {
  const lineKey = `non-normie-edge-lattice-line-${motifIdx}`;
  const glowKey = `non-normie-edge-lattice-glow-${motifIdx}`;

  if (meshes[lineKey] === undefined) {
    const base = motifIdx * 8;
    const verts = [];
    for (let i = 0; i < 8; i++) verts.push(hilbert.rawVertices[base + i]);

    const segs = [];
    // 7 Hilbert edges produce 6 turn pairs. For each adjacent edge pair,
    // connect matching invisible subdivision points 1..39, excluding corners.
    for (let e = 0; e < 6; e++) {
      const a0 = verts[e], a1 = verts[e + 1];
      const b0 = verts[e + 1], b1 = verts[e + 2];
      for (let k = 1; k <= 39; k++) {
        const t = k / 40;
        const pa = lerpVertex(a0, a1, t);
        const pb = lerpVertex(b0, b1, t);
        segs.push(...pa, ...pb);
      }
    }

    const flat = new Float32Array(segs);
    meshes[lineKey] = buildCoreLineMesh(gl, flat, worldPerp, CORE_WIDTH);
    meshes[glowKey] = buildGlowLineMesh(gl, flat, worldPerp, GLOW_WIDTH);
  }

  const col = luminescentTint(TINT);
  const transform = mat4(); identity(transform);
  const items = [];
  if (meshes[glowKey]) items.push({
    mesh: glowKey, material: 'normie-glow', transform, blend: 'additive',
    uniforms: { uTint: col, uAlpha: GLOW_OPACITY },
  });
  if (meshes[lineKey]) items.push({
    mesh: lineKey, material: 'lines', transform, blend: 'additive',
    uniforms: { uBaseCol: col, uLineOpacity: LINE_OPACITY },
  });
  return items;
}
