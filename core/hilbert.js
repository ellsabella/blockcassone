export function generateHilbert3D(order) {
  const N = Math.pow(2, order);
  const rawPoints = [];

  function hilbertC(s, x, y, z, dx, dy, dz, dx2, dy2, dz2, dx3, dy3, dz3) {
    if (s === 1) {
      rawPoints.push({ x, y, z });
    } else {
      s /= 2;
      if (dx  < 0) x -= s * dx;
      if (dy  < 0) y -= s * dy;
      if (dz  < 0) z -= s * dz;
      if (dx2 < 0) x -= s * dx2;
      if (dy2 < 0) y -= s * dy2;
      if (dz2 < 0) z -= s * dz2;
      if (dx3 < 0) x -= s * dx3;
      if (dy3 < 0) y -= s * dy3;
      if (dz3 < 0) z -= s * dz3;
      hilbertC(s, x, y, z,                               dx2,dy2,dz2, dx3,dy3,dz3, dx,dy,dz);
      hilbertC(s, x+s*dx, y+s*dy, z+s*dz,               dx3,dy3,dz3, dx,dy,dz,   dx2,dy2,dz2);
      hilbertC(s, x+s*dx+s*dx2, y+s*dy+s*dy2, z+s*dz+s*dz2, dx3,dy3,dz3, dx,dy,dz, dx2,dy2,dz2);
      hilbertC(s, x+s*dx2, y+s*dy2, z+s*dz2,            -dx,-dy,-dz, -dx2,-dy2,-dz2, dx3,dy3,dz3);
      hilbertC(s, x+s*dx2+s*dx3, y+s*dy2+s*dy3, z+s*dz2+s*dz3, -dx,-dy,-dz, -dx2,-dy2,-dz2, dx3,dy3,dz3);
      hilbertC(s, x+s*dx+s*dx2+s*dx3, y+s*dy+s*dy2+s*dy3, z+s*dz+s*dz2+s*dz3, -dx3,-dy3,-dz3, dx,dy,dz, -dx2,-dy2,-dz2);
      hilbertC(s, x+s*dx+s*dx3, y+s*dy+s*dy3, z+s*dz+s*dz3,   -dx3,-dy3,-dz3, dx,dy,dz, -dx2,-dy2,-dz2);
      hilbertC(s, x+s*dx3, y+s*dy3, z+s*dz3,             dx2,dy2,dz2, -dx3,-dy3,-dz3, -dx,-dy,-dz);
    }
  }

  hilbertC(N, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);

  const planes = buildPlanes(rawPoints);

  const max = N - 1;
  const vertices = rawPoints.map(p => ({
    x: (p.x / max) * 2 - 1,
    y: (p.y / max) * 2 - 1,
    z: (p.z / max) * 2 - 1,
  }));

  for (const pl of planes) {
    pl.center = {
      x: (pl.center.x / max) * 2 - 1,
      y: (pl.center.y / max) * 2 - 1,
      z: (pl.center.z / max) * 2 - 1,
    };
  }

  const boundaryPlanes = buildBoundaryPlanes(rawPoints);
  for (const bp of boundaryPlanes) {
    bp.center = {
      x: (bp.center.x / max) * 2 - 1,
      y: (bp.center.y / max) * 2 - 1,
      z: (bp.center.z / max) * 2 - 1,
    };
  }

  return { order, N, vertices, rawVertices: rawPoints, planes, boundaryPlanes };
}

function detectPlaneAxis(v0, v1, v2, v3) {
  if (v0.x === v1.x && v1.x === v2.x && v2.x === v3.x) return 'x';
  if (v0.y === v1.y && v1.y === v2.y && v2.y === v3.y) return 'y';
  if (v0.z === v1.z && v1.z === v2.z && v2.z === v3.z) return 'z';
  return 'none';
}

function buildPlanes(rawPoints) {
  const planes = [];
  const numMotifs = rawPoints.length / 8;
  const offsets = [[0,1,2,3],[2,3,4,5],[4,5,6,7]];

  for (let m = 0; m < numMotifs; m++) {
    const base = m * 8;
    for (let p = 0; p < 3; p++) {
      const idx = offsets[p].map(o => base + o);
      const [v0, v1, v2, v3] = idx.map(i => rawPoints[i]);
      planes.push({
        index: planes.length,
        indices: idx,
        axis: detectPlaneAxis(v0, v1, v2, v3),
        center: {
          x: (v0.x + v1.x + v2.x + v3.x) / 4,
          y: (v0.y + v1.y + v2.y + v3.y) / 4,
          z: (v0.z + v1.z + v2.z + v3.z) / 4,
        },
      });
    }
  }
  return planes;
}

function buildBoundaryPlanes(rawPoints) {
  const planes = [];
  const numMotifs = rawPoints.length / 8;

  for (let m = 1; m < numMotifs; m++) {
    const b = m * 8;
    const idx = [b - 2, b - 1, b, b + 1];
    const [v0, v1, v2, v3] = idx.map(i => rawPoints[i]);
    const axis = detectPlaneAxis(v0, v1, v2, v3);
    if (axis === 'none') continue;
    planes.push({
      index: planes.length,
      indices: idx,
      axis,
      center: {
        x: (v0.x + v1.x + v2.x + v3.x) / 4,
        y: (v0.y + v1.y + v2.y + v3.y) / 4,
        z: (v0.z + v1.z + v2.z + v3.z) / 4,
      },
      bridgesMotifs: [m - 1, m],
    });
  }
  return planes;
}
