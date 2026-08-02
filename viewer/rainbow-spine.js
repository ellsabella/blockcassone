// Banded, recolourable Hilbert spine — shared by the token-renderer hero and the
// Big Cube viewer. Segments of the Hilbert path are grouped into hue bands (one draw
// per band); a scheme then tints each band. The chosen aesthetic is 'rgb' (repeating
// red/green/blue along the path). Keeping the geometry banded means recolouring is just
// swapping tint uniforms — instant, no rebuild.

import { buildCoreLineMesh, buildGlowLineMesh, worldPerp } from './materials/line-mesh.js';
import { mat4, identity } from '../renderer/src/math.js';

export function hslRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

export function buildRainbowSpine(hilbert, startMotif, motifCount, gl, meshes, bands = 3, keyPrefix = 'rainbow-spine') {
  const firstV = Math.max(0, startMotif * 8);
  const lastV = Math.min(hilbert.rawVertices.length, (startMotif + motifCount) * 8);
  const n = lastV - firstV;
  if (n < 2) return [];
  const NBHD = 64; // motifs per neighbourhood — colour bands by NEIGHBOURHOOD so the R/G/B
                   // boundaries land exactly on the octree's neighbourhood boundaries.
  const bandSegs = Array.from({ length: bands }, () => []);
  for (let i = 0; i < n - 1; i++) {
    const vi = firstV + i;
    const band = Math.floor(vi / 8 / NBHD) % bands; // one colour per neighbourhood, cycling
    const a = hilbert.rawVertices[vi], b = hilbert.rawVertices[vi + 1];
    bandSegs[band].push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const items = [];
  for (let h = 0; h < bands; h++) {
    if (!bandSegs[h].length) continue;
    const flat = new Float32Array(bandSegs[h]);
    const lk = `${keyPrefix}-line-${startMotif}-${motifCount}-${h}`;
    const gk = `${keyPrefix}-glow-${startMotif}-${motifCount}-${h}`;
    if (meshes[lk] === undefined) { meshes[lk] = buildCoreLineMesh(gl, flat, worldPerp, 0.0045); meshes[gk] = buildGlowLineMesh(gl, flat, worldPerp, 0.033); }
    const [r, g, b] = hslRgb(h / bands, 0.95, 0.58);
    const lum = new Float32Array([r * 1.7, g * 1.7, b * 1.7]); // HDR gain for additive glow
    const transform = mat4(); identity(transform);
    if (meshes[gk]) items.push({ mesh: gk, material: 'normie-glow', transform, blend: 'additive', uniforms: { uTint: lum, uAlpha: 0.6 }, _band: h, _bands: bands });
    if (meshes[lk]) items.push({ mesh: lk, material: 'lines', transform, blend: 'additive', uniforms: { uBaseCol: lum, uLineOpacity: 0.95 }, _band: h, _bands: bands });
  }
  return items;
}

// Tint per band per scheme: 'rgb' (repeating R,G,B — the chosen look), 'rainbow', 'green', 'pinkgreen'.
export function spineSchemeColor(scheme, band, bands) {
  const G = 1.7; // HDR gain (matches build)
  let c;
  if (scheme === 'green') c = [0.30, 1.00, 0.42];
  else if (scheme === 'rgb') c = [[1.0, 0.16, 0.16], [0.18, 1.0, 0.22], [0.24, 0.42, 1.0]][band % 3];
  else if (scheme === 'pinkgreen') c = (band % 2) ? [1.0, 0.22, 0.70] : [0.30, 1.0, 0.42];
  else c = hslRgb(band / bands, 0.95, 0.58); // rainbow
  return new Float32Array([c[0] * G, c[1] * G, c[2] * G]);
}

export function recolorSpineItems(spineItems, scheme) {
  for (const it of spineItems) {
    if (!it || !it.uniforms) continue;
    const col = spineSchemeColor(scheme, it._band || 0, it._bands || 30);
    if (it.material === 'normie-glow') it.uniforms.uTint = col;
    else if (it.material === 'lines') it.uniforms.uBaseCol = col;
  }
}
