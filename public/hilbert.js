/**
 * 3D Hilbert Curve Generator
 *
 * Generates vertices and plane data for a 3D Hilbert curve of order k (N = 2^k).
 *
 * Returns an object:
 *   {
 *     order:    k,
 *     N:        2^k,
 *     vertices: [ {x, y, z}, ... ]          — normalized to [-1, 1]
 *     planes:   [ {indices, axis, center}, ... ]
 *   }
 *
 * Plane grouping rule (per the document):
 *   Every 8 consecutive vertices form a motif producing 3 planes:
 *     Plane 0: vertices [b, b+1, b+2, b+3]
 *     Plane 1: vertices [b+2, b+3, b+4, b+5]
 *     Plane 2: vertices [b+4, b+5, b+6, b+7]
 *   where b = 0, 8, 16, ...
 *
 * Axis alignment is determined from raw integer coordinates:
 *   If all 4 vertices share the same x → "x" plane
 *   If all 4 vertices share the same y → "y" plane
 *   If all 4 vertices share the same z → "z" plane
 */
function generateHilbert3D(order) {
  var N = Math.pow(2, order);
  var rawPoints = [];

  function hilbertC(s, x, y, z, dx, dy, dz, dx2, dy2, dz2, dx3, dy3, dz3) {
    if (s === 1) {
      rawPoints.push({ x: x, y: y, z: z });
    } else {
      s /= 2;
      if (dx < 0) x -= s * dx;
      if (dy < 0) y -= s * dy;
      if (dz < 0) z -= s * dz;
      if (dx2 < 0) x -= s * dx2;
      if (dy2 < 0) y -= s * dy2;
      if (dz2 < 0) z -= s * dz2;
      if (dx3 < 0) x -= s * dx3;
      if (dy3 < 0) y -= s * dy3;
      if (dz3 < 0) z -= s * dz3;
      hilbertC(s, x, y, z, dx2, dy2, dz2, dx3, dy3, dz3, dx, dy, dz);
      hilbertC(s, x+s*dx, y+s*dy, z+s*dz, dx3, dy3, dz3, dx, dy, dz, dx2, dy2, dz2);
      hilbertC(s, x+s*dx+s*dx2, y+s*dy+s*dy2, z+s*dz+s*dz2, dx3, dy3, dz3, dx, dy, dz, dx2, dy2, dz2);
      hilbertC(s, x+s*dx2, y+s*dy2, z+s*dz2, -dx, -dy, -dz, -dx2, -dy2, -dz2, dx3, dy3, dz3);
      hilbertC(s, x+s*dx2+s*dx3, y+s*dy2+s*dy3, z+s*dz2+s*dz3, -dx, -dy, -dz, -dx2, -dy2, -dz2, dx3, dy3, dz3);
      hilbertC(s, x+s*dx+s*dx2+s*dx3, y+s*dy+s*dy2+s*dy3, z+s*dz+s*dz2+s*dz3, -dx3, -dy3, -dz3, dx, dy, dz, -dx2, -dy2, -dz2);
      hilbertC(s, x+s*dx+s*dx3, y+s*dy+s*dy3, z+s*dz+s*dz3, -dx3, -dy3, -dz3, dx, dy, dz, -dx2, -dy2, -dz2);
      hilbertC(s, x+s*dx3, y+s*dy3, z+s*dz3, dx2, dy2, dz2, -dx3, -dy3, -dz3, -dx, -dy, -dz);
    }
  }

  hilbertC(N, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);

  // Build planes from raw integer coordinates (exact comparison)
  var planes = buildPlanes(rawPoints);

  // Normalize vertices from [0, N-1] to [-1, 1]
  var max = N - 1;
  var vertices = [];
  for (var i = 0; i < rawPoints.length; i++) {
    vertices.push({
      x: (rawPoints[i].x / max) * 2 - 1,
      y: (rawPoints[i].y / max) * 2 - 1,
      z: (rawPoints[i].z / max) * 2 - 1
    });
  }

  // Normalize plane centers too
  for (var j = 0; j < planes.length; j++) {
    planes[j].center = {
      x: (planes[j].center.x / max) * 2 - 1,
      y: (planes[j].center.y / max) * 2 - 1,
      z: (planes[j].center.z / max) * 2 - 1
    };
  }

  // Build boundary planes from raw coordinates (before normalization)
  var boundaryPlanes = buildBoundaryPlanes(rawPoints);

  // Normalize boundary plane centers
  for (var k = 0; k < boundaryPlanes.length; k++) {
    boundaryPlanes[k].center = {
      x: (boundaryPlanes[k].center.x / max) * 2 - 1,
      y: (boundaryPlanes[k].center.y / max) * 2 - 1,
      z: (boundaryPlanes[k].center.z / max) * 2 - 1
    };
  }

  return {
    order: order,
    N: N,
    vertices: vertices,
    rawVertices: rawPoints,
    planes: planes,
    boundaryPlanes: boundaryPlanes
  };
}

