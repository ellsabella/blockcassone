// Normie ID label — "#NNNN" pixel-font glyphs in the bottom-right of each plane.

import { mat4, identity } from '../../renderer/src/math.js';
import { uvToWorld, planeBasis } from '../materials/plane-2d.js';
import { buildCoreLineMesh, buildGlowLineMesh, planePerpFn } from '../materials/line-mesh.js';
import { normieIdForCube } from './status.js';
import { axisColorLinear, luminescentTint } from './outlines.js';

const CORE_WIDTH         = 0.0003;
const GLOW_WIDTH         = 0.014;
const LINE_OPACITY       = 0.90;
const GLOW_OPACITY       = 0.55;
const NEON_WHITE_WIDTH   = 0.004;
const NEON_WHITE_OPACITY = 0.5;
const NEON_WHITE_TINT    = new Float32Array([1.4, 1.4, 1.4]);

const FONT_3x5 = {
  '#': [[0,1,0],[1,1,1],[0,1,0],[1,1,1],[0,1,0]],
  '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
  '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  '2': [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
  '3': [[1,1,1],[0,0,1],[0,1,1],[0,0,1],[1,1,1]],
  '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  '5': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
  '6': [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
  '7': [[1,1,1],[0,0,1],[0,1,0],[0,1,0],[0,1,0]],
  '8': [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
  '9': [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
  'A': [[0,1,0],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
  'B': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,1,0]],
  'C': [[0,1,1],[1,0,0],[1,0,0],[1,0,0],[0,1,1]],
  'D': [[1,1,0],[1,0,1],[1,0,1],[1,0,1],[1,1,0]],
  'E': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,1,1]],
  'F': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,0,0]],
};

export function getNormieIdLabelCells(motifIdx) {
  const id = normieIdForCube(motifIdx);
  if (id === null || id === undefined) return new Set();
  const text = '#' + String(id).padStart(4, '0');
  const charW = 3, charH = 5, spacing = 1;
  const totalW   = text.length * charW + (text.length - 1) * spacing;
  const startCol = 40 - 1 - totalW;
  const startRow = 40 - 1 - charH;
  const cells = new Set();
  for (let row = startRow; row < startRow + charH; row++)
    for (let col = startCol; col < startCol + totalW; col++)
      cells.add(row * 40 + col);
  return cells;
}

export function buildNormieIdLabel(plane, gl, meshes) {
  return buildIdLabelFor(plane, gl, meshes, normieIdForCube(plane.hierarchy?.motifIndex), 'normie-id');
}

// Reusable "#NNNN" label for an explicit id (Normie or non-Normie source token),
// so non-Normie cubes can carry a source-id label too. Takes an explicit id +
// mesh-key prefix — NO status.js dependency, so it's safe in the network-free bundle.
export function buildIdLabelFor(plane, gl, meshes, id, prefix) {
  if (id === null || id === undefined) return [];

  const text    = '#' + String(id).padStart(4, '0');
  const lineKey = `${prefix}-line-${plane.id}`;
  const glowKey = `${prefix}-glow-${plane.id}`;
  const whiteKey = `${prefix}-white-${plane.id}`;

  if (meshes[lineKey] === undefined) {
    const charW = 3, charH = 5, spacing = 1;
    const totalW   = text.length * charW + (text.length - 1) * spacing;
    const startCol = 40 - 1 - totalW;
    const startRow = 40 - 1 - charH;

    const filledMap   = new Uint8Array(40 * 40);
    const filledCells = [];
    for (let ci = 0; ci < text.length; ci++) {
      const glyph = FONT_3x5[text[ci]];
      if (!glyph) continue;
      const colOffset = startCol + ci * (charW + spacing);
      for (let gy = 0; gy < charH; gy++) {
        for (let gx = 0; gx < charW; gx++) {
          if (!glyph[gy][gx]) continue;
          const col = colOffset + gx, row = startRow + gy;
          filledMap[col * 40 + row] = 1;
          filledCells.push([col, row]);
        }
      }
    }
    const isFilled = (col, row) =>
      col >= 0 && col < 40 && row >= 0 && row < 40 && filledMap[col * 40 + row] === 1;

    const segs = [];
    for (const [col, row] of filledCells) {
      const u0 = col / 40, u1 = (col + 1) / 40;
      const v0 = row / 40, v1 = (row + 1) / 40;
      if (!isFilled(col - 1, row)) segs.push({ ua: u0, va: v0, ub: u0, vb: v1 });
      if (!isFilled(col + 1, row)) segs.push({ ua: u1, va: v0, ub: u1, vb: v1 });
      if (!isFilled(col, row - 1)) segs.push({ ua: u0, va: v0, ub: u1, vb: v0 });
      if (!isFilled(col, row + 1)) segs.push({ ua: u0, va: v1, ub: u1, vb: v1 });
    }

    const p    = plane.vertices.positions;
    const flat = new Float32Array(segs.length * 6);
    let i = 0;
    for (const { ua, va, ub, vb } of segs) {
      const a = uvToWorld(ua, va, p), b = uvToWorld(ub, vb, p);
      flat[i++] = a[0]; flat[i++] = a[1]; flat[i++] = a[2];
      flat[i++] = b[0]; flat[i++] = b[1]; flat[i++] = b[2];
    }
    const pp = planePerpFn(planeBasis(plane).N);
    meshes[lineKey]  = buildCoreLineMesh(gl, flat, pp, CORE_WIDTH);
    meshes[glowKey]  = buildGlowLineMesh(gl, flat, pp, GLOW_WIDTH);
    meshes[whiteKey] = buildGlowLineMesh(gl, flat, pp, NEON_WHITE_WIDTH);
  }

  const lumColor  = luminescentTint(axisColorLinear(plane.axis));
  const transform = mat4(); identity(transform);
  const items     = [];
  if (meshes[glowKey])  items.push({ mesh: glowKey,  material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: lumColor,       uAlpha: GLOW_OPACITY       } });
  if (meshes[whiteKey]) items.push({ mesh: whiteKey, material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: NEON_WHITE_TINT, uAlpha: NEON_WHITE_OPACITY } });
  if (meshes[lineKey])  items.push({ mesh: lineKey,  material: 'lines',       transform, blend: 'additive', uniforms: { uBaseCol: lumColor,     uLineOpacity: LINE_OPACITY } });
  return items;
}
