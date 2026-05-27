/**
 * Plane Drawing Module
 *
 * Draws axis-aligned planes from the Hilbert curve data.
 * Colors: X = red, Y = green, Z = blue
 */

// Derived from CONFIG for backward compatibility with existing draw functions
var PLANE_COLORS = {
  x: CONFIG.axisColors.x.rgb,
  y: CONFIG.axisColors.y.rgb,
  z: CONFIG.axisColors.z.rgb
};

var PLANE_MATERIALS = CONFIG.materials;

/**
 * Assigns a random material to every plane (regular + boundary).
 * Must be called after generateHilbert3D() and with the seeded PRNG.
 *
 * @param {object} hilbert - result from generateHilbert3D()
 * @param {object} rng     - Random instance
 */
function assignPlaneProperties(hilbert, rng) {
  var allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);
  for (var i = 0; i < allPlanes.length; i++) {
    allPlanes[i].material = rng.random_choice(PLANE_MATERIALS);

    // Per-material edge point probability (fallback to global default)
    var matConfig = CONFIG[allPlanes[i].material];
    var prob = (matConfig && matConfig.edgePointProbability !== undefined)
      ? matConfig.edgePointProbability
      : CONFIG.edgePointProbability;

    // Each plane has 3 edges, each edge gets a random 7-bit pattern
    allPlanes[i].edgePatterns = [];
    for (var e = 0; e < 3; e++) {
      var pattern = [];
      for (var bit = 0; bit < EDGE_SUBDIVISIONS - 1; bit++) {
        pattern.push(rng.random_bool(prob) ? 1 : 0);
      }
      allPlanes[i].edgePatterns.push(pattern);
    }
  }
}

var EDGE_SUBDIVISIONS = CONFIG.edgeSubdivisions;

/**
 * Computes edge sub-vertices for all planes (regular + boundary).
 *
 * Each plane has 4 consecutive Hilbert vertices [i0, i1, i2, i3].
 * The curve traces 3 edges: i0→i1, i1→i2, i2→i3.
 * The 4th edge (i3→i0) is the open side — not part of the path.
 *
 * Each curve edge is subdivided into EDGE_SUBDIVISIONS segments,
 * producing (EDGE_SUBDIVISIONS - 1) intermediate points per edge.
 *
 * Adds to each plane:
 *   .edges — array of 3 edge objects, each with:
 *     { from, to, subVertices: [{x, y, z}, ...] }
 *
 * @param {object} hilbert - result from generateHilbert3D()
 */
function buildPlaneEdges(hilbert) {
  var allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);

  for (var i = 0; i < allPlanes.length; i++) {
    var plane = allPlanes[i];
    var idx = plane.indices;

    plane.edges = [];
    // 3 curve-traced edges: idx[0]→idx[1], idx[1]→idx[2], idx[2]→idx[3]
    for (var e = 0; e < 3; e++) {
      var fromIdx = idx[e];
      var toIdx = idx[e + 1];
      var vFrom = hilbert.vertices[fromIdx];
      var vTo = hilbert.vertices[toIdx];

      var subs = [];
      for (var s = 1; s < EDGE_SUBDIVISIONS; s++) {
        var t = s / EDGE_SUBDIVISIONS;
        subs.push({
          x: vFrom.x + (vTo.x - vFrom.x) * t,
          y: vFrom.y + (vTo.y - vFrom.y) * t,
          z: vFrom.z + (vTo.z - vFrom.z) * t
        });
      }

      plane.edges.push({
        from: fromIdx,
        to: toIdx,
        subVertices: subs
      });
    }
  }
}

/**
 * Draws the edge sub-vertices of a single plane as small dots.
 *
 * @param {object} hilbert   - result from generateHilbert3D()
 * @param {object} plane     - a plane object (with .edges computed)
 * @param {number} scale     - world-space scale (half-extent)
 * @param {number} dotSize   - diameter of each dot
 * @param {Array}  col       - [r, g, b] color, defaults to white
 */
function drawPlaneEdgePoints(hilbert, plane, scale, dotSize, col) {
  var c = col || [255, 255, 255];
  stroke(c[0], c[1], c[2]);
  strokeWeight(dotSize);

  for (var e = 0; e < plane.edges.length; e++) {
    var subs = plane.edges[e].subVertices;
    var pattern = plane.edgePatterns ? plane.edgePatterns[e] : null;
    for (var s = 0; s < subs.length; s++) {
      if (!pattern || pattern[s] === 1) {
        point(subs[s].x * scale, subs[s].y * scale, subs[s].z * scale);
      }
    }
  }
}

/**
 * Draws a single plane as a filled quad.
 * Accepts either a plane index (into hilbert.planes[]) or a plane object directly.
 *
 * @param {object} hilbert       - result from generateHilbert3D()
 * @param {number|object} planeOrIdx - index into hilbert.planes[], or a plane object
 * @param {number} scale         - world-space scale (half-extent)
 * @param {number} alpha         - opacity 0-255
 */