/**
 * Builds plane definitions from raw integer vertex positions.
 *
 * Every 8 vertices produce 3 overlapping quads:
 *   (b,b+1,b+2,b+3), (b+2,b+3,b+4,b+5), (b+4,b+5,b+6,b+7)
 *
 * Each plane's axis is determined by which coordinate is constant
 * across all 4 vertices.
 */
function buildPlanes(rawPoints) {
  var planes = [];
  var totalVertices = rawPoints.length;
  var numMotifs = totalVertices / 8;

  for (var m = 0; m < numMotifs; m++) {
    var base = m * 8;
    var offsets = [
      [0, 1, 2, 3],
      [2, 3, 4, 5],
      [4, 5, 6, 7]
    ];

    for (var p = 0; p < 3; p++) {
      var idx = [
        base + offsets[p][0],
        base + offsets[p][1],
        base + offsets[p][2],
        base + offsets[p][3]
      ];

      var v0 = rawPoints[idx[0]];
      var v1 = rawPoints[idx[1]];
      var v2 = rawPoints[idx[2]];
      var v3 = rawPoints[idx[3]];

      var axis = detectPlaneAxis(v0, v1, v2, v3);

      // Center is average of the 4 vertices
      var center = {
        x: (v0.x + v1.x + v2.x + v3.x) / 4,
        y: (v0.y + v1.y + v2.y + v3.y) / 4,
        z: (v0.z + v1.z + v2.z + v3.z) / 4
      };

      planes.push({
        index: planes.length,
        indices: idx,
        axis: axis,
        center: center
      });
    }
  }

  return planes;
}

/**
 * Determines which axis a quad is aligned to.
 * Returns "x", "y", "z", or "none" if not axis-aligned.
 */
function detectPlaneAxis(v0, v1, v2, v3) {
  if (v0.x === v1.x && v1.x === v2.x && v2.x === v3.x) return "x";
  if (v0.y === v1.y && v1.y === v2.y && v2.y === v3.y) return "y";
  if (v0.z === v1.z && v1.z === v2.z && v2.z === v3.z) return "z";
  return "none";
}

/**
 * Builds boundary planes — quads that span adjacent 8-vertex motifs.
 *
 * At each motif boundary (global index b, multiple of 8),
 * the quad (b-2, b-1, b, b+1) is 4 consecutive vertices
 * crossing two motifs. If axis-aligned, it's a valid extra plane.
 *
 * Each boundary plane records which two motifs it bridges.
 */
function buildBoundaryPlanes(rawPoints) {
  var planes = [];
  var numMotifs = rawPoints.length / 8;

  for (var m = 1; m < numMotifs; m++) {
    var b = m * 8; // first vertex of motif m
    var idx = [b - 2, b - 1, b, b + 1];

    var v0 = rawPoints[idx[0]];
    var v1 = rawPoints[idx[1]];
    var v2 = rawPoints[idx[2]];
    var v3 = rawPoints[idx[3]];

    var axis = detectPlaneAxis(v0, v1, v2, v3);
    if (axis === "none") continue;

    var center = {
      x: (v0.x + v1.x + v2.x + v3.x) / 4,
      y: (v0.y + v1.y + v2.y + v3.y) / 4,
      z: (v0.z + v1.z + v2.z + v3.z) / 4
    };

    planes.push({
      index: planes.length,
      indices: idx,
      axis: axis,
      center: center,
      bridgesMotifs: [m - 1, m]
    });
  }

  return planes;
}
