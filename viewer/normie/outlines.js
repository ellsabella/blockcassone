// Normie outline meshes — 2D silhouette and plane-edge outlines.

import { mat4, identity } from '../../renderer/src/math.js';
import { uvToWorld, planeBasis, artCorners } from '../materials/plane-2d.js';
import { buildCoreLineMesh, buildGlowLineMesh, planePerpFn } from '../materials/line-mesh.js';
import { normieIdForCube } from './status.js';
import { ensureFetched, getPlanePixelArray, getAllPlanes } from './api.js';
import { getNormieIdLabelCells } from './label.js';

const CORE_WIDTH         = 0.0003;
const GLOW_WIDTH         = 0.014;
const LINE_OPACITY       = 0.90;
const GLOW_OPACITY       = 0.55;
const NEON_WHITE_WIDTH   = 0.004;
const NEON_WHITE_OPACITY = 0.5;
const NEON_WHITE_TINT    = new Float32Array([1.4, 1.4, 1.4]);
const SAT_BOOST          = 2.4;
const HDR_GAIN           = 1.6;
const PINK               = new Float32Array([1.0, 0.55, 0.75]);

const OUTLINE_CORE_WIDTH   = 0.0005;
const OUTLINE_GLOW_WIDTH   = 0.018;
const OUTLINE_LINE_OPACITY = 0.45;
const OUTLINE_GLOW_OPACITY = 0.28;

export function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors?.[axis])
    ? CONFIG.axisColors[axis].hex : '#ffffff';
  return new Float32Array([
    parseInt(hex.substr(1, 2), 16) / 255,
    parseInt(hex.substr(3, 2), 16) / 255,
    parseInt(hex.substr(5, 2), 16) / 255,
  ]);
}

export function luminescentTint(tint) {
  const lum = tint[0]*0.299 + tint[1]*0.587 + tint[2]*0.114;
  return new Float32Array([
    (lum + (tint[0]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[1]-lum)*SAT_BOOST)*HDR_GAIN,
    (lum + (tint[2]-lum)*SAT_BOOST)*HDR_GAIN,
  ]);
}

function findSilhouetteEdges(pixels, skipCells = null) {
  const at = (row, col) => {
    if (row < 0 || row > 39 || col < 0 || col > 39) return 0;
    if (skipCells && skipCells.has(row * 40 + col)) return 0;
    return pixels[row * 40 + col];
  };
  const segs = [];
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 40; col++) {
      if (!at(row, col)) continue;
      const u0 = col / 40, u1 = (col + 1) / 40;
      const v0 = row / 40, v1 = (row + 1) / 40;
      if (!at(row, col - 1)) segs.push({ ua: u0, va: v0, ub: u0, vb: v1 });
      if (!at(row, col + 1)) segs.push({ ua: u1, va: v0, ub: u1, vb: v1 });
      if (!at(row - 1, col)) segs.push({ ua: u0, va: v0, ub: u1, vb: v0 });
      if (!at(row + 1, col)) segs.push({ ua: u0, va: v1, ub: u1, vb: v1 });
    }
  }
  return segs;
}

function planeRoleFor(plane) {
  const motifIdx  = plane.hierarchy?.motifIndex;
  const allPlanes = getAllPlanes() || [];
  const cubePlanes = allPlanes.filter(p => p.hierarchy?.motifIndex === motifIdx);
  const axisCounts = {};
  for (const p of cubePlanes) axisCounts[p.axis] = (axisCounts[p.axis] || 0) + 1;
  const uniqueAxis  = Object.keys(axisCounts).find(ax => axisCounts[ax] === 1);
  const mainPlane   = uniqueAxis ? cubePlanes.find(p => p.axis === uniqueAxis) : cubePlanes[0];
  if (!mainPlane || plane.id === mainPlane.id) return 'current';
  const sidePlanes  = cubePlanes.filter(p => p.id !== mainPlane.id).sort((a, b) => (a.id||0) - (b.id||0));
  return sidePlanes.findIndex(p => p.id === plane.id) === 0 ? 'original' : 'canvas';
}