function drawPlane(hilbert, planeOrIdx, scale, alpha) {
  var plane = (typeof planeOrIdx === "number") ? hilbert.planes[planeOrIdx] : planeOrIdx;
  var col = PLANE_COLORS[plane.axis] || [128, 128, 128];

  fill(col[0], col[1], col[2], alpha);
  noStroke();

  var v0 = hilbert.vertices[plane.indices[0]];
  var v1 = hilbert.vertices[plane.indices[1]];
  var v2 = hilbert.vertices[plane.indices[2]];
  var v3 = hilbert.vertices[plane.indices[3]];

  beginShape();
  vertex(v0.x * scale, v0.y * scale, v0.z * scale);
  vertex(v1.x * scale, v1.y * scale, v1.z * scale);
  vertex(v2.x * scale, v2.y * scale, v2.z * scale);
  vertex(v3.x * scale, v3.y * scale, v3.z * scale);
  endShape(CLOSE);
}

/**
 * Draws a plane as grid lines extending inward from active edge points.
 *
 * The plane quad is parameterized bilinearly:
 *   Q(u,v) = (1-u)(1-v)·v0 + u(1-v)·v1 + u·v·v2 + (1-u)·v·v3
 *
 * Edge 0 (v0→v1) sits at v=0 — lines extend inward (increasing v)
 * Edge 1 (v1→v2) sits at u=1 — lines extend inward (decreasing u)
 * Edge 2 (v2→v3) sits at v=1 — lines extend inward (decreasing v)
 *
 * Each line extends 0.6 of the distance to the opposite edge.
 * Only drawn where edgePattern[i] === 1.
 *
 * @param {object} hilbert       - result from generateHilbert3D()
 * @param {number|object} planeOrIdx - plane index or plane object
 * @param {number} scale         - world-space scale (half-extent)
 * @param {number} weight        - stroke weight
 * @param {number} alpha         - opacity 0-255
 * @param {number} reach         - how far lines extend (0-1), default 0.6
 */
function drawPlaneLine(hilbert, planeOrIdx, scale, weight, alpha, reach) {
  var plane = (typeof planeOrIdx === "number") ? hilbert.planes[planeOrIdx] : planeOrIdx;
  var col = PLANE_COLORS[plane.axis] || [128, 128, 128];
  var r = reach !== undefined ? reach : 0.6;

  var v0 = hilbert.vertices[plane.indices[0]];
  var v1 = hilbert.vertices[plane.indices[1]];
  var v2 = hilbert.vertices[plane.indices[2]];
  var v3 = hilbert.vertices[plane.indices[3]];

  stroke(col[0], col[1], col[2], alpha);
  strokeWeight(weight);
  noFill();

  // For each of the 3 edges, draw inward lines from active sub-vertices
  for (var e = 0; e < 3; e++) {
    var pattern = plane.edgePatterns ? plane.edgePatterns[e] : null;

    for (var s = 1; s < EDGE_SUBDIVISIONS; s++) {
      var idx = s - 1;
      if (pattern && pattern[idx] === 0) continue;

      var t = s / EDGE_SUBDIVISIONS;

      // Compute start (on edge) and opposite (across plane)
      var start, opposite;
      if (e === 0) {
        // Edge v0→v1 at v=0, inward toward v=1
        start = lerpPt(v0, v1, t);
        opposite = lerpPt(v3, v2, t);
      } else if (e === 1) {
        // Edge v1→v2 at u=1, inward toward u=0
        start = lerpPt(v1, v2, t);
        opposite = lerpPt(v0, v3, t);
      } else {
        // Edge v2→v3 at v=1, inward toward v=0
        start = lerpPt(v2, v3, t);
        opposite = lerpPt(v1, v0, t);
      }

      // End point is 'reach' of the way across
      var end = lerpPt(start, opposite, r);

      beginShape(LINES);
      vertex(start.x * scale, start.y * scale, start.z * scale);
      vertex(end.x * scale, end.y * scale, end.z * scale);
      endShape();
    }
  }
}

/**
 * Linearly interpolates between two {x,y,z} points.
 */
