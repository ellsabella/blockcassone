// Cube cardioid — sparse string-art lines connecting active edge bits to
// the nearest cube corner.
//
// For each plane in the motif, each active bit (edgePatterns[e][b] === 1)
// sits at world position t=(b+1)/8 along edge e.  We find which of the 8
// cube corners is closest to that point and draw a glowing line between
// them.  The result is a sparse data-driven web radiating inward from the
// cube's corners — visually related to the cardioid's radiating-line
// construction, but grounded in the artwork's own geometry.
//
// Depth-test note: all segments lie on cube face planes.  The quad width
// direction must be the face NORMAL (outward), not any in-plane vector.
// This is the same cross(segDir, faceNormal) trick used by buildCoreLineMesh —
// half the quad extends outside the opaque surface and passes depth test.

import { createMeshGL }   from '/renderer/src/geometry.js';
import { mat4, identity } from '/renderer/src/math.js';

const CORE_WIDTH    = 0.003;
const GLOW_WIDTH    = 0.025;
const LINE_OPACITY  = 0.80;
const GLOW_OPACITY  = 0.45;
const SAT_BOOST     = 2.4;
const HDR_GAIN      = 1.6;
const TINT          = new Float32Array([1.0, 0.22, 0.52]);  // deep pink

function luminescentTint(tint) {
  const lum = tint[0]*0.299 + tint[1]*0.587 + tint[2]*0.114;
  return new Float32Array([
    (lum + (tint[0]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[1]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[2]-lum)*SAT_BOOST)*HDR_GAIN,
  ]);
}

// Build indexed quad geometry for line segments using a per-segment normal
// as the width direction (so the quad extends outward from the cube surface
// rather than lying flat in it).
//
// flatSegs:  Float32Array [x0,y0,z0, x1,y1,z1, ...]  — 6 floats per seg
// flatNorms: Float32Array [nx,ny,nz, ...]              — 3 floats per seg
//            Each normal is the outward face normal for that segment.
// Small outward push so segments clear the opaque SDF-proxy face depth.
// Plane-outline segments lie on face boundaries where the perp extension
// escapes the face area (no opaque depth there) — cardioid segments are
// interior so every fragment competes with the face depth.
const FACE_BIAS = 0.002;  // push front-face segs just ahead of SDF-proxy depth

function buildFaceLineQuads(gl, flatSegs, flatNorms, width, includeUvs = false) {
  if (!flatSegs || flatSegs.length === 0) return null;
  const hw = width * 0.5;
  const positions = [], uvs = [], lhws = [], indices = [];
  let vi = 0;
  const nSegs = flatSegs.length / 6;

  for (let s = 0; s < nSegs; s++) {
    const i = s * 6;
    const p0x = flatSegs[i],   p0y = flatSegs[i+1], p0z = flatSegs[i+2];
    const p1x = flatSegs[i+3], p1y = flatSegs[i+4], p1z = flatSegs[i+5];

    const dx = p1x-p0x, dy = p1y-p0y, dz = p1z-p0z;
    const dl = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dl < 1e-10) continue;
    const ddx = dx/dl, ddy = dy/dl, ddz = dz/dl;

    // Perpendicular = cross(segDir, faceNormal) — same as buildCoreLineMesh.
    // the outward half passes depth test against opaque face geometry.
    const j  = s * 3;
    const nx = flatNorms[j], ny = flatNorms[j+1], nz = flatNorms[j+2];
    let px = ddy*nz - ddz*ny;
    let py = ddz*nx - ddx*nz;
    let pz = ddx*ny - ddy*nx;
    const pl = Math.sqrt(px*px + py*py + pz*pz);
    if (pl < 1e-10) {
      console.warn(`[cardioid-mesh] seg ${s}: degenerate perp, segDir=(${ddx.toFixed(3)},${ddy.toFixed(3)},${ddz.toFixed(3)}) norm=(${nx},${ny},${nz}) — skipping`);
      continue;
    } else {
      px /= pl; py /= pl; pz /= pl;
    }

    // Push both endpoints outward by FACE_BIAS along the face normal so the
    // geometry clears the opaque SDF-proxy depth that was written at face depth.
    const bx0 = p0x + nx*FACE_BIAS, by0 = p0y + ny*FACE_BIAS, bz0 = p0z + nz*FACE_BIAS;
    const bx1 = p1x + nx*FACE_BIAS, by1 = p1y + ny*FACE_BIAS, bz1 = p1z + nz*FACE_BIAS;
    if (s === 0 && !includeUvs) console.log(`[cardioid-mesh] seg0 norm=(${nx},${ny},${nz}) pushed (${p0x},${p0y},${p0z})→(${bx0.toFixed(3)},${by0.toFixed(3)},${bz0.toFixed(3)}) perp=(${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)})`);

    if (includeUvs) {
      const L_hw = dl / hw;
      positions.push(
        bx0 - ddx*hw - px*hw, by0 - ddy*hw - py*hw, bz0 - ddz*hw - pz*hw,
        bx0 - ddx*hw + px*hw, by0 - ddy*hw + py*hw, bz0 - ddz*hw + pz*hw,
        bx1 + ddx*hw - px*hw, by1 + ddy*hw - py*hw, bz1 + ddz*hw - pz*hw,
        bx1 + ddx*hw + px*hw, by1 + ddy*hw + py*hw, bz1 + ddz*hw + pz*hw,
      );
      uvs.push(-1, -1,  -1, +1,  L_hw+1, -1,  L_hw+1, +1);
      lhws.push(L_hw, L_hw, L_hw, L_hw);
    } else {
      positions.push(
        bx0 - px*hw, by0 - py*hw, bz0 - pz*hw,
        bx0 + px*hw, by0 + py*hw, bz0 + pz*hw,
        bx1 - px*hw, by1 - py*hw, bz1 - pz*hw,
        bx1 + px*hw, by1 + py*hw, bz1 + pz*hw,
      );
    }
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }

  if (positions.length === 0) return null;
  const posArr   = new Float32Array(positions);
  const alphaArr = new Float32Array(includeUvs ? lhws : new Array(posArr.length / 3).fill(1.0));
  const meshData = { positions: posArr, alphas: alphaArr, indices: new Uint16Array(indices) };
  if (includeUvs) meshData.uvs = new Float32Array(uvs);
  return createMeshGL(gl, meshData);
}