export function build2DOutline(plane, gl, meshes) {
  const id = normieIdForCube(plane.hierarchy?.motifIndex);
  if (id === null || id === undefined) return [];
  ensureFetched(id);

  const pixels = getPlanePixelArray(plane);
  if (!pixels) return [];

  const p    = artCorners(plane);
  const tint = axisColorLinear(plane.axis);
  const role = planeRoleFor(plane);
  const lineKey      = `normie-outline-line-${plane.id}-${role}`;
  const glowKey      = `normie-outline-glow-${plane.id}-${role}`;
  const whiteGlowKey = `normie-outline-white-${plane.id}-${role}`;

  if (meshes[lineKey] === undefined) {
    const segs = findSilhouetteEdges(pixels, getNormieIdLabelCells(plane.hierarchy?.motifIndex));
    const flat = new Float32Array(segs.length * 6);
    let i = 0;
    for (const { ua, va, ub, vb } of segs) {
      const a = uvToWorld(ua, va, p), b = uvToWorld(ub, vb, p);
      flat[i++] = a[0]; flat[i++] = a[1]; flat[i++] = a[2];
      flat[i++] = b[0]; flat[i++] = b[1]; flat[i++] = b[2];
    }
    const pp = planePerpFn(planeBasis(plane).N);
    meshes[lineKey]      = buildCoreLineMesh(gl, flat, pp, CORE_WIDTH);
    meshes[glowKey]      = buildGlowLineMesh(gl, flat, pp, GLOW_WIDTH);
    meshes[whiteGlowKey] = buildGlowLineMesh(gl, flat, pp, NEON_WHITE_WIDTH);
  }

  const lumColor  = luminescentTint(tint);
  const transform = mat4(); identity(transform);
  const items     = [];
  if (meshes[glowKey])      items.push({ mesh: glowKey,      material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: lumColor,       uAlpha: GLOW_OPACITY       } });
  if (meshes[whiteGlowKey]) items.push({ mesh: whiteGlowKey, material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: NEON_WHITE_TINT, uAlpha: NEON_WHITE_OPACITY } });
  if (meshes[lineKey])      items.push({ mesh: lineKey,      material: 'lines',       transform, blend: 'additive', uniforms: { uBaseCol: lumColor,     uLineOpacity: LINE_OPACITY } });
  return items;
}

export function buildPlaneOutline(plane, gl, meshes) {
  const lineKey = `hilbert-plane-line-${plane.id}`;
  const glowKey = `hilbert-plane-glow-${plane.id}`;

  if (meshes[lineKey] === undefined) {
    const p  = plane.vertices.positions;
    const pp = planePerpFn(planeBasis(plane).N);
    const flat = new Float32Array(3 * 6);
    for (let i = 0; i < 3; i++) {
      const a = p[i], b = p[i + 1];
      flat[i*6+0] = a.x; flat[i*6+1] = a.y; flat[i*6+2] = a.z;
      flat[i*6+3] = b.x; flat[i*6+4] = b.y; flat[i*6+5] = b.z;
    }
    meshes[lineKey] = buildCoreLineMesh(gl, flat, pp, OUTLINE_CORE_WIDTH);
    meshes[glowKey] = buildGlowLineMesh(gl, flat, pp, OUTLINE_GLOW_WIDTH);
  }

  const lumColor  = luminescentTint(PINK);
  const transform = mat4(); identity(transform);
  const items     = [];
  if (meshes[glowKey]) items.push({ mesh: glowKey, material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: lumColor,  uAlpha: OUTLINE_GLOW_OPACITY       } });
  if (meshes[lineKey]) items.push({ mesh: lineKey, material: 'lines',       transform, blend: 'additive', uniforms: { uBaseCol: lumColor, uLineOpacity: OUTLINE_LINE_OPACITY } });
  return items;
}
