// "Where in the block" minimap. The world is an order-4 3D Hilbert curve (16^3 = 4096 slots,
// 8 plots/street => 512 streets). We compute a street's TRUE 3D cell (centroid of its 8 plot
// vertices) and draw the block as a corner-on isometric cube with a small solid cube marker at
// that location — so the pin sits where the street actually is, not a random dot.

let _pts = null;
function hilbertPoints() {
  if (_pts) return _pts;
  const raw = [];
  (function h(s, x, y, z, dx, dy, dz, dx2, dy2, dz2, dx3, dy3, dz3) {
    if (s === 1) { raw.push([x, y, z]); return; }
    s /= 2;
    if (dx < 0) x -= s * dx; if (dy < 0) y -= s * dy; if (dz < 0) z -= s * dz;
    if (dx2 < 0) x -= s * dx2; if (dy2 < 0) y -= s * dy2; if (dz2 < 0) z -= s * dz2;
    if (dx3 < 0) x -= s * dx3; if (dy3 < 0) y -= s * dy3; if (dz3 < 0) z -= s * dz3;
    h(s, x, y, z, dx2, dy2, dz2, dx3, dy3, dz3, dx, dy, dz);
    h(s, x + s * dx, y + s * dy, z + s * dz, dx3, dy3, dz3, dx, dy, dz, dx2, dy2, dz2);
    h(s, x + s * dx + s * dx2, y + s * dy + s * dy2, z + s * dz + s * dz2, dx3, dy3, dz3, dx, dy, dz, dx2, dy2, dz2);
    h(s, x + s * dx2, y + s * dy2, z + s * dz2, -dx, -dy, -dz, -dx2, -dy2, -dz2, dx3, dy3, dz3);
    h(s, x + s * dx2 + s * dx3, y + s * dy2 + s * dy3, z + s * dz2 + s * dz3, -dx, -dy, -dz, -dx2, -dy2, -dz2, dx3, dy3, dz3);
    h(s, x + s * dx + s * dx2 + s * dx3, y + s * dy + s * dy2 + s * dy3, z + s * dz + s * dz2 + s * dz3, -dx3, -dy3, -dz3, dx, dy, dz, -dx2, -dy2, -dz2);
    h(s, x + s * dx + s * dx3, y + s * dy + s * dy3, z + s * dz + s * dz3, -dx3, -dy3, -dz3, dx, dy, dz, -dx2, -dy2, -dz2);
    h(s, x + s * dx3, y + s * dy3, z + s * dz3, dx2, dy2, dz2, -dx3, -dy3, -dz3, -dx, -dy, -dz);
  })(16, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
  _pts = raw;
  return raw;
}

// Street's normalized [0,1] cell centre (average of its 8 plot vertices).
export function streetCell(sid) {
  const p = hilbertPoints(), b = sid * 8;
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 8; k++) { const v = p[b + k] || [0, 0, 0]; x += v[0]; y += v[1]; z += v[2]; }
  return { x: (x / 8) / 15, y: (y / 8) / 15, z: (z / 8) / 15 };
}

// Corner-on isometric projection: the main diagonal points at the viewer, so (x,y,z) in [0,1]
// gives the classic 3-visible-face cube. cx/cy centre it; U is the edge scale.
const U = 44, CX = 100, CY = 75;
// √3/2 on the horizontal axis makes the corner-on silhouette a REGULAR hexagon (a true cube),
// not the squashed one you get without it.
const P = (x, y, z) => [CX + (x - z) * U * 0.866, CY + (x + z) * (U * 0.5) - y * U];
const pt = ([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`;

// The 3 viewer-facing faces of a box [x0,y0,z0]-[x1,y1,z1] (near corner = x1,y1,z1).
function faces(x0, y0, z0, x1, y1, z1) {
  return {
    top:   [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
    right: [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
    left:  [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
  };
}
const poly = (f, fill, stroke, sw) =>
  `<polygon points="${f.map(pt).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;

export function locatorSVG(sid) {
  const c = streetCell(sid);
  // Block cube: faint filled faces + edges, so the marker inside stays visible.
  const B = faces(0, 0, 0, 1, 1, 1);
  const block =
    poly(B.left,  '#101018', '#2f2f3e', 1) +
    poly(B.right, '#0c0c14', '#2f2f3e', 1) +
    poly(B.top,   '#16161f', '#3a3a4c', 1);
  // Marker: a small solid cube centred on the street cell, top brightest → reads 3D.
  const e = 0.15, h = e / 2;
  const cl = (v) => Math.max(h, Math.min(1 - h, v));
  const mx = cl(c.x), my = cl(c.y), mz = cl(c.z);
  const M = faces(mx - h, my - h, mz - h, mx + h, my + h, mz + h);
  const glow = P(mx, my, mz);
  const marker =
    `<circle cx="${glow[0].toFixed(1)}" cy="${glow[1].toFixed(1)}" r="10" fill="#ff5db0" opacity=".22"/>` +
    poly(M.left,  '#c11f7a', '#ff8fce', 1) +
    poly(M.right, '#9c1763', '#ff8fce', 1) +
    poly(M.top,   '#ff7dcc', '#ffd0ec', 1);
  return `<svg viewBox="0 0 200 150" width="100%" height="100%">${block}${marker}</svg>`;
}
