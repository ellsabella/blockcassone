/**
 * Block Hierarchy Module
 *
 * Recursively groups Hilbert curve vertices into a hierarchy:
 *   Level 0: "cube"        — 8 vertices,   3 planes,  1 motif
 *   Level 1: "big cube"    — 64 vertices,  24 planes,  8 cubes
 *   Level 2: "bigger cube" — 512 vertices, 192 planes, 8 big cubes
 *   ...
 *   Level k-1: the entire curve
 *
 * Each level groups 8 of the previous level's blocks.
 * Works because the Hilbert curve visits sub-cubes contiguously.
 */

/**
 * Builds the full block hierarchy from hilbert data.
 *
 * @param {object} hilbert - result from generateHilbert3D()
 * @returns {Array} levels - levels[L] is an array of blocks at level L
 *
 * Each block:
 *   { level, index, vertexStart, vertexEnd, planes, children }
 *   - children is null at level 0, array of 8 child blocks otherwise
 */
function buildBlocks(hilbert) {
  var numMotifs = hilbert.vertices.length / 8;

  // Index boundary planes by which motif boundary they bridge
  var bpByBoundary = {};
  var bp = hilbert.boundaryPlanes || [];
  for (var b = 0; b < bp.length; b++) {
    var key = bp[b].bridgesMotifs[0] + "_" + bp[b].bridgesMotifs[1];
    bpByBoundary[key] = bp[b];
  }

  // Level 0: cubes (one per 8-vertex motif) — no boundary planes at this level
  var level0 = [];
  for (var m = 0; m < numMotifs; m++) {
    level0.push({
      level: 0,
      index: m,
      vertexStart: m * 8,
      vertexEnd: m * 8 + 7,
      planes: [
        hilbert.planes[m * 3],
        hilbert.planes[m * 3 + 1],
        hilbert.planes[m * 3 + 2]
      ],
      boundaryPlanes: [],
      children: null
    });
  }

  // Build higher levels — each groups 8 of the previous
  var levels = [level0];
  var current = level0;

  while (current.length > 1) {
    var next = [];
    for (var i = 0; i < current.length; i += 8) {
      var children = current.slice(i, i + 8);
      var allPlanes = [];
      var allBoundary = [];
      for (var c = 0; c < children.length; c++) {
        allPlanes = allPlanes.concat(children[c].planes);
        allBoundary = allBoundary.concat(children[c].boundaryPlanes);
      }
      // Find boundary planes between adjacent children within this block
      // Each child's motif range: child.vertexStart/8 .. child.vertexEnd/8
      for (var c2 = 0; c2 < children.length - 1; c2++) {
        var motifEnd = Math.floor(children[c2].vertexEnd / 8);
        var motifStart = Math.floor(children[c2 + 1].vertexStart / 8);
        // At level 0, motifEnd and motifStart are the motif indices directly
        // At higher levels, we need to check all motif boundaries between them
        // But the key insight: only the boundary at (motifEnd, motifStart) is new
        var bKey = motifEnd + "_" + motifStart;
        if (bpByBoundary[bKey]) {
          allBoundary.push(bpByBoundary[bKey]);
        }
      }
      next.push({
        level: levels.length,
        index: next.length,
        vertexStart: children[0].vertexStart,
        vertexEnd: children[children.length - 1].vertexEnd,
        planes: allPlanes,
        boundaryPlanes: allBoundary,
        children: children
      });
    }
    levels.push(next);
    current = next;
  }

  return levels;
}

/**
 * Draws all planes of a block at any level.
 *
 * @param {object} hilbert        - result from generateHilbert3D()
 * @param {object} block          - a block from any level of buildBlocks()
 * @param {number} scale          - world-space scale (half-extent)
 * @param {number} alpha          - opacity 0-255
 * @param {boolean} includeBoundary - if true, also draw boundary planes (default false)
 */
function drawBlock(hilbert, block, scale, alpha, includeBoundary, showEdgePoints) {
  var planes = block.planes;
  for (var i = 0; i < planes.length; i++) {
    drawPlane(hilbert, planes[i], scale, alpha);
    if (showEdgePoints && planes[i].edges) {
      drawPlaneEdgePoints(hilbert, planes[i], scale, 4);
    }
  }
  if (includeBoundary && block.boundaryPlanes) {
    for (var j = 0; j < block.boundaryPlanes.length; j++) {
      drawPlane(hilbert, block.boundaryPlanes[j], scale, alpha);
      if (showEdgePoints && block.boundaryPlanes[j].edges) {
        drawPlaneEdgePoints(hilbert, block.boundaryPlanes[j], scale, 4);
      }
    }
  }
}
