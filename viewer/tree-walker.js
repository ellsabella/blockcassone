// CPU mirror of pipeline/shaders/forest-tree.frag.glsl tree traversal.
// Walks a depth-3 binary tree and invokes `callback(start, end, depth)` for
// every branch segment (15 per tree). Used for generating particle positions
// along the same structure the SDF draws.

// Rodrigues rotation around a unit axis.
export function rotAxis(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];
  return [
    v[0]*c + (axis[1]*v[2] - axis[2]*v[1])*s + axis[0]*d*(1-c),
    v[1]*c + (axis[2]*v[0] - axis[0]*v[2])*s + axis[1]*d*(1-c),
    v[2]*c + (axis[0]*v[1] - axis[1]*v[0])*s + axis[2]*d*(1-c),
  ];
}

export const V = {
  add:   (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  sub:   (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  scale: (v, s) => [v[0]*s, v[1]*s, v[2]*s],
  dot:   (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2],
  cross: (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  len:   (v)    => Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]),
  norm:  (v)    => {
    const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return l > 1e-8 ? [v[0]/l, v[1]/l, v[2]/l] : [0, 0, 1];
  },
};

// Matches the GLSL hash1().
export function hash1(p) {
  const x = Math.sin(p[0]*12.9898 + p[1]*78.233 + p[2]*37.717) * 43758.5453;
  return x - Math.floor(x);
}

// Integer murmur-mix hash for deterministic placement randomness.
export function hashInt(a, b = 0, c = 0) {
  let h = Math.imul((a + 0x9e3779b9) >>> 0, 0x85ebca6b) >>> 0;
  h ^= Math.imul((b + 0xc2b2ae35) >>> 0, 0x27d4eb2f) >>> 0;
  h ^= Math.imul((c + 0x165667b1) >>> 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 0xFFFFFFFF;
}

// Depth-3 binary tree traversal. `callback(a, b, depth)` for each segment.
// depth: 0 = trunk, 1 = first fork, 2 = second fork, 3 = tips.
export function walkTree(root, fwd, upAx, len0, spread, decay, callback) {
  const e0 = V.add(root, V.scale(fwd, len0));
  callback(root, e0, 0);

  const l1  = len0 * decay;
  const f1a = rotAxis(fwd, upAx, -spread);
  const f1b = rotAxis(fwd, upAx,  spread);
  const e1a = V.add(e0, V.scale(f1a, l1));
  const e1b = V.add(e0, V.scale(f1b, l1));
  callback(e0, e1a, 1);
  callback(e0, e1b, 1);

  const l2   = l1 * decay;
  const f2aa = rotAxis(f1a, upAx, -spread);
  const f2ab = rotAxis(f1a, upAx,  spread);
  const f2ba = rotAxis(f1b, upAx, -spread);
  const f2bb = rotAxis(f1b, upAx,  spread);
  const e2aa = V.add(e1a, V.scale(f2aa, l2));
  const e2ab = V.add(e1a, V.scale(f2ab, l2));
  const e2ba = V.add(e1b, V.scale(f2ba, l2));
  const e2bb = V.add(e1b, V.scale(f2bb, l2));
  callback(e1a, e2aa, 2);
  callback(e1a, e2ab, 2);
  callback(e1b, e2ba, 2);
  callback(e1b, e2bb, 2);

  const l3 = l2 * decay;
  const leaves = [[e2aa, f2aa], [e2ab, f2ab], [e2ba, f2ba], [e2bb, f2bb]];
  for (const [p, pfwd] of leaves) {
    const fa = rotAxis(pfwd, upAx, -spread);
    const fb = rotAxis(pfwd, upAx,  spread);
    callback(p, V.add(p, V.scale(fa, l3)), 3);
    callback(p, V.add(p, V.scale(fb, l3)), 3);
  }
}
