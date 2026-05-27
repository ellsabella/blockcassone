/**
 * Jigsaw Placement Module
 *
 * Places planes on the Hilbert curve one at a time, sequentially.
 * Each plane must be compatible with all existing neighbors before placement.
 * If a plane doesn't fit, its edge patterns are regenerated until it does.
 *
 * Two planes sharing a 3D edge are compatible if their patterns
 * don't overlap: patternA[i] + patternB[i] <= 1 for all i.
 *
 * Uses raw integer coordinates for exact edge matching (no float issues).
 */

function createPlacement(hilbert) {
  var edgeRegistry = {};
  var placedSet = {};
  var placedList = [];
  var allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);

  function edgeKey(vertIdxA, vertIdxB) {
    var a = hilbert.rawVertices[vertIdxA];
    var b = hilbert.rawVertices[vertIdxB];
    var keyA = a.x + "," + a.y + "," + a.z;
    var keyB = b.x + "," + b.y + "," + b.z;
    return keyA < keyB ? keyA + "|" + keyB : keyB + "|" + keyA;
  }

  function patternsCompatible(patA, patB) {
    for (var i = 0; i < patA.length; i++) {
      if (patA[i] === 1 && patB[i] === 1) return false;
    }
    return true;
  }

  function registerPlane(plane) {
    var idx = plane.indices;
    for (var e = 0; e < 3; e++) {
      var key = edgeKey(idx[e], idx[e + 1]);
      if (!edgeRegistry[key]) edgeRegistry[key] = [];
      edgeRegistry[key].push({
        plane: plane,
        edgeIndex: e,
        pattern: plane.edgePatterns[e]
      });
    }
  }

  function checkCompatibility(candidate) {
    var idx = candidate.indices;
    var sharedEdges = 0;

    for (var e = 0; e < 3; e++) {
      var key = edgeKey(idx[e], idx[e + 1]);
      var existing = edgeRegistry[key];
      if (!existing) continue;

      for (var r = 0; r < existing.length; r++) {
        sharedEdges++;
        if (!patternsCompatible(candidate.edgePatterns[e], existing[r].pattern)) {
          return { compatible: false, sharedEdges: sharedEdges };
        }
      }
    }

    return { compatible: true, sharedEdges: sharedEdges };
  }

  /**
   * Regenerates a plane's edge patterns using the PRNG until
   * it is compatible with all placed neighbors.
   * Returns true if successful, false if exhausted attempts.
   */
  /**
   * Regenerates edge patterns to be compatible with placed neighbors.
   * For each edge that has a placed neighbor, generates a pattern that
   * avoids the neighbor's active bits. Edges with no neighbor get
   * a fresh random pattern.
   */
  function regenUntilCompatible(plane, rng, maxAttempts) {
    var edgeSubs = CONFIG.edgeSubdivisions - 1;
    var matConfig = CONFIG[plane.material];
    var prob = (matConfig && matConfig.edgePointProbability !== undefined)
      ? matConfig.edgePointProbability
      : CONFIG.edgePointProbability;

    var idx = plane.indices;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      plane.edgePatterns = [];

      for (var e = 0; e < 3; e++) {
        var key = edgeKey(idx[e], idx[e + 1]);
        var existing = edgeRegistry[key];

        // Build a mask of bits that are already taken by neighbors
        var blocked = [];
        for (var bit = 0; bit < edgeSubs; bit++) blocked.push(false);

        if (existing) {
          for (var r = 0; r < existing.length; r++) {
            if (existing[r].plane === plane) continue;
            var neighborPat = existing[r].pattern;
            if (neighborPat) {
              for (var b = 0; b < edgeSubs; b++) {
                if (neighborPat[b] === 1) blocked[b] = true;
              }
            }
          }
        }

        // Generate pattern: only place 1s on non-blocked positions
        var pat = [];
        for (var bit2 = 0; bit2 < edgeSubs; bit2++) {
          if (blocked[bit2]) {
            pat.push(0); // can't place here, neighbor has it
          } else {
            pat.push(rng.random_bool(prob) ? 1 : 0);
          }
        }
        plane.edgePatterns.push(pat);
      }

      // Should always pass now, but verify
      if (checkCompatibility(plane).compatible) return true;
    }

    return false;
  }

  function planeKey(plane) {
    return plane.index + "_" + (plane.bridgesMotifs ? "b" : "r");
  }

  function place(plane) {
    var key = planeKey(plane);
    if (placedSet[key]) return false;
    placedSet[key] = true;
    placedList.push(plane);
    registerPlane(plane);
    return true;
  }

  /**
   * Finds all unplaced planes that share at least one edge with any
   * currently placed plane.
   */
  function findNeighborCandidates() {
    var candidates = [];
    for (var i = 0; i < allPlanes.length; i++) {
      var plane = allPlanes[i];
      if (placedSet[planeKey(plane)]) continue;

      var idx = plane.indices;
      var sharedEdges = 0;
      for (var e = 0; e < 3; e++) {
        var key = edgeKey(idx[e], idx[e + 1]);
        if (edgeRegistry[key] && edgeRegistry[key].length > 0) {
          sharedEdges++;
        }
      }

      if (sharedEdges > 0) {
        candidates.push({ plane: plane, sharedEdges: sharedEdges });
      }
    }
    return candidates;
  }

  /**
   * Places the next plane:
   * 1. If nothing placed, seed with a random plane.
   * 2. Find unplaced planes adjacent to placed ones (prefer most shared edges).
   * 3. Pick one. If its patterns conflict, regenerate until they fit.
   * 4. If no adjacent candidates, pick any random unplaced plane.
   *
   * @param {object} rng - Random instance
   * @returns {object|null} the placed plane, or null if nothing left
   */
  function placeNext(rng) {
    if (placedList.length === 0) {
      var seed = rng.random_choice(allPlanes);
      place(seed);
      return seed;
    }

    // Find adjacent candidates
    var candidates = findNeighborCandidates();

    var chosen;
    if (candidates.length > 0) {
      // Prefer tighter fits, break ties randomly
      candidates.sort(function(a, b) { return b.sharedEdges - a.sharedEdges; });
      var maxShared = candidates[0].sharedEdges;
      var best = candidates.filter(function(n) { return n.sharedEdges === maxShared; });
      chosen = rng.random_choice(best).plane;
    } else {
      // No adjacent candidates — pick any unplaced plane
      var unplaced = [];
      for (var i = 0; i < allPlanes.length; i++) {
        if (!placedSet[planeKey(allPlanes[i])]) {
          unplaced.push(allPlanes[i]);
        }
      }
      if (unplaced.length === 0) return null;
      chosen = rng.random_choice(unplaced);
    }

    // Regenerate edge patterns until compatible (destroy & rebuild)
    if (!checkCompatibility(chosen).compatible) {
      if (!regenUntilCompatible(chosen, rng, 100)) {
        // Extremely unlikely — skip this plane entirely
        return null;
      }
    }

    place(chosen);
    return chosen;
  }

  return {
    place: place,
    placeNext: placeNext,
    checkCompatibility: checkCompatibility,
    findNeighborCandidates: findNeighborCandidates,
    getPlaced: function() { return placedList; },
    getRegistry: function() { return edgeRegistry; }
  };
}
