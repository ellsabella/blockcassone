// Forest line bundles. Topology comes from forest-grow.js (shared with
// the particle cloud), this file is purely the visual: each segment becomes
// N jittered cubic-bezier strands rendered as additive GL_LINES.

import { hash1, V }                    from '../tree-walker.js';
import { createMeshGL }                from '/renderer/src/geometry.js';
import { mat4, identity }              from '/renderer/src/math.js';
import { generateForestSegments }      from './forest-grow.js';

// --- Tuning ---
const LINES_PER_SEGMENT = [9, 7, 6, 5, 4];
const LINE_JITTER       = [0.008, 0.012, 0.018, 0.024, 0.030];
const START_ALPHA_MIN = 0.35, START_ALPHA_RANGE = 0.55;
const END_ALPHA_MIN   = 0.08, END_ALPHA_RANGE   = 0.22;

// Bezier curve tessellation. Each segment becomes a cubic bezier with mild
// per-strand bending so the bundle reads as organic, not ruler-straight.
const BEZIER_SUBS              = 6;
const BEND_STRENGTH_PER_DEPTH  = [0.08, 0.12, 0.18, 0.24, 0.28];
const S_CURVE_PROB             = 0.3;

function cubic(p0, p1, p2, p3, t, out) {
  const u  = 1 - t;
  const c0 = u*u*u;
  const c1 = 3*u*u*t;
  const c2 = 3*u*t*t;
  const c3 = t*t*t;
  out[0] = c0*p0[0] + c1*p1[0] + c2*p2[0] + c3*p3[0];
  out[1] = c0*p0[1] + c1*p1[1] + c2*p2[1] + c3*p3[1];
  out[2] = c0*p0[2] + c1*p1[2] + c2*p2[2] + c3*p3[2];
  return out;
}

function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors[axis])
    ? CONFIG.axisColors[axis].hex
    : '#ffffff';
  const r = parseInt(hex.substr(1, 2), 16) / 255;
  const g = parseInt(hex.substr(3, 2), 16) / 255;
  const b = parseInt(hex.substr(5, 2), 16) / 255;
  return new Float32Array([r, g, b]);
}

function generateLineMesh(plane, hilbert, slicesByAxis) {
  const { segments, seedBase } = generateForestSegments(plane, hilbert, slicesByAxis);
  if (segments.length === 0) {
    return { positions: new Float32Array(0), alphas: new Float32Array(0), mode: 'LINES' };
  }

  const positions = [];
  const alphas    = [];

  for (const seg of segments) {
    const { a, b, depth, bi, segIdx } = seg;
    const di = Math.min(depth, LINES_PER_SEGMENT.length - 1);
    const count  = LINES_PER_SEGMENT[di];
    const jitter = LINE_JITTER[di];

    const segDir = V.norm(V.sub(b, a));
    let r1 = V.cross(segDir, [0, 1, 0]);
    if (V.len(r1) < 0.1) r1 = [1, 0, 0]; else r1 = V.norm(r1);
    const r2 = V.norm(V.cross(r1, segDir));

    const segLen = V.len(V.sub(b, a));
    const bendScale = BEND_STRENGTH_PER_DEPTH[di];

    const P0 = [0, 0, 0], P1 = [0, 0, 0], P2 = [0, 0, 0], P3 = [0, 0, 0];
    const pPrev = [0, 0, 0], pCurr = [0, 0, 0];

    for (let i = 0; i < count; i++) {
      const sSeed = seedBase + bi * 0.13 + segIdx * 0.077 + i * 0.029;

      const thS = hash1([sSeed, 0, 0]) * Math.PI * 2;
      const rS  = (0.25 + hash1([sSeed, 1, 0]) * 0.75) * jitter;
      const thE = thS + (hash1([sSeed, 2, 0]) - 0.5) * 1.2;
      const rE  = (0.25 + hash1([sSeed, 3, 0]) * 0.75) * jitter;
      const oSx = Math.cos(thS) * rS, oSy = Math.sin(thS) * rS;
      const oEx = Math.cos(thE) * rE, oEy = Math.sin(thE) * rE;

      P0[0] = a[0] + r1[0]*oSx + r2[0]*oSy;
      P0[1] = a[1] + r1[1]*oSx + r2[1]*oSy;
      P0[2] = a[2] + r1[2]*oSx + r2[2]*oSy;
      P3[0] = b[0] + r1[0]*oEx + r2[0]*oEy;
      P3[1] = b[1] + r1[1]*oEx + r2[1]*oEy;
      P3[2] = b[2] + r1[2]*oEx + r2[2]*oEy;

      const thB = hash1([sSeed, 6, 0]) * Math.PI * 2;
      const bMag = segLen * bendScale * (0.4 + hash1([sSeed, 7, 0]) * 0.9);
      const bdx = r1[0]*Math.cos(thB) + r2[0]*Math.sin(thB);
      const bdy = r1[1]*Math.cos(thB) + r2[1]*Math.sin(thB);
      const bdz = r1[2]*Math.cos(thB) + r2[2]*Math.sin(thB);
      const sCurve = hash1([sSeed, 8, 0]) < S_CURVE_PROB ? -1 : 1;

      P1[0] = P0[0] + (P3[0]-P0[0])*0.33 + bdx*bMag;
      P1[1] = P0[1] + (P3[1]-P0[1])*0.33 + bdy*bMag;
      P1[2] = P0[2] + (P3[2]-P0[2])*0.33 + bdz*bMag;
      P2[0] = P0[0] + (P3[0]-P0[0])*0.67 + bdx*bMag*sCurve;
      P2[1] = P0[1] + (P3[1]-P0[1])*0.67 + bdy*bMag*sCurve;
      P2[2] = P0[2] + (P3[2]-P0[2])*0.67 + bdz*bMag*sCurve;

      const aStart = START_ALPHA_MIN + hash1([sSeed, 4, 0]) * START_ALPHA_RANGE;
      const aEnd   = END_ALPHA_MIN   + hash1([sSeed, 5, 0]) * END_ALPHA_RANGE;

      cubic(P0, P1, P2, P3, 0, pPrev);
      for (let k = 1; k <= BEZIER_SUBS; k++) {
        const t = k / BEZIER_SUBS;
        cubic(P0, P1, P2, P3, t, pCurr);
        const tPrev = (k - 1) / BEZIER_SUBS;
        positions.push(
          pPrev[0], pPrev[1], pPrev[2],
          pCurr[0], pCurr[1], pCurr[2],
        );
        alphas.push(
          aStart + (aEnd - aStart) * tPrev,
          aStart + (aEnd - aStart) * t,
        );
        pPrev[0] = pCurr[0]; pPrev[1] = pCurr[1]; pPrev[2] = pCurr[2];
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    mode:      'LINES',
  };
}

export function buildForestLinesItem(plane, hilbert, gl, meshes, ctx) {
  const cacheKey = `forest-l-${plane.id}`;
  if (!meshes[cacheKey]) {
    const slicesByAxis = ctx && ctx.slicesByAxis ? ctx.slicesByAxis : null;
    const data = generateLineMesh(plane, hilbert, slicesByAxis);
    if (data.positions.length === 0) return null;
    meshes[cacheKey] = createMeshGL(gl, data);
  }
  const transform = mat4();
  identity(transform);
  return {
    mesh: cacheKey,
    material: 'lines',
    transform,
    blend: 'additive',
    uniforms: {
      uBaseCol:     axisColorLinear(plane.axis),
      uLineOpacity: 0.28,
    },
  };
}
