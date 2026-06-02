import { createMeshGL } from '/renderer/src/geometry.js';

// Robust world-space perpendicular for any segment direction.
export function worldPerp(ddx, ddy, ddz) {
  let px = -ddz, py = 0, pz = ddx;
  let pl = Math.sqrt(px*px + pz*pz);
  if (pl < 0.1) { px = ddy; py = -ddx; pz = 0; pl = Math.sqrt(px*px + py*py) || 1; }
  return [px/pl, py/pl, pz/pl];
}

// Returns a perpFn for plane-aligned quads: cross(segDir, planeNormal).
export function planePerpFn(normal) {
  const [nx, ny, nz] = normal;
  return function(ddx, ddy, ddz) {
    let px = ddy*nz - ddz*ny, py = ddz*nx - ddx*nz, pz = ddx*ny - ddy*nx;
    const pl = Math.sqrt(px*px + py*py + pz*pz);
    return pl < 1e-10 ? null : [px/pl, py/pl, pz/pl];
  };
}

// Core (no UVs, alpha=1): thin bright line quads.
// flatSegs: Float32Array [x0,y0,z0, x1,y1,z1, ...], 6 floats per segment.
// perpFn(ddx,ddy,ddz) => [px,py,pz] | null
export function buildCoreLineMesh(gl, flatSegs, perpFn, width) {
  if (!flatSegs || flatSegs.length === 0) return null;
  const hw = width * 0.5;
  const positions = [], alphas = [], indices = [];
  let vi = 0;
  for (let i = 0; i < flatSegs.length; i += 6) {
    const p0x = flatSegs[i],   p0y = flatSegs[i+1], p0z = flatSegs[i+2];
    const p1x = flatSegs[i+3], p1y = flatSegs[i+4], p1z = flatSegs[i+5];
    const dx = p1x-p0x, dy = p1y-p0y, dz = p1z-p0z;
    const dl = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dl < 1e-10) continue;
    const ddx = dx/dl, ddy = dy/dl, ddz = dz/dl;
    const perp = perpFn(ddx, ddy, ddz);
    if (!perp) continue;
    const [px, py, pz] = perp;
    positions.push(
      p0x-px*hw, p0y-py*hw, p0z-pz*hw,
      p0x+px*hw, p0y+py*hw, p0z+pz*hw,
      p1x-px*hw, p1y-py*hw, p1z-pz*hw,
      p1x+px*hw, p1y+py*hw, p1z+pz*hw,
    );
    alphas.push(1, 1, 1, 1);
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }
  if (positions.length === 0) return null;
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(alphas),
    indices,
  });
}

// Glow (with UVs + L_hw in alpha): capsule-SDF rounded glow quads.
// squareCaps=true: no cap extension (UV range 0..L_hw instead of -1..L_hw+1).
export function buildGlowLineMesh(gl, flatSegs, perpFn, width, squareCaps = false) {
  if (!flatSegs || flatSegs.length === 0) return null;
  const hw = width * 0.5;
  const positions = [], uvs = [], lhws = [], indices = [];
  let vi = 0;
  for (let i = 0; i < flatSegs.length; i += 6) {
    const p0x = flatSegs[i],   p0y = flatSegs[i+1], p0z = flatSegs[i+2];
    const p1x = flatSegs[i+3], p1y = flatSegs[i+4], p1z = flatSegs[i+5];
    const dx = p1x-p0x, dy = p1y-p0y, dz = p1z-p0z;
    const dl = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dl < 1e-10) continue;
    const ddx = dx/dl, ddy = dy/dl, ddz = dz/dl;
    const perp = perpFn(ddx, ddy, ddz);
    if (!perp) continue;
    const [px, py, pz] = perp;
    const L_hw = dl / hw;
    if (squareCaps) {
      positions.push(
        p0x-px*hw, p0y-py*hw, p0z-pz*hw,
        p0x+px*hw, p0y+py*hw, p0z+pz*hw,
        p1x-px*hw, p1y-py*hw, p1z-pz*hw,
        p1x+px*hw, p1y+py*hw, p1z+pz*hw,
      );
      uvs.push(0, -1,  0, +1,  L_hw, -1,  L_hw, +1);
    } else {
      positions.push(
        p0x-ddx*hw-px*hw, p0y-ddy*hw-py*hw, p0z-ddz*hw-pz*hw,
        p0x-ddx*hw+px*hw, p0y-ddy*hw+py*hw, p0z-ddz*hw+pz*hw,
        p1x+ddx*hw-px*hw, p1y+ddy*hw-py*hw, p1z+ddz*hw-pz*hw,
        p1x+ddx*hw+px*hw, p1y+ddy*hw+py*hw, p1z+ddz*hw+pz*hw,
      );
      uvs.push(-1, -1,  -1, +1,  L_hw+1, -1,  L_hw+1, +1);
    }
    lhws.push(L_hw, L_hw, L_hw, L_hw);
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }
  if (positions.length === 0) return null;
  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas:    new Float32Array(lhws),
    uvs:       new Float32Array(uvs),
    indices,
  });
}