function lerpPt(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

/**
 * Number of alpha bands for the fade effect.
 * More bands = smoother fade, but more draw calls.
 * Total draw calls = 3 axes × FADE_BANDS = 15 with 5 bands.
 */
var FADE_BANDS = CONFIG.fadeBands;

/**
 * Pre-computes line geometry grouped by axis AND alpha band.
 * Each line segment is assigned to a band based on its t value.
 *
 * @param {object} hilbert  - result from generateHilbert3D()
 * @param {Array}  planes   - array of plane objects
 * @param {number} scale    - world-space scale (half-extent)
 * @param {number} reach    - how far lines extend (0-1), default 1.0
 * @returns {object} { x: [[band0coords], [band1coords], ...], y: [...], z: [...] }
 */
function buildPlaneLineBatch(hilbert, planes, scale, reach) {
  var r = reach !== undefined ? reach : 1.0;

  // Initialize: 3 axes × FADE_BANDS bands
  var batch = {};
  var axes = ["x", "y", "z"];
  for (var a = 0; a < axes.length; a++) {
    batch[axes[a]] = [];
    for (var b = 0; b < FADE_BANDS; b++) {
      batch[axes[a]].push([]);
    }
  }

  for (var p = 0; p < planes.length; p++) {
    var plane = planes[p];
    var v0 = hilbert.vertices[plane.indices[0]];
    var v1 = hilbert.vertices[plane.indices[1]];
    var v2 = hilbert.vertices[plane.indices[2]];
    var v3 = hilbert.vertices[plane.indices[3]];
    var axis = plane.axis;
    if (!batch[axis]) continue;

    var styleFn = getStyleForPlane(plane);

    for (var e = 0; e < 3; e++) {
      var pattern = plane.edgePatterns ? plane.edgePatterns[e] : null;

      for (var s = 1; s < EDGE_SUBDIVISIONS; s++) {
        var idx = s - 1;
        if (pattern && pattern[idx] === 0) continue;

        var t = s / EDGE_SUBDIVISIONS;
        var start, opposite;
        if (e === 0) {
          start = lerpPt(v0, v1, t);
          opposite = lerpPt(v3, v2, t);
        } else if (e === 1) {
          start = lerpPt(v1, v2, t);
          opposite = lerpPt(v0, v3, t);
        } else {
          start = lerpPt(v2, v3, t);
          opposite = lerpPt(v1, v0, t);
        }
        var end = lerpPt(start, opposite, r);

        for (var strand = 0; strand < STRANDS_PER_POINT; strand++) {
          var seed = (strand + 0.5) / STRANDS_PER_POINT;
          var pts = styleFn(start, end, plane, seed);
          var numPts = pts.length;

          for (var i = 0; i < numPts - 1; i++) {
            // Use midpoint t to assign this segment to a band
            var tMid = (i + 0.5) / (numPts - 1);
            var band = Math.min(Math.floor(tMid * FADE_BANDS), FADE_BANDS - 1);

            batch[axis][band].push(
              pts[i].x * scale, pts[i].y * scale, pts[i].z * scale,
              pts[i + 1].x * scale, pts[i + 1].y * scale, pts[i + 1].z * scale
            );
          }
        }
      }
    }
  }

  return batch;
}

/**
 * Draws pre-computed batched lines with stepped alpha fade.
 * Total draw calls: 3 axes × FADE_BANDS.
 *
 * @param {object} batch   - result from buildPlaneLineBatch()
 * @param {number} weight  - stroke weight
 * @param {number} alpha   - max opacity 0-255 (band 0 gets this, last band fades to 0)
 */
function drawPlaneLinesBatched(batch, weight, alpha) {
  strokeWeight(weight);
  noFill();
  var axes = ["x", "y", "z"];

  for (var a = 0; a < axes.length; a++) {
    var axis = axes[a];
    var col = PLANE_COLORS[axis];
    var bands = batch[axis];

    for (var b = 0; b < FADE_BANDS; b++) {
      var coords = bands[b];
      if (coords.length === 0) continue;

      // Alpha fades linearly: band 0 = full, last band = near 0
      var bandAlpha = alpha * (1.0 - (b + 0.5) / FADE_BANDS);
      stroke(col[0], col[1], col[2], bandAlpha);

      beginShape(LINES);
      for (var i = 0; i < coords.length; i += 3) {
        vertex(coords[i], coords[i + 1], coords[i + 2]);
      }
      endShape();
    }
  }
}

/**
 * Finds the first plane of a given axis type.
 *
 * @param {object} hilbert - result from generateHilbert3D()
 * @param {string} axis    - "x", "y", or "z"
 * @returns {number|null}  - plane index, or null if none found
 */
function findFirstPlaneByAxis(hilbert, axis) {
  for (var i = 0; i < hilbert.planes.length; i++) {
    if (hilbert.planes[i].axis === axis) return i;
  }
  return null;
}

/**
 * Draws one example plane for each axis (X=red, Y=green, Z=blue).
 *
 * @param {object} hilbert - result from generateHilbert3D()
 * @param {number} scale   - world-space scale (half-extent)
 * @param {number} alpha   - opacity 0-255
 */
/**
 * Picks a random valid plane from the full pool (regular + boundary).
 *
 * @param {object} hilbert - result from generateHilbert3D()
 * @param {object} rng     - Random instance
 * @returns {object}       - a plane object
 */
function pickRandomPlane(hilbert, rng) {
  var allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);
  return rng.random_choice(allPlanes);
}

function drawOneOfEachPlane(hilbert, scale, alpha) {
  var axes = ["x", "y", "z"];
  for (var a = 0; a < axes.length; a++) {
    var idx = findFirstPlaneByAxis(hilbert, axes[a]);
    if (idx !== null) {
      drawPlane(hilbert, idx, scale, alpha);
    }
  }
}
