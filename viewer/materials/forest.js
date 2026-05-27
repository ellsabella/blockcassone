import { buildForestParticlesItem } from './forest-particles.js';
import { buildForestLinesItem }     from './forest-lines.js';

function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors[axis])
    ? CONFIG.axisColors[axis].hex
    : '#ffffff';
  const r = parseInt(hex.substr(1, 2), 16) / 255;
  const g = parseInt(hex.substr(3, 2), 16) / 255;
  const b = parseInt(hex.substr(5, 2), 16) / 255;
  return new Float32Array([r, g, b]);
}

// Pipeline scene items for a forest plane:
//   - Etching: 2D fractal cracks on the glass plane (illuminated)
//   - Layer 3: thin additive line-bundle backbone (fine strands)
//   - Layer 1: particle cloud
//   - Layer 2: canopy halos (same mesh, depth > 1 marker)
export function buildForestPlane(plane, hilbert, gl, meshes, mode, ctx) {

  const items = [];

  const lines     = buildForestLinesItem(plane, hilbert, gl, meshes, ctx);
  const particles = buildForestParticlesItem(plane, hilbert, gl, meshes, ctx);
  if (lines)     items.push(lines);
  if (particles) items.push(...particles);

  // const etchSegs = generateForestEtching(plane);
  // items.push(...buildIlluminatedEtching(
  //   gl, meshes, `forest-etch-${plane.id}`, etchSegs, axisColorLinear(plane.axis),
  // ));

  return items;
}
