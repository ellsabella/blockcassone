import { CONFIG } from './config.js';

const EDGE_SUBDIVISIONS = CONFIG.edgeSubdivisions;

export function assignPlaneProperties(hilbert, rng) {
  const allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);
  for (const plane of allPlanes) {
    plane.material = rng.random_choice(CONFIG.materials);

    const matCfg = CONFIG[plane.material];
    const prob = (matCfg && matCfg.edgePointProbability !== undefined)
      ? matCfg.edgePointProbability
      : CONFIG.edgePointProbability;

    plane.edgePatterns = [];
    for (let e = 0; e < 3; e++) {
      const pattern = [];
      for (let bit = 0; bit < EDGE_SUBDIVISIONS - 1; bit++) {
        pattern.push(rng.random_bool(prob) ? 1 : 0);
      }
      plane.edgePatterns.push(pattern);
    }
  }
}

export function buildPlaneEdges(hilbert) {
  const allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);

  for (const plane of allPlanes) {
    const idx = plane.indices;
    plane.edges = [];

    for (let e = 0; e < 3; e++) {
      const vFrom = hilbert.vertices[idx[e]];
      const vTo   = hilbert.vertices[idx[e + 1]];
      const subs  = [];

      for (let s = 1; s < EDGE_SUBDIVISIONS; s++) {
        const t = s / EDGE_SUBDIVISIONS;
        subs.push({
          x: vFrom.x + (vTo.x - vFrom.x) * t,
          y: vFrom.y + (vTo.y - vFrom.y) * t,
          z: vFrom.z + (vTo.z - vFrom.z) * t,
        });
      }

      plane.edges.push({ from: idx[e], to: idx[e + 1], subVertices: subs });
    }
  }
}

export function lerpPt(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
