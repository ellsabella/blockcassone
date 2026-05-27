export function buildBlocks(hilbert) {
  const numMotifs = hilbert.vertices.length / 8;

  const bpByBoundary = {};
  for (const bp of (hilbert.boundaryPlanes || [])) {
    const key = `${bp.bridgesMotifs[0]}_${bp.bridgesMotifs[1]}`;
    bpByBoundary[key] = bp;
  }

  let current = [];
  for (let m = 0; m < numMotifs; m++) {
    current.push({
      level: 0,
      index: m,
      vertexStart: m * 8,
      vertexEnd:   m * 8 + 7,
      planes: [
        hilbert.planes[m * 3],
        hilbert.planes[m * 3 + 1],
        hilbert.planes[m * 3 + 2],
      ],
      boundaryPlanes: [],
      children: null,
    });
  }

  const levels = [current];

  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 8) {
      const children    = current.slice(i, i + 8);
      const allPlanes   = children.flatMap(c => c.planes);
      const allBoundary = children.flatMap(c => c.boundaryPlanes);

      for (let c = 0; c < children.length - 1; c++) {
        const key = `${Math.floor(children[c].vertexEnd / 8)}_${Math.floor(children[c + 1].vertexStart / 8)}`;
        if (bpByBoundary[key]) allBoundary.push(bpByBoundary[key]);
      }

      next.push({
        level:       levels.length,
        index:       next.length,
        vertexStart: children[0].vertexStart,
        vertexEnd:   children[children.length - 1].vertexEnd,
        planes:      allPlanes,
        boundaryPlanes: allBoundary,
        children,
      });
    }
    levels.push(next);
    current = next;
  }

  return levels;
}
