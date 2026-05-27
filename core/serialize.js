import { CONFIG } from './config.js';

const MATERIAL_TO_PATTERN = CONFIG.materialPatterns;

export function serializePlane(hilbert, plane, levels) {
  const idx = plane.indices;

  const positions = idx.map(i => {
    const rv = hilbert.rawVertices[i];
    return { x: rv.x, y: rv.y, z: rv.z };
  });

  const cx = positions.reduce((s, p) => s + p.x, 0) / 4;
  const cy = positions.reduce((s, p) => s + p.y, 0) / 4;
  const cz = positions.reduce((s, p) => s + p.z, 0) / 4;

  const type        = plane.bridgesMotifs ? 'boundary' : 'regular';
  const motifIndex  = type === 'boundary' ? plane.bridgesMotifs[0] : Math.floor(idx[0] / 8);
  const posInMotif  = type === 'regular' ? plane.index % 3 : null;
  const blockPath   = computeBlockPath(motifIndex, levels);

  const result = {
    id:   plane.index,
    type,
    axis: plane.axis,
    vertices: { indices: idx.slice(), positions },
    center: { x: cx, y: cy, z: cz },
    material:     plane.material,
    edgePatterns: plane.edgePatterns ? plane.edgePatterns.map(p => p.slice()) : [],
    edges: [
      { from: idx[0], to: idx[1] },
      { from: idx[1], to: idx[2] },
      { from: idx[2], to: idx[3] },
    ],
    hierarchy: {
      motifIndex,
      positionInMotif: posInMotif,
      blockPath,
    },
    pattern: {
      family: MATERIAL_TO_PATTERN[plane.material] || 'straight',
    },
  };

  if (plane.bridgesMotifs) result.bridgesMotifs = plane.bridgesMotifs.slice();
  return result;
}

export function serializeAllPlaced(hilbert, placedPlanes, levels) {
  return placedPlanes.map(p => serializePlane(hilbert, p, levels));
}

function computeBlockPath(motifIndex, levels) {
  const path = [];
  let blockIdx = motifIndex;
  for (let lvl = 0; lvl < levels.length; lvl++) {
    path.push(blockIdx);
    blockIdx = Math.floor(blockIdx / 8);
  }
  return path.reverse();
}