// ---------------------------------------------------------------------------
// Public builder — cached per motif, 3D mode only.
// ---------------------------------------------------------------------------
export function buildCubeCardioid(motifIdx, hilbert, allPlanes, gl, meshes) {
  const lineKey = `cube-cardioid-line-${motifIdx}`;
  const glowKey = `cube-cardioid-glow-${motifIdx}`;

  if (meshes[lineKey] === undefined) {
    const cubePlanes = allPlanes.filter(p =>
      p.hierarchy && p.hierarchy.motifIndex === motifIdx
    );

    // Collect the 8 raw-integer cube corners from the motif's AABB.
    const base = motifIdx * 8;
    const mn = [ Infinity,  Infinity,  Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const v = hilbert.rawVertices[base + i];
      if (v.x < mn[0]) mn[0] = v.x;  if (v.x > mx[0]) mx[0] = v.x;
      if (v.y < mn[1]) mn[1] = v.y;  if (v.y > mx[1]) mx[1] = v.y;
      if (v.z < mn[2]) mn[2] = v.z;  if (v.z > mx[2]) mx[2] = v.z;
    }
    const cx = (mn[0]+mx[0])*0.5;
    const cy = (mn[1]+mx[1])*0.5;
    const cz = (mn[2]+mx[2])*0.5;

    const corners = [
      [mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]],
      [mn[0], mx[1], mn[2]], [mx[0], mx[1], mn[2]],
      [mn[0], mn[1], mx[2]], [mx[0], mn[1], mx[2]],
      [mn[0], mx[1], mx[2]], [mx[0], mx[1], mx[2]],
    ];

    const segs  = [];  // 6 floats per seg
    const norms = [];  // 3 floats per seg — outward face normal

    for (const plane of cubePlanes) {
      const p = plane.vertices.positions;  // raw integer coords

      // Outward face normal from plane axis + position relative to cube centre.
      let fnx = 0, fny = 0, fnz = 0;
      if (plane.axis === 'x') {
        fnx = (p[0].x < cx) ? -1 : 1;
      } else if (plane.axis === 'y') {
        fny = (p[0].y < cy) ? -1 : 1;
      } else {
        fnz = (p[0].z < cz) ? -1 : 1;
      }

      for (let e = 0; e < 3; e++) {
        const pattern = plane.edgePatterns?.[e];
        if (!pattern) continue;
        const v0 = p[e], v1 = p[e + 1];

        for (let b = 0; b < 7; b++) {
          if (pattern[b] !== 1) continue;

          // World position of this active bit.
          const t  = (b + 1) / 8;
          const bx = v0.x + t * (v1.x - v0.x);
          const by = v0.y + t * (v1.y - v0.y);
          const bz = v0.z + t * (v1.z - v0.z);

          // Nearest of the 8 cube corners (by Euclidean distance).
          let bestDist = Infinity, bestCorner = corners[0];
          for (const c of corners) {
            const d = (bx-c[0])**2 + (by-c[1])**2 + (bz-c[2])**2;
            if (d < bestDist) { bestDist = d; bestCorner = c; }
          }

          segs.push(bestCorner[0], bestCorner[1], bestCorner[2], bx, by, bz);
          norms.push(fnx, fny, fnz);
        }
      }
    }

    if (segs.length === 0) {
      console.warn(`[cardioid] motif ${motifIdx}: no active bits found. planes=${cubePlanes.length}, sample edgePatterns:`, cubePlanes[0]?.edgePatterns);
      meshes[lineKey] = null;
      meshes[glowKey] = null;
    } else {
      console.log(`[cardioid] motif ${motifIdx}: ${segs.length/6} segs, aabb=[${mn}]..[${mx}]`);
      console.log(`[cardioid] planes axes:`, cubePlanes.map(p=>p.axis));
      console.log(`[cardioid] first seg:`, segs.slice(0,6), 'norm:', norms.slice(0,3));
      const flat  = new Float32Array(segs);
      const fNorm = new Float32Array(norms);
      meshes[lineKey] = buildFaceLineQuads(gl, flat, fNorm, CORE_WIDTH);
      meshes[glowKey] = buildFaceLineQuads(gl, flat, fNorm, GLOW_WIDTH, true);
      console.log(`[cardioid] meshes built: line=${!!meshes[lineKey]}, glow=${!!meshes[glowKey]}`);
      if (meshes[lineKey]) console.log(`[cardioid] line mesh indexCount=${meshes[lineKey].indexCount}`);
    }
  }

  const lumColor  = luminescentTint(TINT);
  const transform = mat4(); identity(transform);
  const items     = [];
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
