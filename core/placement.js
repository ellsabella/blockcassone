import { CONFIG } from './config.js';

export function createPlacement(hilbert) {
  const edgeRegistry = {};
  const placedSet    = {};
  const placedList   = [];
  const allPlanes    = hilbert.planes.concat(hilbert.boundaryPlanes);
  const edgeSubs     = CONFIG.edgeSubdivisions - 1;

  function edgeKey(a, b) {
    const va = hilbert.rawVertices[a], vb = hilbert.rawVertices[b];
    const ka = `${va.x},${va.y},${va.z}`;
    const kb = `${vb.x},${vb.y},${vb.z}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function patternsCompatible(patA, patB) {
    for (let i = 0; i < patA.length; i++) {
      if (patA[i] === 1 && patB[i] === 1) return false;
    }
    return true;
  }

  function registerPlane(plane) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(plane.indices[e], plane.indices[e + 1]);
      if (!edgeRegistry[key]) edgeRegistry[key] = [];
      edgeRegistry[key].push({ plane, edgeIndex: e, pattern: plane.edgePatterns[e] });
    }
  }

  function checkCompatibility(candidate) {
    let sharedEdges = 0;
    for (let e = 0; e < 3; e++) {
      const existing = edgeRegistry[edgeKey(candidate.indices[e], candidate.indices[e + 1])];
      if (!existing) continue;
      for (const entry of existing) {
        sharedEdges++;
        if (!patternsCompatible(candidate.edgePatterns[e], entry.pattern))
          return { compatible: false, sharedEdges };
      }
    }
    return { compatible: true, sharedEdges };
  }

  function regenUntilCompatible(plane, rng, maxAttempts) {
    const matCfg = CONFIG[plane.material];
    const prob = (matCfg && matCfg.edgePointProbability !== undefined)
      ? matCfg.edgePointProbability
      : CONFIG.edgePointProbability;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      plane.edgePatterns = [];
      for (let e = 0; e < 3; e++) {
        const existing = edgeRegistry[edgeKey(plane.indices[e], plane.indices[e + 1])];
        const blocked  = new Array(edgeSubs).fill(false);
        if (existing) {
          for (const entry of existing) {
            if (entry.plane === plane) continue;
            if (entry.pattern) entry.pattern.forEach((v, i) => { if (v === 1) blocked[i] = true; });
          }
        }
        plane.edgePatterns.push(blocked.map(b => b ? 0 : (rng.random_bool(prob) ? 1 : 0)));
      }
      if (checkCompatibility(plane).compatible) return true;
    }
    return false;
  }

  function planeKey(plane) {
    return `${plane.index}_${plane.bridgesMotifs ? 'b' : 'r'}`;
  }

  function place(plane) {
    const key = planeKey(plane);
    if (placedSet[key]) return false;
    placedSet[key] = true;
    placedList.push(plane);
    registerPlane(plane);
    return true;
  }

  function findNeighborCandidates() {
    return allPlanes
      .filter(pl => !placedSet[planeKey(pl)])
      .map(pl => {
        let sharedEdges = 0;
        for (let e = 0; e < 3; e++) {
          const key = edgeKey(pl.indices[e], pl.indices[e + 1]);
          if (edgeRegistry[key]?.length > 0) sharedEdges++;
        }
        return sharedEdges > 0 ? { plane: pl, sharedEdges } : null;
      })
      .filter(Boolean);
  }

  function placeNext(rng) {
    if (placedList.length === 0) {
      const seed = rng.random_choice(allPlanes);
      place(seed);
      return seed;
    }

    const candidates = findNeighborCandidates();
    let chosen;

    if (candidates.length > 0) {
      const maxShared = candidates.reduce((m, c) => Math.max(m, c.sharedEdges), 0);
      const best = candidates.filter(c => c.sharedEdges === maxShared);
      chosen = rng.random_choice(best).plane;
    } else {
      const unplaced = allPlanes.filter(pl => !placedSet[planeKey(pl)]);
      if (unplaced.length === 0) return null;
      chosen = rng.random_choice(unplaced);
    }

    if (!checkCompatibility(chosen).compatible) {
      if (!regenUntilCompatible(chosen, rng, 100)) return null;
    }

    place(chosen);
    return chosen;
  }

  return {
    place,
    placeNext,
    checkCompatibility,
    findNeighborCandidates,
    getPlaced:   () => placedList,
    getRegistry: () => edgeRegistry,
  };
}
